import { SvelteSet } from 'svelte/reactivity';

const KEY = 'salmers:favorites';

function load(): string[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return [];
	}
}

export const favorites = new SvelteSet<string>(typeof localStorage === 'undefined' ? [] : load());

export function toggleFavorite(id: string) {
	if (favorites.has(id)) favorites.delete(id);
	else favorites.add(id);
	try {
		localStorage.setItem(KEY, JSON.stringify([...favorites]));
	} catch {
		// Ignore: favorites still work for this session.
	}
}
