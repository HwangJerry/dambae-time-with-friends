"""Promote only a reviewed Kustomize image patch; observe the exact live release."""
import base64
from copy import deepcopy
import json
from urllib.parse import quote, urlencode

from .contract import DIGEST, require
from .http import Http, RemoteError

RELEASE_ANNOTATION = 'deploy.malfunctionroom.cloud/request-id'
SOURCE_ANNOTATION = 'deploy.malfunctionroom.cloud/source-sha'
PATCH_FILE = 'release.json'
MAX_CONFLICT_RETRIES = 3


def release_patch(profile, image, request_id, source_sha):
    return {'apiVersion': 'apps/v1', 'kind': profile['kind'],
            'metadata': {'name': profile['workload'], 'namespace': profile['namespace']},
            'spec': {'template': {'metadata': {'annotations': {
                RELEASE_ANNOTATION: request_id, SOURCE_ANNOTATION: source_sha}},
                'spec': {'containers': [{'name': profile['container'], 'image': image}]}}}}


class GitOps:
    def __init__(self, token, http=None):
        self.token = token
        self.http = http or Http()

    def promote(self, profile, artifact, request_id):
        image = artifact['image']
        require(image.startswith(profile['image'] + '@') and DIGEST.fullmatch(image.split('@')[-1]),
                '배포 이미지 digest가 허용된 저장소와 일치하지 않아요.')
        path = profile['path'].rstrip('/') + '/' + PATCH_FILE
        url = f"https://api.github.com/repos/{profile['repository']}/contents/{quote(path, safe='/')}"
        desired = release_patch(profile, image, request_id, artifact['source_sha'])
        for attempt in range(MAX_CONFLICT_RETRIES):
            current = self.http.json(url + '?' + urlencode({'ref': profile['branch']}), token=self.token)
            try:
                old = json.loads(base64.b64decode(current['content']))
                require(old['kind'] == profile['kind'] and old['metadata']['name'] == profile['workload']
                        and old['metadata']['namespace'] == profile['namespace'], '기존 배포 패치의 대상이 달라요.')
                require(set(old) <= {'apiVersion', 'kind', 'metadata', 'spec'}, '배포 패치 형식을 확인해 주세요.')
            except (KeyError, TypeError, ValueError):
                raise ValueError('검토한 release.json 패치를 운영 설정 저장소에 먼저 준비해 주세요.') from None
            if old == desired:
                return {'status': 'promoted', 'request_id': request_id, 'image': image, 'reused': True}
            # Preserve everything except the declared container image and release annotations.
            changed = deepcopy(old)
            containers = changed['spec']['template']['spec']['containers']
            matches = [item for item in containers if item['name'] == profile['container']]
            require(len(matches) == 1, '배포 패치에 대상 컨테이너가 하나 있어야 해요.')
            matches[0]['image'] = image
            annotations = changed['spec']['template'].setdefault('metadata', {}).setdefault('annotations', {})
            if annotations.get(RELEASE_ANNOTATION) == request_id:
                require(annotations.get(SOURCE_ANNOTATION) == artifact['source_sha'] and
                        old['spec']['template']['spec']['containers'] == containers,
                        '같은 요청 ID에 다른 산출물이 연결됐어요.')
                return {'status': 'promoted', 'request_id': request_id, 'image': image, 'reused': True}
            annotations.update(desired['spec']['template']['metadata']['annotations'])
            body = {'message': f"deploy: {profile['application']} ({request_id})", 'branch': profile['branch'],
                    'sha': current['sha'], 'content': base64.b64encode((json.dumps(changed, indent=2) + '\n').encode()).decode()}
            try:
                result = self.http.json(url, token=self.token, method='PUT', body=body)
                return {'status': 'promoted', 'request_id': request_id, 'image': image, 'revision': result['commit']['sha']}
            except RemoteError as error:
                # Conflict is a known failed write. All other outcomes are ambiguous;
                # the caller must inspect the same request marker, never create a new release.
                if error.status != 409 or attempt == MAX_CONFLICT_RETRIES - 1:
                    raise
        raise RemoteError(409)


class ArgoCD:
    def __init__(self, token, http=None):
        self.token = token
        self.http = http or Http()

    def request_sync(self, profile, promotion):
        # During adoption Applications can remain auto-sync disabled. An explicit
        # authorized release syncs only after its Git promotion, never on registration.
        base = profile['server'].rstrip('/') + '/api/v1/applications/' + quote(profile['application'], safe='')
        app = self.http.json(base + '?' + urlencode({'project': profile['project']}), token=self.token)
        automatic = app.get('spec', {}).get('syncPolicy', {}).get('automated')
        if automatic is not None and automatic.get('enabled', True):
            return
        require(profile.get('allow_manual_sync') is True, '초기 동기화가 잠겨 있어요. 배포 대상의 수동 동기화 권한을 준비해 주세요.')
        self.http.json(base + '/sync', token=self.token, method='POST', body={
            'name': profile['application'], 'project': profile['project'],
            'revision': promotion.get('revision', profile['branch']), 'prune': False, 'dryRun': False})

    def observe(self, profile, artifact, request_id):
        base = profile['server'].rstrip('/') + '/api/v1/applications/' + quote(profile['application'], safe='')
        app = self.http.json(base + '?' + urlencode({'project': profile['project'], 'refresh': 'normal'}), token=self.token)
        spec = app.get('spec', {})
        source = spec.get('source', {})
        expected_repo = 'https://github.com/' + profile['repository']
        require(source.get('repoURL', '').removesuffix('.git') == expected_repo and source.get('path') == profile['path']
                and source.get('targetRevision') == profile['branch'] and spec.get('project') == profile['project']
                and spec.get('destination', {}).get('namespace') == profile['namespace'],
                'Argo CD 앱과 승인된 배포 대상 프로필이 달라요.')
        status = app.get('status', {})
        if status.get('sync', {}).get('status') != 'Synced' or status.get('health', {}).get('status') != 'Healthy':
            return {'status': 'reconciling', 'reason': '클러스터가 요청한 버전으로 준비되기를 기다리고 있어요.'}
        query = urlencode({'namespace': profile['namespace'], 'resourceName': profile['workload'],
                           'version': 'v1', 'group': 'apps', 'kind': profile['kind'], 'project': profile['project']})
        resource = self.http.json(base + '/resource?' + query, token=self.token)
        live = json.loads(resource.get('manifest', '{}'))
        template = live.get('spec', {}).get('template', {})
        annotations = template.get('metadata', {}).get('annotations', {})
        images = {item['name']: item.get('image') for item in template.get('spec', {}).get('containers', [])}
        exact = annotations.get(RELEASE_ANNOTATION) == request_id and annotations.get(SOURCE_ANNOTATION) == artifact['source_sha']
        exact = exact and images.get(profile['container']) == artifact['image']
        if not exact:
            return {'status': 'reconciling', 'reason': '이전 버전이 정상 동작 중이며 요청한 버전의 반영을 기다리고 있어요.'}
        live_status = live.get('status', {})
        replicas = live.get('spec', {}).get('replicas', 1)
        ready = replicas > 0 and live_status.get('observedGeneration', 0) >= live.get('metadata', {}).get('generation', 1)
        ready = ready and live_status.get('updatedReplicas', 0) == replicas and live_status.get('readyReplicas', 0) == replicas
        if not ready or not self.http.healthy(profile['health_url']):
            return {'status': 'verifying', 'reason': '배포 버전의 준비 상태와 서비스 응답을 확인하고 있어요.'}
        return {'status': 'succeeded', 'reason': None}
