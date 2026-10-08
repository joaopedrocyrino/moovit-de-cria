import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('places_catalog', ROOT / 'scripts/places.py')
places = importlib.util.module_from_spec(spec)
spec.loader.exec_module(places)


class CatalogCommandTests(unittest.TestCase):
    def entry(self):
        return dict(id='novo-lugar', name='Novo Café', aliases=['Cafe Novo'], address=None,
                    neighborhood='Botafogo', lat=-22.95, lon=-43.18, enabled=True, source='GPS próprio')

    def test_add_preserves_existing_entries_and_unicode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'places.json'
            existing = self.entry() | {'id': 'existente', 'name': 'Existente'}
            places.write_catalog(path, [existing])
            places.add_place(path, self.entry())
            self.assertEqual(places.read_catalog(path), [existing, self.entry()])
            self.assertIn('Novo Café', path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)

    def test_invalid_add_does_not_change_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'places.json'
            places.write_catalog(path, [self.entry()])
            original = path.read_bytes()
            for entry in [self.entry(), self.entry() | {'id': 'outside', 'lat': 0}, self.entry() | {'id': 'missing-source', 'source': ''}]:
                with self.assertRaises(ValueError):
                    places.add_place(path, entry)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(list(Path(directory).glob('.places-*')), [])

    def test_disabled_drafts_are_valid_but_malformed_data_is_not(self):
        draft = self.entry() | {'enabled': False, 'lat': None, 'lon': None, 'source': None}
        self.assertEqual(places.validate([draft]), [draft])
        for bad in [self.entry() | {'lat': True}, self.entry() | {'lat': float('nan')},
                    self.entry() | {'unknown': 'field'}, self.entry() | {'aliases': ['']},
                    self.entry() | {'enabled': 'true'}, self.entry() | {'name': '...'}]:
            with self.assertRaises(ValueError):
                places.validate([bad])

    def test_bundled_catalog_is_valid(self):
        data = {p['id']: p for p in places.read_catalog(places.CATALOG)}
        self.assertEqual(data['casa-do-amor']['lat'], -22.970418642926163)
        self.assertEqual(data['rft-botafogo']['lon'], -43.18393118957157)

    def test_noninteractive_command_adds_a_new_place_with_negative_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'places.json'
            places.write_catalog(path, [])
            args = ['places.py', 'add', '--file', str(path), '--name', 'Novo Café',
                    '--aliases', 'Cafe Novo;Outra grafia', '--address', '', '--neighborhood', 'Botafogo',
                    '--coordinates=-22.95,-43.18', '--source', 'GPS próprio']
            with patch.object(sys, 'argv', args), redirect_stdout(io.StringIO()):
                self.assertEqual(places.main(), 0)
            self.assertEqual(places.read_catalog(path)[0]['id'], 'novo-cafe')
            self.assertEqual(places.read_catalog(path)[0]['aliases'], ['Cafe Novo', 'Outra grafia'])


if __name__ == '__main__':
    unittest.main()
