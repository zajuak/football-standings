"""Convert a trusted Wrangler D1 export into a private, portable SQLite file."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 server/prepare-export.py EXPORT.sql NEW.sqlite')
source, target = map(Path, sys.argv[1:])
os.umask(0o077)
with target.open('xb'):
    pass
db = sqlite3.connect(target)
try:
    db.executescript(source.read_text())
    db.commit()
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    records = db.execute('SELECT revision,submission_id,base_revision,action,state,applied,created_at,content_hash FROM submissions ORDER BY revision').fetchall()
    assert len({row[1] for row in records}) == len(records)
    latest = db.execute('SELECT COALESCE(MAX(revision),0) FROM submissions WHERE applied=1').fetchone()[0]
finally:
    db.close()
print(json.dumps({'rows': len(records), 'latestRevision': latest,
                  'rowsSha256': hashlib.sha256(json.dumps(records, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
                  'fileSha256': hashlib.sha256(target.read_bytes()).hexdigest()}))
