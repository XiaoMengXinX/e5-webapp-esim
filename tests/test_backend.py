"""Run backend route tests with ucode in a temporary plugin directory."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

TOP = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('ucode'), 'requires ucode')
class Backend(unittest.TestCase):
    def test_installation_checks_are_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            plugin, run = base / 'plugin', base / 'run'
            plugin.mkdir()
            run.mkdir()
            for name in ('package.sha256', '.installed-sha256', '.install-attempt'):
                (plugin / name).write_text('original bundle\n')
            (run / 'result').write_text('0\n')
            source = (TOP / 'esim/backend.uc').read_text()
            source = source.replace('/etc/e5-infoscreen/plugins/esim', str(plugin))
            source = source.replace('/tmp/e5-webapp-esim', str(run))
            backend = base / 'backend.uc'
            backend.write_text(source)
            subprocess.run(['ucode', str(TOP / 'tests/backend.uc'), str(backend),
                            str(plugin), str(run)], check=True)


if __name__ == '__main__':
    unittest.main()
