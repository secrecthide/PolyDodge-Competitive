import { Socket } from 'socket.io';
import * as THREE from 'three';
import { InputPacket, PlayerSnapshot, BallSnapshot, WorldSnapshot, GameEvent, TICK_RATE, TICK_DT } from '../src/game/network/protocol';

interface ServerPlayer {
  id: string;
  socket: Socket;
  team: 'blue' | 'red';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: number;
  state: 'alive' | 'out' | 'respawning';
  stamina: number;
  holding: number | null;
  blocking: boolean;
  charge: number;
  lastInputSeq: number;
  inputBuffer: InputPacket[];
}

interface ServerBall {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  state: 'idle' | 'held' | 'thrown';
  owner: string | null;
  type: 'normal' | 'curve' | 'lob';
  curveFactor: number;
  lastInteraction: number;
}

export class Match {
  public id: string;
  public mode: 'casual' | 'ranked';
  private players: Map<string, ServerPlayer> = new Map();
  private balls: Map<number, ServerBall> = new Map();
  private events: GameEvent[] = [];
  
  private tickInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private matchTime: number = 180; // 3 minutes
  private tickCount: number = 0;
  private lastTickTime: number = 0;
  
  private matchState: 'warmup' | 'playing' | 'finished' = 'warmup';
  private countdown: number = 5; // 5 seconds warmup

  // History Buffer for Lag Compensation (Rewind)
  private history: Map<number, Map<string, THREE.Vector3>> = new Map(); // Tick -> PlayerId -> Pos
  private HISTORY_SIZE = 30; // 1 second history at 30Hz

  constructor(id: string, mode: 'casual' | 'ranked', sockets: Socket[]) {
    this.id = id;
    this.mode = mode;
    
    // Initialize Players
    sockets.forEach((socket, index) => {
      const team = index % 2 === 0 ? 'blue' : 'red';
      const spawnZ = team === 'blue' ? -20 : 20;
      const pos = new THREE.Vector3((Math.random() - 0.5) * 20, 1.05, spawnZ);
      
      this.players.set(socket.id, {
        id: socket.id,
        socket,
        team,
        pos,
        vel: new THREE.Vector3(),
        rot: team === 'blue' ? Math.PI : 0,
        state: 'alive',
        stamina: 100,
        holding: null,
        blocking: false,
        charge: 0,
        lastInputSeq: 0,
        inputBuffer: []
      });

      // Setup Socket Listeners
      socket.on('input', (packet: InputPacket) => {
        const p = this.players.get(socket.id);
        if (p) {
          // Simple validation: discard old packets
          if (packet.seq > p.lastInputSeq) {
            p.inputBuffer.push(packet);
            // Sort buffer by sequence to ensure order
            p.inputBuffer.sort((a, b) => a.seq - b.seq);
          }
        }
      });

      socket.emit('init', {
        playerId: socket.id,
        matchId: this.id,
        mode: this.mode,
        startTime: Date.now() + 5000, // 5s warmup
        serverTime: Date.now()
      });
    });

    // Initialize Balls
    for (let i = 0; i < 6; i++) {
      this.balls.set(i, {
        id: i,
        pos: new THREE.Vector3((i - 2.5) * 5, 0.5, 0),
        vel: new THREE.Vector3(),
        state: 'idle',
        owner: null,
        type: 'normal',
        curveFactor: 0,
        lastInteraction: 0
      });
    }
  }

  public start() {
    this.startTime = Date.now();
    this.lastTickTime = this.startTime;
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  public stop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  public isFinished() {
    return this.matchTime <= 0 || this.players.size === 0;
  }

  public removePlayer(id: string) {
    const p = this.players.get(id);
    if (p) {
      // Mark as disconnected but keep in game as a "bot" (simplified)
      // Ideally we would replace with a real BotAI instance
      // For now, just stop them moving and maybe auto-throw if holding
      p.state = 'out'; // Eliminate them for now to avoid zombie players
      this.events.push({ type: 'elimination', data: { playerId: id, by: 'disconnect' }, timestamp: Date.now() });
    }
    
    // Handle ball drop if holding
    this.balls.forEach(b => {
      if (b.owner === id) {
        b.state = 'idle';
        b.owner = null;
        b.vel.set(0, 0, 0);
      }
    });
    
    this.players.delete(id);
  }

  private tick() {
    const now = Date.now();
    const dt = TICK_DT; // Fixed time step
    this.tickCount++;

    // State Machine
    if (this.matchState === 'warmup') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.matchState = 'playing';
        this.countdown = 0;
        this.respawnAll();
      }
    } else if (this.matchState === 'playing') {
      this.matchTime -= dt;
      if (this.matchTime <= 0) {
        this.matchState = 'finished';
        this.events.push({ type: 'win', data: { winner: 'draw' }, timestamp: Date.now() }); // TODO: Determine winner
        this.stop();
      }
    }

    // 1. Process Inputs
    this.players.forEach(p => {
      // Process all pending inputs
      while (p.inputBuffer.length > 0) {
        const input = p.inputBuffer.shift()!;
        p.lastInputSeq = input.seq;
        
        if (p.state !== 'alive') continue;

        // Movement Logic (Server Authoritative)
        const speed = input.sprint && p.stamina > 0 ? 15 : 8;
        const moveDir = new THREE.Vector3(input.move.x, 0, input.move.z).normalize();
        
        // Apply Velocity
        p.vel.x = moveDir.x * speed;
        p.vel.z = moveDir.z * speed;
        
        // Apply Position
        p.pos.add(p.vel.clone().multiplyScalar(dt));
        
        // Clamp Position (Arena Bounds)
        const limit = 30; // Arena Size / 2
        p.pos.x = Math.max(-limit, Math.min(limit, p.pos.x));
        p.pos.z = Math.max(-limit, Math.min(limit, p.pos.z));
        
        // Rotation
        p.rot = Math.atan2(input.aim.x, input.aim.z);

        // Actions
        if (input.throw.active && p.holding !== null) {
          this.throwBall(p, input.throw);
        }
        
        if (input.catch) {
          this.tryCatch(p);
        }

        // Stamina
        if (input.sprint) p.stamina = Math.max(0, p.stamina - 10 * dt);
        else p.stamina = Math.min(100, p.stamina + 5 * dt);
      }
    });

    // 2. Physics Simulation (Balls)
    this.balls.forEach(b => {
      if (b.state === 'thrown' || b.state === 'idle') {
        // Gravity
        if (b.pos.y > 0.35) b.vel.y -= 15 * dt;

        // Move
        b.pos.add(b.vel.clone().multiplyScalar(dt));

        // Floor Bounce
        if (b.pos.y < 0.35) {
          b.pos.y = 0.35;
          b.vel.y *= -0.6;
          b.vel.x *= 0.9; // Friction
          b.vel.z *= 0.9;
          
          if (b.state === 'thrown') {
            b.state = 'idle';
            b.owner = null;
            b.type = 'normal';
          }
        }

        // Wall Bounce
        const limit = 29;
        if (Math.abs(b.pos.x) > limit) {
          b.pos.x = Math.sign(b.pos.x) * limit;
          b.vel.x *= -0.6;
          b.state = 'idle';
        }
        if (Math.abs(b.pos.z) > limit) {
          b.pos.z = Math.sign(b.pos.z) * limit;
          b.vel.z *= -0.6;
          b.state = 'idle';
        }

        // Hit Detection
        if (b.state === 'thrown' && b.vel.length() > 5) {
          this.checkHits(b);
        }
      } else if (b.state === 'held' && b.owner) {
        const p = this.players.get(b.owner);
        if (p) {
          b.pos.copy(p.pos).add(new THREE.Vector3(0, 1, 0)); // Hold position
        } else {
          b.state = 'idle';
          b.owner = null;
        }
      }
    });

    // 3. Store History for Rewind
    const snapshot = new Map<string, THREE.Vector3>();
    this.players.forEach(p => snapshot.set(p.id, p.pos.clone()));
    this.history.set(this.tickCount, snapshot);
    if (this.history.size > this.HISTORY_SIZE) {
      this.history.delete(this.tickCount - this.HISTORY_SIZE);
    }

    // 4. Broadcast Snapshot
    if (this.tickCount % 2 === 0) { // Send every 2nd tick (15Hz)
      this.broadcastSnapshot();
    }
  }

  private throwBall(p: ServerPlayer, throwInput: any) {
    const b = this.balls.get(p.holding!);
    if (!b) return;

    b.state = 'thrown';
    b.owner = p.id;
    b.pos.copy(p.pos).add(new THREE.Vector3(0, 1.5, 0)); // Throw height
    
    const aimDir = new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot)).normalize();
    // Add pitch (y) from input if available, otherwise assume straight
    // For now, simple forward throw
    const speed = 25 + (throwInput.charge * 25); // 25 to 50 speed
    b.vel.copy(aimDir).multiplyScalar(speed);
    b.vel.y = 2 + (throwInput.charge * 5); // Slight arc

    b.type = Math.abs(throwInput.curve) > 0.5 ? 'curve' : 'normal';
    b.curveFactor = throwInput.curve;
    
    p.holding = null;
  }

  private tryCatch(p: ServerPlayer) {
    // Simple catch logic: check balls in front
    // In a real implementation, we would use rewind here too
    // But for catching, usually strict server-time check is better to prevent "vacuum" hacks
    
    let caught = false;
    this.balls.forEach(b => {
      if (caught) return;
      if (b.state === 'thrown' && b.owner !== p.id) {
        const dist = p.pos.distanceTo(b.pos);
        if (dist < 3.0) {
          // Check angle
          const toBall = b.pos.clone().sub(p.pos).normalize();
          const facing = new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot));
          if (facing.dot(toBall) > 0.5) {
            // Success
            b.state = 'held';
            b.owner = p.id;
            b.vel.set(0, 0, 0);
            p.holding = b.id;
            caught = true;
            this.events.push({ type: 'catch', data: { playerId: p.id, ballId: b.id }, timestamp: Date.now() });
          }
        }
      } else if (b.state === 'idle' && p.holding === null) {
         const dist = p.pos.distanceTo(b.pos);
         if (dist < 2.0) {
            b.state = 'held';
            b.owner = p.id;
            p.holding = b.id;
            caught = true;
         }
      }
    });
  }

  private checkHits(b: ServerBall) {
    this.players.forEach(p => {
      if (p.id === b.owner || p.state !== 'alive') return;

      // Hitbox check (Capsule vs Sphere)
      // Simplified to Sphere vs Sphere for now
      // Player radius ~0.5, Ball radius ~0.35 -> Threshold ~0.85
      const dist = p.pos.distanceTo(b.pos);
      
      if (dist < 1.0) {
        // HIT!
        p.state = 'out';
        this.events.push({ type: 'elimination', data: { playerId: p.id, by: b.owner }, timestamp: Date.now() });
        b.state = 'idle';
        b.vel.multiplyScalar(0.2);
        b.vel.y = 5; // Pop up
      }
    });
  }

  private respawnAll() {
    this.players.forEach(p => {
      const spawnZ = p.team === 'blue' ? -20 : 20;
      p.pos.set((Math.random() - 0.5) * 20, 1.05, spawnZ);
      p.vel.set(0, 0, 0);
      p.state = 'alive';
      p.stamina = 100;
      p.holding = null;
    });
    
    // Reset balls
    this.balls.forEach(b => {
      b.state = 'idle';
      b.owner = null;
      b.vel.set(0, 0, 0);
      b.pos.set((b.id - 2.5) * 5, 0.5, 0);
    });
  }

  private broadcastSnapshot() {
    const snapshot: WorldSnapshot = {
      tick: this.tickCount,
      time: this.matchTime,
      timestamp: Date.now(),
      matchState: this.matchState,
      countdown: this.countdown,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        team: p.team,
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
        rot: { y: p.rot },
        state: p.state,
        stamina: p.stamina,
        holding: p.holding,
        blocking: p.blocking,
        charge: p.charge
      })),
      balls: Array.from(this.balls.values()).map(b => ({
        id: b.id,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
        state: b.state,
        owner: b.owner,
        type: b.type
      })),
      events: this.events
    };

    this.players.forEach(p => p.socket.emit('snapshot', snapshot));
    this.events = []; // Clear events after broadcast
  }
}
