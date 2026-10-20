import { describe, expect, it } from 'vitest';
import { resolveStart } from './location';

// ~0.0001° latitude ≈ 11 m.
const ED = { lat: 57.6882, lng: 11.9794 };
const HC = { lat: 57.6895, lng: 11.9794 };
const buildings: [string, { lat: number; lng: number }][] = [
	['ED-blocket', ED],
	['Hörsalslängan', HC]
];
const pos = (dLat: number, accuracy: number) => ({
	lat: ED.lat + dLat,
	lng: ED.lng,
	accuracy,
	approximate: false
});

describe('resolveStart', () => {
	it('keeps a precise fix as is', () => {
		expect(resolveStart(pos(0.0003, 10), buildings)).toEqual({
			building: null,
			lat: ED.lat + 0.0003,
			lng: ED.lng
		});
	});

	it('snaps a vague fix to the nearest building within reach', () => {
		expect(resolveStart(pos(0.0003, 60), buildings)).toMatchObject({
			building: 'ED-blocket',
			...ED
		});
	});

	it('does not snap to a building far outside the error radius', () => {
		expect(resolveStart(pos(-0.005, 60), buildings).building).toBeNull();
	});
});
