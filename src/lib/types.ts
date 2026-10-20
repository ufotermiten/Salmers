export type RoomType = 'Lektionssal' | 'Hörsal' | 'Datorsal' | 'Studieplats';

export interface Room {
	/** TimeEdit object id ("782.4"), or "maps:<uuid>" for drop-in study spaces. */
	id: string;
	name: string;
	type: RoomType;
	building: string | null;
	floor: string | null;
	roomNumber: string | null;
	mapsId: string | null;
	lat: number | null;
	lng: number | null;
	seats: number | null;
	equipment: string[];
	/** maps.chalmers.se building id; rooms sharing it can be walked between indoors. */
	buildingId: string | null;
	/** Coordinates of the building entrance used for this room. */
	entranceLat: number | null;
	entranceLng: number | null;
	/** Floor as a number ("E" resolved to the entrance floor), for counting stairs. */
	level: number | null;
	/** Floor of the building entrance. */
	entranceLevel: number | null;
	/** Not bookable in TimeEdit, always open for drop-in. */
	dropIn: boolean;
}

/** A booking within one day, in minutes after local midnight. */
export interface Booking {
	start: number;
	end: number;
	title: string;
}

export type RoomStatus = { free: true; until: number | null } | { free: false; until: number };
