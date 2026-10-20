<script lang="ts">
	import type { Booking, Room } from '#lib/types.ts';
	import { planRoute, type RoutePlan } from '#lib/route.ts';
	import { CAMPUS_CENTER, distanceMeters, getPosition, type Position } from '#lib/location.ts';
	import { formatMinute } from '#lib/time.ts';
	import RouteMap from './RouteMap.svelte';

	interface Props {
		candidates: { room: Room; bookings: Booking[] }[];
		allRooms: Room[];
		minute: number;
		ready: boolean;
	}

	let { candidates, allRooms, minute, ready }: Props = $props();

	const BUDGETS = [5, 10, 15, 20];
	const FAR_FROM_CAMPUS_M = 2500;

	let budget = $state(10);
	let start = $state<{ lat: number; lng: number; label: string } | null>(null);
	let locating = $state(false);
	let locationError = $state<string | null>(null);
	let pickedBuilding = $state('');

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

	const plan = $derived<RoutePlan | null>(
		start && ready
			? planRoute(candidates, { start, startMinute: minute, budgetMinutes: budget })
			: null
	);

	async function useMyLocation() {
		locating = true;
		locationError = null;
		try {
			const pos: Position = await getPosition();
			if (distanceMeters(pos, CAMPUS_CENTER) > FAR_FROM_CAMPUS_M) {
				locationError = 'Du verkar inte vara på Johanneberg. Välj en startpunkt i listan.';
				return;
			}
			start = { lat: pos.lat, lng: pos.lng, label: 'Din plats' };
			pickedBuilding = '';
		} catch (e) {
			locationError = (e as Error).message;
		} finally {
			locating = false;
		}
	}

	function pickBuilding() {
		const hit = buildings.find(([name]) => name === pickedBuilding);
		if (hit) start = { ...hit[1], label: hit[0] };
	}

	const minutesLabel = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;
	const stairsLabel = (n: number) => (n === 0 ? '' : n === 1 ? '1 trappa' : `${n} trappor`);
</script>

<section class="panel">
	<div class="controls">
		<button class="primary" onclick={useMyLocation} disabled={locating}>
			{locating
				? 'Hämtar plats…'
				: start?.label === 'Din plats'
					? 'Uppdatera min plats'
					: 'Starta från min plats'}
		</button>
		<select bind:value={pickedBuilding} onchange={pickBuilding} aria-label="Välj startpunkt">
			<option value="">…eller välj hus</option>
			{#each buildings as [name] (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
	</div>

	<div class="budget" role="group" aria-label="Hur lång runda">
		<span>Max</span>
		{#each BUDGETS as b (b)}
			<button class="chip" class:active={budget === b} onclick={() => (budget = b)}>{b} min</button>
		{/each}
	</div>

	{#if locationError}
		<p class="note error" role="alert">{locationError}</p>
	{/if}

	{#if !start}
		<p class="note">
			Rutten går förbi så många lediga salar som möjligt inom vald tid. Trappor och promenader
			utomhus kostar, så en våning med bara en ledig sal hoppas över medan en våning full av lediga
			salar är värd trapporna.
		</p>
	{:else if !ready}
		<p class="note">Hämtar schema…</p>
	{:else if plan && plan.stops.length === 0}
		<p class="note">
			Inga lediga salar inom {budget} min från {start.label.toLowerCase()}. Prova en längre runda.
		</p>
	{:else if plan}
		<p class="summary">
			<strong>{plan.stops.length} {plan.stops.length === 1 ? 'sal' : 'salar'}</strong> på ca {minutesLabel(
				plan.totalSeconds
			)} från {start.label}
		</p>
		<RouteMap {start} stops={plan.stops} />
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
