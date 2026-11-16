// Date helpers working on local-calendar ISO strings ("YYYY-MM-DD").
// All arithmetic runs in UTC so daylight-saving changes cannot shift a day.

const DAY = 86400000;

export const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayISO = () => toISO(new Date());

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, n) => fromUtc(utc(iso) + n * DAY);
export const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / DAY);

/** Weekday index with Monday = 0 … Sunday = 6. */
export const weekday = (iso) => (new Date(utc(iso)).getUTCDay() + 6) % 7;

/** Monday of the week containing the given date. */
export const weekStart = (iso) => addDays(iso, -weekday(iso));

/** ISO-8601 week number. */
export const isoWeek = (iso) => {
  const thursday = addDays(weekStart(iso), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(jan1, thursday) / 7) + 1;
};

/** A Date at local noon, safe for Intl formatting. */
export const asDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export const isValidISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s));
