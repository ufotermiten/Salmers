import { describe, expect, it } from 'vitest';
import { parseReservations, statusAt } from './schedule';
import { formatMinute, stockholmNow } from './time';

const headers = ['Kurskod', 'Rubrik', 'Kommentar', 'Aktivitet', 'Lokalnamn'];
const res = (
	startdate: string,
	starttime: string,
	enddate: string,
	endtime: string,
	rooms: string,
	code = ''
) => ({
	startdate,
	starttime,
	enddate,
	endtime,
	columns: [code, '', '', 'Föreläsning', rooms]
});

describe('parseReservations', () => {
	const idsByName = new Map([
		['HA1', ['1.4']],
		['HA2', ['2.4']]
	]);

	it('assigns shared bookings to every matching room and ignores unknown rooms', () => {
		const out = parseReservations(
			{
				columnheaders: headers,
				reservations: [
					res(
						'2026-10-21',
						'10:00',
						'2026-10-21',
						'11:45',
						'HA1, HA2, SB-H7',
						'TMA265_50_HT26_20131'
					)
				]
			},
			'2026-10-21',
			idsByName
		);
		expect(out.get('1.4')).toEqual([{ start: 600, end: 705, title: 'TMA265 · Föreläsning' }]);
		expect(out.get('2.4')).toHaveLength(1);
		expect(out.size).toBe(2);
	});

	it('clamps multi-day bookings to the requested day', () => {
		const out = parseReservations(
			{
				columnheaders: headers,
				reservations: [res('2026-10-20', '13:00', '2026-10-22', '09:00', 'HA1')]
			},
			'2026-10-21',
			idsByName
		);
		expect(out.get('1.4')?.[0]).toMatchObject({ start: 0, end: 1440 });
	});
});

describe('statusAt', () => {
	const bookings = [
		{ start: 480, end: 600, title: '' },
		{ start: 600, end: 720, title: '' },
		{ start: 900, end: 960, title: '' }
	];

	it('is free until the next booking', () => {
		expect(statusAt(bookings, 750)).toEqual({ free: true, until: 900 });
	});

	it('is free for the rest of the day after the last booking', () => {
		expect(statusAt(bookings, 1000)).toEqual({ free: true, until: null });
	});

	it('merges back-to-back bookings into one busy block', () => {
		expect(statusAt(bookings, 500)).toEqual({ free: false, until: 720 });
	});

	it('treats a booking end as free', () => {
		expect(statusAt(bookings, 720)).toEqual({ free: true, until: 900 });
	});
});

describe('stockholmNow', () => {
	it('converts UTC to Stockholm time across DST', () => {
		expect(stockholmNow(new Date('2026-10-20T11:30:00Z'))).toEqual({
			date: '2026-10-20',
			minute: 13 * 60 + 30
		});
		expect(stockholmNow(new Date('2026-12-31T23:30:00Z'))).toEqual({
			date: '2027-01-01',
			minute: 30
		});
	});
});

describe('formatMinute', () => {
	it('rounds fractional minutes', () => {
		expect(formatMinute(14 * 60 + 34.61)).toBe('14:35');
	});
});
