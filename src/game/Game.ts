import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { PlayerData, BallData, createLowPolyArena, createPlayerMesh, createBallMesh, ARENA_SIZE } from './constants';
import { BotAI, IGameContext } from './BotAI';
import { NetworkManager } from './network/NetworkManager';
import { WorldSnapshot } from './network/protocol';

import { sounds } from './SoundManager';

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: PointerLockControls;
  private network: NetworkManager;
  
  private players: Map<string, { data: PlayerData; mesh: THREE.Group }> = new Map();
  private balls: Map<number, { data: BallData; mesh: THREE.Mesh }> = new Map();
  
  private myId: string | null = null;
  private spectatingId: string | null = null;
  private spectateOrbit = new THREE.Vector2(0, 0.5); // x: rotation, y: pitch
  private spectateDistance = 8;
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private curveLeft = false;
  private curveRight = false;
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private canPickUp = false;
  private fpBall: THREE.Mesh | null = null;

  // Mobile inputs
  private mobileMove = { x: 0, y: 0 };
  private isMobile = false;
  
  // Competitive Mechanics
  private stamina = 100;
  private maxStamina = 100;
  private isSprinting = false;
  private isBlocking = false;
  private chargeLevel = 0;
  private isCharging = false;
  private lastStaminaUseTime = 0;
  private localPlayerMesh: THREE.Group | null = null;
  private roundTime = 180;
  private lastTimeUpdate = 0;
  private gameActive = false;
  
  private lastFrameTime = performance.now();
  private isOnline = false;
  private onUpdateHUD: (data: any) => void;
  private sensitivity = 1.0;

  private currentSkin: string = 'Blue';
  private currentBallColor: string = 'Yellow';

  private bots: Map<string, BotAI> = new Map();
  private claimedBallIds: Set<number> = new Set();
  
  // New Features
  private matchScore = { blue: 0, red: 0 };
  private ballTrails: Map<number, { mesh: THREE.InstancedMesh; positions: number[]; count: number }> = new Map();
  private trailMaterial: THREE.MeshBasicMaterial | null = null;
  private trailGeometry: THREE.SphereGeometry | null = null;
  private lastHeartbeatTime = 0;

  constructor(container: HTMLElement, onUpdateHUD: (data: any) => void) {
    this.onUpdateHUD = onUpdateHUD;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);
    this.scene.fog = new THREE.FogExp2(0x111111, 0.02);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.y = 1.6; // Match bot height

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, document.body);
    
    // Re-lock on click
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.controls.isLocked && !this.isMobile) {
        this.controls.lock();
      }
    });
    
    this.setupLights();
    createLowPolyArena(this.scene);
    this.setupFPBall();
    this.setupTrailSystem();
    this.setupEventListeners();
    
    this.network = new NetworkManager();
    this.setupNetworkListeners();

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.animate();
  }

  private setupTrailSystem() {
    this.trailGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    this.trailMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.6 });
  }

  private createTrail(ballId: number) {
    if (!this.trailGeometry || !this.trailMaterial) return;
    
    // Create instanced mesh for trail particles
    const count = 20; // Number of trail segments
    const mesh = new THREE.InstancedMesh(this.trailGeometry, this.trailMaterial, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = true;
    this.scene.add(mesh);
    
    // Initialize positions off-screen
    const dummy = new THREE.Object3D();
    dummy.position.set(0, -100, 0);
    dummy.updateMatrix();
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, dummy.matrix);
    }
    
    this.ballTrails.set(ballId, { mesh, positions: [], count });
  }

  private updateTrails() {
    this.ballTrails.forEach((trail, ballId) => {
      const ball = this.balls.get(ballId);
      if (!ball || !ball.mesh.visible || !ball.data.isLive) {
        trail.mesh.visible = false;
        return;
      }

      trail.mesh.visible = true;
      
      // Add current position to history
      trail.positions.unshift(ball.mesh.position.x, ball.mesh.position.y, ball.mesh.position.z);
      if (trail.positions.length > trail.count * 3) {
        trail.positions.length = trail.count * 3;
      }

      const dummy = new THREE.Object3D();
      for (let i = 0; i < trail.positions.length / 3; i++) {
        dummy.position.set(trail.positions[i*3], trail.positions[i*3+1], trail.positions[i*3+2]);
        const scale = 1 - (i / trail.count);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        trail.mesh.setMatrixAt(i, dummy.matrix);
      }
      trail.mesh.instanceMatrix.needsUpdate = true;
      
      // Match ball color
      if (ball.mesh.material instanceof THREE.MeshStandardMaterial) {
        (trail.mesh.material as THREE.MeshBasicMaterial).color.copy(ball.mesh.material.color);
      }
    });
  }

  public setSensitivity(value: number) {
    this.sensitivity = value;
    if (this.controls) {
      this.controls.pointerSpeed = value;
    }
  }

  public cycleSpectator(direction: number) {
    const myTeam = this.players.get(this.myId!)?.data.team;
    const teammates = Array.from(this.players.entries())
      .filter(([id, p]) => id !== this.myId && p.data.team === myTeam && !p.data.isOut);
    
    if (teammates.length === 0) return;

    let currentIndex = teammates.findIndex(([id]) => id === this.spectatingId);
    currentIndex = (currentIndex + direction + teammates.length) % teammates.length;
    this.spectatingId = teammates[currentIndex][0];
  }

  public applyCustomization(type: 'skin' | 'ball' | 'emote', value: string) {
    if (type === 'skin') {
      this.currentSkin = value;
      const myPlayer = this.players.get('local') || this.players.get(this.myId || '');
      if (myPlayer) {
        const body = myPlayer.mesh.children[0] as THREE.Mesh;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          const colors: Record<string, number> = {
            'Blue': 0x2222ff,
            'Red': 0xff2222,
            'Emerald': 0x10b981,
            'Gold': 0xf59e0b,
            'Obsidian': 0x18181b,
            'Cyber': 0x22d3ee,
            'Ghost': 0xffffff,
            'Crimson': 0x991b1b
          };
          body.material.color.setHex(colors[value] || 0x2222ff);
          if (value === 'Ghost') body.material.opacity = 0.4;
          else body.material.opacity = 1.0;
          body.material.transparent = value === 'Ghost';
        }
      }
    } else if (type === 'ball') {
       this.currentBallColor = value;
       if (this.fpBall && this.fpBall.material instanceof THREE.MeshStandardMaterial) {
          const colors: Record<string, number> = {
            'Yellow': 0xffff00,
            'Neon Blue': 0x00ffff,
            'Neon Red': 0xff0000,
            'Rainbow': 0xffffff,
            'Void': 0x4a044e,
            'Plasma': 0xec4899
          };
          const color = colors[value] || 0xffff00;
          this.fpBall.material.color.setHex(color);
          this.fpBall.material.emissive.setHex(color);
       }
    }
  }

  private setupFPBall() {
    const ballGeo = new THREE.IcosahedronGeometry(0.2, 1);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.2 });
    this.fpBall = new THREE.Mesh(ballGeo, ballMat);
    this.fpBall.position.set(0.4, -0.3, -0.6);
    this.fpBall.visible = false;
    this.camera.add(this.fpBall);
    this.scene.add(this.camera); // Ensure camera is in scene to see children
  }

  private setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(10, 20, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    this.scene.add(sunLight);
  }

  private setupEventListeners() {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': this.moveForward = true; break;
        case 'ArrowLeft':
        case 'KeyA': this.moveLeft = true; break;
        case 'ArrowDown':
        case 'KeyS': this.moveBackward = true; break;
        case 'ArrowRight':
        case 'KeyD': this.moveRight = true; break;
        case 'KeyQ': this.curveLeft = true; break;
        case 'KeyE': this.curveRight = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': this.isSprinting = true; break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': this.moveForward = false; break;
        case 'ArrowLeft':
        case 'KeyA': this.moveLeft = false; break;
        case 'ArrowDown':
        case 'KeyS': this.moveBackward = false; break;
        case 'ArrowRight':
        case 'KeyD': this.moveRight = false; break;
        case 'KeyQ': this.curveLeft = false; break;
        case 'KeyE': this.curveRight = false; break;
        case 'ShiftLeft':
        case 'ShiftRight': this.isSprinting = false; break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    // Orbit camera movement when spectating
    document.addEventListener('mousemove', (event: MouseEvent) => {
      const myPlayer = this.myId ? this.players.get(this.myId) : null;
      if (myPlayer && myPlayer.data.isOut) {
        this.spectateOrbit.x -= event.movementX * 0.005 * this.sensitivity;
        this.spectateOrbit.y = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.spectateOrbit.y + event.movementY * 0.005 * this.sensitivity));
      }
    });

    document.addEventListener('mousedown', (e) => {
      const myPlayer = this.myId ? this.players.get(this.myId) : null;
      if (myPlayer && myPlayer.data.isOut) {
        if (e.button === 0) this.cycleSpectator(1);
        if (e.button === 2) this.cycleSpectator(-1);
        return;
      }

      if (this.controls.isLocked) {
        if (e.button === 0) this.handleMouseDown();
        if (e.button === 2) {
          const myPlayer = this.myId ? this.players.get(this.myId)?.data : null;
          if (myPlayer && myPlayer.holdingBallId !== null) {
            this.isBlocking = true;
          }
        }
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (this.controls.isLocked) {
        if (e.button === 0) this.handleMouseUp();
        if (e.button === 2) this.isBlocking = false;
      }
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  private handleMouseDown() {
    const myPlayer = this.myId ? this.players.get(this.myId)?.data : null;
    if (!myPlayer || myPlayer.isOut) return;

    if (myPlayer.holdingBallId !== null) {
      if (this.stamina > 10) {
        this.isCharging = true;
        this.chargeLevel = 0;
        sounds.playCharge(0); // Start charge sound
      } else {
        // Not enough stamina to charge, just throw light
        this.throwBall(myPlayer.holdingBallId, 0);
      }
    } else {
      this.tryGrabBall();
    }
  }

  private handleMouseUp() {
    const myPlayer = this.myId ? this.players.get(this.myId)?.data : null;
    if (!myPlayer || myPlayer.isOut) return;

    if (this.isCharging && myPlayer.holdingBallId !== null) {
      this.throwBall(myPlayer.holdingBallId, this.chargeLevel);
      this.isCharging = false;
      this.chargeLevel = 0;
      sounds.stopCharge(); // Stop charge sound
    }
  }

  private tryGrabBall() {
    let closestBallId: number | null = null;
    let minDistance = 6.0;

    this.balls.forEach((ball, id) => {
      if (ball.data.state !== 'held') {
        const dx = this.camera.position.x - ball.mesh.position.x;
        const dz = this.camera.position.z - ball.mesh.position.z;
        const dy = Math.abs(this.camera.position.y - ball.mesh.position.y);
        const distXZ = Math.sqrt(dx*dx + dz*dz);
        
        if (distXZ < minDistance && dy < 3.0) {
          minDistance = distXZ;
          closestBallId = id;
        }
      }
    });

    if (closestBallId !== null) {
      const ball = this.balls.get(closestBallId);
      if (ball) {
        this.onBallGrabbed(closestBallId, 'local');
        sounds.playPickup();
      }
    }
  }

  private throwBall(ballId: number, charge: number = 0) {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    
    // Determine Throw Type
    let type: 'normal' | 'curve' | 'lob' = 'normal';
    let curveFactor = 0;

    // Lob: Looking up
    if (direction.y > 0.4) {
      type = 'lob';
    } 
    // Curve: Using Q/E
    else if (this.curveLeft) {
      type = 'curve';
      curveFactor = -2; // Stronger Curve Left
    } else if (this.curveRight) {
      type = 'curve';
      curveFactor = 2; // Stronger Curve Right
    }

    // Aim Assist (Soft Magnetism)
    let bestTarget = null;
    if (type !== 'lob') {
      let maxDot = 0.96; // Tighter aim assist (Skill based)
      this.players.forEach((p, id) => {
        if (id !== this.myId && p.data.team !== (this.players.get(this.myId!)?.data.team) && p.mesh.visible && !p.data.isOut) {
          const toEnemy = new THREE.Vector3().subVectors(p.mesh.position, this.camera.position).normalize();
          const dot = direction.dot(toEnemy);
          if (dot > maxDot) {
            // Check line of sight (simple distance check for now)
            const dist = p.mesh.position.distanceTo(this.camera.position);
            if (dist < 40) {
               maxDot = dot;
               // Soft correct towards center mass
               bestTarget = direction.clone().lerp(toEnemy, 0.3).normalize();
            }
          }
        }
      });
    }

    let finalDir = bestTarget || direction;
    
    // Accuracy Penalty based on Movement
    let accuracy = 1.0;
    if (this.isSprinting) accuracy = 0.85;
    else if (this.moveForward || this.moveBackward || this.moveLeft || this.moveRight) accuracy = 0.95;
    
    if (accuracy < 1.0) {
       finalDir.x += (Math.random() - 0.5) * (1 - accuracy) * 0.5;
       finalDir.y += (Math.random() - 0.5) * (1 - accuracy) * 0.5;
       finalDir.z += (Math.random() - 0.5) * (1 - accuracy) * 0.5;
       finalDir.normalize();
    }
    
    // Fix: Add a slight upward tilt to normal throws so they don't immediately hit the floor
    if (type === 'normal' || type === 'curve') {
      finalDir.y += 0.15;
      finalDir.normalize();
    }

    // Power Calculation (Charge affects speed only)
    let power = 20 + (charge * 30); // Range 20 to 50
    if (type === 'lob') power *= 0.7; 

    const velocity = finalDir.clone().multiplyScalar(power);
    
    // Adjust velocity for Lob
    if (type === 'lob') {
      velocity.y += 20; 
    }

    const position = this.camera.position.clone().add(direction.clone().multiplyScalar(0.5));

    // Stamina cost
    this.stamina = Math.max(0, this.stamina - (10 + charge * 20));
    this.lastStaminaUseTime = Date.now();
    
    if (this.isOnline) {
      // NetworkManager handles input sending in animate loop based on state
      // But for "trigger" events like throw start, we might want to send immediately or set a flag
      // Actually, we send input state every frame. 
      // The "throw" action in InputPacket has "active: boolean".
      // We set isCharging = false in handleMouseUp, so we need to ensure the "release" frame is sent.
      // But since we send inputs continuously, the server sees "active: true" then "active: false".
      // We don't need to do anything here for network, just local prediction.
      
      // Predict locally
      this.onBallThrown(ballId, position, velocity, this.myId!, type, curveFactor);
    } else {
      this.onBallThrown(ballId, position, velocity, 'local', type, curveFactor);
    }
    
    sounds.playThrow();
    this.createTrail(ballId); // Create trail
  }

  private snapshots: any[] = [];

  public connect(mode: 'casual' | 'ranked' = 'casual') {
    this.warmup();
    this.isOnline = true;
    this.gameActive = true;
    this.network.joinQueue(mode);
  }

  public disconnect() {
    this.isOnline = false;
    this.gameActive = false;
    this.snapshots = [];
    this.network.disconnect();
    this.network = new NetworkManager(); // Reset
    this.setupNetworkListeners();
    document.exitPointerLock();
    // Clear scene
    while(this.scene.children.length > 0){ 
      this.scene.remove(this.scene.children[0]); 
    }
    this.renderer.dispose();
  }

  private setupNetworkListeners() {
    this.network.onInit = (data) => {
      this.myId = data.playerId;
      // Match found! Hide lobby overlay and start game
      this.onUpdateHUD({ winner: null, isLobby: false });
      
      // Clear existing
      this.players.forEach(p => this.scene.remove(p.mesh));
      this.players.clear();
      this.balls.forEach(b => this.scene.remove(b.mesh));
      this.balls.clear();
      this.bots.clear();
    };

    this.network.onSnapshot = (snapshot) => {
      this.onUpdateHUD({ 
        timer: snapshot.matchState === 'warmup' ? snapshot.countdown : snapshot.time,
        matchState: snapshot.matchState
      });
    };

    this.network.onEvent = (event) => {
      if (event.type === 'elimination') {
        this.onPlayerOut(event.data.playerId, 'hit');
      } else if (event.type === 'catch') {
        this.onBallGrabbed(event.data.ballId, event.data.playerId);
      }
    };

    this.network.onQueueStatus = (data) => {
      this.onUpdateHUD({ 
        isLobby: true, 
        playersCount: data.position, 
        lobbyMode: data.mode 
      });
    };
  }

  private applyInterpolatedState(state: { prev: WorldSnapshot, next: WorldSnapshot, fraction: number }) {
    const { prev, next, fraction } = state;

    // Update Players
    next.players.forEach(nextP => {
      if (nextP.id === this.myId) {
        // Reconciliation could go here
        // For now, just update non-predicted state
        const p = this.players.get(this.myId);
        if (p) {
          p.data.stamina = nextP.stamina;
          p.data.isOut = nextP.state === 'out';
          p.data.holdingBallId = nextP.holding;
        }
        return;
      }

      let p = this.players.get(nextP.id);
      if (!p) {
        // Add new player
        const playerData: PlayerData = {
          id: nextP.id,
          position: nextP.pos,
          rotation: nextP.rot,
          team: 'blue', // TODO: Get from init or snapshot
          score: 0,
          holdingBallId: nextP.holding,
          isOut: nextP.state === 'out',
          stamina: nextP.stamina,
          maxStamina: 100,
          isBlocking: nextP.blocking,
          chargeLevel: nextP.charge,
          rank: 'Unknown',
          level: 1,
          xp: 0
        };
        this.addPlayer(playerData);
        p = this.players.get(nextP.id);
      }

      if (p) {
        const prevP = prev.players.find(pp => pp.id === nextP.id) || nextP;
        
        const pos = new THREE.Vector3(prevP.pos.x, prevP.pos.y, prevP.pos.z).lerp(
          new THREE.Vector3(nextP.pos.x, nextP.pos.y, nextP.pos.z), fraction
        );
        
        p.mesh.position.copy(pos);
        p.mesh.rotation.y = THREE.MathUtils.lerp(prevP.rot.y, nextP.rot.y, fraction);
        
        p.data.isOut = nextP.state === 'out';
        p.data.holdingBallId = nextP.holding;
        p.data.isBlocking = nextP.blocking;
        p.mesh.visible = !p.data.isOut;
      }
    });

    // Update Balls
    next.balls.forEach(nextB => {
      let b = this.balls.get(nextB.id);
      if (!b) {
        // Add ball if missing
        const ballData: BallData = {
          id: nextB.id,
          position: nextB.pos,
          velocity: nextB.vel,
          owner: nextB.owner,
          state: nextB.state,
          isLive: nextB.state === 'thrown',
          type: nextB.type,
          curveFactor: 0,
          lastInteractionTime: 0
        };
        this.addBall(ballData);
        b = this.balls.get(nextB.id);
      }

      if (b) {
        const prevB = prev.balls.find(bb => bb.id === nextB.id) || nextB;
        
        if (nextB.state === 'held') {
          b.mesh.visible = false;
        } else {
          b.mesh.visible = true;
          const pos = new THREE.Vector3(prevB.pos.x, prevB.pos.y, prevB.pos.z).lerp(
            new THREE.Vector3(nextB.pos.x, nextB.pos.y, nextB.pos.z), fraction
          );
          b.mesh.position.copy(pos);
        }
        
        b.data.state = nextB.state;
        b.data.owner = nextB.owner;
      }
    });

    this.updateTeamCounts();
  }

  private warmup() {
    // Create dummy objects to force shader compilation
    const dummyPlayer = createPlayerMesh('blue');
    dummyPlayer.position.set(0, -100, 0);
    this.scene.add(dummyPlayer);

    const dummyBall = createBallMesh();
    dummyBall.position.set(0, -100, 0);
    this.scene.add(dummyBall);

    // Force held ball visibility
    const heldBall = dummyPlayer.getObjectByName('heldBall');
    if (heldBall) heldBall.visible = true;

    // Force shield visibility
    const shield = dummyPlayer.getObjectByName('shield');
    if (shield) shield.visible = true;

    // Render once
    this.renderer.render(this.scene, this.camera);

    // Cleanup
    this.scene.remove(dummyPlayer);
    this.scene.remove(dummyBall);
  }

  public startOffline() {
    this.warmup();
    this.isOnline = false;
    this.myId = 'local';
    this.gameActive = true;
    this.roundTime = 180;
    this.lastTimeUpdate = Date.now();
    this.onUpdateHUD({ winner: null, timer: 180 }); // Clear winner!
    
    // Clear existing
    this.players.forEach(p => this.scene.remove(p.mesh));
    this.players.clear();
    this.balls.forEach(b => this.scene.remove(b.mesh));
    this.balls.clear();
    this.bots.clear();
    
    const localPlayer: PlayerData = {
      id: 'local',
      position: { x: 0, y: 0, z: -25 },
      rotation: { y: Math.PI },
      team: 'blue',
      score: 0,
      holdingBallId: null,
      isOut: false,
      stamina: 100,
      maxStamina: 100,
      isBlocking: false,
      chargeLevel: 0,
      rank: 'Bronze',
      level: 1,
      xp: 0
    };
    this.addPlayer(localPlayer);
    this.applyCustomization('skin', this.currentSkin);
    this.applyCustomization('ball', this.currentBallColor);
    
    // Reset local state
    this.stamina = 100;
    this.chargeLevel = 0;
    this.isCharging = false;
    this.isBlocking = false;
    this.isSprinting = false;
    this.velocity.set(0, 0, 0);
    this.onUpdateHUD({ 
      stamina: 100, 
      chargeLevel: 0, 
      isBlocking: false,
      holding: false,
      canPickUp: false
    });
    
    this.camera.position.set(0, 1.6, -25);
    this.camera.rotation.set(0, Math.PI, 0); // Face center

    // Add Teammates (Blue Team) - Buffed
    for (let i = 0; i < 3; i++) {
      const botId = `teammate_${i}`;
      const botData: PlayerData = {
        id: botId,
        position: { x: (i - 1) * 6, y: 0, z: -25 },
        rotation: { y: Math.PI },
        team: 'blue',
        score: 0,
        holdingBallId: null,
        isOut: false,
        stamina: 100,
        maxStamina: 120, // More stamina
        isBlocking: false,
        chargeLevel: 0,
        rank: 'Gold', // Higher rank
        level: 15,
        xp: 0
      };
      const mesh = createPlayerMesh('blue');
      mesh.position.copy(botData.position as any);
      mesh.rotation.y = botData.rotation.y;
      this.scene.add(mesh);
      this.players.set(botId, { data: botData, mesh });
      this.bots.set(botId, new BotAI(botId, { data: botData, mesh }, this.getBotContext(), 'Hard'));
    }

    // Add Enemies (Red Team) - Nerfed
    for (let i = 0; i < 4; i++) {
      const botId = `bot_${i}`;
      const botData: PlayerData = {
        id: botId,
        position: { x: (i - 1.5) * 6, y: 0, z: 25 },
        rotation: { y: 0 },
        team: 'red',
        score: 0,
        holdingBallId: null,
        isOut: false,
        stamina: 80, // Less stamina
        maxStamina: 80,
        isBlocking: false,
        chargeLevel: 0,
        rank: 'Silver', // Lower rank
        level: 5,
        xp: 0
      };
      const mesh = createPlayerMesh('red');
      mesh.position.copy(botData.position as any);
      mesh.rotation.y = botData.rotation.y;
      this.scene.add(mesh);
      this.players.set(botId, { data: botData, mesh });
      this.bots.set(botId, new BotAI(botId, { data: botData, mesh }, this.getBotContext(), 'Medium'));
    }

    // Opening Rush: Balls at center
    for (let i = 0; i < 6; i++) {
      this.addBall({
        id: i,
        position: { x: (i - 2.5) * 6, y: 0.5, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        owner: null,
        state: 'idle',
        isLive: false,
        type: 'normal',
        curveFactor: 0,
        lastInteractionTime: Date.now()
      });
    }
    
    this.updateTeamCounts(); // Update HUD immediately
  }

  private addPlayer(data: PlayerData) {
    if (data.id === this.myId) {
      this.players.set(data.id, { data, mesh: new THREE.Group() }); // Dummy mesh for self
      this.onUpdateHUD({ score: data.score, team: data.team, isOut: data.isOut });
      this.updateTeamCounts();
      return;
    }
    const mesh = createPlayerMesh(data.team);
    mesh.position.copy(data.position);
    this.scene.add(mesh);
    this.players.set(data.id, { data, mesh });
    this.updateTeamCounts();
  }

  private addBall(data: BallData) {
    const mesh = createBallMesh();
    mesh.position.copy(data.position);
    this.scene.add(mesh);
    this.balls.set(data.id, { data, mesh });
    
    // Apply current ball color to all balls in offline mode for consistency
    if (!this.isOnline && this.currentBallColor) {
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        const colors: Record<string, number> = {
          'Yellow': 0xffff00,
          'Neon Blue': 0x00ffff,
          'Neon Red': 0xff0000,
          'Rainbow': 0xffffff,
          'Void': 0x4a044e,
          'Plasma': 0xec4899
        };
        const color = colors[this.currentBallColor] || 0xffff00;
        mesh.material.color.setHex(color);
        mesh.material.emissive.setHex(color);
        // Update light color too
        mesh.children.forEach(child => {
          if (child instanceof THREE.PointLight) child.color.setHex(color);
        });
      }
    }
  }

  private onBallGrabbed(ballId: number, playerId: string) {
    const ball = this.balls.get(ballId);
    const player = this.players.get(playerId);
    if (ball && player) {
      // Catch Rule: If ball was thrown and is still LIVE, catcher's team gets a player back
      if (ball.data.state === 'thrown' && ball.data.isLive && ball.data.owner) {
        const throwerId = ball.data.owner;
        const thrower = this.players.get(throwerId);
        if (thrower && thrower.data.team !== player.data.team) {
          // Check for catch angle (must be facing the ball)
          if (playerId === this.myId) {
             const toBall = new THREE.Vector3().subVectors(ball.mesh.position, this.camera.position).normalize();
             const lookDir = new THREE.Vector3();
             this.camera.getWorldDirection(lookDir);
             if (lookDir.dot(toBall) < 0.8) {
               // Failed catch (not looking at it) - Hit instead!
               this.onPlayerOut(playerId, 'hit');
               ball.data.isLive = false;
               return;
             }
          }

          sounds.playCatch(playerId === this.myId);
          // Offline catch: Just stop the ball, NO REVIVE (nerfed)
          // The thrower is NOT out, and no teammate returns.
          // It's purely a defensive move now.
        }
      }

      ball.data.state = 'held';
      ball.data.isLive = false;
      ball.data.owner = playerId;
      ball.data.lastInteractionTime = Date.now();
      ball.mesh.visible = false;
      player.data.holdingBallId = ballId;

      // Update visual indicator with ball skin
      const indicator = player.mesh.getObjectByName('heldBall') as THREE.Mesh;
      if (indicator) {
        indicator.visible = true;
        // Apply skin from the picked up ball
        if (ball.mesh.material instanceof THREE.MeshStandardMaterial && indicator.material instanceof THREE.MeshStandardMaterial) {
           indicator.material.color.copy(ball.mesh.material.color);
           indicator.material.emissive.copy(ball.mesh.material.emissive);
        }
      }

      if (playerId === this.myId) {
        this.onUpdateHUD({ holding: true });
        if (this.fpBall) {
          this.fpBall.visible = true;
          // Apply skin to FP ball
          if (ball.mesh.material instanceof THREE.MeshStandardMaterial && this.fpBall.material instanceof THREE.MeshStandardMaterial) {
             this.fpBall.material.color.copy(ball.mesh.material.color);
             this.fpBall.material.emissive.copy(ball.mesh.material.emissive);
          }
        }
      }
    }
  }

  private onPlayerOut(playerId: string, reason: string) {
    const player = this.players.get(playerId);
    if (player) {
      const myTeam = this.players.get(this.myId || 'local')?.data.team;
      if (player.data.team === myTeam) {
        sounds.playTeammateDeath();
      } else {
        sounds.playEnemyDeath();
      }

      player.data.isOut = true;
      player.mesh.visible = false;
      player.mesh.position.set(0, -10, 0);
      if (playerId === this.myId) {
        this.onUpdateHUD({ isOut: true });
        if (this.fpBall) this.fpBall.visible = false;
        // Drop ball if holding
        if (player.data.holdingBallId !== null) {
          const ball = this.balls.get(player.data.holdingBallId);
          if (ball) {
            ball.data.state = 'idle';
            ball.data.owner = null;
            ball.mesh.visible = true;
            ball.mesh.position.copy(this.camera.position);
          }
          player.data.holdingBallId = null;
          this.onUpdateHUD({ holding: false });
        }
      }
      this.checkWinCondition();
      this.updateTeamCounts();

      // Check for 1v1
      const activeBlue = Array.from(this.players.values()).filter(p => p.data.team === 'blue' && !p.data.isOut).length;
      const activeRed = Array.from(this.players.values()).filter(p => p.data.team === 'red' && !p.data.isOut).length;
      if (activeBlue === 1 && activeRed === 1) {
        sounds.playCrowdGasp();
      }
    }
  }

  private updateTeamCounts() {
    let blueCount = 0;
    let redCount = 0;
    this.players.forEach(p => {
      if (!p.data.isOut) {
        if (p.data.team === 'blue') blueCount++;
        else redCount++;
      }
    });
    this.onUpdateHUD({ bluePlayersLeft: blueCount, redPlayersLeft: redCount });
  }

  private checkWinCondition() {
    if (this.isOnline) return; // Server handles this
    if (!this.gameActive) return;

    const activeBlue = Array.from(this.players.values()).filter(p => p.data.team === 'blue' && !p.data.isOut).length;
    const activeRed = Array.from(this.players.values()).filter(p => p.data.team === 'red' && !p.data.isOut).length;

    if (activeBlue === 0 || activeRed === 0 || this.roundTime <= 0) {
      this.gameActive = false;
      let winner = 'draw';
      if (activeBlue > activeRed) winner = 'blue';
      else if (activeRed > activeBlue) winner = 'red';
      
      this.onUpdateHUD({ winner });
      setTimeout(() => {
        if (!this.isOnline) this.startOffline();
      }, 5000);
    }
  }

  private onBallThrown(ballId: number, position: any, velocity: any, playerId: string, type: 'normal' | 'curve' | 'lob' = 'normal', curveFactor: number = 0) {
    const ball = this.balls.get(ballId);
    const player = this.players.get(playerId);
    if (ball && player) {
      ball.data.state = 'thrown';
      ball.data.isLive = true; // Ball is now LIVE
      ball.data.owner = playerId;
      ball.data.position = position;
      ball.data.velocity = velocity;
      ball.data.type = type;
      ball.data.curveFactor = curveFactor;
      ball.data.lastInteractionTime = Date.now();
      ball.mesh.position.copy(position);
      ball.mesh.visible = true;
      player.data.holdingBallId = null;

      // Update visual indicator
      const indicator = player.mesh.getObjectByName('heldBall');
      if (indicator) indicator.visible = false;

      if (playerId === this.myId) {
        this.onUpdateHUD({ holding: false });
        if (this.fpBall) this.fpBall.visible = false;
      }
    }
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public lock() {
    this.controls.lock();
  }

  private animate() {
    requestAnimationFrame(this.animate.bind(this));
    const now = performance.now();
    const delta = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    const myPlayer = this.myId ? this.players.get(this.myId) : null;
    
    if (this.isOnline) {
      const state = this.network.getInterpolatedState(Date.now());
      if (state) {
        if ('fraction' in state) {
           this.applyInterpolatedState(state);
        } else {
           // It's a single snapshot (extrapolation/latest)
           // Create a fake interpolation object with fraction 1
           this.applyInterpolatedState({ prev: state, next: state, fraction: 1 });
        }
      }
      
    // Send Inputs
    if ((this.controls.isLocked || this.isMobile) && myPlayer && !myPlayer.data.isOut) {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      
      this.network.sendInput({
        move: { x: this.direction.x, z: this.direction.z },
        aim: { x: direction.x, y: direction.y, z: direction.z },
        sprint: this.isSprinting,
        block: this.isBlocking,
        throw: {
          active: this.isCharging && !this.canPickUp, // Simplified trigger
          charge: this.chargeLevel,
          curve: this.curveLeft ? -1 : (this.curveRight ? 1 : 0)
        },
        catch: false // TODO: Implement catch trigger
      });
    }
  }

  if ((this.controls.isLocked || this.isMobile) && myPlayer && !myPlayer.data.isOut) {
    this.updateMovement(delta);
  } else if (myPlayer && myPlayer.data.isOut) {
      this.updateSpectating();
    }

    if (!this.isOnline) {
      this.updateBots(delta);
      
      if (Date.now() - this.lastTimeUpdate > 1000) {
        this.roundTime--;
        this.lastTimeUpdate = Date.now();
        this.onUpdateHUD({ timer: this.roundTime });
        if (this.roundTime <= 0) this.checkWinCondition();
      }
    }

    // New Visuals
    this.updateTrails();
    
    // Animate Held Ball (Charge Shake)
    if (this.fpBall && this.isCharging) {
       const shake = Math.min(0.05, this.chargeLevel * 0.02);
       this.fpBall.position.set(
          0.4 + (Math.random() - 0.5) * shake,
          -0.3 + (Math.random() - 0.5) * shake,
          -0.6 + (Math.random() - 0.5) * shake
       );
    } else if (this.fpBall) {
       this.fpBall.position.set(0.4, -0.3, -0.6);
    }

    // Heartbeat Sound (Last Player)
    if (myPlayer && !myPlayer.data.isOut) {
      const myTeam = myPlayer.data.team;
      const teammatesAlive = Array.from(this.players.values()).filter(p => p.data.team === myTeam && !p.data.isOut).length;
      if (teammatesAlive === 1 && Date.now() - this.lastHeartbeatTime > 1000) {
        sounds.playHeartbeat();
        this.lastHeartbeatTime = Date.now();
      }
    }

    this.updateBalls(delta);
    this.updatePlayerVisuals();
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayerVisuals() {
    this.players.forEach((p, id) => {
      if (id === 'local' || id === this.myId) return; // Local player doesn't see their own body mesh usually (or handled separately)
      
      const shield = p.mesh.getObjectByName('shield');
      if (shield) {
        shield.visible = p.data.isBlocking;
        if (p.data.isBlocking) {
           shield.rotation.z = Math.sin(Date.now() * 0.01) * 0.1; // Subtle animation
        }
      }
      
      // Update held ball visibility based on state
      const heldBall = p.mesh.getObjectByName('heldBall');
      if (heldBall) {
        heldBall.visible = p.data.holdingBallId !== null;
      }
    });
  }

  public setMobile(value: boolean) {
    this.isMobile = value;
    // If mobile, we might want to disable pointer lock or handle it differently
  }

  public setMobileMove(x: number, y: number) {
    this.mobileMove.x = x;
    this.mobileMove.y = y;
  }

  public setMobileLook(dx: number, dy: number) {
    const myPlayer = this.myId ? this.players.get(this.myId) : null;
    if (myPlayer && myPlayer.data.isOut) {
      this.spectateOrbit.x -= dx * 0.005 * this.sensitivity;
      this.spectateOrbit.y = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.spectateOrbit.y + dy * 0.005 * this.sensitivity));
      return;
    }

    // For mobile look, we rotate the camera directly since pointer lock is for mouse
    const sensitivity = 0.002 * this.sensitivity;
    this.camera.rotation.y -= dx * sensitivity;
    
    // Clamp vertical rotation
    const pitch = this.camera.rotation.x - dy * sensitivity;
    this.camera.rotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
    
    // Ensure order is YXZ for FPS style
    this.camera.rotation.order = 'YXZ';
  }

  public setMobileAction(action: 'throw' | 'block' | 'sprint', active: boolean) {
    switch (action) {
      case 'throw':
        if (active) this.handleMouseDown();
        else this.handleMouseUp();
        break;
      case 'block':
        this.isBlocking = active;
        break;
      case 'sprint':
        this.isSprinting = active;
        break;
    }
  }

  private updateMovement(delta: number) {
    const myPlayer = this.myId ? this.players.get(this.myId)?.data : null;
    if (!myPlayer) return;

    // Stamina Regeneration
    if (Date.now() - this.lastStaminaUseTime > 2000) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 25 * delta);
    }

    // Sprinting Logic
    let currentSpeed = 120.0;
    if (this.isSprinting && this.stamina > 5 && (this.moveForward || this.moveBackward || this.moveLeft || this.moveRight)) {
      currentSpeed = 220.0;
      this.stamina -= 40 * delta;
      this.lastStaminaUseTime = Date.now();
    }

    // Charging Logic
    if (this.isCharging) {
      this.chargeLevel = Math.min(1.5, this.chargeLevel + delta);
      this.stamina -= 20 * delta;
      this.lastStaminaUseTime = Date.now();
      sounds.playCharge(this.chargeLevel); // Update pitch
      if (this.stamina <= 0) {
        this.handleMouseUp(); // Force throw if out of stamina
      }
    }

    // Blocking Logic
    if (this.isBlocking) {
      if (myPlayer.holdingBallId === null) {
        this.isBlocking = false; // Can't block without ball
      } else if (this.stamina > 0) {
        this.stamina -= 30 * delta;
        this.lastStaminaUseTime = Date.now();
        if (this.stamina <= 0) {
          this.isBlocking = false;
          // Force drop ball (vulnerable state)
          this.throwBall(myPlayer.holdingBallId, 0);
        }
      }
    }

    // Holding Ball Timer (Eliminate if held too long > 10s)
    if (myPlayer.holdingBallId !== null) {
      const ball = this.balls.get(myPlayer.holdingBallId);
      if (ball && Date.now() - ball.data.lastInteractionTime > 10000) {
        this.onPlayerOut(this.myId!, 'timeout');
      }
    }

    // Balanced movement
    const friction = 8.0;
    const acceleration = currentSpeed;

    this.velocity.x -= this.velocity.x * friction * delta;
    this.velocity.z -= this.velocity.z * friction * delta;

    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
    
    if (this.isMobile) {
      this.direction.x = this.mobileMove.x;
      this.direction.z = this.mobileMove.y; 
    }

    this.direction.normalize();

    if (this.moveForward || this.moveBackward || (this.isMobile && Math.abs(this.mobileMove.y) > 0.1)) this.velocity.z -= this.direction.z * acceleration * delta;
    if (this.moveLeft || this.moveRight || (this.isMobile && Math.abs(this.mobileMove.x) > 0.1)) this.velocity.x -= this.direction.x * acceleration * delta;

    this.controls.moveRight(-this.velocity.x * delta);
    this.controls.moveForward(-this.velocity.z * delta);

    // Arena bounds & Center line (Dodgeball Rules)
    const limit = ARENA_SIZE / 2 - 2.0;
    
    this.camera.position.x = Math.max(-limit, Math.min(limit, this.camera.position.x));
    
    if (myPlayer.team === 'blue') {
      this.camera.position.z = Math.max(-limit, Math.min(-0.5, this.camera.position.z));
    } else {
      this.camera.position.z = Math.max(0.5, Math.min(limit, this.camera.position.z));
    }

    // Update HUD
    this.onUpdateHUD({ 
      stamina: this.stamina, 
      chargeLevel: this.chargeLevel,
      isBlocking: this.isBlocking
    });

    // Update Pickup Indicator & Aim Feedback
    let canPick = false;
    let isAimingAtEnemy = false;
    
    if (!myPlayer.isOut) {
      if (myPlayer.holdingBallId === null) {
        this.balls.forEach(ball => {
          if (ball.data.state === 'idle' || ball.data.state === 'thrown') {
            if (this.camera.position.distanceTo(ball.mesh.position) < 4.0) {
              canPick = true;
            }
          }
        });
      } else {
        // Check if aiming at enemy
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        this.players.forEach((p, id) => {
          if (id !== this.myId && p.data.team !== myPlayer.team && p.mesh.visible) {
            const toEnemy = new THREE.Vector3().subVectors(p.mesh.position, this.camera.position).normalize();
            if (direction.dot(toEnemy) > 0.92) { // Match aim assist threshold
              isAimingAtEnemy = true;
            }
          }
        });
      }
    }

    if (canPick !== this.canPickUp) {
      this.canPickUp = canPick;
      this.onUpdateHUD({ canPickUp: canPick });
    }
    this.onUpdateHUD({ isAimingAtEnemy });
  }

  public dispose() {
    this.isOnline = false;
    this.gameActive = false;
    document.exitPointerLock();
    // Clear scene
    while(this.scene.children.length > 0){ 
      this.scene.remove(this.scene.children[0]); 
    }
    this.renderer.dispose();
  }

  private updateSpectating() {
    const myTeam = this.players.get(this.myId!)?.data.team;
    
    // Find someone to spectate if we don't have one or they are out
    if (!this.spectatingId || (this.players.get(this.spectatingId)?.data.isOut)) {
      const teammates = Array.from(this.players.entries())
        .filter(([id, p]) => id !== this.myId && p.data.team === myTeam && !p.data.isOut);
      
      if (teammates.length > 0) {
        this.spectatingId = teammates[0][0];
      } else {
        this.spectatingId = null;
      }
    }

    if (this.isMobile) {
      // Use mobile look for spectating orbit
      // We'll handle this in setMobileLook if we are out
    }

    if (this.spectatingId) {
      const target = this.players.get(this.spectatingId)!;
      const targetPos = target.mesh.position.clone().add(new THREE.Vector3(0, 1, 0));
      
      // Orbit camera calculation
      const x = this.spectateDistance * Math.sin(this.spectateOrbit.x) * Math.cos(this.spectateOrbit.y);
      const y = this.spectateDistance * Math.sin(this.spectateOrbit.y);
      const z = this.spectateDistance * Math.cos(this.spectateOrbit.x) * Math.cos(this.spectateOrbit.y);
      
      const cameraPos = targetPos.clone().add(new THREE.Vector3(x, y, z));
      
      this.camera.position.lerp(cameraPos, 0.1);
      this.camera.lookAt(targetPos);
    }
  }

  private getBotContext(): IGameContext {
    return {
      players: this.players,
      balls: this.balls,
      claimedBallIds: this.claimedBallIds,
      onBallGrabbed: this.onBallGrabbed.bind(this),
      onBallThrown: this.onBallThrown.bind(this),
      createTrail: this.createTrail.bind(this)
    };
  }

  private updateBots(delta: number) {
    this.claimedBallIds.clear();
    this.bots.forEach(bot => bot.update(delta));
  }

  private updateBalls(delta: number) {
    this.balls.forEach((ball, id) => {
      if (ball.data.state === 'thrown' || ball.data.state === 'idle') {
        
        // Curve Physics - Gradual & Speed Dependent
        if (ball.data.state === 'thrown' && ball.data.type === 'curve' && ball.data.isLive) {
          const velocity = new THREE.Vector3(ball.data.velocity.x, ball.data.velocity.y, ball.data.velocity.z);
          const speed = velocity.length();
          
          const forward = new THREE.Vector3(velocity.x, 0, velocity.z).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const right = new THREE.Vector3().crossVectors(forward, up).normalize();
          
          const speedFactor = Math.max(0.2, 1.0 - (speed / 60));
          const curveStrength = ball.data.curveFactor * 35 * speedFactor * delta;
          
          const curveForce = right.multiplyScalar(curveStrength);
          
          ball.data.velocity.x += curveForce.x;
          ball.data.velocity.z += curveForce.z;
          
          const newVel = new THREE.Vector3(ball.data.velocity.x, ball.data.velocity.y, ball.data.velocity.z);
          newVel.normalize().multiplyScalar(speed);
          ball.data.velocity.x = newVel.x;
          ball.data.velocity.z = newVel.z;
        }

        // Apply velocity
        ball.mesh.position.x += ball.data.velocity.x * delta;
        ball.mesh.position.y += ball.data.velocity.y * delta;
        ball.mesh.position.z += ball.data.velocity.z * delta;
        
        // Gravity
        if (ball.mesh.position.y > 0.3) {
          let gravity = 15;
          if (ball.data.type === 'lob') gravity = 8;
          ball.data.velocity.y -= gravity * delta;
        }

        // Floor collision & Bouncing
        if (ball.mesh.position.y < 0.3) {
          ball.mesh.position.y = 0.3;
          
          if (ball.data.isLive) {
            ball.data.isLive = false;
            ball.data.owner = null;
            ball.data.state = 'idle';
          }

          ball.data.velocity.y *= -0.6;
          
          // Improved Friction
          const friction = 0.95; // Keep 95% of velocity per frame when on ground
          ball.data.velocity.x *= Math.pow(friction, delta * 60);
          ball.data.velocity.z *= Math.pow(friction, delta * 60);

          if (Math.abs(ball.data.velocity.y) < 1.0) ball.data.velocity.y = 0;
          if (Math.abs(ball.data.velocity.x) < 0.1) ball.data.velocity.x = 0;
          if (Math.abs(ball.data.velocity.z) < 0.1) ball.data.velocity.z = 0;
        }

        // Out of Bounds Reset (Respawn Mechanic)
        if (Math.abs(ball.mesh.position.x) > ARENA_SIZE / 2 + 5 || Math.abs(ball.mesh.position.z) > ARENA_SIZE / 2 + 5 || ball.mesh.position.y < -5) {
           ball.data.state = 'idle';
           ball.data.isLive = false;
           ball.data.owner = null;
           ball.data.velocity = { x: 0, y: 0, z: 0 };
           ball.mesh.position.set(0, 5, 0); // Drop from sky at center
        }

        // Wall collision & Bouncing
        const limit = ARENA_SIZE / 2 - 0.5;
        if (Math.abs(ball.mesh.position.x) > limit) {
          ball.mesh.position.x = Math.sign(ball.mesh.position.x) * limit;
          ball.data.velocity.x *= -0.6;
          ball.data.isLive = false; // Dead on wall hit
        }
        if (Math.abs(ball.mesh.position.z) > limit) {
          ball.mesh.position.z = Math.sign(ball.mesh.position.z) * limit;
          ball.data.velocity.z *= -0.6;
          ball.data.isLive = false; // Dead on wall hit
        }
        
        // Update Trail Color to be White (Smoke/Air trail)
        const trail = this.ballTrails.get(id);
        if (trail && trail.mesh.visible) {
           (trail.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xFFFFFF);
           (trail.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4;
        }

        // Player collision (Raycast for anti-tunneling)
        if (ball.data.state === 'thrown' && ball.data.isLive) {
          const ballOwner = this.players.get(ball.data.owner || '');
          const prevPos = ball.mesh.position.clone().sub(new THREE.Vector3(ball.data.velocity.x * delta, ball.data.velocity.y * delta, ball.data.velocity.z * delta));
          const currentPos = ball.mesh.position.clone();
          
          // Segment for this frame
          const segment = new THREE.Line3(prevPos, currentPos);
          const closestPoint = new THREE.Vector3();

          this.players.forEach((player, playerId) => {
            if (playerId !== ball.data.owner && player.mesh.visible && !player.data.isOut) {
              if (ballOwner && ballOwner.data.team === player.data.team) return;

              const playerPos = playerId === 'local' ? this.camera.position.clone() : player.mesh.position.clone();
              // Adjust player pos to center mass (chest height)
              if (playerId !== 'local') playerPos.y += 1.05; 
              else playerPos.y -= 0.5; // Camera is at 1.6, chest is around 1.1
              
              segment.closestPointToPoint(playerPos, true, closestPoint);
              const dist = closestPoint.distanceTo(playerPos);
              
              // Hit radius: 0.6 (Player width) + 0.35 (Ball radius) = 0.95
              if (dist < 1.0) {
                sounds.playHit();
                this.onPlayerOut(playerId, 'hit');
                ball.data.isLive = false;
                ball.data.velocity.x *= 0.2;
                ball.data.velocity.z *= 0.2;
                ball.data.velocity.y = 5;
              }
            }
          });
        }
      }
    });
  }
}
