// Pure Vanilla IndexedDB helper for WebICU extension (Zero build / No dependencies)
// Dual-Store Resilient Architecture: Supports dedicated event_chunks OR compound-key events chunking
const DB_NAME = 'webicu_db';
const DB_VERSION = 2;
const STORE_SESSIONS = 'sessions';
const STORE_EVENTS = 'events';          // Legacy monolithic / compound-chunk store
const STORE_CHUNKS = 'event_chunks';    // High-performance append-only chunk store

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let resolved = false;

    // Safety timeout: If version upgrade is ever blocked or delayed by open tabs,
    // fallback gracefully to opening the existing database so the UI never hangs.
    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[WebICU DB] Database version upgrade timed out. Opening existing database.');
        const fallbackReq = indexedDB.open(DB_NAME);
        fallbackReq.onsuccess = () => resolve(fallbackReq.result);
        fallbackReq.onerror = () => {
          dbPromise = null;
          reject(fallbackReq.error);
        };
      }
    }, 1200);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('[WebICU DB] Database upgrade blocked by an open connection. Waiting...');
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Sessions store
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessionStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        sessionStore.createIndex('createTimestamp', 'createTimestamp', { unique: false });
      }

      // 2. Events store
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
      }

      // 3. High-performance append-only chunk store
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'chunkId' });
        chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };

    request.onsuccess = () => {
      clearTimeout(timeoutTimer);
      if (resolved) return;
      resolved = true;
      const db = request.result;
      db.onversionchange = () => {
        console.warn('[WebICU DB] Database version changing, closing old connection handle.');
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      clearTimeout(timeoutTimer);
      if (resolved) return;
      resolved = true;
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Initializes a new session record. Dynamically opens only stores that actually exist.
 */
export async function saveSession(session, events = []) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const stores = [STORE_SESSIONS];
    if (events && events.length > 0) {
      if (db.objectStoreNames.contains(STORE_CHUNKS)) stores.push(STORE_CHUNKS);
      else if (db.objectStoreNames.contains(STORE_EVENTS)) stores.push(STORE_EVENTS);
    }

    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve(session);
    tx.onerror = () => reject(tx.error);

    const sessionStore = tx.objectStore(STORE_SESSIONS);
    sessionStore.put(session);

    if (events && events.length > 0) {
      if (db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = tx.objectStore(STORE_CHUNKS);
        chunkStore.put({
          chunkId: `${session.id}_000000`,
          sessionId: session.id,
          chunkIndex: 0,
          events,
          timestamp: Date.now()
        });
      } else if (db.objectStoreNames.contains(STORE_EVENTS)) {
        const eventStore = tx.objectStore(STORE_EVENTS);
        eventStore.put({
          id: `${session.id}_c_000000`,
          sessionId: session.id,
          chunkIndex: 0,
          events,
          timestamp: Date.now()
        });
      }
    }
  });
}

/**
 * High-performance O(1) chunk write: writes ONLY this batch.
 * Works seamlessly whether STORE_CHUNKS or STORE_EVENTS is active.
 */
export async function appendEventChunk(sessionId, newEvents, chunkIndex = 0) {
  if (!newEvents || newEvents.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    if (db.objectStoreNames.contains(STORE_CHUNKS)) {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      const chunkStore = tx.objectStore(STORE_CHUNKS);
      const chunkId = `${sessionId}_${String(chunkIndex).padStart(6, '0')}`;
      chunkStore.put({
        chunkId,
        sessionId,
        chunkIndex,
        events: newEvents,
        timestamp: Date.now()
      });
    } else if (db.objectStoreNames.contains(STORE_EVENTS)) {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      const store = tx.objectStore(STORE_EVENTS);
      const chunkKey = `${sessionId}_c_${String(chunkIndex).padStart(6, '0')}`;
      store.put({
        id: chunkKey,
        sessionId,
        chunkIndex,
        events: newEvents,
        timestamp: Date.now()
      });
    } else {
      resolve();
    }
  });
}

export async function appendEvents(sessionId, newEvents) {
  return appendEventChunk(sessionId, newEvents, Date.now());
}

export async function updateSession(session) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.oncomplete = () => resolve(session);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_SESSIONS).put(session);
  });
}

export async function getAllSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);
    const request = store.getAll();
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => (b.createTimestamp || 0) - (a.createTimestamp || 0));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getSession(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const req = tx.objectStore(STORE_SESSIONS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Reassembles all chunks in order for a session.
 * Gracefully reassembles from STORE_CHUNKS, STORE_EVENTS chunk range, or legacy monolithic store.
 */
export async function getEvents(sessionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    // 1. Try reading from dedicated chunk store
    if (db.objectStoreNames.contains(STORE_CHUNKS)) {
      try {
        const tx = db.transaction(STORE_CHUNKS, 'readonly');
        const store = tx.objectStore(STORE_CHUNKS);
        const index = store.index('sessionId');
        const req = index.getAll(sessionId);

        req.onsuccess = () => {
          const chunks = req.result || [];
          if (chunks.length > 0) {
            chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
            const allEvents = [];
            for (let i = 0; i < chunks.length; i++) {
              const evs = chunks[i].events;
              if (Array.isArray(evs)) {
                for (let j = 0; j < evs.length; j++) {
                  allEvents.push(evs[j]);
                }
              }
            }
            resolve(allEvents);
            return;
          }
          readEventsFromStoreEvents(db, sessionId, resolve, reject);
        };
        req.onerror = () => readEventsFromStoreEvents(db, sessionId, resolve, reject);
        return;
      } catch (_) {
        readEventsFromStoreEvents(db, sessionId, resolve, reject);
        return;
      }
    }

    // 2. Read from STORE_EVENTS (chunked range or legacy monolithic)
    readEventsFromStoreEvents(db, sessionId, resolve, reject);
  });
}

function readEventsFromStoreEvents(db, sessionId, resolve, reject) {
  if (!db.objectStoreNames.contains(STORE_EVENTS)) {
    resolve([]);
    return;
  }
  try {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const store = tx.objectStore(STORE_EVENTS);

    // Check if chunks exist with compound key prefix `${sessionId}_c_`
    const prefix = `${sessionId}_c_`;
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const rangeReq = store.getAll(range);

    rangeReq.onsuccess = () => {
      const chunks = rangeReq.result || [];
      if (chunks.length > 0) {
        chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
        const allEvents = [];
        for (let i = 0; i < chunks.length; i++) {
          const evs = chunks[i].events;
          if (Array.isArray(evs)) {
            for (let j = 0; j < evs.length; j++) {
              allEvents.push(evs[j]);
            }
          }
        }
        resolve(allEvents);
        return;
      }

      // Fallback: Legacy monolithic session where key is exactly sessionId
      const legacyReq = store.get(sessionId);
      legacyReq.onsuccess = () => {
        resolve(legacyReq.result ? (legacyReq.result.events || []) : []);
      };
      legacyReq.onerror = () => resolve([]);
    };
    rangeReq.onerror = () => resolve([]);
  } catch (_) {
    resolve([]);
  }
}

export async function deleteSession(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const stores = [STORE_SESSIONS];
    if (db.objectStoreNames.contains(STORE_EVENTS)) stores.push(STORE_EVENTS);
    if (db.objectStoreNames.contains(STORE_CHUNKS)) stores.push(STORE_CHUNKS);

    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    tx.objectStore(STORE_SESSIONS).delete(id);

    if (db.objectStoreNames.contains(STORE_EVENTS)) {
      const eventStore = tx.objectStore(STORE_EVENTS);
      eventStore.delete(id);
      try {
        const prefix = `${id}_c_`;
        const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
        const req = eventStore.getAllKeys(range);
        req.onsuccess = () => {
          const keys = req.result || [];
          keys.forEach(k => eventStore.delete(k));
        };
      } catch (_) {}
    }

    if (db.objectStoreNames.contains(STORE_CHUNKS)) {
      const chunkStore = tx.objectStore(STORE_CHUNKS);
      const index = chunkStore.index('sessionId');
      const req = index.getAllKeys(id);
      req.onsuccess = () => {
        const keys = req.result || [];
        keys.forEach(k => chunkStore.delete(k));
      };
    }
  });
}

export async function clearAllSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const stores = [STORE_SESSIONS];
    if (db.objectStoreNames.contains(STORE_EVENTS)) stores.push(STORE_EVENTS);
    if (db.objectStoreNames.contains(STORE_CHUNKS)) stores.push(STORE_CHUNKS);

    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    stores.forEach(s => tx.objectStore(s).clear());
  });
}
