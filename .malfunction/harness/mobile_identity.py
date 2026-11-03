"""Bind store observations to the exact signed artifact, never the latest app."""
import os
from pathlib import PurePosixPath
import plistlib
import subprocess
import xml.etree.ElementTree as ET
import zipfile

from .contract import require

MAX_IDENTITY_BYTES = 1024 * 1024
ANDROID_NAMESPACE = '{http://schemas.android.com/apk/res/android}'


def identity(filename, kind):
    if kind == 'ios':
        with zipfile.ZipFile(filename) as archive:
            matches = [item for item in archive.infolist() if len(PurePosixPath(item.filename).parts) == 3
                       and item.filename.startswith('Payload/') and item.filename.endswith('.app/Info.plist')]
            require(len(matches) == 1 and matches[0].file_size <= MAX_IDENTITY_BYTES, 'IPA 앱 정보를 확인하지 못했어요.')
            info = plistlib.loads(archive.read(matches[0]))
        result = {'app_id': info.get('CFBundleIdentifier'), 'version': info.get('CFBundleShortVersionString'),
                  'build_number': info.get('CFBundleVersion')}
    else:
        jar = os.environ.get('BUNDLETOOL_JAR')
        require(jar, 'AAB 식별자 검증에 사용할 BUNDLETOOL_JAR 경로가 필요해요.')
        try:
            process = subprocess.run(['java', '-jar', jar, 'dump', 'manifest', '--bundle=' + str(filename), '--module=base'],
                                     check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
            require(len(process.stdout) <= MAX_IDENTITY_BYTES, 'AAB 매니페스트가 너무 커요.')
            node = ET.fromstring(process.stdout)
            result = {'app_id': node.get('package'), 'version': node.get(ANDROID_NAMESPACE + 'versionName'),
                      'build_number': node.get(ANDROID_NAMESPACE + 'versionCode')}
        except (OSError, subprocess.SubprocessError, ET.ParseError):
            raise ValueError('bundletool로 AAB 앱 식별자·버전을 확인하지 못했어요.') from None
    require(all(isinstance(v, str) and v and len(v) <= 255 for v in result.values()), '모바일 앱 식별자·버전·빌드 번호가 필요해요.')
    if kind == 'android':
        require(result['build_number'].isdigit(), 'Android versionCode는 정수여야 해요.')
    return result
