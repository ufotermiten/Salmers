<script lang="ts">
	import { onMount } from 'svelte';
	import catalog from '#lib/data/rooms.json';
	import type { Booking, Room, RoomStatus, RoomType } from '#lib/types.ts';
	import { cachedDay, loadDay, type DayData } from '#lib/dayCache.ts';
	import { statusAt } from '#lib/schedule.ts';
	import { favorites } from '#lib/favorites.svelte.ts';
	import { formatDateLabel, formatMinute, parseHHMM, stockholmNow } from '#lib/time.ts';
	import RoomCard from '#lib/components/RoomCard.svelte';

	const rooms = catalog.rooms as Room[];
	const TYPES: RoomType[] = ['Lektionssal', 'Hörsal', 'Datorsal', 'Studieplats'];

	const initial = stockholmNow();
	let now = $state(initial);
	let mode = $state<'now' | 'custom'>('now');
	let customDate = $state(initial.date);
	let customTime = $state(
		formatMinute(Math.min(Math.ceil((initial.minute + 1) / 15) * 15, 23 * 60 + 45))
	);

	let query = $state('');
	let activeTypes = $state<RoomType[]>([]);
	let onlyFavorites = $state(false);
	let showBusy = $state(false);

	let day = $state<DayData | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	const date = $derived(mode === 'now' ? now.date : customDate);
	const minute = $derived(mode === 'now' ? now.minute : parseHHMM(customTime || '00:00'));

	interface Entry {
		room: Room;
		status: RoomStatus | null;
		bookings: Booking[];
	}

	const entries = $derived.by<Entry[]>(() => {
		const q = query.trim().toLowerCase();
		return rooms
			.filter((r) => activeTypes.length === 0 || activeTypes.includes(r.type))
			.filter((r) => !onlyFavorites || favorites.has(r.id))
			.filter(
				(r) =>
					!q ||
					r.name.toLowerCase().includes(q) ||
					r.building?.toLowerCase().includes(q) ||
					r.roomNumber?.toLowerCase().includes(q)
			)
			.map((room) => {
				const bookings = day?.bookings.get(room.id) ?? [];
				return { room, bookings, status: day ? statusAt(bookings, minute) : null };
			});
	});

	const freeLength = (e: Entry) =>
		e.status?.free ? (e.status.until ?? Infinity) - minute : -Infinity;
	const byName = (a: Entry, b: Entry) =>
		a.room.name.localeCompare(b.room.name, 'sv', { numeric: true });

	const favoriteEntries = $derived(
		onlyFavorites ? [] : entries.filter((e) => favorites.has(e.room.id)).sort(byName)
	);
	const free = $derived(
		entries
			.filter((e) => !e.room.dropIn && e.status?.free)
			.sort((a, b) => freeLength(b) - freeLength(a) || byName(a, b))
	);
	const busy = $derived(
		entries
			.filter((e) => !e.room.dropIn && e.status && !e.status.free)
			.sort((a, b) => a.status!.until! - b.status!.until! || byName(a, b))
	);
	const dropIn = $derived(entries.filter((e) => e.room.dropIn).sort(byName));

	async function refresh(force = false) {
		const target = date;
		day = cachedDay(target);
		loading = true;
		error = null;
		try {
			const data = await loadDay(target, rooms, force);
			if (target === date) day = data;
		} catch (e) {
			error = day
				? 'Kunde inte uppdatera – visar sparad data.'
				: 'Kunde inte hämta schemat från TimeEdit. Kontrollera din anslutning.';
			console.error(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void date;
		refresh();
	});

	onMount(() => {
		const tick = setInterval(() => (now = stockholmNow()), 30_000);
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			now = stockholmNow();
			refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	function toggleType(t: RoomType) {
		activeTypes = activeTypes.includes(t)
			? activeTypes.filter((x) => x !== t)
			: [...activeTypes, t];
	}

	const updatedLabel = $derived(
		day
			? new Date(day.fetchedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
			: null
	);
</script>

<svelte:head>
	<title>Salmers – lediga salar på Chalmers</title>
</svelte:head>

<header>
	<div class="top">
		<h1>Salmers</h1>
		<button class="refresh" onclick={() => refresh(true)} disabled={loading} aria-label="Uppdatera">
			<svg class:spin={loading} viewBox="0 0 24 24" aria-hidden="true">
				<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
			</svg>
		</button>
	</div>

	<div class="when">
		<div class="segmented" role="group" aria-label="Tid">
			<button class:active={mode === 'now'} onclick={() => (mode = 'now')}>Nu</button>
			<button class:active={mode === 'custom'} onclick={() => (mode = 'custom')}>Välj tid</button>
		</div>
		{#if mode === 'custom'}
			<input type="date" bind:value={customDate} aria-label="Datum" />
			<input type="time" bind:value={customTime} step="900" aria-label="Klockslag" />
		{:else}
			<span class="clock">{formatMinute(now.minute)}</span>
		{/if}
	</div>

	<input class="search" type="search" placeholder="Sök sal eller hus" bind:value={query} />

	<div class="chips">
		<button
			class="chip"
			class:active={onlyFavorites}
			onclick={() => (onlyFavorites = !onlyFavorites)}
		>
			★ Favoriter
		</button>
		{#each TYPES as t (t)}
			<button class="chip" class:active={activeTypes.includes(t)} onclick={() => toggleType(t)}
				>{t}</button
			>
		{/each}
	</div>
</header>

<main>
	<p class="summary">
		{#if day}
			<strong>{free.length}</strong> lediga {mode === 'now'
				? 'just nu'
				: `${formatDateLabel(date, now.date).toLowerCase()} kl ${formatMinute(minute)}`}
			<span class="updated">· uppdaterat {updatedLabel}</span>
		{:else if loading}
			Hämtar schema…
		{/if}
	</p>

	{#if error}
		<p class="error" role="alert">
			{error}
			<button onclick={() => refresh(true)}>Försök igen</button>
		</p>
	{/if}

	{#if favoriteEntries.length}
		<section>
			<h2>Favoriter</h2>
			{#each favoriteEntries as e (e.room.id)}
				<RoomCard {...e} {minute} />
			{/each}
		</section>
	{/if}

	{#if free.length}
		<section>
			<h2>Lediga</h2>
			{#each free as e (e.room.id)}
				<RoomCard {...e} {minute} />
			{/each}
		</section>
	{:else if day && !loading && busy.length}
		<p class="empty">Inga lediga salar matchar just nu.</p>
	{/if}

	{#if busy.length}
		<section>
			<button class="toggle" onclick={() => (showBusy = !showBusy)} aria-expanded={showBusy}>
				<h2>Upptagna ({busy.length})</h2>
				<span>{showBusy ? 'Dölj' : 'Visa'}</span>
			</button>
			{#if showBusy}
				{#each busy as e (e.room.id)}
					<RoomCard {...e} {minute} />
				{/each}
			{/if}
		</section>
	{/if}

	{#if dropIn.length}
		<section>
			<h2>Studieplatser (drop-in)</h2>
			{#each dropIn as e (e.room.id)}
				<RoomCard {...e} {minute} />
			{/each}
		</section>
	{/if}

	{#if !entries.length}
		<p class="empty">Inga salar matchar din sökning.</p>
	{/if}

	<footer>Data från TimeEdit och Chalmers karta. Bokningar kan ändras – inofficiell app.</footer>
</main>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--bg);
		padding: calc(env(safe-area-inset-top) + 12px) 16px 10px;
		display: grid;
		gap: 10px;
		border-bottom: 1px solid var(--border);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		letter-spacing: -0.02em;
		color: var(--accent);
	}
	.refresh {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 0;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.refresh svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.spin {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.when {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.segmented {
		display: inline-flex;
		background: var(--surface-2);
		border-radius: 10px;
		padding: 3px;
	}
	.segmented button {
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		font-weight: 550;
		padding: 7px 14px;
		border-radius: 8px;
		cursor: pointer;
	}
	.segmented button.active {
		background: var(--surface);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.clock {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	input {
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 8px 10px;
		min-height: 40px;
	}
	.search {
		width: 100%;
	}
	.chips {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0 -16px;
		padding: 0 16px;
	}
	.chip {
		flex: none;
		font: inherit;
		font-size: 0.88rem;
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.chip.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	main {
		padding: 12px 16px calc(env(safe-area-inset-bottom) + 24px);
		display: grid;
		gap: 18px;
		max-width: 720px;
		margin: 0 auto;
	}
	.summary {
		margin: 0;
		color: var(--text);
	}
	.updated {
		color: var(--muted);
		font-size: 0.85rem;
	}
	section {
		display: grid;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}
	.error {
		margin: 0;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--busy-soft);
		color: var(--text);
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
	}
	.error button {
		font: inherit;
		border: 0;
		background: none;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
	}
	.empty {
		margin: 0;
		color: var(--muted);
	}
	footer {
		color: var(--muted);
		font-size: 0.78rem;
		text-align: center;
	}
</style>
