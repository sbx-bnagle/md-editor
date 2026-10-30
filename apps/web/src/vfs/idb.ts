// A small promise wrapper around IndexedDB: the web app keeps its settings, the files it has
// downloaded, and changes not yet uploaded here, so a reload (or a phone closing the tab) loses nothing.

export type StoreName = 'local' | 'cache' | 'queue' | 'kv';

const DB_NAME = 'folio-dome';
const STORES: StoreName[] = ['local', 'cache', 'queue', 'kv'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, name === 'queue' ? { autoIncrement: true } : undefined);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available.'));
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function idbGet<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return done((await store(name, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function idbPut(name: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return done((await store(name, 'readwrite')).put(value, key));
}

export async function idbDelete(name: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  await done((await store(name, 'readwrite')).delete(key));
}

/** Every [key, value] of a store, in key order. */
export async function idbEntries<T>(name: StoreName): Promise<Array<[IDBValidKey, T]>> {
  const s = await store(name, 'readonly');
  const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
  return keys.map((k, i) => [k, values[i] as T]);
}

export async function idbClear(name: StoreName): Promise<void> {
  await done((await store(name, 'readwrite')).clear());
}

export async function idbKeys(name: StoreName): Promise<IDBValidKey[]> {
  return done((await store(name, 'readonly')).getAllKeys());
}
