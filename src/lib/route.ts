/**
 * Route optimizer: start from the user's location and walk past as many free
 * rooms as possible within a time budget (an orienteering problem).
 *
 * Every room is worth ~1 point; walking, stairs and peeking inside cost
 * seconds. Rooms are inserted greedily by points per second. Besides single
 * rooms, a whole floor of free rooms (or a whole building, minus floors not
 * worth their stairs) can be inserted as one "bundle" so a stair climb or an
 * outdoor walk is shared between them. A move is never taken if it costs more
 * than MAX_SECONDS_PER_ROOM per room, even if budget remains: one free room
 * four floors up is not worth the climb, four of them are. After filling,
 * 2-opt and or-opt passes shorten the walk, which frees budget for more
 * insertions, until nothing changes.
 */
import { statusAt } from './schedule';
import type { Booking, Room } from './types';

/** Walking speed in metres per second. */
export const WALK_SPEED_MPS = 1.3;
/** Straight-line (haversine) distance is multiplied by this to approximate real paths. */
export const DETOUR_FACTOR = 1.3;
/** Seconds per floor of stairs, up or down. */
export const STAIR_SECONDS = 20;
/** Added to an indoor leg within one building when a room's level is unknown. */
export const UNKNOWN_LEVEL_PENALTY_SECONDS = 15;
/** Floors assumed between a room and its entrance when either level is unknown. */
export const UNKNOWN_ENTRANCE_FLOORS = 1;
/** Seconds spent at each room (opening the door and peeking inside). */
export const VISIT_SECONDS = 30;
/** A move is skipped if its extra time per added room exceeds this. */
export const MAX_SECONDS_PER_ROOM = 100;
/** A room must stay free at least this long after arrival (default for RouteOptions). */
export const DEFAULT_MIN_FREE_MINUTES = 20;
/** Max extra value (on top of 1) for a room that stays free long; a tie-breaker. */
export const FREE_TIME_BONUS = 0.05;
/** Free time (minutes) that earns the full FREE_TIME_BONUS. */
export const FREE_TIME_BONUS_HORIZON = 180;

const EARTH_RADIUS_M = 6_371_000;
const MAX_ROUNDS = 20;
const MAX_IMPROVING_MOVES = 500;
const EPS = 1e-6;

export interface RouteOptions {
	start: { lat: number; lng: number };
	/** Minute of day (after local midnight) when the walk starts. */
	startMinute: number;
	/** Max total walking + visiting time in minutes. */
	budgetMinutes: number;
	/** A room must stay free at least this long after arrival. */
	minFreeMinutes?: number;
	/**
	 * Require each room to be free from arrival (or `from`, if later) until `until`, instead of
	 * just minFreeMinutes after arrival. Used to keep rooms that are free for the rest of a block.
	 */
	freeThrough?: { from: number; until: number };
	/**
	 * Skip the arrival-time check: the caller has already picked the rooms it wants visited
	 * (e.g. everything the list shows as free), so order them all however long the walk gets.
	 */
	anyArrival?: boolean;
	/** Skip moves costing more than this per room (default MAX_SECONDS_PER_ROOM); Infinity = budget only. */
	maxSecondsPerRoom?: number;
}

export interface RouteStop {
	room: Room;
	/** Minute of day on arrival (fractional). */
	arrivalMinute: number;
	/** When the room's free stretch ends, null for the rest of the day. */
	freeUntil: number | null;
	/** Travel time of the leg leading here, including stairs. */
	walkSeconds: number;
	/** Floors climbed or descended on the leg leading here. */
	stairs: number;
	/** Whether the leg leading here goes outdoors (start or building change). */
	outdoors: boolean;
}

export interface RoutePlan {
	stops: RouteStop[];
	/** Total walking + visiting seconds, at most budgetMinutes * 60. */
	totalSeconds: number;
}

interface Node {
	room: Room;
	bookings: Booking[];
	lat: number;
	lng: number;
	entLat: number;
	entLng: number;
	toEntranceFloors: number;
	toEntranceSeconds: number;
	/** Arrival minutes [from, to] at which the room is free for at least minFree minutes. */
	windows: [number, number][];
	value: number;
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const rad = Math.PI / 180;
	const dLat = (bLat - aLat) * rad;
	const dLng = (bLng - aLng) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function walkSeconds(aLat: number, aLng: number, bLat: number, bLng: number): number {
	return (haversine(aLat, aLng, bLat, bLng) * DETOUR_FACTOR) / WALK_SPEED_MPS;
}

const isNum = (v: number | null | undefined): v is number =>
	typeof v === 'number' && Number.isFinite(v);

/** Arrival intervals where the room is free and stays free >= minFree minutes. */
function validWindows(bookings: Booking[], minFree: number): [number, number][] {
	const out: [number, number][] = [];
	let t = 0;
	for (let guard = 0; guard <= 2 * bookings.length + 1; guard++) {
		const s = statusAt(bookings, t);
		if (!s.free) {
			t = s.until;
			continue;
		}
		const last = s.until === null ? Infinity : s.until - minFree;
		if (last >= t) out.push([t, last]);
		if (s.until === null) break;
		t = s.until;
	}
	return out;
}

/** Arrival intervals where no booking overlaps [max(arrival, from), until) and >= minFree remains. */
function windowsThrough(
	bookings: Booking[],
	from: number,
	until: number,
	minFree: number
): [number, number][] {
	let lastEnd = -Infinity;
	for (const b of bookings) if (b.start < until && b.end > from) lastEnd = Math.max(lastEnd, b.end);
	const latest = until - minFree;
	return lastEnd <= latest ? [[lastEnd, latest]] : [];
}

function makeNode(
	room: Room,
	bookings: Booking[],
	startMinute: number,
	minFree: number,
	freeThrough?: { from: number; until: number },
	anyArrival = false
): Node | null {
	if (!isNum(room.lat) || !isNum(room.lng)) return null;
	const hasEntrance = isNum(room.entranceLat) && isNum(room.entranceLng);
	const entLat = hasEntrance ? (room.entranceLat as number) : room.lat;
	const entLng = hasEntrance ? (room.entranceLng as number) : room.lng;
	const toEntranceFloors =
		isNum(room.level) && isNum(room.entranceLevel)
			? Math.abs(room.level - room.entranceLevel)
			: UNKNOWN_ENTRANCE_FLOORS;

	let freeFor = 0;
	if (room.dropIn) freeFor = FREE_TIME_BONUS_HORIZON;
	else {
		const s = statusAt(bookings, startMinute);
		if (s.free) freeFor = s.until === null ? FREE_TIME_BONUS_HORIZON : s.until - startMinute;
	}

	return {
		room,
		bookings,
		lat: room.lat,
		lng: room.lng,
		entLat,
		entLng,
		toEntranceFloors,
		toEntranceSeconds:
			walkSeconds(room.lat, room.lng, entLat, entLng) + toEntranceFloors * STAIR_SECONDS,
		windows:
			room.dropIn || anyArrival
				? [[-Infinity, Infinity]]
				: freeThrough
					? windowsThrough(bookings, freeThrough.from, freeThrough.until, minFree)
					: validWindows(bookings, minFree),
		value:
			1 + (FREE_TIME_BONUS * Math.min(freeFor, FREE_TIME_BONUS_HORIZON)) / FREE_TIME_BONUS_HORIZON
	};
}

interface Leg {
	seconds: number;
	stairs: number;
	outdoors: boolean;
}

function roomLeg(a: Node, b: Node): Leg {
	const building = a.room.buildingId;
	if (building !== null && building !== undefined && building === b.room.buildingId) {
		const indoor = walkSeconds(a.lat, a.lng, b.lat, b.lng);
		const la = a.room.level;
		const lb = b.room.level;
		if (isNum(la) && isNum(lb)) {
			const stairs = Math.abs(la - lb);
			return { seconds: indoor + stairs * STAIR_SECONDS, stairs, outdoors: false };
		}
		return { seconds: indoor + UNKNOWN_LEVEL_PENALTY_SECONDS, stairs: 0, outdoors: false };
	}
	return {
		seconds:
			a.toEntranceSeconds +
			walkSeconds(a.entLat, a.entLng, b.entLat, b.entLng) +
			b.toEntranceSeconds,
		stairs: a.toEntranceFloors + b.toEntranceFloors,
		outdoors: true
	};
}

function startLeg(start: { lat: number; lng: number }, b: Node): Leg {
	return {
		seconds: walkSeconds(start.lat, start.lng, b.entLat, b.entLng) + b.toEntranceSeconds,
		stairs: b.toEntranceFloors,
		outdoors: true
	};
}

const validAt = (node: Node, minute: number) =>
	node.windows.some(([from, to]) => minute >= from - EPS && minute <= to + EPS);

/**
 * Plan an open walk from `options.start` past as many free rooms as is worth
 * it. Rooms without coordinates are ignored; drop-in rooms are always valid;
 * other rooms must be free on arrival and stay free >= minFreeMinutes.
 * Deterministic: candidates are processed in room id order.
 */
export function planRoute(
	candidates: { room: Room; bookings: Booking[] }[],
	options: RouteOptions
): RoutePlan {
	const minFree = options.minFreeMinutes ?? DEFAULT_MIN_FREE_MINUTES;
	const maxPerRoom = options.maxSecondsPerRoom ?? MAX_SECONDS_PER_ROOM;
	const budget = options.budgetMinutes * 60;
	const t0 = options.startMinute;
	const empty: RoutePlan = { stops: [], totalSeconds: 0 };
	if (!(budget > 0) || !isNum(options.start.lat) || !isNum(options.start.lng)) return empty;

	// Index 0 is the start; rooms are 1..n.
	const sorted = [...candidates].sort((a, b) =>
		a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0
	);
	const nodes: Node[] = [];
	const startLegs: Leg[] = [];
	const seen = new Set<string>();
	for (const c of sorted) {
		if (seen.has(c.room.id)) continue;
		seen.add(c.room.id);
		const node = makeNode(
			c.room,
			c.bookings ?? [],
			t0,
			minFree,
			options.freeThrough,
			options.anyArrival
		);
		if (!node) continue;
		const leg = startLeg(options.start, node);
		if (leg.seconds + VISIT_SECONDS > budget + EPS) continue;
		const earliest = t0 + leg.seconds / 60;
		const latest = t0 + budget / 60;
		if (!node.windows.some(([from, to]) => to >= earliest && from <= latest)) continue;
		nodes.push(node);
		startLegs.push(leg);
	}
	const n = nodes.length;
	if (n === 0) return empty;

	const N = n + 1;
	const node = (i: number) => nodes[i - 1];
	const C = new Float64Array(N * N);
	for (let j = 1; j < N; j++) C[j] = startLegs[j - 1].seconds;
	for (let i = 1; i < N; i++) {
		for (let j = i + 1; j < N; j++) {
			const s = roomLeg(node(i), node(j)).seconds;
			C[i * N + j] = s;
			C[j * N + i] = s;
		}
	}
	const cost = (i: number, j: number) => C[i * N + j];

	// Walking to the nearest usable room is unavoidable, so it is free when
	// judging whether a move is worth it; otherwise a far-away user gets nothing.
	let approach = Infinity;
	for (let j = 1; j < N; j++) {
		if (validAt(node(j), t0 + cost(0, j) / 60)) approach = Math.min(approach, cost(0, j));
	}
	if (approach === Infinity) for (let j = 1; j < N; j++) approach = Math.min(approach, cost(0, j));
	const worthCost = (i: number, j: number) => (i === 0 ? cost(0, j) - approach : cost(i, j));

	// Floor bundles (rooms sharing buildingId + level) and building bundles
	// (a building's rooms across floors; floors not worth their stairs are trimmed).
	const levelKey = (j: number) => {
		const { level } = node(j).room;
		return isNum(level) ? String(level) : `?${j}`;
	};
	const floorMap = new Map<string, number[]>();
	const buildingMap = new Map<string, number[]>();
	for (let j = 1; j < N; j++) {
		const { buildingId } = node(j).room;
		if (buildingId === null || buildingId === undefined) continue;
		for (const [map, key] of [
			[floorMap, `${buildingId}\u0000${levelKey(j)}`],
			[buildingMap, buildingId]
		] as const) {
			const list = map.get(key) ?? [];
			list.push(j);
			map.set(key, list);
		}
	}
	const floors = [...floorMap.values()].filter((g) => g.length >= 2);
	const buildings = [...buildingMap.values()].filter((g) => new Set(g.map(levelKey)).size >= 2);

	/** Total seconds of a route, or -1 if some stop is not free on arrival. */
	const simulate = (r: number[]): number => {
		let t = 0;
		let prev = 0;
		for (const j of r) {
			t += cost(prev, j);
			if (!validAt(node(j), t0 + t / 60)) return -1;
			t += VISIT_SECONDS;
			prev = j;
		}
		return t;
	};

	let route: number[] = [];
	let total = 0;
	const inRoute = new Uint8Array(N);

	/** Insert the best worthwhile single room or bundle; false if none fits. */
	const insertOne = (): boolean => {
		const len = route.length;
		// dep[p]: seconds when leaving the node before position p.
		const dep = new Float64Array(len + 1);
		for (let p = 0, prev = 0, t = 0; p < len; p++) {
			t += cost(prev, route[p]) + VISIT_SECONDS;
			dep[p + 1] = t;
			prev = route[p];
		}

		let bestScore = -Infinity;
		let bestRoute: number[] | null = null;
		let bestTotal = 0;

		/** Extra seconds of inserting `block` at position p: real, and with the approach discounted. */
		const deltas = (p: number, block: number[]) => {
			const prev = p === 0 ? 0 : route[p - 1];
			const next = p < len ? route[p] : -1;
			let inner = block.length * VISIT_SECONDS;
			for (let k = 1; k < block.length; k++) inner += cost(block[k - 1], block[k]);
			if (next >= 0) inner += cost(block[block.length - 1], next);
			return {
				real: cost(prev, block[0]) + inner - (next >= 0 ? cost(prev, next) : 0),
				worth: worthCost(prev, block[0]) + inner - (next >= 0 ? worthCost(prev, next) : 0)
			};
		};

		/** Returns false when the block does not fit the remaining budget. */
		const consider = (p: number, block: number[]): boolean => {
			const d = deltas(p, block);
			if (total + d.real > budget + EPS) return false;
			if (d.worth / block.length > maxPerRoom + EPS) return true;
			let value = 0;
			for (const j of block) value += node(j).value;
			const score = value / Math.max(d.worth, 1);
			if (score <= bestScore + EPS) return true;
			const cand = [...route.slice(0, p), ...block, ...route.slice(p)];
			const t = simulate(cand);
			if (t < 0 || t > budget + EPS) return true;
			bestScore = score;
			bestRoute = cand;
			bestTotal = t;
			return true;
		};

		/** A bundle that overshoots the budget may still be worth taking in part: try its longest prefix that fits. */
		const considerBundle = (p: number, block: number[]) => {
			for (let k = block.length; k >= 2; k--) {
				if (consider(p, block.slice(0, k))) return;
			}
		};

		/** Unrouted members likely free on arrival, in nearest-neighbour order from position p. */
		const bundle = (p: number, group: number[]): number[] => {
			const prev = p === 0 ? 0 : route[p - 1];
			const members = group.filter(
				(j) => !inRoute[j] && validAt(node(j), t0 + (dep[p] + cost(prev, j)) / 60)
			);
			const block: number[] = [];
			let cur = prev;
			while (members.length) {
				let bi = 0;
				for (let k = 1; k < members.length; k++) {
					if (cost(cur, members[k]) < cost(cur, members[bi]) - EPS) bi = k;
				}
				cur = members.splice(bi, 1)[0];
				block.push(cur);
			}
			return block;
		};

		/** Drop floors from a building bundle while one costs more than MAX_SECONDS_PER_ROOM per room. */
		const trimFloors = (p: number, block: number[]): number[] => {
			for (;;) {
				const keys = [...new Set(block.map(levelKey))];
				if (keys.length < 2) return block;
				const base = deltas(p, block).worth;
				let worst: number[] | null = null;
				let worstPerRoom = maxPerRoom + EPS;
				for (const key of keys) {
					const rest = block.filter((j) => levelKey(j) !== key);
					const perRoom = (base - deltas(p, rest).worth) / (block.length - rest.length);
					if (perRoom > worstPerRoom) {
						worst = rest;
						worstPerRoom = perRoom;
					}
				}
				if (!worst) return block;
				block = worst;
			}
		};

		for (let p = 0; p <= len; p++) {
			const prev = p === 0 ? 0 : route[p - 1];
			for (let j = 1; j < N; j++) {
				if (inRoute[j] || !validAt(node(j), t0 + (dep[p] + cost(prev, j)) / 60)) continue;
				consider(p, [j]);
			}
			for (const group of floors) {
				const block = bundle(p, group);
				if (block.length >= 2) considerBundle(p, block);
			}
			for (const group of buildings) {
				const block = trimFloors(p, bundle(p, group));
				if (block.length >= 2) considerBundle(p, block);
			}
		}

		if (!bestRoute) return false;
		route = bestRoute;
		total = bestTotal;
		for (const j of route) inRoute[j] = 1;
		return true;
	};

	const fill = (): boolean => {
		let any = false;
		while (insertOne()) any = true;
		return any;
	};

	/** Try to apply one improving 2-opt or or-opt (relocate) move. */
	const improveOnce = (): boolean => {
		const len = route.length;
		const accept = (cand: number[]) => {
			const t = simulate(cand);
			if (t < 0 || t >= total - EPS) return false;
			route = cand;
			total = t;
			return true;
		};

		// 2-opt: reverse route[i..k]. Room-to-room legs are symmetric.
		for (let i = 0; i < len - 1; i++) {
			const a = i === 0 ? 0 : route[i - 1];
			const b = route[i];
			for (let k = i + 1; k < len; k++) {
				const c = route[k];
				const d = k + 1 < len ? route[k + 1] : -1;
				const delta =
					cost(a, c) + (d >= 0 ? cost(b, d) : 0) - cost(a, b) - (d >= 0 ? cost(c, d) : 0);
				if (delta >= -EPS) continue;
				const cand = [
					...route.slice(0, i),
					...route.slice(i, k + 1).reverse(),
					...route.slice(k + 1)
				];
				if (accept(cand)) return true;
			}
		}

		// Or-opt: move a segment of 1-3 stops elsewhere.
		for (let s = 1; s <= 3; s++) {
			for (let i = 0; i + s <= len; i++) {
				const p = i === 0 ? 0 : route[i - 1];
				const f = route[i];
				const l = route[i + s - 1];
				const nx = i + s < len ? route[i + s] : -1;
				const gain = cost(p, f) + (nx >= 0 ? cost(l, nx) - cost(p, nx) : 0);
				const rest = [...route.slice(0, i), ...route.slice(i + s)];
				for (let q = 0; q <= rest.length; q++) {
					if (q === i) continue;
					const pq = q === 0 ? 0 : rest[q - 1];
					const nq = q < rest.length ? rest[q] : -1;
					const add = cost(pq, f) + (nq >= 0 ? cost(l, nq) - cost(pq, nq) : 0);
					if (add - gain >= -EPS) continue;
					const cand = [...rest.slice(0, q), ...route.slice(i, i + s), ...rest.slice(q)];
					if (accept(cand)) return true;
				}
			}
		}
		return false;
	};

	const improve = (): boolean => {
		let any = false;
		for (let m = 0; m < MAX_IMPROVING_MOVES && improveOnce(); m++) any = true;
		return any;
	};

	fill();
	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (!improve() || !fill()) break;
	}

	const stops: RouteStop[] = [];
	let t = 0;
	let prev = 0;
	for (const j of route) {
		const nd = node(j);
		const leg = prev === 0 ? startLegs[j - 1] : roomLeg(node(prev), nd);
		t += leg.seconds;
		const arrivalMinute = t0 + t / 60;
		const status = statusAt(nd.bookings, arrivalMinute);
		stops.push({
			room: nd.room,
			arrivalMinute,
			freeUntil: nd.room.dropIn ? null : status.until,
			walkSeconds: leg.seconds,
			stairs: leg.stairs,
			outdoors: leg.outdoors
		});
		t += VISIT_SECONDS;
		prev = j;
	}
	return { stops, totalSeconds: t };
}
