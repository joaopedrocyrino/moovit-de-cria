import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pages_config', Path(__file__).parents[2] / 'scripts/check-pages-config.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesPreflightTests(unittest.TestCase):
    def setUp(self):
        env = {key: 'test-value' for key in ['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_SSH_KEY',
               'DEPLOY_SSH_KNOWN_HOSTS', 'GHCR_USERNAME', 'GHCR_TOKEN', 'CLOUDFLARE_API_TOKEN']}
        env['CLOUDFLARE_ACCOUNT_ID'] = 'a' * 32
        self.environ = patch.dict(os.environ, env, clear=True)
        self.environ.start()
        self.addCleanup(self.environ.stop)

    def response(self, branch):
        return io.BytesIO(json.dumps({'success': True, 'result': {'production_branch': branch}}).encode())

    def test_main_project_is_accepted(self):
        with patch.object(pages.urllib.request, 'urlopen', return_value=self.response('main')) as request:
            pages.main()
        self.assertEqual(request.call_args.args[0].full_url,
                         'https://api.cloudflare.com/client/v4/accounts/' + 'a' * 32 + '/pages/projects/moovit-de-cria')

    def test_missing_secret_fails_before_request(self):
        del os.environ['CLOUDFLARE_API_TOKEN']
        with patch.object(pages.urllib.request, 'urlopen') as request:
            with self.assertRaisesRegex(SystemExit, 'Missing production secret: CLOUDFLARE_API_TOKEN'):
                pages.main()
        request.assert_not_called()

    def test_wrong_production_branch_is_rejected(self):
        with patch.object(pages.urllib.request, 'urlopen', return_value=self.response('staging')):
            with self.assertRaisesRegex(SystemExit, 'production branch main'):
                pages.main()

    def test_provider_error_does_not_expose_response_or_token(self):
        with patch.object(pages.urllib.request, 'urlopen', side_effect=pages.urllib.error.URLError('test-value')):
            with self.assertRaises(SystemExit) as error:
                pages.main()
        self.assertNotIn('test-value', str(error.exception))
        self.assertIn('Cannot access the Pages project', str(error.exception))
