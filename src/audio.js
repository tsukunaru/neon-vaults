const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const SECTOR_AUDIO_THEMES = Object.freeze([
  { pad: "triangle", lead: "sine", percussion: 3100, cutoff: 2400 },
  { pad: "sawtooth", lead: "triangle", percussion: 720, cutoff: 1500 },
  { pad: "sine", lead: "triangle", percussion: 1850, cutoff: 2900 },
  { pad: "triangle", lead: "square", percussion: 4200, cutoff: 2100 },
  { pad: "sawtooth", lead: "sine", percussion: 540, cutoff: 1250 },
  { pad: "sine", lead: "sine", percussion: 5100, cutoff: 3300 },
  { pad: "triangle", lead: "square", percussion: 2600, cutoff: 2700 },
  { pad: "sawtooth", lead: "triangle", percussion: 980, cutoff: 1650 },
  { pad: "sine", lead: "triangle", percussion: 3900, cutoff: 3100 },
  { pad: "sawtooth", lead: "square", percussion: 460, cutoff: 1200 },
  { pad: "triangle", lead: "sine", percussion: 2200, cutoff: 2300 },
  { pad: "square", lead: "triangle", percussion: 680, cutoff: 1350 },
  { pad: "sine", lead: "square", percussion: 6100, cutoff: 3600 },
]);

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.echo = null;
    this.echoGain = null;
    this.noiseBuffer = null;
    this.timer = null;
    this.nextBeat = 0;
    this.step = 0;
    this.dotStep = 0;
    this.paused = false;
    this.intensity = 0;
    this.zone = 0;
  }

  unlock() {
    if (!this.context) this.setup();
    this.context?.resume?.()?.catch?.(() => {});
    this.sync();
  }

  setup() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const context = this.context = new Context();
    this.master = context.createGain();
    this.master.gain.value = 0.72;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 16;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    this.master.connect(compressor).connect(context.destination);

    this.musicBus = context.createGain();
    this.musicBus.gain.value = 0.2 * (this.settings.musicVolume ?? 65) / 100;
    this.musicBus.connect(this.master);
    this.sfxBus = context.createGain();
    this.sfxBus.gain.value = 0.48 * (this.settings.soundVolume ?? 80) / 100;
    this.sfxBus.connect(this.master);

    this.echo = context.createDelay(0.4);
    this.echo.delayTime.value = 0.145;
    this.echoGain = context.createGain();
    this.echoGain.gain.value = 0.21;
    this.echo.connect(this.echoGain).connect(this.echo);
    this.echo.connect(this.master);

    const buffer = context.createBuffer(1, context.sampleRate * 0.45, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const envelope = Math.pow(1 - index / data.length, 2.4);
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    this.noiseBuffer = buffer;
  }

  envelope(gain, time, volume, attack, duration, release = 0.08) {
    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);
  }

  tone(frequency, options = {}) {
    if (!this.context || this.paused) return;
    const time = options.time ?? this.context.currentTime;
    const duration = options.duration ?? 0.1;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), time + duration);
    if (options.detune) oscillator.detune.value = options.detune;
    filter.type = "lowpass";
    filter.frequency.value = options.cutoff || 8200;
    oscillator.connect(filter).connect(gain);
    gain.connect(options.bus || this.sfxBus);
    if (options.echo) gain.connect(this.echo);
    this.envelope(gain, time, options.volume ?? 0.12, options.attack ?? 0.005, duration, options.release ?? 0.07);
    oscillator.start(time);
    oscillator.stop(time + duration + (options.release ?? 0.07) + 0.03);
  }

  noise(options = {}) {
    if (!this.context || this.paused || !this.noiseBuffer) return;
    const time = options.time ?? this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = options.filterType || "bandpass";
    filter.frequency.value = options.frequency || 900;
    filter.Q.value = options.q || 0.8;
    source.connect(filter).connect(gain).connect(options.bus || this.sfxBus);
    this.envelope(gain, time, options.volume ?? 0.07, 0.002, options.duration ?? 0.06, options.release ?? 0.04);
    source.start(time);
    source.stop(time + (options.duration ?? 0.06) + (options.release ?? 0.04) + 0.02);
  }

  dash() {
    if (!this.settings.sound) return;
    this.tone(190, { type: "triangle", endFrequency: 430, duration: 0.075, volume: 0.055, cutoff: 1800 });
    this.noise({ frequency: 1250, q: 0.55, duration: 0.055, volume: 0.035 });
  }

  impact() {
    if (!this.settings.sound) return;
    this.tone(105, { type: "sine", endFrequency: 68, duration: 0.075, volume: 0.105, cutoff: 650, release: 0.12 });
    this.noise({ frequency: 340, duration: 0.045, volume: 0.035 });
  }

  dot() {
    if (!this.settings.sound) return;
    const notes = [784, 880, 988, 1175, 1319];
    const note = notes[this.dotStep++ % notes.length];
    this.tone(note, { type: "sine", duration: 0.025, release: 0.055, volume: 0.045, echo: true });
  }

  coin() {
    if (!this.settings.sound || !this.context) return;
    const now = this.context.currentTime;
    this.tone(988, { time: now, type: "sine", duration: 0.07, volume: 0.11, echo: true });
    this.tone(1480, { time: now + 0.045, type: "triangle", duration: 0.12, volume: 0.075, echo: true });
    this.tone(1976, { time: now + 0.085, type: "sine", duration: 0.09, volume: 0.045, echo: true });
  }

  switch() { this.chord([330, 494, 659], 0.045, "triangle"); }
  checkpoint() { this.chord([392, 523, 784], 0.07, "sine", 0.08); }

  secret() { this.chord([659, 988, 1319], 0.045, "triangle", 0.085); }

  portalLocked() {
    if (!this.settings.sound) return;
    this.tone(180, { type: "square", endFrequency: 92, duration: 0.12, volume: 0.055, cutoff: 900 });
    this.tone(280, { type: "sawtooth", endFrequency: 140, duration: 0.08, volume: 0.035, cutoff: 1200 });
  }

  teleport() {
    if (!this.settings.sound || !this.context) return;
    const now = this.context.currentTime;
    this.tone(240, { time: now, type: "sine", endFrequency: 1180, duration: 0.22, volume: 0.08, echo: true });
    this.tone(360, { time: now + 0.025, type: "triangle", endFrequency: 1760, duration: 0.18, volume: 0.045, echo: true });
  }

  hazard() {
    if (!this.settings.sound) return;
    this.tone(196, { type: "sawtooth", endFrequency: 92, duration: 0.32, volume: 0.07, cutoff: 900, release: 0.16 });
    this.noise({ frequency: 520, q: 1.8, duration: 0.14, release: 0.2, volume: 0.06 });
  }

  exit() {
    if (!this.settings.sound || !this.context) return;
    const now = this.context.currentTime;
    [523, 659, 784, 1047].forEach((note, index) => this.tone(note, {
      time: now + index * 0.065, type: index % 2 ? "triangle" : "sine", duration: 0.18,
      volume: 0.085 - index * 0.008, echo: true,
    }));
  }

  chest() {
    if (!this.settings.sound || !this.context) return;
    const now = this.context.currentTime;
    this.noise({ time: now, frequency: 1700, duration: 0.12, volume: 0.05 });
    [392, 523, 659, 784, 1047, 1319].forEach((note, index) => this.tone(note, {
      time: now + index * 0.075, type: "sine", duration: 0.25, volume: 0.075, echo: true,
    }));
  }

  chord(notes, spacing = 0.04, type = "sine", volume = 0.065) {
    if (!this.settings.sound || !this.context) return;
    const now = this.context.currentTime;
    notes.forEach((note, index) => this.tone(note, { time: now + index * spacing, type, duration: 0.13, volume, echo: true }));
  }

  setIntensity(value) { this.intensity = clamp(value, 0, 1); }
  setZone(value) { this.zone = Math.max(0, Math.floor(value || 0)); }

  kick(time, theme = SECTOR_AUDIO_THEMES[0]) {
    this.tone(105, { time, bus: this.musicBus, type: theme.pad, endFrequency: 44, duration: 0.11, release: 0.08, volume: 0.12, cutoff: Math.min(900, theme.cutoff) });
  }

  musicNote(frequency, time, duration, volume = 0.05, type = "triangle", cutoff = 2400) {
    this.tone(frequency, { time, bus: this.musicBus, duration, release: 0.14, volume, type, cutoff });
  }

  scheduleBeat(time, step) {
    if (!this.settings.music) return;
    const theme = SECTOR_AUDIO_THEMES[this.zone % SECTOR_AUDIO_THEMES.length];
    const zoneRoots = [110, 123.47, 98, 116.54, 103.83, 130.81, 146.83, 138.59, 92.5, 82.41, 123.47, 103.83, 110];
    const base = zoneRoots[this.zone % zoneRoots.length];
    const roots = [base, base * 1.1892, base * 0.8909, base * 1.3348];
    const root = roots[Math.floor(step / 16) % roots.length];
    const beat = step % 16;
    if (beat % 4 === 0) this.kick(time, theme);
    if (beat === 4 || beat === 12) this.noise({ time, bus: this.musicBus, frequency: theme.percussion, q: 0.6, duration: 0.035, volume: 0.035 });
    if (beat % 2 === 0) this.musicNote(root * (beat % 4 === 0 ? 1 : 1.5), time, 0.12, 0.055, theme.pad, theme.cutoff);
    const melody = [2, 3, 5, 3, 6, 5, 3, 2, 2, 5, 6, 5, 8, 6, 5, 3];
    if (beat % 2 === 1 || this.intensity > 0.55) {
      this.musicNote(root * melody[beat], time, 0.08, 0.022 + this.intensity * 0.012, theme.lead, Math.min(4200, theme.cutoff + 900));
    }
    if (this.intensity > 0.72 && beat % 4 === 2) this.noise({ time, bus: this.musicBus, frequency: 7600, duration: 0.025, volume: 0.018 });
  }

  scheduler() {
    if (!this.context || this.paused || !this.settings.music) return;
    while (this.nextBeat < this.context.currentTime + 0.18) {
      this.scheduleBeat(this.nextBeat, this.step++);
      this.nextBeat += 60 / 112 / 4;
    }
  }

  sync() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.musicBus?.gain.setTargetAtTime((this.settings.music ? 0.2 : 0) * (this.settings.musicVolume ?? 65) / 100, now, 0.03);
    this.sfxBus?.gain.setTargetAtTime((this.settings.sound ? 0.48 : 0) * (this.settings.soundVolume ?? 80) / 100, now, 0.03);
    if (this.settings.music && !this.paused && !this.timer) {
      this.nextBeat = this.context.currentTime + 0.04;
      this.timer = setInterval(() => this.scheduler(), 45);
    } else if ((!this.settings.music || this.paused) && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause() { this.paused = true; this.sync(); this.context?.suspend?.()?.catch?.(() => {}); }
  resume() { this.paused = false; this.context?.resume?.()?.catch?.(() => {}); this.sync(); }
}
