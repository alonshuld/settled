const TZ = 'Asia/Jerusalem';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'short',
});

function localParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday: WEEKDAYS.indexOf(p.weekday!) };
}

/** Wall-clock time in Asia/Jerusalem → instant. Two passes settle the offset around DST changes. */
function localToUtc(y: number, m: number, d: number, hour: number): Date {
  const wall = Date.UTC(y, m - 1, d, hour);
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    const p = fmt.formatToParts(new Date(utc)).reduce<Record<string, string>>((acc, x) => ((acc[x.type] = x.value), acc), {});
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    utc -= shown - wall;
  }
  return new Date(utc);
}

/**
 * The most recent Sunday 09:00 in Asia/Jerusalem at or before `now`. The weekly digest is due once `lastRunAt`
 * is older than this, so a missed tick is caught up by the next one (design §10).
 */
export function digestWeekStart(now: Date): Date {
  const { y, m, d, weekday } = localParts(now);
  const start = localToUtc(y, m, d - weekday, 9);
  if (start <= now) return start;
  const prev = localToUtc(y, m, d - weekday - 7, 9);
  return prev;
}
