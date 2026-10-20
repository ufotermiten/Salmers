<script lang="ts">
	import { onMount } from 'svelte';
	import catalog from '#lib/data/rooms.json';
	import type { Booking, Room, RoomStatus, RoomType } from '#lib/types.ts';
	import { cachedDay, loadDay, type DayData } from '#lib/dayCache.ts';
	import { statusAt } from '#lib/schedule.ts';
	import { freeThroughBlock, relevantBlock } from '#lib/blocks.ts';
	import { favorites, hidden, hiddenTypes, toggleHiddenType } from '#lib/roomLists.svelte.ts';
	import { formatDateLabel, formatMinute, parseHHMM, stockholmNow } from '#lib/time.ts';
	import RoomCard from '#lib/components/RoomCard.svelte';
	import RoutePanel from '#lib/components/RoutePanel.svelte';

	const rooms = catalog.rooms as Room[];
	const TYPES: RoomType[] = ['Lektionssal', 'Hörsal', 'Datorsal', 'Studieplats'];
	const TYPE_LABELS: Record<RoomType, string> = {
		Lektionssal: 'Lektionssalar',
		Hörsal: 'Hörsalar',
		Datorsal: 'Datorsalar',
		Studieplats: 'Studieplatser (drop-in)'
	};

	const initial = stockholmNow();
	let now = $state(initial);
	let mode = $state<'now' | 'custom'>('now');
	let customDate = $state(initial.date);
	let customTime = $state(
		formatMinute(Math.min(Math.ceil((initial.minute + 1) / 15) * 15, 23 * 60 + 45))
	);

	let query = $state('');
	let activeTypes = $state<RoomType[]>([]);
	let showCategories = $state(false);

	// Hidden categories are gone everywhere: no chip, no list entry, no route stop.
	const visibleTypes = $derived(TYPES.filter((t) => !hiddenTypes.has(t)));
	const typeFilter = $derived(activeTypes.filter((t) => !hiddenTypes.has(t)));
	let onlyFavorites = $state(false);
	let showBusy = $state(false);
	let showHidden = $state(true);
	let view = $state<'list' | 'route'>('list');

	let day = $state<DayData | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	const date = $derived(mode === 'now' ? now.date : customDate);
	const minute = $derived(mode === 'now' ? now.minute : parseHHMM(customTime || '00:00'));

	interface Entry {
		room: Room;
		status: RoomStatus | null;
		bookings: Booking[];
		/** Set when the room is free for the rest of the relevant block, e.g. "Ledig hela eftermiddagen". */
		blockLabel: string | null;
	}

	const block = $derived(relevantBlock(minute));
	const blockPhrase = $derived(
		block ? `${minute <= block.start ? 'hela' : 'resten av'} ${block.name}` : null
	);

	const entries = $derived.by<Entry[]>(() => {
		const q = query.trim().toLowerCase();
		return rooms
			.filter((r) => !hiddenTypes.has(r.type))
			.filter((r) => typeFilter.length === 0 || typeFilter.includes(r.type))
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
				const wholeBlock =
					day && block && !room.dropIn && freeThroughBlock(bookings, minute, block);
				return {
					room,
					bookings,
					status: day ? statusAt(bookings, minute) : null,
					blockLabel: wholeBlock ? `Ledig ${blockPhrase}` : null
				};
			});
	});

	const freeLength = (e: Entry) =>
		e.status?.free ? (e.status.until ?? Infinity) - minute : -Infinity;
	const byName = (a: Entry, b: Entry) =>
		a.room.name.localeCompare(b.room.name, 'sv', { numeric: true });

	// Hidden (blacklisted) rooms only appear in their own section at the bottom.
	const visible = $derived(entries.filter((e) => !hidden.has(e.room.id)));
	const hiddenEntries = $derived(entries.filter((e) => hidden.has(e.room.id)).sort(byName));

	const favoriteEntries = $derived(
		onlyFavorites ? [] : visible.filter((e) => favorites.has(e.room.id)).sort(byName)
	);
	// Rooms free for the whole relevant block always rank above rooms that are only free a while.
	const wholeBlock = $derived(visible.filter((e) => e.blockLabel).sort(byName));
	const free = $derived(
		visible
			.filter((e) => !e.room.dropIn && e.status?.free && !e.blockLabel)
			.sort((a, b) => freeLength(b) - freeLength(a) || byName(a, b))
	);
	const busy = $derived(
		visible
			.filter((e) => !e.room.dropIn && e.status && !e.status.free && !e.blockLabel)
			.sort((a, b) => a.status!.until! - b.status!.until! || byName(a, b))
	);
	const dropIn = $derived(visible.filter((e) => e.room.dropIn).sort(byName));

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
		<div class="segmented view" role="tablist" aria-label="Vy">
			<button
				role="tab"
				aria-selected={view === 'list'}
				class:active={view === 'list'}
				onclick={() => (view = 'list')}>Lista</button
			>
			<button
				role="tab"
				aria-selected={view === 'route'}
				class:active={view === 'route'}
				onclick={() => (view = 'route')}>Rutt</button
			>
		</div>
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
		{#each visibleTypes as t (t)}
			<button class="chip" class:active={activeTypes.includes(t)} onclick={() => toggleType(t)}
				>{t}</button
			>
		{/each}
		<button
			class="chip ghost"
			class:active={showCategories}
			onclick={() => (showCategories = !showCategories)}
			aria-expanded={showCategories}
		>
			Kategorier{hiddenTypes.size ? ` (${hiddenTypes.size} dolda)` : ''}
		</button>
	</div>

	{#if showCategories}
		<fieldset class="categories">
			<legend>Visa kategorier</legend>
			{#each TYPES as t (t)}
				<label>
					<input
						type="checkbox"
						checked={!hiddenTypes.has(t)}
						onchange={() => toggleHiddenType(t)}
					/>
					{TYPE_LABELS[t]}
				</label>
			{/each}
			<p>
				Dolda kategorier visas inte i listan och tas inte med i rutter. Enskilda salar döljer du
				genom att öppna salen.
			</p>
		</fieldset>
	{/if}
</header>

<main>
	<p class="summary">
		{#if day}
			{#if block}
				<strong>{wholeBlock.length}</strong> lediga {blockPhrase}{free.length
					? `, ${free.length} en stund`
					: ''}
			{:else}
				<strong>{free.length}</strong> lediga
			{/if}
			{mode === 'now'
				? block
					? ''
					: 'just nu'
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

	{#if view === 'route'}
		<RoutePanel candidates={visible} allRooms={rooms} {minute} {block} ready={day !== null} />
	{:else}
		{#if favoriteEntries.length}
			<section>
				<h2>Favoriter</h2>
				{#each favoriteEntries as e (e.room.id)}
					<RoomCard {...e} {minute} />
				{/each}
			</section>
		{/if}

		{#if wholeBlock.length}
			<section>
				<h2>Lediga {blockPhrase}</h2>
				{#each wholeBlock as e (e.room.id)}
					<RoomCard {...e} {minute} />
				{/each}
			</section>
		{/if}

		{#if free.length}
			<section>
				<h2>{block ? 'Lediga en stund' : 'Lediga'}</h2>
				{#each free as e (e.room.id)}
					<RoomCard {...e} {minute} />
				{/each}
			</section>
		{:else if day && !loading && busy.length && !wholeBlock.length}
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

		{#if hiddenEntries.length}
			<section>
				<button
					class="toggle"
					onclick={() => (showHidden = !showHidden)}
					aria-expanded={showHidden}
				>
					<h2>Dolda salar ({hiddenEntries.length})</h2>
					<span>{showHidden ? 'Dölj' : 'Visa'}</span>
				</button>
				{#if showHidden}
					{#each hiddenEntries as e (e.room.id)}
						<RoomCard {...e} {minute} />
					{/each}
				{/if}
			</section>
		{/if}

		{#if !entries.length}
			<p class="empty">Inga salar matchar din sökning.</p>
		{/if}
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
		gap: 8px;
	}
	.view {
		margin-left: auto;
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
	.chip.ghost {
		border-style: dashed;
	}
	.categories {
		margin: 0;
		padding: 10px 12px 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		display: grid;
		gap: 8px;
	}
	.categories legend {
		padding: 0 4px;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.categories label {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
	}
	.categories input {
		width: 20px;
		height: 20px;
		min-height: 0;
		padding: 0;
		accent-color: var(--accent);
	}
	.categories p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
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
