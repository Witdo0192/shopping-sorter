// Извлечение полей, идентификаторов и дополнительных атрибутов карточек.
// Использует текущие SELECTORS, SELECTOR_PROFILES, TILE_PROFILE_MAP и seenTiles из content.js.

// Безопасный querySelector: принимает строку или массив селекторов (фоллбэки),
// и не роняет скрипт, если один из селекторов невалиден (например, опечатка
// в настройках сайта) — просто пробует следующий вариант.
function safeQuerySelector(context, sel) {
    if (!sel || !context) return null;
    const selectors = Array.isArray(sel) ? sel : [sel];
    for (const s of selectors) {
        if (!s) continue;
        try {
            // ВАЖНО: selector может описывать сам корень карточки.
            // querySelector() ищет только ПОТОМКОВ, поэтому сначала проверяем self,
            // а уже затем ищем внутри.
            if (context.matches?.(s)) return context;
            const el = context.querySelector(s);
            if (el) return el;
        } catch {
            // невалидный селектор — пропускаем и пробуем следующий фоллбэк
        }
    }
    return null;
}

function getTileTitle(tile) {
    if (!tile) return null;
    const m = getTileMetrics(tile);
    if ('title' in m) return m.title;
    if (tile.dataset.ssTitle) return (m.title = tile.dataset.ssTitle);
    for (const sel of profileFieldSelectors(tile, 'title')) {
        const el = findWithinTileOrSelf(tile, sel);
        if (!el) continue;
        const separator = el.querySelector?.('.product-card__name-separator');
        if (separator) {
            const clone = el.cloneNode(true);
            clone.querySelector('.product-card__name-separator')?.remove();
            return (m.title = clone.textContent.trim());
        }
        return (m.title = el.textContent.trim());
    }
    return (m.title = null);
}

// Универсальное значение элемента для настроек селекторов.
// ВАЖНО: сначала берём видимый текст, как и основной picker/предпросмотр.
// Если текста нет, используем полезные атрибуты — это сохраняет поддержку
// элементов вроде <span data-sku="123"> без расхождения с основным механизмом.
function extractConfiguredElementValue(el) {
    if (!el) return '';
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 120) return text;
    for (const attr of ['data-id','data-product-id','data-productid','data-sku','data-code','content','value']) {
        const v = el.getAttribute?.(attr);
        if (v) return String(v).trim();
    }
    if (el.id) return String(el.id).trim();
    return '';
}

// Для отдельного поля ID сохраняем прежнюю семантику: если у элемента есть
// явный идентификатор, он важнее отображаемого текста.
function extractIdentifierElementValue(el) {
    if (!el) return '';
    for (const attr of ['data-id','data-product-id','data-productid','data-sku','data-code','content','value']) {
        const v = el.getAttribute?.(attr);
        if (v) return String(v).trim();
    }
    if (el.id) return String(el.id).trim();
    return extractConfiguredElementValue(el);
}

function getConfiguredFieldText(tile, field) {
    if (field === 'link') return getTileUrl(tile);
    if (field === 'title') return getTileTitle(tile) || '';
    if (field === 'price') { const v = getPrice(tile); return v === 99999999 ? '' : String(v); }
    if (field === 'rating') { const v = getRating(tile); return v == null ? '' : String(v); }
    if (field === 'reviews') { const v = getReviewsCount(tile); return v == null ? '' : String(v); }
    if (field === 'delivery') { const v = getDeliveryDate(tile); return v == null ? '' : String(v); }
    if (field === 'weight') return String(getWeightFieldText(tile) || '').trim();
    const extra = getExtraTileAttributes(tile);
    if (Object.prototype.hasOwnProperty.call(extra, field)) return extra[field] || '';
    return '';
}

function getTileId(tile) {
    if (!tile) return null;
    if (tile.dataset.ssId) return tile.dataset.ssId;
    const profile = getSelectorProfileForTile(tile);
    const cfg = profile?.idConfig;
    if (cfg?.mode === 'fields' && Array.isArray(cfg.parts) && cfg.parts.length) {
        const vals = cfg.parts.map(part => getConfiguredFieldText(tile, String(part))).map(v => String(v ?? '').trim()).filter(Boolean);
        const value = vals.join(String(cfg.separator ?? ' | '));
        if (value) { tile.dataset.ssId = value; return value; }
    }
    for (const sel of profileFieldSelectors(tile, 'id')) {
        const el = findWithinTileOrSelf(tile, sel);
        const value = extractIdentifierElementValue(el);
        if (value) { tile.dataset.ssId = value; return value; }
    }
    return null;
}

function findAllWithinTileOrSelf(tile, selector) {
    if (!tile || !selector) return [];
    const selectors = selectorValueArray(selector).flatMap(v => String(v).split(/\r?\n/).map(s=>s.trim()).filter(Boolean));
    const found=[]; const seen=new Set();
    for(const sel of selectors){
        try{
            if(tile.matches?.(sel) && !seen.has(tile)){ found.push(tile); seen.add(tile); }
            tile.querySelectorAll?.(sel).forEach(el=>{ if(!seen.has(el)){found.push(el);seen.add(el);} });
        }catch{}
    }
    return found;
}
function getExtraTileAttributes(tile) {
    if (!tile) return {};
    const m = getTileMetrics(tile);
    if (m.extras) return m.extras;
    const profile = getSelectorProfileForTile(tile);
    const out = {};
    for (const item of (profile?.extras || [])) {
        const name = String(item?.name || '').trim();
        const sel = item?.selector;
        if (!name || !sel) continue;
        const els = findAllWithinTileOrSelf(tile, sel);
        const values = els.map(extractConfiguredElementValue).map(v=>String(v||'').trim()).filter(Boolean);
        if (values.length) out[name] = [...new Set(values)].join(' | ');
    }
    return (m.extras = out);
}

function getExtraDefinitions(tileOrTiles=[...seenTiles.values()]) {
    const map = new Map();
    for (const tile of tileOrTiles) {
        const p = getSelectorProfileForTile(tile);
        for (const item of (p?.extras || [])) {
            const name = String(item?.name || '').trim();
            if (!name) continue;
            const kind = item?.kind === 'quantity' ? 'quantity' : 'text';
            if (!map.has(name)) map.set(name, {name, kind, unit:String(item?.unit||'').trim(), values:[]});
            const els = findAllWithinTileOrSelf(tile, item.selector);
            els.map(extractConfiguredElementValue).map(v=>String(v||'').trim()).filter(Boolean).forEach(raw=>map.get(name).values.push(raw));
        }
    }
    return [...map.values()];
}
function parseExtraNumber(raw) {
    if (raw == null) return null;
    const m = String(raw).replace(/\u00A0/g,' ').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
}
function getExtraNumericValues(tile, name) {
    if (!tile) return [];
    const m = getTileMetrics(tile);
    const cacheKey = `extraNum:${String(name)}`;
    if (m[cacheKey]) return m[cacheKey];
    const p = getSelectorProfileForTile(tile);
    const item = (p?.extras || []).find(x => String(x?.name||'').trim() === String(name));
    if (!item) return [];
    return (m[cacheKey] = findAllWithinTileOrSelf(tile, item.selector)
        .map(extractConfiguredElementValue).map(parseExtraNumber).filter(v=>v!=null));
}
function getExtraNumericValue(tile, name) {
    const values=getExtraNumericValues(tile,name);
    return values.length ? values[0] : null;
}

function getTileKey(tile) {
    if (tile.dataset.ssKey) return tile.dataset.ssKey;
    const id = getTileId(tile);
    if (id) { tile.dataset.ssKey = `id:${id}`; return tile.dataset.ssKey; }
    for (const sel of profileFieldSelectors(tile, 'link')) {
        if (sel === CURRENT_PAGE_LINK_SELECTOR) return window.location.pathname || '/';
        const link = findWithinTileOrSelf(tile, sel);
        if (!link) continue;
        const href = link.getAttribute('href');
        if (!href) continue;
        try { return new URL(href, window.location.origin).pathname; }
        catch { return href.split('?')[0].split('#')[0] || null; }
    }
    const name = tile.querySelector?.('span, a')?.textContent?.trim();
    return name || null;
}

function getTileUrl(tile) {
    if (!tile) return '';
    for (const sel of profileFieldSelectors(tile, 'link')) {
        if (sel === CURRENT_PAGE_LINK_SELECTOR) {
            try { return window.location.href; } catch { return ''; }
        }
        const link = findWithinTileOrSelf(tile, sel);
        const href = link?.getAttribute?.('href');
        if (href) {
            try { return new URL(href, window.location.origin).href; } catch { return href; }
        }
    }
    return '';
}

function isTileValid(tile) {
    const hasTitle = !!getTileTitle(tile);
    const hasPrice = getPrice(tile) !== 99999999;
    return hasTitle && hasPrice;
}
