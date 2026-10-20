import { SvelteSet } from 'svelte/reactivity';

/** Per-device room lists, persisted in localStorage. */
function persistedSet(key: string) {
	let initial: string[] = [];
	try {
		initial = JSON.parse(localStorage.getItem(key) ?? '[]');
	} catch {
		// No storage (private mode, tests): start empty.
	}
	const set = new SvelteSet<string>(initial);
	const save = () => {
		try {
			localStorage.setItem(key, JSON.stringify([...set]));
		} catch {
			// Ignore: the list still works for this session.
		}
	};
	return { set, save };
}

const fav = persistedSet('salmers:favorites');
const hid = persistedSet('salmers:hidden');

export const favorites = fav.set;
/** Blacklisted rooms: listed last and never routed. */
export const hidden = hid.set;

// A room is either a favorite or hidden, never both.
export function toggleFavorite(id: string) {
	if (favorites.has(id)) {
		favorites.delete(id);
	} else {
		favorites.add(id);
		if (hidden.delete(id)) hid.save();
	}
	fav.save();
}

export function toggleHidden(id: string) {
	if (hidden.has(id)) {
		hidden.delete(id);
	} else {
		hidden.add(id);
		if (favorites.delete(id)) fav.save();
	}
	hid.save();
}

const types = persistedSet('salmers:hiddenTypes');

/** Room types (Lektionssal, Datorsal, ...) the user never wants to see or route through. */
export const hiddenTypes = types.set;

export function toggleHiddenType(type: string) {
	if (!hiddenTypes.delete(type)) hiddenTypes.add(type);
	types.save();
}
