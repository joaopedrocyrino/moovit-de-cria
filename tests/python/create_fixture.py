"""Explicit synthetic Rio-coordinate feed for deterministic tests, never production data."""
import argparse,csv,io,tempfile,zipfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from import_gtfs import build

def fixture(output):
 with tempfile.TemporaryDirectory() as folder:
  path=Path(folder)/'fixture.zip'
  files={
   'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\na,Parada Teste A,-22.92,-43.21\nb,Parada Teste B,-22.92,-43.24\nc,Parada Teste C,-22.92,-43.28\n',
   'routes.txt':'route_id,agency_id,route_short_name,route_long_name,route_type\nr1,22003,104,Rota de teste 104,700\nr2,20001,22,BRT de teste,700\n',
   'trips.txt':'trip_id,route_id,service_id,trip_headsign,direction_id,shape_id\nt1,r1,all,Teste B,0,s1\nt2,r2,all,Teste C,0,s2\n',
   'stop_times.txt':'trip_id,stop_sequence,stop_id,arrival_time,departure_time\nt1,0,a,00:00:00,00:00:00\nt2,0,b,00:00:00,00:00:00\nt1,1,b,00:15:00,00:15:00\nt2,1,c,00:15:00,00:15:00\n',
   'frequencies.txt':'trip_id,start_time,end_time,headway_secs,exact_times\nt1,00:00:00,47:00:00,300,1\nt2,00:00:00,47:00:00,300,1\n',
   'calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20200101,20300101\n',
   'fare_attributes.txt':'fare_id,price,currency_type\nf,5.00,BRL\n',
   'fare_rules.txt':'fare_id,route_id\nf,r1\nf,r2\n',
   'shapes.txt':'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\ns1,0,-22.92,-43.21\ns1,1,-22.92,-43.24\ns2,0,-22.92,-43.24\ns2,1,-22.92,-43.28\n'}
  with zipfile.ZipFile(path,'w') as z:
   for name,text in files.items():z.writestr(name,text)
  build(path,output,'TEST FIXTURE — synthetic, not real schedules')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();fixture(a.output)
