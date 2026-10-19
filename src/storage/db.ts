import type { MapData } from '../formats/types';

export interface StoredMap {
  key: string;
  fileName: string;
  fileSize: number;
  importedAt: number;
  map: MapData;
}

export interface StoredScore {
  id?: number;
  mapKey: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  hits: number;
  misses: number;
  failed: boolean;
  playedAt: number;
  speed: number;
}

const DB_NAME = 'rhythia-web';
const DB_VERSION = 1;
const MAPS = 'maps';
const SCORES = 'scores';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MAPS)) {
        db.createObjectStore(MAPS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(SCORES)) {
        const store = db.createObjectStore(SCORES, { keyPath: 'id', autoIncrement: true });
        store.createIndex('mapKey', 'mapKey', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local database'));
    request.onblocked = () => reject(new Error('Local database is blocked by another tab'));
  });

  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local database request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local database transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local database transaction was aborted'));
  });
}

export async function getAllMaps(): Promise<StoredMap[]> {
  const db = await openDb();
  const transaction = db.transaction(MAPS, 'readonly');
  const records = await requestResult(transaction.objectStore(MAPS).getAll() as IDBRequest<StoredMap[]>);
  await transactionDone(transaction);
  return records.sort((a, b) => a.map.title.localeCompare(b.map.title));
}

export async function putMap(record: StoredMap): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(MAPS, 'readwrite');
  transaction.objectStore(MAPS).put(record);
  await transactionDone(transaction);
}

export async function deleteMapRecord(key: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([MAPS, SCORES], 'readwrite');
  transaction.objectStore(MAPS).delete(key);

  const scores = transaction.objectStore(SCORES);
  const index = scores.index('mapKey');
  const request = index.openKeyCursor(IDBKeyRange.only(key));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    scores.delete(cursor.primaryKey);
    cursor.continue();
  };

  await transactionDone(transaction);
}

export async function addScore(score: StoredScore): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(SCORES, 'readwrite');
  transaction.objectStore(SCORES).add(score);
  await transactionDone(transaction);
}

export async function getAllScores(): Promise<StoredScore[]> {
  const db = await openDb();
  const transaction = db.transaction(SCORES, 'readonly');
  const records = await requestResult(transaction.objectStore(SCORES).getAll() as IDBRequest<StoredScore[]>);
  await transactionDone(transaction);
  return records;
}

/** Returns the best score per map (highest score, then accuracy). */
export function bestScoresByMap(scores: StoredScore[]): Map<string, StoredScore> {
  const best = new Map<string, StoredScore>();
  for (const score of scores) {
    const current = best.get(score.mapKey);
    if (
      !current
      || score.score > current.score
      || (score.score === current.score && score.accuracy > current.accuracy)
    ) {
      best.set(score.mapKey, score);
    }
  }
  return best;
}
