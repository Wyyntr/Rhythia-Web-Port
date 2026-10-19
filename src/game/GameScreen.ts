import './game.css';
import type { MapData } from '../formats/types';
import { approachTimeMs, normalizeSettings, type Settings } from '../settings';
import { AudioEngine } from '../audio/AudioEngine';
import { GameSession } from './GameSession';
import { PlayfieldRenderer } from './PlayfieldRenderer';

export interface AttemptResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  hits: number;
  misses: number;
  failed: boolean;
  finished: boolean;
  speed: number;
}

export interface GameScreenOptions {
  map: MapData;
  settings: Settings;
  onResult: (result: AttemptResult) => void;
  onSettingsChange: (settings: Settings) => void;
  onExit: () => void;
}

const LEAD_IN_MIN_MS = 2400;

export class GameScreen {
  private readonly root: HTMLDivElement;
  private readonly host: HTMLDivElement;
  private readonly audio: AudioEngine;
  private settings: Settings;
  private renderer: PlayfieldRenderer | null = null;
  private session: GameSession | null = null;
  private raf = 0;
  private paused = false;
  private ended = false;
  private started = false;
  private destroyed = false;
  private starting = false;
  private cursorVisible = false;
  private pendingCursor: { x: number; y: number } | null = null;
  private pausedProgress = 0;
  private leadInMs = LEAD_IN_MIN_MS;
  private countdownToken = 0;
  private noticeTimer = 0;
  private missTimer = 0;
  private displayLengthMs = 0;
  private lastHud = {
    score: -1,
    accuracy: -1,
    combo: -1,
    multiplier: -1,
    health: -1,
    progress: -1,
    time: '',
    countdown: '',
    countdownVisible: false,
  };

  // DOM references.
  private readonly scoreEl: HTMLElement;
  private readonly accuracyEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly multiplierEl: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly timeCurrent: HTMLElement;
  private readonly timeTotal: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly missFlash: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly loadingText: HTMLElement;
  private readonly loadingActions: HTMLElement;
  private readonly pauseModal: HTMLElement;
  private readonly resultsModal: HTMLElement;
  private readonly speedInput: HTMLInputElement;
  private readonly arInput: HTMLInputElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly offsetInput: HTMLInputElement;
  private readonly touchOffsetInput: HTMLInputElement;
  private readonly touchOffsetXInput: HTMLInputElement;
  private readonly hitSoundsInput: HTMLInputElement;

  constructor(private readonly options: GameScreenOptions) {
    this.settings = { ...options.settings };
    this.audio = new AudioEngine({
      volume: this.settings.volume,
      offsetMs: this.settings.offsetMs,
      hitSounds: this.settings.hitSounds,
    });

    this.root = document.createElement('div');
    this.root.className = 'game-root';
    this.root.innerHTML = `
      <div class="game-viewport">
        <div class="playfield-host"></div>
        <div class="game-hud">
          <div class="hud-top">
            <div class="hud-stat">
              <span class="hud-label">Score</span>
              <span class="hud-score">0</span>
              <span class="hud-accuracy">100.00%</span>
            </div>
            <div class="hud-center">
              <div class="hud-title"></div>
              <div class="hud-combo">
                <span class="combo-value">0</span>
                <span class="combo-mult">x1</span>
              </div>
            </div>
            <button class="pause-button" type="button" aria-label="Pause">❚❚</button>
          </div>
          <div class="hud-bottom">
            <div class="health-track"><div class="health-fill"></div></div>
            <div class="progress-row">
              <span class="time-current">0:00</span>
              <div class="progress-track"><div class="progress-fill"></div></div>
              <span class="time-total">0:00</span>
            </div>
          </div>
        </div>
        <div class="countdown" aria-hidden="true"></div>
        <div class="miss-flash" aria-hidden="true"></div>
        <div class="game-notice" role="status"></div>
      </div>

      <div class="loading-layer">
        <div class="loading-card">
          <div class="spinner"></div>
          <p class="loading-text">Loading map…</p>
          <div class="loading-actions hidden">
            <button type="button" class="button ghost loading-back">Back</button>
            <button type="button" class="button primary loading-retry">Retry</button>
          </div>
        </div>
      </div>

      <div class="game-modal pause-modal hidden">
        <div class="modal-card">
          <p class="modal-eyebrow">Paused</p>
          <h2>Take a breath.</h2>
          <div class="pause-settings">
            <label class="setting-row">
              <span>Scroll speed <output class="speed-output"></output></span>
              <input class="setting-speed" type="range" min="0.5" max="3" step="0.05" />
            </label>
            <label class="setting-row">
              <span>Approach rate <output class="ar-output"></output></span>
              <input class="setting-ar" type="range" min="5" max="100" step="1" />
            </label>
            <label class="setting-row">
              <span>Volume <output class="volume-output"></output></span>
              <input class="setting-volume" type="range" min="0" max="100" step="1" />
            </label>
            <label class="setting-row">
              <span>Note offset <output class="offset-output"></output></span>
              <input class="setting-offset" type="range" min="-300" max="300" step="5" />
            </label>
            <label class="setting-row">
              <span>Touch offset X <output class="touch-x-output"></output></span>
              <input class="setting-touch-x" type="range" min="-80" max="80" step="4" />
            </label>
            <label class="setting-row">
              <span>Touch offset Y <output class="touch-output"></output></span>
              <input class="setting-touch" type="range" min="0" max="160" step="4" />
            </label>
            <label class="setting-check">
              <input class="setting-hitsounds" type="checkbox" />
              <span>Hit sounds</span>
            </label>
          </div>
          <p class="modal-hint">Speed and approach-rate changes apply on retry.</p>
          <div class="modal-actions">
            <button type="button" class="button primary pause-resume">Resume</button>
            <button type="button" class="button ghost pause-restart">Restart</button>
            <button type="button" class="button danger pause-quit">Quit</button>
          </div>
        </div>
      </div>

      <div class="game-modal results-modal hidden">
        <div class="modal-card results-card">
          <p class="modal-eyebrow result-status">Cleared</p>
          <div class="result-grade">S</div>
          <p class="result-title"></p>
          <div class="result-score">0</div>
          <div class="result-grid">
            <div><span>Accuracy</span><strong class="result-accuracy">0%</strong></div>
            <div><span>Max combo</span><strong class="result-combo">0</strong></div>
            <div><span>Hits</span><strong class="result-hits">0</strong></div>
            <div><span>Misses</span><strong class="result-misses">0</strong></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="button primary result-retry">Retry</button>
            <button type="button" class="button ghost result-exit">Map library</button>
          </div>
        </div>
      </div>
    `;
    document.body.append(this.root);
    document.body.classList.add('game-active');

    this.host = qs(this.root, '.playfield-host');
    this.scoreEl = qs(this.root, '.hud-score');
    this.accuracyEl = qs(this.root, '.hud-accuracy');
    this.comboEl = qs(this.root, '.combo-value');
    this.multiplierEl = qs(this.root, '.combo-mult');
    this.healthFill = qs(this.root, '.health-fill');
    this.progressFill = qs(this.root, '.progress-fill');
    this.timeCurrent = qs(this.root, '.time-current');
    this.timeTotal = qs(this.root, '.time-total');
    this.countdownEl = qs(this.root, '.countdown');
    this.missFlash = qs(this.root, '.miss-flash');
    this.noticeEl = qs(this.root, '.game-notice');
    this.loading = qs(this.root, '.loading-layer');
    this.loadingText = qs(this.root, '.loading-text');
    this.loadingActions = qs(this.root, '.loading-actions');
    this.pauseModal = qs(this.root, '.pause-modal');
    this.resultsModal = qs(this.root, '.results-modal');
    this.speedInput = qs(this.root, '.setting-speed');
    this.arInput = qs(this.root, '.setting-ar');
    this.volumeInput = qs(this.root, '.setting-volume');
    this.offsetInput = qs(this.root, '.setting-offset');
    this.touchOffsetInput = qs(this.root, '.setting-touch');
    this.touchOffsetXInput = qs(this.root, '.setting-touch-x');
    this.hitSoundsInput = qs(this.root, '.setting-hitsounds');

    qs(this.root, '.hud-title').textContent = options.map.artist
      ? `${options.map.artist} — ${options.map.title}`
      : options.map.title;

    this.displayLengthMs = Math.max(
      1000,
      options.map.lengthMs,
      (options.map.notes.at(-1)?.time ?? 0) + 1000,
    );
    this.timeTotal.textContent = formatTime(this.displayLengthMs);

    this.bindEvents();
    this.syncSettingInputs();
  }

  async start(): Promise<void> {
    if (this.starting || this.destroyed) return;
    this.starting = true;
    this.loading.classList.remove('hidden');
    this.loadingText.textContent = 'Loading map…';
    this.loadingActions.classList.add('hidden');

    try {
      await this.audio.init();
      let audioWarning: string | null = null;
      try {
        await this.audio.load(this.options.map.audio);
        if (!this.options.map.audio) {
          audioWarning = 'This map has no audio — timing runs silently.';
        }
      } catch (error) {
        audioWarning = error instanceof Error
          ? `${error.message} — playing without sound.`
          : 'Audio could not be loaded — playing without sound.';
      }

      if (this.destroyed) return;

      this.renderer = new PlayfieldRenderer(this.host);
      this.renderer.setNotes(this.options.map.notes);
      this.renderer.setApproachTime(approachTimeMs(this.settings));
      this.renderer.resize();

      this.loading.classList.add('hidden');
      if (audioWarning) this.showNotice(audioWarning, 5200);
      this.beginAttempt();
    } catch (error) {
      this.loadingText.textContent = error instanceof Error
        ? error.message
        : 'The game could not start.';
      this.loadingActions.classList.remove('hidden');
    } finally {
      this.starting = false;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.countdownToken++;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.noticeTimer);
    window.clearTimeout(this.missTimer);
    window.removeEventListener('pointermove', this.handlePointer);
    window.removeEventListener('pointerdown', this.handlePointer);
    window.removeEventListener('keydown', this.handleKey);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('blur', this.handleBlur);

    this.audio.dispose();
    this.renderer?.dispose();
    this.root.remove();
    document.body.classList.remove('game-active');
  }

  private beginAttempt(): void {
    if (!this.renderer) return;

    this.countdownToken++;
    this.paused = false;
    this.ended = false;
    this.started = true;
    this.cursorVisible = this.pendingCursor !== null;
    this.pausedProgress = 0;
    this.lastHud = {
      score: -1,
      accuracy: -1,
      combo: -1,
      multiplier: -1,
      health: -1,
      progress: -1,
      time: '',
      countdown: '',
      countdownVisible: false,
    };

    this.root.classList.remove('is-paused', 'is-ended');
    this.pauseModal.classList.add('hidden');
    this.resultsModal.classList.add('hidden');
    this.setCountdown('', false);
    this.noticeEl.classList.remove('visible');

    const approach = approachTimeMs(this.settings);
    this.leadInMs = Math.max(LEAD_IN_MIN_MS, approach + 800);
    this.renderer.setApproachTime(approach);

    const endTime = Math.max(
      this.options.map.lengthMs,
      this.options.map.notes.at(-1)?.time ?? 0,
    ) + 1200;
    this.session = new GameSession(this.options.map.notes, {
      speed: this.settings.speed,
      endTimeMs: endTime,
    });

    if (this.pendingCursor) {
      this.session.setCursor(this.pendingCursor.x, this.pendingCursor.y);
    } else {
      // Park the cursor outside the grid until the player aims, so notes are
      // not hit by a stale pointer position on the first attempt.
      this.session.setCursor(9, 9);
    }

    this.audio.setVolume(this.settings.volume);
    this.audio.setOffsetMs(this.settings.offsetMs);
    this.audio.setHitSounds(this.settings.hitSounds);

    this.updateHud(0);

    try {
      this.audio.start(this.leadInMs, 0, this.settings.speed);
    } catch (error) {
      this.showNotice(error instanceof Error ? error.message : 'Audio could not start.', 5000);
    }

    cancelAnimationFrame(this.raf);
    this.tick();
  }

  private tick = (): void => {
    if (this.destroyed || this.paused || this.ended || !this.session) return;

    const progress = this.audio.getProgress();
    const events = this.session.update(progress);

    for (const event of events) {
      if (event.type === 'hit') {
        this.renderer?.hit(event.note.x, event.note.y, event.index);
        this.audio.playHit();
        this.popCombo();
      } else {
        this.audio.playMiss();
        this.flashMiss();
      }
    }

    this.renderer?.update(progress, this.session.results, {
      x: this.session.cursorX,
      y: this.session.cursorY,
      visible: this.cursorVisible,
    });
    this.updateHud(progress);

    if (this.session.failed || this.session.finished) {
      this.finish();
      return;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private updateHud(progress: number): void {
    if (!this.session) return;
    const stats = this.session.snapshot();
    const hud = this.lastHud;

    if (stats.score !== hud.score) {
      this.scoreEl.textContent = stats.score.toLocaleString();
      hud.score = stats.score;
    }
    if (stats.accuracy !== hud.accuracy) {
      this.accuracyEl.textContent = `${stats.accuracy.toFixed(2)}%`;
      hud.accuracy = stats.accuracy;
    }
    if (stats.combo !== hud.combo) {
      this.comboEl.textContent = String(stats.combo);
      this.comboEl.parentElement?.classList.toggle('idle', stats.combo === 0);
      hud.combo = stats.combo;
    }
    if (stats.multiplier !== hud.multiplier) {
      this.multiplierEl.textContent = `x${stats.multiplier}`;
      this.multiplierEl.classList.toggle('boosted', stats.multiplier > 1);
      hud.multiplier = stats.multiplier;
    }
    if (Math.round(stats.health) !== hud.health) {
      const health = Math.max(0, Math.min(100, stats.health));
      this.healthFill.style.width = `${health}%`;
      this.healthFill.classList.toggle('low', health <= 30);
      hud.health = Math.round(stats.health);
    }

    const ratio = this.displayLengthMs > 0
      ? Math.max(0, Math.min(1, progress / this.displayLengthMs))
      : 0;
    const roundedRatio = Math.round(ratio * 1000) / 1000;
    if (roundedRatio !== hud.progress) {
      this.progressFill.style.transform = `scaleX(${roundedRatio})`;
      hud.progress = roundedRatio;
    }

    const time = `${formatTime(Math.max(0, progress))} / ${formatTime(this.displayLengthMs)}`;
    if (time !== hud.time) {
      this.timeCurrent.textContent = formatTime(Math.max(0, progress));
      hud.time = time;
    }

    if (this.started && !this.paused && !this.ended) {
      const speed = this.session.speed || 1;
      if (progress < 0) {
        const remaining = -progress / speed;
        const value = remaining > (this.leadInMs * 2) / 3
          ? '3'
          : remaining > this.leadInMs / 3
            ? '2'
            : '1';
        this.setCountdown(value, true);
      } else if (progress < 600 * speed) {
        this.setCountdown('GO', true);
      } else {
        this.setCountdown('', false);
      }
    }
  }

  private finish(): void {
    if (!this.session || this.ended) return;
    this.ended = true;
    this.started = false;
    this.countdownToken++;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.setCountdown('', false);
    this.root.classList.add('is-ended');

    const stats = this.session.snapshot();
    const result: AttemptResult = {
      score: stats.score,
      accuracy: stats.accuracy,
      maxCombo: stats.maxCombo,
      hits: stats.hits,
      misses: stats.misses,
      failed: stats.failed,
      finished: stats.finished,
      speed: this.session.speed,
    };

    this.options.onResult(result);
    this.showResults(result);
  }

  private showResults(result: AttemptResult): void {
    const status = qs(this.root, '.result-status');
    const grade = qs(this.root, '.result-grade');
    const title = qs(this.root, '.result-title');
    const score = qs(this.root, '.result-score');
    const accuracy = qs(this.root, '.result-accuracy');
    const combo = qs(this.root, '.result-combo');
    const hits = qs(this.root, '.result-hits');
    const misses = qs(this.root, '.result-misses');

    status.textContent = result.failed ? 'Attempt failed' : 'Map cleared';
    grade.textContent = gradeFor(result.accuracy, result.failed);
    grade.dataset['grade'] = grade.textContent;
    title.textContent = this.options.map.title;
    score.textContent = result.score.toLocaleString();
    accuracy.textContent = `${result.accuracy.toFixed(2)}%`;
    combo.textContent = result.maxCombo.toLocaleString();
    hits.textContent = result.hits.toLocaleString();
    misses.textContent = result.misses.toLocaleString();

    this.resultsModal.classList.remove('hidden');
  }

  private pause(): void {
    if (!this.started || this.paused || this.ended || this.destroyed) return;
    this.paused = true;
    this.countdownToken++;
    this.pausedProgress = this.audio.pause();
    cancelAnimationFrame(this.raf);
    this.syncSettingInputs();
    this.setCountdown('', false);
    this.pauseModal.classList.remove('hidden');
    this.root.classList.add('is-paused');
  }

  private resume(): void {
    if (!this.paused || this.destroyed) return;
    this.pauseModal.classList.add('hidden');
    this.root.classList.remove('is-paused');
    this.paused = false;
    void this.resumeCountdown();
  }

  private async resumeCountdown(): Promise<void> {
    const token = ++this.countdownToken;
    for (const value of ['3', '2', '1']) {
      if (this.destroyed || token !== this.countdownToken) return;
      this.setCountdown(value, true);
      await delay(400);
    }
    if (this.destroyed || token !== this.countdownToken) return;
    this.setCountdown('GO', true);
    window.setTimeout(() => {
      if (!this.destroyed && token === this.countdownToken) this.setCountdown('', false);
    }, 420);

    this.audio.start(90, this.pausedProgress, this.session?.speed ?? this.settings.speed, true);
    this.tick();
  }

  private restart(): void {
    if (this.destroyed) return;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.resultsModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.root.classList.remove('is-paused', 'is-ended');
    this.beginAttempt();
  }

  private close(): void {
    if (this.destroyed) return;
    this.destroy();
    this.options.onExit();
  }

  private syncSettingInputs(): void {
    this.speedInput.value = String(this.settings.speed);
    qs(this.root, '.speed-output').textContent = `${this.settings.speed.toFixed(2)}×`;

    this.arInput.value = String(this.settings.approachRate);
    qs(this.root, '.ar-output').textContent = `${this.settings.approachRate} · ${Math.round(approachTimeMs(this.settings))} ms`;

    this.volumeInput.value = String(Math.round(this.settings.volume * 100));
    qs(this.root, '.volume-output').textContent = `${Math.round(this.settings.volume * 100)}%`;

    this.offsetInput.value = String(this.settings.offsetMs);
    qs(this.root, '.offset-output').textContent = `${this.settings.offsetMs > 0 ? '+' : ''}${this.settings.offsetMs} ms`;

    this.touchOffsetInput.value = String(this.settings.touchOffsetY);
    qs(this.root, '.touch-output').textContent = `${this.settings.touchOffsetY} px`;

    this.touchOffsetXInput.value = String(this.settings.touchOffsetX);
    qs(this.root, '.touch-x-output').textContent = `${this.settings.touchOffsetX} px`;

    this.hitSoundsInput.checked = this.settings.hitSounds;
  }

  private applySetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings = normalizeSettings({ ...this.settings, [key]: value });
    this.options.onSettingsChange({ ...this.settings });

    if (key === 'volume') {
      this.audio.setVolume(this.settings.volume);
    } else if (key === 'offsetMs') {
      this.audio.setOffsetMs(this.settings.offsetMs);
    } else if (key === 'hitSounds') {
      this.audio.setHitSounds(this.settings.hitSounds);
    }

    this.syncSettingInputs();
  }

  private bindEvents(): void {
    qs<HTMLButtonElement>(this.root, '.pause-button').addEventListener('click', () => this.pause());
    qs<HTMLButtonElement>(this.root, '.pause-resume').addEventListener('click', () => this.resume());
    qs<HTMLButtonElement>(this.root, '.pause-restart').addEventListener('click', () => this.restart());
    qs<HTMLButtonElement>(this.root, '.pause-quit').addEventListener('click', () => this.close());
    qs<HTMLButtonElement>(this.root, '.result-retry').addEventListener('click', () => this.restart());
    qs<HTMLButtonElement>(this.root, '.result-exit').addEventListener('click', () => this.close());
    qs<HTMLButtonElement>(this.root, '.loading-back').addEventListener('click', () => this.close());
    qs<HTMLButtonElement>(this.root, '.loading-retry').addEventListener('click', () => {
      this.starting = false;
      void this.start();
    });

    this.volumeInput.addEventListener('input', () => {
      this.applySetting('volume', Number(this.volumeInput.value) / 100);
    });
    this.speedInput.addEventListener('input', () => {
      this.applySetting('speed', Number(this.speedInput.value));
    });
    this.arInput.addEventListener('input', () => {
      this.applySetting('approachRate', Number(this.arInput.value));
    });
    this.offsetInput.addEventListener('input', () => {
      this.applySetting('offsetMs', Number(this.offsetInput.value));
    });
    this.touchOffsetInput.addEventListener('input', () => {
      this.applySetting('touchOffsetY', Number(this.touchOffsetInput.value));
    });
    this.touchOffsetXInput.addEventListener('input', () => {
      this.applySetting('touchOffsetX', Number(this.touchOffsetXInput.value));
    });
    this.hitSoundsInput.addEventListener('change', () => {
      this.applySetting('hitSounds', this.hitSoundsInput.checked);
    });

    window.addEventListener('pointermove', this.handlePointer, { passive: true });
    window.addEventListener('pointerdown', this.handlePointer, { passive: true });
    window.addEventListener('keydown', this.handleKey);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('blur', this.handleBlur);
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private handlePointer = (event: PointerEvent): void => {
    if (this.paused || this.ended || this.destroyed || !this.renderer) return;
    if (event.pointerType === 'mouse' && event.type === 'pointerdown' && event.button !== 0) return;

    let x = event.clientX;
    let y = event.clientY;
    if (event.pointerType !== 'mouse') {
      x -= this.settings.touchOffsetX;
      y -= this.settings.touchOffsetY;
    }

    const world = this.renderer.screenToWorld(x, y);
    this.pendingCursor = world;
    this.session?.setCursor(world.x, world.y);
    this.cursorVisible = true;
  };

  private handleKey = (event: KeyboardEvent): void => {
    if (event.repeat || this.destroyed) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    const key = event.key.toLowerCase();
    if (key === 'escape' || key === 'p' || key === ' ') {
      event.preventDefault();
      if (this.ended) return;
      if (this.paused) this.resume();
      else this.pause();
    }
  };

  private handleVisibility = (): void => {
    if (document.hidden) this.pause();
  };

  private handleBlur = (): void => {
    this.pause();
  };

  private setCountdown(text: string, visible: boolean): void {
    const hud = this.lastHud;
    if (hud.countdown === text && hud.countdownVisible === visible) return;
    hud.countdown = text;
    hud.countdownVisible = visible;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.toggle('visible', visible && text.length > 0);
    if (text === 'GO') {
      this.countdownEl.classList.add('go');
    } else {
      this.countdownEl.classList.remove('go');
    }
  }

  private popCombo(): void {
    this.comboEl.classList.remove('pop');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('pop');
  }

  private flashMiss(): void {
    this.missFlash.classList.remove('active');
    void this.missFlash.offsetWidth;
    this.missFlash.classList.add('active');
    window.clearTimeout(this.missTimer);
    this.missTimer = window.setTimeout(() => this.missFlash.classList.remove('active'), 220);
  }

  private showNotice(text: string, durationMs: number): void {
    window.clearTimeout(this.noticeTimer);
    this.noticeEl.textContent = text;
    this.noticeEl.classList.add('visible');
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('visible'), durationMs);
  }
}

function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing game UI element: ${selector}`);
  return element;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function gradeFor(accuracy: number, failed: boolean): string {
  if (failed) return 'F';
  if (accuracy >= 100) return 'SSS';
  if (accuracy >= 99) return 'SS';
  if (accuracy >= 95) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 80) return 'B';
  if (accuracy >= 70) return 'C';
  return 'D';
}
