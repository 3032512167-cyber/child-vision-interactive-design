import * as THREE from 'three';
import fireworksTextureUrl from './assets/generated/fireworks-sprite.png';

const BACKGROUND = 0x05070d;
const CYAN = 0x327f9d;
const MAGENTA = 0xa8677d;
const GOLD = 0xb88a32;

export class SceneController {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.targetRotation = new THREE.Vector2(-0.12, 0.32);
    this.currentRotation = this.targetRotation.clone();
    this.targetOffset = new THREE.Vector2(0, 0);
    this.currentOffset = new THREE.Vector2(0, 0);
    this.targetScale = 1;
    this.currentScale = 1;
    this.targetTwist = 0;
    this.currentTwist = 0;
    this.targetGestureEnergy = 0;
    this.currentGestureEnergy = 0;
    this.selectionPulse = 0;
    this.visualIndex = 0;
    this.readerMode = 'cover';
    this.isPaused = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pointMaterials = [];
    this.geometryMaterials = [];
    this.discMaterials = [];
    this.spriteMaterials = [];
    this.spriteObjects = [];
    this.visualThemes = [
      { name: '长途交通', summary: '密闭空间中的噪声压力和疲惫被放大。', core: 0xff0f68, accent: CYAN, warm: GOLD, shell: 0x5b172c, inner: 0xff8db5 },
      { name: '餐饮场所', summary: '等待、气味和灯光让儿童感官持续过载。', core: 0xff4f93, accent: GOLD, warm: CYAN, shell: 0x64233e, inner: 0xffb3cd },
      { name: '商场空间', summary: '消费动线和强刺激制造冲突。', core: 0xd779ff, accent: CYAN, warm: MAGENTA, shell: 0x462461, inner: 0xdcb3ff },
      { name: '景点场馆', summary: '长队和观看规则让亲子家庭被排斥。', core: GOLD, accent: 0xff0f68, warm: CYAN, shell: 0x5e431b, inner: 0xffd58a },
    ];
    this.sceneListener = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.022);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.1, 15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.container.append(this.renderer.domElement);

    this.world = new THREE.Group();
    this.farField = new THREE.Group();
    this.midField = new THREE.Group();
    this.nearField = new THREE.Group();
    this.core = new THREE.Group();
    this.scene.add(this.world);
    this.world.add(this.farField, this.midField, this.nearField, this.core);

    this.addLights();
    this.createCore();
    this.createParticleFields();
    this.createGeometryFields();
    this.createFireworks();

    window.addEventListener('resize', this.resize);
    this.resize();
    this.render();
  }

  onSceneChange(listener) {
    this.sceneListener = listener;
    this.emitSceneChange();
  }

  emitSceneChange(direction = 0) {
    this.sceneListener?.({
      index: this.visualIndex,
      direction,
      theme: this.getScene(this.visualIndex),
      total: this.visualThemes.length,
    });
  }

  getScene(index = this.visualIndex) {
    const theme = this.visualThemes[THREE.MathUtils.euclideanModulo(index, this.visualThemes.length)];
    return {
      index: THREE.MathUtils.euclideanModulo(index, this.visualThemes.length),
      total: this.visualThemes.length,
      number: String(THREE.MathUtils.euclideanModulo(index, this.visualThemes.length) + 1).padStart(2, '0'),
      ...theme,
    };
  }

  getScenes() {
    return this.visualThemes.map((_, index) => this.getScene(index));
  }

  setReaderMode(mode) {
    this.readerMode = mode;
    const isGallery = mode === 'gallery' || mode === 'compare';
    const background = isGallery ? 0x060912 : BACKGROUND;
    this.scene.background.set(background);
    this.scene.fog.color.set(background);
    this.renderer.setClearColor(background, 1);
  }

  applyInput({
    mode,
    deltaX,
    deltaY,
    scaleDelta = 0,
    handX = 0,
    handY = 0,
    openness = 0,
    spread = 0,
    motionEnergy = 0,
    swipe = null,
    isPaused,
  }) {
    this.isPaused = isPaused;
    if (mode === 'idle') {
      this.targetOffset.set(0, 0);
      this.targetTwist = 0;
      this.targetGestureEnergy = 0;
      return;
    }

    if (isPaused) {
      this.targetGestureEnergy = 0;
      return;
    }

    if (mode === 'hand') {
      const gripOpen = Math.max(openness, spread);
      const edgeEnergy = Math.min(Math.hypot(handX, handY) * 0.34, 0.5);
      this.targetRotation.y = handX * 3.25 + deltaX * 13.5;
      this.targetRotation.x = THREE.MathUtils.clamp(-handY * 2.05 + deltaY * 10.5, -1.42, 1.42);
      this.targetOffset.set(handX * 2.35, -handY * 1.42);
      this.targetTwist = THREE.MathUtils.clamp(-handX * 0.76 - deltaX * 5.2, -0.86, 0.86);
      this.targetScale = THREE.MathUtils.clamp(0.58 + gripOpen * 1.36 + motionEnergy * 0.18, 0.58, 2.08);
      this.targetGestureEnergy = Math.max(motionEnergy, Math.abs(scaleDelta) * 15, edgeEnergy);
      this.applyResponsiveColors(handX, handY, gripOpen, this.targetGestureEnergy);

      if (swipe) {
        this.switchVisual(swipe);
      }
      return;
    }

    const sensitivity = mode === 'hand' ? 5.6 : 4.2;
    this.targetRotation.y += deltaX * sensitivity;
    this.targetRotation.x = THREE.MathUtils.clamp(
      this.targetRotation.x + deltaY * sensitivity,
      -0.92,
      0.92,
    );

    if (swipe) {
      this.switchVisual(swipe);
    }
  }

  switchVisual(direction) {
    const sign = direction === 'left' ? -1 : 1;
    const nextIndex = (
      this.visualIndex +
      (direction === 'left' ? 1 : -1) +
      this.visualThemes.length
    ) % this.visualThemes.length;
    this.selectScene(nextIndex, sign);
  }

  selectScene(index, direction = 0) {
    const nextIndex = THREE.MathUtils.euclideanModulo(index, this.visualThemes.length);
    const sign = direction || (nextIndex > this.visualIndex ? -1 : 1);
    this.visualIndex = nextIndex;
    this.selectionPulse = 1;
    this.targetRotation.y += sign * 0.95;
    this.targetTwist += sign * 0.42;
    this.targetOffset.x += sign * 1.1;
    this.targetGestureEnergy = 1;
    this.applyVisualTheme();
    this.emitSceneChange(sign);
  }

  applyVisualTheme() {
    const theme = this.visualThemes[this.visualIndex];
    this.tintSceneColors({
      core: new THREE.Color(theme.core),
      accent: new THREE.Color(theme.accent),
      warm: new THREE.Color(theme.warm),
      shell: new THREE.Color(theme.shell),
      inner: new THREE.Color(theme.inner),
    }, 1);
  }

  applyResponsiveColors(handX, handY, openness, energy) {
    const baseHue = THREE.MathUtils.euclideanModulo(
      0.52 + handX * 0.14 - handY * 0.08 + openness * 0.2 + this.visualIndex * 0.2,
      1,
    );
    const core = new THREE.Color().setHSL(baseHue, 0.42, 0.44 + energy * 0.04);
    const accent = new THREE.Color().setHSL(THREE.MathUtils.euclideanModulo(baseHue + 0.28, 1), 0.38, 0.48);
    const warm = new THREE.Color().setHSL(THREE.MathUtils.euclideanModulo(baseHue + 0.1, 1), 0.4, 0.5);
    const shell = core.clone().lerp(new THREE.Color(0xffffff), 0.78);
    const inner = core.clone().multiplyScalar(0.82);

    this.tintSceneColors({ core, accent, warm, shell, inner }, 0.56 + energy * 0.34);
  }

  tintSceneColors(colors, amount) {
    const { outer, inner, orbitOne, orbitTwo, orbitThree } = this.core.userData;
    if (!outer) return;

    outer.material.color.lerp(colors.shell, amount);
    outer.material.emissive.lerp(colors.core, amount);
    outer.material.emissiveIntensity = 0.3 + this.currentGestureEnergy * 0.42 + this.selectionPulse * 0.18;
    inner.material.color.lerp(colors.inner, amount);
    orbitOne.material.color.lerp(colors.core, amount);
    orbitTwo.material.color.lerp(colors.accent, amount);
    orbitThree.material.color.lerp(colors.warm, amount);
    if (this.gestureLights) {
      this.gestureLights.cyanLight.color.lerp(colors.core, amount);
      this.gestureLights.magentaLight.color.lerp(colors.accent, amount);
      this.gestureLights.goldLight.color.lerp(colors.warm, amount);
    }

    this.pointMaterials.forEach((material, index) => {
      const palette = [colors.core, colors.accent, colors.warm];
      material.color.lerp(palette[index % palette.length], amount * 0.7);
      material.opacity = 0.28 + this.currentGestureEnergy * 0.16;
    });
    this.geometryMaterials.forEach((material, index) => {
      const palette = [colors.core, colors.accent, colors.warm];
      material.color.lerp(palette[(index + 1) % palette.length], amount);
      material.opacity = 0.3 + this.currentGestureEnergy * 0.12;
    });
    this.discMaterials.forEach((material, index) => {
      material.color.lerp(index % 2 === 0 ? colors.accent : colors.warm, amount);
      material.opacity = 0.06 + this.currentGestureEnergy * 0.06;
    });
    this.spriteMaterials.forEach((material, index) => {
      const palette = [colors.core, colors.accent, colors.warm];
      material.color.lerp(palette[index % palette.length], amount);
      material.opacity = 0.12 + this.currentGestureEnergy * 0.08;
    });
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const cyanLight = new THREE.PointLight(CYAN, 5, 18, 2);
    cyanLight.position.set(-3, 1, 4);
    const magentaLight = new THREE.PointLight(MAGENTA, 4, 16, 2);
    magentaLight.position.set(4, -3, 3);
    const goldLight = new THREE.PointLight(GOLD, 3, 12, 2);
    goldLight.position.set(0, 4, -2);
    this.scene.add(cyanLight, magentaLight, goldLight);
    this.gestureLights = { cyanLight, magentaLight, goldLight };
  }

  createCore() {
    const outerMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x20415a,
      emissive: 0x126a88,
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.35,
      transmission: 0.7,
      transparent: true,
      opacity: 0.28,
      thickness: 1.2,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 64, 64),
      outerMaterial,
    );

    const inner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7, 3),
      new THREE.MeshBasicMaterial({ color: 0x335366, transparent: true, opacity: 0.48 }),
    );

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
    });
    const orbitOne = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.018, 8, 120), haloMaterial);
    const orbitTwo = new THREE.Mesh(
      new THREE.TorusGeometry(2.55, 0.012, 8, 120),
      new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending }),
    );
    const orbitThree = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.022, 8, 120),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending }),
    );
    orbitOne.rotation.set(0.7, 0.2, 0.36);
    orbitTwo.rotation.set(-0.45, 0.8, 1.2);
    orbitThree.rotation.set(1.2, -0.35, 0.4);

    const coreParticles = this.createPoints(480, 1.2, [CYAN, MAGENTA, GOLD], 0.032);
    this.core.add(outer, inner, orbitOne, orbitTwo, orbitThree, coreParticles);
    this.core.userData = { outer, inner, orbitOne, orbitTwo, orbitThree, coreParticles };
  }

  createParticleFields() {
    this.farField.add(this.createPoints(900, 17, [0x9fb9c6, 0xb9a7b0, 0xc8b479], 0.018));
    this.midField.add(this.createPoints(620, 11, [CYAN, MAGENTA, GOLD], 0.043));
    this.nearField.add(this.createPoints(260, 7.4, [CYAN, MAGENTA, GOLD], 0.065));
  }

  createPoints(count, radius, palette, size) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let index = 0; index < count; index += 1) {
      const distance = radius * (0.22 + Math.pow(Math.random(), 0.58) * 0.78);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const offset = index * 3;
      positions[offset] = distance * Math.sin(phi) * Math.cos(theta);
      positions[offset + 1] = distance * Math.cos(phi);
      positions[offset + 2] = distance * Math.sin(phi) * Math.sin(theta);
      color.setHex(palette[index % palette.length]);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    material.userData.baseSize = size;
    this.pointMaterials.push(material);
    return new THREE.Points(geometry, material);
  }

  createGeometryFields() {
    const definitions = [
      { position: [-5.2, 3.2, -3.8], scale: 0.95, color: CYAN, geometry: new THREE.IcosahedronGeometry(1, 1) },
      { position: [4.6, 2.6, -2.6], scale: 1.15, color: MAGENTA, geometry: new THREE.OctahedronGeometry(1, 1) },
      { position: [-5.8, -2.7, 0.5], scale: 0.72, color: GOLD, geometry: new THREE.TetrahedronGeometry(1, 0) },
      { position: [5.6, -3.4, -1.7], scale: 0.88, color: CYAN, geometry: new THREE.DodecahedronGeometry(1, 0) },
      { position: [0.8, 5.5, -5], scale: 0.65, color: GOLD, geometry: new THREE.IcosahedronGeometry(1, 0) },
    ];

    definitions.forEach((item, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: item.color,
        wireframe: true,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(item.geometry, material);
      this.geometryMaterials.push(material);
      mesh.position.set(...item.position);
      mesh.scale.setScalar(item.scale);
      mesh.rotation.set(index * 0.6, index * 0.85, index * 0.32);
      mesh.userData.spin = 0.12 + index * 0.025;
      this.midField.add(mesh);
    });

    const discMaterial = new THREE.MeshBasicMaterial({
      color: MAGENTA,
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    [-1, 1].forEach((direction) => {
      const material = discMaterial.clone();
      const disc = new THREE.Mesh(new THREE.RingGeometry(0.8, 2.7, 80), material);
      disc.position.set(direction * 3.6, direction * -2, direction * -3.7);
      disc.rotation.set(0.7 * direction, 0.3, 0.4);
      this.discMaterials.push(material);
      this.farField.add(disc);
    });
  }

  createFireworks() {
    new THREE.ImageLoader().load(fireworksTextureUrl, (image) => {
      const texture = this.createMaskedTexture(image);
      this.addFireworkSprites(texture);
    });
  }

  createMaskedTexture(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const brightness = Math.max(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      // The generated sprite has an opaque black backing. Convert it to soft alpha once.
      pixels.data[index + 3] = brightness < 18 ? 0 : Math.min(255, (brightness - 18) * 1.5);
    }
    context.putImageData(pixels, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  addFireworkSprites(texture) {
    const specs = [
      { position: [-4.7, -1.1, -4.8], scale: 3.4, color: CYAN },
      { position: [4.6, 1.8, -5.6], scale: 4.0, color: MAGENTA },
      { position: [1.7, -4.6, -4.1], scale: 2.9, color: GOLD },
      { position: [-2.8, 4.8, -6.8], scale: 3.2, color: 0x9b7cff },
    ];

    specs.forEach((spec, index) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: spec.color,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(...spec.position);
      sprite.scale.setScalar(spec.scale);
      sprite.userData.baseScale = spec.scale;
      sprite.material.rotation = index * 0.64;
      this.spriteMaterials.push(material);
      this.spriteObjects.push(sprite);
      this.farField.add(sprite);
    });
    this.applyVisualTheme();
  }

  resize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  render = () => {
    const elapsed = this.clock.getElapsedTime();
    const deltaTime = this.clock.getDelta();
    const damping = 1 - Math.exp(-7.5 * deltaTime);
    const gestureDamping = 1 - Math.exp(-9.5 * deltaTime);
    this.currentRotation.lerp(this.targetRotation, damping);
    this.currentOffset.lerp(this.targetOffset, gestureDamping);
    this.currentScale += (this.targetScale - this.currentScale) * damping;
    this.currentTwist += (this.targetTwist - this.currentTwist) * gestureDamping;
    this.currentGestureEnergy += (this.targetGestureEnergy - this.currentGestureEnergy) * gestureDamping;
    this.targetGestureEnergy *= Math.exp(-2.8 * deltaTime);

    const wobbleX = Math.sin(elapsed * 12.4) * this.currentGestureEnergy * 0.055;
    const wobbleY = Math.cos(elapsed * 10.8) * this.currentGestureEnergy * 0.065;
    const wobbleZ = Math.sin(elapsed * 9.2) * this.currentGestureEnergy * 0.075;
    const isGalleryMode = this.readerMode === 'gallery' || this.readerMode === 'compare';
    const presentationScale = isGalleryMode ? 0.74 : 1;
    const presentationY = isGalleryMode ? -0.12 : 0;
    this.world.position.set(this.currentOffset.x, this.currentOffset.y, 0);
    this.world.position.y += presentationY;
    this.world.rotation.x = this.currentRotation.x + wobbleX;
    this.world.rotation.y = this.currentRotation.y + wobbleY;
    this.world.rotation.z = this.currentTwist + wobbleZ + this.selectionPulse * 0.08;
    this.world.scale.setScalar(this.currentScale * presentationScale * (1 + this.currentGestureEnergy * 0.035));
    this.farField.position.set(-this.currentOffset.x * 0.18, -this.currentOffset.y * 0.12, -this.currentGestureEnergy * 0.45);
    this.midField.position.set(this.currentOffset.x * 0.12, this.currentOffset.y * 0.1, this.currentGestureEnergy * 0.14);
    this.nearField.position.set(this.currentOffset.x * 0.48, this.currentOffset.y * 0.36, this.currentGestureEnergy * 0.34);
    this.core.position.set(this.currentOffset.x * 0.2, this.currentOffset.y * 0.16, this.currentGestureEnergy * 0.28);
    this.core.scale.setScalar(1 + this.selectionPulse * 0.08 + this.currentGestureEnergy * 0.06);
    this.selectionPulse = Math.max(0, this.selectionPulse - deltaTime * 2.7);
    this.pointMaterials.forEach((material, index) => {
      material.size = material.userData.baseSize * (1 + this.currentGestureEnergy * (2.1 + index * 0.45));
    });
    this.spriteObjects.forEach((sprite, index) => {
      const pulse = 1 + this.currentGestureEnergy * 0.32 + this.selectionPulse * 0.14;
      sprite.scale.setScalar(sprite.userData.baseScale * pulse);
      sprite.material.rotation += deltaTime * (0.12 + index * 0.04 + this.currentGestureEnergy * 0.35);
    });
    if (this.gestureLights) {
      this.gestureLights.cyanLight.intensity = 5 + this.currentGestureEnergy * 5;
      this.gestureLights.magentaLight.intensity = 4 + this.currentGestureEnergy * 4;
      this.gestureLights.goldLight.intensity = 3 + this.currentGestureEnergy * 3;
    }

    if (!this.reducedMotion && !this.isPaused) {
      this.farField.rotation.y = elapsed * 0.035 - this.currentRotation.y * 0.14;
      this.farField.rotation.x = Math.sin(elapsed * 0.09) * 0.08 - this.currentRotation.x * 0.09;
      this.midField.rotation.y = elapsed * 0.08 + this.currentRotation.y * 0.18;
      this.midField.rotation.x = Math.sin(elapsed * 0.16) * 0.05 + this.currentRotation.x * 0.13;
      this.nearField.rotation.y = elapsed * -0.13 + this.currentRotation.y * 0.29;
      this.nearField.rotation.x = this.currentRotation.x * 0.21;
      this.core.rotation.y = elapsed * 0.14;
      this.core.rotation.x = Math.sin(elapsed * 0.3) * 0.11;
      this.core.userData.inner.rotation.y = elapsed * 0.86;
      this.core.userData.orbitOne.rotation.z = elapsed * 0.54;
      this.core.userData.orbitTwo.rotation.x = elapsed * -0.38;
      this.core.userData.orbitThree.rotation.y = elapsed * 0.5;
      this.midField.children.forEach((child) => {
        if (child.userData.spin) child.rotation.y += child.userData.spin * 0.01;
      });
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  };

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
