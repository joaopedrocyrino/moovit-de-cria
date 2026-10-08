#!/usr/bin/env python3
"""Add/validate curated Rio places without editing C# or calling an external service."""
import argparse
import json
import math
import os
import re
import tempfile
import unicodedata
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[1] / 'src/Cria.Infrastructure/Data/places.json'
FIELDS = {'id', 'name', 'aliases', 'address', 'neighborhood', 'lat', 'lon', 'enabled', 'source', 'notes'}


def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.category(c).startswith('M'))
    return ' '.join(''.join(c.lower() if c.isalnum() else ' ' for c in value).split())


def validate(data):
    if not isinstance(data, list):
        raise ValueError('O catálogo deve ser uma lista JSON.')
    ids = set()
    for p in data:
        if not isinstance(p, dict) or set(p) - FIELDS:
            raise ValueError('Entrada inválida ou campo desconhecido no catálogo.')
        identity = p.get('id')
        if not isinstance(identity, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', identity) or identity in ids:
            raise ValueError('Cada lugar precisa de um id único com letras minúsculas, números ou hífens.')
        ids.add(identity)
        for key in ['name', 'neighborhood']:
            if not isinstance(p.get(key), str) or not normalize(p[key]):
                raise ValueError(f'{identity}: preencha {key}.')
        aliases = p.get('aliases')
        if not isinstance(aliases, list) or any(not isinstance(a, str) or not normalize(a) for a in aliases):
            raise ValueError(f'{identity}: aliases deve ser uma lista de nomes não vazios.')
        for key in ['address', 'source', 'notes']:
            if p.get(key) is not None and not isinstance(p[key], str):
                raise ValueError(f'{identity}: {key} deve ser texto ou null.')
        if type(p.get('enabled')) is not bool:
            raise ValueError(f'{identity}: enabled deve ser true ou false.')
        lat, lon = p.get('lat'), p.get('lon')
        if p['enabled'] or lat is not None or lon is not None:
            if (type(lat) not in (int, float) or type(lon) not in (int, float) or
                    not math.isfinite(lat) or not math.isfinite(lon) or
                    not (-23.12 <= lat <= -22.72 and -43.85 <= lon <= -43.08)):
                raise ValueError(f'{identity}: informe latitude/longitude válidas dentro da região do Rio.')
        if p['enabled'] and (not isinstance(p.get('source'), str) or not p['source'].strip()):
            raise ValueError(f'{identity}: registre a origem das coordenadas em source.')
    return data


def read_catalog(path):
    return validate(json.loads(path.read_text(encoding='utf-8')))


def write_catalog(path, data):
    validate(data)
    text = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.places-', delete=False) as output:
            temporary = Path(output.name)
            os.fchmod(output.fileno(), mode)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def add_place(path, entry):
    data = read_catalog(path)
    write_catalog(path, data + [entry])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['add', 'validate'])
    parser.add_argument('--file', type=Path, default=CATALOG)
    parser.add_argument('--name')
    parser.add_argument('--id')
    parser.add_argument('--aliases', help='Separe nomes alternativos por ponto e vírgula.')
    parser.add_argument('--address')
    parser.add_argument('--neighborhood')
    parser.add_argument('--coordinates', help='latitude, longitude (nessa ordem).')
    parser.add_argument('--source')
    args = parser.parse_args()
    try:
        data = read_catalog(args.file)
        if args.command == 'validate':
            print(f'Catálogo válido: {len(data)} lugares, {sum(p["enabled"] for p in data)} ativos.')
            return 0
        def prompt(value, label, default=''):
            if value is not None:
                return value.strip()
            answer = input(label + (f' [{default}]' if default else '') + ': ').strip()
            return answer or default
        name = prompt(args.name, 'Nome do lugar')
        identity = args.id or normalize(name).replace(' ', '-')
        aliases = [a.strip() for a in prompt(args.aliases, 'Apelidos separados por ; (opcional)').split(';') if a.strip()]
        address = prompt(args.address, 'Rua e número (opcional)') or None
        neighborhood = prompt(args.neighborhood, 'Bairro')
        coordinates = prompt(args.coordinates, 'Coordenadas: latitude, longitude').split(',')
        if len(coordinates) != 2:
            raise ValueError('Use latitude, longitude, com ponto como separador decimal.')
        lat, lon = (float(v.strip()) for v in coordinates)
        source = prompt(args.source, 'Origem das coordenadas', 'Cadastro manual pelo mantenedor')
        entry = dict(id=identity, name=name, aliases=aliases, address=address, neighborhood=neighborhood,
                     lat=lat, lon=lon, enabled=True, source=source)
        add_place(args.file, entry)
        print(f'Lugar adicionado: {name}. Arquivo: {args.file}')
        print('Reinicie o backend local. Para produção, faça commit/push em main para reconstruir e publicar o catálogo.')
        return 0
    except (OSError, ValueError, EOFError) as error:
        print(f'Erro: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
