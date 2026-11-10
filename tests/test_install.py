#!/usr/bin/env python3
"""Exercise the asynchronous installer with a sandboxed package manager."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'esim/install.sh'


@unittest.skipUnless(shutil.which('flock') and shutil.which('sha256sum'), 'requires Linux host tools')
class Installer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.plugin = self.base / 'plugin'
        self.run = self.base / 'run'
        self.plugin.mkdir()
        self.binary = self.base / 'rpc'
        self.binary.write_text('#!/bin/sh\n')
        self.binary.chmod(0o755)
        self.script = self.plugin / 'install.sh'
        source = SOURCE.read_text().replace('DIR=/etc/e5-infoscreen/plugins/esim', f'DIR={self.plugin}')
        source = source.replace('RUN=/tmp/e5-webapp-esim', f'RUN={self.run}')
        source = source.replace('/usr/libexec/rpcd/e5-esim', str(self.binary))
        self.script.write_text(source)
        self.apk = self.plugin / 'luci-app-e5-esim.apk'
        self.apk.write_bytes(b'test package')
        digest = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        (self.plugin / 'package.sha256').write_text(f'{digest}  {self.apk.name}\n')
        manager = self.base / 'apk'
        manager.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$SANDBOX/calls"
case "$1" in
 info) test -f "$SANDBOX/installed" ;;
 update) sleep 0.2; test ! -f "$SANDBOX/fail" ;;
 add) touch "$SANDBOX/installed" ;;
esac
''')
        manager.chmod(0o755)
        self.env = dict(os.environ, PATH=f'{self.base}:{os.environ["PATH"]}', SANDBOX=str(self.base))

    def call(self, action):
        return subprocess.run(['sh', str(self.script), action], env=self.env,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode

    def wait(self):
        for _ in range(100):
            if (self.run / 'result').exists():
                # Wait for the lock to be released after the result is written.
                subprocess.run(['flock', str(self.run / 'lock'), 'true'], check=True)
                return (self.run / 'result').read_text().strip()
            time.sleep(0.03)
        self.fail('installer did not finish')

    def test_install_and_concurrent_start(self):
        self.assertNotEqual(self.call('check'), 0)
        self.assertEqual(self.call('start'), 0)
        self.assertEqual(self.call('start'), 0)
        self.assertEqual(self.wait(), '0')
        self.assertEqual(self.call('check'), 0)
        calls = (self.base / 'calls').read_text().splitlines()
        self.assertEqual(calls.count('update'), 1)
        self.assertEqual(calls.count('add --allow-untrusted ./luci-app-e5-esim.apk'), 1)

    def test_failure_and_retry(self):
        (self.base / 'fail').touch()
        self.call('start')
        self.assertNotEqual(self.wait(), '0')
        self.assertNotEqual(self.call('check'), 0)
        (self.base / 'fail').unlink()
        (self.run / 'result').unlink()
        self.call('start')
        self.assertEqual(self.wait(), '0')
        self.assertEqual(self.call('check'), 0)

    def test_checksum_failure_does_not_install(self):
        self.apk.write_bytes(b'corrupted package')
        self.call('start')
        self.assertNotEqual(self.wait(), '0')
        self.assertFalse((self.base / 'installed').exists())
        self.assertFalse((self.base / 'calls').exists())


if __name__ == '__main__':
    unittest.main()
