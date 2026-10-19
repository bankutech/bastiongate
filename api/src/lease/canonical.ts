export function canonicalize(value: unknown, seen = new Set<unknown>()): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return '[' + value.map(v => (v === undefined ? 'null' : canonicalize(v, seen))).join(',') + ']';
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined && typeof obj[k] !== 'function' && typeof obj[k] !== 'symbol').sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k], seen)).join(',') + '}';
  } finally {
    seen.delete(value);
  }
}
