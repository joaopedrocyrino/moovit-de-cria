#!/usr/bin/env python3
"""Resolve a real SDK executable even when dotnet is only a shell alias."""
import os,shutil,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];env=os.environ.copy()
dotnet=shutil.which('dotnet')
if not dotnet:
 candidates=[Path(env.get('DOTNET_ROOT','/nonexistent'))/'dotnet',Path.home()/'.dotnet/dotnet',Path('/usr/local/share/dotnet/dotnet'),Path('/usr/share/dotnet/dotnet')]
 dotnet=next((str(p) for p in candidates if p.is_file() and os.access(p,os.X_OK)),None)
if not dotnet:sys.exit('Install the .NET 10 SDK or set DOTNET_ROOT.')
env['PATH']=str(Path(dotnet).resolve().parent)+os.pathsep+env.get('PATH','');env.setdefault('DOTNET_ROOT',str(Path(dotnet).resolve().parent))
sys.exit(subprocess.call([dotnet,*sys.argv[1:]],cwd=root,env=env))
