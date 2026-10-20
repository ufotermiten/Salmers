/** Route view settings, kept at module level so they survive switching between list and route. */
export const routeSettings = $state({
	budget: 10,
	favoritesOnly: false,
	start: null as { lat: number; lng: number; label: string } | null,
	pickedBuilding: '',
	/** Accuracy in metres of the GPS fix the current start came from, or null if picked by hand. */
	gpsAccuracy: null as number | null
});
