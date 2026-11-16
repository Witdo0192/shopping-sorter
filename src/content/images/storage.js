// Получение изображения и сообщения к background для сохранения/чтения.
// IndexedDB остаётся в background.js; формат сообщений не меняется.

// ─── Главная функция ───────────────────────────────────────────────────────────
async function imgToBase64(src) {
    if (!src || src.startsWith('data:')) return src;
    // Пробуем напрямую
    try {
        const resp = await fetch(src, { credentials: 'omit' });
        if (resp.ok) {
            const blob = await resp.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    } catch { }
    // Fallback через background (обходит CORS)
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'fetchImageAsBase64', url: src }, resp => {
            resolve(resp?.dataUrl || null);
        });
    });
}

async function saveImageToBackground(key, src, force = false) {
    const dataUrl = await imgToBase64(src);
    if (!dataUrl) return null;
    chrome.runtime.sendMessage({ action: 'setImage', key, dataUrl, force });
    // обновляем syncedAt в метаданных
    getSavedTiles().then(tiles => {
        const idx = tiles.findIndex(t => t.key === key);
        if (idx === -1) return;
        tiles[idx] = { ...tiles[idx], syncedAt: Date.now() };
        saveTiles(tiles);
    });
    return dataUrl;
}

async function loadImagesFromBackground(keys) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'getImages', keys }, resp => {
            resolve(resp?.result || {});
        });
    });
}
