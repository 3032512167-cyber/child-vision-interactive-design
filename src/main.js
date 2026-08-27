import { createIcons, Camera, Mic, MicOff, MousePointer2, Volume2, VolumeX } from 'lucide';
import { GestureController } from './gesture-controller.js';
import { SceneController } from './scene-controller.js';
import { CardController } from './card-controller.js';
import './style.css';

const app = document.querySelector('#app');
const sceneRoot = document.querySelector('#scene-root');
const video = document.querySelector('#camera-feed');
const handOverlay = document.querySelector('#hand-overlay');
const cameraPreview = document.querySelector('#camera-preview');
const previewStatus = document.querySelector('#preview-status');
const previewLight = document.querySelector('#preview-light');
const cameraButton = document.querySelector('#camera-button');
const soundButton = document.querySelector('#sound-toggle');
const micButton = document.querySelector('#mic-toggle');
const dragHint = document.querySelector('#drag-hint');
const statusText = document.querySelector('#status-text');
const statusLight = document.querySelector('#status-light');
const unsupportedMessage = document.querySelector('#unsupported-message');

createIcons({ icons: { Camera, Mic, MicOff, MousePointer2, Volume2, VolumeX }, attrs: { 'stroke-width': 1.8 } });

let scene;
try {
  scene = new SceneController(sceneRoot);
  scene.setReaderMode('hub');
} catch (error) {
  unsupportedMessage.hidden = false;
  unsupportedMessage.textContent = '当前浏览器无法启用 WebGL，请使用最新版 Chrome、Edge 或 Safari。';
  throw error;
}

const cards = new CardController();
const gestures = new GestureController(video, handOverlay);
gestures.connectPointer(scene.renderer.domElement);

const syncSoundButton = (enabled) => {
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.setAttribute('aria-label', enabled ? '关闭视频原声' : '开启视频原声');
  soundButton.setAttribute('title', enabled ? '关闭视频原声' : '开启视频原声');
  soundButton.innerHTML = `<i data-lucide="${enabled ? 'volume-2' : 'volume-x'}" aria-hidden="true"></i>`;
  createIcons({ icons: { Camera, Mic, MicOff, MousePointer2, Volume2, VolumeX }, attrs: { 'stroke-width': 1.8 } });
};

const syncMicButton = (enabled) => {
  micButton.setAttribute('aria-pressed', String(enabled));
  micButton.setAttribute('aria-label', enabled ? '关闭麦克风声音响应' : '开启麦克风声音响应');
  micButton.setAttribute('title', enabled ? '关闭麦克风声音响应' : '开启麦克风声音响应');
  micButton.innerHTML = `<i data-lucide="${enabled ? 'mic' : 'mic-off'}" aria-hidden="true"></i>`;
  createIcons({ icons: { Camera, Mic, MicOff, MousePointer2, Volume2, VolumeX }, attrs: { 'stroke-width': 1.8 } });
};

const setStatus = (text, state = 'ready') => {
  statusText.textContent = text;
  previewStatus.textContent = text;
  statusLight.dataset.state = state;
  previewLight.dataset.state = state;
};

cards.onMessage(({ text, state }) => setStatus(text, state));
cards.onSoundChange((enabled) => syncSoundButton(enabled));
cards.onMicChange((enabled) => syncMicButton(enabled));

cards.onSceneChange(({ index, mode, scene: selectedScene, direction }) => {
  app.dataset.experienceMode = mode;
  scene.setReaderMode(mode);
  scene.selectScene(index % scene.visualThemes.length, direction);
  app.style.setProperty('--scene-accent', selectedScene.accent);
  app.style.setProperty('--scene-warm', selectedScene.warm);
});

setStatus('选择中间四个厌童观察场景', 'ready');
syncSoundButton(cards.soundEnabled);
syncMicButton(cards.micEnabled);

gestures.onInput((input) => {
  scene.applyInput({ ...input, swipe: null });
  cards.handleInput(input);
  const hasGestureAction = Math.abs(input.deltaX) > 0
    || Math.abs(input.deltaY) > 0
    || Math.abs(input.scaleDelta || 0) > 0
    || Boolean(input.swipe)
    || Boolean(input.isPinching)
    || Boolean(input.isFist);
  if (hasGestureAction) dragHint.dataset.hidden = 'true';
});

gestures.onStatus(({ text, state }) => setStatus(text, state));

cameraButton.addEventListener('click', async () => {
  cameraButton.disabled = true;
  cameraButton.querySelector('span').textContent = '正在连接';
  try {
    await gestures.startCamera();
    app.dataset.cameraConnected = 'true';
    dragHint.dataset.hidden = 'true';
    cameraPreview.dataset.active = 'true';
    cameraPreview.setAttribute('aria-hidden', 'false');
  } catch (error) {
    const errorText = error.name === 'NotAllowedError'
      ? '摄像头未授权，已切换至鼠标拖拽。'
      : error.message || '无法启动摄像头，已切换至鼠标拖拽。';
    setStatus(errorText, 'error');
    cameraButton.disabled = false;
    cameraButton.querySelector('span').textContent = '重试摄像头';
  }
});

soundButton.addEventListener('click', () => {
  syncSoundButton(cards.toggleSound());
});

micButton.addEventListener('click', async () => {
  micButton.disabled = true;
  try {
    syncMicButton(await cards.toggleMic());
  } catch (error) {
    setStatus(error.message || '麦克风连接失败', 'error');
  } finally {
    micButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => {
  gestures.stop();
  cards.destroy();
  scene.destroy();
});
