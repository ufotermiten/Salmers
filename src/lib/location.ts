import { Capacitor } from '@capacitor/core';

export interface Position {
	lat: number;
	lng: number;
	/** Radius in metres (68 % confidence), as reported by the device. */
	accuracy: number;
	/** The user only granted approximate location (Android 12+), so expect kilometres of error. */
	approximate: boolean;
}

/** Roughly the middle of campus Johanneberg. */
export const CAMPUS_CENTER = { lat: 57.6895, lng: 11.9765 };

/** Stop sampling as soon as a fix is at least this good. */
export const GOOD_ACCURACY_M = 20;
/** The first fix is often a coarse network position; keep sampling this long for a better one. */
const SAMPLE_MS = 8000;

const DENIED = 'Appen fick inte använda din plats. Välj en startpunkt i listan i stället.';
const FAILED = 'Kunde inte hitta din plats. Välj en startpunkt i listan i stället.';

type Fix = { lat: number; lng: number; accuracy: number };

/**
 * Collects fixes for up to SAMPLE_MS and resolves with the most accurate one,
 * or earlier once a fix reaches GOOD_ACCURACY_M.
 */
function bestFix(
	watch: (onFix: (fix: Fix) => void, onError: (err: Error) => void) => Promise<() => void>
): Promise<Fix> {
	return new Promise((resolve, reject) => {
		let best: Fix | null = null;
		let stop: (() => void) | null = null;
		let done = false;

		const finish = (err?: Error) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			stop?.();
			if (best) resolve(best);
			else reject(err ?? new Error(FAILED));
		};
		const timer = setTimeout(() => finish(), SAMPLE_MS);

		watch(
			(fix) => {
				if (!best || fix.accuracy < best.accuracy) best = fix;
				if (fix.accuracy <= GOOD_ACCURACY_M) finish();
			},
			(err) => finish(err)
		).then(
			(s) => (done ? s() : (stop = s)),
			(err) => finish(err)
		);
	});
}

async function webPosition(): Promise<Position> {
	if (!('geolocation' in navigator)) throw new Error('Din enhet stödjer inte platstjänster.');
	const fix = await bestFix(async (onFix, onError) => {
		const id = navigator.geolocation.watchPosition(
			(p) =>
				onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
			(err) => onError(new Error(err.code === err.PERMISSION_DENIED ? DENIED : FAILED)),
			{ enableHighAccuracy: true, timeout: SAMPLE_MS, maximumAge: 0 }
		);
		return () => navigator.geolocation.clearWatch(id);
	});
	return { ...fix, approximate: false };
}

/** Android app: Google's fused provider (GPS + Wi-Fi + cell) is much better indoors than the WebView's. */
async function nativePosition(): Promise<Position> {
	const { Geolocation } = await import('@capacitor/geolocation');
	let perm = await Geolocation.checkPermissions();
	if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
		perm = await Geolocation.requestPermissions();
	}
	if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') throw new Error(DENIED);

	const fix = await bestFix(async (onFix, onError) => {
		const id = await Geolocation.watchPosition(
			{ enableHighAccuracy: true, timeout: SAMPLE_MS, maximumAge: 0 },
			(p, err) => {
				if (p)
					onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
				else if (err) onError(new Error(FAILED));
			}
		);
		return () => void Geolocation.clearWatch({ id });
	});
	return { ...fix, approximate: perm.location !== 'granted' };
}

export function getPosition(): Promise<Position> {
	return Capacitor.isNativePlatform() ? nativePosition() : webPosition();
}

export function distanceMeters(
	a: { lat: number; lng: number },
	b: { lat: number; lng: number }
): number {
	const R = 6_371_000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Where to start the route from a fix. Indoors the fix is often tens of metres off,
 * so when it is vague and a building is within reach of the error radius, start at
 * that building instead of a point that may be in the street outside.
 */
export function resolveStart<T extends { lat: number; lng: number }>(
	pos: Position,
	buildings: [string, T][]
): { building: string | null; lat: number; lng: number } {
	const SNAP_ABOVE_M = 25;
	const SNAP_SLACK_M = 40;
	let nearest: [string, T] | null = null;
	let nearestDist = Infinity;
	for (const b of buildings) {
		const d = distanceMeters(pos, b[1]);
		if (d < nearestDist) [nearest, nearestDist] = [b, d];
	}
	if (nearest && pos.accuracy > SNAP_ABOVE_M && nearestDist <= pos.accuracy + SNAP_SLACK_M) {
		return { building: nearest[0], lat: nearest[1].lat, lng: nearest[1].lng };
	}
	return { building: null, lat: pos.lat, lng: pos.lng };
}
