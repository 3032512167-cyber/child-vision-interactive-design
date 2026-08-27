import { SCENE_CARDS } from './anti-childism-data.js';
import { AudioController } from './audio-controller.js';

export class CardController {
  constructor() {
    this.root = document.querySelector('#scene-experience');
    this.cardGrid = document.querySelector('#scene-card-grid');
    this.hub = document.querySelector('#scene-hub');
    this.detail = document.querySelector('#scene-detail');
    this.detailBack = document.querySelector('#detail-back');
    this.progress = document.querySelector('#scene-progress');
    this.modeLabel = document.querySelector('#scene-mode-label');
    this.detailKicker = document.querySelector('#detail-kicker');
    this.detailTitle = document.querySelector('#detail-title');
    this.detailSubtitle = document.querySelector('#detail-subtitle');
    this.detailSummary = document.querySelector('#detail-summary');
    this.detailVideo = document.querySelector('#detail-video');
    this.detailClearVideo = document.querySelector('#detail-video-clear');
    this.soundEnabled = false;
    this.micEnabled = false;
    this.soundLevel = 0;
    this.handGestureEnergy = 0;
    this.perceptionFrame = null;
    this.lastHandAt = 0;
    this.soundListener = null;
    this.micListener = null;
    this.audioController = new AudioController(this.detailVideo, {
      onLevel: (level) => this.applySoundLevel(level),
      onMessage: (text, state) => this.message(text, state),
    });
    this.hoverConfirmMs = 5000;
    this.sceneListener = null;
    this.messageListener = null;
    this.mode = 'hub';
    this.selectedIndex = 0;
    this.isContrasting = false;
    this.lastPinch = false;
    this.lastFist = false;
    this.hoverCandidate = null;
    this.hoverStartedAt = 0;
    this.hoverProgress = 0;
    this.hoverAnnouncedSecond = -1;
    this.tracePoints = [
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ];

    this.bindVideoSync();
    this.applyVideoSound(false);
    this.bindFallbackControls();
    this.renderCards();
    this.render();
    this.startPerceptionLoop();
  }

  onSceneChange(listener) {
    this.sceneListener = listener;
    this.emitSceneChange();
  }

  onMessage(listener) {
    this.messageListener = listener;
  }

  onSoundChange(listener) {
    this.soundListener = listener;
    this.soundListener?.(this.soundEnabled);
  }

  onMicChange(listener) {
    this.micListener = listener;
    this.micListener?.(this.micEnabled);
  }

  get selectedScene() {
    return SCENE_CARDS[this.selectedIndex];
  }

  emitSceneChange(direction = 0) {
    this.sceneListener?.({
      index: this.selectedIndex,
      mode: this.mode,
      scene: this.selectedScene,
      direction,
    });
  }

  message(text, state = 'ready') {
    this.messageListener?.({ text, state });
  }

  bindFallbackControls() {
    this.detailBack.addEventListener('click', () => this.returnToHub());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') this.selectScene(this.selectedIndex + 1, 1);
      if (event.key === 'ArrowLeft') this.selectScene(this.selectedIndex - 1, -1);
      if (event.key === 'ArrowDown' && this.mode === 'hub') this.selectScene(this.selectedIndex + 2, 1);
      if (event.key === 'ArrowUp' && this.mode === 'hub') this.selectScene(this.selectedIndex - 2, -1);
      if (event.key === 'Enter' && this.mode === 'hub') this.enterScene();
      if (event.key === 'Escape' && this.mode === 'detail') this.returnToHub();
      if (event.key.toLowerCase() === 'c' && this.mode === 'detail') this.toggleContrast();
    });
  }

  bindVideoSync() {
    if (!this.detailVideo || !this.detailClearVideo) return;
    const sync = () => {
      if (!Number.isFinite(this.detailVideo.currentTime)) return;
      if (Math.abs((this.detailClearVideo.currentTime || 0) - this.detailVideo.currentTime) > 0.08) {
        this.detailClearVideo.currentTime = this.detailVideo.currentTime;
      }
      this.detailClearVideo.playbackRate = this.detailVideo.playbackRate || 1;
    };

    ['play', 'timeupdate', 'seeked', 'ratechange', 'loadedmetadata'].forEach((eventName) => {
      this.detailVideo.addEventListener(eventName, sync);
    });
  }

  renderCards() {
    this.cardGrid.replaceChildren();
    SCENE_CARDS.forEach((scene, index) => {
      const button = document.createElement('button');
      button.className = 'topic-card';
      button.type = 'button';
      button.dataset.index = String(index);
      button.style.setProperty('--scene-accent', scene.accent);
      button.style.setProperty('--scene-warm', scene.warm);
      button.setAttribute('aria-label', `选择场景：${scene.title}`);

      const metrics = scene.metrics.map((item) => `<span>${item}</span>`).join('');
      button.innerHTML = `
        <span class="topic-card__media" aria-hidden="true">
          <img src="${scene.image}" alt="" />
          <span class="topic-card__wash"></span>
        </span>
        <span class="topic-card__topline">
          <span class="topic-card__number">${scene.number}</span>
          <span class="topic-card__kicker">${scene.kicker}</span>
        </span>
        <span class="topic-card__body">
          <span class="topic-card__title">${scene.title}</span>
          <span class="topic-card__subtitle">${scene.subtitle}</span>
          <span class="topic-card__metrics">${metrics}</span>
        </span>
        <span class="topic-card__dwell" aria-hidden="true"><span></span></span>
        <span class="topic-card__enter" aria-hidden="true"><span class="play-mark"></span></span>
      `;

      button.addEventListener('pointermove', (event) => {
        const bounds = button.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        this.setCardTilt(button, x, y);
      });
      button.addEventListener('pointerleave', () => this.setCardTilt(button, 0, 0));

      button.addEventListener('click', () => {
        if (index !== this.selectedIndex) {
          this.selectScene(index, index > this.selectedIndex ? 1 : -1);
        }
        this.enterScene();
      });
      this.cardGrid.append(button);
    });
  }

  render() {
    const scene = this.selectedScene;
    this.root.dataset.mode = this.mode;
    this.root.dataset.contrast = String(this.isContrasting);
    this.root.style.setProperty('--scene-accent', scene.accent);
    this.root.style.setProperty('--scene-warm', scene.warm);
    this.root.style.setProperty('--scene-tone', scene.tone);
    this.hub.hidden = this.mode !== 'hub';
    this.detail.hidden = this.mode !== 'detail';
    this.progress.textContent = `${scene.number} / 04`;
    this.modeLabel.textContent = this.mode === 'hub' ? 'FOUR SCENES' : 'SCENE DETAIL';

    [...this.cardGrid.children].forEach((card, index) => {
      const selected = index === this.selectedIndex;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });

    if (this.mode === 'detail') this.renderDetail();
    this.syncHoverProgress();
    this.emitSceneChange();
  }

  renderDetail() {
    const scene = this.selectedScene;
    this.detailKicker.textContent = `${scene.number} / ${scene.kicker}`;
    this.detailTitle.textContent = scene.title;
    this.detailSubtitle.textContent = scene.subtitle;
    this.detailSummary.textContent = scene.summary;
    if (this.detailVideo.dataset.source !== scene.video) {
      this.detailVideo.dataset.source = scene.video;
      this.detailVideo.poster = scene.image;
      this.detailVideo.src = scene.video;
      this.detailClearVideo.dataset.source = scene.video;
      this.detailClearVideo.poster = scene.image;
      this.detailClearVideo.src = scene.video;
      this.detailVideo.load();
      this.detailClearVideo.load();
    }
    this.applyVideoSound(false);
    this.playDetailVideo();
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    this.applyVideoSound();
    this.soundListener?.(this.soundEnabled);
    return this.soundEnabled;
  }

  toggleSound() {
    return this.setSoundEnabled(!this.soundEnabled);
  }

  applyVideoSound(shouldRetry = true) {
    this.detailClearVideo.muted = true;
    this.audioController.setSoundEnabled(this.soundEnabled, shouldRetry);
    if (shouldRetry && this.mode === 'detail') {
      this.playDetailVideo(false);
    }
  }

  playDetailVideo(allowMutedFallback = true) {
    this.syncClearVideo();
    const clearPlayPromise = this.detailClearVideo.play();
    clearPlayPromise?.catch?.(() => {});

    const playPromise = this.detailVideo.play();
    if (!playPromise?.catch) return;

    playPromise.catch(() => {
      if (!allowMutedFallback || !this.soundEnabled) return;
      this.soundEnabled = false;
      this.audioController.setSoundEnabled(false, false);
      this.soundListener?.(false);
      this.detailVideo.muted = true;
      this.detailVideo.play().catch(() => {});
      this.message('浏览器拦截了自动原声，请点击音量图标开启。', 'paused');
    });
  }

  async setMicEnabled(enabled) {
    this.micEnabled = await this.audioController.setMicEnabled(enabled);
    this.micListener?.(this.micEnabled);
    if (!this.micEnabled) {
      this.message('麦克风声音响应已关闭', 'ready');
    }
    return this.micEnabled;
  }

  async toggleMic() {
    return this.setMicEnabled(!this.micEnabled);
  }

  applySoundLevel(level) {
    this.soundLevel = level;
    this.root.style.setProperty('--sound-intensity', level.toFixed(3));
    this.root.style.setProperty('--audio-base-blur', `${(5.2 + level * 6.8).toFixed(2)}px`);
    this.root.style.setProperty('--audio-clear-blur', '0px');
    this.root.style.setProperty('--audio-jitter', `${(level * 5.5).toFixed(2)}px`);
    this.root.style.setProperty('--audio-grain-opacity', (0.38 + level * 0.24).toFixed(2));
    this.root.style.setProperty('--audio-clarity-pulse', (0.04 + level * 0.08).toFixed(3));
  }

  startPerceptionLoop() {
    const tick = (now) => {
      const t = now / 1000;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.42);
      const idleFor = this.lastHandAt > 0 ? now - this.lastHandAt : Number.POSITIVE_INFINITY;
      const handFreshness = Number.isFinite(idleFor) ? Math.max(0, 1 - idleFor / 860) : 0;
      const driftX = Math.sin(t * 0.19) * 0.42 + Math.sin(t * 0.71 + 0.8) * 0.08;
      const driftY = Math.cos(t * 0.16) * 0.34 + Math.cos(t * 0.58 + 0.4) * 0.06;
      const pulse = 0.45 + 0.55 * Math.sin(t * 0.26 + 0.5);
      const sound = this.soundLevel;
      const handEnergy = Math.max(0.25, this.handGestureEnergy);
      const lensStrength = handFreshness > 0
        ? Math.min(1, handFreshness * (0.42 + handEnergy * 0.54) + pulse * 0.06)
        : 0;
      const clarityGlow = 0.28 + pulse * 0.18;

      this.root.style.setProperty('--visual-breath-blur', `${(0.3 + breath * 0.95).toFixed(2)}px`);
      this.root.style.setProperty('--visual-clarity-glow', clarityGlow.toFixed(3));
      this.root.style.setProperty('--video-drift-x', `${(driftX * (0.25 + handFreshness * 0.75)).toFixed(2)}px`);
      this.root.style.setProperty('--video-drift-y', `${(driftY * (0.25 + handFreshness * 0.75)).toFixed(2)}px`);
      this.root.style.setProperty('--video-clear-drift-x', `${(driftX * (0.12 + handFreshness * 0.38)).toFixed(2)}px`);
      this.root.style.setProperty('--video-clear-drift-y', `${(driftY * (0.12 + handFreshness * 0.38)).toFixed(2)}px`);
      this.root.style.setProperty('--lens-strength', lensStrength.toFixed(3));
      this.root.style.setProperty('--base-video-opacity', (0.9 + sound * 0.06).toFixed(3));
      this.root.style.setProperty('--clear-layer-opacity', Math.min(1, handFreshness * 1.8).toFixed(3));
      this.root.style.setProperty('--lens-opacity', (lensStrength * (0.48 + sound * 0.24)).toFixed(3));
      this.root.style.setProperty('--trace-one-opacity', (lensStrength * (0.12 + sound * 0.14 + clarityGlow * 0.08)).toFixed(3));
      this.root.style.setProperty('--trace-two-opacity', (lensStrength * (0.09 + sound * 0.1)).toFixed(3));
      this.root.style.setProperty('--grain-layer-opacity', (0.38 + sound * 0.24 + clarityGlow * 0.08).toFixed(3));
      this.perceptionFrame = requestAnimationFrame(tick);
    };

    this.perceptionFrame = requestAnimationFrame(tick);
  }

  syncClearVideo() {
    if (!this.detailClearVideo || !this.detailVideo) return;
    const baseTime = this.detailVideo.currentTime || 0;
    if (Number.isFinite(baseTime) && Math.abs((this.detailClearVideo.currentTime || 0) - baseTime) > 0.18) {
      this.detailClearVideo.currentTime = baseTime;
    }
    this.detailClearVideo.playbackRate = this.detailVideo.playbackRate || 1;
  }

  handleInput(input) {
    if (input.mode !== 'hand') return;
    this.lastHandAt = performance.now();

    const displayHandX = -Math.max(-1, Math.min(1, input.handX ?? 0));
    const lensX = 50 + displayHandX * 34;
    const lensY = 50 + Math.max(-1, Math.min(1, input.handY ?? 0)) * 28;
    const openness = Math.max(input.openness ?? 0, input.spread ?? 0);
    const gestureEnergy = Math.max(input.motionEnergy ?? 0, openness);
    this.handGestureEnergy = gestureEnergy;
    const lensSize = 13 + gestureEnergy * 16;
    this.tracePoints[0].x += (lensX - this.tracePoints[0].x) * 0.34;
    this.tracePoints[0].y += (lensY - this.tracePoints[0].y) * 0.34;
    this.tracePoints[1].x += (this.tracePoints[0].x - this.tracePoints[1].x) * 0.22;
    this.tracePoints[1].y += (this.tracePoints[0].y - this.tracePoints[1].y) * 0.22;
    this.root.style.setProperty('--lens-x', `${lensX}%`);
    this.root.style.setProperty('--lens-y', `${lensY}%`);
    this.root.style.setProperty('--lens-radius', `${lensSize}%`);
    this.root.style.setProperty('--lens-inner-radius', `${(lensSize * 0.68).toFixed(2)}%`);
    this.root.style.setProperty('--lens-mid-radius', `${(lensSize * 0.82).toFixed(2)}%`);
    this.root.style.setProperty('--lens-fade-radius', `${(lensSize * 1).toFixed(2)}%`);
    this.root.style.setProperty('--lens-outer-radius', `${(lensSize * 1.18).toFixed(2)}%`);
    this.root.style.setProperty('--lens-diameter', `${(lensSize * 2.36).toFixed(2)}%`);
    this.root.style.setProperty('--trace-x-1', `${this.tracePoints[0].x}%`);
    this.root.style.setProperty('--trace-y-1', `${this.tracePoints[0].y}%`);
    this.root.style.setProperty('--trace-x-2', `${this.tracePoints[1].x}%`);
    this.root.style.setProperty('--trace-y-2', `${this.tracePoints[1].y}%`);
    this.root.style.setProperty('--video-shift-x', `${(displayHandX * -1.6).toFixed(2)}%`);
    this.root.style.setProperty('--video-shift-y', `${((input.handY ?? 0) * -1.2).toFixed(2)}%`);
    this.root.style.setProperty('--lens-strength', (0.55 + gestureEnergy * 0.5).toFixed(3));

    const selectedCard = this.cardGrid.children[this.selectedIndex];
    if (selectedCard && this.mode === 'hub') {
      this.setCardTilt(selectedCard, displayHandX * 0.45, (input.handY ?? 0) * 0.45);
    }

    const pinchDown = Boolean(input.isPinching) && !this.lastPinch;
    const fistDown = Boolean(input.isFist) && !this.lastFist;
    this.lastPinch = Boolean(input.isPinching);
    this.lastFist = Boolean(input.isFist);

    if (fistDown && this.mode === 'detail') {
      this.returnToHub();
      return;
    }

    if (this.mode === 'hub') {
      const pointedIndex = this.getIndexFromHand(input);
      if (pointedIndex !== null) this.updateHoverSelection(pointedIndex);
      else this.clearHoverState();
      if (pinchDown) this.enterScene();
      return;
    }

    if (this.mode === 'detail') {
      if (input.swipe === 'left') this.selectScene(this.selectedIndex + 1, 1);
      if (input.swipe === 'right') this.selectScene(this.selectedIndex - 1, -1);

      if (input.handDepth > 0.52 && !this.isContrasting) {
        this.toggleContrast(true);
      } else if (input.handDepth < 0.28 && this.isContrasting) {
        this.toggleContrast(false);
      }
    }
  }

  getIndexFromHand(input) {
    const displayX = -Math.max(-1, Math.min(1, input.handX ?? 0));
    return Math.min(3, Math.max(0, Math.floor(((displayX + 1) / 2) * 4)));
  }

  updateHoverSelection(index) {
    const now = performance.now();
    if (this.hoverCandidate !== index) {
      this.hoverCandidate = index;
      this.hoverStartedAt = now;
      this.hoverProgress = 0;
      this.hoverAnnouncedSecond = 5;
      this.syncHoverProgress();
      this.message(`停留 5 秒确认：${SCENE_CARDS[index].title}`, 'ready');
      return;
    }

    const elapsed = now - this.hoverStartedAt;
    this.hoverProgress = Math.min(elapsed / this.hoverConfirmMs, 1);
    this.syncHoverProgress();

    const remaining = Math.max(0, Math.ceil((this.hoverConfirmMs - elapsed) / 1000));
    if (remaining !== this.hoverAnnouncedSecond && this.hoverProgress < 1) {
      this.hoverAnnouncedSecond = remaining;
      if (remaining > 0) this.message(`停留 ${remaining} 秒确认场景`, 'ready');
    }

    if (this.hoverProgress >= 1) {
      this.selectScene(index, index > this.selectedIndex ? 1 : -1);
      this.hoverCandidate = index;
      this.hoverStartedAt = 0;
      this.hoverProgress = 1;
      this.hoverAnnouncedSecond = -1;
      this.syncHoverProgress();
      this.enterScene();
    }
  }

  syncHoverProgress() {
    [...this.cardGrid.children].forEach((card, index) => {
      const progress = this.mode === 'hub' && this.hoverCandidate === index
        ? this.hoverProgress
        : 0;
      card.style.setProperty('--hover-progress', progress.toFixed(3));
      card.classList.toggle('is-hovering', progress > 0 && progress < 1);
    });
  }

  clearHoverState() {
    this.hoverCandidate = null;
    this.hoverStartedAt = 0;
    this.hoverProgress = 0;
    this.hoverAnnouncedSecond = -1;
    this.syncHoverProgress();
  }

  setCardTilt(card, x, y) {
    card.style.setProperty('--card-tilt-x', `${(-y * 9).toFixed(2)}deg`);
    card.style.setProperty('--card-tilt-y', `${(x * 11).toFixed(2)}deg`);
  }

  selectScene(index, direction = 0) {
    const nextIndex = (index + SCENE_CARDS.length) % SCENE_CARDS.length;
    if (nextIndex === this.selectedIndex) return;
    this.selectedIndex = nextIndex;
    this.isContrasting = false;
    this.message(`已选中：${this.selectedScene.title}`, 'ready');
    this.render();
  }

  enterScene() {
    if (this.mode !== 'hub') return;
    this.mode = 'detail';
    this.clearHoverState();
    this.isContrasting = false;
    if (!this.soundEnabled) {
      this.setSoundEnabled(true);
    }
    this.message(`进入场景：${this.selectedScene.title}`, 'ready');
    this.render();
  }

  returnToHub() {
    this.detailVideo.pause();
    this.detailClearVideo.pause();
    this.mode = 'hub';
    this.clearHoverState();
    this.isContrasting = false;
    this.message('已返回四个场景卡片', 'ready');
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.perceptionFrame);
    this.audioController.dispose();
  }

  toggleContrast(force = null) {
    if (this.mode !== 'detail') return;
    this.isContrasting = force === null ? !this.isContrasting : force;
    this.message(this.isContrasting ? '正在查看对照视角' : '已回到场景叙事', 'ready');
    this.render();
  }
}
