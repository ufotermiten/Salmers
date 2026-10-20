import type { Booking } from './types';

/** The two teaching blocks students actually plan around. */
export interface Block {
	name: 'förmiddagen' | 'eftermiddagen';
	start: number;
	end: number;
}

export const BLOCKS: Block[] = [
	{ name: 'förmiddagen', start: 8 * 60, end: 11 * 60 + 45 },
	{ name: 'eftermiddagen', start: 13 * 60 + 15, end: 17 * 60 }
];

/** The block the user is in, or the next one today (lunch counts towards the afternoon). */
export function relevantBlock(minute: number): Block | null {
	return BLOCKS.find((b) => minute < b.end) ?? null;
}

/** Free from now (or the block start, if later) until the block ends. */
export function freeThroughBlock(bookings: Booking[], minute: number, block: Block): boolean {
	const from = Math.max(minute, block.start);
	return !bookings.some((b) => b.start < block.end && b.end > from);
}
