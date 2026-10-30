import { migrateState } from './core.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])
  );
  return value;
}

// The selected tab and schema revision are presentation/compatibility metadata,
// not competition changes. Keep every competition's actual editable data.
export function contentFingerprint(state) {
  const normalized = migrateState(structuredClone(state));
  const { activeCompetitionId, revision, ...content } = normalized;
  return JSON.stringify(stable(content));
}
