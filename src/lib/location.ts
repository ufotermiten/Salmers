export interface Position {
	lat: number;
	lng: number;
	accuracy: number | null;
}

/** Roughly the middle of campus Johanneberg. */
export const CAMPUS_CENTER = { lat: 57.6895, lng: 11.9765 };

export function getPosition(timeoutMs = 10_000): Promise<Position> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) {
			reject(new Error('Din enhet stödjer inte platstjänster.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(p) =>
				resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
			(err) =>
				reject(
					new Error(
						err.code === err.PERMISSION_DENIED
							? 'Appen fick inte använda din plats. Välj en startpunkt i listan i stället.'
							: 'Kunde inte hitta din plats. Välj en startpunkt i listan i stället.'
					)
				),
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
		);
	});
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
