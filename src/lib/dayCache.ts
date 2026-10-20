import type { Booking, Room } from './types';
import { fetchDay } from './schedule';

const KEY = 'salmers:day:';
/** Be gentle with TimeEdit: refetch a day at most this often. */
const TTL_MS = 5 * 60_000;

export interface DayData {
	date: string;
	fetchedAt: number;
	bookings: Map<string, Booking[]>;
}

const memory = new Map<string, DayData>();

function read(date: string): DayData | null {
	if (memory.has(date)) return memory.get(date)!;
	try {
		const raw = localStorage.getItem(KEY + date);
		if (!raw) return null;
		const { fetchedAt, bookings } = JSON.parse(raw);
		const data = { date, fetchedAt, bookings: new Map<string, Booking[]>(bookings) };
		memory.set(date, data);
		return data;
	} catch {
		return null;
	}
}

function write(data: DayData) {
	memory.set(data.date, data);
	try {
		localStorage.setItem(
			KEY + data.date,
			JSON.stringify({ fetchedAt: data.fetchedAt, bookings: [...data.bookings] })
		);
		pruneOld(data.date);
	} catch {
		// Storage full or unavailable: the in-memory copy is enough.
	}
}

function pruneOld(keepFrom: string) {
	for (let i = localStorage.length - 1; i >= 0; i--) {
		const k = localStorage.key(i);
		if (k?.startsWith(KEY) && k.slice(KEY.length) < keepFrom) localStorage.removeItem(k);
	}
}

export function cachedDay(date: string): DayData | null {
	return read(date);
}

export async function loadDay(date: string, rooms: Room[], force = false): Promise<DayData> {
	const cached = read(date);
	if (cached && !force && Date.now() - cached.fetchedAt < TTL_MS) return cached;
	const data = { date, fetchedAt: Date.now(), bookings: await fetchDay(date, rooms) };
	write(data);
	return data;
}
