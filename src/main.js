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
  unsupportedMessage.textContent = 'WebGL is unavailable in this browser. Please use the latest Chrome, Edge, or Safari.';
  throw error;
}

const cards = new CardController();
const gestures = new GestureController(video, handOverlay);
gestures.connectPointer(scene.renderer.domElement);

const syncSoundButton = (enabled) => {
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.setAttribute('aria-label', enabled ? 'Disable original sound' : 'Enable original sound');
  soundButton.setAttribute('title', enabled ? 'Disable original sound' : 'Enable original sound');
  soundButton.innerHTML = `<i data-lucide="${enabled ? 'volume-2' : 'volume-x'}" aria-hidden="true"></i>`;
  createIcons({ icons: { Camera, Mic, MicOff, MousePointer2, Volume2, VolumeX }, attrs: { 'stroke-width': 1.8 } });
};

const syncMicButton = (enabled) => {
  micButton.setAttribute('aria-pressed', String(enabled));
  micButton.setAttribute('aria-label', enabled ? 'Disable microphone sound response' : 'Enable microphone sound response');
  micButton.setAttribute('title', enabled ? 'Disable microphone sound response' : 'Enable microphone sound response');
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

setStatus('Select from the four scenes', 'ready');
const compactLayout = window.matchMedia('(max-width: 760px)').matches || window.matchMedia('(pointer: coarse)').matches;
if (compactLayout) {
  setStatus('Swipe to browse the scenes, tap a card to enter', 'ready');
  dragHint.querySelector('span').textContent = 'Swipe to browse';
}
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
  cameraButton.querySelector('span').textContent = 'Connecting';
  try {
    void cards.prepareSilentAudio();
    await gestures.startCamera();
    app.dataset.cameraConnected = 'true';
    dragHint.dataset.hidden = 'true';
    cameraPreview.dataset.active = 'true';
    cameraPreview.setAttribute('aria-hidden', 'false');
  } catch (error) {
    const errorText = error.name === 'NotAllowedError'
      ? 'Camera permission denied. Switched to mouse dragging.'
      : error.message || 'Unable to start camera. Switched to mouse dragging.';
    setStatus(errorText, 'error');
    cameraButton.disabled = false;
    cameraButton.querySelector('span').textContent = 'Retry camera';
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
    setStatus(error.message || 'Microphone connection failed', 'error');
  } finally {
    micButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => {
  gestures.stop();
  cards.destroy();
  scene.destroy();
});
