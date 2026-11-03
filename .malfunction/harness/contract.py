"""Validate repository recipes and operator-owned destination profiles."""
from fnmatch import fnmatchcase
import hashlib
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlparse

ID = re.compile(r'[a-z][a-z0-9-]{0,62}')
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
IMAGE = re.compile(r'[a-z0-9][a-z0-9./:_-]+')
KINDS = ('web', 'backend', 'web-backend', 'android', 'ios', 'shared')
MAX_COMPONENTS = 32


class ConfigurationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ConfigurationError(message)


def path(value):
    require(isinstance(value, str) and value and '\\' not in value and '\x00' not in value,
            '저장소 상대 경로가 필요해요.')
    parsed = PurePosixPath(value)
    require(not parsed.is_absolute() and '..' not in parsed.parts and not value.startswith('-'),
            '저장소 밖의 경로는 사용할 수 없어요.')
    return value


def local_path(root, value):
    relative = path(value)
    target = (Path(root) / relative).resolve()
    require(target.is_relative_to(Path(root).resolve()), '심볼릭 링크가 저장소 밖을 가리켜요.')
    return target


def https_url(value):
    require(isinstance(value, str), 'HTTPS URL이 필요해요.')
    parsed = urlparse(value)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment, '자격 증명 없는 HTTPS URL이 필요해요.')
    return value.rstrip('/')


def commands(value):
    require(isinstance(value, list) and value, '필수 검증 명령을 명시해 주세요.')
    for argv in value:
        require(isinstance(argv, list) and argv and all(isinstance(v, str) and v and '\x00' not in v for v in argv),
                '검증 명령은 shell 문자열이 아닌 인자 목록이어야 해요.')


def manifest(value):
    require(isinstance(value, dict) and type(value.get('version')) is int and value['version'] == 2,
            '실행 가능한 배포 설정은 version 2여야 해요.')
    components = value.get('components')
    require(isinstance(components, list) and 0 < len(components) <= MAX_COMPONENTS, '배포 단위가 필요해요.')
    ids = set()
    for item in components:
        require(isinstance(item, dict), '배포 단위 형식이 잘못됐어요.')
        key = item.get('id')
        require(isinstance(key, str) and ID.fullmatch(key) and key not in ids, '배포 단위 ID를 확인해 주세요.')
        ids.add(key)
        require(item.get('kind') in KINDS, '지원하지 않는 배포 단위예요.')
        path(item.get('root'))
        watch = item.get('watch')
        require(isinstance(watch, list) and watch, '변경 감지 경로가 필요해요.')
        for pattern in watch:
            path(pattern)
        deps = item.get('depends_on', [])
        require(isinstance(deps, list) and all(isinstance(dep, str) for dep in deps), '빌드 의존 관계가 잘못됐어요.')
        if item['kind'] == 'shared':
            continue
        require(isinstance(item.get('target'), str) and ID.fullmatch(item['target']), '배포 대상 프로필을 선택해 주세요.')
        build = item.get('build')
        require(isinstance(build, dict), '빌드 설정이 필요해요.')
        commands(build.get('checks'))
        if 'node' in build:
            require(isinstance(build['node'], str) and re.fullmatch(r'\d+(?:\.\d+){0,2}', build['node']),
                    'Node 버전은 명시적인 버전 번호여야 해요.')
        db = item.get('database')
        require(isinstance(db, dict) and db.get('policy') in ('none', 'reviewed'), 'DB 변경 정책을 명시해 주세요.')
        if db['policy'] == 'reviewed':
            require(isinstance(db.get('watch'), list) and db['watch'], 'DB 변경 감지 경로가 필요해요.')
            for pattern in db['watch']:
                path(pattern)
            require(isinstance(db.get('approved'), dict), '검토한 DB 파일 해시가 필요해요.')
            for filename, digest in db['approved'].items():
                path(filename)
                require(isinstance(digest, str) and DIGEST.fullmatch(digest), 'DB 승인 해시가 잘못됐어요.')
        if item['kind'] in ('web', 'backend', 'web-backend'):
            path(build.get('dockerfile')); path(build.get('context'))
            require(build.get('platform') in ('linux/amd64', 'linux/arm64'), '이미지 아키텍처를 지정해 주세요.')
            require(isinstance(build.get('image'), str) and IMAGE.fullmatch(build['image']) and '@' not in build['image']
                    and ':' not in build['image'].split('/')[-1], '태그 없는 이미지 저장소가 필요해요.')
        else:
            require(isinstance(build.get('lane'), str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', build['lane']), '검토된 fastlane 빌드 lane이 필요해요.')
            path(build.get('artifact'))
            suffix = '.ipa' if item['kind'] == 'ios' else '.aab'
            require(build['artifact'].endswith(suffix), f'모바일 산출물은 {suffix} 파일이어야 해요.')
    ordered(components)
    return value


def ordered(components):
    pending = {item['id']: item for item in components}
    done, result = set(), []
    while pending:
        ready = [item for item in pending.values() if set(item.get('depends_on', [])) <= done]
        require(ready, '빌드 의존 관계에 미등록 단위 또는 순환이 있어요.')
        for item in ready:
            result.append(item); done.add(item['id']); del pending[item['id']]
    return result


def database_gate(root, component):
    db = component['database']
    if db['policy'] == 'none':
        return
    actual = {}
    for filename in Path(root).rglob('*'):
        relative = filename.relative_to(root).as_posix()
        if any(fnmatchcase(relative, pattern) for pattern in db['watch']) and filename.is_file():
            data = local_path(root, relative).read_bytes()
            actual[relative] = 'sha256:' + hashlib.sha256(data).hexdigest()
    require(actual == db['approved'], 'DB 관련 파일이 검토된 해시와 달라요. 호환성 검토 후 승인 목록을 갱신해 주세요.')


def target_profile(value, source, component):
    require(isinstance(value, dict) and value.get('source_repository') == source,
            '이 저장소에 허용된 배포 대상이 아니에요.')
    require(component['id'] in value.get('components', []), '이 배포 단위에 허용된 대상이 아니에요.')
    require(value.get('type') in ('argocd', 'fastlane'), '지원하지 않는 배포 대상이에요.')
    if value['type'] == 'argocd':
        require(component['kind'] in ('web', 'backend', 'web-backend'), '컨테이너 배포 단위가 아니에요.')
        require(value.get('image') == component['build']['image'], '허용된 이미지 저장소와 달라요.')
        for key in ('application', 'project', 'namespace', 'workload', 'container'):
            require(isinstance(value.get(key), str) and ID.fullmatch(value[key]), f'{key} 설정을 확인해 주세요.')
        require(value.get('kind') in ('Deployment', 'StatefulSet'), '지원하는 워크로드 종류를 지정해 주세요.')
        require(value.get('branch') in ('main', 'master'), '운영 설정 기본 브랜치를 확인해 주세요.')
        require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value.get('repository', '')),
                '운영 설정 GitHub 저장소가 필요해요.')
        path(value.get('path'))
        https_url(value.get('server')); https_url(value.get('health_url'))
        if 'cluster_server' in value:
            https_url(value['cluster_server'])
    else:
        require(component['kind'] in ('android', 'ios'), '모바일 배포 단위가 아니에요.')
        require(value.get('registered') is True, '스토어 최초 등록을 완료해야 해요.')
        require(isinstance(value.get('app_id'), str) and re.fullmatch(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+', value['app_id']),
                '스토어 앱 식별자가 필요해요.')
    return value
