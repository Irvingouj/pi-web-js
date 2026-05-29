import { useCallback, useEffect, useRef } from "preact/hooks";
import type { Notebook } from "../notebook";
import { deserializeNotebook, serializeNotebook } from "../notebook";

const DB_NAME = "web-js-notebook";
const DB_VERSION = 1;
const STORE_NAME = "notebooks";
const NOTEBOOK_KEY = "default";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIndexedDB(nb: Notebook): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(serializeNotebook(nb), NOTEBOOK_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("[auto-save] failed:", e);
  }
}

export async function loadFromIndexedDB(): Promise<Notebook | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(NOTEBOOK_KEY);
    const result = await new Promise<string | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (result) {
      return deserializeNotebook(result);
    }
    return null;
  } catch (e) {
    console.warn("[auto-load] failed:", e);
    return null;
  }
}

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback((nb: Notebook) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveToIndexedDB(nb);
    }, 500);
  }, []);

  const saveNow = useCallback((nb: Notebook) => {
    saveToIndexedDB(nb);
  }, []);

  // Save on beforeunload
  useEffect(() => {
    const handler = () => {
      // This fires before unload — can't pass current state easily
      // The App component should call saveNow on beforeunload separately
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return { scheduleSave, saveNow };
}
