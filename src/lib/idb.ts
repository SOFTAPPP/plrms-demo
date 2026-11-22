// Recorded video clips live in this browser's IndexedDB; the server keeps only their metadata.

const DB = 'strata-media';
const STORE = 'clips';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveClip(key: string, blob: Blob): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadClip(key: string): Promise<Blob | null> {
  try {
    const db = await open();
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteClip(key: string): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  } catch {
    /* nothing to delete */
  }
}
