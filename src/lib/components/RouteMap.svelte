<script lang="ts">
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import type { Map as LeafletMap, LayerGroup } from 'leaflet';
	import type { RouteStop } from '#lib/route.ts';

	interface Props {
		start: { lat: number; lng: number };
		stops: RouteStop[];
	}

	let { start, stops }: Props = $props();

	let container: HTMLDivElement;
	let map: LeafletMap | undefined;
	let layer: LayerGroup | undefined;
	let L: typeof import('leaflet') | undefined;

	onMount(() => {
		let cancelled = false;
		import('leaflet').then((mod) => {
			if (cancelled) return;
			L = mod.default ?? mod;
			map = L.map(container, { zoomControl: false, attributionControl: true });
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(map);
			layer = L.layerGroup().addTo(map);
			draw();
		});
		return () => {
			cancelled = true;
			map?.remove();
		};
	});

	$effect(() => {
		void start;
		void stops;
		draw();
	});

	function draw() {
		if (!L || !map || !layer) return;
		layer.clearLayers();

		const points: [number, number][] = [[start.lat, start.lng]];
		for (const s of stops) {
			if (s.room.lat !== null && s.room.lng !== null) points.push([s.room.lat, s.room.lng]);
		}

		// SVG presentation attributes can't use CSS variables, so the colour comes from .route-line.
		L.polyline(points, { className: 'route-line', weight: 4, dashArray: '6 6' }).addTo(layer);
		L.marker([start.lat, start.lng], {
			icon: L.divIcon({ className: 'route-start', iconSize: [18, 18] }),
			title: 'Start'
		}).addTo(layer);

		stops.forEach((s, i) => {
			if (s.room.lat === null || s.room.lng === null) return;
			L!
				.marker([s.room.lat, s.room.lng], {
					icon: L!.divIcon({ className: 'route-stop', html: String(i + 1), iconSize: [26, 26] }),
					title: s.room.name
				})
				.addTo(layer!);
		});

		map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 18 });
	}
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		height: 260px;
		border-radius: 14px;
		overflow: hidden;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}
	.map :global(.route-line) {
		stroke: var(--accent);
		stroke-opacity: 0.85;
	}
	.map :global(.route-stop) {
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		font:
			700 13px/1 system-ui,
			sans-serif;
		border: 2px solid var(--surface);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
	}
	.map :global(.route-start) {
		border-radius: 50%;
		background: #2f80ed;
		border: 3px solid #fff;
		box-shadow: 0 0 0 6px rgb(47 128 237 / 0.25);
	}
</style>
