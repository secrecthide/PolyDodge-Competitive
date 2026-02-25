import * as THREE from 'three';

export interface PlayerData {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { y: number };
  team: 'red' | 'blue';
  score: number;
  holdingBallId: number | null;
  isOut: boolean;
  stamina: number;
  maxStamina: number;
  isBlocking: boolean;
  chargeLevel: number; // 0 to 1.5
  rank: string;
  level: number;
  xp: number;
}

export interface BallData {
  id: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  owner: string | null;
  state: 'idle' | 'held' | 'thrown';
  isLive: boolean;
  type: 'normal' | 'fast' | 'curve' | 'lob';
  curveFactor: number;
  lastInteractionTime: number;
}

export const ARENA_SIZE = 60;

export function createLowPolyArena(scene: THREE.Scene) {
  // Floor (Court) - Dark Grid Aesthetic
  const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
  const floorMat = new THREE.MeshStandardMaterial({ 
    color: 0x050505, 
    roughness: 0.8,
    metalness: 0.2
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid Helper for that technical look
  const grid = new THREE.GridHelper(ARENA_SIZE, 30, 0x333333, 0x111111);
  grid.position.y = 0.005;
  scene.add(grid);

  // Court Markings - Neon Style
  const markingMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4 });
  
  // Outer boundary
  const boundaryGeo = new THREE.PlaneGeometry(ARENA_SIZE - 1, ARENA_SIZE - 1);
  const boundaryMarking = new THREE.Mesh(boundaryGeo, new THREE.MeshBasicMaterial({ 
    color: 0x00ff88, 
    transparent: true, 
    opacity: 0.1,
    wireframe: true 
  }));
  boundaryMarking.rotation.x = -Math.PI / 2;
  boundaryMarking.position.y = 0.01;
  scene.add(boundaryMarking);

  // Center line (Neon)
  const lineGeo = new THREE.PlaneGeometry(ARENA_SIZE, 0.4);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8 });
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.02;
  scene.add(line);

  // Center circle (Neon)
  const circleGeo = new THREE.RingGeometry(4.8, 5, 64);
  const circle = new THREE.Mesh(circleGeo, lineMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.02;
  scene.add(circle);

  // Walls (Glass-like with neon edges)
  const wallMat = new THREE.MeshStandardMaterial({ 
    color: 0x111111, 
    transparent: true, 
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.9
  });
  const wallHeight = 6;

  for (let i = 0; i < 4; i++) {
    const isLong = i < 2;
    const wallGeo = isLong ? new THREE.BoxGeometry(ARENA_SIZE, wallHeight, 0.1) : new THREE.BoxGeometry(0.1, wallHeight, ARENA_SIZE);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    
    if (i === 0) wall.position.set(0, wallHeight / 2, ARENA_SIZE / 2);
    if (i === 1) wall.position.set(0, wallHeight / 2, -ARENA_SIZE / 2);
    if (i === 2) wall.position.set(ARENA_SIZE / 2, wallHeight / 2, 0);
    if (i === 3) wall.position.set(-ARENA_SIZE / 2, wallHeight / 2, 0);
    
    scene.add(wall);

    // Neon top edge
    const edgeGeo = isLong ? new THREE.BoxGeometry(ARENA_SIZE, 0.1, 0.1) : new THREE.BoxGeometry(0.1, 0.1, ARENA_SIZE);
    const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
    edge.position.copy(wall.position);
    edge.position.y = wallHeight;
    scene.add(edge);
  }
}

export function createPlayerMesh(team: 'red' | 'blue') {
  const group = new THREE.Group();
  
  // Body (Sleek technical look)
  // Total height: 1.3 (length) + 0.8 (2*radius) = 2.1
  const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.3, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ 
    color: team === 'red' ? 0xff2222 : 0x2222ff,
    metalness: 0.5,
    roughness: 0.2
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  // Center at 1.05 so bottom is at 0
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  // Visor/Head
  const headGeo = new THREE.BoxGeometry(0.5, 0.25, 0.5);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: team === 'red' ? 0xff0000 : 0x00ffff, emissiveIntensity: 0.5 });
  const head = new THREE.Mesh(headGeo, headMat);
  // Head at top of capsule
  head.position.y = 1.8;
  head.castShadow = true;
  group.add(head);

  // Held Ball Indicator
  const ballGeo = new THREE.IcosahedronGeometry(0.3, 1);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.5 });
  const heldBall = new THREE.Mesh(ballGeo, ballMat);
  heldBall.name = 'heldBall';
  heldBall.position.set(0.5, 1.2, 0.4);
  heldBall.visible = false;
  group.add(heldBall);

  // Shield
  const shieldGeo = new THREE.SphereGeometry(1.5, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const shieldMat = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, 
    transparent: true, 
    opacity: 0.2,
    wireframe: true
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.name = 'shield';
  shield.position.set(0, 1.05, 0);
  shield.rotation.x = -Math.PI / 2;
  shield.visible = false;
  group.add(shield);

  return group;
}

export function createBallMesh() {
  const geo = new THREE.IcosahedronGeometry(0.35, 1); // Slightly bigger, reduced detail
  const mat = new THREE.MeshStandardMaterial({ 
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 0.8, // Increased emissive to compensate for light removal
    metalness: 0.8,
    roughness: 0.1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  
  return mesh;
}
