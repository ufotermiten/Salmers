// Builds src/lib/data/rooms.json from TimeEdit (room list) and maps.chalmers.se
// (coordinates, seats, equipment, drop-in study spaces, buildings, entrances and
// floors for walking routes). Run: npm run build:rooms
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as prettier from 'prettier';

const TE = 'https://cloud.timeedit.net/chalmers/web/public';
const MAPS = 'https://maps.chalmers.se/v2';
const CAMPUS = 'Johanneberg';
const JOHANNEBERG_DOCID = 'a85a8be2-4ff6-4e39-9880-c2adb2a7626f';
const TYPES = ['Lektionssal', 'Hörsal', 'Datorsal'];
const OUT = new URL('../src/lib/data/rooms.json', import.meta.url);

// Indoor walking groups (Room.buildingId). maps building_id is too fine-grained
// (ED-blocket is three "buildings": EDIT trappa C/D/H, EDIT trappa F/G/H, Linsen),
// so a building is grouped under its parent when that parent is a maps
// "building_complex" (EDIT, Fysik, Hörsalslängan, Maskin, MC2, Vasa Hus 1-2-3).
// TimeEdit's Byggnad is too coarse in places (it is closer to "department": e.g.
// "Maskinteknik" includes the free-standing Kraftcentralen), so it is only used to
// place rooms that have no maps link. Manual merges for buildings that are
// physically connected but not in the same maps complex:
const GROUP_MERGES = [
	// MV-huset continues Fysik's stair lettering (Euler/MVF* in stair F, Pascal in
	// stair H) and TimeEdit puts Euler and Pascal in the same building.
	['Fysik', 'MV-huset'],
	// The Vasa Hus 2-3 entrance hall connects Vasa Hus 2 and 3.
	['Vasa Hus 1-2-3', 'Vasa Hus 2', 'Vasa Hus 3']
];
// TimeEdit buildings whose rooms lack a maps link -> maps group name.
const TE_BUILDING_ALIASES = { 'MC2-Huset': 'MC2' };

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
	// "[Inaktiv]" and "..._old" are retired rooms that TimeEdit still lists.
	return rooms
		.filter((r) => !r.label.includes('[Inaktiv]') && !/_old\b/i.test(r.label))
		.map((r) => ({ ...r, type }));
}

/** maps info properties for a node (room, entrance, building, complex), or {}. */
async function mapsInfo(id) {
	const info = await getJson(`${MAPS}/info/${id}/json?lang=sv&features[]=entrance_summary`).catch(
		() => null
	);
	return info?.properties ?? info ?? {};
}

async function seatsAndEquipment(mapsId) {
	const p = await mapsInfo(mapsId);
	const extra = p.timeedit_id
		? await getJson(`${MAPS}/webservices/timeedit/room/${p.timeedit_id}/json`).catch(() => null)
		: null;
	return {
		maps: p,
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
			dropIn: false,
			_maps: geo.maps ?? null
		};
	});
}

async function studySpaces() {
	const url = `${MAPS}/geojson?recursive=true&scopes[]=chalmers&types[]=facility:study_space&docid=${JOHANNEBERG_DOCID}&lang=sv`;
	const geo = await getJson(url);
	return mapLimit(geo.features, 4, async ({ properties: p }) => ({
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
		dropIn: true,
		_maps: await mapsInfo(p.id)
	}));
}

// --- Walking-route fields --------------------------------------------------
//
// level / entranceLevel are ordinal floor numbers such that |a - b| approximates
// flights of stairs. Floor labels from maps/TimeEdit:
//  - numbers, possibly with a wing suffix ("2ö", "3 ö", "2 v") or several floors
//    ("2,3", "E,5 och 6"): the first floor is used.
//  - negative floors: Chalmers skips floor 0, "-1" is directly below 1 (M-huset's
//    floor list is "-1,E,2,...", SB1's "-1" rooms are numbered 0xx), so -k -> 1-k.
//    "0" (library) stays 0.
//  - "E" (entréplan) is resolved to the building's entrance floor, `entranceE`.
//
// The entrance floor of a building is taken from, in order: maps
// entrance_floor_level on the building, on its rooms, or on rooms in the same
// group using the same entrance address; the position of "E" in the building's
// maps `floors` list ("1,2,3,E,5" -> 4); TimeEdit's numeric floor for rooms that
// maps labels "E" (Kemi KA: TimeEdit 4); the leading digit of 4-digit room
// numbers on "E" rooms (EDIT's E-Studion is 2338 -> 2); the most common value in
// the group; otherwise 1 (ground floor — Chalmers buildings without other
// evidence number the street-level floor 1).
// A room's entranceLevel is its own entrance_floor_level when maps gives one
// (rooms are linked to a specific entrance), else the building's entrance floor.

const floorToken = (s) =>
	s == null || s === ''
		? null
		: String(s)
				.split(/,|\s+och\s+/)[0]
				.trim() || null;
const ordinal = (n) => (n < 0 ? n + 1 : n);

/** 'E', an ordinal level, or null. */
function parseFloor(s) {
	const t = floorToken(s);
	if (t == null) return null;
	if (/^E\b/i.test(t)) return 'E';
	const m = t.match(/^-?\d+/);
	return m ? ordinal(Number(m[0])) : null;
}

const parseLevel = (s) => {
	const f = parseFloor(s);
	return typeof f === 'number' ? f : null;
};

/** Entrance level implied by a maps `floors` list such as "1,2,3,E,5,6". */
function entranceFromFloorList(floors) {
	const list = String(floors ?? '')
		.split(',')
		.map((s) => s.trim());
	const i = list.indexOf('E');
	if (i < 0) return null;
	const prev = parseLevel(list[i - 1]);
	if (prev != null) return prev + 1;
	const next = parseLevel(list[i + 1]);
	return next != null ? next - 1 : null;
}

/** Most common non-null value, ties going to the first seen. */
function mode(values) {
	const counts = new Map();
	for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best = null;
	for (const [v, c] of counts) if (best == null || c > counts.get(best)) best = v;
	return best;
}

const leadingDigit = (roomNumber) => {
	const m = String(roomNumber ?? '').match(/^(\d)\d{3}[A-Z]?$/);
	return m ? Number(m[1]) : null;
};
const firstParent = (p) =>
	String(p?.parent_ids ?? '')
		.split(',')
		.filter(Boolean)[0] ?? null;

async function addWalkingFields(rooms) {
	// Fetch each building and its parent once.
	const bids = [...new Set(rooms.map((r) => r._maps?.building_id).filter(Boolean))];
	const buildings = new Map(
		(await mapLimit(bids, 4, async (id) => [id, await mapsInfo(id)])).filter(([, p]) => p.id)
	);
	const parentIds = [...new Set([...buildings.values()].map(firstParent).filter(Boolean))];
	const parents = new Map(await mapLimit(parentIds, 4, async (id) => [id, await mapsInfo(id)]));

	const groupOf = new Map();
	const groupByName = new Map();
	for (const [bid, b] of buildings) {
		const parent = parents.get(firstParent(b));
		const gid = parent?.element_type === 'building_complex' ? parent.id : bid;
		groupOf.set(bid, gid);
		if (parent?.element_type === 'building_complex') groupByName.set(parent.name, gid);
		if (!groupByName.has(b.name)) groupByName.set(b.name, gid);
	}
	for (const [target, ...names] of GROUP_MERGES) {
		const gid = groupByName.get(target);
		if (!gid) continue;
		for (const [bid, b] of buildings) if (names.includes(b.name)) groupOf.set(bid, gid);
		for (const name of names) groupByName.set(name, gid);
	}

	for (const r of rooms) r._gid = groupOf.get(r._maps?.building_id) ?? null;
	// Rooms without a maps link: group by TimeEdit building.
	const teGroup = Object.fromEntries(
		Object.entries(Object.groupBy(rooms, (r) => r.building ?? '')).map(([name, rs]) => [
			name,
			mode(rs.map((r) => r._gid)) ?? groupByName.get(TE_BUILDING_ALIASES[name])
		])
	);
	for (const r of rooms) {
		r._gid ??= teGroup[r.building ?? ''] ?? (r.building ? `te:${r.building}` : null);
		const p = r._maps ?? {};
		r._bid = p.building_id ?? null;
		r._efl = parseLevel(p.entrance_floor_level);
		r._key = `${r._gid}|${p.entrance_access ?? firstParent(p)}`;
		// Prefer maps' floor label, fall back to TimeEdit's.
		r._floor = parseFloor(p.floor_level) ?? parseFloor(r.floor);
	}

	const byKey = Object.groupBy(rooms, (r) => r._key);
	const keyEfl = (key) => mode(byKey[key].map((r) => r._efl));
	const byBuilding = Object.groupBy(
		rooms.filter((r) => r._bid),
		(r) => r._bid
	);
	const buildingE = new Map();
	for (const [bid, rs] of Object.entries(byBuilding)) {
		const b = buildings.get(bid) ?? {};
		const onE = rs.filter((r) => r._floor === 'E');
		buildingE.set(
			bid,
			parseLevel(b.entrance_floor_level) ??
				mode(rs.map((r) => r._efl)) ??
				mode(rs.map((r) => keyEfl(r._key))) ??
				entranceFromFloorList(b.floors) ??
				mode(onE.map((r) => parseLevel(r.floor))) ??
				mode(onE.map((r) => leadingDigit(r.roomNumber)))
		);
	}
	const byGroup = Object.groupBy(rooms, (r) => r._gid ?? '');
	const groupE = (gid) => mode(byGroup[gid ?? ''].map((r) => buildingE.get(r._bid))) ?? 1;
	const entranceE = (r) => buildingE.get(r._bid) ?? groupE(r._gid);

	const fields = rooms.map((r) => {
		const p = r._maps ?? {};
		const entranceLevel = r._efl ?? keyEfl(r._key) ?? entranceE(r);
		const level =
			r._floor === 'E'
				? entranceE(r)
				: (r._floor ?? (r.floor == null ? leadingDigit(r.roomNumber) : null));
		return {
			buildingId: r._gid,
			entranceLat: p.entrance_latitude ?? r.lat,
			entranceLng: p.entrance_longitude ?? r.lng,
			level,
			entranceLevel
		};
	});
	return rooms.map((r, i) => ({
		...Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))),
		...fields[i]
	}));
}

/**
 * Rooms without a maps link have no coordinates and could never be routed. Place them at the
 * most common entrance of other rooms in the same TimeEdit building (or walking group) instead:
 * the exact spot inside is unknown, but the building and floor are what matter for the route.
 */
function borrowSiblingPositions(rooms) {
	const located = rooms.filter((r) => r.lat !== null && r.entranceLat !== null);
	return rooms.map((r) => {
		if (r.lat !== null) return r;
		let siblings = located.filter((s) => r.building && s.building === r.building);
		if (!siblings.length)
			siblings = located.filter((s) => r.buildingId && s.buildingId === r.buildingId);
		const entrance = mode(siblings.map((s) => `${s.entranceLat},${s.entranceLng}`));
		if (!entrance) return r;
		const [lat, lng] = entrance.split(',').map(Number);
		return { ...r, lat, lng, entranceLat: lat, entranceLng: lng };
	});
}

const rooms = borrowSiblingPositions(
	await addWalkingFields([...(await timeEditRooms()), ...(await studySpaces())])
).sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));

// Keep the old timestamp when no room changed, so the weekly refresh job finds no diff and opens
// no PR. Format with the repo's prettier config so the output passes `prettier --check`.
const previous = await readFile(OUT, 'utf8')
	.then(JSON.parse)
	.catch(() => null);
const unchanged = previous && isDeepStrictEqual(previous.rooms, rooms);
const generatedAt = unchanged ? previous.generatedAt : new Date().toISOString();
const json = await prettier.format(JSON.stringify({ generatedAt, rooms }), {
	...(await prettier.resolveConfig(fileURLToPath(OUT))),
	filepath: fileURLToPath(OUT)
});
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, json);

const counts = Object.groupBy(rooms, (r) => r.type);
console.log(
	`Wrote ${rooms.length} rooms${unchanged ? ' (unchanged)' : ''}:`,
	Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length]))
);
