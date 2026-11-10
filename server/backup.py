"""Create a consistent SQLite backup while the API remains online."""
import datetime
import os
from pathlib import Path
import sqlite3
from contextlib import closing

os.umask(0o077)
source = Path(os.environ.get('DATABASE_PATH', '/var/lib/football-standings/standings.sqlite'))
folder = Path(os.environ.get('BACKUP_DIR', '/var/backups/football-standings'))
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
target = folder / f'standings-{stamp}.sqlite'
temporary = target.with_suffix('.partial')
with closing(sqlite3.connect(f'{source.as_uri()}?mode=ro', uri=True)) as original:
    with closing(sqlite3.connect(temporary)) as backup:
        original.backup(backup)
        backup.execute('PRAGMA journal_mode=DELETE')
        assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        count = backup.execute('SELECT COUNT(*) FROM submissions').fetchone()[0]
# The copied WAL header can leave a shared-memory sidecar on some SQLite VFSes.
# Both connections are closed and DELETE mode has checkpointed the backup.
for suffix in ('-wal', '-shm'):
    Path(str(temporary) + suffix).unlink(missing_ok=True)
temporary.replace(target)
print(f'Backup complete: {target.name}; history records: {count}')
