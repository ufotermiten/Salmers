const TZ = 'Europe/Stockholm';

const parts = new Intl.DateTimeFormat('sv-SE', {
	timeZone: TZ,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** Current date ("YYYY-MM-DD") and minute of day in Stockholm, whatever the device timezone. */
export function stockholmNow(at = new Date()): { date: string; minute: number } {
	const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
	return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

export function parseHHMM(s: string): number {
	const [h, m] = s.split(':').map(Number);
	return h * 60 + m;
}

export function formatMinute(minute: number): string {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDateLabel(date: string, today: string): string {
	if (date === today) return 'Idag';
	const d = new Date(`${date}T12:00:00`);
	const t = new Date(`${today}T12:00:00`);
	const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
	if (diff === 1) return 'Imorgon';
	return d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
}
