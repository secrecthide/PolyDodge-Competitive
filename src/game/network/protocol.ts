export interface InputPacket {
  seq: number;
  timestamp: number;
  move: { x: number; z: number };
  aim: { x: number; y: number; z: number }; // Normalized direction vector
  sprint: boolean;
  block: boolean;
  throw: {
    active: boolean;
    charge: number; // 0 to 1.5
    curve: number; // -1 to 1 (left/right)
  };
  catch: boolean;
}

export interface PlayerSnapshot {
  id: string;
  team: 'blue' | 'red';
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  rot: { y: number };
  state: 'alive' | 'out' | 'respawning';
  stamina: number;
  holding: number | null; // Ball ID
  blocking: boolean;
  charge: number;
}

export interface BallSnapshot {
  id: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  state: 'idle' | 'held' | 'thrown';
  owner: string | null;
  type: 'normal' | 'curve' | 'lob';
}

export interface WorldSnapshot {
  tick: number;
  time: number; // Match time remaining
  timestamp: number; // Server timestamp
  matchState: 'warmup' | 'playing' | 'finished';
  countdown: number; // Time until match starts (if warmup)
  players: PlayerSnapshot[];
  balls: BallSnapshot[];
  events: GameEvent[];
}

export interface GameEvent {
  type: 'elimination' | 'catch' | 'respawn' | 'win';
  data: any;
  timestamp: number;
}

export interface InitPacket {
  playerId: string;
  matchId: string;
  mode: 'casual' | 'ranked';
  startTime: number;
  serverTime: number;
}

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 15; // Send every 2 ticks
