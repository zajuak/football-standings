import { openDatabase, mergeDatabase } from './database.mjs';

const [source, target] = process.argv.slice(2);
if (!source || !target || source === target) throw new Error('Usage: node server/import.mjs SOURCE.sqlite TARGET.sqlite');
process.umask(0o077);
const db = openDatabase(target);
try { console.log(JSON.stringify(mergeDatabase(db, source))); }
finally { db.close(); }
