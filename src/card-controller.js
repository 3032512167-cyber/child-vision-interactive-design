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
    this.lensAudioIntensity = 0;
    this.gestureActive = false;
    this.gestureEffectLevel = 0;
    this.lastGestureAt = 0;
    this.gesturePhase = Math.random() * Math.PI * 2;
    this.perceptionFrame = null;
    this.lastPerceptionAt = 0;
    this.lastHandAt = 0;
    this.lastDetailInteractionAt = 0;
    this.detailSwitchArmedUntil = 0;
    this.lastIgnoredDetailSwipeAt = 0;
    this.carouselScrollTimer = 0;
    this.carouselScrollProgrammaticUntil = 0;
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
    this.bindCarouselControls();
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
        if (event.pointerType === 'touch') return;
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
    this.root.dataset.gestureActive = String(this.gestureActive);
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

  bindCarouselControls() {
    this.cardGrid.addEventListener('scroll', () => {
      if (this.mode !== 'hub' || !this.isCompactViewport()) return;
      if (performance.now() < this.carouselScrollProgrammaticUntil) return;

      clearTimeout(this.carouselScrollTimer);
      this.carouselScrollTimer = window.setTimeout(() => {
        this.syncSceneFromCarousel();
      }, 90);
    }, { passive: true });
  }

  isCompactViewport() {
    return window.matchMedia('(max-width: 760px)').matches || window.matchMedia('(pointer: coarse)').matches;
  }

  syncSceneFromCarousel() {
    if (this.mode !== 'hub' || !this.isCompactViewport()) return;

    const gridRect = this.cardGrid.getBoundingClientRect();
    const targetCenter = gridRect.left + gridRect.width / 2;
    let nearestIndex = this.selectedIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;

    [...this.cardGrid.children].forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const distance = Math.abs(cardCenter - targetCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (nearestIndex !== this.selectedIndex) {
      this.selectScene(nearestIndex, nearestIndex > this.selectedIndex ? 1 : -1);
      return;
    }

    this.scrollSelectedCardIntoView('auto');
  }

  scrollSelectedCardIntoView(behavior = 'smooth') {
    if (this.mode !== 'hub' || !this.isCompactViewport()) return;
    const card = this.cardGrid.children[this.selectedIndex];
    if (!card?.scrollIntoView) return;
    this.carouselScrollProgrammaticUntil = performance.now() + (behavior === 'smooth' ? 520 : 80);
    card.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
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
      this.resetGestureState(true);
    }
    this.applyVideoSound(false);
    this.playDetailVideo();
  }

  async prepareSilentAudio() {
    try {
      await this.audioController.prepareSilentAudio();
    } catch (error) {
      this.message(error.message || '无法预热音频。', 'error');
    }
  }

  setSoundEnabled(enabled, shouldRetry = true) {
    this.soundEnabled = Boolean(enabled);
    this.applyVideoSound(shouldRetry);
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
  }

  startPerceptionLoop() {
    const tick = (now) => {
      const t = now / 1000;
      const delta = this.lastPerceptionAt ? (now - this.lastPerceptionAt) / 1000 : 0.016;
      this.lastPerceptionAt = now;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.42);
      const idleFor = this.lastHandAt > 0 ? now - this.lastHandAt : Number.POSITIVE_INFINITY;
      const handFreshness = Number.isFinite(idleFor) ? Math.max(0, 1 - idleFor / 860) : 0;
      const detailIdle = this.lastGestureAt > 0 ? now - this.lastGestureAt : Number.POSITIVE_INFINITY;
      const detailFreshness = this.mode === 'detail' ? Math.max(0, 1 - detailIdle / 920) : 0;
      this.gestureEffectLevel += (detailFreshness - this.gestureEffectLevel) * Math.min(1, 9 * delta);
      this.gestureActive = this.mode === 'detail' && this.gestureEffectLevel > 0.02;
      const driftX = Math.sin(t * 0.19) * 0.42 + Math.sin(t * 0.71 + 0.8) * 0.08;
      const driftY = Math.cos(t * 0.16) * 0.34 + Math.cos(t * 0.58 + 0.4) * 0.06;
      const pulse = 0.45 + 0.55 * Math.sin(t * 0.26 + 0.5);
      const sound = this.soundLevel;
      const handEnergy = Math.max(0.25, this.handGestureEnergy);
      const lensStrength = this.gestureActive
        ? Math.min(1, this.gestureEffectLevel * (0.65 + handEnergy * 0.28) + pulse * 0.04)
        : 0;
      const clarityGlow = 0.28 + pulse * 0.18;

      this.root.style.setProperty('--visual-breath-blur', `${(0.3 + breath * 0.95).toFixed(2)}px`);
      this.root.style.setProperty('--visual-clarity-glow', clarityGlow.toFixed(3));
      this.root.style.setProperty('--video-drift-x', `${(driftX * 0.08).toFixed(2)}px`);
      this.root.style.setProperty('--video-drift-y', `${(driftY * 0.08).toFixed(2)}px`);
      this.root.style.setProperty('--video-clear-drift-x', `${(driftX * 0.04).toFixed(2)}px`);
      this.root.style.setProperty('--video-clear-drift-y', `${(driftY * 0.04).toFixed(2)}px`);
      this.root.style.setProperty('--lens-strength', lensStrength.toFixed(3));
      this.root.style.setProperty('--base-video-opacity', '1');
      this.root.style.setProperty('--clear-layer-opacity', (this.gestureEffectLevel * 0.98).toFixed(3));
      this.root.style.setProperty('--lens-opacity', (this.gestureEffectLevel * 0.84).toFixed(3));
      this.root.style.setProperty('--trace-one-opacity', (this.gestureEffectLevel * (0.18 + sound * 0.08 + clarityGlow * 0.05)).toFixed(3));
      this.root.style.setProperty('--trace-two-opacity', (this.gestureEffectLevel * (0.14 + sound * 0.05)).toFixed(3));
      this.root.style.setProperty('--grain-layer-opacity', (0.14 + sound * 0.08 + this.gestureEffectLevel * 0.18).toFixed(3));
      this.root.style.setProperty('--gesture-effect-level', this.gestureEffectLevel.toFixed(3));
      this.root.style.setProperty('--gesture-effect-opacity', this.gestureEffectLevel.toFixed(3));
      this.root.style.setProperty('--gesture-glitch-opacity', this.gestureEffectLevel.toFixed(3));
      this.root.style.setProperty('--gesture-glitch-jitter-x', `${(Math.sin(t * 16.2 + this.gesturePhase) * this.gestureEffectLevel * 7.5).toFixed(2)}px`);
      this.root.style.setProperty('--gesture-glitch-jitter-y', `${(Math.cos(t * 19.1 + this.gesturePhase * 0.7) * this.gestureEffectLevel * 5.5).toFixed(2)}px`);
      this.root.style.setProperty('--gesture-glitch-blur', `${(this.gestureEffectLevel * 2.4).toFixed(2)}px`);
      this.root.style.setProperty('--gesture-mask-radius', `${(12 + this.gestureEffectLevel * 10).toFixed(2)}%`);
      this.root.style.setProperty('--gesture-skew', `${(-3 * this.gestureEffectLevel).toFixed(2)}deg`);
      this.root.style.setProperty('--gesture-overlay-skew', `${(-4 * this.gestureEffectLevel).toFixed(2)}deg`);
      this.root.style.setProperty('--gesture-rgb-offset-negative', `${(-6 * this.gestureEffectLevel).toFixed(2)}px`);
      this.root.style.setProperty('--gesture-rgb-offset-positive', `${(6 * this.gestureEffectLevel).toFixed(2)}px`);
      this.root.style.setProperty('--gesture-grain-opacity', (0.08 + this.gestureEffectLevel * 0.36).toFixed(3));
      const audioFearIntensity = this.gestureActive
        ? this.lensAudioIntensity
        : 0;
      this.root.style.setProperty('--audio-gesture-intensity', audioFearIntensity.toFixed(3));
      this.root.dataset.gestureActive = String(this.gestureActive);
      this.audioController.setFearIntensity(audioFearIntensity);
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

    const displayHandX = Math.max(-1, Math.min(1, input.handX ?? 0));
    const lensX = 50 + displayHandX * 34;
    const lensY = 50 + Math.max(-1, Math.min(1, input.handY ?? 0)) * 28;
    const openness = Math.max(input.openness ?? 0, input.spread ?? 0);
    const motionEnergy = input.motionEnergy ?? 0;
    const gestureEnergy = Math.max(motionEnergy, openness);
    this.lensAudioIntensity = Math.min(1, Math.max(0, openness));
    this.handGestureEnergy = gestureEnergy;
    const lensSize = 12 + openness * 20;
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
    this.root.style.setProperty('--video-shift-x', `${(displayHandX * 1.6).toFixed(2)}%`);
    this.root.style.setProperty('--video-shift-y', `${((input.handY ?? 0) * 1.2).toFixed(2)}%`);
    this.root.style.setProperty('--base-video-shift-x', `${(displayHandX * 0.38).toFixed(2)}%`);
    this.root.style.setProperty('--base-video-shift-y', `${((input.handY ?? 0) * 0.28).toFixed(2)}%`);
    this.root.style.setProperty('--effect-video-shift-x', `${(displayHandX * 1.45).toFixed(2)}%`);
    this.root.style.setProperty('--effect-video-shift-y', `${((input.handY ?? 0) * 1.05).toFixed(2)}%`);
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
      const now = performance.now();

      if (pinchDown) {
        this.detailSwitchArmedUntil = now + 2200;
        this.triggerDetailGesture(0.3, input);
        this.message('切换模式：2 秒内左右挥动切换场景', 'ready');
        return;
      }

      if (input.swipe) {
        if (now <= this.detailSwitchArmedUntil) {
          const direction = input.swipe === 'left' ? 1 : -1;
          this.detailSwitchArmedUntil = 0;
          this.selectScene(this.selectedIndex + direction, direction);
          return;
        }

        if (now - this.lastIgnoredDetailSwipeAt > 1400) {
          this.lastIgnoredDetailSwipeAt = now;
          this.message('场景内已锁定：先捏合，再左右挥动切换场景', 'ready');
        }
      }

      if (input.handDepth > 0.52 && !this.isContrasting) {
        this.toggleContrast(true);
      } else if (input.handDepth < 0.28 && this.isContrasting) {
        this.toggleContrast(false);
      }

      const interactionStrength = this.getDetailInteractionStrength(input);
      if (interactionStrength > 0.04) {
        this.triggerDetailGesture(interactionStrength, input);
      }
    }
  }

  getIndexFromHand(input) {
    const displayX = Math.max(-1, Math.min(1, input.handX ?? 0));
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
    this.resetGestureState(true);
    this.message(`已选中：${this.selectedScene.title}`, 'ready');
    this.render();
    if (this.mode === 'hub') {
      this.scrollSelectedCardIntoView('smooth');
    }
  }

  enterScene() {
    if (this.mode !== 'hub') return;
    this.mode = 'detail';
    this.clearHoverState();
    this.isContrasting = false;
    this.resetGestureState(true);
    void this.prepareSilentAudio();
    this.message(`进入场景：${this.selectedScene.title}`, 'ready');
    this.render();
  }

  returnToHub() {
    this.detailVideo.pause();
    this.detailClearVideo.pause();
    this.mode = 'hub';
    this.clearHoverState();
    this.isContrasting = false;
    this.resetGestureState(true);
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

  resetGestureState(disableSound = true) {
    this.gestureActive = false;
    this.gestureEffectLevel = 0;
    this.lensAudioIntensity = 0;
    this.lastGestureAt = 0;
    this.lastDetailInteractionAt = 0;
    this.detailSwitchArmedUntil = 0;
    this.lastIgnoredDetailSwipeAt = 0;
    this.root.dataset.gestureActive = 'false';
    this.root.style.setProperty('--gesture-effect-level', '0');
    this.root.style.setProperty('--gesture-effect-opacity', '0');
    this.root.style.setProperty('--audio-gesture-intensity', '0');
    this.root.style.setProperty('--gesture-glitch-opacity', '0');
    this.root.style.setProperty('--gesture-glitch-jitter-x', '0px');
    this.root.style.setProperty('--gesture-glitch-jitter-y', '0px');
    this.root.style.setProperty('--gesture-glitch-blur', '0px');
    this.root.style.setProperty('--gesture-mask-radius', '12%');
    this.root.style.setProperty('--gesture-skew', '0deg');
    this.root.style.setProperty('--gesture-overlay-skew', '0deg');
    this.root.style.setProperty('--gesture-rgb-offset-negative', '0px');
    this.root.style.setProperty('--gesture-rgb-offset-positive', '0px');
    this.root.style.setProperty('--gesture-grain-opacity', '0.08');
    this.root.style.setProperty('--base-video-shift-x', '0%');
    this.root.style.setProperty('--base-video-shift-y', '0%');
    this.root.style.setProperty('--effect-video-shift-x', '0%');
    this.root.style.setProperty('--effect-video-shift-y', '0%');
    this.audioController.setFearIntensity(0);
    if (disableSound && this.soundEnabled) {
      this.setSoundEnabled(false, false);
    }
  }

  getDetailInteractionStrength(input) {
    const motion = Math.max(
      Math.abs(input.deltaX ?? 0) * 16,
      Math.abs(input.deltaY ?? 0) * 16,
      Math.abs(input.scaleDelta ?? 0) * 8,
      input.motionEnergy ?? 0,
    );
    const pose = Math.max(input.openness ?? 0, input.spread ?? 0);
    const extra = (input.isPinching ? 0.22 : 0) + (input.isFist ? 0.18 : 0) + (input.swipe ? 0.28 : 0);
    return Math.min(1, motion + pose * 0.18 + extra);
  }

  triggerDetailGesture(strength, input) {
    this.lastGestureAt = performance.now();
    this.lastDetailInteractionAt = this.lastGestureAt;
    this.gestureEffectLevel = Math.max(this.gestureEffectLevel, Math.min(1, 0.28 + strength * 0.88));
    this.gestureActive = true;
    this.root.dataset.gestureActive = 'true';
    this.root.style.setProperty('--gesture-effect-level', this.gestureEffectLevel.toFixed(3));
    this.root.style.setProperty('--gesture-effect-opacity', this.gestureEffectLevel.toFixed(3));
    this.root.style.setProperty('--gesture-glitch-opacity', this.gestureEffectLevel.toFixed(3));
    this.root.style.setProperty('--gesture-mask-radius', `${(12 + this.gestureEffectLevel * 10).toFixed(2)}%`);
    this.root.style.setProperty('--gesture-skew', `${(-3 * this.gestureEffectLevel).toFixed(2)}deg`);
    this.root.style.setProperty('--gesture-overlay-skew', `${(-4 * this.gestureEffectLevel).toFixed(2)}deg`);
    this.root.style.setProperty('--gesture-rgb-offset-negative', `${(-6 * this.gestureEffectLevel).toFixed(2)}px`);
    this.root.style.setProperty('--gesture-rgb-offset-positive', `${(6 * this.gestureEffectLevel).toFixed(2)}px`);
    this.root.style.setProperty('--gesture-grain-opacity', (0.08 + this.gestureEffectLevel * 0.36).toFixed(3));
    if (!this.soundEnabled) {
      this.setSoundEnabled(true, false);
    }
    this.audioController.setFearIntensity(this.lensAudioIntensity);
    if (input.swipe) {
      this.message(input.swipe === 'left' ? '手势触发：故障层已开启' : '手势触发：故障层已开启', 'ready');
    }
  }
}
