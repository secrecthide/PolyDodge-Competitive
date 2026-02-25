import { Match } from './Match';
import { Socket } from 'socket.io';

export class MatchManager {
  private matches: Map<string, Match> = new Map();
  private casualQueue: Socket[] = [];
  private rankedQueue: Socket[] = [];
  private playerMatchMap: Map<string, string> = new Map(); // PlayerId -> MatchId

  constructor() {
    // Clean up finished matches
    setInterval(() => {
      this.matches.forEach((match, id) => {
        if (match.isFinished()) {
          this.matches.delete(id);
          console.log(`Match ${id} cleaned up.`);
        }
      });
    }, 10000);
  }

  public handleConnection(socket: Socket) {
    console.log(`Player ${socket.id} connected.`);

    socket.on('joinQueue', (mode: 'casual' | 'ranked') => {
      this.addToQueue(socket, mode);
    });

    socket.on('leaveQueue', () => {
      this.removeFromQueue(socket);
    });

    socket.on('disconnect', () => {
      this.removeFromQueue(socket);
      const matchId = this.playerMatchMap.get(socket.id);
      if (matchId) {
        const match = this.matches.get(matchId);
        if (match) {
          match.removePlayer(socket.id);
        }
        this.playerMatchMap.delete(socket.id);
      }
    });
  }

  private addToQueue(socket: Socket, mode: 'casual' | 'ranked') {
    // Remove from existing queues first
    this.removeFromQueue(socket);

    if (mode === 'casual') {
      this.casualQueue.push(socket);
      this.broadcastQueueStatus('casual');
      this.checkQueue('casual');
    } else {
      this.rankedQueue.push(socket);
      this.broadcastQueueStatus('ranked');
      this.checkQueue('ranked');
    }
  }

  private removeFromQueue(socket: Socket) {
    const wasInCasual = this.casualQueue.some(s => s.id === socket.id);
    const wasInRanked = this.rankedQueue.some(s => s.id === socket.id);

    this.casualQueue = this.casualQueue.filter(s => s.id !== socket.id);
    this.rankedQueue = this.rankedQueue.filter(s => s.id !== socket.id);

    if (wasInCasual) this.broadcastQueueStatus('casual');
    if (wasInRanked) this.broadcastQueueStatus('ranked');
  }

  private broadcastQueueStatus(mode: 'casual' | 'ranked') {
    const queue = mode === 'casual' ? this.casualQueue : this.rankedQueue;
    queue.forEach(s => {
      s.emit('queueStatus', { position: queue.length, mode });
    });
  }

  private checkQueue(mode: 'casual' | 'ranked') {
    const queue = mode === 'casual' ? this.casualQueue : this.rankedQueue;
    const requiredPlayers = mode === 'casual' ? 2 : 4; // Lower threshold for testing, ideally 4 or 8

    if (queue.length >= requiredPlayers) {
      const players = queue.splice(0, requiredPlayers);
      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const match = new Match(matchId, mode, players);
      
      this.matches.set(matchId, match);
      players.forEach(p => this.playerMatchMap.set(p.id, matchId));
      
      match.start();
      console.log(`Started ${mode} match ${matchId} with ${players.length} players.`);
    }
  }
}
