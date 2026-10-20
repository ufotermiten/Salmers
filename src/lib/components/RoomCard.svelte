<script lang="ts">
	import type { Booking, Room, RoomStatus } from '#lib/types.ts';
	import { favorites, hidden, toggleFavorite, toggleHidden } from '#lib/roomLists.svelte.ts';
	import { formatDuration, formatMinute } from '#lib/time.ts';
	import Timeline from './Timeline.svelte';

	interface Props {
		room: Room;
		status: RoomStatus | null;
		bookings: Booking[];
		minute: number;
		blockLabel?: string | null;
	}

	let { room, status, bookings, minute, blockLabel = null }: Props = $props();
	let open = $state(false);

	const isFavorite = $derived(favorites.has(room.id));
	const isHidden = $derived(hidden.has(room.id));
	const meta = $derived(
		[
			room.type,
			room.building,
			room.floor && `vån ${room.floor}`,
			room.seats && `${room.seats} platser`
		]
			.filter(Boolean)
			.join(' · ')
	);

	const label = $derived.by(() => {
		if (room.dropIn) return { text: 'Drop-in', tone: 'free' };
		if (!status) return { text: '…', tone: 'muted' };
		if (blockLabel) {
			// During lunch a room can be booked right now yet free for the whole afternoon.
			return {
				text: blockLabel,
				sub: status.free ? undefined : `upptagen till ${formatMinute(status.until)}`,
				tone: 'free'
			};
		}
		if (status.free) {
			if (status.until === null) return { text: 'Ledig resten av dagen', tone: 'free' };
			return {
				text: `Ledig till ${formatMinute(status.until)}`,
				sub: formatDuration(status.until - minute),
				tone: status.until - minute < 30 ? 'soon' : 'free'
			};
		}
		if (status.until >= 24 * 60) return { text: 'Upptagen resten av dagen', tone: 'busy' };
		return { text: `Ledig från ${formatMinute(status.until)}`, tone: 'busy' };
	});
</script>

<article class="card" class:open class:hidden={isHidden}>
	<div class="row">
		<button class="main" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="name">{room.name}</span>
			<span class="meta">{meta}</span>
			<span class="status {label.tone}">
				<span class="dot"></span>{label.text}
				{#if label.sub}<span class="sub">· {label.sub}</span>{/if}
			</span>
		</button>
		<button
			class="star"
			class:active={isFavorite}
			onclick={() => toggleFavorite(room.id)}
			aria-label={isFavorite
				? `Ta bort ${room.name} från favoriter`
				: `Lägg till ${room.name} i favoriter`}
			aria-pressed={isFavorite}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>

	{#if open}
		<div class="details">
			{#if !room.dropIn}
				<Timeline {bookings} {minute} />
				{#if bookings.length}
					<ul class="bookings">
						{#each bookings as b, i (i)}
							<li>
								<span class="time"
									>{formatMinute(b.start)}–{b.end >= 1440 ? '24:00' : formatMinute(b.end)}</span
								>
								<span class="title">{b.title || 'Bokad'}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty">Inga bokningar den här dagen.</p>
				{/if}
			{:else}
				<p class="empty">Öppen studieplats utan bokning – först till kvarn.</p>
			{/if}

			{#if room.equipment.length}
				<p class="equipment">{room.equipment.join(' · ')}</p>
			{/if}

			<div class="actions">
				{#if room.mapsId}
					<a
						class="map"
						href="https://maps.chalmers.se/#{room.mapsId}"
						target="_blank"
						rel="noopener"
					>
						Visa på karta ↗
					</a>
				{/if}
				<button class="hide" onclick={() => toggleHidden(room.id)} aria-pressed={isHidden}>
					{isHidden ? 'Visa salen igen' : 'Dölj sal'}
				</button>
			</div>
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: stretch;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 2px;
		padding: 12px 4px 12px 14px;
		text-align: left;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.name {
		font-weight: 650;
		font-size: 1.05rem;
	}
	.meta {
		color: var(--muted);
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		font-size: 0.9rem;
		font-weight: 550;
	}
	.sub {
		color: var(--muted);
		font-weight: 400;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		flex: none;
	}
	.free {
		color: var(--free);
	}
	.soon {
		color: var(--soon);
	}
	.busy {
		color: var(--busy);
	}
	.muted {
		color: var(--muted);
	}
	.star {
		flex: none;
		width: 52px;
		display: grid;
		place-items: center;
		background: none;
		border: 0;
		cursor: pointer;
		color: var(--muted);
	}
	.star svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}
	.star.active {
		color: var(--star);
	}
	.star.active svg {
		fill: currentColor;
	}
	.details {
		padding: 0 14px 14px;
		display: grid;
		gap: 10px;
	}
	.bookings {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
		font-size: 0.88rem;
	}
	.bookings li {
		display: flex;
		gap: 10px;
	}
	.time {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		flex: none;
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty,
	.equipment {
		margin: 0;
		font-size: 0.88rem;
		color: var(--muted);
	}
	.card.hidden .main {
		opacity: 0.6;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.hide {
		margin-left: auto;
		font: inherit;
		font-size: 0.88rem;
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.map {
		color: var(--accent);
		font-weight: 550;
		font-size: 0.9rem;
		text-decoration: none;
	}
</style>
