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
