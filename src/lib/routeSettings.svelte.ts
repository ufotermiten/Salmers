/** Route view settings, kept at module level so they survive switching between list and route. */
export const routeSettings = $state({
	/** Minutes, or null for no limit (keep going while rooms are worth the walk). */
	budget: 10 as number | null,
	favoritesOnly: false,
	start: null as { lat: number; lng: number; label: string } | null,
	pickedBuilding: '',
	/** Accuracy in metres of the GPS fix the current start came from, or null if picked by hand. */
	gpsAccuracy: null as number | null
});
