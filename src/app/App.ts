import type { MapFormat } from '../formats/types';
import { importFiles, type ImportError } from '../import/importFiles';
import { primeAudioContext } from '../audio/context';
import { approachTimeMs, DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings, type Settings } from '../settings';
import {
  addScore,
  bestScoresByMap,
  deleteMapRecord,
  getAllMaps,
  getAllScores,
  putMap,
  type StoredMap,
  type StoredScore,
} from '../storage/db';
import type { AttemptResult } from '../game/GameScreen';

interface LibraryEntry extends StoredMap {
  coverUrl: string | null;
  best: StoredScore | null;
}

const FORMAT_NAMES: Record<MapFormat, string> = {
  'sspm-v1': 'SSPM v1',
  'sspm-v2': 'SSPM v2',
  phxm: 'PHXM',
  rhm: 'RHM',
  txt: 'TXT',
};

const DIFFICULTY_NAMES = ['N/A', 'Easy', 'Medium', 'Hard', 'Logic', 'Tasukete'];

export class App {
  private readonly root: HTMLElement;
  private settings: Settings;
  private maps: LibraryEntry[] = [];
  private errors: ImportError[] = [];
  private ignored: string[] = [];
  private busy = false;
  private storageAvailable = true;
  private gameActive = false;
  private dragDepth = 0;
  private statusTimer = 0;

  private readonly dropzone: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly errorsEl: HTMLElement;
  private readonly mapGrid: HTMLElement;
  private readonly mapCount: HTMLElement;
  private readonly dialog: HTMLDialogElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.root.innerHTML = shellMarkup();

    this.dropzone = this.query('.dropzone');
    this.fileInput = this.query<HTMLInputElement>('.file-input');
    this.statusEl = this.query('.status');
    this.errorsEl = this.query('.errors');
    this.mapGrid = this.query('.map-grid');
    this.mapCount = this.query('.map-count');
    this.dialog = this.query<HTMLDialogElement>('.settings-dialog');

    this.bindLibraryEvents();
    this.bindSettingsEvents();
    this.renderLibrary();
    void this.restoreLibrary();
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }

  private bindLibraryEvents(): void {
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) {
        void this.handleFiles([...this.fileInput.files]);
        this.fileInput.value = '';
      }
    });

    this.dropzone.addEventListener('click', (event) => {
      if (event.target instanceof HTMLButtonElement) return;
      this.fileInput.click();
    });

    this.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.fileInput.click();
      }
    });

    const choose = this.query<HTMLButtonElement>('.choose-files');
    choose.addEventListener('click', (event) => {
      event.stopPropagation();
      this.fileInput.click();
    });

    this.dropzone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      this.dragDepth++;
      this.dropzone.classList.add('dragging');
    });
    this.dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    this.dropzone.addEventListener('dragleave', (event) => {
      event.preventDefault();
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dropzone.classList.remove('dragging');
    });
    this.dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dragDepth = 0;
      this.dropzone.classList.remove('dragging');
      if (event.dataTransfer?.files.length) {
        void this.handleFiles([...event.dataTransfer.files]);
      }
    });

    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      if (!this.dropzone.contains(event.target as Node)) event.preventDefault();
    });
  }

  private bindSettingsEvents(): void {
    this.query<HTMLButtonElement>('.settings-open').addEventListener('click', () => this.openSettings());
    this.query<HTMLButtonElement>('.settings-close').addEventListener('click', () => this.dialog.close());
    this.query<HTMLButtonElement>('.settings-done').addEventListener('click', () => this.dialog.close());
    this.query<HTMLButtonElement>('.settings-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      saveSettings(this.settings);
      this.syncSettingsInputs();
      this.updateSettingsOutputs();
    });

    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });

    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      input.addEventListener('input', () => {
        const key = input.dataset['setting'] as keyof Settings | undefined;
        if (!key) return;

        let value: number | boolean = input.type === 'checkbox'
          ? input.checked
          : Number(input.value);
        if (key === 'volume') value = Number(input.value) / 100;

        this.settings = normalizeSettings({ ...this.settings, [key]: value } as Settings);
        saveSettings(this.settings);
        this.updateSettingsOutputs();
      });
    }
  }

  private openSettings(): void {
    this.syncSettingsInputs();
    this.updateSettingsOutputs();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private syncSettingsInputs(): void {
    const values: Record<string, string | boolean> = {
      speed: String(this.settings.speed),
      approachRate: String(this.settings.approachRate),
      offsetMs: String(this.settings.offsetMs),
      volume: String(Math.round(this.settings.volume * 100)),
      touchOffsetY: String(this.settings.touchOffsetY),
      touchOffsetX: String(this.settings.touchOffsetX),
      hitSounds: this.settings.hitSounds,
    };

    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      const value = values[input.dataset['setting'] ?? ''];
      if (typeof value === 'boolean') input.checked = value;
      else if (value !== undefined) input.value = value;
    }
  }

  private updateSettingsOutputs(): void {
    const out = (name: string) => this.query(`[data-out="${name}"]`);

    out('speed').textContent = `${this.settings.speed.toFixed(2)}×`;
    out('ar').textContent = `${this.settings.approachRate.toFixed(0)} · ${Math.round(approachTimeMs(this.settings))} ms`;
    out('offset').textContent = `${this.settings.offsetMs > 0 ? '+' : ''}${this.settings.offsetMs} ms`;
    out('volume').textContent = `${Math.round(this.settings.volume * 100)}%`;
    out('touch').textContent = `${this.settings.touchOffsetY} px`;
    out('touchX').textContent = `${this.settings.touchOffsetX} px`;
  }

  private async restoreLibrary(): Promise<void> {
    try {
      const [records, scores] = await Promise.all([getAllMaps(), getAllScores()]);
      const best = bestScoresByMap(scores);
      this.maps = records.map((record) => ({
        ...record,
        coverUrl: record.map.cover ? URL.createObjectURL(record.map.cover) : null,
        best: best.get(record.key) ?? null,
      }));
      this.sortMaps();
    } catch {
      this.storageAvailable = false;
      this.errors = [{
        fileName: 'Local storage',
        message: 'Saved maps and scores are unavailable in this browser. Imported maps will only last for this session.',
      }];
    } finally {
      this.renderLibrary();
    }
  }

  private async handleFiles(files: File[]): Promise<void> {
    if (this.busy || files.length === 0 || this.gameActive) return;

    this.busy = true;
    this.errors = [];
    this.ignored = [];
    this.setStatus('Reading maps…', 0);
    this.renderErrors();

    try {
      const summary = await importFiles(files);
      this.errors = summary.errors;
      this.ignored = summary.ignored;

      let replaced = 0;
      for (const imported of summary.maps) {
        const record: StoredMap = {
          key: imported.key,
          fileName: imported.fileName,
          fileSize: imported.fileSize,
          importedAt: Date.now(),
          map: imported.map,
        };

        const existingIndex = this.maps.findIndex((entry) => entry.key === record.key);
        const existing = existingIndex >= 0 ? this.maps[existingIndex] : undefined;
        if (existing) {
          replaced++;
          if (existing.coverUrl) URL.revokeObjectURL(existing.coverUrl);
        }

        const entry: LibraryEntry = {
          ...record,
          coverUrl: record.map.cover ? URL.createObjectURL(record.map.cover) : null,
          best: existing?.best ?? null,
        };

        if (existingIndex >= 0) this.maps[existingIndex] = entry;
        else this.maps.push(entry);

        if (this.storageAvailable) {
          try {
            await putMap(record);
          } catch {
            this.storageAvailable = false;
            this.errors.push({
              fileName: 'Local storage',
              message: 'This map could not be saved. It will still be playable this session.',
            });
          }
        }
      }

      this.sortMaps();
      this.renderLibrary();

      if (summary.maps.length > 0) {
        const replacedText = replaced > 0 ? ` (${replaced} replaced)` : '';
        this.setStatus(`Imported ${summary.maps.length} map${summary.maps.length === 1 ? '' : 's'}${replacedText}`, 4200);
      } else if (summary.errors.length === 0) {
        this.setStatus('No maps found in those files.', 4200);
      }
    } catch (error) {
      this.errors = [{
        fileName: 'Import',
        message: error instanceof Error ? error.message : String(error),
      }];
      this.renderErrors();
      this.setStatus('', 0);
    } finally {
      this.busy = false;
      this.renderLibrary();
      if (this.statusEl.textContent === 'Reading maps…') this.setStatus('', 0);
    }
  }

  private async openGame(entry: LibraryEntry): Promise<void> {
    if (this.gameActive || entry.map.notes.length === 0) return;

    // Create/resume the AudioContext inside the click, before the lazy game
    // import, so iOS Safari allows audio playback.
    primeAudioContext();

    this.gameActive = true;
    this.setStatus('Loading game…', 0);

    try {
      const { GameScreen } = await import('../game/GameScreen');
      const game = new GameScreen({
        map: entry.map,
        settings: this.settings,
        onResult: (result: AttemptResult) => {
          void this.saveResult(entry.key, result);
        },
        onSettingsChange: (settings) => {
          this.settings = settings;
          saveSettings(settings);
        },
        onExit: () => {
          this.gameActive = false;
          this.setStatus('', 0);
          this.renderLibrary();
        },
      });

      this.setStatus('', 0);
      await game.start();
    } catch (error) {
      this.gameActive = false;
      this.setStatus('', 0);
      this.errors = [{
        fileName: 'Game',
        message: error instanceof Error ? error.message : String(error),
      }];
      this.renderErrors();
    }
  }

  private async saveResult(mapKey: string, result: AttemptResult): Promise<void> {
    const score: StoredScore = {
      mapKey,
      score: result.score,
      accuracy: result.accuracy,
      maxCombo: result.maxCombo,
      hits: result.hits,
      misses: result.misses,
      failed: result.failed,
      playedAt: Date.now(),
      speed: result.speed,
    };

    const entry = this.maps.find((item) => item.key === mapKey);
    if (entry) {
      const best = entry.best;
      if (
        !best
        || score.score > best.score
        || (score.score === best.score && score.accuracy > best.accuracy)
      ) {
        entry.best = score;
      }
    }

    if (!this.storageAvailable) return;
    try {
      await addScore(score);
    } catch {
      this.storageAvailable = false;
      this.errors = [{
        fileName: 'Local storage',
        message: 'Scores could not be saved in this browser.',
      }];
    }
  }

  private async removeEntry(entry: LibraryEntry): Promise<void> {
    const confirmed = window.confirm(
      `Remove "${entry.map.title}" from your library? This only deletes the local copy.`,
    );
    if (!confirmed) return;

    if (entry.coverUrl) URL.revokeObjectURL(entry.coverUrl);
    this.maps = this.maps.filter((item) => item.key !== entry.key);
    this.renderLibrary();

    if (!this.storageAvailable) return;
    try {
      await deleteMapRecord(entry.key);
    } catch {
      this.setStatus('The map was removed for this session but could not be deleted from storage.', 5200);
    }
  }

  private renderLibrary(): void {
    this.mapCount.textContent = this.maps.length === 1 ? '1 map' : `${this.maps.length} maps`;
    this.renderErrors();

    this.mapGrid.replaceChildren();
    if (this.maps.length === 0) {
      const empty = el('div', 'empty');
      empty.textContent = this.busy
        ? 'Reading maps…'
        : 'No maps yet. Drop an .sspm, .phxm, .rhm, .txt or .zip file above to get started.';
      this.mapGrid.append(empty);
      return;
    }

    for (const entry of this.maps) {
      this.mapGrid.append(this.renderCard(entry));
    }
  }

  private renderErrors(): void {
    const problems = [
      ...this.errors.map((error) => `${error.fileName}: ${error.message}`),
      ...this.ignored.map((name) => `${name}: not a supported map or audio file`),
    ];

    this.errorsEl.replaceChildren();
    this.errorsEl.classList.toggle('visible', problems.length > 0);
    for (const problem of problems) {
      this.errorsEl.append(el('li', undefined, problem));
    }
  }

  private renderCard(entry: LibraryEntry): HTMLElement {
    const { map } = entry;
    const card = el('article', 'map-card');

    const cover = el('div', 'map-cover');
    if (entry.coverUrl) {
      const image = el('img');
      image.src = entry.coverUrl;
      image.alt = '';
      image.loading = 'lazy';
      cover.append(image);
    } else {
      cover.textContent = map.title.trim().charAt(0).toUpperCase() || '?';
    }

    const body = el('div', 'map-body');
    const top = el('div', 'map-top');
    top.append(
      el('span', 'format-badge', FORMAT_NAMES[map.format]),
      el('span', 'difficulty-badge', difficultyLabel(map.difficulty, map.difficultyName)),
    );

    const heading = el('h3', 'map-title', map.title || 'Unknown map');
    heading.title = map.title;
    const artist = el('p', 'map-artist', map.artist || 'Unknown artist');

    const stats = el('dl', 'map-stats');
    addStat(stats, 'Notes', map.notes.length.toLocaleString());
    addStat(stats, 'Length', formatDuration(map.lengthMs));
    addStat(stats, 'Mappers', map.mappers.length > 0 ? map.mappers.join(', ') : '—');
    addStat(stats, 'Source', `${entry.fileName} · ${formatBytes(entry.fileSize)}`);

    const assets = el('div', 'asset-row');
    assets.append(
      el('span', `asset ${map.audio ? 'on' : 'off'}`, map.audio ? 'Audio' : 'No audio'),
      el('span', `asset ${map.cover ? 'on' : 'off'}`, map.cover ? 'Cover' : 'No cover'),
      el('span', 'asset info', map.starRating ? `${map.starRating}★ rating` : 'No rating'),
    );

    if (entry.best) {
      const best = el('p', 'best-row');
      best.append(
        el('span', 'best-label', 'Best'),
        el('strong', undefined, `${entry.best.accuracy.toFixed(2)}%`),
        el('span', 'best-score', `· ${entry.best.score.toLocaleString()}`),
      );
      if (entry.best.failed) best.append(el('span', 'best-failed', 'failed'));
      body.append(top, heading, artist, stats, assets, best);
    } else {
      body.append(top, heading, artist, stats, assets);
    }

    const actions = el('div', 'map-actions');
    const play = el('button', 'button primary small', map.audio ? 'Play' : 'Practice');
    play.type = 'button';
    play.disabled = map.notes.length === 0;
    if (map.notes.length === 0) play.title = 'This map has no notes';
    play.addEventListener('click', () => void this.openGame(entry));

    const remove = el('button', 'button ghost small', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => void this.removeEntry(entry));

    actions.append(play, remove);
    body.append(actions);
    card.append(cover, body);
    return card;
  }

  private sortMaps(): void {
    this.maps.sort((a, b) =>
      a.map.title.localeCompare(b.map.title) || a.map.difficulty - b.map.difficulty,
    );
  }

  private setStatus(text: string, durationMs: number): void {
    window.clearTimeout(this.statusTimer);
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('visible', text.length > 0);

    if (durationMs > 0) {
      this.statusTimer = window.setTimeout(() => {
        this.statusEl.textContent = '';
        this.statusEl.classList.remove('visible');
      }, durationMs);
    }
  }
}

function shellMarkup(): string {
  return `
    <header class="site-header">
      <div class="brand">
        <div class="logo">R</div>
        <div>
          <h1>Rhythia Web</h1>
          <p class="subtitle">unofficial browser port</p>
        </div>
      </div>
      <div class="header-actions">
        <p class="header-note">local maps · no uploads · AGPL-3.0</p>
        <button class="icon-button settings-open" type="button" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M4 7h9M18.5 7H20M4 17h2M9.5 17H20" />
            <circle cx="15.5" cy="7" r="2.2" />
            <circle cx="7" cy="17" r="2.2" />
          </svg>
        </button>
      </div>
    </header>

    <main class="layout">
      <section class="intro">
        <h2>Your maps. Your browser.</h2>
        <p>Import the map files you already have, then play them right here with mouse or touch. Maps stay on your device — nothing is uploaded.</p>
      </section>

      <section class="dropzone" tabindex="0" role="button" aria-label="Import map files">
        <input class="file-input" type="file" multiple accept=".sspm,.phxm,.rhm,.txt,.mp3,.ogg,.wav,.flac,.zip" />
        <p class="drop-title">Drop your maps here</p>
        <p class="drop-hint">.sspm · .phxm · .rhm · .txt · .zip — pair an audio file with .txt maps</p>
        <button class="primary choose-files" type="button">Choose files</button>
      </section>

      <section class="library">
        <div class="library-header">
          <h2>Map library</h2>
          <span class="map-count">0 maps</span>
        </div>
        <p class="status"></p>
        <ul class="errors"></ul>
        <section class="map-grid"></section>
      </section>
    </main>

    <footer class="site-footer">
      <p>Unofficial fan project. Not affiliated with Rhythia, CAPO Games, Steam Rhythia or rhythia.com.</p>
      <p>Maps stay on your device. No copyrighted music is bundled or redistributed. Licensed AGPL-3.0.</p>
    </footer>

    <dialog class="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-card">
        <div class="settings-head">
          <div>
            <p class="settings-eyebrow">Settings</p>
            <h2 id="settings-title">Make it yours.</h2>
          </div>
          <button class="icon-button settings-close" type="button" aria-label="Close settings">×</button>
        </div>

        <div class="settings-grid">
          <label class="settings-row">
            <span>Scroll speed <output data-out="speed"></output></span>
            <input data-setting="speed" type="range" min="0.5" max="3" step="0.05" />
          </label>
          <label class="settings-row">
            <span>Approach rate <output data-out="ar"></output></span>
            <input data-setting="approachRate" type="range" min="5" max="100" step="1" />
          </label>
          <label class="settings-row">
            <span>Note offset <output data-out="offset"></output></span>
            <input data-setting="offsetMs" type="range" min="-300" max="300" step="5" />
          </label>
          <label class="settings-row">
            <span>Volume <output data-out="volume"></output></span>
            <input data-setting="volume" type="range" min="0" max="100" step="1" />
          </label>
          <label class="settings-row">
            <span>Touch offset X <output data-out="touchX"></output></span>
            <input data-setting="touchOffsetX" type="range" min="-80" max="80" step="4" />
          </label>
          <label class="settings-row">
            <span>Touch offset Y <output data-out="touch"></output></span>
            <input data-setting="touchOffsetY" type="range" min="0" max="160" step="4" />
          </label>
          <label class="settings-check">
            <input data-setting="hitSounds" type="checkbox" />
            <span>Hit sounds</span>
          </label>
        </div>

        <p class="settings-hint">Increase the note offset if notes feel early. Speed and approach rate apply on new attempts.</p>

        <div class="settings-actions">
          <button class="button primary settings-done" type="button">Done</button>
          <button class="button ghost settings-reset" type="button">Reset defaults</button>
        </div>
      </div>
    </dialog>
  `;
}

function addStat(list: HTMLElement, label: string, value: string): void {
  list.append(el('dt', undefined, label), el('dd', undefined, value));
}

function difficultyLabel(group: number, name: string | null): string {
  const base = DIFFICULTY_NAMES[group] ?? `Group ${group}`;
  return name ? `${base} · ${name}` : base;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
