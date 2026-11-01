import { contentFingerprint } from '../public/state-content.mjs';

async function recordHash(row) {
  if (row.content_hash) return row.content_hash;
  const content = contentFingerprint(JSON.parse(row.state));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Collapse adjacent equal snapshots only. A → B → A remains three versions.
// This is a read-only view: exports and restoration retain every original row.
export async function distinctHistory(db, before, full = false) {
  const anchor = await db.prepare('SELECT state, content_hash FROM submissions WHERE revision = ?').bind(before).first();
  let previous = anchor ? await recordHash(anchor) : null;
  let cursor = before;
  const items = [];
  while (true) {
    const { results } = await db.prepare('SELECT * FROM submissions WHERE revision < ? ORDER BY revision DESC LIMIT 100').bind(cursor).all();
    for (const row of results) {
      const hash = await recordHash(row);
      if (hash === previous) {
        if (items.length) items.at(-1).duplicateCount++;
        continue;
      }
      // Look one distinct version ahead, so a page ending in duplicates has
      // a correct continuation and does not repeat that run on the next page.
      if (items.length === 50) return { items, next: items.at(-1).revision };
      previous = hash;
      const { state, content_hash, ...metadata } = row;
      items.push({ ...metadata, ...(full ? { state: JSON.parse(state) } : {}), duplicateCount: 0 });
    }
    if (results.length < 100) return { items, next: null };
    cursor = results.at(-1).revision;
  }
}
