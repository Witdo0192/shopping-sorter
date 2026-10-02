// Метаданные сохранённых товаров, обновление данных и существующая миграция.
// Зависит от функций товаров и кэша savedKeysCache; запуск миграции остаётся в content.js.

// ─── Хранилище сохранённых товаров ────────────────────────────────────────────
async function getSavedTiles() {
    return new Promise(resolve => {
        chrome.storage.local.get(['savedTiles'], data => {
            resolve(data.savedTiles || []);
        });
    });
}

async function saveTiles(tiles) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ savedTiles: tiles }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        });
    });
}

async function addToSaved(newItems) {
    const existing = await getSavedTiles();
    const existingKeys = new Set(existing.map(t => t.key));
    const toAdd = newItems.filter(t => !existingKeys.has(t.key));
    await saveTiles([...existing, ...toAdd]);
    toAdd.forEach(t => savedKeysCache.add(t.key));
    refreshSavedKeysCache();
    window._invalidateGroupCache?.();
    return toAdd.length;
}

async function removeFromSaved(keys) {
    const existing = await getSavedTiles();
    await saveTiles(existing.filter(t => !keys.has(t.key)));
    chrome.runtime.sendMessage({ action: 'deleteImages', keys: [...keys] });
    keys.forEach(k => savedKeysCache.delete(k));
    refreshSavedKeysCache();
    window._invalidateGroupCache?.();
}

// ─── Автообновление цены/рейтинга/отзывов/доставки сохранённых из текущего поиска ─
// Если сохранённый товар встречается среди текущих результатов поиска — подтягиваем
// актуальные цену/рейтинг/отзывы/дату доставки, т.к. они меняются со временем.
const pendingSavedDataUpdates = new Map(); // key → {price, rating, reviews, delivery}
let _savedDataUpdateTimer = null;

function queueSavedDataUpdate(key, data) {
    if (!savedKeysCache.has(key)) return;
    pendingSavedDataUpdates.set(key, data);
    clearTimeout(_savedDataUpdateTimer);
    _savedDataUpdateTimer = setTimeout(flushSavedDataUpdates, 1000);
}

function patchSavedItemHtml(html, data, currency) {
    if (!html) return html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    if (!el) return html;
    applySavedDataToTileEl(el, data, currency);
    return tmp.innerHTML;
}

function updateSavedTileDom(key, item) {
    const tileEl = document.querySelector(`#products-sorted-popup .ss-tile[data-ss-key="${CSS.escape(key)}"]`);
    if (!tileEl) return;
    applySavedDataToTileEl(tileEl, item, detectCurrency());
}

async function flushSavedDataUpdates() {
    if (!pendingSavedDataUpdates.size) return;
    const updates = new Map(pendingSavedDataUpdates);
    pendingSavedDataUpdates.clear();

    const saved = await getSavedTiles();
    const currency = detectCurrency();
    let changed = false;
    const touched = [];

    const next = saved.map(item => {
        const upd = updates.get(item.key);
        if (!upd) return item;

        const newPrice = (upd.price != null && upd.price < 99999999) ? upd.price : (item.price ?? null);
        const newRating = upd.rating ?? null;
        const newReviews = upd.reviews ?? null;
        const newDelivery = upd.delivery ?? null;

        const samePrice = newPrice === (item.price ?? null);
        const sameRating = newRating === (item.rating ?? null);
        const sameReviews = newReviews === (item.reviews ?? null);
        const sameDelivery = newDelivery === (item.delivery ?? null);
        if (samePrice && sameRating && sameReviews && sameDelivery) return item;

        changed = true;
        touched.push(item.key);
        const updatedItem = {
            ...item,
            price: newPrice,
            rating: newRating,
            reviews: newReviews,
            delivery: newDelivery,
            dataUpdatedAt: Date.now(),
        };
        updatedItem.html = patchSavedItemHtml(item.html, updatedItem, currency);
        return updatedItem;
    });

    if (!changed) return;
    await saveTiles(next);
    const nextByKey = new Map(next.map(t => [t.key, t]));
    touched.forEach(key => updateSavedTileDom(key, nextByKey.get(key)));
}

// Миграция: вырезаем base64 из старых html, переносим картинки в IndexedDB
async function migrateBase64FromHtml() {
    return new Promise(resolve => {
        chrome.storage.local.get(['savedTiles', 'ssBase64Migrated'], async data => {
            if (data.ssBase64Migrated || !data.savedTiles?.length) { resolve(); return; }
            let changed = false;
            const migrated = data.savedTiles.map(item => {
                if (!item.html || !item.html.includes('data:image')) return item;
                const tmp = document.createElement('div');
                tmp.innerHTML = item.html;
                const img = tmp.querySelector('img[src^="data:"]');
                if (img && item.key) {
                    // отправляем картинку в IndexedDB
                    chrome.runtime.sendMessage({ action: 'setImage', key: item.key, dataUrl: img.src });
                    // заменяем на заглушку
                    img.src = '';
                    img.removeAttribute('src');
                    changed = true;
                }
                return { ...item, html: tmp.innerHTML };
            });
            if (changed) {
                await new Promise(r => chrome.storage.local.set({ savedTiles: migrated, ssBase64Migrated: true }, r));
                console.log('[ShoppingSorter] Миграция base64 завершена');
            } else {
                chrome.storage.local.set({ ssBase64Migrated: true });
            }
            resolve();
        });
    });
}
