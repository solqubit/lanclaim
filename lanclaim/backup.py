"""Schema-independent SQLite backups; importing the application is unnecessary."""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


def backup_database(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target:
        raise ValueError('La copia debe guardarse en un archivo distinto de la base de datos.')
    # Read-only also prevents a misspelled source from creating an empty database.
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=15)) as original:
        with closing(sqlite3.connect(target, timeout=15)) as destination:
            original.backup(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Copiar SQLite sin cargar ni migrar LanClaim')
    parser.add_argument('source')
    parser.add_argument('target')
    args = parser.parse_args()
    backup_database(args.source, args.target)
