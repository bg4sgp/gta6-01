// sound.js — every sound in Port Azura is synthesized with WebAudio: no
// audio files, no samples. Engine hum and sirens are living oscillators
// whose pitch follows the game; shots, crashes and jingles are one-shots.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    const master = this.ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.ctx.destination);
    this.master = master;
    this.startEngine();
    this.startMusic();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  tone(freq, dur, type = 'square', vol = 0.16, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, vol = 0.2, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(gain).connect(this.master);
    src.start(t0);
  }

  shot() {
    this.noise(0.09, 0.28);
    this.tone(160, 0.08, 'sawtooth', 0.12, 60);
  }

  punch() {
    this.noise(0.06, 0.18);
    this.tone(110, 0.07, 'sine', 0.2, 55);
  }

  crash(strength = 1) {
    this.noise(0.22 * strength, 0.3);
    this.tone(70, 0.2, 'triangle', 0.22, 38);
  }

  cash() {
    this.tone(880, 0.09, 'square', 0.12);
    this.tone(1318, 0.14, 'square', 0.12, null, 0.07);
  }

  phoneBuzz() {
    this.tone(440, 0.07, 'square', 0.07);
    this.tone(440, 0.07, 'square', 0.07, null, 0.12);
  }

  jobDone() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.16, 'triangle', 0.16, null, i * 0.09));
  }

  bustedSting() {
    const notes = [392, 370, 349, 311];
    notes.forEach((n, i) => this.tone(n, 0.22, 'sawtooth', 0.13, null, i * 0.13));
  }

  wastedSting() {
    const notes = [330, 262, 196, 131];
    notes.forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.15, null, i * 0.16));
  }

  startEngine() {
    if (!this.ctx || this.engineOsc) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  // speedRatio 0..1 while driving, null when on foot or in menus.
  engine(speedRatio) {
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    if (speedRatio === null) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.1);
    } else {
      this.engineOsc.frequency.setTargetAtTime(45 + speedRatio * 130, t, 0.06);
      this.engineGain.gain.setTargetAtTime(0.05 + speedRatio * 0.05, t, 0.1);
    }
  }

  siren(active, urgent) {
    if (!this.ctx) return;
    if (active && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0.028;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = urgent ? 1.5 : 0.9;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 190;
      lfo.connect(lfoGain).connect(this.sirenOsc.frequency);
      this.sirenOsc.frequency.value = 760;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
      lfo.start();
      this.sirenLfo = lfo;
    } else if (!active && this.sirenOsc) {
      try {
        this.sirenOsc.stop();
        this.sirenLfo.stop();
      } catch { /* already stopped */ }
      this.sirenOsc = null;
      this.sirenLfo = null;
    }
  }

  // A lazy synthwave bassline: two bars of A minor rolling under the game.
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [55, 0, 55, 55, 0, 65.4, 0, 49, 55, 0, 55, 55, 0, 82.4, 73.4, 49];
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.ctx) return;
      const note = bass[this.musicStep % bass.length];
      this.musicStep++;
      if (note) this.tone(note, 0.22, 'triangle', 0.11);
      if (this.musicStep % 8 === 0) this.noise(0.03, 0.03);
    }, 214);
  }
}
