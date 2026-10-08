#!/usr/bin/env python3
"""Exercise the production image on a disposable private Docker network, no real token."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid


def docker(*args, check=True):
    return subprocess.run(['docker', *args], check=check, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    args = parser.parse_args()
    fixture = Path('.data/transit.sqlite').resolve()
    if not fixture.is_file():
        raise SystemExit('Create the disposable test fixture first.')
    prefix = 'cria-origin-' + uuid.uuid4().hex[:10]
    peer, rogue, app = (prefix + suffix for suffix in ['-peer', '-rogue', '-app'])
    containers = []
    docker('network', 'create', '--internal', prefix)
    try:
        for name in [peer, rogue]:
            docker('run', '-d', '--name', name, '--network', prefix, '--entrypoint', 'python3',
                   args.image, '-c', 'import time; time.sleep(600)')
            containers.append(name)
        ip = json.loads(docker('inspect', peer).stdout)[0]['NetworkSettings']['Networks'][prefix]['IPAddress']
        docker('run', '-d', '--name', app, '--network', prefix, '--read-only', '--tmpfs', '/tmp',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '256m',
               '-v', str(fixture.parent) + ':/data:ro',
               '-e', 'ASPNETCORE_ENVIRONMENT=Production',
               '-e', 'Security__TrustedProxyIp=' + ip,
               '-e', 'Security__FrontendOrigin=https://moovit.joaocyrino.com',
               '-e', 'AllowedHosts=moovit-api.joaocyrino.com;localhost;127.0.0.1', args.image)
        containers.append(app)
        for _ in range(30):
            result = docker('exec', app, 'python3', '-c',
                            'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/api/health/ready",timeout=2)', check=False)
            if result.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise AssertionError('Production API failed local readiness: ' + docker('logs', '--tail', '30', app).stdout)

        def request(container, path='/api/config', *, client='203.0.113.7', origin=None, method='GET', extra=None):
            headers = {'Host': 'moovit-api.joaocyrino.com', 'CF-Connecting-IP': client, 'X-Forwarded-Proto': 'https'}
            if origin:
                headers['Origin'] = origin
            headers.update(extra or {})
            url = 'http://' + ('127.0.0.1' if container == app else app) + ':8080' + path
            script = '''import json, urllib.request, urllib.error
request=urllib.request.Request(URL,headers=HEADERS,method=METHOD)
try: response=urllib.request.urlopen(request,timeout=3)
except urllib.error.HTTPError as error: response=error
print(json.dumps({'status':response.code,'origin':response.headers.get('Access-Control-Allow-Origin')}))
'''.replace('URL', repr(url)).replace('HEADERS', repr(headers)).replace('METHOD', repr(method))
            return json.loads(docker('exec', container, 'python3', '-c', script).stdout)

        assert request(peer, origin='https://moovit.joaocyrino.com') == {'status': 200, 'origin': 'https://moovit.joaocyrino.com'}
        assert request(peer, origin='https://evil.example')['origin'] is None
        assert request(peer, method='OPTIONS', origin='https://moovit.joaocyrino.com',
                       extra={'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'})['status'] == 204
        assert request(rogue, extra={'X-Forwarded-For': ip})['status'] == 403
        assert request(peer, client='')['status'] == 403
        assert request(peer, extra={'X-Forwarded-Proto': 'http'})['status'] == 403
        assert request(app)['status'] == 403
        assert request(app, '/api/health/live')['status'] == 200
        assert request(peer, '/')['status'] == 404, 'Production API must not serve the React site'

        # Trusted CF client IP drives the limiter; spoofed XFF cannot create a new bucket.
        for _ in range(100):
            assert request(peer, client='203.0.113.99')['status'] == 200
        assert request(peer, client='203.0.113.99', extra={'X-Forwarded-For': '198.51.100.4'})['status'] == 429
        assert request(peer, client='198.51.100.4')['status'] == 200
        print('Production origin: direct access/spoofing blocked; CORS, local health, API-only image and per-client rate limiting passed.')
    finally:
        for name in reversed(containers):
            docker('rm', '-f', name, check=False)
        docker('network', 'rm', prefix, check=False)


if __name__ == '__main__':
    main()
