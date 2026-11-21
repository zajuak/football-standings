import { openDatabase } from './database.mjs';
import { createBackend } from './http.mjs';

process.umask(0o077);
const filename = process.env.DATABASE_PATH || '/var/lib/football-standings/standings.sqlite';
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const readOnly = process.env.READ_ONLY !== 'false';
const db = openDatabase(filename);
const server = createBackend({ db, readOnly, staticDirectory: process.env.STATIC_DIRECTORY, allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) });
server.listen(port, host, () => console.log(JSON.stringify({ event: 'listening', host, port, readOnly })));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => { db.close(); process.exit(0); }, 10000).unref();
});
