// Remembers the opened folder between visits. A FileSystemDirectoryHandle can't go into localStorage, but it can be
// stored in IndexedDB (structured clone). The browser still asks for access again on a later visit unless the user
// chose "Allow on every visit" — the start screen's "Reconnect" button does that (requestPermission needs a click).
import type { FsDirHandle } from "./folderBackend";

const DB_NAME = "pbstudio-storage";
const STORE = "handles";
const KEY = "folder";

interface Saved {
  handle: FsDirHandle;
  name: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Can't open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB request failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

/** The folder opened last time, if any (never throws: storage problems just mean "nothing remembered"). */
export async function loadFolderHandle(): Promise<FsDirHandle | undefined> {
  try {
    const saved = (await run<Saved | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<Saved | undefined>)) ?? undefined;
    return saved?.handle && saved.handle.kind === "directory" ? saved.handle : undefined;
  } catch {
    return undefined;
  }
}

/** Remember a folder for the next visit (best effort). */
export async function saveFolderHandle(handle: FsDirHandle): Promise<void> {
  try {
    const value: Saved = { handle, name: handle.name, savedAt: Date.now() };
    await run("readwrite", (s) => s.put(value, KEY));
  } catch (err) {
    console.warn("[storage] couldn't remember the folder:", err);
  }
}

/** Forget the remembered folder (best effort). */
export async function clearFolderHandle(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch (err) {
    console.warn("[storage] couldn't forget the folder:", err);
  }
}
