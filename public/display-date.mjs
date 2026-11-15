const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Presentation only: never write today's date into a competition snapshot.
export function currentDisplayDate(now = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export class DisplayDateSelection {
  constructor() { this.overrides = new Map(); }
  get(key, now = new Date()) { return this.overrides.get(key) ?? currentDisplayDate(now); }
  select(key, value, now = new Date()) {
    if (!value || value === currentDisplayDate(now)) this.overrides.delete(key);
    else {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('请选择有效日期');
      this.overrides.set(key, value);
    }
    return this.get(key, now);
  }
}
