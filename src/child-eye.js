import { createIcons, Minus, Plus } from 'lucide';

const app = document.querySelector('#app');
const stage = document.querySelector('#stage');
const statusText = document.querySelector('#status');
const readoutLabel = document.querySelector('#readout-label');
const readoutLevel = document.querySelector('#readout-level');
const meterFill = document.querySelector('#meter-fill');
const retryButton = document.querySelector('#retry');
const errorText = document.querySelector('#error');
const flash = document.querySelector('#flash');
const tearLayer = document.querySelector('#tear-layer');
const blockLayer = document.querySelector('#block-layer');
const frameTime = document.querySelector('#frame-time');
const titleBlock = document.querySelector('.title-block');
const waveNoise = document.querySelector('#wave-noise');
const waveMap = document.querySelector('#wave-map');
const voiceDock = document.querySelector('#voice-dock');
const voicePanel = document.querySelector('#voice-panel');
const voicePanelToggle = document.querySelector('#voice-panel-toggle');
const voicePanelMinimize = document.querySelector('#voice-panel-minimize');
const monitorToggle = document.querySelector('#monitor-toggle');
const mixSlider = document.querySelector('#mix');
const pitchSlider = document.querySelector('#pitch');
const toneSlider = document.querySelector('#tone');
const echoSlider = document.querySelector('#echo');
const driveSlider = document.querySelector('#drive');
const glitchSlider = document.querySelector('#glitch');
const monsterSlider = document.querySelector('#monster');
const outputSlider = document.querySelector('#output');
const mixValue = document.querySelector('#mix-value');
const pitchValue = document.querySelector('#pitch-value');
const toneValue = document.querySelector('#tone-value');
const echoValue = document.querySelector('#echo-value');
const driveValue = document.querySelector('#drive-value');
const glitchValue = document.querySelector('#glitch-value');
const monsterValue = document.querySelector('#monster-value');
const outputValue = document.querySelector('#output-value');

const videoBase = document.querySelector('#video-base');
const videoRed = document.querySelector('#video-red');
const videoCyan = document.querySelector('#video-cyan');
const videoAmber = document.querySelector('#video-amber');
const videos = [videoBase, videoRed, videoCyan, videoAmber];

const noiseCanvas = document.querySelector('#noise');
const noiseCtx = noiseCanvas.getContext('2d', { alpha: true });

const VOICE_STORAGE_KEY = 'child-eye-voice-settings';
const VOICE_PANEL_STORAGE_KEY = 'child-eye-voice-panel-collapsed';
const defaultVoiceSettings = {
  enabled: true,
  mix: 58,
  pitch: 88,
  tone: 42,
  echo: 18,
  drive: 12,
  glitch: 20,
  monster: 0,
  output: 50,
};

const loadVoiceSettings = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(VOICE_STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      return { ...defaultVoiceSettings, ...stored };
    }
  } catch {}
  return { ...defaultVoiceSettings };
};

const saveVoiceSettings = (settings) => {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
};

const loadVoicePanelCollapsed = () => {
  try {
    return window.localStorage.getItem(VOICE_PANEL_STORAGE_KEY) === 'true';
  } catch {}
  return false;
};

const saveVoicePanelCollapsed = (collapsed) => {
  try {
    window.localStorage.setItem(VOICE_PANEL_STORAGE_KEY, String(collapsed));
  } catch {}
};

const renderVoicePanelToggleIcon = (collapsed) => {
  if (!voicePanelToggle) return;
  voicePanelToggle.innerHTML = `<i class="voice-panel-toggle__icon" data-lucide="${collapsed ? 'plus' : 'minus'}" aria-hidden="true"></i>`;
  createIcons({
    icons: { Minus, Plus },
    attrs: { 'stroke-width': 2.3 },
  });
};

const state = {
  stream: null,
  audioContext: null,
  analyser: null,
  analyserData: null,
  level: 0,
  peak: 0,
  flash: 0,
  burst: 0,
  jitterX: 0,
  jitterY: 0,
  rollY: 0,
  skew: 0,
  nextBurstAt: 0,
  nextJitterAt: 0,
  ready: false,
  rafId: 0,
  noiseFrame: 0,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  supportsMedia: Boolean(navigator.mediaDevices?.getUserMedia),
  supportsAudio: Boolean(window.AudioContext || window.webkitAudioContext),
  cameraOnlyFallback: false,
  voice: loadVoiceSettings(),
  voicePanelCollapsed: loadVoicePanelCollapsed(),
  voiceGraph: null,
  voiceControlsBound: false,
  glitchGateAt: 0,
};

const tearBands = Array.from({ length: 22 }, (_, index) => {
  const band = document.createElement('span');
  band.className = `tear-band tear-band--${index % 4}`;
  tearLayer.append(band);
  return band;
});

const dataBlocks = Array.from({ length: 46 }, (_, index) => {
  const block = document.createElement('span');
  block.className = `data-block data-block--${index % 5}`;
  blockLayer.append(block);
  return block;
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (from, to, amount) => from + (to - from) * amount;

const getSoundActivity = (level, peak) => clamp(
  (level - 0.035) / 0.22 + (peak - 0.2) / 0.65,
  0,
  1,
);

const setStatus = (text) => {
  statusText.textContent = text;
};

const setError = (text) => {
  errorText.textContent = text;
  errorText.hidden = false;
  retryButton.hidden = false;
};

const clearError = () => {
  errorText.hidden = true;
  retryButton.hidden = true;
};

const makeDistortionCurve = (amount) => {
  const k = clamp(amount, 0, 400);
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;

  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }

  return curve;
};

const makeBitcrusherCurve = (bits) => {
  const steps = Math.max(2, Math.round(Math.pow(2, bits)));
  const samples = 44100;
  const curve = new Float32Array(samples);
  const half = steps / 2;

  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = Math.round(x * half) / half;
  }

  return curve;
};

const createPitchShifter = (context) => {
  const scriptNode = context.createScriptProcessor(2048, 1, 1);
  const maxDelay = 1.5;
  const buffer = new Float32Array(Math.floor(context.sampleRate * maxDelay));
  let writeIndex = 0;
  let readIndex = 0;
  let pitchRatio = 1;

  scriptNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    for (let i = 0; i < input.length; i += 1) {
      buffer[writeIndex] = input[i];
      writeIndex = (writeIndex + 1) % buffer.length;
    }

    for (let i = 0; i < output.length; i += 1) {
      const index = Math.floor(readIndex);
      const next = (index + 1) % buffer.length;
      const frac = readIndex - index;
      output[i] = buffer[index] * (1 - frac) + buffer[next] * frac;
      readIndex = (readIndex + pitchRatio) % buffer.length;
    }
  };

  scriptNode.setPitchRatio = (value) => {
    pitchRatio = value;
  };

  return scriptNode;
};

const readVoiceSettings = () => ({
  enabled: monitorToggle?.checked ?? true,
  mix: Number(mixSlider?.value ?? defaultVoiceSettings.mix),
  pitch: Number(pitchSlider?.value ?? defaultVoiceSettings.pitch),
  tone: Number(toneSlider?.value ?? defaultVoiceSettings.tone),
  echo: Number(echoSlider?.value ?? defaultVoiceSettings.echo),
  drive: Number(driveSlider?.value ?? defaultVoiceSettings.drive),
  glitch: Number(glitchSlider?.value ?? defaultVoiceSettings.glitch),
  monster: Number(monsterSlider?.value ?? defaultVoiceSettings.monster),
  output: Number(outputSlider?.value ?? defaultVoiceSettings.output),
});

const renderVoiceValues = (settings) => {
  if (mixValue) mixValue.textContent = `${Math.round(settings.mix)}%`;
  if (pitchValue) pitchValue.textContent = `${(settings.pitch / 100).toFixed(2)}x`;
  if (toneValue) toneValue.textContent = `${Math.round(settings.tone)}%`;
  if (echoValue) echoValue.textContent = `${Math.round(settings.echo)}%`;
  if (driveValue) driveValue.textContent = `${Math.round(settings.drive)}%`;
  if (glitchValue) glitchValue.textContent = `${Math.round(settings.glitch)}%`;
  if (monsterValue) monsterValue.textContent = `${Math.round(settings.monster)}%`;
  if (outputValue) outputValue.textContent = `${Math.round(settings.output)}%`;
};

const updateRangeFill = (input) => {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || min);
  const percent = max === min ? 0 : clamp(((value - min) / (max - min)) * 100, 0, 100);
  input.style.setProperty('--value', `${percent.toFixed(2)}%`);
};

const syncVoiceControls = () => {
  const settings = state.voice;
  if (monitorToggle) monitorToggle.checked = settings.enabled;
  if (mixSlider) mixSlider.value = String(settings.mix);
  if (pitchSlider) pitchSlider.value = String(settings.pitch);
  if (toneSlider) toneSlider.value = String(settings.tone);
  if (echoSlider) echoSlider.value = String(settings.echo);
  if (driveSlider) driveSlider.value = String(settings.drive);
  if (glitchSlider) glitchSlider.value = String(settings.glitch);
  if (monsterSlider) monsterSlider.value = String(settings.monster);
  if (outputSlider) outputSlider.value = String(settings.output);
  renderVoiceValues(settings);
  [mixSlider, pitchSlider, toneSlider, echoSlider, driveSlider, glitchSlider, monsterSlider, outputSlider].forEach(updateRangeFill);
};

const setVoicePanelAvailability = (available) => {
  if (!voicePanel) return;
  voicePanel.classList.toggle('is-disabled', !available);

  [
    monitorToggle,
    mixSlider,
    pitchSlider,
    toneSlider,
    echoSlider,
    driveSlider,
    glitchSlider,
    monsterSlider,
    outputSlider,
  ].forEach((control) => {
    if (control) control.disabled = !available;
  });
};

const setVoicePanelCollapsed = (collapsed, options = {}) => {
  state.voicePanelCollapsed = collapsed;
  voiceDock?.classList.toggle('is-collapsed', collapsed);

  if (voicePanel) {
    voicePanel.setAttribute('aria-hidden', String(collapsed));
    if ('inert' in voicePanel) {
      voicePanel.inert = collapsed;
    }
  }

  if (voicePanelToggle) {
    voicePanelToggle.setAttribute('aria-expanded', String(!collapsed));
    voicePanelToggle.setAttribute('aria-label', collapsed ? 'Expand voice changer settings' : 'Hide voice changer settings');
  }

  renderVoicePanelToggleIcon(collapsed);

  if (!options.skipSave) {
    saveVoicePanelCollapsed(collapsed);
  }
};

const destroyVoiceGraph = () => {
  const graph = state.voiceGraph;
  if (!graph) return;

  try {
    graph.lfo?.stop();
  } catch {}

  [
    graph.source,
    graph.voiceHighpass,
    graph.voiceLowpass,
    graph.noiseGate,
    graph.inputGain,
    graph.dryGain,
    graph.bodyHigh,
    graph.bodyLow,
    graph.bodyPeak,
    graph.pitchShifter,
    graph.monsterLow,
    graph.shaper,
    graph.bitcrusher,
    graph.glitchGate,
    graph.warbleDelay,
    graph.echoDelay,
    graph.echoFeedback,
    graph.wetGain,
    graph.echoWetGain,
    graph.outputGain,
    graph.compressor,
    graph.lfo,
    graph.lfoGain,
    graph.drone,
    graph.droneFilter,
    graph.droneGain,
    graph.analyser,
  ].forEach((node) => {
    try {
      node?.disconnect();
    } catch {}
  });

  state.voiceGraph = null;
};

const updateVoiceGraph = () => {
  const graph = state.voiceGraph;
  if (!graph || !state.audioContext) return;

  const now = state.audioContext.currentTime;
  const settings = state.voice;
  const mix = clamp(settings.mix / 100, 0, 1);
  const pitch = clamp((settings.pitch - 40) / 120, 0, 1);
  const tone = clamp(settings.tone / 100, 0, 1);
  const echo = clamp(settings.echo / 100, 0, 1);
  const drive = clamp(settings.drive / 100, 0, 1);
  const glitch = clamp(settings.glitch / 100, 0, 1);
  const monster = clamp(settings.monster / 100, 0, 1);
  const output = clamp(settings.output / 100, 0, 1);

  graph.dryGain.gain.setTargetAtTime(Math.max(0.1, 1 - mix * 0.82), now, 0.02);
  graph.wetGain.gain.setTargetAtTime(0.14 + mix * 0.92, now, 0.02);
  graph.echoWetGain.gain.setTargetAtTime(0.04 + echo * 0.32, now, 0.03);
  graph.echoFeedback.gain.setTargetAtTime(0.06 + echo * 0.42, now, 0.03);
  graph.echoDelay.delayTime.setTargetAtTime(0.045 + echo * 0.14 + glitch * 0.22 + monster * 0.3, now, 0.03);
  graph.bodyHigh.frequency.setTargetAtTime(45 + tone * 260, now, 0.02);
  graph.bodyLow.frequency.setTargetAtTime(2400 + tone * 5000, now, 0.02);
  graph.bodyPeak.frequency.setTargetAtTime(420 + pitch * 1850 - monster * 260, now, 0.02);
  graph.bodyPeak.gain.setTargetAtTime(-9 + pitch * 11 + tone * 4, now, 0.02);
  graph.warbleDelay.delayTime.setTargetAtTime(0.008 + pitch * 0.015, now, 0.02);
  graph.lfo.frequency.setTargetAtTime(0.28 + pitch * 3.2 + tone * 0.4, now, 0.02);
  graph.lfoGain.gain.setTargetAtTime(0.0007 + pitch * 0.0046 + drive * 0.0014, now, 0.02);
  graph.pitchShifter.setPitchRatio(1 - monster * 0.55);
  graph.monsterLow.gain.setTargetAtTime(monster * 9, now, 0.05);
  graph.shaper.curve = makeDistortionCurve((drive + monster * 0.55) * 380);
  graph.bitcrusher.curve = makeBitcrusherCurve(16 - glitch * 12);
  graph.droneGain.gain.setTargetAtTime(glitch * 0.14 + monster * 0.06, now, 0.12);
  graph.drone.frequency.setTargetAtTime(46 + glitch * 16, now, 0.12);
  graph.outputGain.gain.setTargetAtTime((settings.enabled ? 0.2 + output * 0.8 : 0), now, 0.02);
  graph.compressor.threshold.setTargetAtTime(-24 + drive * -8, now, 0.02);
  graph.compressor.ratio.setTargetAtTime(4 + drive * 12, now, 0.02);
};

const applyVoiceSettings = (options = {}) => {
  state.voice = readVoiceSettings();
  if (!options.skipSave) {
    saveVoiceSettings(state.voice);
  }
  renderVoiceValues(state.voice);
  updateVoiceGraph();
};

const buildVoiceGraph = () => {
  destroyVoiceGraph();

  if (!state.audioContext || !state.stream) return;

  const context = state.audioContext;
  const source = context.createMediaStreamSource(state.stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.78;
  state.analyser = analyser;
  state.analyserData = new Uint8Array(analyser.fftSize);

  const voiceHighpass = context.createBiquadFilter();
  const voiceLowpass = context.createBiquadFilter();
  const noiseGate = context.createGain();
  const inputGain = context.createGain();
  const dryGain = context.createGain();
  const bodyHigh = context.createBiquadFilter();
  const bodyLow = context.createBiquadFilter();
  const bodyPeak = context.createBiquadFilter();
  const pitchShifter = createPitchShifter(context);
  const monsterLow = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const bitcrusher = context.createWaveShaper();
  const glitchGate = context.createGain();
  const warbleDelay = context.createDelay(0.2);
  const echoDelay = context.createDelay(1.0);
  const echoFeedback = context.createGain();
  const wetGain = context.createGain();
  const echoWetGain = context.createGain();
  const outputGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const lfo = context.createOscillator();
  const lfoGain = context.createGain();
  const drone = context.createOscillator();
  const droneFilter = context.createBiquadFilter();
  const droneGain = context.createGain();

  voiceHighpass.type = 'highpass';
  voiceHighpass.frequency.value = 120;
  voiceHighpass.Q.value = 0.7;
  voiceLowpass.type = 'lowpass';
  voiceLowpass.frequency.value = 5500;
  voiceLowpass.Q.value = 0.7;
  noiseGate.gain.value = 1;
  bodyHigh.type = 'highpass';
  bodyLow.type = 'lowpass';
  bodyPeak.type = 'peaking';
  monsterLow.type = 'lowshelf';
  monsterLow.frequency.value = 160;
  monsterLow.gain.value = 0;
  shaper.oversample = '4x';
  shaper.curve = makeDistortionCurve(0);
  bitcrusher.oversample = 'none';
  bitcrusher.curve = makeBitcrusherCurve(16);
  glitchGate.gain.value = 1;
  compressor.threshold.value = -24;
  compressor.knee.value = 20;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  lfo.type = 'sine';
  drone.type = 'sine';
  drone.frequency.value = 52;
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 130;
  droneFilter.Q.value = 0.6;
  droneGain.gain.value = 0;

  inputGain.gain.value = 1;
  dryGain.gain.value = 0.48;
  wetGain.gain.value = 0.52;
  echoWetGain.gain.value = 0.12;
  echoFeedback.gain.value = 0.1;
  outputGain.gain.value = 0;
  bodyHigh.frequency.value = 120;
  bodyLow.frequency.value = 4800;
  bodyPeak.frequency.value = 900;
  bodyPeak.Q.value = 1.2;
  bodyPeak.gain.value = 0;
  warbleDelay.delayTime.value = 0.014;
  echoDelay.delayTime.value = 0.08;
  lfo.frequency.value = 1.4;
  lfoGain.gain.value = 0.002;

  source.connect(analyser);
  source.connect(voiceHighpass);
  voiceHighpass.connect(voiceLowpass);
  voiceLowpass.connect(noiseGate);
  noiseGate.connect(inputGain);
  inputGain.connect(dryGain);
  inputGain.connect(bodyHigh);
  bodyHigh.connect(bodyLow);
  bodyLow.connect(bodyPeak);
  bodyPeak.connect(pitchShifter);
  pitchShifter.connect(monsterLow);
  monsterLow.connect(shaper);
  shaper.connect(bitcrusher);
  bitcrusher.connect(glitchGate);
  glitchGate.connect(warbleDelay);
  warbleDelay.connect(wetGain);
  glitchGate.connect(echoDelay);
  echoDelay.connect(echoWetGain);
  echoDelay.connect(echoFeedback);
  echoFeedback.connect(echoDelay);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);
  echoWetGain.connect(outputGain);
  outputGain.connect(compressor);
  compressor.connect(context.destination);
  lfo.connect(lfoGain);
  lfoGain.connect(warbleDelay.delayTime);
  lfo.start();
  drone.connect(droneFilter);
  droneFilter.connect(droneGain);
  droneGain.connect(context.destination);
  drone.start();

  state.voiceGraph = {
    source,
    analyser,
    voiceHighpass,
    voiceLowpass,
    noiseGate,
    inputGain,
    dryGain,
    bodyHigh,
    bodyLow,
    bodyPeak,
    pitchShifter,
    monsterLow,
    shaper,
    bitcrusher,
    glitchGate,
    warbleDelay,
    echoDelay,
    echoFeedback,
    wetGain,
    echoWetGain,
    outputGain,
    compressor,
    lfo,
    lfoGain,
    drone,
    droneFilter,
    droneGain,
  };

  updateVoiceGraph();
};

const levelLabel = (value) => {
  if (value < 0.08) return 'Silent';
  if (value < 0.26) return 'Whisper';
  if (value < 0.55) return 'Speech';
  return 'Loud';
};

const resizeNoiseCanvas = () => {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  noiseCanvas.width = Math.max(180, Math.floor((width * dpr) / 5));
  noiseCanvas.height = Math.max(100, Math.floor((height * dpr) / 5));
};

const drawNoise = (intensity, peak) => {
  const { width, height } = noiseCanvas;
  if (!width || !height) return;

  noiseCtx.clearRect(0, 0, width, height);

  if (intensity <= 0.01 && peak <= 0.04) return;

  noiseCtx.fillStyle = `rgba(255,255,255,${0.02 + intensity * 0.05})`;
  noiseCtx.fillRect(0, 0, width, height);

  const lineCount = Math.floor(18 + intensity * 60);
  for (let index = 0; index < lineCount; index += 1) {
    const y = Math.floor(Math.random() * height);
    const lineHeight = Math.random() < 0.84 ? 1 : 2;
    const opacity = 0.04 + intensity * 0.14 + Math.random() * 0.12;
    const tone = 190 + Math.floor(Math.random() * 65);
    noiseCtx.fillStyle = `rgba(${tone},${tone},${tone},${opacity})`;
    noiseCtx.fillRect(0, y, width, lineHeight);
  }

  const speckCount = Math.floor(width * height * (0.0012 + intensity * 0.0025));
  for (let index = 0; index < speckCount; index += 1) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const size = Math.random() < 0.7 ? 1 : 2;
    noiseCtx.fillStyle = `rgba(255,255,255,${0.05 + intensity * 0.16 + peak * 0.1})`;
    noiseCtx.fillRect(x, y, size, size);
  }

  if (intensity < 0.18) return;

  const damageCount = Math.floor(6 + intensity * 26 + peak * 16);
  for (let index = 0; index < damageCount; index += 1) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const blockWidth = Math.floor(4 + Math.random() * (18 + intensity * 44));
    const blockHeight = Math.floor(2 + Math.random() * (8 + peak * 18));
    const palette = Math.random();
    if (palette < 0.52) {
      noiseCtx.fillStyle = `rgba(0,0,0,${0.16 + intensity * 0.28})`;
    } else if (palette < 0.8) {
      noiseCtx.fillStyle = `rgba(235,235,225,${0.09 + intensity * 0.22})`;
    } else if (palette < 0.92) {
      noiseCtx.fillStyle = `rgba(0,225,218,${0.12 + intensity * 0.24})`;
    } else {
      noiseCtx.fillStyle = `rgba(255,43,64,${0.1 + peak * 0.24})`;
    }
    noiseCtx.fillRect(x, y, blockWidth, blockHeight);
  }
};

const randomizeArtifacts = (intensity, peak, time) => {
  const activity = clamp(intensity + peak * 0.55, 0, 1);

  tearBands.forEach((band, index) => {
    const active = Math.random() < activity * (index < 10 ? 1 : 0.72);
    const top = Math.random() * 98;
    const height = 2 + Math.random() * (activity * 26 + peak * 18);
    const shift = (Math.random() - 0.5) * (18 + activity * 180);
    const stretch = 0.68 + Math.random() * (0.76 + activity * 1.5);
    const opacity = active ? 0.1 + Math.random() * (0.3 + activity * 0.44) : 0;
    const delay = Math.random() * 120;

    band.style.setProperty('--band-top', `${top.toFixed(2)}%`);
    band.style.setProperty('--band-height', `${height.toFixed(2)}px`);
    band.style.setProperty('--band-shift', `${shift.toFixed(2)}px`);
    band.style.setProperty('--band-y', `${((Math.random() - 0.5) * 12 * activity).toFixed(2)}px`);
    band.style.setProperty('--band-stretch', stretch.toFixed(3));
    band.style.setProperty('--band-opacity', opacity.toFixed(3));
    band.style.setProperty('--band-delay', `${delay.toFixed(0)}ms`);
  });

  dataBlocks.forEach((block, index) => {
    const active = Math.random() < activity * (index < 18 ? 1 : 0.54);
    const width = 8 + Math.random() * (22 + activity * 120);
    const height = 4 + Math.random() * (8 + activity * 42);
    const x = -3 + Math.random() * 106;
    const y = Math.random() * 100;
    const shift = (Math.random() - 0.5) * activity * 96;
    const opacity = active ? 0.12 + Math.random() * (0.28 + activity * 0.34) : 0;
    const colorRoll = Math.random();
    const color =
      colorRoll < 0.42 ? 'rgba(4,5,6,0.86)' :
      colorRoll < 0.68 ? 'rgba(224,226,218,0.58)' :
      colorRoll < 0.86 ? 'rgba(0,232,222,0.38)' :
      'rgba(255,38,58,0.36)';

    block.style.setProperty('--block-x', `${x.toFixed(2)}%`);
    block.style.setProperty('--block-y', `${y.toFixed(2)}%`);
    block.style.setProperty('--block-w', `${width.toFixed(2)}px`);
    block.style.setProperty('--block-h', `${height.toFixed(2)}px`);
    block.style.setProperty('--block-shift', `${shift.toFixed(2)}px`);
    block.style.setProperty('--block-opacity', opacity.toFixed(3));
    block.style.setProperty('--block-fill', color);
    block.style.setProperty('--block-delay', `${(Math.random() * 160).toFixed(0)}ms`);
  });

  const seconds = Math.max(0, Math.floor(time / 1000));
  const minutes = Math.floor(seconds / 60) % 60;
  const displaySeconds = seconds % 60;
  const frames = Math.floor((time / 33.333) % 30);
  frameTime.textContent = `${String(minutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
};

const updateInstability = (intensity, peak, time) => {
  if (intensity > 0.06 && time > state.nextBurstAt) {
    state.burst = clamp(0.18 + intensity * 0.75 + peak * 0.65, 0, 1);
    state.nextBurstAt = time + 120 + Math.random() * (620 - intensity * 420);
    randomizeArtifacts(intensity, peak, time);
  }

  if (time > state.nextJitterAt) {
    const motion = clamp(intensity * 0.85 + peak * 0.5 + state.burst * 0.4, 0, 1);
    state.jitterX = (Math.random() - 0.5) * motion * 34;
    state.jitterY = (Math.random() - 0.5) * motion * 18;
    state.rollY = (Math.random() - 0.5) * motion * 24;
    state.skew = (Math.random() - 0.5) * motion * 4.4;
    state.nextJitterAt = time + 32 + Math.random() * (210 - motion * 150);
  }

  state.jitterX = lerp(state.jitterX, 0, 0.18);
  state.jitterY = lerp(state.jitterY, 0, 0.2);
  state.rollY = lerp(state.rollY, 0, 0.14);
  state.skew = lerp(state.skew, 0, 0.16);
  state.burst = lerp(state.burst, 0, 0.075);
};

const applySlice = (video, top, bottom, offsetX, opacity) => {
  video.style.setProperty('--slice-top', `${top.toFixed(2)}%`);
  video.style.setProperty('--slice-bottom', `${bottom.toFixed(2)}%`);
  video.style.setProperty('--layer-shift', `${offsetX.toFixed(2)}px`);
  video.style.opacity = opacity.toFixed(3);
};

const updateWaveDistortion = (visibleDamage, peak, glitch, time) => {
  if (!waveNoise || !waveMap) return;

  const slowX = 0.0036 + Math.sin(time * 0.00034) * 0.0016;
  const slowY = 0.013 + Math.cos(time * 0.0004) * 0.0075;
  const damagedX = visibleDamage * 0.008 + peak * glitch * 0.003;
  const damagedY = visibleDamage * 0.032 + peak * glitch * 0.016;
  const liquidPulse = Math.sin(time * 0.00052) * 4.5 + Math.cos(time * 0.00021 + 1.7) * 3.5;
  const scale = 21 + visibleDamage * 26 + liquidPulse;

  waveNoise.setAttribute('baseFrequency', `${(slowX + damagedX).toFixed(4)} ${(slowY + damagedY).toFixed(4)}`);
  waveMap.setAttribute('scale', scale.toFixed(2));
};

const applyVideoState = (level, peak, time, soundActivity) => {
  const damage = clamp(level * 0.86 + peak * 0.34 + state.burst * 0.38, 0, 1);
  const glitch = clamp(soundActivity, 0, 1);
  const visibleDamage = damage * glitch;
  const rgbShift = glitch <= 0.01 ? 0 : 2 + visibleDamage * 32 + peak * glitch * 9;
  const blur = 2.05 + (1 - visibleDamage) * 0.54 + peak * glitch * 0.22;
  const grain = glitch * (0.03 + visibleDamage * 0.4 + peak * 0.12);
  const scan = glitch * (0.04 + visibleDamage * 0.44 + peak * 0.16);
  const warp = 0.52 + visibleDamage * 2.25 + peak * glitch * 1.2;
  const flashLevel = state.flash;

  app.style.setProperty('--unstable-x', `${state.jitterX.toFixed(2)}px`);
  app.style.setProperty('--unstable-y', `${state.jitterY.toFixed(2)}px`);
  app.style.setProperty('--roll-y', `${state.rollY.toFixed(2)}px`);
  app.style.setProperty('--unstable-skew', `${state.skew.toFixed(2)}deg`);
  app.style.setProperty('--burst', state.burst.toFixed(3));
  app.style.setProperty('--rgb-shift', `${rgbShift.toFixed(2)}px`);
  app.style.setProperty('--blur-amount', `${blur.toFixed(2)}px`);
  app.style.setProperty('--grain-opacity', grain.toFixed(3));
  app.style.setProperty('--scan-opacity', scan.toFixed(3));
  app.style.setProperty('--warp-strength', warp.toFixed(3));
  app.style.setProperty('--flash-opacity', flashLevel.toFixed(3));
  app.style.setProperty('--vignette-opacity', (0.62 + visibleDamage * 0.28).toFixed(3));
  app.style.setProperty('--base-opacity', '1');
  app.style.setProperty('--level', visibleDamage.toFixed(3));
  updateWaveDistortion(visibleDamage, peak, glitch, time);

  const idleWobbleX = Math.sin(time * 0.00068) * 2.8 + Math.sin(time * 0.00104 + 0.7) * 1.45;
  const idleWobbleY = Math.cos(time * 0.00058 + 0.4) * 1.8 + Math.sin(time * 0.00092 + 2.2) * 0.8;
  const idleSkew = Math.sin(time * 0.00046 + 1.1) * 0.62;
  const wobble = Math.sin(time * 0.0018) * visibleDamage * 0.8;
  const jitter = Math.cos(time * 0.0034 + 0.6) * visibleDamage * 8 + state.jitterX;
  const drift = Math.sin(time * 0.0026 + 1.2) * visibleDamage * 8 + state.rollY;

  videoBase.style.transform = `translate3d(${(idleWobbleX + drift * 0.16 + state.jitterX * 0.18).toFixed(2)}px, ${(idleWobbleY + wobble * 0.1 + state.jitterY * 0.12).toFixed(2)}px, 0) scale(1.055) skewX(${(idleSkew + state.skew * 0.18).toFixed(2)}deg) scaleX(-1)`;
  videoRed.style.transform = `translate3d(${(-rgbShift + jitter).toFixed(2)}px, ${(drift * 0.04 + state.jitterY * 0.28).toFixed(2)}px, 0) scale(1.055) skewX(${state.skew.toFixed(2)}deg) scaleX(-1)`;
  videoCyan.style.transform = `translate3d(${(rgbShift - jitter * 0.6).toFixed(2)}px, ${(-drift * 0.03 - state.jitterY * 0.22).toFixed(2)}px, 0) scale(1.055) skewX(${(-state.skew * 0.8).toFixed(2)}deg) scaleX(-1)`;
  videoAmber.style.transform = `translate3d(${(rgbShift * 0.52 + Math.sin(time * 0.006) * visibleDamage * 13 - state.jitterX * 0.24).toFixed(2)}px, ${(wobble * 0.06).toFixed(2)}px, 0) scale(1.05) scaleX(-1)`;

  const redTop = clamp(4 + Math.sin(time * 0.0025) * 2.6 - visibleDamage * 7 + state.burst * glitch * 12, 0, 88);
  const redBottom = clamp(58 - visibleDamage * 26 + Math.cos(time * 0.0032) * 8, 4, 96);
  const cyanTop = clamp(19 + Math.cos(time * 0.0033) * 6 - visibleDamage * 5, 0, 88);
  const cyanBottom = clamp(36 - visibleDamage * 13 + Math.sin(time * 0.0021) * 7, 4, 96);
  const amberTop = clamp(57 + Math.sin(time * 0.0028) * 6 - visibleDamage * 6, 0, 94);
  const amberBottom = clamp(8 + peak * 10 + Math.cos(time * 0.0041) * 2, 4, 96);

  applySlice(videoRed, redTop, redBottom, -rgbShift * 0.9, glitch * (0.2 + visibleDamage * 0.38));
  applySlice(videoCyan, cyanTop, cyanBottom, rgbShift * 0.74, glitch * (0.18 + visibleDamage * 0.32));
  applySlice(videoAmber, amberTop, amberBottom, rgbShift * 0.48, glitch * (0.1 + visibleDamage * 0.22));

  meterFill.style.width = `${clamp(visibleDamage * 100, 0, 100).toFixed(1)}%`;
  readoutLabel.textContent = levelLabel(visibleDamage);
  readoutLevel.textContent = `${Math.round(visibleDamage * 100)}%`;

  if (state.ready) {
    setStatus(state.cameraOnlyFallback
      ? `Camera connected, microphone disabled · ${levelLabel(visibleDamage)}`
      : `Camera & microphone connected · ${levelLabel(visibleDamage)}`);
  }

  flash.style.opacity = flashLevel.toFixed(3);
};

const updateAudio = () => {
  if (!state.analyser || !state.analyserData) return { level: 0, peak: 0 };

  state.analyser.getByteTimeDomainData(state.analyserData);
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < state.analyserData.length; index += 1) {
    const value = (state.analyserData[index] - 128) / 128;
    const amplitude = Math.abs(value);
    sum += value * value;
    peak = Math.max(peak, amplitude);
  }

  const rms = Math.sqrt(sum / state.analyserData.length);
  const targetLevel = clamp((rms - 0.016) / 0.14, 0, 1);
  const targetPeak = clamp((peak - 0.1) / 0.38, 0, 1);
  state.level = lerp(state.level, targetLevel, 0.12);
  state.peak = lerp(state.peak, targetPeak, 0.16);
  return { level: state.level, peak: state.peak };
};

const unlockAudio = async () => {
  if (!state.audioContext || state.audioContext.state === 'running') return;
  try {
    await state.audioContext.resume();
  } catch {}
};

const bindUnlock = () => {
  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
};

const bindVoiceControls = () => {
  if (!state.voiceControlsBound) {
    const controls = [mixSlider, pitchSlider, toneSlider, echoSlider, driveSlider, glitchSlider, monsterSlider, outputSlider];
    controls.forEach((control) => {
      control?.addEventListener('input', async () => {
        await unlockAudio();
        applyVoiceSettings();
        updateRangeFill(control);
      });
    });

    monitorToggle?.addEventListener('change', async () => {
      await unlockAudio();
      applyVoiceSettings();
    });

    voicePanelToggle?.addEventListener('click', () => {
      setVoicePanelCollapsed(!state.voicePanelCollapsed);
    });

    voicePanelMinimize?.addEventListener('click', () => {
      setVoicePanelCollapsed(true);
    });

    state.voiceControlsBound = true;
  }

  setVoicePanelCollapsed(state.voicePanelCollapsed, { skipSave: true });
  syncVoiceControls();
  setVoicePanelAvailability(state.supportsAudio);
};

const startStream = async () => {
  if (!state.supportsMedia) {
    throw new Error('Camera access is not supported by this browser.');
  }

  clearError();
  setStatus('Requesting camera & microphone');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    state.cameraOnlyFallback = false;
  } catch (error) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      state.cameraOnlyFallback = true;
    } catch (cameraError) {
      throw cameraError;
    }
  }

  videos.forEach((video) => {
    video.srcObject = state.stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
  });

  await Promise.all(videos.map(async (video) => {
    try {
      await video.play();
    } catch {}
  }));

  if (state.supportsAudio && state.stream.getAudioTracks().length > 0) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    buildVoiceGraph();
    setVoicePanelAvailability(true);
    applyVoiceSettings({ skipSave: true });
    await unlockAudio();
  } else {
    state.cameraOnlyFallback = true;
    setVoicePanelAvailability(false);
  }

  state.ready = true;
  setStatus(state.cameraOnlyFallback
    ? 'Camera connected, microphone disabled'
    : 'Camera & microphone connected, voice changer ready');
};

const tick = (time) => {
  const { level, peak } = updateAudio();

  if (state.voiceGraph?.noiseGate) {
    const now = state.audioContext.currentTime;
    const open = level > 0.045;
    state.voiceGraph.noiseGate.gain.setTargetAtTime(open ? 1 : 0, now, open ? 0.03 : 0.12);
  }

  const soundActivity = state.cameraOnlyFallback ? 0 : getSoundActivity(level, peak);
  const intensity = clamp(level * 0.86 + peak * 0.42 + state.burst * 0.18, 0, 1) * soundActivity;

  state.flash = lerp(state.flash, soundActivity > 0.12 && peak > 0.72 ? 1 : 0, 0.14);
  if (soundActivity > 0.12 && peak > 0.78) {
    state.flash = Math.min(1, state.flash + (peak - 0.78) * 1.6);
  }
  state.flash *= 0.9;

  updateInstability(intensity, peak * soundActivity, time);

  if (state.voiceGraph?.glitchGate && time > state.glitchGateAt) {
    const glitch = clamp(state.voice.glitch / 100, 0, 1);
    const audioNow = state.audioContext.currentTime;
    if (glitch > 0.02) {
      const roll = Math.random();
      let target = 1;
      if (roll < 0.16 * glitch) {
        target = 0.04 + Math.random() * 0.22;
      } else if (roll < 0.22 * glitch) {
        target = 1.22 + Math.random() * 0.5;
      }
      state.voiceGraph.glitchGate.gain.cancelScheduledValues(audioNow);
      state.voiceGraph.glitchGate.gain.setValueAtTime(target, audioNow);
      state.voiceGraph.glitchGate.gain.setTargetAtTime(1, audioNow + 0.04, 0.03);
    } else {
      state.voiceGraph.glitchGate.gain.setTargetAtTime(1, audioNow, 0.05);
    }
    state.glitchGateAt = time + 46 + Math.random() * (150 - glitch * 90);
  }

  if (!state.reducedMotion || state.noiseFrame % 3 === 0) {
    drawNoise(intensity, peak * soundActivity);
  }
  state.noiseFrame += 1;

  applyVideoState(intensity, peak, time, soundActivity);
  app.dataset.levelBand =
    soundActivity < 0.04 ? 'silent' :
    intensity < 0.26 ? 'whisper' :
    intensity < 0.55 ? 'speech' : 'loud';

  if (titleBlock) {
    const titleShiftX = state.jitterX * 0.22 + state.rollY * 0.08;
    const titleShiftY = state.jitterY * 0.18 + state.burst * 4.5;
    titleBlock.style.setProperty('--title-shift-x', `${titleShiftX.toFixed(2)}px`);
    titleBlock.style.setProperty('--title-shift-y', `${titleShiftY.toFixed(2)}px`);
  }

  if (!state.ready) {
    meterFill.style.width = `${Math.round(6 + Math.sin(time * 0.002) * 2)}%`;
    readoutLabel.textContent = 'Waiting for permission';
    readoutLevel.textContent = '0%';
    app.dataset.levelBand = 'loading';
    flash.style.opacity = '0';
    state.rafId = window.requestAnimationFrame(tick);
    return;
  }

  state.rafId = window.requestAnimationFrame(tick);
};

const stopStream = () => {
  window.cancelAnimationFrame(state.rafId);
  destroyVoiceGraph();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close().catch?.(() => {});
};

const init = async () => {
  resizeNoiseCanvas();
  bindUnlock();
  bindVoiceControls();
  state.rafId = window.requestAnimationFrame(tick);

  try {
    await startStream();
    clearError();
  } catch (error) {
    const message = error?.name === 'NotAllowedError'
      ? 'Camera or microphone permission denied. Click retry, or make sure the page runs on HTTPS / localhost.'
      : error?.message || 'Unable to start camera.';
    setStatus('Permission denied');
    setError(message);
  }
};

retryButton.addEventListener('click', async () => {
  retryButton.disabled = true;
  try {
    stopStream();
    state.stream = null;
    state.audioContext = null;
    state.analyser = null;
    state.analyserData = null;
    state.level = 0;
    state.peak = 0;
    state.flash = 0;
    state.ready = false;
    await init();
  } finally {
    retryButton.disabled = false;
  }
});

window.addEventListener('resize', resizeNoiseCanvas);
window.addEventListener('beforeunload', stopStream);

init();
