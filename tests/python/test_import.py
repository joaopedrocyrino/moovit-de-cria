import importlib.util,json,sqlite3,tempfile,unittest,zipfile
from unittest.mock import patch
from pathlib import Path
from create_fixture import fixture
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('gtfs',ROOT/'scripts/import_gtfs.py');gtfs=importlib.util.module_from_spec(spec);spec.loader.exec_module(gtfs)
class ImportTests(unittest.TestCase):
 def test_after_midnight(self):self.assertEqual(gtfs.seconds('25:03:04'),90184)
 def test_invalid_time(self):
  with self.assertRaises(ValueError):gtfs.seconds('24:65:00')
 def test_interleaved_trips_and_money(self):
  with tempfile.TemporaryDirectory() as folder:
   db=Path(folder)/'transit.sqlite';fixture(db)
   with sqlite3.connect(db) as c:
    patterns=[json.loads(r[0]) for r in c.execute('SELECT payload FROM patterns')]
    self.assertEqual(len(patterns),2);self.assertEqual(patterns[0]['fareCents'],500)
    self.assertTrue(all(len(p['stops'])==2 for p in patterns))
 def test_failed_import_keeps_previous_snapshot(self):
  with tempfile.TemporaryDirectory() as folder:
   db=Path(folder)/'transit.sqlite';fixture(db);before=db.read_bytes();bad=Path(folder)/'bad.zip'
   with zipfile.ZipFile(bad,'w') as z:z.writestr('stops.txt','stop_id\n')
   with self.assertRaises(ValueError):gtfs.build(bad,db,'bad')
   self.assertEqual(db.read_bytes(),before)
class SnapshotInstallTests(unittest.TestCase):
 source_name='TEST FIXTURE — synthetic, not real schedules'
 def test_install_uses_prepared_snapshot_without_network(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'prepared.sqlite';output=Path(folder)/'data'/'transit.sqlite';fixture(source)
   with patch.object(gtfs.urllib.request,'urlopen',side_effect=AssertionError('Network must not be used')):
    gtfs.install_snapshot(source,output,self.source_name)
   self.assertEqual(source.read_bytes(),output.read_bytes())
   self.assertEqual(output.stat().st_mode&0o777,0o644)
 def test_corrupt_snapshot_preserves_existing_data(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'corrupt.sqlite';source.write_bytes(b'not SQLite')
   output=Path(folder)/'transit.sqlite';fixture(output);before=output.read_bytes()
   with self.assertRaises(sqlite3.DatabaseError):gtfs.install_snapshot(source,output,self.source_name)
   self.assertEqual(output.read_bytes(),before)
   self.assertEqual(list(Path(folder).glob('.transit-*')),[])
 def test_wrong_source_preserves_existing_data(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'prepared.sqlite';output=Path(folder)/'transit.sqlite';fixture(source);fixture(output);before=output.read_bytes()
   with self.assertRaisesRegex(ValueError,'source differs'):gtfs.install_snapshot(source,output,'https://different.example/feed')
   self.assertEqual(output.read_bytes(),before)
 def test_expired_snapshot_preserves_existing_data(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'prepared.sqlite';output=Path(folder)/'transit.sqlite';fixture(source);fixture(output);before=output.read_bytes()
   with sqlite3.connect(source) as db:db.execute("INSERT INTO metadata VALUES('validUntil','20000101')")
   with self.assertRaisesRegex(ValueError,'expired'):gtfs.install_snapshot(source,output,self.source_name)
   self.assertEqual(output.read_bytes(),before)
 def test_missing_snapshot_preserves_existing_data(self):
  with tempfile.TemporaryDirectory() as folder:
   output=Path(folder)/'transit.sqlite';fixture(output);before=output.read_bytes()
   with self.assertRaisesRegex(ValueError,'PREPARE_GTFS=1'):gtfs.install_snapshot(Path(folder)/'missing.sqlite',output,self.source_name)
   self.assertEqual(output.read_bytes(),before)
