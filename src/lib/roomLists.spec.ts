import { describe, expect, it } from 'vitest';
import { favorites, hidden, toggleFavorite, toggleHidden } from './roomLists.svelte';

describe('room lists', () => {
	it('keeps a room in at most one of favorites and hidden', () => {
		toggleFavorite('1.4');
		expect(favorites.has('1.4')).toBe(true);

		toggleHidden('1.4');
		expect(hidden.has('1.4')).toBe(true);
		expect(favorites.has('1.4')).toBe(false);

		toggleFavorite('1.4');
		expect(favorites.has('1.4')).toBe(true);
		expect(hidden.has('1.4')).toBe(false);

		toggleFavorite('1.4');
		expect(favorites.has('1.4')).toBe(false);
	});
});
