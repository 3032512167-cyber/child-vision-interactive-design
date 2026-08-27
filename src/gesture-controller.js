import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const TASKS_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

const PINCH_RATIO = 0.42;
const MOTION_DEAD_ZONE = 0.0007;
const MAX_HAND_DELTA = 0.042;
const OPENNESS_DEAD_ZONE = 0.004;
const MAX_SCALE_DELTA = 0.05;
const HAND_LOST_AFTER_MS = 1400;
const PALM_SMOOTHING = 0.58;
const OPENNESS_SMOOTHING = 0.48;
const POINTER_BLEND = 0.68;
const HAND_DEPTH_SMOOTHING = 0.36;
const FIST_OPENNESS_THRESHOLD = 0.22;
const SWIPE_MIN_DISTANCE = 0.09;
const SWIPE_MIN_SPEED = 0.28;
const SWIPE_MIN_DURATION_MS = 70;
const SWIPE_MAX_DURATION_MS = 680;
const SWIPE_AXIS_BIAS = 1.45;
const SWIPE_COOLDOWN_MS = 650;

/**
 * Normalizes hand, mouse, and touch movements into a single scene input shape.
 */
export class GestureController {
  constructor(videoElement, overlayCanvas) {
    this.video = videoElement;
    this.overlayCanvas = overlayCanvas;
    this.overlayContext = overlayCanvas.getContext('2d');
    this.listener = null;
    this.handLandmarker = null;
    this.stream = null;
    this.animationFrame = null;
    this.previousVideoTime = -1;
    this.anchor = null;
    this.smoothedPalm = null;
    this.smoothedOpenness = null;
    this.smoothedHandDepth = null;
    this.handSizeBaseline = null;
    this.previousOpenness = null;
    this.swipeAnchor = null;
    this.lastSwipeAt = 0;
    this.lastHandSeenAt = 0;
    this.lastMode = 'pointer';
    this.statusListener = null;
    this.lastActionStatusAt = 0;
  }

  onInput(listener) {
    this.listener = listener;
  }

  onStatus(listener) {
    this.statusListener = listener;
  }

  emit(input) {
    this.listener?.(input);
  }

  setStatus(text, state = 'idle') {
    this.statusListener?.({ text, state });
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问，请使用鼠标或触摸拖拽。');
    }

    this.setStatus('正在连接摄像头', 'idle');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
      },
    });
    this.video.srcObject = this.stream;

    await new Promise((resolve) => {
      this.video.onloadedmetadata = () => resolve();
    });

    this.resizeOverlay();

    this.setStatus('正在加载手势识别', 'idle');
    const vision = await FilesetResolver.forVisionTasks(TASKS_WASM_URL);
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        // CPU tracking is slightly less demanding on desktop graphics drivers and remains stable
        // when the WebGL renderer is already consuming the GPU for the 3D scene.
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.42,
      minHandPresenceConfidence: 0.42,
      minTrackingConfidence: 0.4,
    });

    this.lastMode = 'hand';
    this.setStatus('移动手掌带动图形', 'ready');
    this.trackHand();
  }

  trackHand = () => {
    if (!this.handLandmarker || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.animationFrame = requestAnimationFrame(this.trackHand);
      return;
    }

    const now = performance.now();
    if (this.video.currentTime !== this.previousVideoTime) {
      try {
        const result = this.handLandmarker.detectForVideo(this.video, now);
        this.previousVideoTime = this.video.currentTime;
        this.consumeHandResult(result, now);
      } catch (error) {
        this.setStatus('手势识别正在恢复', 'lost');
      }
    }

    if (now - this.lastHandSeenAt > HAND_LOST_AFTER_MS && this.lastMode === 'hand') {
      this.anchor = null;
      this.smoothedPalm = null;
      this.smoothedOpenness = null;
      this.smoothedHandDepth = null;
      this.handSizeBaseline = null;
      this.previousOpenness = null;
      this.swipeAnchor = null;
      this.lastMode = 'idle';
      this.emit(this.createInput({ mode: 'idle' }));
      this.clearOverlay();
      this.setStatus('请将整只手放入预览框', 'lost');
    }

    this.animationFrame = requestAnimationFrame(this.trackHand);
  };

  consumeHandResult(result, timestamp) {
    const landmarks = result.landmarks?.[0];
    if (!landmarks) {
      this.clearOverlay();
      return;
    }

    this.lastHandSeenAt = timestamp;
    const palm = this.smoothPalm(this.getPalmCenter(landmarks));
    const openness = this.smoothOpenness(this.getHandOpenness(landmarks));
    const pointer = this.getGesturePointer(landmarks, palm);
    const spread = this.getPinchSpread(landmarks);
    const handDepth = this.getHandDepth(landmarks);
    const pinched = this.isPinching(landmarks, openness);
    const isFist = this.isFist(openness, spread);
    this.drawHandOverlay(landmarks, Math.max(openness, spread), pinched, pointer);

    if (pinched) {
      const handX = this.toHandAxis(pointer.x);
      this.anchor = null;
      this.smoothedPalm = null;
      this.previousOpenness = null;
      this.swipeAnchor = null;
      this.lastMode = 'paused';
      this.emit(this.createInput({
        mode: 'hand',
        handX,
        handY: this.toHandAxis(pointer.y),
        openness,
        spread,
        handDepth,
        handSide: this.getHandSide(handX),
        isPinching: true,
        isFist: false,
        isPaused: true,
      }));
      this.setStatus('捏合已识别', 'ready');
      return;
    }

    if (!this.anchor || this.lastMode !== 'hand') {
      const handX = this.toHandAxis(pointer.x);
      this.anchor = palm;
      this.previousOpenness = openness;
      this.swipeAnchor = { palm, timestamp };
      this.lastMode = 'hand';
      this.emit(this.createInput({
        mode: 'hand',
        handX,
        handY: this.toHandAxis(pointer.y),
        openness,
        spread,
        handDepth,
        handSide: this.getHandSide(handX),
        isPinching: false,
        isFist,
      }));
      this.setStatus('手势已连接', 'ready');
      return;
    }

    const rawX = palm.x - this.anchor.x;
    const rawY = palm.y - this.anchor.y;
    const deltaX = this.withDeadZone(rawX);
    const deltaY = this.withDeadZone(rawY);
    const opennessDelta = this.withDeadZone(openness - this.previousOpenness, OPENNESS_DEAD_ZONE);
    const scaleDelta = this.clamp(opennessDelta, -MAX_SCALE_DELTA, MAX_SCALE_DELTA);
    const swipe = this.detectSwipe(palm, timestamp);
    this.anchor = palm;
    this.previousOpenness = openness;

    if (swipe) {
      this.setStatus(swipe === 'left' ? '向左滑动：选择下一个场景' : '向右滑动：选择上一个场景', 'ready');
    } else if (Math.abs(scaleDelta) > 0.008 && timestamp - this.lastActionStatusAt > 180) {
      this.lastActionStatusAt = timestamp;
      this.setStatus(scaleDelta > 0 ? '张开放大' : '握紧缩小', 'ready');
    }

    const handX = this.toHandAxis(pointer.x);
    const handY = this.toHandAxis(pointer.y);
    const motionEnergy = this.clamp(Math.hypot(deltaX, deltaY) * 42 + Math.abs(scaleDelta) * 14, 0, 1);
    const handSide = this.getHandSide(handX);

    this.emit(this.createInput({
      mode: 'hand',
      deltaX: -this.clamp(deltaX, -MAX_HAND_DELTA, MAX_HAND_DELTA),
      deltaY: this.clamp(deltaY, -MAX_HAND_DELTA, MAX_HAND_DELTA),
      scaleDelta,
      handX,
      handY,
      openness,
      spread,
      handDepth,
      handSide,
      motionEnergy,
      swipe,
      isPinching: false,
      isFist,
    }));
  }

  connectPointer(target) {
    let activePointerId = null;
    let previous = null;

    target.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      activePointerId = event.pointerId;
      previous = { x: event.clientX, y: event.clientY };
      target.setPointerCapture?.(event.pointerId);
      this.emit(this.createInput({ mode: 'pointer' }));
      if (!this.handLandmarker) this.setStatus('拖拽控制中', 'ready');
    });

    target.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointerId || !previous) return;
      const deltaX = (event.clientX - previous.x) / Math.max(window.innerWidth, 1);
      const deltaY = (event.clientY - previous.y) / Math.max(window.innerHeight, 1);
      previous = { x: event.clientX, y: event.clientY };
      this.emit(this.createInput({ mode: 'pointer', deltaX, deltaY }));
    });

    const releasePointer = (event) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      previous = null;
      if (!this.handLandmarker) this.setStatus('鼠标拖拽可旋转', 'idle');
    };

    target.addEventListener('pointerup', releasePointer);
    target.addEventListener('pointercancel', releasePointer);
  }

  stop() {
    cancelAnimationFrame(this.animationFrame);
    this.handLandmarker?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  getPalmCenter(landmarks) {
    const points = [landmarks[0], landmarks[5], landmarks[9], landmarks[17]];
    return {
      x: 1 - points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  getGesturePointer(landmarks, palm) {
    const indexTip = {
      x: 1 - landmarks[8].x,
      y: landmarks[8].y,
    };
    return {
      x: this.clamp(palm.x * (1 - POINTER_BLEND) + indexTip.x * POINTER_BLEND, 0, 1),
      y: this.clamp(palm.y * (1 - POINTER_BLEND) + indexTip.y * POINTER_BLEND, 0, 1),
    };
  }

  getPinchSpread(landmarks) {
    const thumbToIndex = this.distance2D(landmarks[4], landmarks[8]);
    const palmWidth = Math.max(this.distance2D(landmarks[5], landmarks[17]), 0.0001);
    return this.clamp((thumbToIndex / palmWidth - 0.28) / 1.15, 0, 1);
  }

  createInput({
    mode,
    deltaX = 0,
    deltaY = 0,
    scaleDelta = 0,
    handX = 0,
    handY = 0,
    openness = 0,
    spread = 0,
    handDepth = 0,
    handSide = 'center',
    motionEnergy = 0,
    swipe = null,
    isPinching = false,
    isFist = false,
    isPaused = false,
  }) {
    return {
      mode,
      deltaX,
      deltaY,
      scaleDelta,
      handX,
      handY,
      openness,
      spread,
      handDepth,
      handSide,
      motionEnergy,
      swipe,
      isPinching,
      isFist,
      isPaused,
    };
  }

  toHandAxis(value) {
    return this.clamp((value - 0.5) * 2, -1, 1);
  }

  getHandSide(handX) {
    return handX < -0.14 ? 'left' : handX > 0.14 ? 'right' : 'center';
  }

  getHandDepth(landmarks) {
    const palmWidth = this.distance2D(landmarks[5], landmarks[17]);
    if (!this.handSizeBaseline) {
      this.handSizeBaseline = palmWidth;
    }

    const relativeSize = palmWidth / Math.max(this.handSizeBaseline, 0.0001);
    const rawDepth = this.clamp((relativeSize - 1.02) / 0.42, 0, 1);
    if (this.smoothedHandDepth === null) {
      this.smoothedHandDepth = rawDepth;
      return rawDepth;
    }

    this.smoothedHandDepth += (rawDepth - this.smoothedHandDepth) * HAND_DEPTH_SMOOTHING;
    return this.smoothedHandDepth;
  }

  isFist(openness, spread) {
    return openness < FIST_OPENNESS_THRESHOLD && spread < 0.18;
  }

  getHandOpenness(landmarks) {
    const palmWidth = Math.max(this.distance2D(landmarks[5], landmarks[17]), 0.0001);
    const fingers = [
      [5, 8],
      [9, 12],
      [13, 16],
      [17, 20],
    ];
    const fingertipLift = fingers.reduce((sum, [base, tip]) => {
      return sum + this.distance2D(landmarks[base], landmarks[tip]) / palmWidth;
    }, 0) / fingers.length;
    const wristExtension = fingers.reduce((sum, [base, tip]) => {
      const baseDistance = Math.max(this.distance2D(landmarks[base], landmarks[0]), 0.0001);
      return sum + this.distance2D(landmarks[tip], landmarks[0]) / baseDistance;
    }, 0) / fingers.length;

    const liftScore = this.clamp((fingertipLift - 0.82) / 0.9, 0, 1);
    const wristScore = this.clamp((wristExtension - 1.08) / 0.58, 0, 1);
    return liftScore * 0.68 + wristScore * 0.32;
  }

  smoothOpenness(nextOpenness) {
    if (this.smoothedOpenness === null) {
      this.smoothedOpenness = nextOpenness;
      return nextOpenness;
    }

    this.smoothedOpenness += (nextOpenness - this.smoothedOpenness) * OPENNESS_SMOOTHING;
    return this.smoothedOpenness;
  }

  detectSwipe(palm, timestamp) {
    if (!this.swipeAnchor) {
      this.swipeAnchor = { palm, timestamp };
      return null;
    }

    const duration = timestamp - this.swipeAnchor.timestamp;
    const deltaX = palm.x - this.swipeAnchor.palm.x;
    const deltaY = palm.y - this.swipeAnchor.palm.y;
    const speedX = Math.abs(deltaX) / Math.max(duration / 1000, 0.001);
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_AXIS_BIAS;
    const canSwipe = timestamp - this.lastSwipeAt > SWIPE_COOLDOWN_MS;

    if (
      canSwipe &&
      duration >= SWIPE_MIN_DURATION_MS &&
      duration <= SWIPE_MAX_DURATION_MS &&
      Math.abs(deltaX) >= SWIPE_MIN_DISTANCE &&
      speedX >= SWIPE_MIN_SPEED &&
      isHorizontal
    ) {
      this.lastSwipeAt = timestamp;
      this.swipeAnchor = { palm, timestamp };
      return deltaX > 0 ? 'right' : 'left';
    }

    if (duration > SWIPE_MAX_DURATION_MS || Math.abs(deltaY) > SWIPE_MIN_DISTANCE) {
      this.swipeAnchor = { palm, timestamp };
    }

    return null;
  }

  smoothPalm(nextPalm) {
    if (!this.smoothedPalm) {
      this.smoothedPalm = nextPalm;
      return nextPalm;
    }

    this.smoothedPalm = {
      x: this.smoothedPalm.x + (nextPalm.x - this.smoothedPalm.x) * PALM_SMOOTHING,
      y: this.smoothedPalm.y + (nextPalm.y - this.smoothedPalm.y) * PALM_SMOOTHING,
    };
    return this.smoothedPalm;
  }

  resizeOverlay() {
    this.overlayCanvas.width = this.video.videoWidth || 960;
    this.overlayCanvas.height = this.video.videoHeight || 540;
  }

  clearOverlay() {
    this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  drawHandOverlay(landmarks, openness = 0, pinched = false, pointer = null) {
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;
    this.clearOverlay();
    this.overlayContext.lineWidth = Math.max(2, width * 0.004);
    this.overlayContext.strokeStyle = pinched ? '#ffbd57' : '#70e8ff';
    this.overlayContext.fillStyle = pinched ? '#ffe1ae' : '#f5fcff';
    this.overlayContext.shadowColor = pinched ? '#ffbd57' : '#70e8ff';
    this.overlayContext.shadowBlur = 9;

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
    ];

    this.overlayContext.beginPath();
    connections.forEach(([from, to]) => {
      this.overlayContext.moveTo(landmarks[from].x * width, landmarks[from].y * height);
      this.overlayContext.lineTo(landmarks[to].x * width, landmarks[to].y * height);
    });
    this.overlayContext.stroke();

    landmarks.forEach((point) => {
      this.overlayContext.beginPath();
      this.overlayContext.arc(point.x * width, point.y * height, Math.max(3, width * 0.007), 0, Math.PI * 2);
      this.overlayContext.fill();
    });

    const center = [landmarks[0], landmarks[5], landmarks[9], landmarks[17]].reduce(
      (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
      { x: 0, y: 0 },
    );
    this.overlayContext.beginPath();
    this.overlayContext.lineWidth = Math.max(2, width * 0.005);
    this.overlayContext.arc(center.x * width, center.y * height, width * (0.035 + openness * 0.035), 0, Math.PI * 2);
    this.overlayContext.stroke();
    if (pointer) {
      this.overlayContext.beginPath();
      this.overlayContext.arc(pointer.x * width, pointer.y * height, Math.max(6, width * 0.016), 0, Math.PI * 2);
      this.overlayContext.stroke();
    }
    this.overlayContext.shadowBlur = 0;
  }

  isPinching(landmarks, openness) {
    if (openness < 0.3) return false;
    const thumbToIndex = this.distance2D(landmarks[4], landmarks[8]);
    const palmWidth = this.distance2D(landmarks[5], landmarks[17]);
    return thumbToIndex / Math.max(palmWidth, 0.0001) < PINCH_RATIO;
  }

  distance2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  withDeadZone(value) {
    return Math.abs(value) < MOTION_DEAD_ZONE ? 0 : value;
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
}
