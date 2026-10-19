import './style.css';
import type { MapFormat } from './formats/types';
import { importFiles, type ImportedMap } from './import/importFiles';

interface LoadedMap extends ImportedMap {
  coverUrl: string | null;
}

const DIFFICULTY_NAMES = ['N/A', 'Easy', 'Medium', 'Hard', 'Logic', 'Tasukete'];
const FORMAT_NAMES: Record<MapFormat, string> = {
  'sspm-v1': 'SSPM v1',
  'sspm-v2': 'SSPM v2',
  phxm: 'PHXM',
  rhm: 'RHM',
  txt: 'TXT',
};

const state = {
  maps: [] as LoadedMap[],
  errors: [] as { fileName: string; message: string }[],
  ignored: [] as string[],
  busy: false,
  dragDepth: 0,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root element');

const dropzone = el('section', 'dropzone');
const fileInput = el('input', 'file-input');
fileInput.type = 'file';
fileInput.multiple = true;
fileInput.accept = '.sspm,.phxm,.rhm,.txt,.mp3,.ogg,.wav,.flac';
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) {
    void handleFiles([...fileInput.files]);
    fileInput.value = '';
  }
});

const dropTitle = el('p', 'drop-title', 'Drop your maps here');
const dropHint = el('p', 'drop-hint', '.sspm · .phxm · .rhm · .txt  (audio files pair with .txt maps)');
const chooseButton = el('button', 'primary', 'Choose files');
chooseButton.type = 'button';
chooseButton.addEventListener('click', (event) => {
  event.stopPropagation();
  fileInput.click();
});

dropzone.append(fileInput, dropTitle, dropHint, chooseButton);
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
dropzone.tabIndex = 0;
dropzone.setAttribute('role', 'button');
dropzone.setAttribute('aria-label', 'Import map files');

const statusLine = el('p', 'status');
const errorList = el('ul', 'errors');
const mapGrid = el('section', 'map-grid');
const mapCount = el('span', 'map-count');

const header = el('header', 'site-header');
const brand = el('div', 'brand');
const logo = el('div', 'logo', 'R');
const brandText = el('div');
const title = el('h1', undefined, 'Rhythia Web');
const subtitle = el('p', 'subtitle', 'unofficial browser port');
brandText.append(title, subtitle);
brand.append(logo, brandText);

const repoNote = el('p', 'header-note', 'local maps · no uploads · AGPL-3.0');
header.append(brand, repoNote);

const main = el('main', 'layout');
const intro = el('section', 'intro');
intro.append(
  el('h2', undefined, 'Your maps. Your browser.'),
  el(
    'p',
    undefined,
    'Import the map files you already have and inspect them here. The playable client is being built in the open — audio and gameplay land in the next milestones.',
  ),
);

const libraryHeader = el('div', 'library-header');
libraryHeader.append(el('h2', undefined, 'Map library'), mapCount);

const library = el('section', 'library');
library.append(libraryHeader, statusLine, errorList, mapGrid);

main.append(intro, dropzone, library);

const footer = el('footer', 'site-footer');
footer.append(
  el(
    'p',
    undefined,
    'Unofficial fan project. Not affiliated with Rhythia, CAPO Games, Steam Rhythia or rhythia.com.',
  ),
  el('p', undefined, 'Maps stay on your device. No copyrighted music is bundled or redistributed.'),
);

app.append(header, main, footer);

let ignoreWindowDrop = false;
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  if (ignoreWindowDrop) return;
  event.preventDefault();
});

dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  state.dragDepth++;
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
dropzone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) dropzone.classList.remove('dragging');
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  ignoreWindowDrop = true;
  state.dragDepth = 0;
  dropzone.classList.remove('dragging');
  const files = event.dataTransfer?.files;
  if (files?.length) void handleFiles([...files]);
  setTimeout(() => {
    ignoreWindowDrop = false;
  }, 0);
});

renderLibrary();

async function handleFiles(files: File[]): Promise<void> {
  state.busy = true;
  renderStatus();

  try {
    const summary = await importFiles(files);
    for (const entry of summary.maps) {
      state.maps.push({
        ...entry,
        coverUrl: entry.map.cover ? URL.createObjectURL(entry.map.cover) : null,
      });
    }
    state.maps.sort((a, b) => a.map.title.localeCompare(b.map.title));
    state.errors = summary.errors;
    state.ignored = summary.ignored;
  } finally {
    state.busy = false;
    renderLibrary();
  }
}

function renderStatus(): void {
  statusLine.textContent = state.busy ? 'Reading maps…' : '';
  statusLine.classList.toggle('visible', state.busy);
}

function renderLibrary(): void {
  renderStatus();
  mapCount.textContent = state.maps.length === 1 ? '1 map' : `${state.maps.length} maps`;

  errorList.replaceChildren();
  const problems: string[] = [
    ...state.errors.map((error) => `${error.fileName}: ${error.message}`),
    ...state.ignored.map((name) => `${name}: not a supported map or audio file`),
  ];
  if (problems.length > 0) {
    errorList.classList.add('visible');
    for (const problem of problems) {
      errorList.append(el('li', undefined, problem));
    }
  } else {
    errorList.classList.remove('visible');
  }

  mapGrid.replaceChildren();
  if (state.maps.length === 0) {
    mapGrid.append(el('p', 'empty', 'No maps imported yet.'));
    return;
  }

  for (const entry of state.maps) {
    mapGrid.append(renderCard(entry));
  }
}

function renderCard(entry: LoadedMap): HTMLElement {
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

  body.append(top, heading, artist, stats, assets);
  card.append(cover, body);
  return card;
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
