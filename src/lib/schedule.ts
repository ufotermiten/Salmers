import type { Booking, Room, RoomStatus } from './types';
import { parseHHMM } from './time';

const TE = 'https://cloud.timeedit.net/chalmers/web/public';
/** TimeEdit caps each response at 1000 reservations; ~50 rooms stays well below that for one day. */
const ROOMS_PER_REQUEST = 50;
const DAY_END = 24 * 60;

interface TimeEditResponse {
	columnheaders: string[];
	reservations: {
		startdate: string;
		starttime: string;
		enddate: string;
		endtime: string;
		columns: string[];
	}[];
}

/** "TME047_25_HT26_89120, TMA265_50_HT26_20131" -> "TME047, TMA265" */
function shortCourseCode(value: string | undefined): string {
	return (value ?? '').replace(/\b([A-Z]{3}\d{3})_\w+/g, '$1');
}

/**
 * Bookings are not tagged with object ids, only with the "Lokalnamn" column
 * (comma-separated when several rooms share a booking), so match on name.
 */
export function parseReservations(
	data: TimeEditResponse,
	date: string,
	idsByName: Map<string, string[]>
): Map<string, Booking[]> {
	const roomCol = data.columnheaders.findIndex((h) => h === 'Lokalnamn' || h === 'Room');
	const titleCols = ['Kurskod', 'Rubrik', 'Titel', 'Aktivitet']
		.map((h) => data.columnheaders.indexOf(h))
		.filter((i) => i >= 0);
	const out = new Map<string, Booking[]>();

	for (const r of data.reservations) {
		if (r.enddate < date || r.startdate > date) continue;
		const start = r.startdate < date ? 0 : parseHHMM(r.starttime);
		const end = r.enddate > date ? DAY_END : parseHHMM(r.endtime);
		const title = titleCols
			.map((i) => shortCourseCode(r.columns[i]))
			.filter(Boolean)
			.join(' · ');
		for (const name of (r.columns[roomCol] ?? '').split(',').map((s) => s.trim())) {
			for (const id of idsByName.get(name) ?? []) {
				const list = out.get(id) ?? [];
				list.push({ start, end, title });
				out.set(id, list);
			}
		}
	}
	for (const list of out.values()) list.sort((a, b) => a.start - b.start);
	return out;
}

export async function fetchDay(date: string, rooms: Room[]): Promise<Map<string, Booking[]>> {
	const bookable = rooms.filter((r) => !r.dropIn);
	const idsByName = new Map<string, string[]>();
	for (const r of bookable) {
		const name = r.name.trim();
		idsByName.set(name, [...(idsByName.get(name) ?? []), r.id]);
	}

	const period = date.replaceAll('-', '');
	const chunks: Room[][] = [];
	for (let i = 0; i < bookable.length; i += ROOMS_PER_REQUEST) {
		chunks.push(bookable.slice(i, i + ROOMS_PER_REQUEST));
	}

	const results = await Promise.all(
		chunks.map(async (chunk) => {
			const objects = chunk.map((r) => r.id).join(',');
			const res = await fetch(
				`${TE}/ri.json?h=t&sid=3&objects=${objects}&p=${period}-${period}&l=sv_SE`
			);
			if (!res.ok) throw new Error(`TimeEdit svarade ${res.status}`);
			return parseReservations(await res.json(), date, idsByName);
		})
	);

	const merged = new Map<string, Booking[]>();
	for (const m of results) for (const [id, list] of m) merged.set(id, list);
	return merged;
}

/** Status at `minute`, treating back-to-back or overlapping bookings as one busy block. */
export function statusAt(bookings: Booking[], minute: number): RoomStatus {
	const sorted = [...bookings].sort((a, b) => a.start - b.start);
	const current = sorted.find((b) => b.start <= minute && minute < b.end);
	if (!current) {
		const next = sorted.find((b) => b.start > minute);
		return { free: true, until: next ? next.start : null };
	}
	let until = current.end;
	for (const b of sorted) {
		if (b.start <= until && b.end > until) until = b.end;
	}
	return { free: false, until };
}
