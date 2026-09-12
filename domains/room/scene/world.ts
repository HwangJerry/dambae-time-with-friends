import * as THREE from 'three';

function surfaceTexture(kind: 'concrete' | 'wood') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = kind === 'wood' ? '#71503a' : '#686c62';
  context.fillRect(0, 0, 256, 256);
  let seed = 51;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 9000; i++) {
    const tone = Math.floor(30 + random() * 140);
    context.fillStyle = `rgba(${tone},${tone},${tone},${random() * 0.25})`;
    context.fillRect(
      random() * 256,
      random() * 256,
      kind === 'wood' ? random() * 90 : random() * 7,
      1 + random() * 3,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'wood' ? 2 : 3, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function createShelter() {
  const world = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({
    map: surfaceTexture('concrete'),
    roughness: 1,
  });
  const wood = new THREE.MeshStandardMaterial({
    map: surfaceTexture('wood'),
    roughness: 0.88,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: '#366452',
    roughness: 0.68,
    metalness: 0.4,
  });
  const paleSteel = new THREE.MeshStandardMaterial({
    color: '#a6b0a2',
    roughness: 0.48,
    metalness: 0.55,
  });
  function box(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  }
  box(15.4, 0.25, 10.4, 0, -0.16, 1.4, concrete);
  box(15.4, 4.8, 0.3, 0, 2.22, -3.4, concrete);
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: '#41483f',
    roughness: 1,
  });
  for (let x = -7; x < 8; x += 2)
    box(0.018, 4.7, 0.018, x, 2.2, -3.24, jointMaterial);
  for (let z = -3; z < 7; z += 1.5)
    box(15.2, 0.006, 0.015, 0, -0.029, z, jointMaterial);
  for (let x = -7; x < 8; x += 1.5)
    box(0.012, 0.006, 10.2, x, -0.028, 1.4, jointMaterial);
  function bench(x: number, z: number, width: number) {
    for (const side of [-1, 1]) {
      box(0.13, 0.63, 0.13, x + side * (width / 2 - 0.15), 0.3, z + 0.3, steel);
      box(
        0.13,
        1.3,
        0.13,
        x + side * (width / 2 - 0.15),
        0.63,
        z - 0.48,
        steel,
      );
    }
    for (let plank = 0; plank < 4; plank++)
      box(width, 0.08, 0.16, x, 0.65, z - 0.26 + plank * 0.18, wood);
    for (let plank = 0; plank < 3; plank++)
      box(width, 0.19, 0.08, x, 0.91 + plank * 0.22, z - 0.34, wood);
  }
  bench(0, -2.15, 4.8);
  bench(-3.75, -2.05, 0.85);
  bench(3.65, -2.05, 0.85);
  // Curved translucent polycarbonate roof and exposed silver ribs.
  const roofPositions: number[] = [],
    roofIndices: number[] = [];
  const ROOF_SEGMENTS = 24;
  const roofPoint = (x: number, t: number) =>
    new THREE.Vector3(x, 3.18 + Math.sin(t * Math.PI) * 0.6, -3.2 + t * 3.65);
  for (let i = 0; i <= ROOF_SEGMENTS; i++)
    for (const x of [-6, 6])
      roofPositions.push(...roofPoint(x, i / ROOF_SEGMENTS).toArray());
  for (let i = 0; i < ROOF_SEGMENTS; i++) {
    const a = i * 2;
    roofIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(roofPositions, 3),
  );
  roofGeometry.setIndex(roofIndices);
  roofGeometry.computeVertexNormals();
  const roof = new THREE.Mesh(
    roofGeometry,
    new THREE.MeshStandardMaterial({
      color: '#4b9486',
      roughness: 0.5,
      metalness: 0.12,
      transparent: true,
      opacity: 0.39,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  world.add(roof);
  for (let x = -6; x <= 6; x += 2) {
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: 25 }, (_, i) => roofPoint(x, i / 24)),
    );
    world.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, 0.027, 5, false),
        paleSteel,
      ),
    );
  }
  for (const z of [-3.15, 0.4]) {
    box(12.1, 0.12, 0.1, 0, 3.13, z, steel);
    for (const x of [-5.8, 5.8]) box(0.085, 3.2, 0.085, x, 1.57, z, steel);
  }
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.43, 0.33, 1.04, 24),
    new THREE.MeshStandardMaterial({ color: '#377f94', roughness: 0.6 }),
  );
  bin.position.set(5.25, 0.5, -1.95);
  bin.castShadow = true;
  world.add(bin);
  const lid = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.06, 8, 24),
    new THREE.MeshStandardMaterial({ color: '#181f1c' }),
  );
  lid.rotation.x = Math.PI / 2;
  lid.position.set(5.25, 1.04, -1.95);
  world.add(lid);
  const ashtray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.25, 0.58, 20),
    new THREE.MeshStandardMaterial({ color: '#71645c', roughness: 1 }),
  );
  ashtray.position.set(0, 0.27, 0.95);
  ashtray.castShadow = true;
  world.add(ashtray);
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.31, 0.025, 20),
    new THREE.MeshStandardMaterial({ color: '#3e3930', roughness: 1 }),
  );
  sand.position.set(0, 0.57, 0.95);
  world.add(sand);
  for (let i = 0; i < 3; i++) {
    const broom = box(0.025, 1.8, 0.025, -5.1 + i * 0.25, 0.91, -2.9, steel);
    broom.rotation.z = 0.06 + i * 0.025;
    box(0.15, 0.3, 0.1, -5.17 + i * 0.25, 0.16, -2.9, jointMaterial);
  }
  return world;
}
