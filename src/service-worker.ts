/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline support for the app shell. Schedule data from TimeEdit (and anything else
// cross-origin) is deliberately NOT handled here: the app caches it itself in localStorage.

import { self } from '$app/service-worker';
import { immutable, assets, prerendered } from '$app/manifest';
import { version } from '$app/env';

const CACHE_PREFIX = 'salmers-';
const CACHE = `${CACHE_PREFIX}${version}`;

// The site may live at the origin root (Capacitor) or under a sub-path (GitHub Pages),
// so resolve every manifest path against the registration scope, which always ends in "/".
const scope = self.registration.scope;
const toUrl = (path: string) => new URL(path.replace(/^\//, ''), scope).href;

const INDEX = toUrl('');
const PRECACHE = [
	...new Set([INDEX, ...[...immutable, ...assets, ...prerendered].map(({ path }) => toUrl(path))])
];
const PRECACHE_SET = new Set(PRECACHE);

// Fall back to the cached shell if the network is this slow on a navigation.
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Only touch our own caches: on GitHub Pages the origin is shared with other projects.
			for (const key of await caches.keys()) {
				if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Cross-origin (TimeEdit, maps.chalmers.se, ...) and out-of-scope requests go straight to the network.
	if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;

	event.respondWith(request.mode === 'navigate' ? navigate(request) : cacheFirst(request));
});

async function navigate(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match(INDEX));

	const network = fetch(request).then((response) => {
		if (response.ok && response.type === 'basic') void cache.put(INDEX, response.clone());
		return response;
	});

	if (!cached) return network;

	// Prefer fresh HTML, but don't hang on a flaky connection and serve the shell offline.
	const timeout = new Promise<Response>((resolve) =>
		setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS)
	);
	return Promise.race([network.catch(() => cached), timeout]);
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request, {
		ignoreSearch: PRECACHE_SET.has(stripSearch(request.url))
	});
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok && response.type === 'basic') void cache.put(request, response.clone());
	return response;
}

function stripSearch(href: string): string {
	const url = new URL(href);
	url.search = '';
	url.hash = '';
	return url.href;
}
