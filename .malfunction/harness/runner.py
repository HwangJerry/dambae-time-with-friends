"""Deterministic build/release commands. No AI, shell interpolation or kubectl."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import time
from uuid import UUID

from .contract import (DIGEST, SHA, ConfigurationError, database_gate, local_path,
                       manifest, require, target_profile)
from .gitops import ArgoCD, GitOps

COMMAND_TIMEOUT_SECONDS = 1800
ROLLOUT_TIMEOUT_SECONDS = 600
OBSERVE_INTERVAL_SECONDS = 10


def execute(argv, *, cwd, env=None):
    try:
        # Commands may emit build diagnostics, but never echo the environment.
        subprocess.run(argv, cwd=cwd, env=env, check=True, timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f'{argv[0]} 단계가 종료 코드 {error.returncode}로 실패했어요.') from None
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f'{argv[0]} 실행 환경 또는 제한 시간을 확인해 주세요.') from None


def repository_sha(root):
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, check=True, capture_output=True, text=True)
    sha = result.stdout.strip()
    require(SHA.fullmatch(sha), '체크아웃한 커밋 SHA를 확인하지 못했어요.')
    return sha


def component_at(root, component_id):
    document = manifest(json.loads(local_path(root, '.malfunction/deploy.json').read_text()))
    matches = [item for item in document['components'] if item['id'] == component_id and item['kind'] != 'shared']
    require(len(matches) == 1, '배포 단위를 찾지 못했어요.')
    return matches[0]


def build(root, component_id, source_sha, *, run=execute):
    require(repository_sha(root) == source_sha, '요청한 커밋과 체크아웃한 커밋이 달라요.')
    component = component_at(root, component_id)
    directory = local_path(root, component['root'])
    for argv in component['build']['checks']:
        run(argv, cwd=directory)
    result = {'version': 1, 'component': component_id, 'source_sha': source_sha,
              'manifest_sha256': hashlib.sha256(local_path(root, '.malfunction/deploy.json').read_bytes()).hexdigest()}
    recipe = component['build']
    if component['kind'] in ('android', 'ios'):
        run(['bundle', 'exec', 'fastlane', component['kind'], recipe['lane']], cwd=directory)
        artifact = local_path(root, recipe['artifact'])
        require(artifact.is_file(), 'fastlane 빌드 산출물을 찾지 못했어요.')
        relative = f'.malfunction/output/{component_id}/application' + artifact.suffix
        exported = local_path(root, relative)
        exported.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(artifact, exported)
        result.update(file=relative, sha256=hashlib.sha256(exported.read_bytes()).hexdigest())
        return result
    dockerfile = local_path(root, recipe['dockerfile'])
    context = local_path(root, recipe['context'])
    with tempfile.TemporaryDirectory(prefix='malfunction-build-') as scratch:
        metadata = Path(scratch) / 'metadata.json'
        cache = recipe['image'] + ':buildcache'
        run(['docker', 'buildx', 'build', '--file', str(dockerfile), '--platform', recipe['platform'],
             '--tag', recipe['image'] + ':sha-' + source_sha, '--push',
             '--cache-from', 'type=registry,ref=' + cache,
             '--cache-to', 'type=registry,ref=' + cache + ',mode=max',
             '--metadata-file', str(metadata), str(context)], cwd=root)
        digest = json.loads(metadata.read_text()).get('containerimage.digest')
        require(isinstance(digest, str) and DIGEST.fullmatch(digest), '빌드 이미지 digest가 필요해요.')
        result['image'] = recipe['image'] + '@' + digest
    return result


def release(root, component_id, source_sha, artifact, request_id, profiles, *, environ=None,
            gitops=None, argocd=None, clock=time.monotonic, sleep=time.sleep, run=execute):
    environ = os.environ if environ is None else environ
    require(str(UUID(request_id)) == request_id, '배포 요청 ID를 확인해 주세요.')
    require(repository_sha(root) == source_sha, '요청한 커밋과 체크아웃한 커밋이 달라요.')
    component = component_at(root, component_id)
    database_gate(root, component)
    require(artifact.get('version') == 1 and artifact.get('source_sha') == source_sha
            and artifact.get('component') == component_id, '산출물이 요청한 배포 단위·커밋과 달라요.')
    require(artifact.get('manifest_sha256') == hashlib.sha256(local_path(root, '.malfunction/deploy.json').read_bytes()).hexdigest(),
            '산출물의 빌드 설정이 달라요.')
    profile = target_profile(profiles.get(component['target']), environ.get('GITHUB_REPOSITORY'), component)
    approved_database = profile.get('database')
    require(isinstance(approved_database, dict) and approved_database == component['database'],
            '운영 대상에 승인된 DB 정책과 저장소 설정이 달라요. DB 호환성 검토를 먼저 완료해 주세요.')
    if profile['type'] == 'fastlane':
        return mobile_release(root, component, artifact, profile, request_id, environ=environ, run=run)
    git_token = environ.get('MALFUNCTION_GITOPS_TOKEN', '')
    argo_token = environ.get('MALFUNCTION_ARGOCD_TOKEN', '')
    require(gitops is not None or git_token, '운영 설정 저장소 인증이 필요해요.')
    require(argocd is not None or argo_token, 'Argo CD 상태 조회 인증이 필요해요.')
    gitops = gitops or GitOps(git_token)
    argocd = argocd or ArgoCD(argo_token)
    # Check target identity before changing desired state.
    argocd.observe(profile, artifact, request_id)
    promotion = gitops.promote(profile, artifact, request_id)
    argocd.request_sync(profile, promotion)
    print(json.dumps({'stage': 'promoted', 'component': component_id, 'request_id': request_id}), flush=True)
    deadline = clock() + ROLLOUT_TIMEOUT_SECONDS
    while clock() < deadline:
        result = argocd.observe(profile, artifact, request_id)
        if result['status'] == 'succeeded':
            return dict(result, component=component_id, source_sha=source_sha, request_id=request_id, promotion=promotion)
        sleep(OBSERVE_INTERVAL_SECONDS)
    # A timeout is not rollback permission; GitOps may converge after this process stops.
    raise RuntimeError('운영 설정은 반영됐지만 배포 확인 시간이 지났어요. Argo CD에서 실제 상태를 확인해 주세요.')


def mobile_release(root, component, artifact, profile, request_id, *, environ, run):
    filename = local_path(root, artifact['file'])
    require(filename.is_file() and hashlib.sha256(filename.read_bytes()).hexdigest() == artifact['sha256'],
            '모바일 산출물 해시가 빌드 결과와 달라요.')
    env = dict(environ, MALFUNCTION_APP_ID=profile['app_id'], MALFUNCTION_ARTIFACT=str(filename))
    # Store metadata and credentials must be supplied by the operator. Nothing is invented.
    if component['kind'] == 'ios':
        require(env.get('APP_STORE_CONNECT_API_KEY_PATH'), 'App Store Connect API 키 파일이 필요해요.')
    else:
        require(env.get('SUPPLY_JSON_KEY'), 'Google Play 서비스 계정 키 파일이 필요해요.')
    if component['kind'] == 'ios':
        command = ['bundle', 'exec', 'fastlane', 'run', 'upload_to_app_store',
                   'api_key_path:' + env['APP_STORE_CONNECT_API_KEY_PATH'], 'app_identifier:' + profile['app_id'],
                   'ipa:' + str(filename), 'submit_for_review:true', 'automatic_release:true',
                   'skip_metadata:true', 'skip_screenshots:true', 'force:true']
    else:
        command = ['bundle', 'exec', 'fastlane', 'run', 'upload_to_play_store',
                   'json_key:' + env['SUPPLY_JSON_KEY'], 'package_name:' + profile['app_id'],
                   'aab:' + str(filename), 'track:production', 'release_status:completed',
                   'skip_upload_metadata:true', 'skip_upload_images:true', 'skip_upload_screenshots:true']
    run(command, cwd=local_path(root, component['root']), env=env)
    return {'status': 'submitted', 'component': component['id'], 'source_sha': artifact['source_sha'],
            'request_id': request_id, 'reason': '스토어에 제출했어요. 심사 승인·출시 완료는 별도 상태 확인이 필요해요.'}
