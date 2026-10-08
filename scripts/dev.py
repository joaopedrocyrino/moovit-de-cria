#!/usr/bin/env python3
"""Run both development servers and clean up their process groups on exit."""
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
if (root / '.env').exists():
    for line in (root / '.env').read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env.setdefault(key, value)

dotnet = shutil.which('dotnet', path=env.get('PATH'))
if not dotnet:
    candidates = [
        Path(env.get('DOTNET_ROOT', '/nonexistent')) / 'dotnet',
        Path.home() / '.dotnet/dotnet',
        Path('/usr/local/share/dotnet/dotnet'),
        Path('/usr/share/dotnet/dotnet'),
    ]
    dotnet = next((str(p) for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
if not dotnet:
    sys.exit('Install the .NET 10 SDK or set DOTNET_ROOT to its installation directory.')
if not (root / 'frontend/node_modules/.bin/vite').is_file():
    sys.exit('Install frontend dependencies first: npm run install:web')

env['PATH'] = str(Path(dotnet).resolve().parent) + os.pathsep + env.get('PATH', '')
env.setdefault('DOTNET_ROOT', str(Path(dotnet).resolve().parent))
env['ASPNETCORE_ENVIRONMENT'] = 'Development'
env['ASPNETCORE_URLS'] = 'http://127.0.0.1:' + env.get('API_PORT', '5193')
env['Transit__Database'] = str(root / '.data/transit.sqlite')
for setting, key in [('VEHICLES_URL', 'Transit__VehiclesUrl'), ('AUTOCOMPLETE_URL', 'Geocoding__AutocompleteUrl'), ('GEOCODING_URL', 'Geocoding__BaseUrl'), ('GEOCODING_USER_AGENT', 'Geocoding__UserAgent')]:
    if setting in env:
        env.setdefault(key, env[setting])
env['DOTNET_WATCH_SUPPRESS_BROWSER_REFRESH'] = '1'
env['DOTNET_WATCH_SUPPRESS_STATIC_FILE_HANDLING'] = '1'
children = []


def cleanup():
    for child in children:
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def interrupted(*_):
    raise SystemExit(130)


signal.signal(signal.SIGINT, interrupted)
signal.signal(signal.SIGTERM, interrupted)
try:
    children.append(subprocess.Popen([dotnet, 'watch', '--project', 'src/Cria.Web', 'run', '--no-launch-profile'], cwd=root, env=env, start_new_session=True))
    children.append(subprocess.Popen(['npm', 'run', 'dev', '--prefix', 'frontend'], cwd=root, env=env, start_new_session=True))
    while all(child.poll() is None for child in children):
        time.sleep(.5)
    status = next(child.returncode for child in children if child.returncode is not None)
finally:
    cleanup()
sys.exit(status)
