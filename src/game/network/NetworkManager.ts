import { io, Socket } from 'socket.io-client';
import * as THREE from 'three';
import { InputPacket, WorldSnapshot, InitPacket, TICK_RATE } from './protocol';

export class NetworkManager {
  private socket: Socket;
  private inputSeq: number = 0;
  private snapshots: WorldSnapshot[] = [];
  
  public playerId: string | null = null;
  public matchId: string | null = null;
  public serverTimeOffset: number = 0;
  
  public onInit: ((data: InitPacket) => void) | null = null;
  public onSnapshot: ((snapshot: WorldSnapshot) => void) | null = null;
  public onEvent: ((event: any) => void) | null = null;
  public onQueueStatus: ((data: { position: number, mode: 'casual' | 'ranked' }) => void) | null = null;

  constructor() {
    this.socket = io();
    
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('queueStatus', (data: { position: number, mode: 'casual' | 'ranked' }) => {
      if (this.onQueueStatus) this.onQueueStatus(data);
    });

    this.socket.on('init', (data: InitPacket) => {
      this.playerId = data.playerId;
      this.matchId = data.matchId;
      this.serverTimeOffset = data.serverTime - Date.now();
      if (this.onInit) this.onInit(data);
    });

    this.socket.on('snapshot', (snapshot: WorldSnapshot) => {
      this.snapshots.push(snapshot);
      // Keep buffer small
      if (this.snapshots.length > 20) this.snapshots.shift();
      if (this.onSnapshot) this.onSnapshot(snapshot);
    });

    this.socket.on('event', (event: any) => {
      if (this.onEvent) this.onEvent(event);
    });
  }

  public joinQueue(mode: 'casual' | 'ranked') {
    this.socket.emit('joinQueue', mode);
  }

  public sendInput(input: Omit<InputPacket, 'seq' | 'timestamp'>) {
    const packet: InputPacket = {
      ...input,
      seq: this.inputSeq++,
      timestamp: Date.now() + this.serverTimeOffset
    };
    this.socket.emit('input', packet);
  }

  public disconnect() {
    this.socket.disconnect();
  }

  public getInterpolatedState(renderTime: number) {
    // Find two snapshots surrounding renderTime
    // renderTime should be typically (serverTime - 100ms)
    
    const serverTime = Date.now() + this.serverTimeOffset;
    const interpolationTime = serverTime - 100; // 100ms buffer

    let prev = this.snapshots[0];
    let next = this.snapshots[1];

    if (!prev || !next) return null;

    // Find correct window
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].timestamp <= interpolationTime && this.snapshots[i+1].timestamp >= interpolationTime) {
        prev = this.snapshots[i];
        next = this.snapshots[i+1];
        break;
      }
    }

    if (next.timestamp < interpolationTime) {
      // We are lagging behind server updates, extrapolate or just return latest
      return next;
    }

    const total = next.timestamp - prev.timestamp;
    const fraction = (interpolationTime - prev.timestamp) / total;

    return { prev, next, fraction };
  }
}
