#!/usr/bin/env python3
"""Stream GTFS into a compact SQLite snapshot and publish it atomically."""
import argparse,csv,datetime,decimal,hashlib,io,json,os,shutil,sqlite3,tempfile,time,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if (ROOT/'.env').exists():
 for line in (ROOT/'.env').read_text().splitlines():
  if line and not line.startswith('#') and '=' in line:
   key,value=line.split('=',1);os.environ.setdefault(key,value)
def progress(message):
 print('GTFS: '+message,flush=True)
def install_snapshot(source,output,expected_source):
 source=Path(source);output=Path(output)
 if not source.is_file():raise ValueError('Prepared GTFS snapshot missing. Build the release image with PREPARE_GTFS=1.')
 if source.stat().st_size>750*1048576:raise ValueError('Prepared snapshot exceeds 750 MiB')
 output.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.transit-',suffix='.sqlite',dir=output.parent)
 try:
  progress('Installing prepared timetable snapshot (no feed download or CSV processing)')
  with os.fdopen(fd,'wb') as target,source.open('rb') as origin:
   shutil.copyfileobj(origin,target,length=1048576);target.flush();os.fsync(target.fileno())
  db=sqlite3.connect(Path(tmp).resolve().as_uri()+'?mode=ro',uri=True)
  try:
   db.execute('PRAGMA cache_size=-2000')
   if db.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:raise ValueError('Prepared snapshot failed SQLite integrity validation')
   for table in ('stops','patterns','services','shapes','metadata'):
    db.execute(f'SELECT 1 FROM {table} LIMIT 1')
   if not db.execute('SELECT 1 FROM stops LIMIT 1').fetchone() or not db.execute('SELECT 1 FROM patterns LIMIT 1').fetchone():raise ValueError('Prepared snapshot has no usable stops or patterns')
   meta=dict(db.execute('SELECT key,value FROM metadata'))
   if meta.get('source')!=expected_source:raise ValueError('Prepared snapshot source differs from GTFS_URL. Set the public GTFS_URL repository variable to match the droplet setting and build a new release.')
   if meta.get('validUntil'):
    rio_today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).date()
    if datetime.datetime.strptime(meta['validUntil'],'%Y%m%d').date()<rio_today:raise ValueError('Prepared timetable snapshot has expired; build a new release')
  finally:db.close()
  os.chmod(tmp,0o644);os.replace(tmp,output)
  progress(f'Prepared snapshot installed atomically: {output.stat().st_size//1048576} MiB')
 except BaseException:Path(tmp).unlink(missing_ok=True);raise
def seconds(v):
 h,m,s=map(int,v.split(':'))
 if not 0<=m<60 or not 0<=s<60 or not 0<=h<=47:raise ValueError('Invalid GTFS time')
 return h*3600+m*60+s
def rows(z,name,required=False):
 entry=next((p for p in z.namelist() if p.rsplit('/',1)[-1]==name),None)
 if not entry:
  if required:raise ValueError('Missing '+name)
  return
 progress('Reading '+name)
 count=0;last=time.monotonic()
 with z.open(entry) as raw:
  for row in csv.DictReader(io.TextIOWrapper(raw,encoding='utf-8-sig',newline='')):
   count+=1
   if count%10000==0 and time.monotonic()-last>=15:
    progress(f'{name}: {count:,} rows read');last=time.monotonic()
   yield row
 progress(f'{name}: {count:,} rows read; complete')
def build(archive,output,source):
 progress('Preparing SQLite snapshot')
 output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.transit-',suffix='.sqlite',dir=output.parent);os.close(fd);db=sqlite3.connect(tmp)
 try:
  db.executescript('''PRAGMA journal_mode=OFF;PRAGMA cache_size=-16000;
  CREATE TABLE stops(id TEXT PRIMARY KEY,name TEXT,lat REAL,lon REAL);
  CREATE TABLE patterns(id TEXT PRIMARY KEY,payload TEXT);
  CREATE TABLE services(id TEXT PRIMARY KEY,payload TEXT);
  CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);
  CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
  CREATE TABLE raw_times(trip TEXT,seq INTEGER,stop TEXT,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER);''')
  with zipfile.ZipFile(archive) as z:
   if sum(i.file_size for i in z.infolist())>750*1048576:raise ValueError('Uncompressed feed exceeds 750 MiB')
   stops={}
   for r in rows(z,'stops.txt',True):
    lat,lon=float(r['stop_lat']),float(r['stop_lon'])
    if -23.12<=lat<=-22.72 and -43.85<=lon<=-43.08:stops[r['stop_id']]=(r['stop_id'],r['stop_name'],lat,lon)
   db.executemany('INSERT INTO stops VALUES(?,?,?,?)',stops.values())
   routes={r['route_id']:r for r in rows(z,'routes.txt',True)};trips={r['trip_id']:r for r in rows(z,'trips.txt',True)}
   prices={}
   for r in rows(z,'fare_attributes.txt'):
    if r['currency_type']=='BRL':
     amount=decimal.Decimal(r['price'])*100
     if amount!=amount.to_integral_value() or amount<0:raise ValueError('Invalid fare cents')
     prices[r['fare_id']]=int(amount)
   fares={}
   for r in rows(z,'fare_rules.txt'):
    if r.get('route_id') and r['fare_id'] in prices:fares.setdefault(r['route_id'],set()).add(prices[r['fare_id']])
   freq={}
   for r in rows(z,'frequencies.txt'):freq.setdefault(r['trip_id'],[]).append((seconds(r['start_time']),seconds(r['end_time']),int(r['headway_secs']),r.get('exact_times','0')=='1'))
   services={}
   for r in rows(z,'calendar.txt'):services[r['service_id']]={'id':r['service_id'],'start':r['start_date'],'end':r['end_date'],'days':[int(r[x]) for x in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')],'exceptions':{}}
   for r in rows(z,'calendar_dates.txt'):
    s=services.setdefault(r['service_id'],{'id':r['service_id'],'start':'00000000','end':'00000000','days':[0]*7,'exceptions':{}});s['exceptions'][r['date']]=int(r['exception_type'])
   batch=[]
   for r in rows(z,'stop_times.txt',True):
    if r['trip_id'] not in trips or r['stop_id'] not in stops or not r.get('arrival_time') or not r.get('departure_time'):continue
    batch.append((r['trip_id'],int(r['stop_sequence']),r['stop_id'],seconds(r['arrival_time']),seconds(r['departure_time']),r.get('pickup_type','0') in ('','0'),r.get('drop_off_type','0') in ('','0')))
    if len(batch)>=5000:db.executemany('INSERT INTO raw_times VALUES(?,?,?,?,?,?,?)',batch);batch=[]
   db.executemany('INSERT INTO raw_times VALUES(?,?,?,?,?,?,?)',batch)
   progress('Indexing stop times')
   db.execute('CREATE INDEX raw_order ON raw_times(trip,seq)')
   patterns={};current=None;times=[]
   def flush():
    if len(times)<2:return
    t=trips[current];route=routes.get(t['route_id'])
    if not route:return
    base=times[0][4]
    if any(b[3]<a[4] for a,b in zip(times,times[1:])):return
    sequence=[{'stopId':r[2],'arrival':r[3]-base,'departure':r[4]-base,'pickup':bool(r[5]),'dropoff':bool(r[6])} for r in times]
    shape=t.get('shape_id','');direction=int(t.get('direction_id') or 0)
    key=hashlib.sha256(json.dumps([t['route_id'],shape,direction,t.get('trip_headsign',''),sequence],sort_keys=True).encode()).hexdigest()[:24]
    mode='brt' if route.get('agency_id')=='20001' else {'0':'tram','1':'metro','2':'rail','4':'ferry'}.get(route['route_type'],'bus')
    amounts=fares.get(t['route_id'],set());fare=next(iter(amounts)) if len(amounts)==1 else None
    p=patterns.setdefault(key,{'id':key,'routeId':t['route_id'],'line':route['route_short_name'],'name':route['route_long_name'],'mode':mode,'direction':direction,'headsign':t.get('trip_headsign') or route['route_long_name'],'shapeId':shape,'color':route.get('route_color') or '145A49','fareCents':fare,'municipal':route.get('agency_id') in {'22002','22003','22004','22005','20001'} and fare==500,'stops':sequence,'windows':[]})
    for start,end,headway,exact in freq.get(current,[(base,base+1,0,True)]):
     if end<=start or headway<0:raise ValueError('Invalid frequency window')
     w={'serviceId':t['service_id'],'start':start,'end':end,'headway':headway,'exact':exact}
     if w not in p['windows']:p['windows'].append(w)
   progress('Building timetable patterns')
   processed=0;last=time.monotonic()
   for r in db.execute('SELECT * FROM raw_times ORDER BY trip,seq'):
    processed+=1
    if processed%10000==0 and time.monotonic()-last>=15:
     progress(f'Patterns: {processed:,} stop times processed');last=time.monotonic()
    if current!=r[0]:flush();current=r[0];times=[]
    times.append(r)
   flush()
   db.executemany('INSERT INTO patterns VALUES(?,?)',((p['id'],json.dumps(p,separators=(',',':'))) for p in patterns.values()))
   db.executemany('INSERT INTO services VALUES(?,?)',((s['id'],json.dumps(s)) for s in services.values()))
   used={p['shapeId'] for p in patterns.values()};batch=[]
   for r in rows(z,'shapes.txt'):
    if r['shape_id'] not in used:continue
    batch.append((r['shape_id'],int(r['shape_pt_sequence']),float(r['shape_pt_lat']),float(r['shape_pt_lon'])))
    if len(batch)>=5000:db.executemany('INSERT INTO shapes VALUES(?,?,?,?)',batch);batch=[]
   db.executemany('INSERT INTO shapes VALUES(?,?,?,?)',batch)
   progress('Indexing map shapes')
   db.execute('CREATE INDEX shapes_order ON shapes(id,seq)')
   meta={'source':source,'importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};info=next(rows(z,'feed_info.txt'),None)
   if info and info.get('feed_end_date'):meta['validUntil']=info['feed_end_date']
   db.executemany('INSERT INTO metadata VALUES(?,?)',meta.items())
  if not patterns or not stops:raise ValueError('No usable Rio services')
  progress('Finalizing and compacting SQLite snapshot')
  db.execute('DROP TABLE raw_times');db.commit();db.execute('VACUUM');db.close();os.chmod(tmp,0o644);os.replace(tmp,output)
  progress(f'Imported {len(stops)} stops and {len(patterns)} patterns; {output.stat().st_size//1048576} MiB. Snapshot replaced atomically.')
 except BaseException:db.close();Path(tmp).unlink(missing_ok=True);raise
if __name__=='__main__':
 p=argparse.ArgumentParser();inputs=p.add_mutually_exclusive_group();inputs.add_argument('--file',type=Path);inputs.add_argument('--snapshot',type=Path);p.add_argument('--url',default=os.getenv('GTFS_URL','https://dados.mobilidade.rio/gtfs/schedule'));p.add_argument('--output',type=Path,default=ROOT/'.data/transit.sqlite');a=p.parse_args()
 if a.snapshot:install_snapshot(a.snapshot,a.output,a.url)
 elif a.file:build(a.file,a.output,'SMTR GTFS / '+a.file.name)
 else:
  progress('Downloading Rio timetable feed')
  with tempfile.TemporaryDirectory() as folder:
   dest=Path(folder)/'gtfs.zip';request=urllib.request.Request(a.url,headers={'User-Agent':'MoovitDeCria/1.0 (+https://github.com/joaopedrocyrino)'})
   with urllib.request.urlopen(request,timeout=90) as response,dest.open('wb') as output:
    count=0;last=time.monotonic()
    while chunk:=response.read(1048576):
     count+=len(chunk)
     if count>150*1048576:raise ValueError('Feed download exceeds 150 MiB')
     output.write(chunk)
     if time.monotonic()-last>=15:
      progress(f'Downloaded {count//1048576} MiB');last=time.monotonic()
   progress(f'Download complete: {count//1048576} MiB')
   build(dest,a.output,a.url)
