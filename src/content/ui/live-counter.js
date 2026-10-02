// Счётчик найденных карточек и список причин отбраковки.
// Флаги и данные счётчика принадлежат runtime в content.js.
function ensureLiveCounterEl() {
    if (liveCounterEl && document.body?.contains(liveCounterEl)) return liveCounterEl;
    if (!document.body) return null;
    liveCounterEl = document.createElement('div');
    liveCounterEl.id = 'ss-live-counter-badge';
    liveCounterEl.style.cssText = `
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
        background: rgba(33,33,33,0.85); color: #fff; padding: 6px 12px;
        border-radius: 20px; font: 12px/1.4 -apple-system, sans-serif;
        cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        user-select: none; white-space: nowrap;
    `;
    liveCounterEl.title = 'Клик — показать карточки, которые не удалось распознать';
    liveCounterEl.addEventListener('click', toggleRejectedPanel);
    document.body.appendChild(liveCounterEl);
    return liveCounterEl;
}

function getCurrentDomTileCount() {
    const profiles = SELECTOR_PROFILES.length ? SELECTOR_PROFILES : normalizeSelectorProfiles(SELECTORS);
    const seen = new Set();
    for (const profile of profiles || []) {
        for (const sel of selectorValueArray(profile?.tile)) {
            try { document.querySelectorAll(sel).forEach(el => seen.add(el)); } catch { }
        }
    }
    return seen.size;
}

function updateLiveCounterBadge() {
    if (!extensionEnabled || !liveCounterEnabled || !siteKnownInDatabase) {
        if (liveCounterEl) { liveCounterEl.remove(); liveCounterEl = null; }
        if (rejectedPanelEl) { rejectedPanelEl.remove(); rejectedPanelEl = null; }
        return;
    }
    const el = ensureLiveCounterEl();
    if (!el) return; // document.body ещё не готов — попробуем на следующем вызове
    const rejectedCount = lastRejectedTiles.length;
    const currentDomCount = getCurrentDomTileCount();
    el.textContent = rejectedCount > 0
        ? `🔎 Всего: ${seenTiles.size} · сейчас: ${currentDomCount} · ⚠️ отбраковано: ${rejectedCount}`
        : `🔎 Всего: ${seenTiles.size} · сейчас: ${currentDomCount}`;
    if (rejectedPanelEl) renderRejectedPanel(); // если панель открыта — обновляем её содержимое
}

function toggleRejectedPanel() {
    if (rejectedPanelEl) {
        rejectedPanelEl.remove();
        rejectedPanelEl = null;
        return;
    }
    rejectedPanelEl = document.createElement('div');
    rejectedPanelEl.id = 'ss-rejected-panel';
    rejectedPanelEl.style.cssText = `
        position: fixed; bottom: 54px; right: 16px; z-index: 2147483647;
        background: #fff; color: #222; width: 320px; max-height: 420px;
        overflow-y: auto; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.35);
        font: 12px/1.45 -apple-system, sans-serif; padding: 10px;
    `;
    document.body.appendChild(rejectedPanelEl);
    renderRejectedPanel();
}

function renderRejectedPanel() {
    if (!rejectedPanelEl) return;
    rejectedPanelEl.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; font-weight:bold;';
    const headerText = document.createElement('span');
    headerText.textContent = lastRejectedTiles.length > 0
        ? `Не распознано: ${lastRejectedTiles.length}`
        : 'Сейчас всё распознано ✅';
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'cursor:pointer; opacity:0.5; padding:0 2px;';
    closeBtn.addEventListener('click', () => { rejectedPanelEl.remove(); rejectedPanelEl = null; });
    header.appendChild(headerText);
    header.appendChild(closeBtn);
    rejectedPanelEl.appendChild(header);

    if (lastRejectedTiles.length === 0) {
        const ok = document.createElement('div');
        ok.style.cssText = 'color:#4CAF50;';
        ok.textContent = 'Все карточки, которые сейчас есть на странице, успешно распознаны.';
        rejectedPanelEl.appendChild(ok);
        return;
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#888; margin-bottom:8px;';
    hint.textContent = 'Клик по строке — прокрутить к карточке и подсветить её.';
    rejectedPanelEl.appendChild(hint);

    lastRejectedTiles.forEach(({ tile, reasons, snippet }) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:7px 4px; border-top:1px solid #eee; cursor:pointer;';
        const reasonEl = document.createElement('div');
        reasonEl.style.cssText = 'color:#c62828; font-weight:600;';
        reasonEl.textContent = reasons.join(', ');
        const snippetEl = document.createElement('div');
        snippetEl.style.cssText = 'color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        snippetEl.textContent = snippet;
        row.appendChild(reasonEl);
        row.appendChild(snippetEl);
        row.addEventListener('click', () => {
            if (!document.body.contains(tile)) return; // карточка могла уже исчезнуть со страницы
            tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prevOutline = tile.style.outline;
            const prevOffset = tile.style.outlineOffset;
            tile.style.outline = '3px solid #e53935';
            tile.style.outlineOffset = '2px';
            setTimeout(() => {
                tile.style.outline = prevOutline;
                tile.style.outlineOffset = prevOffset;
            }, 1600);
        });
        rejectedPanelEl.appendChild(row);
    });
}
