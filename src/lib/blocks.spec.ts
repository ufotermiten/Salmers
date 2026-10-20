import { describe, expect, it } from 'vitest';
import { BLOCKS, freeThroughBlock, relevantBlock } from './blocks';

const [morning, afternoon] = BLOCKS;
const booking = (start: string, end: string) => {
	const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
	return { start: m(start), end: m(end), title: '' };
};

describe('relevantBlock', () => {
	it('picks the current block, or the next one before it starts', () => {
		expect(relevantBlock(7 * 60)).toBe(morning);
		expect(relevantBlock(10 * 60)).toBe(morning);
		expect(relevantBlock(12 * 60)).toBe(afternoon); // lunch
		expect(relevantBlock(16 * 60 + 59)).toBe(afternoon);
		expect(relevantBlock(17 * 60)).toBeNull();
	});
});

describe('freeThroughBlock', () => {
	it('requires no booking from now to the end of the block', () => {
		expect(freeThroughBlock([], 9 * 60, morning)).toBe(true);
		expect(freeThroughBlock([booking('10:00', '12:00')], 9 * 60, morning)).toBe(false);
	});

	it('ignores bookings that are already over', () => {
		expect(freeThroughBlock([booking('08:00', '10:00')], 10 * 60 + 15, morning)).toBe(true);
	});

	it('during lunch, looks at the whole afternoon and ignores lunch bookings', () => {
		expect(freeThroughBlock([booking('12:00', '13:00')], 12 * 60 + 30, afternoon)).toBe(true);
		expect(freeThroughBlock([booking('15:00', '17:00')], 12 * 60 + 30, afternoon)).toBe(false);
	});
});
