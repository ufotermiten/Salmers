import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'se.salmers.app',
	appName: 'Salmers',
	// SvelteKit adapter-static output; build without BASE_PATH so assets resolve from the root.
	webDir: 'build',
	server: {
		// Serve the app from https://localhost so fetches to cloud.timeedit.net / maps.chalmers.se are not mixed content.
		androidScheme: 'https'
	}
};

export default config;
