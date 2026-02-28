// ─── IndexedDB для картинок (единое хранилище для всех сайтов) ────────────────

const DB_NAME = 'ShoppingSorterImages';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openImagesDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function setImage(key, dataUrl) {
    const db = await openImagesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ key, dataUrl, syncedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

async function getImage(key) {
    const db = await openImagesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result?.dataUrl || null);
        req.onerror = e => reject(e.target.error);
    });
}

async function getImages(keys) {
    const db = await openImagesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = {};
        let pending = keys.length;
        if (!pending) { resolve(result); return; }
        keys.forEach(key => {
            const req = store.get(key);
            req.onsuccess = () => {
                if (req.result) result[key] = { dataUrl: req.result.dataUrl, syncedAt: req.result.syncedAt || null };
                if (--pending === 0) resolve(result);
            };
            req.onerror = () => {
                if (--pending === 0) resolve(result);
            };
        });
    });
}

async function deleteImages(keys) {
    const db = await openImagesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        keys.forEach(key => store.delete(key));
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

async function clearImages() {
    const db = await openImagesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

// ─── Обработчик сообщений от content script ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'openSettings') {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    }
    if (msg.action === 'fetchImageAsBase64') {
        fetch(msg.url, { credentials: 'omit' })
            .then(r => r.ok ? r.blob() : Promise.reject('HTTP ' + r.status))
            .then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }))
            .then(dataUrl => sendResponse({ ok: true, dataUrl }))
            .catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
    }
    if (msg.action === 'setImage') {
        // проверяем есть ли уже картинка — не перезаписываем (если не force)
        if (msg.force) {
            setImage(msg.key, msg.dataUrl)
                .then(() => sendResponse({ ok: true }))
                .catch(e => sendResponse({ ok: false, error: e.message }));
        } else {
            getImage(msg.key)
                .then(existing => {
                    if (existing) { sendResponse({ ok: true, skipped: true }); return; }
                    return setImage(msg.key, msg.dataUrl)
                        .then(() => sendResponse({ ok: true }));
                })
                .catch(e => sendResponse({ ok: false, error: e.message }));
        }
        return true;
    }
    if (msg.action === 'getStorageSize') {
        openImagesDB()
            .then(db => new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).getAll();
                req.onsuccess = () => {
                    const bytes = req.result.reduce((sum, r) => sum + (r.dataUrl?.length || 0), 0);
                    const count = req.result.length;
                    resolve({ bytes: Math.round(bytes * 0.75), count }); // base64 → байты
                };
                req.onerror = e => reject(e.target.error);
            }))
            .then(r => sendResponse({ ok: true, ...r }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.action === 'getImages') {
        getImages(msg.keys)
            .then(result => sendResponse({ ok: true, result }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.action === 'deleteImages') {
        deleteImages(msg.keys)
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.action === 'clearImages') {
        clearImages()
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.action === 'pruneImages') {
        // читаем актуальные ключи из chrome.storage.local и удаляем всё лишнее
        chrome.storage.local.get(['savedTiles'], async data => {
            const keepKeys = new Set((data.savedTiles || []).map(t => t.key).filter(Boolean));
            try {
                const db = await openImagesDB();
                const allKeys = await new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readonly');
                    const req = tx.objectStore(STORE_NAME).getAllKeys();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = e => reject(e.target.error);
                });
                const toDelete = allKeys.filter(k => !keepKeys.has(k));
                if (toDelete.length > 0) {
                    const tx2 = db.transaction(STORE_NAME, 'readwrite');
                    const store = tx2.objectStore(STORE_NAME);
                    toDelete.forEach(k => store.delete(k));
                    await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = rej; });
                }
                sendResponse({ ok: true, removed: toDelete.length, kept: keepKeys.size });
            } catch(e) {
                sendResponse({ ok: false, error: e.message });
            }
        });
        return true;
    }
});


// автоочистка при старте и установке
async function autoPruneImages() {
    const data = await chrome.storage.local.get(['savedTiles']);
    const keepKeys = new Set((data.savedTiles || []).map(t => t.key).filter(Boolean));
    const db = await openImagesDB();
    const allKeys = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = e => reject(e.target.error);
    });
    const toDelete = allKeys.filter(k => !keepKeys.has(k));
    if (toDelete.length === 0) return;
    const tx2 = db.transaction(STORE_NAME, 'readwrite');
    const store = tx2.objectStore(STORE_NAME);
    toDelete.forEach(k => store.delete(k));
    await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = rej; });
    console.log(`[ShoppingSorter] pruned ${toDelete.length} orphaned images`);
}

chrome.runtime.onInstalled.addListener(autoPruneImages);
chrome.runtime.onStartup.addListener(autoPruneImages);