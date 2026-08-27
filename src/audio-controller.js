export class AudioController {
  constructor(videoElement, { onLevel, onMessage } = {}) {
    this.video = videoElement;
    this.onLevel = onLevel;
    this.onMessage = onMessage;
    this.soundEnabled = false;
    this.micEnabled = false;
    this.context = null;
    this.sourceNode = null;
    this.peakingFilter = null;
    this.highShelfFilter = null;
    this.compressor = null;
    this.outputGain = null;
    this.micStream = null;
    this.micSource = null;
    this.micAnalyser = null;
    this.micData = null;
    this.micFrame = null;
    this.level = 0;
  }

  setVideoElement(videoElement) {
    this.video = videoElement;
    this.applyVideoState(false);
  }

  setSoundEnabled(enabled, shouldPlay = true) {
    this.soundEnabled = Boolean(enabled);
    this.applyVideoState(shouldPlay).catch((error) => {
      this.onMessage?.(error.message || '无法开启视频原声。', 'error');
    });
    return this.soundEnabled;
  }

  toggleSound() {
    return this.setSoundEnabled(!this.soundEnabled);
  }

  async setMicEnabled(enabled) {
    if (enabled) {
      await this.startMic();
    } else {
      this.stopMic();
    }
    return this.micEnabled;
  }

  async toggleMic() {
    return this.setMicEnabled(!this.micEnabled);
  }

  async startMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风输入。');
    }

    await this.ensureGraph();
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.micSource = this.context.createMediaStreamSource(this.micStream);
    this.micAnalyser = this.context.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    this.micData = new Uint8Array(this.micAnalyser.frequencyBinCount);
    this.micSource.connect(this.micAnalyser);
    this.micEnabled = true;
    this.onMessage?.('麦克风已连接：声音会放大并变尖锐', 'ready');
    this.tickMic();
  }

  stopMic() {
    cancelAnimationFrame(this.micFrame);
    this.micFrame = null;
    this.micSource?.disconnect();
    this.micAnalyser?.disconnect();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micSource = null;
    this.micAnalyser = null;
    this.micStream = null;
    this.micData = null;
    this.micEnabled = false;
    this.level = 0;
    this.applyDynamicSound(0);
    this.onLevel?.(0);
  }

  async ensureGraph() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('当前浏览器不支持 Web Audio。');
      }

      this.context = new AudioContextClass();
      this.peakingFilter = this.context.createBiquadFilter();
      this.peakingFilter.type = 'peaking';
      this.peakingFilter.frequency.value = 2300;
      this.peakingFilter.Q.value = 1.1;
      this.peakingFilter.gain.value = 0;

      this.highShelfFilter = this.context.createBiquadFilter();
      this.highShelfFilter.type = 'highshelf';
      this.highShelfFilter.frequency.value = 2800;
      this.highShelfFilter.gain.value = 0;

      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;

      this.outputGain = this.context.createGain();
      this.outputGain.gain.value = 0;
    }

    if (!this.sourceNode) {
      this.sourceNode = this.context.createMediaElementSource(this.video);
      this.sourceNode
        .connect(this.peakingFilter)
        .connect(this.highShelfFilter)
        .connect(this.compressor)
        .connect(this.outputGain)
        .connect(this.context.destination);
    }

    await this.context.resume();
  }

  async applyVideoState(shouldPlay = true) {
    if (!this.video) return;

    if (!this.context) {
      this.video.muted = !this.soundEnabled;
      this.video.volume = this.soundEnabled ? 0.86 : 0;
    } else {
      this.video.muted = false;
      this.video.volume = 1;
      this.applyDynamicSound(this.level);
    }

    if (this.soundEnabled) {
      await this.ensureGraph();
      this.applyDynamicSound(this.level);
    }

    if (shouldPlay) {
      this.video.play?.().catch(() => {
        this.video.muted = true;
        this.onMessage?.('浏览器拦截了自动原声，请再点击一次音量图标。', 'paused');
      });
    }
  }

  tickMic = () => {
    if (!this.micEnabled || !this.micAnalyser || !this.micData) return;

    this.micAnalyser.getByteTimeDomainData(this.micData);
    let sum = 0;
    for (const value of this.micData) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / this.micData.length);
    const nextLevel = this.clamp((rms - 0.018) / 0.16, 0, 1);
    this.level += (nextLevel - this.level) * 0.14;
    this.applyDynamicSound(this.level);
    this.onLevel?.(this.level);
    this.micFrame = requestAnimationFrame(this.tickMic);
  };

  applyDynamicSound(level) {
    if (!this.context || !this.outputGain) return;
    const now = this.context.currentTime;
    const volume = this.soundEnabled ? 0.72 + level * 0.72 : 0;
    this.outputGain.gain.setTargetAtTime(volume, now, 0.045);
    this.peakingFilter.gain.setTargetAtTime(level * 11, now, 0.055);
    this.highShelfFilter.gain.setTargetAtTime(level * 14, now, 0.055);
  }

  dispose() {
    this.stopMic();
    this.sourceNode?.disconnect();
    this.context?.close();
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
}
