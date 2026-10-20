// Builds src/lib/data/rooms.json from TimeEdit (room list) and maps.chalmers.se
// (coordinates, seats, equipment, drop-in study spaces). Run: npm run build:rooms
import { writeFile, mkdir } from 'node:fs/promises';

const TE = 'https://cloud.timeedit.net/chalmers/web/public';
const MAPS = 'https://maps.chalmers.se/v2';
const CAMPUS = 'Johanneberg';
const JOHANNEBERG_DOCID = 'a85a8be2-4ff6-4e39-9880-c2adb2a7626f';
const TYPES = ['Lektionssal', 'Hörsal', 'Datorsal'];
const OUT = new URL('../src/lib/data/rooms.json', import.meta.url);

const decode = (s) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');

async function getJson(url, init) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(url, init);
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			const text = await res.text();
			return text ? JSON.parse(text) : null;
		} catch (err) {
			if (attempt >= 2) throw err;
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
		}
	}
}

async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: limit }, async () => {
			while (next < items.length) {
				const i = next++;
				results[i] = await fn(items[i]);
			}
		})
	);
	return results;
}

async function listTimeEditRooms(type) {
	const fe = `&fe=${encodeURIComponent(`14.${type}`)}&fe=${encodeURIComponent(`26.${CAMPUS}`)}`;
	const rooms = [];
	for (let start = 0; ; start += 100) {
		const url = `${TE}/objects.html?max=100&start=${start}&partajax=t&sid=9&types=4&search_text=${fe}`;
		const html = await (await fetch(url)).text();
		const page = [...html.matchAll(/data-id="(\d+\.4)"[^>]*?data-name="([^"]*)"/g)].map(
			([, id, name]) => ({ id, label: decode(name) })
		);
		rooms.push(...page);
		if (page.length < 100) break;
	}
	return rooms.filter((r) => !r.label.includes('[Inaktiv]')).map((r) => ({ ...r, type }));
}

async function seatsAndEquipment(mapsId) {
	const info = await getJson(`${MAPS}/info/${mapsId}/json?lang=sv`).catch(() => null);
	const p = info?.properties ?? info ?? {};
	const extra = p.timeedit_id
		? await getJson(`${MAPS}/webservices/timeedit/room/${p.timeedit_id}/json`).catch(() => null)
		: null;
	return {
		lat: p.latitude ?? null,
		lng: p.longitude ?? null,
		seats: extra?.seats ? Number(extra.seats) : null,
		equipment: extra?.equipment ? extra.equipment.split(',').map((s) => s.trim()) : []
	};
}

async function timeEditRooms() {
	const listed = (await Promise.all(TYPES.map(listTimeEditRooms))).flat();
	// A room can appear under several types; keep the first.
	const unique = [...new Map(listed.map((r) => [r.id, r])).values()];

	return mapLimit(unique, 4, async (room) => {
		const obj = (await getJson(`${TE}/objects/${room.id}.json?sid=9`)) ?? {};
		const mapsId = obj['Kartlänk']?.split('#')[1] ?? null;
		const geo = mapsId ? await seatsAndEquipment(mapsId) : {};
		return {
			id: room.id,
			name: (obj['Lokalnamn'] || room.label.split(', ')[1]).trim(),
			type: room.type,
			building: obj['Byggnad'] ?? null,
			floor: obj['Våningsplan'] ?? null,
			roomNumber: obj['Rumsnummer'] ?? null,
			mapsId,
			lat: geo.lat ?? null,
			lng: geo.lng ?? null,
			seats: geo.seats ?? null,
			equipment: geo.equipment ?? [],
			dropIn: false
		};
	});
}

async function studySpaces() {
	const url = `${MAPS}/geojson?recursive=true&scopes[]=chalmers&types[]=facility:study_space&docid=${JOHANNEBERG_DOCID}&lang=sv`;
	const geo = await getJson(url);
	return geo.features.map(({ properties: p }) => ({
		id: `maps:${p.id}`,
		name: p.name,
		type: 'Studieplats',
		building: p.building_name ?? null,
		floor: p.floor_level ?? null,
		roomNumber: null,
		mapsId: p.id,
		lat: p.latitude ?? null,
		lng: p.longitude ?? null,
		seats: null,
		equipment: [],
		dropIn: true
	}));
}

const rooms = [...(await timeEditRooms()), ...(await studySpaces())].sort((a, b) =>
	a.name.localeCompare(b.name, 'sv', { numeric: true })
);

await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(
	OUT,
	JSON.stringify({ generatedAt: new Date().toISOString(), rooms }, null, '\t') + '\n'
);

const counts = Object.groupBy(rooms, (r) => r.type);
console.log(
	`Wrote ${rooms.length} rooms:`,
	Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length]))
);
