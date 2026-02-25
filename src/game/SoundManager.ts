export class SoundManager {
  private ctx: AudioContext | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, volume: number, decay: boolean = true, slideTo?: number) {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
    }

    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    if (decay) {
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    }

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  public playThrow() {
    this.playTone(150, 'sine', 0.2, 0.3, true, 300); // Slide up "whoosh"
  }

  public playHit() {
    this.playTone(100, 'square', 0.15, 0.4, true, 50); // Crunch
    this.playTone(60, 'sine', 0.3, 0.5);
  }

  public playCatch(isLocalPlayer: boolean) {
    if (isLocalPlayer) {
      // Loud satisfying catch
      this.playTone(200, 'square', 0.1, 0.4, true, 50); // Thud
      this.playTone(800, 'sine', 0.4, 0.3, true, 1200); // Ding!
    } else {
      // Softer catch
      this.playTone(300, 'sine', 0.1, 0.2);
    }
  }

  public playPickup() {
    this.playTone(400, 'sine', 0.05, 0.1);
  }

  public playOut() {
    this.playTone(200, 'sawtooth', 0.5, 0.2);
    this.playTone(150, 'sawtooth', 0.5, 0.2);
  }

  public playTeammateDeath() {
    this.playTone(150, 'sawtooth', 0.4, 0.3, true, 50); // Sad slide down
  }

  public playEnemyDeath() {
    this.playTone(400, 'square', 0.1, 0.2);
    this.playTone(600, 'sine', 0.3, 0.3, true, 800); // Triumphant
  }

  public playCharge(level: number) {
    this.init();
    if (!this.ctx) return;

    if (!this.chargeOsc) {
      this.chargeOsc = this.ctx.createOscillator();
      this.chargeGain = this.ctx.createGain();
      this.chargeOsc.type = 'triangle';
      this.chargeOsc.connect(this.chargeGain);
      this.chargeGain.connect(this.ctx.destination);
      this.chargeOsc.start();
    }

    // Pitch rises with charge level (0 to 1.5)
    const freq = 200 + (level * 400);
    this.chargeOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
    this.chargeGain!.gain.setTargetAtTime(0.1, this.ctx.currentTime, 0.1);
  }

  public stopCharge() {
    if (this.chargeGain && this.ctx) {
      this.chargeGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      setTimeout(() => {
        if (this.chargeOsc) {
          this.chargeOsc.stop();
          this.chargeOsc.disconnect();
          this.chargeOsc = null;
        }
        if (this.chargeGain) {
          this.chargeGain.disconnect();
          this.chargeGain = null;
        }
      }, 150);
    }
  }

  public playCrowdGasp() {
    this.init();
    if (!this.ctx) return;
    // Simple noise burst
    const bufferSize = this.ctx.sampleRate * 1.5; // 1.5 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    
    // Low pass filter to make it sound like a crowd "Oooo"
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.5);
    
    noise.start();
  }

  public playHeartbeat() {
    this.playTone(60, 'sine', 0.1, 0.5, true);
    setTimeout(() => this.playTone(50, 'sine', 0.1, 0.4, true), 150);
  }
}

export const sounds = new SoundManager();
