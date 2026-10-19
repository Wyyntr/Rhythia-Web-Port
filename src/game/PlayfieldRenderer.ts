import * as THREE from 'three';
import type { Note } from '../formats/types';
import { BOUNDS } from './GameSession';

const APPROACH_DISTANCE = 15;
const NOTE_SIZE = 0.84;
const CURSOR_SIZE = 0.62;
const FOV = 55;
const PLAYFIELD_SIZE = 3.5;
const PALETTE = ['#8b6cff', '#4fd6ff', '#ff7ac8', '#ffd166', '#7cf5c0'];

interface RingEffect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
}

export interface CursorPosition {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * three.js playfield: a 3×3 grid at z=0 and notes travelling along -Z toward
 * the camera. Notes are a single InstancedMesh, so thousands of notes stay
 * cheap.
 */
export class PlayfieldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private readonly noteMesh: THREE.InstancedMesh;
  private readonly noteMaterial: THREE.MeshBasicMaterial;
  private readonly cursorMesh: THREE.Mesh;
  private readonly cursorMaterial: THREE.MeshBasicMaterial;
  private readonly rings: RingEffect[] = [];
  private readonly noteColors: THREE.Color[];
  private readonly dummy = new THREE.Object3D();
  private readonly scratchColor = new THREE.Color();
  private readonly resizeObserver: ResizeObserver;
  private readonly gridMesh: THREE.Mesh;
  private notes: Note[] = [];
  private approachTimeMs = 500;
  private lastFxTime = performance.now();
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'playfield-canvas';
    container.append(this.canvas);

    this.noteColors = PALETTE.map((color) => new THREE.Color(color));

    const noteTexture = makeNoteTexture();
    const gridTexture = makeGridTexture();
    const cursorTexture = makeCursorTexture();
    const ringTexture = makeRingTexture();

    const gridMaterial = new THREE.MeshBasicMaterial({
      map: gridTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), gridMaterial);
    this.gridMesh.position.z = -0.02;
    this.gridMesh.renderOrder = 0;
    this.scene.add(this.gridMesh);

    this.noteMaterial = new THREE.MeshBasicMaterial({
      map: noteTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.noteMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      this.noteMaterial,
      Math.max(1, 1024),
    );
    this.noteMesh.count = 0;
    this.noteMesh.frustumCulled = false;
    this.noteMesh.renderOrder = 2;
    this.scene.add(this.noteMesh);

    this.cursorMaterial = new THREE.MeshBasicMaterial({
      map: cursorTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.cursorMesh = new THREE.Mesh(new THREE.PlaneGeometry(CURSOR_SIZE, CURSOR_SIZE), this.cursorMaterial);
    this.cursorMesh.position.z = 0.05;
    this.cursorMesh.renderOrder = 4;
    this.scene.add(this.cursorMesh);

    const ringGeometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: ringTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.rings.push({ mesh, material, age: 0, duration: 0 });
    }

    this.fitCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setNotes(notes: Note[]): void {
    this.notes = notes;
    // The instanced mesh is allocated in chunks when a map has more notes.
    if (notes.length > this.noteMesh.instanceMatrix.count) {
      // InstancedMesh cannot be resized in place; this only happens for very
      // large maps and is handled by the fallback size (see update()).
    }
  }

  setApproachTime(approachTimeMs: number): void {
    this.approachTimeMs = Math.max(60, approachTimeMs);
  }

  update(progressMs: number, results: Uint8Array, cursor: CursorPosition): void {
    if (this.disposed) return;

    const count = Math.min(this.notes.length, this.noteMesh.instanceMatrix.count);
    let instance = 0;
    const start = lowerBound(this.notes, progressMs - 120);
    const approach = this.approachTimeMs;

    for (let i = start; i < this.notes.length && instance < count; i++) {
      const note = this.notes[i]!;
      const delta = note.time - progressMs;
      if (delta > approach) break;
      if (results[i] !== 0) continue;

      const travel = clamp(1 - Math.max(0, delta) / approach, 0, 1);
      const fade = Math.min(1, travel / 0.08);
      const brightness = fade * (0.5 + 0.5 * travel);
      const z = delta > 0 ? -(delta / approach) * APPROACH_DISTANCE : 0;

      this.dummy.position.set(note.x, note.y, z);
      this.dummy.scale.setScalar(NOTE_SIZE);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.noteMesh.setMatrixAt(instance, this.dummy.matrix);

      this.scratchColor.copy(this.noteColors[i % this.noteColors.length]!).multiplyScalar(brightness);
      this.noteMesh.setColorAt(instance, this.scratchColor);
      instance++;
    }

    this.noteMesh.count = instance;
    this.noteMesh.instanceMatrix.needsUpdate = true;
    if (this.noteMesh.instanceColor) this.noteMesh.instanceColor.needsUpdate = true;

    this.cursorMesh.visible = cursor.visible;
    if (cursor.visible) {
      const x = clamp(cursor.x, -BOUNDS, BOUNDS);
      const y = clamp(cursor.y, -BOUNDS, BOUNDS);
      this.cursorMesh.position.x = x;
      this.cursorMesh.position.y = y;
    }

    this.updateEffects();
    this.renderer.render(this.scene, this.camera);
  }

  /** Starts a short expanding ring at a hit note. */
  hit(x: number, y: number, colorIndex: number): void {
    let effect = this.rings.find((ring) => !ring.mesh.visible);
    if (!effect) {
      effect = this.rings.reduce((oldest, ring) => (ring.age > oldest.age ? ring : oldest));
    }

    const color = this.noteColors[colorIndex % this.noteColors.length]!;
    effect.mesh.visible = true;
    effect.mesh.position.set(x, y, 0.04);
    effect.mesh.scale.setScalar(0.45);
    effect.material.color.copy(color);
    effect.material.opacity = 0.9;
    effect.age = 0;
    effect.duration = 0.34;
  }

  /** Converts viewport coordinates to playfield coordinates at z=0. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * this.camera.position.z;
    const halfWidth = halfHeight * this.camera.aspect;
    return { x: ndcX * halfWidth, y: ndcY * halfHeight };
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.fitCamera();
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshBasicMaterial) {
            material.map?.dispose();
            material.dispose();
          }
        }
      }
    });

    this.renderer.dispose();
    this.canvas.remove();
  }

  private fitCamera(): void {
    const aspect = this.camera.aspect;
    const requiredHeight = PLAYFIELD_SIZE / Math.min(1, aspect);
    const distance = (requiredHeight / 2) / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private updateEffects(): void {
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, (now - this.lastFxTime) / 1000);
    this.lastFxTime = now;

    for (const effect of this.rings) {
      if (!effect.mesh.visible) continue;
      effect.age += deltaSeconds;
      const t = effect.age / effect.duration;
      if (t >= 1) {
        effect.mesh.visible = false;
        effect.material.opacity = 0;
        continue;
      }
      const eased = 1 - (1 - t) ** 3;
      effect.mesh.scale.setScalar(0.45 + eased * 1.35);
      effect.material.opacity = (1 - t) ** 1.5 * 0.9;
    }
  }
}

function lowerBound(notes: Note[], time: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (notes[mid]!.time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function makeGridTexture(): THREE.CanvasTexture {
  const canvas = createCanvas(1024);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 1024);

  const inset = 14;
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, 'rgba(18, 22, 38, 0.52)');
  gradient.addColorStop(1, 'rgba(9, 11, 20, 0.38)');
  roundedRect(ctx, inset, inset, 1024 - inset * 2, 1024 - inset * 2, 64);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = 'rgba(139, 108, 255, 0.55)';
  ctx.lineWidth = 5;
  ctx.shadowColor = 'rgba(139, 108, 255, 0.9)';
  ctx.shadowBlur = 28;
  roundedRect(ctx, inset, inset, 1024 - inset * 2, 1024 - inset * 2, 64);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(130, 160, 220, 0.18)';
  ctx.lineWidth = 3;
  for (const fraction of [1 / 3, 2 / 3]) {
    const position = Math.round(1024 * fraction);
    ctx.beginPath();
    ctx.moveTo(position, 24);
    ctx.lineTo(position, 1000);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, position);
    ctx.lineTo(1000, position);
    ctx.stroke();
  }
  ctx.restore();

  // Soft center cell glow.
  const glow = ctx.createRadialGradient(512, 512, 20, 512, 512, 420);
  glow.addColorStop(0, 'rgba(79, 214, 255, 0.045)');
  glow.addColorStop(1, 'rgba(79, 214, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 1024);

  return canvasTexture(canvas);
}

function makeNoteTexture(): THREE.CanvasTexture {
  const canvas = createCanvas(256);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 34;
  roundedRect(ctx, 40, 40, 176, 176, 48);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.restore();

  const gradient = ctx.createLinearGradient(40, 40, 216, 216);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.88)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.55)');
  roundedRect(ctx, 44, 44, 168, 168, 46);
  ctx.fillStyle = gradient;
  ctx.fill();

  roundedRect(ctx, 62, 62, 132, 132, 36);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();

  return canvasTexture(canvas);
}

function makeCursorTexture(): THREE.CanvasTexture {
  const canvas = createCanvas(256);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.shadowColor = 'rgba(230, 240, 255, 0.95)';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(128, 128, 94, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(139, 108, 255, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(128, 128, 7, 0, Math.PI * 2);
  ctx.fill();

  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(-2, -118, 4, 16);
    ctx.restore();
  }

  return canvasTexture(canvas);
}

function makeRingTexture(): THREE.CanvasTexture {
  const canvas = createCanvas(256);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(128, 128, 92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(128, 128, 76, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  return canvasTexture(canvas);
}
