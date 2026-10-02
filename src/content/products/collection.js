// Сбор карточек, кэш сохранённых ключей и наблюдение за изображениями.
// Связывает поля товаров, настройки сайта, счётчик и сохранённые метаданные.

const watchedTiles = new Set(); // ключи плиток за которыми уже следим
const savedKeysCache = new Set(); // кэш ключей сохранённых карточек

// обновляем кэш при старте и после любых изменений в savedTiles
let _refreshCacheTimer = null;
function refreshSavedKeysCache() {
    clearTimeout(_refreshCacheTimer);
    _refreshCacheTimer = setTimeout(() => {
        getSavedTiles().then(saved => {
            savedKeysCache.clear();
            saved.forEach(s => savedKeysCache.add(s.key));
            // обновляем значки «сохранено» в поиске без перерендера
            const popup = document.getElementById('products-sorted-popup');
            if (!popup) return;
            popup.querySelectorAll('.products-grid:not(.saved-grid) > div').forEach(wrap => {
                const key = wrap.dataset.tileKey || wrap.querySelector('[data-ss-key]')?.dataset.ssKey;
                if (!key) return;
                let badgeWrap = wrap.querySelector('.ss-saved-indicator-wrap');
                if (savedKeysCache.has(key) && !badgeWrap) {
                    badgeWrap = document.createElement('div');
                    badgeWrap.className = 'ss-saved-indicator-wrap';
                    badgeWrap.style.cssText = 'position:absolute; top:6px; right:6px; z-index:25; pointer-events:none;';
                    const badge = document.createElement('div');
                    badge.className = 'ss-saved-indicator';
                    badge.style.cssText = 'background:#4CAF50; color:white; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:13px; box-shadow:0 1px 4px rgba(0,0,0,0.3);';
                    badge.textContent = '\u{1F516}';
                    badgeWrap.appendChild(badge);
                    wrap.appendChild(badgeWrap);
                } else if (!savedKeysCache.has(key) && badgeWrap) {
                    badgeWrap.remove();
                }
            });
        });
    }, 50); // debounce — предотвращает дублирование при двойном вызове
}

function watchTileImage(tile, key) {
    if (watchedTiles.has(key)) return;
    watchedTiles.add(key);
    const imgEl = tile.querySelector('img');
    if (!imgEl) return;

    function onImageUpdate() {
        const src = (imgEl.naturalWidth > 10 && imgEl.currentSrc)
            ? imgEl.currentSrc
            : imgEl.src || imgEl.dataset?.src || imgEl.dataset?.url || '';
        if (!src || src.startsWith('data:') || src === imgEl.dataset._lastSrc) return;
        if (src.includes('placeholder') || src.includes('blur') || src.includes('tiny')) return;
        imgEl.dataset._lastSrc = src;
        // обновляем clone в seenTiles всегда
        const clone = tile.cloneNode(true);
        clone.style.width = '';
        clone.style.marginRight = '';
        seenTiles.set(key, clone);
        // картинку в IndexedDB сохраняем ТОЛЬКО если карточка есть в сохранённых
        if (!savedKeysCache.has(key)) return;
        saveImageToBackground(key, src, true).then(dataUrl => {
            if (!dataUrl) return;
            const savedTileEl = document.querySelector(`#products-sorted-popup .ss-tile[data-ss-key="${CSS.escape(key)}"]`);
            if (savedTileEl) {
                const wrap = savedTileEl.querySelector('.ss-tile__img-wrap');
                if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
            }
        });
    }

    const obs = new MutationObserver(onImageUpdate);
    obs.observe(imgEl, { attributes: true, attributeFilter: ['src', 'data-src', 'srcset'] });
    imgEl.addEventListener('load', onImageUpdate);
}

function collectTiles() {
    if (!SELECTOR_PROFILES.length && !SELECTORS) return;
    let newKeys = [];
    const rejectedNow = [];
    const seenDomTiles = new Set();

    const profileEntries = SELECTOR_PROFILES.length
        ? SELECTOR_PROFILES
        : normalizeSelectorProfiles(SELECTORS);

    profileEntries.forEach(profile => {
        for (const tileSel of selectorValueArray(profile.tile)) {
            let nodes = [];
            try { nodes = [...document.querySelectorAll(tileSel)]; } catch { continue; }

            nodes.forEach(tile => {
                if (seenDomTiles.has(tile)) return;
                seenDomTiles.add(tile);
                TILE_PROFILE_MAP.set(tile, profile);
                delete tile.dataset.ssId; delete tile.dataset.ssKey; delete tile.dataset.ssUrl;

                const key = getTileKey(tile);
                if (!key) {
                    rejectedNow.push({
                        tile,
                        reasons: ['нет ключа (не нашли ссылку/идентификатор для этой карточки)'],
                        snippet: (tile.textContent || '').trim().slice(0, 60) || '(пусто)',
                    });
                    return;
                }

                const validNow = isTileValid(tile);
                if (validNow) {
                    // Важно: карточки SPA часто получают рейтинг/отзывы/цену уже ПОСЛЕ
                    // первого появления. Поэтому обновляем сохранённую копию даже когда
                    // такой ключ уже был найден ранее. Иначе поиск продолжал показывать
                    // старую DOM-копию без дорисованных атрибутов.
                    tile.querySelectorAll('img[data-url]').forEach(img => { img.src = img.dataset.url; });
                    const oldClone = seenTiles.get(key);
                    const shouldUpdate = !oldClone
                        || !isTileValid(oldClone)
                        || getRating(tile) !== getRating(oldClone)
                        || getReviewsCount(tile) !== getReviewsCount(oldClone)
                        || getDeliveryDate(tile) !== getDeliveryDate(oldClone)
                        || getPrice(tile) !== getPrice(oldClone)
                        || getTileTitle(tile) !== getTileTitle(oldClone)
                        || JSON.stringify(getExtraTileAttributes(tile)) !== JSON.stringify(getExtraTileAttributes(oldClone));
                    if (shouldUpdate) {
                        const clone = tile.cloneNode(true);
                        clone.style.width = '';
                        clone.style.marginRight = '';
                        TILE_PROFILE_MAP.set(clone, profile);
                        seenTiles.set(key, clone);
                        if (!oldClone) newKeys.push(key);
                    }
                } else if (!seenTiles.has(key)) {
                    const reasons = [];
                    if (!getTileTitle(tile)) reasons.push('нет названия');
                    if (getPrice(tile) === 99999999) reasons.push('нет цены');
                    rejectedNow.push({
                        tile,
                        reasons: reasons.length ? reasons : ['не прошла проверку (неизвестная причина)'],
                        snippet: getTileTitle(tile) || (tile.textContent || '').trim().slice(0, 60) || '(пусто)',
                    });
                }

                watchTileImage(tile, key);
                if (savedKeysCache.has(key)) {
                    queueSavedDataUpdate(key, {
                        price: getPrice(tile),
                        rating: getRating(tile),
                        reviews: getReviewsCount(tile),
                        delivery: getDeliveryDate(tile),
                    });
                }
            });
        }
    });

    lastRejectedTiles = rejectedNow;
    if (newKeys.length > 0) refreshSearchBadgesInSaved([...new Set(newKeys)]);
    updateLiveCounterBadge();
}

function refreshSearchBadgesInSaved(keys) {
    const popup = document.getElementById('products-sorted-popup');
    if (!popup) return;
    const savedGrid = popup.querySelector('.saved-grid');
    if (!savedGrid) return;
    keys.forEach(key => {
        const tileEl = savedGrid.querySelector(`.ss-tile[data-ss-key="${CSS.escape(key)}"]`);
        if (!tileEl) return;
        if (!tileEl.querySelector('.ss-search-indicator')) {
            const badge = document.createElement('div');
            badge.className = 'ss-search-indicator';
            badge.textContent = '🔍';
            badge.style.cssText = `
                position:absolute; top:6px; right:6px; z-index:25;
                background:#2196F3; color:white; border-radius:50%;
                width:22px; height:22px; display:flex; align-items:center;
                justify-content:center; font-size:12px;
                box-shadow:0 1px 4px rgba(0,0,0,0.3); pointer-events:none;
            `;
            tileEl.appendChild(badge);
        }
    });
}
