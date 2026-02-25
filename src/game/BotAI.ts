import * as THREE from 'three';
import { PlayerData, BallData, ARENA_SIZE } from './constants';

export interface IGameContext {
    players: Map<string, { data: PlayerData; mesh: THREE.Group }>;
    balls: Map<number, { data: BallData; mesh: THREE.Mesh }>;
    claimedBallIds: Set<number>;
    onBallGrabbed: (ballId: number, playerId: string) => void;
    onBallThrown: (ballId: number, position: THREE.Vector3, velocity: THREE.Vector3, playerId: string, type: 'normal' | 'curve' | 'lob', curveFactor: number) => void;
    createTrail: (ballId: number) => void;
}

type BotState = 'IDLE' | 'MOVING_TO_BALL' | 'ATTACKING' | 'DODGING' | 'REPOSITIONING' | 'DEFENDING' | 'SUPPORTING' | 'CLUTCH';

interface PerceptionData {
    enemies: { id: string; dist: number; position: THREE.Vector3; velocity: THREE.Vector3; threat: number }[];
    incomingBalls: { id: number; dist: number; velocity: THREE.Vector3; timeToImpact: number; threatScore: number; isAimedAtMe: boolean }[];
    nearestBall: { id: number; dist: number; position: THREE.Vector3 } | null;
    teammates: { id: string; isTargeted: boolean; targetCount: number }[];
    staminaStatus: number;
    isLastAlive: boolean;
}

export class BotAI {
    private id: string;
    private bot: { data: PlayerData; mesh: THREE.Group };
    private game: IGameContext;
    
    // Personality & Stats
    private difficulty: 'Easy' | 'Medium' | 'Hard' | 'Insane';
    private personality: 'Sniper' | 'Trickster' | 'Defender' | 'Aggressor';
    private personalityMultipliers = {
        accuracy: 1.0,
        dodgeFreq: 1.0,
        curveChance: 0.1,
        fakeChance: 0.1,
        catchChance: 0.1,
        throwFreq: 1.0
    };
    
    // State
    private currentState: BotState = 'IDLE';
    private perception: PerceptionData;
    private lastTickTime: number = 0;
    private tickInterval: number = 200; // 5Hz decision making
    
    private moveTarget: THREE.Vector3 | null = null;
    private targetEnemyId: string | null = null;
    private targetBallId: number | null = null;
    
    // Movement smoothing
    private currentVelocity = new THREE.Vector3();
    private jitterOffset = new THREE.Vector3();
    private lastJitterTime = 0;

    constructor(id: string, bot: { data: PlayerData; mesh: THREE.Group }, game: IGameContext, difficulty: 'Easy' | 'Medium' | 'Hard' | 'Insane' = 'Medium') {
        this.id = id;
        this.bot = bot;
        this.game = game;
        this.difficulty = difficulty;
        
        // Initialize perception
        this.perception = {
            enemies: [],
            incomingBalls: [],
            nearestBall: null,
            teammates: [],
            staminaStatus: 100,
            isLastAlive: false
        };

        // Assign random personality
        const personalities = ['Sniper', 'Trickster', 'Defender', 'Aggressor'] as const;
        this.personality = personalities[Math.floor(Math.random() * personalities.length)];
        this.applyPersonality();
    }

    private applyPersonality() {
        switch (this.personality) {
            case 'Sniper':
                this.personalityMultipliers.accuracy = 1.2;
                this.personalityMultipliers.dodgeFreq = 0.8;
                this.personalityMultipliers.curveChance = 0.05;
                break;
            case 'Trickster':
                this.personalityMultipliers.curveChance = 0.4;
                this.personalityMultipliers.fakeChance = 0.3;
                this.personalityMultipliers.accuracy = 0.9;
                break;
            case 'Defender':
                this.personalityMultipliers.catchChance = 0.25;
                this.personalityMultipliers.dodgeFreq = 1.1;
                break;
            case 'Aggressor':
                this.personalityMultipliers.throwFreq = 1.25;
                this.personalityMultipliers.accuracy = 1.05;
                break;
        }
    }

    public update(delta: number) {
        const now = Date.now();
        if (now - this.lastTickTime > this.tickInterval) {
            this.tick();
            this.lastTickTime = now;
        }

        this.executeMovement(delta);
        this.executeActions(delta);
    }

    private tick() {
        this.updatePerception();
        
        // Behavior Tree Main Selector
        if (this.checkClutchMode()) return;
        if (this.checkEmergencyDefense()) return;
        if (this.checkBallAcquisition()) return;
        if (this.checkCombat()) return;
        if (this.checkSupport()) return;
        if (this.checkReposition()) return;
        
        this.currentState = 'IDLE';
    }

    // --- Perception Phase ---

    private updatePerception() {
        const botPos = this.bot.mesh.position;
        const botTeam = this.bot.data.team;
        
        // 1. Scan Enemies
        this.perception.enemies = [];
        this.game.players.forEach((p, id) => {
            if (id !== this.id && p.data.team !== botTeam && !p.data.isOut && p.mesh.visible) {
                const dist = botPos.distanceTo(p.mesh.position);
                
                // Visibility check (120 degree cone)
                const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.bot.mesh.quaternion);
                const toEnemy = new THREE.Vector3().subVectors(p.mesh.position, botPos).normalize();
                const angle = forward.angleTo(toEnemy);
                
                if (angle < Math.PI * 0.66) { // Roughly 120 degrees
                    // Target Scoring
                    let score = (1 / dist) * 20;
                    if (p.data.stamina < 30) score += 3;
                    if (p.data.holdingBallId === null) score += 2;
                    
                    this.perception.enemies.push({
                        id,
                        dist,
                        position: p.mesh.position.clone(),
                        velocity: new THREE.Vector3(),
                        threat: score
                    });
                }
            }
        });

        // 2. Scan Incoming Balls
        this.perception.incomingBalls = [];
        this.game.balls.forEach((ball, id) => {
            if (ball.data.state === 'thrown' && ball.data.isLive && ball.data.owner !== this.id) {
                const dist = botPos.distanceTo(ball.mesh.position);
                const ballVel = new THREE.Vector3(ball.data.velocity.x, ball.data.velocity.y, ball.data.velocity.z);
                const speed = ballVel.length();
                
                if (speed > 1) {
                    const toBot = new THREE.Vector3().subVectors(botPos, ball.mesh.position).normalize();
                    const ballDir = ballVel.clone().normalize();
                    const dot = toBot.dot(ballDir);
                    const isAimedAtMe = dot > 0.85;

                    // Threat Formula
                    let threatScore = (1 / Math.max(1, dist)) * 2;
                    threatScore += (speed * 0.1);
                    if (isAimedAtMe) threatScore += 4;

                    this.perception.incomingBalls.push({
                        id,
                        dist,
                        velocity: ballVel,
                        timeToImpact: dist / speed,
                        threatScore,
                        isAimedAtMe
                    });
                }
            }
        });
        this.perception.incomingBalls.sort((a, b) => a.timeToImpact - b.timeToImpact);

        // 3. Scan Nearest Ball
        let bestBallDist = Infinity;
        this.perception.nearestBall = null;
        this.game.balls.forEach((ball, id) => {
            if ((ball.data.state === 'idle' || ball.data.state === 'thrown') && !ball.data.isLive) {
                const dist = botPos.distanceTo(ball.mesh.position);
                const isBlue = botTeam === 'blue';
                const safeZ = isBlue ? ball.mesh.position.z < 2 : ball.mesh.position.z > -2;
                
                if (safeZ && !this.game.claimedBallIds.has(id)) {
                    if (dist < bestBallDist) {
                        bestBallDist = dist;
                        this.perception.nearestBall = { id, dist, position: ball.mesh.position.clone() };
                    }
                }
            }
        });

        // 4. Team Status
        let teammatesAlive = 0;
        this.perception.teammates = [];
        this.game.players.forEach((p, id) => {
            if (p.data.team === botTeam && !p.data.isOut) {
                teammatesAlive++;
                if (id !== this.id) {
                    this.perception.teammates.push({ id, isTargeted: false, targetCount: 0 });
                }
            }
        });
        this.perception.isLastAlive = teammatesAlive === 1;
        this.perception.staminaStatus = this.bot.data.stamina;
    }

    // --- Behavior Tree Branches ---

    private checkClutchMode(): boolean {
        if (this.perception.isLastAlive) {
            this.currentState = 'CLUTCH';
            return false;
        }
        return false;
    }

    private checkEmergencyDefense(): boolean {
        if (this.perception.incomingBalls.length === 0) return false;

        const threat = this.perception.incomingBalls[0];
        const thresholds = { Easy: 10, Medium: 8, Hard: 6, Insane: 4 };
        const threshold = thresholds[this.difficulty];

        if (threat.threatScore > threshold || threat.isAimedAtMe) {
            this.currentState = 'DEFENDING';
            const roll = Math.random();
            const canCatch = this.bot.data.holdingBallId === null;
            
            if (canCatch && threat.timeToImpact < 0.6) {
                let catchProb = { Easy: 0.05, Medium: 0.15, Hard: 0.30, Insane: 0.50 }[this.difficulty];
                catchProb += this.personalityMultipliers.catchChance;
                if (roll < catchProb && threat.velocity.length() < 45) {
                    this.moveTarget = threat.velocity.clone().normalize().multiplyScalar(-1).add(this.bot.mesh.position);
                    return true;
                }
            }

            if (this.bot.data.stamina > 20) {
                this.currentState = 'DODGING';
                const dodgeDir = new THREE.Vector3(-threat.velocity.z, 0, threat.velocity.x).normalize();
                const testPos = this.bot.mesh.position.clone().add(dodgeDir.clone().multiplyScalar(4));
                if (Math.abs(testPos.x) > ARENA_SIZE / 2 - 2) dodgeDir.negate();
                this.moveTarget = this.bot.mesh.position.clone().add(dodgeDir.multiplyScalar(5));
                return true;
            }

            if (this.bot.data.holdingBallId !== null) {
                this.bot.data.isBlocking = true;
                this.moveTarget = null;
                return true;
            }
        }
        return false;
    }

    private checkBallAcquisition(): boolean {
        if (this.bot.data.holdingBallId !== null) return false;
        if (this.perception.nearestBall && this.perception.incomingBalls.length === 0) {
            this.currentState = 'MOVING_TO_BALL';
            this.targetBallId = this.perception.nearestBall.id;
            this.moveTarget = this.perception.nearestBall.position;
            this.game.claimedBallIds.add(this.targetBallId);
            return true;
        }
        return false;
    }

    private checkCombat(): boolean {
        if (this.bot.data.holdingBallId === null) return false;
        const targets = [...this.perception.enemies].sort((a, b) => b.threat - a.threat);
        if (targets.length === 0) return false;
        const target = targets[0];
        this.targetEnemyId = target.id;
        this.currentState = 'ATTACKING';
        const dist = target.dist;
        const roll = Math.random();
        if (dist < 15 && roll < 0.3) {
            this.bot.data.chargeLevel = 1.2; 
        } else if (dist < 25) {
            this.bot.data.chargeLevel = 0.6;
        } else if (this.personality === 'Trickster' || roll < this.personalityMultipliers.curveChance) {
            this.bot.data.chargeLevel = 0.8;
        }
        return true;
    }

    private checkSupport(): boolean {
        if (this.bot.data.holdingBallId === null) return false;
        const teammateInTrouble = this.perception.teammates.find(t => t.targetCount >= 2);
        if (teammateInTrouble) {
            this.currentState = 'SUPPORTING';
            return true;
        }
        return false;
    }

    private checkReposition(): boolean {
        if (this.perception.incomingBalls.length > 0) return false;
        this.currentState = 'REPOSITIONING';
        const zBase = this.bot.data.team === 'blue' ? -18 : 18;
        const xRand = (Math.random() - 0.5) * (ARENA_SIZE - 10);
        const zRand = (Math.random() - 0.5) * 5;
        const newTarget = new THREE.Vector3(xRand, 1.6, zBase + zRand);
        let tooClose = false;
        this.game.players.forEach((p, id) => {
            if (id !== this.id && p.data.team === this.bot.data.team && !p.data.isOut) {
                if (p.mesh.position.distanceTo(newTarget) < 4) tooClose = true;
            }
        });
        if (!tooClose || !this.moveTarget) {
            this.moveTarget = newTarget;
        }
        return true;
    }

    private executeMovement(delta: number) {
        const botPos = this.bot.mesh.position;
        if (Date.now() - this.lastJitterTime > 1500) {
            this.jitterOffset.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
            this.lastJitterTime = Date.now();
        }
        if (this.moveTarget) {
            const targetWithJitter = this.moveTarget.clone().add(this.jitterOffset);
            const dir = new THREE.Vector3().subVectors(targetWithJitter, botPos).normalize();
            dir.y = 0;
            let speed = 8.0;
            if (this.currentState === 'DODGING') speed = 14.0;
            if (this.currentState === 'MOVING_TO_BALL') speed = 11.0;
            if (this.currentState === 'ATTACKING') speed = 5.0;
            if (this.currentState === 'CLUTCH') speed = 10.0;
            const desiredVel = dir.multiplyScalar(speed);
            this.currentVelocity.lerp(desiredVel, delta * 5);
            botPos.add(this.currentVelocity.clone().multiplyScalar(delta));
            if (this.currentState === 'ATTACKING' && this.targetEnemyId) {
                const target = this.game.players.get(this.targetEnemyId);
                if (target) {
                    this.bot.mesh.lookAt(target.mesh.position.x, 1.6, target.mesh.position.z);
                }
            } else {
                const lookTarget = botPos.clone().add(this.currentVelocity);
                this.bot.mesh.lookAt(lookTarget.x, 1.6, lookTarget.z);
            }
        }
        const limit = ARENA_SIZE / 2 - 1.5;
        botPos.x = Math.max(-limit, Math.min(limit, botPos.x));
        const zLimit = 0.5;
        if (this.bot.data.team === 'blue') {
            botPos.z = Math.max(-limit, Math.min(-zLimit, botPos.z));
        } else {
            botPos.z = Math.max(zLimit, Math.min(limit, botPos.z));
        }
        this.bot.data.position = { x: botPos.x, y: botPos.y, z: botPos.z };
    }

    private executeActions(delta: number) {
        if (this.currentState === 'MOVING_TO_BALL' && this.targetBallId !== null) {
            const ball = this.game.balls.get(this.targetBallId);
            if (ball) {
                if (this.bot.mesh.position.distanceTo(ball.mesh.position) < 2.5) {
                    this.game.onBallGrabbed(this.targetBallId, this.id);
                    this.targetBallId = null;
                }
            } else {
                this.targetBallId = null;
            }
        }
        if (this.currentState === 'ATTACKING' && this.targetEnemyId) {
            const target = this.game.players.get(this.targetEnemyId);
            if (target && this.bot.data.holdingBallId !== null) {
                this.bot.data.chargeLevel += delta * this.personalityMultipliers.throwFreq;
                const chargeThreshold = 0.6 + Math.random() * 0.8;
                if (this.bot.data.chargeLevel > chargeThreshold) {
                    this.performThrow(target.mesh.position);
                }
            }
        }
    }

    private performThrow(targetPos: THREE.Vector3) {
        if (this.bot.data.holdingBallId === null) return;
        const botPos = this.bot.mesh.position;
        const dir = new THREE.Vector3().subVectors(targetPos, botPos).normalize();
        dir.y += 0.15;
        const acc = this.personalityMultipliers.accuracy;
        const spread = (1 - acc) * 0.15;
        dir.x += (Math.random() - 0.5) * spread;
        dir.y += (Math.random() - 0.5) * spread;
        dir.z += (Math.random() - 0.5) * spread;
        dir.normalize();
        const power = 25 + (this.bot.data.chargeLevel * 15);
        const velocity = dir.multiplyScalar(power);
        const spawnPos = botPos.clone().add(new THREE.Vector3(0, 1, 0));
        let type: 'normal' | 'curve' = 'normal';
        let curveFactor = 0;
        if (Math.random() < this.personalityMultipliers.curveChance) {
            type = 'curve';
            curveFactor = (Math.random() - 0.5) * 5;
        }
        this.game.onBallThrown(this.bot.data.holdingBallId, spawnPos, velocity, this.id, type, curveFactor);
        this.game.createTrail(this.bot.data.holdingBallId);
        this.bot.data.holdingBallId = null;
        this.bot.data.chargeLevel = 0;
        this.currentState = 'IDLE';
    }
}
