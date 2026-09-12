# 친구 흡연장

사진을 참고한 초록 차양, 콘크리트 벽, 나무 벤치가 있는 3D 친구 흡연장. 최대 10명.

- 전체 화면 3D 공간 위에 방 정보와 마이크·채팅·담배 조작만 표시합니다. 소리·자막·참여자별 음소거·나가기는 오른쪽 위 설정에 있습니다.
- 방향키로 이동. 채팅 입력 중에는 움직이지 않습니다. 모바일에서는 화면 방향 버튼도 누르고 있을 수 있습니다. 카메라는 이동을 따라가며 사용자가 선택한 회전 각도와 확대를 유지합니다.
- 마우스 드래그로 시야 회전, 휠 또는 터치 핀치로 확대·축소.
- 입장할 때 남자·여자 캐릭터 선택. 여자 캐릭터는 묶은 포니테일. 두 손, 양쪽 신발과 걷기 동작.
- 내 캐릭터로부터 1.8m 안은 원래 음량, 이후 제곱 곡선으로 감소하며 7m 이상은 정확히 무음. 상대별 음소거는 거리와 독립적으로 유지됩니다.
- 담배는 서버 시작 시각 기준 5분 동안 연소합니다. 손을 입으로 올리는 동작, 불씨, 연기, 떨어지는 재는 타는 동안에만 나타납니다. 다 타면 멈추고 ‘한 대 더’가 활성화됩니다.
- 타는 소리는 기본 꺼짐. 방 하단에서 켜면 내 담배가 타는 동안만 재생됩니다. Web Audio로 합성한 작은 바스락거림·파열음이며 통화에 송출되지 않습니다.
- 초대 링크, 음성 통화, 한국어 음성 자막, 연기처럼 떠오르는 채팅.

## 로컬 개발

Node 22.13 이상과 Chrome 권장. 개발 서버는 localhost에만 바인딩합니다.

```sh
npm ci
npm run db:migrate
npm run dev
```

개발 주소: http://localhost:3000

## k3s 서버

배포 주소: https://smoking-room.tail04b57d.ts.net/

사용자의 후속 요청에 따라 k3s와 Tailscale Funnel을 사용합니다. ChatGPT Sites는 사용하지 않습니다.

`server/start.mjs`는 빌드한 Worker를 로컬 workerd / Miniflare 런타임으로 실행합니다. Cloudflare 계정이나 원격 D1에 연결하지 않습니다. SQL 마이그레이션 후에 HTTP 서버를 열며 `DATA_DIR` 아래 SQLite 데이터를 유지합니다.

```sh
npm run build
PORT=3100 npm run start:server
```

기본 바인딩은 localhost. 컨테이너에서는 `HOST=0.0.0.0`, `PORT=3000`, `DATA_DIR=/data/d1`을 사용합니다.

배포 정의: `deploy/k3s.yaml`. `smoking-room` 네임스페이스에 단일 replica, 1Gi PVC, Service, Funnel Ingress를 생성합니다. SQLite 동시 쓰기와 local-path 저장소 특성 때문에 Recreate 전략으로 선택한 노드에서 실행합니다. 노드 장애 시 자동 다중 노드 복구는 제공하지 않습니다.

이미지는 외부 레지스트리 없이 선택한 노드의 containerd로 전달합니다. `deploy/image-import.yaml`은 그 작업에만 사용하는 임시 Pod입니다.

```sh
docker build --platform linux/amd64 -t smoking-room:k3s-20260913-loading-v16 .
kubectl create namespace smoking-room --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/image-import.yaml
kubectl wait -n smoking-room pod/smoking-room-image-import --for=condition=Ready --timeout=60s
docker save smoking-room:k3s-20260913-loading-v16 | kubectl exec -i -n smoking-room smoking-room-image-import -- /bin/k3s ctr -n k8s.io images import -
kubectl apply -f deploy/k3s.yaml
kubectl rollout status -n smoking-room deployment/smoking-room --timeout=120s
kubectl delete pod -n smoking-room smoking-room-image-import
```

변경 배포 시 이미지 태그와 manifest를 함께 갱신합니다. public 주소는 `kubectl get ingress -n smoking-room`에서 확인합니다. 공개를 중단하려면 앱과 PVC를 유지한 채 `kubectl delete ingress -n smoking-room smoking-room`을 실행합니다.

[Tailscale Funnel 공식 설정](https://tailscale.com/docs/kubernetes-operator/ingress/expose-workload-to-internet)을 사용합니다. HTTPS는 Tailscale 프록시에서 종료됩니다.

## 통화와 데이터

- 최대 10명의 WebRTC 음성을 peer mesh로 연결합니다. 위치는 이동 중 최대 초당 5회 전송, 상태는 450ms 간격으로 공유하고 화면에서 보간합니다.
- 기본 STUN으로 연결 불가능한 회사망·일부 이동통신망은 TURN이 필요합니다. `TURN_URLS`, `TURN_SHARED_SECRET`을 컨테이너 환경 변수로 전달하면 인증 참가자에게 단기 자격증명을 발급합니다. 현재 배포에 TURN 서버는 포함하지 않습니다.
- 음성 자막은 Web Speech 지원 브라우저에서 작동하며 브라우저 제공자가 음성을 처리할 수 있습니다. 음성 인식 권한과 품질은 브라우저에 따라 다릅니다. 미지원 시 음성과 채팅은 계속 사용할 수 있습니다.
- 앱은 음성을 녹음하지 않습니다. 채팅·자막·연결 신호는 최대 2분간 전달한 후 다음 요청에서 정리합니다. 요청이 없으면 물리적 삭제가 지연됩니다.
- 45초 동안 응답하지 않으면 자리를 재사용할 수 있습니다. 마지막 활동 후 10분이 지난 방에는 들어갈 수 없습니다.
- 거리 무음은 클라이언트 오디오 출력 제어입니다. 방 안의 발화를 비밀로 격리하는 보안 경계는 아닙니다. 글자 채팅은 같은 방의 모든 참가자에게 표시됩니다.

## 검증

```sh
npm run typecheck
npm run lint
npm run test:spatial
npm run test:api
TEST_ORIGIN=http://localhost:3100 npm run test:ui
```

UI 테스트는 설치된 Chrome의 별도 headless 프로필과 가짜 마이크를 사용합니다. 실제 마이크를 녹음하지 않습니다. 두 브라우저의 WebRTC 연결·오디오 gain, 방향키 이동, 채팅 중 이동 정지, 시야 회전, 불붙이기 전/연소 중/종료 후 모션, 소리 토글, 모바일 너비를 확인합니다. 스크린샷은 `outputs/`에 저장합니다. 종료 상태는 테스트의 응답 override로 시간을 진행해 검증합니다.

API 테스트는 테스트 방만 생성하고 정리합니다. 운영 서버를 대상으로 하려면 `TEST_ORIGIN`을 명시합니다. 실기기에서 10명 동시 통화 품질과 서로 다른 네트워크의 연결 품질은 별도 확인 대상입니다.
