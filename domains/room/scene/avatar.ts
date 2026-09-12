import * as THREE from 'three';
import type { AvatarStyle } from '../types';
export const AVATAR_COLORS = [
  '#ae795e',
  '#5b8580',
  '#8a819c',
  '#b09a62',
  '#658399',
  '#9b7379',
  '#798967',
  '#aa866b',
  '#69758e',
  '#9c977e',
];
export function createAvatar(
  seat: number,
  self: boolean,
  style: AvatarStyle = 'male',
) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({
    color: AVATAR_COLORS[seat % AVATAR_COLORS.length],
    roughness: 0.9,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: '#d6b69a',
    roughness: 0.87,
  });
  const pants = new THREE.MeshStandardMaterial({
    color: '#303b3d',
    roughness: 1,
  });
  function capsule(
    radius: number,
    length: number,
    material: THREE.Material,
    x: number,
    y: number,
    z = 0,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, length, 4, 8),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  capsule(0.23, 0.36, shirt, 0, 0.95);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
  head.position.y = 1.49;
  head.castShadow = true;
  group.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    pants,
  );
  hair.position.y = 1.52;
  group.add(hair);
  if (style === 'female') {
    const gatheredHair = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      pants,
    );
    gatheredHair.scale.set(0.198, 0.195, 0.13);
    gatheredHair.position.set(0, 1.51, -0.09);
    group.add(gatheredHair);
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.64, -0.185),
      new THREE.Vector3(0.015, 1.58, -0.34),
      new THREE.Vector3(0.025, 1.32, -0.47),
      new THREE.Vector3(0.045, 1.01, -0.43),
    ]);
    const TAIL_SEGMENTS = 18;
    const TAIL_SIDES = 10;
    const tailGeometry = new THREE.TubeGeometry(
      tailCurve,
      TAIL_SEGMENTS,
      0.072,
      TAIL_SIDES,
      false,
    );
    const vertices = tailGeometry.getAttribute('position');
    for (let ring = 0; ring <= TAIL_SEGMENTS; ring++) {
      const fraction = ring / TAIL_SEGMENTS;
      const center = tailCurve.getPointAt(fraction);
      const taper = 1 - Math.pow(fraction, 1.4) * 0.8;
      for (let side = 0; side <= TAIL_SIDES; side++) {
        const index = ring * (TAIL_SIDES + 1) + side;
        const point = new THREE.Vector3()
          .fromBufferAttribute(vertices, index)
          .sub(center)
          .multiplyScalar(taper)
          .add(center);
        vertices.setXYZ(index, point.x, point.y, point.z);
      }
    }
    tailGeometry.computeVertexNormals();
    const ponytail = new THREE.Mesh(tailGeometry, pants);
    ponytail.castShadow = true;
    group.add(ponytail);
    const hairTie = new THREE.Mesh(
      new THREE.TorusGeometry(0.059, 0.014, 7, 14),
      new THREE.MeshStandardMaterial({ color: '#b99c7d', roughness: 0.9 }),
    );
    hairTie.position.set(0.003, 1.63, -0.22);
    group.add(hairTie);
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pants);
    fringe.scale.set(0.15, 0.055, 0.026);
    fringe.position.set(-0.03, 1.555, 0.185);
    fringe.rotation.z = -0.22;
    group.add(fringe);
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.31, 0.32, 16),
      shirt,
    );
    skirt.position.y = 0.69;
    skirt.castShadow = true;
    group.add(skirt);
  }
  for (const x of [-0.075, 0.075]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), pants);
    eye.position.set(x, 1.5, 0.18);
    group.add(eye);
  }
  const leftLeg = capsule(0.088, 0.35, pants, -0.12, 0.34);
  const rightLeg = capsule(0.088, 0.35, pants, 0.12, 0.34);
  const shoeMaterial = new THREE.MeshStandardMaterial({
    color: '#34302c',
    roughness: 0.85,
  });
  const soleMaterial = new THREE.MeshStandardMaterial({
    color: '#b9b4a6',
    roughness: 0.95,
  });
  for (const leg of [leftLeg, rightLeg]) {
    const shoe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      shoeMaterial,
    );
    shoe.scale.set(0.12, 0.075, 0.2);
    shoe.position.set(0, -0.26, 0.075);
    shoe.castShadow = true;
    leg.add(shoe);
    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.23, 0.035, 0.33),
      soleMaterial,
    );
    sole.position.set(0, -0.3, 0.075);
    leg.add(sole);
  }
  const leftArm = capsule(0.073, 0.31, shirt, -0.3, 0.96);
  leftArm.rotation.z = -0.13;
  const leftHand = capsule(0.067, 0.04, skin, 0, 0);
  leftArm.add(leftHand);
  leftHand.position.set(0, -0.26, 0);
  const rightArm = capsule(0.07, 0.2, shirt, 0.3, 1.05);
  const forearm = capsule(0.065, 0.18, shirt, 0.3, 0.9);
  const hand = capsule(0.067, 0.04, skin, 0.31, 0.8, 0.16);
  const cigarette = new THREE.Group();
  cigarette.position.set(0.31, 0.82, 0.23);
  // Positive rotation points the burning tip away from the face (+Z).
  // The cork filter stays closest to the fingers and mouth.
  cigarette.rotation.x = Math.PI / 2;
  const filter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.065, 10),
    new THREE.MeshStandardMaterial({ color: '#b88a50' }),
  );
  cigarette.add(filter);
  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1, 10),
    new THREE.MeshStandardMaterial({ color: '#e5dfcb' }),
  );
  cigarette.add(paper);
  const emberMaterial = new THREE.MeshStandardMaterial({
    color: '#573d2a',
    emissive: '#ef5c21',
    emissiveIntensity: 0,
  });
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 8, 6),
    emberMaterial,
  );
  cigarette.add(ember);
  group.add(cigarette);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.385, 32),
    new THREE.MeshBasicMaterial({
      color: self ? '#d4c6a1' : '#688278',
      transparent: true,
      opacity: self ? 0.8 : 0.3,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);
  const smoke = Array.from({ length: 7 }, () => {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(1, 7, 5),
      new THREE.MeshBasicMaterial({
        color: '#bec5bb',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    group.add(puff);
    return puff;
  });
  const ash = Array.from({ length: 4 }, () => {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.024, 0),
      new THREE.MeshStandardMaterial({
        color: '#b1aa9d',
        roughness: 1,
        transparent: true,
        opacity: 0,
      }),
    );
    mesh.visible = false;
    group.add(mesh);
    return { mesh, cycle: -1, origin: new THREE.Vector3() };
  });
  return {
    group,
    leftLeg,
    rightLeg,
    rightArm,
    forearm,
    hand,
    cigarette,
    paper,
    ember,
    emberMaterial,
    smoke,
    ash,
  };
}
export type Avatar = ReturnType<typeof createAvatar>;
