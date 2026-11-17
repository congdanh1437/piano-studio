import { Beat } from './beat';
import { Song } from './song';

type StoreName = 'songs' | 'beats' | 'audio';

export interface StoredAudio {
  id: string;
  name: string;
  data: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('piano-studio', 3);
    request.onupgradeneeded = () => {
      for (const name of ['songs', 'beats', 'audio']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export const loadSongs = () => run<Song[]>('songs', 'readonly', (s) => s.getAll());
export const saveSong = (song: Song) => run('songs', 'readwrite', (s) => s.put(song));
export const deleteSong = (id: string) => run('songs', 'readwrite', (s) => s.delete(id));

export const loadBeats = () => run<Beat[]>('beats', 'readonly', (s) => s.getAll());
export const saveBeat = (beat: Beat) => run('beats', 'readwrite', (s) => s.put(beat));
export const deleteBeat = (id: string) => run('beats', 'readwrite', (s) => s.delete(id));

export const loadAllAudio = () => run<StoredAudio[]>('audio', 'readonly', (s) => s.getAll());
export const loadAudioIds = () => run<IDBValidKey[]>('audio', 'readonly', (s) => s.getAllKeys());
export const loadAudio = (id: string) => run<StoredAudio | undefined>('audio', 'readonly', (s) => s.get(id));
export const saveAudio = (audio: StoredAudio) => run('audio', 'readwrite', (s) => s.put(audio));
export const deleteAudio = (id: string) => run('audio', 'readwrite', (s) => s.delete(id));
