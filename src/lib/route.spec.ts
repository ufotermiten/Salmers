import { describe, expect, it } from 'vitest';
import { MAX_SECONDS_PER_ROOM, planRoute, type RouteOptions } from './route';
import type { Booking, Room } from './types';

const LAT = 57.689;
const LNG = 11.977;
/** dy in units of 0.0001° lat (≈11 m), dx in units of 0.0001° lng (≈6 m). */
const at = (dy: number, dx: number) => ({ lat: LAT + dy * 1e-4, lng: LNG + dx * 1e-4 });

interface Opts {
	dy: number;
	dx?: number;
	buildingId?: string | null;
	level?: number | null;
	entrance?: { dy: number; dx?: number } | null;
	entranceLevel?: number | null;
	dropIn?: boolean;
}

function mk(id: string, o: Opts): Room {
	const p = at(o.dy, o.dx ?? 0);
	const e = o.entrance === undefined ? p : o.entrance && at(o.entrance.dy, o.entrance.dx ?? 0);
	return {
		id,
		name: id,
		type: 'Lektionssal',
		building: null,
		floor: null,
		roomNumber: null,
		mapsId: null,
		lat: p.lat,
		lng: p.lng,
		seats: null,
		equipment: [],
		buildingId: o.buildingId === undefined ? id : o.buildingId,
		entranceLat: e ? e.lat : null,
		entranceLng: e ? e.lng : null,
		level: o.level === undefined ? 1 : o.level,
		entranceLevel: o.entranceLevel === undefined ? 1 : o.entranceLevel,
		dropIn: o.dropIn ?? false
	};
}

const free = (room: Room, bookings: Booking[] = []) => ({ room, bookings });
const opts = (o: Partial<RouteOptions> = {}): RouteOptions => ({
	start: at(0, 0),
	startMinute: 600,
	budgetMinutes: 30,
	...o
});
const ids = (plan: ReturnType<typeof planRoute>) => plan.stops.map((s) => s.room.id);

/** Building A next to the start (3 ground-floor rooms), building X 44 m further with level-5 rooms. */
function flScenario(upstairs: number) {
	const a = { buildingId: 'A', entrance: { dy: 2 }, level: 1, entranceLevel: 1 };
	const x = { buildingId: 'X', entrance: { dy: 6 }, level: 5, entranceLevel: 1 };
	return [
		free(mk('A1', { ...a, dy: 3, dx: 0 })),
		free(mk('A2', { ...a, dy: 3, dx: 2 })),
		free(mk('A3', { ...a, dy: 3, dx: 4 })),
		...Array.from({ length: upstairs }, (_, i) =>
			free(mk(`FL${i + 1}`, { ...x, dy: 6.5, dx: i * 1.5 }))
		)
	];
}

describe('planRoute', () => {
	it('returns an empty plan without candidates', () => {
		expect(planRoute([], opts())).toEqual({ stops: [], totalSeconds: 0 });
	});

	it('visits nearby rooms in walking order', () => {
		const plan = planRoute(
			[free(mk('c', { dy: 6 })), free(mk('a', { dy: 2 })), free(mk('b', { dy: 4 }))],
			opts()
		);
		expect(ids(plan)).toEqual(['a', 'b', 'c']);
		expect(plan.stops[0].outdoors).toBe(true);
		expect(plan.stops[1].arrivalMinute).toBeGreaterThan(plan.stops[0].arrivalMinute);
	});

	it('respects the time budget', () => {
		const rooms = Array.from({ length: 10 }, (_, i) => free(mk(`r${i}`, { dy: 3 * (i + 1) })));
		const plan = planRoute(rooms, opts({ budgetMinutes: 3 }));
		expect(plan.totalSeconds).toBeLessThanOrEqual(180);
		expect(ids(plan)).toEqual(['r0', 'r1']);
	});

	it('takes part of a far bundle when the whole bundle does not fit the budget', () => {
		// One room next to the start uses up the discounted approach; building B is ~200 m further
		// with twelve rooms on one floor, far more than an 8-minute budget can cover.
		const b = { buildingId: 'B', entrance: { dy: 20 }, level: 1, entranceLevel: 1 };
		const rooms = [
			free(mk('A1', { dy: 2 })),
			...Array.from({ length: 12 }, (_, i) => free(mk(`B${i}`, { ...b, dy: 21, dx: i * 2 })))
		];
		const plan = planRoute(rooms, opts({ budgetMinutes: 8 }));
		const inB = ids(plan).filter((id) => id.startsWith('B')).length;
		expect(inB).toBeGreaterThanOrEqual(2);
		expect(inB).toBeLessThan(12);
		expect(plan.totalSeconds).toBeLessThanOrEqual(480);
	});

	it('skips a single room up the stairs but climbs for a floor of four', () => {
		const one = planRoute(flScenario(1), opts());
		expect(ids(one).sort()).toEqual(['A1', 'A2', 'A3']);

		const four = planRoute(flScenario(4), opts());
		expect(ids(four).sort()).toEqual(['A1', 'A2', 'A3', 'FL1', 'FL2', 'FL3', 'FL4']);
		const climb = four.stops.find((s) => s.room.id.startsWith('FL') && s.stairs > 0);
		expect(climb?.stairs).toBe(4);
		// Each added room stays below the worthiness threshold on average.
		expect((four.totalSeconds - one.totalSeconds) / 4).toBeLessThanOrEqual(MAX_SECONDS_PER_ROOM);
	});

	it('climbs for a single room when the worthiness threshold is off', () => {
		const plan = planRoute(flScenario(1), opts({ maxSecondsPerRoom: Infinity }));
		expect(ids(plan)).toContain('FL1');
	});

	it('skips a lone upper-floor room in the same building as ground-floor rooms', () => {
		const fysik = (id: string, dx: number, level: number) =>
			free(mk(id, { buildingId: 'F', entrance: { dy: 2 }, entranceLevel: 1, dy: 3, dx, level }));
		const ground = [fysik('F1', 0, 1), fysik('F2', 2, 1), fysik('F3', 4, 1)];

		const one = planRoute([...ground, fysik('FL1', 1, 5)], opts());
		expect(ids(one).sort()).toEqual(['F1', 'F2', 'F3']);

		const four = planRoute(
			[...ground, ...[1, 2, 3, 4].map((i) => fysik(`FL${i}`, i * 1.5, 5))],
			opts()
		);
		expect(four.stops).toHaveLength(7);
	});

	it('excludes rooms booked on arrival or within minFreeMinutes of it', () => {
		const plan = planRoute(
			[
				free(mk('free', { dy: 2 })),
				free(mk('bookedNow', { dy: 2, dx: 3 }), [{ start: 590, end: 650, title: '' }]),
				free(mk('soonBooked', { dy: 3 }), [{ start: 610, end: 700, title: '' }]),
				free(mk('laterBooked', { dy: 3, dx: 3 }), [{ start: 660, end: 720, title: '' }])
			],
			opts()
		);
		expect(ids(plan).sort()).toEqual(['free', 'laterBooked']);
		expect(plan.stops.find((s) => s.room.id === 'laterBooked')?.freeUntil).toBe(660);
		expect(plan.stops.find((s) => s.room.id === 'free')?.freeUntil).toBeNull();
	});

	it('includes a room that becomes free before the walk reaches it', () => {
		const a = { buildingId: 'A', entrance: { dy: 2 } };
		const plan = planRoute(
			[
				free(mk('A1', { ...a, dy: 3, dx: 0 })),
				free(mk('A2', { ...a, dy: 3, dx: 2 })),
				free(mk('A3', { ...a, dy: 3, dx: 4 })),
				free(mk('L', { dy: 4 }), [{ start: 540, end: 602, title: '' }])
			],
			opts()
		);
		const late = plan.stops.find((s) => s.room.id === 'L');
		expect(late).toBeDefined();
		expect(late!.arrivalMinute).toBeGreaterThanOrEqual(602);
	});

	it('with freeThrough, only keeps rooms free from arrival to the end of the block', () => {
		const block = { from: 600, until: 705 };
		const plan = planRoute(
			[
				free(mk('ok', { dy: 2 })),
				free(mk('bookedLater', { dy: 3 }), [{ start: 660, end: 720, title: '' }]),
				free(mk('bookedBefore', { dy: 4 }), [{ start: 480, end: 590, title: '' }])
			],
			opts({ startMinute: 600, freeThrough: block })
		);
		expect(ids(plan).sort()).toEqual(['bookedBefore', 'ok']);
	});

	it('with freeThrough before the block starts, ignores bookings until it does', () => {
		const plan = planRoute(
			[free(mk('lunchBooked', { dy: 2 }), [{ start: 720, end: 780, title: '' }])],
			opts({ startMinute: 750, freeThrough: { from: 795, until: 1020 } })
		);
		expect(ids(plan)).toEqual(['lunchBooked']);
	});

	it('with anyArrival, visits every candidate regardless of later bookings', () => {
		const plan = planRoute(
			[
				free(mk('a', { dy: 2 })),
				free(mk('bookedSoon', { dy: 3 }), [{ start: 605, end: 700, title: '' }])
			],
			opts({
				startMinute: 600,
				budgetMinutes: Infinity,
				maxSecondsPerRoom: Infinity,
				anyArrival: true
			})
		);
		expect(ids(plan).sort()).toEqual(['a', 'bookedSoon']);
	});

	it('treats drop-in rooms as always available', () => {
		const plan = planRoute(
			[free(mk('d', { dy: 2, dropIn: true }), [{ start: 0, end: 1440, title: '' }])],
			opts()
		);
		expect(ids(plan)).toEqual(['d']);
		expect(plan.stops[0].freeUntil).toBeNull();
	});

	it('routes rooms with missing metadata and drops rooms without coordinates', () => {
		const noCoords = { ...mk('noCoords', { dy: 1, dropIn: true }), lat: null, lng: null };
		const plan = planRoute(
			[
				free(
					mk('n1', { dy: 2, buildingId: null, level: null, entrance: null, entranceLevel: null })
				),
				free(mk('n2', { dy: 3, buildingId: 'B', level: null, entranceLevel: null })),
				free(mk('n3', { dy: 3, dx: 2, buildingId: 'B', level: 2, entranceLevel: null })),
				free(noCoords)
			],
			opts()
		);
		expect(ids(plan).sort()).toEqual(['n1', 'n2', 'n3']);
		expect(Number.isFinite(plan.totalSeconds)).toBe(true);
		for (const s of plan.stops) expect(Number.isFinite(s.walkSeconds)).toBe(true);
	});

	/** 150 rooms in 12 buildings over up to six floors, 40 % with a 90-minute booking. */
	function campus() {
		let seed = 42;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		return Array.from({ length: 150 }, (_, i) => {
			const b = i % 12;
			const room = mk(`r${String(i).padStart(3, '0')}`, {
				dy: (b % 4) * 8 + rand() * 3,
				dx: Math.floor(b / 4) * 12 + rand() * 6,
				buildingId: `B${b}`,
				entrance: { dy: (b % 4) * 8, dx: Math.floor(b / 4) * 12 },
				level: Math.floor(rand() * 6),
				entranceLevel: 1
			});
			const start = 540 + Math.floor(rand() * 240);
			const bookings: Booking[] = rand() < 0.4 ? [{ start, end: start + 90, title: '' }] : [];
			return { room, bookings };
		});
	}

	it('is deterministic and fast for 150 candidates', () => {
		const candidates = campus();
		const options = opts({ budgetMinutes: 45 });

		const t = performance.now();
		const first = planRoute(candidates, options);
		const elapsed = performance.now() - t;
		const second = planRoute([...candidates].reverse(), options);

		expect(ids(first)).toEqual(ids(second));
		expect(first.stops.length).toBeGreaterThan(10);
		expect(first.totalSeconds).toBeLessThanOrEqual(45 * 60);
		expect(elapsed).toBeLessThan(500);
	});

	it('without a budget, keeps going while rooms are worth it and stays fast', () => {
		const candidates = campus();
		const t = performance.now();
		const plan = planRoute(candidates, opts({ budgetMinutes: Infinity }));
		const elapsed = performance.now() - t;

		expect(plan.stops.length).toBeGreaterThan(
			planRoute(candidates, opts({ budgetMinutes: 45 })).stops.length
		);
		expect(Number.isFinite(plan.totalSeconds)).toBe(true);
		expect(elapsed).toBeLessThan(1000);
	});

	it('still skips a lone room up the stairs without a budget', () => {
		const plan = planRoute(flScenario(1), opts({ budgetMinutes: Infinity }));
		expect(ids(plan)).not.toContain('FL1');
		expect(ids(plan)).toEqual(expect.arrayContaining(['A1', 'A2', 'A3']));
	});
});
