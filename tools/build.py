#!/usr/bin/env python3
"""Build the LuCI APK and the E5 information-screen app with OpenWrt 25.12.5."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

TOP = Path(__file__).resolve().parents[1]
SDK_NAME = 'openwrt-sdk-25.12.5-armsr-armv8_gcc-14.3.0_musl.Linux-x86_64'
SDK_URL = f'https://downloads.openwrt.org/releases/25.12.5/targets/armsr/armv8/{SDK_NAME}.tar.zst'
SDK_SHA256 = '1b0316604a3e820b2b008a1baff3f9dac6716af942bef800930e58c7de98c98b'


def sdk_dir():
    cache = TOP / '.cache'
    cache.mkdir(exist_ok=True)
    archive = cache / 'sdk.tar.zst'
    if not archive.exists():
        partial = archive.with_suffix('.part')
        urllib.request.urlretrieve(SDK_URL, partial)
        partial.replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SDK_SHA256:
        raise ValueError('OpenWrt SDK checksum mismatch')
    sdk = cache / SDK_NAME
    if not sdk.exists():
        subprocess.run(['tar', '--zstd', '-xf', str(archive), '-C', str(cache)], check=True)
    return sdk


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, help='Existing OpenWrt 25.12.5 SDK directory')
    args = parser.parse_args()
    sdk = args.sdk.resolve() if args.sdk else sdk_dir()
    source = TOP / 'luci-app-e5-esim'
    target = sdk / 'package/luci-app-e5-esim'
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    shutil.copy2(source / 'Makefile', target)
    for name in ('root', 'htdocs'):
        shutil.copytree(source / name, target / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    subprocess.run(['make', 'defconfig'], cwd=sdk, check=True)
    for apk in (sdk / 'bin/packages').glob('*/*/luci-app-e5-esim-*.apk'):
        apk.unlink()
    subprocess.run(['make', 'package/luci-app-e5-esim/compile', 'V=s'], cwd=sdk, check=True)
    packages = list((sdk / 'bin/packages').glob('*/*/luci-app-e5-esim-*.apk'))
    if len(packages) != 1:
        raise RuntimeError(f'Expected one LuCI APK, found {len(packages)}')
    dist = TOP / 'dist'
    dist.mkdir(exist_ok=True)
    shutil.copy2(packages[0], dist / packages[0].name)
    stage = dist / 'esim'
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(TOP / 'esim', stage)
    bundled = stage / 'luci-app-e5-esim.apk'
    shutil.copy2(packages[0], bundled)
    digest = hashlib.sha256(bundled.read_bytes()).hexdigest()
    (stage / 'package.sha256').write_text(f'{digest}  {bundled.name}\n')
    version = json.loads((stage / 'manifest.json').read_text())['version']
    # Stable owner, ordering and timestamps keep the app archive reproducible.
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w', format=tarfile.GNU_FORMAT) as archive:
        for path in [stage, *sorted(stage.rglob('*'))]:
            info = archive.gettarinfo(str(path), str(path.relative_to(dist)))
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mtime = 1735689600
            info.mode = 0o755 if path.is_dir() else 0o644
            if path.is_file():
                with path.open('rb') as stream:
                    archive.addfile(info, stream)
            else:
                archive.addfile(info)
    output = dist / f'esim-{version}.tar.gz'
    with output.open('wb') as stream:
        with gzip.GzipFile(filename='', fileobj=stream, mode='wb', mtime=1735689600) as zipped:
            zipped.write(buffer.getvalue())
    print(f'Built {output} and {dist / packages[0].name}')


if __name__ == '__main__':
    main()
