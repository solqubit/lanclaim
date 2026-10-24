import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from lanclaim.backup import backup_database


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'legacy data'
        self.data.mkdir()
        self.source = self.data / 'lanclaim.sqlite3'
        self.target = self.root / 'before.sqlite3'
        with sqlite3.connect(self.source) as db:
            db.executescript("CREATE TABLE ips(address); INSERT INTO ips VALUES('192.0.2.10'); PRAGMA user_version=4;")
        db.close()

    def contents(self, path):
        db = sqlite3.connect(path)
        try:
            return db.execute('PRAGMA user_version').fetchone()[0], list(db.iterdump())
        finally:
            db.close()

    def test_schema_independent_copy_preserves_source_and_backup(self):
        before = self.contents(self.source)
        backup_database(self.source, self.target)
        self.assertEqual(self.contents(self.source), before)
        self.assertEqual(self.contents(self.target), before)

    def test_application_backup_command_does_not_initialize_store(self):
        before = self.contents(self.source)
        # Run from the new checkout: its Store would discard this schema if opened.
        result = subprocess.run([sys.executable, '-m', 'lanclaim.server', '--data-dir', str(self.data),
                                 '--backup', str(self.target)], cwd=Path(__file__).resolve().parents[1],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.contents(self.source), before)
        self.assertEqual(self.contents(self.target), before)

    def test_standalone_backup_ignores_poisoned_application_imports(self):
        fake = self.root / 'fake'
        fake.mkdir()
        package = fake / 'lanclaim'
        package.mkdir()
        (package / '__init__.py').write_text("raise RuntimeError('Application must not load during backup')\n")
        script = Path(__file__).resolve().parents[1] / 'lanclaim' / 'backup.py'
        result = subprocess.run([sys.executable, str(script), str(self.source), str(self.target)],
                                cwd=fake, env={**os.environ, 'PYTHONPATH': str(fake)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.contents(self.target), self.contents(self.source))

    def test_missing_source_does_not_create_a_database(self):
        missing = self.root / 'missing.sqlite3'
        with self.assertRaises(sqlite3.OperationalError):
            backup_database(missing, self.target)
        self.assertFalse(missing.exists())
        self.assertFalse(self.target.exists())

    def test_backup_cannot_overwrite_source(self):
        before = self.contents(self.source)
        with self.assertRaises(ValueError):
            backup_database(self.source, self.source)
        self.assertEqual(self.contents(self.source), before)

    def test_backup_includes_committed_wal_changes(self):
        db = sqlite3.connect(self.source)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute("INSERT INTO ips VALUES('192.0.2.11')")
            db.commit()
            backup_database(self.source, self.target)
            self.assertEqual(self.contents(self.target), self.contents(self.source))
        finally:
            db.close()
