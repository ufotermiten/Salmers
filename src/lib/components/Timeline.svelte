<script lang="ts">
	import type { Booking } from '#lib/types.ts';

	let { bookings, minute }: { bookings: Booking[]; minute: number } = $props();

	const START = 7 * 60;
	const END = 22 * 60;
	const pct = (m: number) => ((Math.min(Math.max(m, START), END) - START) / (END - START)) * 100;
	const hours = [8, 10, 12, 14, 16, 18, 20];
</script>

<div class="timeline" aria-hidden="true">
	<div class="track">
		{#each bookings as b, i (i)}
			{#if b.end > START && b.start < END}
				<span class="booked" style:left="{pct(b.start)}%" style:width="{pct(b.end) - pct(b.start)}%"
				></span>
			{/if}
		{/each}
		{#if minute >= START && minute <= END}
			<span class="now" style:left="{pct(minute)}%"></span>
		{/if}
	</div>
	<div class="hours">
		{#each hours as h (h)}
			<span style:left="{pct(h * 60)}%">{h}</span>
		{/each}
	</div>
</div>

<style>
	.timeline {
		padding-top: 4px;
	}
	.track {
		position: relative;
		height: 14px;
		border-radius: 7px;
		background: var(--free-soft);
		overflow: hidden;
	}
	.booked {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--busy-soft);
		border-left: 1px solid var(--surface);
	}
	.now {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--text);
	}
	.hours {
		position: relative;
		height: 16px;
		font-size: 0.7rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.hours span {
		position: absolute;
		transform: translateX(-50%);
		top: 2px;
	}
</style>
