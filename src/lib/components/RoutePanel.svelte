<script lang="ts">
	import type { Booking, Room } from '#lib/types.ts';
	import type { Block } from '#lib/blocks.ts';
	import { planRoute, type RoutePlan } from '#lib/route.ts';
	import { CAMPUS_CENTER, distanceMeters, getPosition, resolveStart } from '#lib/location.ts';
	import { formatMinute } from '#lib/time.ts';
	import { favorites } from '#lib/roomLists.svelte.ts';
	import { routeSettings as rs } from '#lib/routeSettings.svelte.ts';
	import RouteMap from './RouteMap.svelte';

	interface Props {
		candidates: { room: Room; bookings: Booking[] }[];
		allRooms: Room[];
		minute: number;
		/** Relevant teaching block; when set, only rooms free until it ends are routed. */
		block: Block | null;
		ready: boolean;
	}

	let { candidates, allRooms, minute, block, ready }: Props = $props();

	const BUDGETS: (number | null)[] = [5, 10, 15, 20, null];
	const FAR_FROM_CAMPUS_M = 2500;
	/** Beyond this a fix can't even tell buildings apart (typically "approximate location"). */
	const TOO_VAGUE_M = 300;

	let locating = $state(false);
	let locationError = $state<string | null>(null);

	/** One start point per building, at its entrance when known. */
	const buildings = $derived.by(() => {
		const byName = new Map<string, { lat: number; lng: number }>();
		for (const r of allRooms) {
			const lat = r.entranceLat ?? r.lat;
			const lng = r.entranceLng ?? r.lng;
			if (r.building && lat !== null && lng !== null && !byName.has(r.building)) {
				byName.set(r.building, { lat, lng });
			}
		}
		return [...byName].sort(([a], [b]) => a.localeCompare(b, 'sv'));
	});

	const routed = $derived(
		rs.favoritesOnly ? candidates.filter((c) => favorites.has(c.room.id)) : candidates
	);

	const plan = $derived<RoutePlan | null>(
		rs.start && ready && routed.length
			? planRoute(routed, {
					start: rs.start,
					startMinute: minute,
					budgetMinutes: rs.budget ?? Infinity,
					freeThrough: block ? { from: block.start, until: block.end } : undefined,
					// Favorites were picked by hand: visit every one that fits, stairs or not.
					maxSecondsPerRoom: rs.favoritesOnly ? Infinity : undefined
				})
			: null
	);

	async function useMyLocation() {
		locating = true;
		locationError = null;
		try {
			const pos = await getPosition();
			if (pos.approximate || pos.accuracy > TOO_VAGUE_M) {
				locationError = `Bara ungefärlig plats (±${Math.round(pos.accuracy)} m). Ge appen tillgång till exakt plats i telefonens inställningar, eller välj hus i listan.`;
				return;
			}
			if (distanceMeters(pos, CAMPUS_CENTER) > FAR_FROM_CAMPUS_M) {
				locationError = 'Du verkar inte vara på Johanneberg. Välj en startpunkt i listan.';
				return;
			}
			const s = resolveStart(pos, buildings);
			rs.start = { lat: s.lat, lng: s.lng, label: s.building ?? 'Din plats' };
			rs.pickedBuilding = s.building ?? '';
			rs.gpsAccuracy = Math.round(pos.accuracy);
		} catch (e) {
			locationError = (e as Error).message;
		} finally {
			locating = false;
		}
	}

	function pickBuilding() {
		const hit = buildings.find(([name]) => name === rs.pickedBuilding);
		if (hit) {
			rs.start = { ...hit[1], label: hit[0] };
			rs.gpsAccuracy = null;
			locationError = null;
		}
	}

	const minutesLabel = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;
	const stairsLabel = (n: number) => (n === 0 ? '' : n === 1 ? '1 trappa' : `${n} trappor`);
</script>

<section class="panel">
	<div class="controls">
		<button class="primary" onclick={useMyLocation} disabled={locating}>
			{locating
				? 'Hämtar plats…'
				: rs.gpsAccuracy !== null
					? 'Uppdatera min plats'
					: 'Starta från min plats'}
		</button>
		<select bind:value={rs.pickedBuilding} onchange={pickBuilding} aria-label="Välj startpunkt">
			<option value="">…eller välj hus</option>
			{#each buildings as [name] (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
	</div>

	<div class="budget" role="group" aria-label="Hur lång runda">
		<span>Max</span>
		{#each BUDGETS as b (b)}
			<button class="chip" class:active={rs.budget === b} onclick={() => (rs.budget = b)}
				>{b === null ? 'Ingen gräns' : `${b} min`}</button
			>
		{/each}
	</div>

	<div class="budget">
		<button
			class="chip"
			class:active={rs.favoritesOnly}
			onclick={() => (rs.favoritesOnly = !rs.favoritesOnly)}
			aria-pressed={rs.favoritesOnly}
		>
			★ Endast favoriter
		</button>
	</div>

	{#if block}
		<p class="note">
			Bara salar som är lediga {minute <= block.start ? 'hela' : 'resten av'}
			{block.name} (till {formatMinute(block.end)}) tas med.
		</p>
	{/if}

	{#if rs.gpsAccuracy !== null && rs.start && !locationError}
		<p class="note">
			{rs.start.label === 'Din plats'
				? `Din plats, noggrannhet ±${rs.gpsAccuracy} m.`
				: `Platsen är osäker (±${rs.gpsAccuracy} m), så rutten startar vid närmaste hus. Byt hus i listan om det blev fel.`}
		</p>
	{/if}

	{#if locationError}
		<p class="note error" role="alert">{locationError}</p>
	{/if}

	{#if !rs.start}
		<p class="note">
			Rutten går förbi så många lediga salar som möjligt inom vald tid. Trappor och promenader
			utomhus kostar, så en våning med bara en ledig sal hoppas över medan en våning full av lediga
			salar är värd trapporna.
		</p>
	{:else if !ready}
		<p class="note">Hämtar schema…</p>
	{:else if rs.favoritesOnly && !routed.length}
		<p class="note">
			Inga favoriter att gå förbi. Stjärnmarkera salar i listan, eller stäng av "Endast favoriter".
		</p>
	{:else if plan && plan.stops.length === 0}
		<p class="note">
			Inga lediga {rs.favoritesOnly ? 'favoriter' : 'salar'}
			{rs.budget === null ? 'värda att gå till' : `inom ${rs.budget} min`} från {rs.start.label.toLowerCase()}.
			{rs.budget === null ? '' : 'Prova en längre runda.'}
		</p>
	{:else if plan}
		<p class="summary">
			<strong>{plan.stops.length} {plan.stops.length === 1 ? 'sal' : 'salar'}</strong> på ca {minutesLabel(
				plan.totalSeconds
			)} från {rs.start.label}
		</p>
		<RouteMap start={rs.start} stops={plan.stops} />
		<ol class="stops">
			{#each plan.stops as s, i (s.room.id)}
				<li>
					<span class="num">{i + 1}</span>
					<div class="body">
						<span class="name">{s.room.name}</span>
						<span class="meta">
							{[s.room.building, s.room.floor && `vån ${s.room.floor}`].filter(Boolean).join(' · ')}
						</span>
						<span class="leg">
							{minutesLabel(s.walkSeconds)}{s.outdoors ? ' utomhus' : ''}{stairsLabel(s.stairs)
								? ` · ${stairsLabel(s.stairs)}`
								: ''} · framme {formatMinute(s.arrivalMinute)}
						</span>
					</div>
					<span class="free">
						{s.room.dropIn
							? 'Drop-in'
							: s.freeUntil === null
								? 'Ledig resten av dagen'
								: `Ledig till ${formatMinute(s.freeUntil)}`}
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.panel {
		display: grid;
		gap: 12px;
	}
	.controls {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}
	.primary {
		font: inherit;
		font-weight: 600;
		min-height: 44px;
		border-radius: 12px;
		border: 0;
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.7;
	}
	select {
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 8px 10px;
		min-height: 40px;
	}
	.budget {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		color: var(--muted);
		font-size: 0.88rem;
	}
	.chip {
		font: inherit;
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
	.note {
		margin: 0;
		color: var(--muted);
		font-size: 0.92rem;
	}
	.note.error {
		color: var(--busy);
	}
	.summary {
		margin: 0;
	}
	.stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.stops li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		align-items: start;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 12px 14px;
	}
	.num {
		grid-row: span 2;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 700;
		font-size: 0.9rem;
	}
	.body {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-weight: 650;
	}
	.meta,
	.leg {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.free {
		grid-column: 2;
		color: var(--free);
		font-size: 0.88rem;
		font-weight: 550;
	}
</style>
