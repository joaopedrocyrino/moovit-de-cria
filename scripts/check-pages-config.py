#!/usr/bin/env python3
"""Validate the Pages destination before the workflow changes the droplet."""
import json
import os
import re
import urllib.error
import urllib.request


def main():
    required = ['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_SSH_KEY', 'DEPLOY_SSH_KNOWN_HOSTS',
                'GHCR_USERNAME', 'GHCR_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
    for key in required:
        if not os.environ.get(key):
            raise SystemExit('Missing production secret: ' + key)
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    project = os.environ.get('CLOUDFLARE_PAGES_PROJECT') or 'moovit-de-cria'
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', project):
        raise SystemExit('Invalid Cloudflare account ID or Pages project name.')
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}',
        headers={'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN']})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
    except (urllib.error.URLError, ValueError):
        raise SystemExit('Cannot access the Pages project. Check its name, account and Pages Edit token.') from None
    if not data.get('success') or data.get('result', {}).get('production_branch') != 'main':
        raise SystemExit('Create the Direct Upload Pages project with production branch main first.')
    print('Production configuration present; Pages project uses main.')


if __name__ == '__main__':
    main()
