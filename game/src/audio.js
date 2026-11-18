// All of Vice Heat's sound is synthesised with WebAudio: no audio files. A lazy
// AudioContext wakes on the first key or click (browsers require a gesture), then
// this module offers the engine hum, the police siren, one-shot effects and a
// small synthwave loop that plays under everything.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let musicStep = 0;

  function wake() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    startMusic();
  }

  function tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.3, freq = 1200, when = 0) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  // A minor synthwave: a driving bass eighth-note and a pad chord every two bars.
  const BASS = [55, 0, 55, 55, 0, 55, 0, 55, 65.4, 0, 65.4, 65.4, 0, 65.4, 0, 65.4, 49, 0, 49, 49, 0, 49, 0, 49, 73.4, 0, 73.4, 73.4, 0, 82.4, 0, 73.4];
  const PADS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
  function startMusic() {
    if (musicTimer) return;
    musicTimer = setInterval(() => {
      if (!ctx || muted) return;
      const step = musicStep;
      musicStep += 1;
      const bass = BASS[step % BASS.length];
      if (bass) tone(bass, 0.16, 'sawtooth', 0.055);
      if (step % 32 === 0) {
        const chord = PADS[Math.floor(step / 32) % PADS.length];
        for (const f of chord) tone(f, 3.4, 'triangle', 0.028);
      }
      if (step % 8 === 4) noise(0.03, 0.012, 6000); // a whisper of hi-hat
    }, 132);
  }

  return {
    wake,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
    /** Engine loop while the player drives; rpm 0..1. Call with null to stop it. */
    engine(rpm) {
      if (!ctx) return;
      if (rpm === null) {
        if (engineOsc) { engineOsc.stop(); engineOsc = null; engineGain = null; }
        return;
      }
      if (muted) return;
      if (!engineOsc) {
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        engineOsc.type = 'sawtooth';
        engineGain.gain.value = 0.05;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        engineOsc.connect(filter).connect(engineGain).connect(master);
        engineOsc.start();
      }
      engineOsc.frequency.value = 55 + rpm * 165;
    },
    /** Police siren while a chase is near; on/off. */
    siren(on) {
      if (!ctx) return;
      if (!on) {
        if (sirenOsc) { sirenOsc.stop(); sirenOsc = null; sirenGain = null; }
        return;
      }
      if (muted || sirenOsc) return;
      sirenOsc = ctx.createOscillator();
      sirenGain = ctx.createGain();
      sirenOsc.type = 'triangle';
      sirenGain.gain.value = 0.016;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.65;
      lfoGain.gain.value = 170;
      lfo.connect(lfoGain).connect(sirenOsc.frequency);
      sirenOsc.frequency.value = 830;
      sirenOsc.connect(sirenGain).connect(master);
      sirenOsc.start();
      lfo.start();
      sirenOsc.onended = () => lfo.stop();
    },
    shot() { noise(0.09, 0.32, 2600); tone(150, 0.07, 'square', 0.16, 0, 60); },
    punch() { tone(110, 0.09, 'sine', 0.3, 0, 55); noise(0.05, 0.12, 700); },
    crash(big) { noise(big ? 0.4 : 0.18, big ? 0.4 : 0.22, big ? 500 : 800); },
    pickup() { tone(880, 0.09, 'sine', 0.18); tone(1318, 0.14, 'sine', 0.18, 0.08); },
    cash() { tone(988, 0.07, 'square', 0.1); tone(1319, 0.07, 'square', 0.1, 0.06); tone(1568, 0.12, 'square', 0.1, 0.12); },
    phone() { tone(1046, 0.07, 'square', 0.07); tone(1046, 0.07, 'square', 0.07, 0.12); },
    sting() { tone(523, 0.12, 'triangle', 0.2); tone(659, 0.12, 'triangle', 0.2, 0.11); tone(784, 0.22, 'triangle', 0.22, 0.22); },
    fail() { tone(392, 0.16, 'triangle', 0.18); tone(311, 0.26, 'triangle', 0.18, 0.15); },
    door() { noise(0.06, 0.1, 900); tone(196, 0.06, 'sine', 0.1, 0.03); },
  };
}
