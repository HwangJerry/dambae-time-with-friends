'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  smokingState,
  ASH_INTERVAL_MS,
  ASH_FALL_MS,
} from '../smokingAnimation';
import { createShelter } from '../scene/world';
import { createAvatar, type Avatar } from '../scene/avatar';
import { isWalkable, WALK_SPEED, type Position } from '../spatial';
import { TEXT_VISIBLE_MS, type Participant, type SmokeMessage } from '../types';

type YardProps = {
  participants: Participant[];
  selfId: string;
  messages: SmokeMessage[];
  now: number;
  canMove: boolean;
  onMove: (position: Position) => void;
};
const POSITION_UI_INTERVAL = 80;
const CAMERA_FIELD_OF_VIEW = 45;
const CAMERA_FOLLOW_SPEED = 5;
function disposeObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  for (const material of materials) {
    if ('map' in material && material.map instanceof THREE.Texture)
      material.map.dispose();
    material.dispose();
  }
}
export function SmokingYard(props: YardProps) {
  const mount = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const clockSample = useRef({ now: props.now, at: 0 });
  useEffect(() => {
    clockSample.current = { now: props.now, at: performance.now() };
  }, [props.now]);
  const keys = useRef(new Set<string>());
  const [error, setError] = useState('');
  useEffect(() => {
    current.current = props;
  }, [props]);
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const container = element;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      queueMicrotask(() =>
        setError(
          '3D 화면을 열지 못했어요. WebGL을 지원하는 브라우저에서 다시 열어 주세요.',
        ),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.setAttribute(
      'aria-label',
      '초록 차양과 벤치가 있는 3D 흡연장. 방향키로 이동',
    );
    renderer.domElement.setAttribute('tabindex', '0');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#000000', 24, 42);
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FIELD_OF_VIEW,
      1,
      0.1,
      80,
    );
    camera.position.set(4, 5.5, 11);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 2.5);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 26;
    controls.minPolarAngle = 0.45;
    controls.maxPolarAngle = 1.3;
    controls.update();
    scene.add(new THREE.HemisphereLight('#d4e1de', '#554639', 2.2));
    const sun = new THREE.DirectionalLight('#ffe5bc', 3.8);
    sun.position.set(-5, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -11;
    sun.shadow.camera.right = 11;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    const shelter = createShelter();
    scene.add(shelter);
    const avatars = new Map<
      string,
      {
        avatar: Avatar;
        label: HTMLDivElement;
        nickname: HTMLSpanElement;
        speech: HTMLParagraphElement;
        lastMessage: string;
      }
    >();
    const localPosition = new THREE.Vector3();
    let initialized = false,
      frame = 0,
      previous = 0,
      lastReported = 0;
    let lastExternalPosition: Position | null = null;
    const projected = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth,
        height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    function keyDown(event: KeyboardEvent) {
      if (
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
          event.key,
        ) ||
        typing(event.target)
      )
        return;
      event.preventDefault();
      keys.current.add(event.key);
    }
    function keyUp(event: KeyboardEvent) {
      keys.current.delete(event.key);
    }
    function clearKeys() {
      keys.current.clear();
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    const keyState = keys.current;
    function draw(time: number) {
      const delta = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
      previous = time;
      const data = current.current;
      const active = new Set(data.participants.map((p) => p.id));
      for (const [id, entry] of avatars)
        if (!active.has(id)) {
          scene.remove(entry.avatar.group);
          disposeObject(entry.avatar.group);
          entry.label.remove();
          avatars.delete(id);
        }
      const self = data.participants.find((p) => p.id === data.selfId);
      if (
        self &&
        (!initialized ||
          (lastExternalPosition &&
            Math.hypot(
              self.x - lastExternalPosition.x,
              self.z - lastExternalPosition.z,
            ) > 1))
      ) {
        localPosition.set(self.x, 0, self.z);
        initialized = true;
      }
      if (self) lastExternalPosition = { x: self.x, z: self.z };
      let walking = false;
      if (
        initialized &&
        data.canMove &&
        keyState.size > 0 &&
        !typing(document.activeElement)
      ) {
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, camera.up).normalize();
        const dx =
          Number(keyState.has('ArrowRight')) -
          Number(keyState.has('ArrowLeft'));
        const dz =
          Number(keyState.has('ArrowUp')) - Number(keyState.has('ArrowDown'));
        const movement = forward
          .clone()
          .multiplyScalar(dz)
          .addScaledVector(right, dx);
        if (movement.lengthSq()) {
          movement.normalize().multiplyScalar(WALK_SPEED * delta);
          const next = {
            x: localPosition.x + movement.x,
            z: localPosition.z + movement.z,
          };
          if (isWalkable(next)) {
            localPosition.set(next.x, 0, next.z);
            walking = true;
          } else {
            if (isWalkable({ x: next.x, z: localPosition.z })) {
              localPosition.x = next.x;
              walking = true;
            }
            if (isWalkable({ x: localPosition.x, z: next.z })) {
              localPosition.z = next.z;
              walking = true;
            }
          }
          if (time - lastReported > POSITION_UI_INTERVAL) {
            data.onMove({ x: localPosition.x, z: localPosition.z });
            lastReported = time;
          }
        }
      }
      // Translate the orbit pivot with the player without resetting their chosen view.
      if (initialized) {
        const follow = new THREE.Vector3(localPosition.x, 1, localPosition.z)
          .sub(controls.target)
          .multiplyScalar(1 - Math.exp(-CAMERA_FOLLOW_SPEED * delta));
        controls.target.add(follow);
        camera.position.add(follow);
      }
      // Flush the final few centimetres when an arrow is released.
      if (
        self &&
        !walking &&
        initialized &&
        Math.hypot(self.x - localPosition.x, self.z - localPosition.z) > 0.01 &&
        data.canMove
      ) {
        data.onMove({ x: localPosition.x, z: localPosition.z });
      }
      for (const participant of data.participants) {
        let entry = avatars.get(participant.id);
        if (!entry) {
          const avatar = createAvatar(
            participant.seat,
            participant.id === data.selfId,
            participant.avatar,
          );
          avatar.group.position.set(participant.x, 0, participant.z);
          scene.add(avatar.group);
          const label = document.createElement('div');
          label.className = 'avatar-label';
          const nickname = document.createElement('span');
          const speech = document.createElement('p');
          speech.className = 'yard-speech';
          label.appendChild(speech);
          label.appendChild(nickname);
          container.appendChild(label);
          entry = { avatar, label, nickname, speech, lastMessage: '' };
          avatars.set(participant.id, entry);
        }
        const { avatar, label, nickname, speech } = entry;
        const isSelf = participant.id === data.selfId;
        const target = isSelf
          ? localPosition
          : new THREE.Vector3(participant.x, 0, participant.z);
        const movement = target.clone().sub(avatar.group.position);
        const moving = movement.length() > 0.015;
        if (moving)
          avatar.group.rotation.y = Math.atan2(movement.x, movement.z);
        avatar.group.position.lerp(target, isSelf ? 1 : Math.min(1, delta * 9));
        const stride =
          moving || (isSelf && walking) ? Math.sin(time * 0.012) * 0.35 : 0;
        avatar.leftLeg.rotation.x = stride;
        avatar.rightLeg.rotation.x = -stride;
        const animationNow =
          clockSample.current.now + performance.now() - clockSample.current.at;
        const state = smokingState(participant.litAt, animationNow);
        const { burning: lit, progress, handLift, elapsed } = state;
        const shoulder = new THREE.Vector3(0.28, 1.18, 0);
        const elbow = new THREE.Vector3(
          0.32,
          0.96 + handLift * 0.18,
          0.05 + handLift * 0.15,
        );
        const handPosition = new THREE.Vector3(
          0.31 - handLift * 0.22,
          0.8 + handLift * 0.62,
          0.16 - handLift * 0.06,
        );
        function positionLimb(
          mesh: THREE.Mesh,
          start: THREE.Vector3,
          end: THREE.Vector3,
          originalLength: number,
        ) {
          mesh.position.copy(start).add(end).multiplyScalar(0.5);
          const direction = end.clone().sub(start);
          mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize(),
          );
          mesh.scale.y = direction.length() / originalLength;
        }
        positionLimb(avatar.rightArm, shoulder, elbow, 0.34);
        positionLimb(avatar.forearm, elbow, handPosition, 0.31);
        avatar.hand.position.copy(handPosition);
        avatar.cigarette.position
          .copy(handPosition)
          .add(new THREE.Vector3(0, 0.02, 0.095));
        const paperLength = 0.2 * (1 - progress);
        avatar.paper.scale.y = Math.max(0.005, paperLength);
        avatar.paper.position.y = 0.0325 + paperLength / 2;
        avatar.ember.position.y = 0.0325 + paperLength;
        avatar.emberMaterial.emissiveIntensity = lit
          ? 1.2 + handLift * 2 + Math.sin(time * 0.005) * 0.3
          : 0;
        avatar.group.updateMatrixWorld(true);
        const tipWorld = avatar.ember.getWorldPosition(new THREE.Vector3());
        const tipLocal = avatar.group.worldToLocal(tipWorld.clone());
        for (let i = 0; i < avatar.smoke.length; i++) {
          const puff = avatar.smoke[i];
          const age = (time / 2400 + i / avatar.smoke.length) % 1;
          puff.visible = lit;
          puff.position
            .copy(tipLocal)
            .add(
              new THREE.Vector3(
                Math.sin(age * 5 + i) * age * 0.16,
                age * 1.8,
                age * 0.12,
              ),
            );
          puff.scale.setScalar(0.025 + age * 0.19);
          puff.material.opacity = Math.sin(age * Math.PI) * 0.13;
        }
        for (let i = 0; i < avatar.ash.length; i++) {
          const flake = avatar.ash[i];
          const ashTime = elapsed - 1500 - i * 120;
          const cycle = Math.floor(ashTime / ASH_INTERVAL_MS);
          const phase = ashTime % ASH_INTERVAL_MS;
          flake.mesh.visible = lit && ashTime >= 0 && phase < ASH_FALL_MS;
          if (!lit) {
            flake.cycle = -1;
            continue;
          }
          if (!flake.mesh.visible) continue;
          if (flake.cycle !== cycle) {
            flake.cycle = cycle;
            flake.origin.copy(tipWorld);
          }
          const seconds = phase / 1000;
          const fallingPosition = flake.origin
            .clone()
            .add(
              new THREE.Vector3(
                (i - 1.5) * seconds * 0.15,
                -4.9 * seconds * seconds,
                seconds * 0.08,
              ),
            );
          flake.mesh.position.copy(avatar.group.worldToLocal(fallingPosition));
          flake.mesh.rotation.set(seconds * 4, seconds * 3, seconds * 6);
          flake.mesh.material.opacity = Math.max(0, 1 - phase / ASH_FALL_MS);
        }
        label.dataset.burning = String(lit);
        label.dataset.handLift = handLift.toFixed(2);
        label.dataset.ashVisible = String(
          avatar.ash.some((flake) => flake.mesh.visible),
        );
        nickname.textContent = `${participant.micOn ? '● ' : ''}${participant.nickname}${isSelf ? ' · 나' : ''}`;
        nickname.className = participant.micOn ? 'speaking' : '';
        const message = data.messages
          .filter(
            (m) =>
              m.senderId === participant.id &&
              data.now - m.createdAt < TEXT_VISIBLE_MS,
          )
          .at(-1);
        if (entry.lastMessage !== (message?.id ?? '')) {
          speech.textContent = message?.text ?? '';
          entry.lastMessage = message?.id ?? '';
        }
        if (message) {
          const age = Math.max(
            0,
            (data.now - message.createdAt) / TEXT_VISIBLE_MS,
          );
          speech.style.opacity = String(1 - age);
          speech.style.transform = `translateY(${-age * 65}px)`;
          speech.style.filter = `blur(${Math.max(0, age - 0.65) * 5}px)`;
        }
        projected.copy(avatar.group.position);
        projected.y += 2;
        projected.project(camera);
        label.style.display = projected.z > 1 ? 'none' : '';
        label.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
        label.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    const contextLost = (event: Event) => {
      event.preventDefault();
      setError('3D 화면 연결이 끊겼어요. 새로고침해 주세요.');
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
      keyState.clear();
      avatars.forEach((entry) => entry.label.remove());
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <section className="yard-stage" aria-label="3D 친구 흡연장">
      <div ref={mount} className="yard-canvas" />
      <div className="yard-help">
        ↑ ↓ ← → 이동 <span>· 드래그로 둘러보기 · 휠로 확대</span>
      </div>
      <div className="yard-directions" aria-label="캐릭터 이동">
        {(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] as const).map(
          (key, index) => (
            <button
              key={key}
              className={key}
              aria-label={
                [
                  '앞으로 이동',
                  '왼쪽으로 이동',
                  '뒤로 이동',
                  '오른쪽으로 이동',
                ][index]
              }
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                keys.current.add(key);
              }}
              onPointerUp={() => keys.current.delete(key)}
              onPointerCancel={() => keys.current.delete(key)}
              onLostPointerCapture={() => keys.current.delete(key)}
            >
              {['↑', '←', '↓', '→'][index]}
            </button>
          ),
        )}
      </div>
      {error && (
        <div role="alert" className="yard-error">
          {error}
        </div>
      )}
    </section>
  );
}
