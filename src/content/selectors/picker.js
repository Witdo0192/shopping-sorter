// Интерфейс подбора селекторов, подсветка и обработка взаимодействия со страницей.
// Точка входа: openSelectorPickerPanel(hooks). Зависимости перечислены в docs/code-map.md.

// ════════════════════════════════════════════════════════════════════════
// ─── Визуальный подбор селекторов сайта (Selector Picker) ─────────────────
// Позволяет прямо на странице кликнуть по карточке товара и её атрибутам
// (название/цена/рейтинг/отзывы/доставка/ссылка), получить рабочий
// CSS-селектор, уточнить его вручную, подсветить совпадения на странице и
// увидеть извлечённые значения для проверки — после чего сохранить
// конфигурацию сайта.
// ════════════════════════════════════════════════════════════════════════

const PICKER_FIELDS = [
    { key: 'tile', label: '🧩 Карточка (тайл)', color: '#2196F3', hint: 'Весь блок одного товара, повторяется в сетке', required: true, multi: false },
    { key: 'link', label: '🔗 Ссылка на товар', color: '#e91e63', hint: 'Обычно <a> с href', required: false, multi: false },
    { key: 'id', label: '🆔 ID товара', color: '#3F51B5', hint: 'Отдельный идентификатор для защиты от дубликатов; можно указать элемент с data-id/id/value', required: false, multi: false },
    { key: 'title', label: '📝 Название', color: '#4CAF50', hint: '', required: false, multi: false },
    { key: 'price', label: '💰 Цена', color: '#FF9800', hint: 'Можно несколько вариантов — по одному на строку', required: false, multi: true },
    { key: 'rating', label: '⭐ Рейтинг', color: '#9C27B0', hint: '', required: false, multi: false },
    { key: 'reviews', label: '💬 Отзывы', color: '#009688', hint: '', required: false, multi: false },
    { key: 'delivery', label: '🚚 Доставка', color: '#795548', hint: '', required: false, multi: false },
    { key: 'weight', label: '⚖️ Вес/объём в названии', color: '#607D8B', hint: 'Обычно не нужен — берётся из названия', required: false, multi: false },
];

function pickerCfgFieldToText(v) {
    if (Array.isArray(v)) return v.filter(Boolean).join('\n');
    return v || '';
}
function pickerParseMultiline(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return lines[0] || '';
    return lines;
}

// Простой сегмент селектора для одного элемента: атрибут → id → один устойчивый класс → тег
function pickerBuildSegment(el) {
    if (!el || el.nodeType !== 1) return '*';
    const tag = el.tagName.toLowerCase();
    for (const attr of ['data-testid', 'data-test', 'data-widget', 'data-marker', 'data-qa', 'data-cy']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) { try { return `${tag}[${attr}="${CSS.escape(v)}"]`; } catch { } }
    }
    if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id) && !/\d{4,}/.test(el.id)) {
        try { return `#${CSS.escape(el.id)}`; } catch { }
    }
    const stable = [...el.classList].filter(cls =>
        cls.length > 1 && cls.length < 60 && !/\d{3,}/.test(cls) && !/^[_\d]/.test(cls)
    );
    const noMod = stable.filter(c => !c.includes('--'));
    const chosen = (noMod.length ? noMod : stable)[0];
    if (chosen) { try { return `${tag}.${CSS.escape(chosen)}`; } catch { } }
    return tag;
}

// Селектор для повторяющейся карточки (ищем вариант, который встречается на странице несколько раз)
function pickerFindTileSelector(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];
    for (const attr of ['data-testid', 'data-test', 'data-widget', 'data-marker', 'data-qa', 'data-cy', 'data-index']) {
        if (el.hasAttribute && el.hasAttribute(attr)) candidates.push(`${tag}[${attr}]`);
    }
    [...el.classList].filter(c => c.length > 1 && c.length < 60 && !/\d{3,}/.test(c) && !/^[_\d]/.test(c))
        .forEach(c => { try { candidates.push(`${tag}.${CSS.escape(c)}`); } catch { } });
    candidates.push(tag);
    let best = null, bestCount = 0;
    for (const sel of candidates) {
        let n = 0;
        try { n = document.querySelectorAll(sel).length; } catch { continue; }
        if (n >= 2) return sel; // нашли повторяющийся паттерн — этого достаточно
        if (n > bestCount) { best = sel; bestCount = n; }
    }
    return best || tag;
}

// Селектор для элемента внутри карточки, относительно её корня
function pickerBuildRelativeSelector(el, root) {
    // Если выбран сам корень карточки (например <a> является всей карточкой),
    // нужен валидный селектор, который совпадает с root.
    if (!root) return '';
    if (el === root) return ':scope';
    const chain = [];
    let cur = el;
    let guard = 0;
    while (cur && cur !== root && cur.parentElement && guard < 8) {
        chain.unshift(pickerBuildSegment(cur));
        const candidate = chain.join(' > ');
        try {
            if (root.querySelector(candidate) === el) return candidate;
        } catch { }
        cur = cur.parentElement;
        guard++;
    }
    return chain.join(' > ') || pickerBuildSegment(el);
}

function getConfiguredElementsForTile(tile, selectorText) {
    if (!tile || !selectorText) return [];
    const selectors = Array.isArray(selectorText)
        ? selectorText
        : String(selectorText).split(/\n/).map(s => s.trim()).filter(Boolean);
    const found = [];
    const seen = new Set();
    for (const sel of (selectors.length ? selectors : [selectorText])) {
        try {
            if (tile.matches?.(sel) && !seen.has(tile)) { found.push(tile); seen.add(tile); }
            tile.querySelectorAll?.(sel).forEach(el => { if (!seen.has(el)) { found.push(el); seen.add(el); } });
        } catch { }
    }
    return found;
}

function pickerValidateField(fieldKey, selectorText, tileSelector) {
    if (fieldKey === 'tile') {
        let n = 0;
        try { n = selectorText ? document.querySelectorAll(selectorText).length : 0; } catch { return { count: 0, total: 0, previews: [], error: 'Неверный селектор' }; }
        return { count: n, total: n, previews: [] };
    }
    if (!selectorText || !tileSelector) return { count: 0, total: 0, previews: [] };
    let tiles = [];
    try { tiles = [...document.querySelectorAll(tileSelector)]; } catch { return { count: 0, total: 0, previews: [], error: 'Неверный селектор карточки' }; }
    let matched = 0;
    const previews = [];
    for (const t of tiles.slice(0, 40)) {
        const els = getConfiguredElementsForTile(t, selectorText);
        const found = els.find(el => fieldKey === 'link' ? !!(el.getAttribute?.('href') || '') : !!((el.textContent || '').trim()));
        if (found) {
            matched++;
            const val = fieldKey === 'link' ? (found.getAttribute('href') || '') : (found.textContent || '').trim();
            if (previews.length < 5) previews.push(val.slice(0, 90));
        }
    }
    return { count: matched, total: tiles.length, previews };
}

// ── подсветка на странице ──
let _pickerActiveHighlights = new Map(); // key -> {color, getEls}
let _pickerHighlightBoxes = [];
let _pickerScrollHandlerRef = null;

function pickerClearHighlightBoxes() {
    _pickerHighlightBoxes.forEach(b => b.remove());
    _pickerHighlightBoxes = [];
}
function pickerDrawBoxes(els, color) {
    els.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const box = document.createElement('div');
        box.style.cssText = `position:fixed; left:${r.left}px; top:${r.top}px; width:${r.width}px; height:${r.height}px;
            border:2px solid ${color}; background:${color}26; pointer-events:none; z-index:2147483647;
            border-radius:3px; box-sizing:border-box;`;
        document.body.appendChild(box);
        _pickerHighlightBoxes.push(box);
    });
}
function pickerRedrawHighlights() {
    pickerClearHighlightBoxes();
    for (const { color, getEls } of _pickerActiveHighlights.values()) {
        try { pickerDrawBoxes(getEls(), color); } catch { }
    }
}
function pickerEnsureScrollSync() {
    if (_pickerScrollHandlerRef) return;
    let raf = null;
    _pickerScrollHandlerRef = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = null; pickerRedrawHighlights(); });
    };
    window.addEventListener('scroll', _pickerScrollHandlerRef, true);
    window.addEventListener('resize', _pickerScrollHandlerRef);
}
function pickerTeardownScrollSync() {
    if (_pickerScrollHandlerRef) {
        window.removeEventListener('scroll', _pickerScrollHandlerRef, true);
        window.removeEventListener('resize', _pickerScrollHandlerRef);
        _pickerScrollHandlerRef = null;
    }
}

// ── режим «кликни по элементу» ──
let _pickerActive = false;
let _pickerHoverBox = null;
let _pickerOnPick = null;
let _pickerOnCancel = null;

function pickerStartPicking(opts) {
    const onPick = typeof opts === 'function' ? opts : opts?.onPick;
    const onCancel = typeof opts === 'function' ? null : opts?.onCancel;
    if (_pickerActive) pickerStopPicking({ invokeCancel: true });
    _pickerActive = true;
    _pickerOnPick = onPick;
    _pickerOnCancel = onCancel;
    document.body.style.cursor = 'crosshair';
    _pickerHoverBox = document.createElement('div');
    _pickerHoverBox.style.cssText = `position:fixed; pointer-events:none; z-index:2147483647;
        border:2px solid #2196F3; background:rgba(33,150,243,0.18); border-radius:3px; box-sizing:border-box;`;
    document.body.appendChild(_pickerHoverBox);
    document.addEventListener('mousemove', pickerOnMouseMove, true);
    document.addEventListener('click', pickerOnClick, true);
    document.addEventListener('keydown', pickerOnKeyDown, true);
}

function pickerStopPicking({ invokeCancel = true } = {}) {
    const cancel = _pickerOnCancel;
    _pickerActive = false;
    _pickerOnPick = null;
    _pickerOnCancel = null;
    document.body.style.cursor = '';
    _pickerHoverBox?.remove();
    _pickerHoverBox = null;
    document.removeEventListener('mousemove', pickerOnMouseMove, true);
    document.removeEventListener('click', pickerOnClick, true);
    document.removeEventListener('keydown', pickerOnKeyDown, true);
    if (invokeCancel) {
        try { cancel?.(); } catch { }
    }
}

function pickerOnMouseMove(e) {
    if (!_pickerActive || !_pickerHoverBox) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('#ss-picker-panel') || el.closest('#ss-picker-choice')) {
        _pickerHoverBox.style.display = 'none';
        return;
    }
    _pickerHoverBox.style.display = '';
    const r = el.getBoundingClientRect();
    _pickerHoverBox.style.left = r.left + 'px';
    _pickerHoverBox.style.top = r.top + 'px';
    _pickerHoverBox.style.width = r.width + 'px';
    _pickerHoverBox.style.height = r.height + 'px';
}

function pickerOnClick(e) {
    if (!_pickerActive) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('#ss-picker-panel') || el.closest('#ss-picker-choice')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const cb = _pickerOnPick;
    pickerStopPicking({ invokeCancel: false });
    cb?.(el);
}

function pickerOnKeyDown(e) {
    if (e.key === 'Escape') pickerStopPicking({ invokeCancel: true });
}

function pickerElLabel(el) {
    if (!el || el.nodeType !== 1) return 'Элемент';
    const tag = el.tagName.toLowerCase();
    let extra = '';
    if (el.id) extra += `#${el.id}`;
    const cls = [...el.classList].filter(c => c.length > 1 && c.length < 34 && !/\d{3,}/.test(c)).slice(0, 2);
    if (cls.length) extra += '.' + cls.join('.');
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    return `${tag}${extra}${text ? ` — ${text}` : ''}`;
}

function pickerIsStableClass(c) {
    return !!c && c.length > 1 && c.length < 60 && !/\d{3,}/.test(c) && !/^[_\d]/.test(c) && !c.includes('--');
}

function pickerAttrCandidate(el, tag) {
    const attrs = ['data-testid', 'data-test', 'data-widget', 'data-marker', 'data-qa', 'data-cy', 'name', 'role'];
    for (const attr of attrs) {
        const v = el.getAttribute?.(attr);
        if (!v || v.length > 100) continue;
        try { return `${tag}[${attr}="${CSS.escape(v)}"]`; } catch { }
    }
    return null;
}

function pickerBuildCandidates(el, root, fieldKey) {
    if (!el || el.nodeType !== 1) return [];
    const tag = el.tagName.toLowerCase();
    const out = [];
    const add = (selector, reason = '') => {
        if (!selector || out.some(x => x.selector === selector)) return;
        out.push({ selector, reason });
    };

    if (el === root) add(':scope', 'сам корень карточки');

    const attr = pickerAttrCandidate(el, tag);
    if (attr) add(attr, 'стабильный атрибут');

    if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id) && !/\d{4,}/.test(el.id)) {
        try { add(`#${CSS.escape(el.id)}`, 'id'); } catch { }
    }

    const stableClasses = [...el.classList].filter(pickerIsStableClass);
    if (fieldKey === 'link' && tag === 'a' && el.hasAttribute('href')) {
        add('a[href]', 'универсальная ссылка карточки');
        if (stableClasses.length) {
            try { add(`a.${CSS.escape(stableClasses[0])}[href]`, 'класс + href'); } catch { }
            if (stableClasses.length > 1) {
                try { add(`a.${CSS.escape(stableClasses[0])}.${CSS.escape(stableClasses[1])}[href]`, 'два класса + href'); } catch { }
            }
        }
    }

    if (stableClasses.length) {
        try { add(`${tag}.${CSS.escape(stableClasses[0])}`, 'стабильный класс'); } catch { }
        if (stableClasses.length > 1) {
            try { add(`${tag}.${CSS.escape(stableClasses[0])}.${CSS.escape(stableClasses[1])}`, 'два стабильных класса'); } catch { }
        }
    }
    add(tag, 'тег');

    // Относительный путь от карточки до выбранного узла — более точный, чем голый тег.
    if (root && el !== root) {
        const chain = [];
        let cur = el;
        let guard = 0;
        while (cur && cur !== root && cur.parentElement && guard < 8) {
            const seg = pickerBuildSegment(cur);
            chain.unshift(seg);
            add(chain.join(' > '), 'путь внутри карточки');
            cur = cur.parentElement;
            guard++;
        }
    }

    return out.slice(0, 14);
}

function pickerFindInTile(t, selector) {
    if (!t || !selector) return null;
    try {
        if (selector === ':scope') return t;
        if (t.matches?.(selector)) return t;
        return t.querySelector(selector);
    } catch { return null; }
}

function pickerScoreCandidate(selector, tiles, targetEl, root) {
    // Для карточки (root не задан) оцениваем селектор по повторяемости на всей странице.
    if (!root) {
        let nodes = [];
        try { nodes = [...document.querySelectorAll(selector)]; } catch { return null; }
        if (!nodes.length) return null;
        const count = nodes.length;
        const targetExact = (nodes.includes(targetEl) && count >= 2) ? 1 : 0;
        const repeatScore = count >= 2 ? Math.min(count / 24, 1) : 0.02;
        const tooGenericPenalty = count > 300 ? Math.min((count - 300) / 300, 1) : 0;
        return {
            coverage: repeatScore,
            precision: targetExact,
            ambiguityPenalty: tooGenericPenalty,
            targetExact,
            count
        };
    }

    let tilesWith = 0, exact = 0, ambiguous = 0;
    for (const t of tiles.slice(0, 80)) {
        let count = 0;
        try {
            if (selector === ':scope') count = 1;
            else {
                if (t.matches?.(selector)) count++;
                count += t.querySelectorAll(selector).length;
            }
        } catch { return null; }
        if (count > 0) tilesWith++;
        if (count === 1) exact++;
        if (count > 1) ambiguous++;
    }
    const limit = Math.min(tiles.length, 80);
    const coverage = tiles.length ? tilesWith / limit : 0;
    const precision = tiles.length ? exact / limit : 0;
    const ambiguityPenalty = ambiguous / Math.max(1, limit);
    let targetExact = 0;
    try {
        targetExact = pickerFindInTile(root, selector) === targetEl ? 1 : 0;
    } catch { }
    return { coverage, precision, ambiguityPenalty, targetExact };
}

function pickerRankCandidates(candidates, tiles, targetEl, root) {
    return candidates.map(c => {
        const score = pickerScoreCandidate(c.selector, tiles, targetEl, root);
        if (!score) return null;
        const rank = score.targetExact * 1000 + score.coverage * 100 + score.precision * 30 - score.ambiguityPenalty * 45;
        return { ...c, ...score, rank };
    }).filter(Boolean).sort((a, b) => b.rank - a.rank).slice(0, 7);
}

function pickerGetPath(el, root) {
    const arr = [];
    let cur = el;
    let guard = 0;
    while (cur && cur.nodeType === 1 && guard < 10) {
        arr.push(cur);
        if (cur === root) break;
        cur = cur.parentElement;
        guard++;
    }
    return arr;
}

function pickerRemoveChoice() {
    const el = document.getElementById('ss-picker-choice');
    el?._pickerChoiceCleanup?.();
    el?.remove();
    pickerHideTreeHover();
}

let _pickerTreeHoverBox = null;
function pickerShowTreeHover(el) {
    pickerHideTreeHover();
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    _pickerTreeHoverBox = document.createElement('div');
    _pickerTreeHoverBox.style.cssText = `position:fixed; left:${r.left}px; top:${r.top}px; width:${r.width}px; height:${r.height}px;
        border:2px solid #ff5722; background:rgba(255,87,34,0.18); pointer-events:none; z-index:2147483647;
        border-radius:3px; box-sizing:border-box;`;
    document.body.appendChild(_pickerTreeHoverBox);
}
function pickerHideTreeHover() {
    _pickerTreeHoverBox?.remove();
    _pickerTreeHoverBox = null;
}

function pickerShowChoice({ field, clickedEl, tileRoot, candidates, initialCandidates, onChoose, onAbort }) {
    pickerRemoveChoice();
    const box = document.createElement('div');
    box.id = 'ss-picker-choice';
    box.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(880px,calc(100vw - 30px));max-height:min(78vh,780px);
        background:#fff;border-radius:14px;box-shadow:0 18px 70px rgba(0,0,0,.42);z-index:2147483647;font-family:sans-serif;color:#263238;
        display:flex;flex-direction:column;overflow:hidden;`;

    const head = document.createElement('div');
    head.style.cssText = 'padding:12px 14px;background:#263238;color:#fff;display:flex;align-items:center;gap:10px;cursor:move;user-select:none;';
    head.innerHTML = `<span style="font-size:18px">🧩</span><div style="flex:1"><div style="font-weight:700;font-size:13px">Выберите элемент и селектор</div><div style="font-size:10px;opacity:.72">${tileRoot ? 'Наведите — подсветится на странице. Кликните — покажет варианты селекторов' : 'Можно подняться по дереву от случайно попавшего во вложенный тег'}</div></div>`;
    const x = document.createElement('button'); x.textContent = '✕';
    x.style.cssText = 'background:none;border:0;color:#fff;font-size:16px;cursor:pointer;padding:2px 5px;';
    x.onclick = () => { pickerRemoveChoice(); try { onAbort?.(); } catch { } };
    head.appendChild(x); box.appendChild(head);

    // перетаскивание окна за шапку — центрируется один раз при открытии, дальше можно подвинуть
    (function makeChoiceDraggable() {
        let dragging = false, offX = 0, offY = 0;
        function onDown(e) {
            if (e.target === x) return;
            const r = box.getBoundingClientRect();
            // переходим с transform-центрирования на обычные left/top, чтобы двигать без прыжков
            box.style.left = r.left + 'px';
            box.style.top = r.top + 'px';
            box.style.transform = 'none';
            dragging = true;
            offX = e.clientX - r.left;
            offY = e.clientY - r.top;
            e.preventDefault();
        }
        function onMove(e) {
            if (!dragging) return;
            const maxLeft = window.innerWidth - box.offsetWidth - 4;
            const maxTop = window.innerHeight - box.offsetHeight - 4;
            box.style.left = Math.min(Math.max(4, e.clientX - offX), Math.max(4, maxLeft)) + 'px';
            box.style.top = Math.min(Math.max(4, e.clientY - offY), Math.max(4, maxTop)) + 'px';
        }
        function onUp() { dragging = false; }
        head.addEventListener('mousedown', onDown);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        box._pickerChoiceCleanup = () => {
            head.removeEventListener('mousedown', onDown);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    })();

    const main = document.createElement('div');
    main.style.cssText = 'display:grid;grid-template-columns:1fr 1.35fr;gap:12px;padding:12px;overflow:hidden;min-height:0;';
    box.appendChild(main);

    const left = document.createElement('div');
    left.style.cssText = 'min-width:0; display:flex; flex-direction:column; min-height:0;';
    const lt = document.createElement('div');
    lt.textContent = tileRoot ? '🌳 Дерево карточки (наведите для подсветки)' : '🌳 Дерево карточки';
    lt.style.cssText = 'font-weight:700;font-size:11px;margin-bottom:7px;flex-shrink:0;';
    left.appendChild(lt);
    const treeScroll = document.createElement('div');
    treeScroll.style.cssText = 'overflow:auto; border:1px solid #eee; border-radius:8px; padding:4px; flex:1; min-height:0;';
    left.appendChild(treeScroll);
    main.appendChild(left);

    const right = document.createElement('div');
    right.style.cssText = 'min-width:0; display:flex; flex-direction:column; min-height:0;';
    const rt = document.createElement('div'); rt.textContent = '🧠 Наиболее вероятные селекторы'; rt.style.cssText = 'font-weight:700;font-size:11px;margin-bottom:7px;flex-shrink:0;';
    right.appendChild(rt);
    const list = document.createElement('div'); list.style.cssText = 'overflow:auto; flex:1; min-height:0;'; right.appendChild(list);
    main.appendChild(right);

    let activeRow = null;
    function markActive(row, node) {
        if (activeRow) { activeRow.style.background = '#fff'; activeRow.style.borderColor = '#e3e7ea'; activeRow.style.fontWeight = ''; }
        row.style.background = '#eef6ff'; row.style.borderColor = '#2196F3'; row.style.fontWeight = '700';
        activeRow = row;
    }

    function renderCandidates(node, tiles, row) {
        if (row) markActive(row, node);
        list.innerHTML = '';
        let effectiveTiles = tiles;
        if (!effectiveTiles.length && field._tileSelector) {
            try { effectiveTiles = [...document.querySelectorAll(field._tileSelector)]; } catch { }
        }
        const sourceCandidates = (node === clickedEl && Array.isArray(initialCandidates) && initialCandidates.length)
            ? initialCandidates
            : pickerBuildCandidates(node, tileRoot, field.key);
        const ranked = pickerRankCandidates(sourceCandidates, effectiveTiles, node, tileRoot);
        ranked.forEach((cand, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.style.cssText = 'display:block;width:100%;text-align:left;border:1px solid #e3e7ea;background:#fff;border-radius:8px;padding:8px 9px;margin:0 0 6px;cursor:pointer;';
            const ok = Math.round(cand.coverage * 100);
            const precision = Math.round(cand.precision * 100);
            b.innerHTML = `<div style="display:flex;gap:6px;align-items:center"><span style="font-weight:700;color:${i === 0 ? '#2e7d32' : '#455a64'}">${i === 0 ? '⭐' : '#' + (i + 1)}</span><code style="font-size:10px;word-break:break-all;flex:1">${cand.selector.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></div><div style="margin-top:4px;font-size:9px;color:#888">${cand.reason} · найден в ${ok}% карточек · без неоднозначности ${precision}%</div>`;
            b.onclick = () => { pickerRemoveChoice(); onChoose(node, cand.selector); };
            list.appendChild(b);
        });
        if (!ranked.length) {
            const empty = document.createElement('div'); empty.textContent = 'Не удалось построить надёжный селектор. Его можно вписать вручную.'; empty.style.cssText = 'font-size:10px;color:#999;padding:10px;'; list.appendChild(empty);
        }
    }

    field._tileSelector = field._tileSelector || '';

    if (tileRoot) {
        // ── полноценное дерево от контейнера карточки, как в devtools ──
        const pathToTarget = new Set(pickerGetPath(clickedEl, tileRoot));

        function buildNode(el, container, depth) {
            const children = [...el.children];
            const hasChildren = children.length > 0;

            const row = document.createElement('div');
            row.style.cssText = `display:flex; align-items:center; gap:2px; padding:3px 5px; margin:1px 0;
                cursor:pointer; border-radius:6px; font-size:10.5px; border:1px solid #e3e7ea; background:#fff;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
            row.style.marginLeft = (depth * 13) + 'px';
            row.title = pickerElLabel(el);

            const toggle = document.createElement('span');
            toggle.textContent = hasChildren ? '▸' : '·';
            toggle.style.cssText = 'width:12px; flex-shrink:0; color:#90a4ae; user-select:none; display:inline-block; text-align:center;';
            row.appendChild(toggle);

            const labelSpan = document.createElement('span');
            labelSpan.textContent = (el === clickedEl ? '🎯 ' : '') + pickerElLabel(el);
            labelSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            row.appendChild(labelSpan);

            const childrenWrap = document.createElement('div');
            childrenWrap.style.display = 'none';

            let expanded = false;
            let built = false;
            function setExpanded(v) {
                expanded = v;
                if (hasChildren) toggle.textContent = v ? '▾' : '▸';
                childrenWrap.style.display = v ? '' : 'none';
                if (v && hasChildren && !built) {
                    built = true;
                    children.forEach(c => buildNode(c, childrenWrap, depth + 1));
                }
            }
            if (hasChildren) {
                toggle.addEventListener('click', e => { e.stopPropagation(); setExpanded(!expanded); });
            }

            row.addEventListener('mouseenter', () => pickerShowTreeHover(el));
            row.addEventListener('mouseleave', () => pickerHideTreeHover());
            row.addEventListener('click', () => renderCandidates(el, field._tiles || [], row));

            container.appendChild(row);
            container.appendChild(childrenWrap);

            // авто-раскрываем путь до кликнутого элемента, чтобы сразу было видно где он
            if (pathToTarget.has(el) && el !== clickedEl) setExpanded(true);
            if (el === clickedEl) { markActive(row, el); }

            return row;
        }

        buildNode(tileRoot, treeScroll, 0);
        renderCandidates(clickedEl, field._tiles || [], null);
    } else {
        // ── карточка ещё не выбрана — нет контейнера для полного дерева, показываем путь предков ──
        const path = pickerGetPath(clickedEl, tileRoot);
        path.forEach((node, idx) => {
            const rowBtn = document.createElement('button');
            rowBtn.type = 'button';
            rowBtn.textContent = (idx === 0 ? '🎯 ' : '') + pickerElLabel(node);
            rowBtn.title = pickerElLabel(node);
            rowBtn.style.cssText = `display:block;width:100%;text-align:left;padding:7px 8px;margin:3px 0;border:1px solid ${node === clickedEl ? '#2196F3' : '#e3e7ea'};
                border-radius:7px;background:${node === clickedEl ? '#eef6ff' : '#fff'};cursor:pointer;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
            if (idx > 0) rowBtn.style.paddingLeft = Math.min(8 + idx * 10, 58) + 'px';
            rowBtn.addEventListener('mouseenter', () => pickerShowTreeHover(node));
            rowBtn.addEventListener('mouseleave', () => pickerHideTreeHover());
            rowBtn.onclick = () => renderCandidates(node, field._tiles || [], rowBtn);
            treeScroll.appendChild(rowBtn);
        });
        renderCandidates(clickedEl, field._tiles || [], treeScroll.querySelector('button'));
    }

    document.body.appendChild(box);
}

// ── панель ──
function openSelectorPickerPanel(hooks) {
    document.getElementById('ss-picker-panel')?.remove();
    _pickerActiveHighlights.clear();
    pickerClearHighlightBoxes();

    const hostname = window.location.hostname;
    const cfg = hooks.currentConfig || {};
    let profiles = normalizeSelectorProfiles(cfg);
    if (!profiles.length) profiles = [{ name:'Карточка 1', tile:'', price:'', title:'', link:'', id:'', extras:[], reviews:'', rating:'', delivery:'', weight:'' }];

    let activeProfileIndex = 0;
    let fieldEls = {};
    let activeLinkMode = 'selector';
    let lastPickerTarget = { kind: 'field', key: 'tile', label: '🧩 Карточка' };
    // Последний реальный элемент под курсором фиксируем ДО нажатия горячей клавиши.
    // Это важно для hover/click-popup: сайт может удалить его уже в ответ на keydown.
    let lastHoveredPageElement = null;
    let lastHoveredSnapshots = new Map();
    const activeExtra = () => [];

    const panel = document.createElement('div');
    panel.id = 'ss-picker-panel';
    panel.style.cssText = `position:fixed;top:16px;right:16px;width:390px;max-height:calc(100vh - 32px);
        overflow:hidden;background:#fff;border-radius:12px;box-shadow:0 10px 50px rgba(0,0,0,.4);
        z-index:2147483647;font-family:sans-serif;font-size:12px;color:#333;display:flex;flex-direction:column;
        box-sizing:border-box;isolation:isolate;contain:layout style paint;`;
    // Полностью изолируем содержимое окна настройки селекторов от CSS сайта.
    // Важно: host остаётся в document.body, поэтому окно по-прежнему может
    // взаимодействовать со страницей, но стили сайта не проникают внутрь shadow DOM.
    const panelRoot = panel.attachShadow({mode:'open'});
    const pickerIsolationStyle = document.createElement('style');
    pickerIsolationStyle.id = 'ss-picker-isolation-style';
    pickerIsolationStyle.textContent = `
        #ss-picker-panel, #ss-picker-panel * { box-sizing:border-box !important; }
        #ss-picker-panel { font-family:Arial,sans-serif !important; line-height:normal !important; }
        #ss-picker-panel button, #ss-picker-panel input, #ss-picker-panel select, #ss-picker-panel textarea {
            font-family:Arial,sans-serif !important; line-height:normal !important;
        }
        #ss-picker-panel input, #ss-picker-panel select, #ss-picker-panel textarea {
            max-width:100% !important; min-width:0 !important;
        }
        #ss-picker-panel img { max-width:100% !important; }
    `;
    document.documentElement.appendChild(pickerIsolationStyle);
    panel._cleanupIsolation = () => pickerIsolationStyle.remove();

    const header = document.createElement('div');
    header.style.cssText = `padding:12px 14px;background:#263238;color:#fff;border-radius:12px 12px 0 0;
        display:flex;align-items:center;gap:8px;cursor:move;flex-shrink:0;`;
    header.innerHTML = `<span style="font-size:15px">🎯</span><div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px">Настройка селекторов</div>
        <div style="font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hostname} · Alt+Shift+S → <span id="ss-picker-shortcut-target" style="font-weight:700">🧩 Карточка</span> · Alt+Shift+S запускает выбор без клика по кнопке</div>
    </div>`;
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText='background:none;border:none;color:#fff;font-size:16px;cursor:pointer;opacity:.85;padding:2px 6px;';
    header.appendChild(closeX); panelRoot.appendChild(header);
    const shortcutTargetEl = header.querySelector('#ss-picker-shortcut-target');
    function setLastPickerTarget(target) {
        lastPickerTarget = target || { kind:'field', key:'tile', label:'🧩 Карточка' };
        if (shortcutTargetEl) shortcutTargetEl.textContent = lastPickerTarget.label || lastPickerTarget.key;
    }

    (function makeDraggable() {
        let dragging=false,ox=0,oy=0;
        header.addEventListener('mousedown', e => {
            if (e.target===closeX) return;
            const r=panel.getBoundingClientRect(); panel.style.left=r.left+'px'; panel.style.top=r.top+'px'; panel.style.right='auto';
            dragging=true; ox=e.clientX-r.left; oy=e.clientY-r.top; e.preventDefault();
        });
        const mm=e=>{ if(!dragging)return; panel.style.left=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth-4,e.clientX-ox))+'px'; panel.style.top=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight-4,e.clientY-oy))+'px'; };
        const mu=()=>dragging=false;
        document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu);
        panel._cleanupDrag=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
    })();

    // ─── Явный статус определения сайта ────────────────────────────────────────
    // Раньше было видно только название сайта в шапке — если срабатывала не та
    // запись (например, по случайному совпадению эвристики DOM, а не по домену),
    // это было не отличить от «всё верно». Показываем прямо, что определилось,
    // и даём поле домена + кнопку добавления, если текущий домен не настроен.
    const domainStatusBox = document.createElement('div');
    domainStatusBox.style.cssText = 'padding:8px 14px;background:#fff8e1;border-bottom:1px solid #eee;flex-shrink:0;font-size:11px;';
    domainStatusBox.innerHTML = `
        <div id="ss-picker-domain-status" style="margin-bottom:6px;line-height:1.4;"></div>
        <div style="display:flex;gap:6px;align-items:center;">
            <input id="ss-picker-domain-input" style="flex:1;min-width:0;padding:5px 7px;border:1px solid #ddd;border-radius:6px;font-size:11px;font-family:monospace;">
            <button id="ss-picker-domain-addbtn" type="button" style="flex:0 0 auto;padding:5px 9px;border:1px solid #2e7d32;border-radius:6px;background:#2e7d32;color:#fff;cursor:pointer;font-size:11px;white-space:nowrap;">➕ Добавить как новый сайт</button>
        </div>`;
    panelRoot.appendChild(domainStatusBox);
    const domainStatusEl = domainStatusBox.querySelector('#ss-picker-domain-status');
    const domainInputEl = domainStatusBox.querySelector('#ss-picker-domain-input');
    const domainAddBtn = domainStatusBox.querySelector('#ss-picker-domain-addbtn');
    domainInputEl.value = hostname;

    let __allSitesCache = null; // {key: config} — подгружается один раз при открытии панели
    async function getAllSitesForStatusCheck() {
        if (__allSitesCache) return __allSitesCache;
        try {
            const defaultSites = await fetch(chrome.runtime.getURL('sites.json')).then(r => r.json());
            const stored = await new Promise(resolve => chrome.storage.local.get(['sites'], resolve));
            __allSitesCache = stored.sites ?? defaultSites;
        } catch { __allSitesCache = {}; }
        return __allSitesCache;
    }
    function findSiteKeyForDomain(allSites, domain) {
        for (const [key, cfg] of Object.entries(allSites || {})) {
            if (cfg.domains?.some(d => hostnameMatchesDomain(domain, d))) return key;
        }
        return null;
    }
    async function refreshDomainStatus() {
        const typed = domainInputEl.value.trim();
        if (!typed) {
            domainStatusEl.innerHTML = '<span style="color:#999">Введите домен</span>';
            domainAddBtn.style.display = 'none';
            return;
        }
        const allSites = await getAllSitesForStatusCheck();
        const matchedKey = findSiteKeyForDomain(allSites, typed);
        if (matchedKey) {
            const label = allSites[matchedKey]?.displayName || matchedKey;
            domainStatusEl.innerHTML = `✅ Определён сайт: <b>${hostname}</b> — уже настроен в базе как «<b>${esc(label)}</b>»`;
            domainAddBtn.style.display = 'none';
        } else {
            const heuristicNote = (hooks.siteName && !hooks.knownInDatabase && hooks.siteName !== hostname)
                ? ` Селекторы сейчас взяты от «<b>${hooks.siteName}</b>» — совпали случайно (по разметке страницы), это НЕ настройка для этого домена.`
                : '';
            domainStatusEl.innerHTML = `⚠️ Домен <b>${esc(typed)}</b> не найден в настройках.${heuristicNote}`;
            domainAddBtn.style.display = '';
        }
    }
    function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    domainInputEl.addEventListener('input', refreshDomainStatus);
    refreshDomainStatus();

    domainAddBtn.addEventListener('click', async () => {
        const domain = normalizeDomainForMatch(domainInputEl.value);
        if (!domain) { hooks.notify?.('Введите домен', 'warning'); return; }
        domainAddBtn.disabled = true; domainAddBtn.textContent = '…';
        try {
            const allSites = await getAllSitesForStatusCheck();
            if (findSiteKeyForDomain(allSites, domain)) {
                hooks.notify?.('Этот домен уже настроен', 'warning');
                __allSitesCache = null; await refreshDomainStatus();
                return;
            }
            let key = domain.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'site';
            let uniqueKey = key, n = 2;
            while (allSites[uniqueKey]) { uniqueKey = `${key}_${n++}`; }
            const newSiteConfig = {
                displayName: domain,
                domains: [domain],
                cards: [{ name: 'Карточка 1', tile: '', id: '', price: '', title: '', link: 'a[href]', reviews: '', rating: '', delivery: '', weight: '', extras: [] }],
                tile: '', id: '', price: '', title: '', link: 'a[href]', reviews: '', rating: '', delivery: '', weight: '',
            };
            const updatedSites = { ...allSites, [uniqueKey]: newSiteConfig };
            await new Promise(resolve => chrome.storage.local.set({ sites: updatedSites }, resolve));
            __allSitesCache = updatedSites;
            hooks.notify?.(`Сайт «${domain}» добавлен в настройки`, 'success');
            await hooks.reload?.();
            // Перерисовываем панель заново — она подхватит уже привязанный домен.
            document.getElementById('ss-picker-panel')?.remove();
            openSelectorPickerPanel(hooks);
        } catch (e) {
            console.error(e);
            hooks.notify?.('Не удалось добавить сайт', 'warning');
        } finally {
            domainAddBtn.disabled = false; domainAddBtn.textContent = '➕ Добавить как новый сайт';
        }
    });

    const tabBar = document.createElement('div');
    tabBar.style.cssText='display:flex;gap:5px;align-items:center;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa;overflow:auto;flex-shrink:0;';
    const tabScroll=document.createElement('div');
    tabScroll.style.cssText='display:flex;gap:5px;overflow:auto;flex:1;min-width:0;';
    const addCardBtn=document.createElement('button');
    addCardBtn.type='button'; addCardBtn.textContent='＋';
    addCardBtn.title='Добавить вариант карточки';
    addCardBtn.style.cssText='width:30px;height:30px;border:1px dashed #9e9e9e;border-radius:7px;background:#fff;color:#555;cursor:pointer;font-size:17px;flex:0 0 30px;';
    const removeCardBtn=document.createElement('button');
    removeCardBtn.type='button'; removeCardBtn.textContent='🗑';
    removeCardBtn.title='Удалить текущий вариант карточки';
    removeCardBtn.style.cssText='width:30px;height:30px;border:1px solid #ddd;border-radius:7px;background:#fff;color:#e53935;cursor:pointer;font-size:14px;flex:0 0 30px;';
    tabBar.appendChild(tabScroll); tabBar.appendChild(removeCardBtn); tabBar.appendChild(addCardBtn); panelRoot.appendChild(tabBar);

    const body = document.createElement('div');
    body.style.cssText='padding:12px 14px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;min-height:0;flex:1;';
    panelRoot.appendChild(body);

    const tip=document.createElement('div');
    tip.style.cssText='font-size:11px;color:#666;background:#f5f7fa;border-radius:8px;padding:8px 10px;line-height:1.5;';
    tip.innerHTML='Каждая вкладка — отдельный шаблон карточки. Сначала задайте селектор <b>карточки</b>, затем атрибуты ищутся только внутри неё. Варианты карточек могут полностью отличаться.';
    body.appendChild(tip);

    const fieldsWrap=document.createElement('div');
    fieldsWrap.style.cssText='display:flex;flex-direction:column;gap:9px;';
    body.appendChild(fieldsWrap);

    const idCfgBox=document.createElement('div');
    idCfgBox.style.cssText='border:1px solid #e3e7ea;border-radius:8px;padding:8px;background:#fafafa;';
    idCfgBox.innerHTML='<b style="font-size:11px">🆔 Как формировать ID карточки</b><div style="font-size:10px;color:#777;margin:4px 0 6px">ID используется для удаления дублей. Можно взять один атрибут или собрать ID из нескольких значений.</div>';
    const idMode=document.createElement('select'); idMode.style.cssText='width:100%;font-size:11px;padding:5px;border:1px solid #ddd;border-radius:6px;';
    idMode.innerHTML='<option value="selector">Из селектора ID товара</option><option value="fields">Из комбинации атрибутов</option>';
    const idParts=document.createElement('input'); idParts.placeholder='Например: title | бренд | sku'; idParts.style.cssText='width:100%;box-sizing:border-box;margin-top:5px;font-size:11px;padding:6px;border:1px solid #ddd;border-radius:6px;';
    const idFieldPicker=document.createElement('select'); idFieldPicker.style.cssText='width:100%;font-size:11px;padding:5px;border:1px solid #ddd;border-radius:6px;margin-top:5px;background:#fff;';
    const idPartsPreview=document.createElement('div'); idPartsPreview.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;';
    const idSep=document.createElement('input'); idSep.placeholder='Разделитель'; idSep.style.cssText='width:100%;box-sizing:border-box;margin-top:5px;font-size:11px;padding:6px;border:1px solid #ddd;border-radius:6px;'; idSep.value=' | ';
    const idHint=document.createElement('div'); idHint.style.cssText='font-size:10px;color:#999;margin-top:4px'; idHint.textContent='Выберите поле из списка — в JSON сохраняется его техническое имя. Доп. атрибуты показываются по заданному вами имени, поэтому английские имена больше не нужно угадывать.';
    const idStats=document.createElement('div');
    idStats.style.cssText='display:none;margin-top:7px;padding:7px 8px;border-radius:7px;background:#f5f7fa;border:1px solid #e5e9ef;font-size:10px;line-height:1.45;color:#555;';
    idCfgBox.append(idMode,idParts,idFieldPicker,idPartsPreview,idSep,idHint,idStats); body.appendChild(idCfgBox);

    const extrasBox=document.createElement('div');
    extrasBox.style.cssText='border:1px solid #e3e7ea;border-radius:8px;padding:8px;background:#fafafa;';
    const extrasHead=document.createElement('div');
    extrasHead.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:7px;';
    const extrasTitle=document.createElement('b'); extrasTitle.textContent='➕ Дополнительные атрибуты'; extrasTitle.style.cssText='font-size:11px;flex:1;';
    const extrasAdd=document.createElement('button'); extrasAdd.type='button'; extrasAdd.textContent='＋'; extrasAdd.title='Добавить атрибут'; extrasAdd.style.cssText='width:26px;height:26px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;';
    extrasHead.appendChild(extrasTitle); extrasHead.appendChild(extrasAdd); extrasBox.appendChild(extrasHead);
    const extrasHint=document.createElement('div');
    extrasHint.textContent='Как это работает: задайте своё имя (например «Углеводы»), выберите элемент, который содержит число и единицу, и включите «Величина». Расширение само извлечёт число из текста элемента и распознает единицу из ваших настроек. Для строки «Углеводы / 32.7 г» достаточно выбрать контейнер — отдельный код для «Углеводов» не нужен.';
    extrasHint.style.cssText='font-size:9.5px;color:#888;line-height:1.45;margin:-2px 0 5px;';
    extrasBox.appendChild(extrasHint);
    const extrasList=document.createElement('div'); extrasList.style.cssText='display:flex;flex-direction:column;gap:6px;'; extrasBox.appendChild(extrasList);
    body.appendChild(extrasBox);

    const footer=document.createElement('div');
    footer.style.cssText='display:flex;gap:8px;padding:10px 14px;border-top:1px solid #eee;background:#fafafa;flex-shrink:0;';
    const saveBtn=document.createElement('button'); saveBtn.textContent='💾 Сохранить';
    saveBtn.style.cssText='flex:1;background:#2196F3;color:#fff;border:0;border-radius:7px;padding:8px;cursor:pointer;font-weight:600;';
    const diffBtn=document.createElement('button'); diffBtn.textContent='🧾 Сравнить';
    diffBtn.style.cssText='background:#fff;color:#555;border:1px solid #ddd;border-radius:7px;padding:8px 10px;cursor:pointer;';
    footer.appendChild(saveBtn); footer.appendChild(diffBtn); panelRoot.appendChild(footer);

    function cleanProfile(p, idx) {
        return {
            name: (p?.name || `Карточка ${idx+1}`).trim() || `Карточка ${idx+1}`,
            tile: p?.tile ?? '', price:p?.price ?? '', title:p?.title ?? '', link:p?.link ?? '', id:p?.id ?? '',
            extras:Array.isArray(p?.extras) ? p.extras.filter(x => x && String(x.name||'').trim() && String(x.selector||'').trim()).map(x => ({name:String(x.name).trim(), selector:String(x.selector).trim(), kind:x.kind==='quantity'?'quantity':'text', unit:String(x.unit||'').trim()})) : [],
            idConfig: p?.idConfig?.mode==='fields' ? {mode:'fields', parts:Array.isArray(p.idConfig.parts)?p.idConfig.parts.map(String).filter(Boolean):[], separator:String(p.idConfig.separator??' | ')} : null,
            reviews:p?.reviews ?? '', rating:p?.rating ?? '', delivery:p?.delivery ?? '', weight:p?.weight ?? ''
        };
    }
    profiles = profiles.map(cleanProfile);

    const ID_BUILTIN_LABELS = {
        link:'🔗 Ссылка', title:'📝 Название', price:'💰 Цена', rating:'⭐ Рейтинг', reviews:'💬 Отзывы', delivery:'🚚 Доставка', weight:'⚖️ Вес/объём'
    };
    function getIdPartOptions(){
        const p=getActiveProfile();
        const out=Object.entries(ID_BUILTIN_LABELS).map(([key,label])=>({key,label}));
        (p?.extras||[]).forEach(x=>{ const name=String(x?.name||'').trim(); if(name && !out.some(v=>v.key===name)) out.push({key:name,label:'🏷️ '+name}); });
        return out;
    }
    function updateIdCombinationPreview(){
        idStats.style.display='none';
        if(idMode.value!=='fields') return;
        const tileSel=getTileSelectorValue();
        const parts=idParts.value.split('|').map(s=>s.trim()).filter(Boolean);
        if(!tileSel || !parts.length) return;
        let tiles=[]; try { tiles=[...document.querySelectorAll(tileSel)]; } catch { tiles=[]; }
        if(!tiles.length){ idStats.style.display='block'; idStats.style.background='#fff8e1'; idStats.style.borderColor='#ffe0b2'; idStats.textContent='⚠️ Карточки по текущему селектору не найдены.'; return; }
        const sep=String(idSep.value ?? ' | ');
        const ids=[]; let missing=0;
        for(const tile of tiles){
            const vals=parts.map(part=>getConfiguredFieldText(tile,part)).map(v=>String(v??'').trim());
            if(vals.some(v=>!v)){ missing++; continue; }
            const id=vals.join(sep); if(id) ids.push(id); else missing++;
        }
        const freq=new Map(); ids.forEach(id=>freq.set(id,(freq.get(id)||0)+1));
        const unique=[...freq.keys()]; const duplicateGroups=unique.filter(id=>freq.get(id)>1); const duplicateCards=ids.length-unique.length;
        idStats.style.display='block'; idStats.style.background=duplicateCards?'#fff8e1':'#f1f8e9'; idStats.style.borderColor=duplicateCards?'#ffe0b2':'#c8e6c9';
        const sample=unique[0]||'';
        let text=`<div><b>${ids.length}</b> карточек с полным ID · <b>${unique.length}</b> уникальных ID`;
        text += duplicateCards ? ` · ⚠️ <b>${duplicateCards}</b> повторных карточек в <b>${duplicateGroups.length}</b> группах` : ' · ✅ повторов не обнаружено';
        if(missing) text += ` · <b>${missing}</b> без полного ID`;
        text += `</div>${sample?`<div><b>Пример ID:</b> <code style="word-break:break-all">${esc(sample)}</code></div>`:'<div><b>Пример ID:</b> — пока не удалось получить</div>'}`;
        if(duplicateGroups.length){ const dup=duplicateGroups.slice(0,3).map(id=>`${id} × ${freq.get(id)}`).join(' · '); text+=`<div style="margin-top:3px;color:#8a5a00"><b>Повторы:</b> ${esc(dup)}</div>`; }
        idStats.innerHTML=text;
    }

    function renderIdPartPicker(){
        const options=getIdPartOptions();
        idFieldPicker.innerHTML='';
        const placeholder=document.createElement('option'); placeholder.value=''; placeholder.textContent='＋ Добавить атрибут в ID…'; idFieldPicker.appendChild(placeholder);
        options.forEach(o=>{const opt=document.createElement('option');opt.value=o.key;opt.textContent=`${o.label}  [${o.key}]`;idFieldPicker.appendChild(opt);});
        renderIdPartsPreview();
    }
    function renderIdPartsPreview(){
        idPartsPreview.innerHTML='';
        const map=new Map(getIdPartOptions().map(o=>[o.key,o.label]));
        const parts=idParts.value.split('|').map(s=>s.trim()).filter(Boolean);
        if(!parts.length){ idPartsPreview.style.display='none'; return; }
        idPartsPreview.style.display='flex';
        parts.forEach(part=>{
            const chip=document.createElement('span'); chip.textContent=map.get(part)||`⚠️ ${part}`; chip.title=`JSON: ${part}`;
            chip.style.cssText=`font-size:9.5px;padding:3px 6px;border-radius:10px;background:${map.has(part)?'#eef3ff':'#fff3e0'};color:${map.has(part)?'#3d4db7':'#b74a00'};border:1px solid ${map.has(part)?'#c7d0fd':'#ffe0b2'};`;
            idPartsPreview.appendChild(chip);
        });
        updateIdCombinationPreview();
    }
    idFieldPicker.addEventListener('change',()=>{
        const key=idFieldPicker.value; if(!key) return;
        const parts=idParts.value.split('|').map(s=>s.trim()).filter(Boolean);
        if(!parts.includes(key)) parts.push(key);
        idParts.value=parts.join(' | '); idFieldPicker.value=''; renderIdPartsPreview(); readUiIntoProfile();
    });

    function renderExtras(){
        // Remove highlights belonging to extra attributes before rebuilding their rows.
        for (const key of [..._pickerActiveHighlights.keys()]) {
            if (String(key).startsWith('extra:')) _pickerActiveHighlights.delete(key);
        }
        extrasList.innerHTML='';
        const p=getActiveProfile();
        (p?.extras||[]).forEach((x,idx)=>{
            const row=document.createElement('div');
            row.style.cssText='border:1px solid #e5e7eb;border-radius:7px;background:#fff;padding:7px;display:flex;flex-direction:column;gap:5px;';

            const top=document.createElement('div');
            top.style.cssText='display:grid;grid-template-columns:minmax(90px,1fr) 70px 52px 28px;gap:5px;align-items:start;';

            const name=document.createElement('input');
            name.value=x.name||''; name.placeholder='имя';
            name.style.cssText='width:100%;box-sizing:border-box;font-size:10px;padding:5px;border:1px solid #ddd;border-radius:5px;';

            const kind=document.createElement('select');
            kind.innerHTML='<option value="text">Текст</option><option value="quantity">Величина</option>';
            kind.value=x.kind==='quantity'?'quantity':'text';
            kind.style.cssText='width:100%;font-size:10px;padding:5px;border:1px solid #ddd;border-radius:5px;';

            const unit=document.createElement('input');
            unit.value=x.unit||''; unit.placeholder='ед.';
            unit.style.cssText='width:100%;box-sizing:border-box;font-size:10px;padding:5px;border:1px solid #ddd;border-radius:5px;';
            unit.disabled=kind.value!=='quantity';
            const unitListId='ss-extra-units-list';
            let unitList=document.getElementById(unitListId);
            if(!unitList){ unitList=document.createElement('datalist'); unitList.id=unitListId; document.body.appendChild(unitList); }
            unitList.innerHTML='';
            const allConfiguredUnits=new Set();
            Object.values(window.__SS_UNITS_FOR_PICKER || {}).forEach(cat=>Object.keys(cat?.units||{}).forEach(u=>allConfiguredUnits.add(u)));
            allConfiguredUnits.forEach(u=>{const o=document.createElement('option');o.value=u;unitList.appendChild(o);});
            unit.setAttribute('list',unitListId);

            const del=document.createElement('button');
            del.textContent='✕'; del.title='Удалить';
            del.style.cssText='height:28px;border:1px solid #ddd;border-radius:5px;background:#fff;color:#c62828;cursor:pointer;';

            top.append(name,kind,unit,del);

            const selectorLine=document.createElement('div');
            selectorLine.style.cssText='display:flex;gap:5px;align-items:stretch;';
            const sel=document.createElement('textarea');
            sel.value=x.selector||''; sel.rows=2; sel.placeholder='CSS-селектор (по одному варианту на строку)';
            sel.style.cssText='width:100%;box-sizing:border-box;font:10px monospace;line-height:1.35;padding:6px 7px;border:1px solid #ddd;border-radius:5px;resize:vertical;min-height:42px;white-space:pre-wrap;overflow-wrap:anywhere;';
            const pick=document.createElement('button');
            pick.type='button'; pick.textContent='🎯'; pick.title='Выбрать элемент на странице';
            pick.style.cssText='width:32px;height:32px;align-self:flex-start;border:1px solid #90CAF9;border-radius:5px;background:#fff;color:#1976d2;cursor:pointer;flex:0 0 32px;';
            pick.addEventListener('mouseenter',()=>setLastPickerTarget({kind:'extra',index:idx,label:'➕ '+(name.value.trim()||`Доп. атрибут ${idx+1}`),button:pick}));
            pick.addEventListener('focus',()=>setLastPickerTarget({kind:'extra',index:idx,label:'➕ '+(name.value.trim()||`Доп. атрибут ${idx+1}`),button:pick}));
            pick._pickerExtraIndex=idx;
            const toggle=document.createElement('button');
            toggle.type='button'; toggle.textContent='👁'; toggle.title='Подсветить совпадения на странице';
            toggle.style.cssText='width:32px;height:32px;align-self:flex-start;border:1px solid #ddd;border-radius:5px;background:#fff;color:#999;cursor:pointer;flex:0 0 32px;';
            selectorLine.append(sel,pick,toggle);

            const status=document.createElement('div');
            status.style.cssText='font-size:10.5px;color:#999;min-height:15px;line-height:1.35;';
            // Такой же блок предпросмотра найденных значений, как у остальных атрибутов
            // (см. previewBox в makeField/revalidateField) — отдельные строки моноширинным шрифтом.
            const previewBox=document.createElement('div');
            previewBox.style.cssText='display:none;background:#fafafa;border-radius:6px;padding:5px 7px;gap:2px;flex-direction:column;';
            const key=`extra:${idx}`;

            const sync=()=>{
                x.name=name.value.trim(); x.selector=sel.value.trim(); x.kind=kind.value; x.unit=unit.value.trim();
                profiles[activeProfileIndex].extras=p.extras;
                validateExtra();
            };
            const validateExtra=()=>{
                previewBox.innerHTML=''; previewBox.style.display='none';
                const tileSel=getTileSelectorValue();
                const raw=sel.value.trim();
                if(!tileSel){ status.textContent='⚠️ сначала выберите карточку'; status.style.color='#e53935'; return; }
                if(!raw){ status.textContent='не задано'; status.style.color='#999'; return; }
                const arr=pickerParseMultiline(raw);
                let tiles=[]; try{tiles=[...document.querySelectorAll(tileSel)];}catch{tiles=[];}
                if(!tiles.length){ status.textContent='⚠️ карточки не найдены'; status.style.color='#e53935'; return; }
                let found=0;
                tiles.forEach(t=>{
                    const elements=getConfiguredElementsForTile(t,arr);
                    if(elements.some(el=>!!extractConfiguredElementValue(el))) found++;
                });
                if(found){
                    status.textContent=`✅ найдено в ${found}/${tiles.length} карточках`;
                    status.style.color='#2e7d32';
                    const samples=[];
                    // Примеры берём со всех найденных элементов, а не только с первых
                    // 12 карточек. Это важно для атрибутов вроде «Брэнд», где вариантов
                    // может быть десятки. При вводе селектора блок обновляется сразу.
                    tiles.forEach(t=>{
                        const elements=getConfiguredElementsForTile(t,arr);
                        elements.forEach(el=>{
                            const v=extractConfiguredElementValue(el);
                            if(v) samples.push(String(v).trim());
                        });
                    });
                    const uniqueSamples=[...new Set(samples.filter(Boolean))];
                    const shown=uniqueSamples.slice(0,5);
                    if(shown.length){
                        previewBox.style.display='flex';
                        shown.forEach(v=>{
                            const line=document.createElement('div');
                            line.style.cssText='font-family:monospace;font-size:10px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                            let display='→ '+v.slice(0,90);
                            if(kind.value==='quantity'){
                                const parsed=getAllUnitResultsFromText(v);
                                if(parsed.length){
                                    const q=parsed[0];
                                    display += `  ⇒ ${fmtUnit(q.badgeNumber,q.decimals)} ${q.unit}`;
                                }
                            }
                            line.textContent=display;
                            previewBox.appendChild(line);
                        });
                        if(uniqueSamples.length>shown.length){
                            const more=document.createElement('div');
                            more.style.cssText='font-size:9.5px;color:#9E9E9E;';
                            more.textContent=`+${uniqueSamples.length-shown.length} ещё (всего ${uniqueSamples.length} уник.)`;
                            previewBox.appendChild(more);
                        }
                    }
                }
                else{status.textContent='⚠️ не найдено в карточках'; status.style.color='#e53935';}
                if(_pickerActiveHighlights.has(key)) pickerRedrawHighlights();
            };

            name.addEventListener('input',()=>{
                sync();
                if(lastPickerTarget.kind==='extra' && lastPickerTarget.index===idx) setLastPickerTarget({kind:'extra',index:idx,label:'➕ '+(name.value.trim()||`Доп. атрибут ${idx+1}`),button:pick});
                renderIdPartPicker();
            });
            sel.addEventListener('input',()=>{sync();});
            unit.addEventListener('input',sync);
            kind.addEventListener('change',()=>{unit.disabled=kind.value!=='quantity';sync();});
            del.onclick=()=>{
                _pickerActiveHighlights.delete(key);
                p.extras.splice(idx,1); renderExtras(); pickerRedrawHighlights();
            };

            const startExtraPicker = (preservedTarget=null, preservedCandidates=null, preservedTileRoot=null) => {
                const tileSel=getTileSelectorValue();
                if(!tileSel){hooks.notify('⚠️ Сначала выберите карточку товара','warning');return;}
                let tiles=[]; try{tiles=[...document.querySelectorAll(tileSel)];}catch{}
                const tileRoot=tiles[0]||null; hooks.minimize?.(); pickerRemoveChoice();
                pick.textContent='…'; pick.disabled=true;
                const finish=()=>{pick.textContent='🎯';pick.disabled=false;};
                if (preservedTarget) {
                    const el=preservedTarget;
                    const root=preservedTileRoot || (()=>{try{return el.matches?.(tileSel)?el:el.closest(tileSel);}catch{return null;}})();
                    if(!root){hooks.notify('⚠️ Зафиксированный элемент оказался вне карточки товара','warning');finish();return;}
                    const frozen=preservedCandidates || pickerBuildCandidates(el,root,'extra');
                    pickerShowChoice({field:{key:'extra',label:`Атрибут: ${name.value||'без имени'}`,color:'#607D8B',multi:false,_tiles:tiles,_tileSelector:tileSel},clickedEl:el,tileRoot:root,candidates:frozen,initialCandidates:frozen,onAbort:finish,
                        onChoose:(node,css)=>{sel.value=css;sync();finish();renderExtras();}});
                } else pickerStartPicking({onCancel:finish,onPick:el=>{
                    if(!tileRoot){hooks.notify('⚠️ Карточки на странице не найдены','warning');finish();return;}
                    const root=el.closest?.(tileSel)||tileRoot;
                    pickerShowChoice({field:{key:'extra',label:`Атрибут: ${name.value||'без имени'}`,color:'#607D8B',multi:false,_tiles:tiles,_tileSelector:tileSel},clickedEl:el,tileRoot:root,onAbort:finish,
                        onChoose:(node,css)=>{sel.value=css;sync();finish();renderExtras();}});
                }});
            };
            pick._startPicker = startExtraPicker;
            pick.onclick=()=>{
                const preservedTarget = pick._preservedPickerTarget || null;
                const preservedCandidates = pick._preservedPickerCandidates || null;
                const preservedTileRoot = pick._preservedPickerTileRoot || null;
                pick._preservedPickerTarget = null;
                pick._preservedPickerCandidates = null;
                pick._preservedPickerTileRoot = null;
                startExtraPicker(preservedTarget,preservedCandidates,preservedTileRoot);
            };

            toggle.onclick=()=>{
                if(_pickerActiveHighlights.has(key)){
                    _pickerActiveHighlights.delete(key);
                } else {
                    _pickerActiveHighlights.set(key,{color:'#607D8B',getEls:()=>{
                        const tileSel=getTileSelectorValue(); if(!tileSel)return[];
                        const raw=sel.value.trim(); if(!raw)return[];
                        const arr=pickerParseMultiline(raw); const tiles=[];
                        try{tiles.push(...document.querySelectorAll(tileSel));}catch{return[];}
                        const found=[];
                        tiles.forEach(t=>{
                            const elements=getConfiguredElementsForTile(t,arr);
                            if(elements.length) found.push(...elements);
                        });
                        return found;
                    }});
                }
                pickerEnsureScrollSync(); pickerRedrawHighlights();
            };

            row.append(top,selectorLine,status,previewBox);
            extrasList.appendChild(row);
            validateExtra();
        });
        if(!(p?.extras||[]).length){
            const hint=document.createElement('div');
            hint.textContent='Например: sku → [data-sku], бренд → .brand. 🎯 выбирает элемент на странице, 👁 подсвечивает все совпадения, ниже показывается количество найденных.';
            hint.style.cssText='font-size:10px;color:#999;';
            extrasList.appendChild(hint);
        }
    }
    extrasAdd.addEventListener('click',()=>{readUiIntoProfile();profiles[activeProfileIndex].extras.push({name:'Атрибут',selector:''});renderExtras();});

    function readUiIntoProfile() {
        if (!fieldEls.tile) return;
        const p=profiles[activeProfileIndex] || cleanProfile({}, activeProfileIndex);
        PICKER_FIELDS.forEach(f => { p[f.key] = f.multi ? pickerParseMultiline(fieldEls[f.key].input.value) : fieldEls[f.key].input.value.trim(); });
        if (activeLinkMode==='current') p.link=CURRENT_PAGE_LINK_SELECTOR;
        if (idMode.value==='fields') p.idConfig={mode:'fields',parts:idParts.value.split('|').map(s=>s.trim()).filter(Boolean),separator:idSep.value};
        else p.idConfig=null;
        profiles[activeProfileIndex]=cleanProfile(p,activeProfileIndex);
    }

    function getActiveProfile() { return profiles[activeProfileIndex] || profiles[0]; }
    function getTileSelectorValue() { return getActiveProfile()?.tile || ''; }
    function syncIdConfigUi(){ const p=getActiveProfile(); const cfg=p?.idConfig; idMode.value=cfg?.mode==='fields'?'fields':'selector'; idParts.value=(cfg?.parts||[]).join(' | '); idSep.value=cfg?.separator ?? ' | '; idParts.disabled=idMode.value!=='fields'; idSep.disabled=idMode.value!=='fields'; idFieldPicker.disabled=idMode.value!=='fields'; renderIdPartPicker(); }
    idMode.addEventListener('change',()=>{idParts.disabled=idMode.value!=='fields'; idSep.disabled=idMode.value!=='fields'; idFieldPicker.disabled=idMode.value!=='fields'; renderIdPartPicker(); readUiIntoProfile(); updateIdCombinationPreview();});
    idParts.addEventListener('input',()=>{renderIdPartsPreview();readUiIntoProfile(); updateIdCombinationPreview();});
    idSep.addEventListener('input',()=>{readUiIntoProfile(); updateIdCombinationPreview();});

    function linkModeUpdate(mode) {
        activeLinkMode=mode;
        const f=fieldEls.link;
        if (!f) return;
        if (mode==='current') {
            f.input.value=CURRENT_PAGE_LINK_SELECTOR;
            f.input.disabled=true; f.input.style.opacity='.55';
            f.modeSelect.value='current';
            f.toggleBtn.disabled=true; f.toggleBtn.style.opacity='.45';
        } else {
            if (f.input.value===CURRENT_PAGE_LINK_SELECTOR) f.input.value='';
            f.input.disabled=false; f.input.style.opacity='1';
            f.modeSelect.value='selector';
            f.toggleBtn.disabled=false; f.toggleBtn.style.opacity='1';
        }
        revalidateAll();
    }

    function makeField(field) {
        const row=document.createElement('div');
        row.style.cssText='display:flex;flex-direction:column;gap:4px;padding-bottom:8px;border-bottom:1px solid #eee;';
        const labelRow=document.createElement('div'); labelRow.style.cssText='display:flex;align-items:center;gap:6px;';
        const label=document.createElement('span'); label.textContent=field.label+(field.required?' *':''); label.style.cssText='font-weight:600;font-size:12px;flex:1;';
        labelRow.appendChild(label);

        const pickBtn=document.createElement('button'); pickBtn.type='button'; pickBtn.textContent='🎯 Выбрать';
        pickBtn.style.cssText=`font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid ${field.color};background:#fff;color:${field.color};cursor:pointer;font-weight:600;white-space:nowrap;`;
        const toggleBtn=document.createElement('button'); toggleBtn.type='button'; toggleBtn.textContent='👁'; toggleBtn.title='Подсветить совпадения на странице';
        toggleBtn.style.cssText='font-size:11px;padding:3px 7px;border-radius:5px;border:1px solid #ddd;background:#fff;color:#999;cursor:pointer;';
        labelRow.appendChild(pickBtn); labelRow.appendChild(toggleBtn); row.appendChild(labelRow);

        if(field.hint){const hint=document.createElement('div');hint.textContent=field.hint;hint.style.cssText='font-size:10px;color:#aaa;';row.appendChild(hint);}

        let input=document.createElement('textarea');
        input.rows=field.multi?3:2;
        input.style.cssText='width:100%;font-family:monospace;font-size:11px;line-height:1.35;padding:6px 8px;border:1px solid #ddd;border-radius:6px;resize:vertical;outline:none;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;';
        input.placeholder=field.multi?'По одному селектору на строку (запасные варианты)':field.placeholder||'CSS-селектор';
        row.appendChild(input);

        let modeSelect=null;
        if(field.key==='link'){
            modeSelect=document.createElement('select');
            modeSelect.style.cssText='width:100%;font-size:11px;padding:5px 7px;border:1px solid #ddd;border-radius:6px;background:#fff;margin-top:2px;';
            modeSelect.innerHTML='<option value="selector">Ссылка: CSS-селектор</option><option value="current">Ссылка = ссылка текущей страницы</option>';
            row.insertBefore(modeSelect,input);
            modeSelect.addEventListener('change',()=>linkModeUpdate(modeSelect.value));
        }

        let debounceTimer=null;
        input.addEventListener('input',()=>{
            if(field.key==='link' && input.value===CURRENT_PAGE_LINK_SELECTOR) return;
            clearTimeout(debounceTimer);
            debounceTimer=setTimeout(()=>field.key==='tile'?revalidateAll():revalidateField(field.key),250);
        });

        const status=document.createElement('div'); status.style.cssText='font-size:10.5px;color:#999;';
        const previewBox=document.createElement('div'); previewBox.style.cssText='display:none;background:#fafafa;border-radius:6px;padding:5px 7px;gap:2px;flex-direction:column;';
        row.appendChild(status); row.appendChild(previewBox);
        fieldsWrap.appendChild(row);
        fieldEls[field.key]={input,status,previewBox,toggleBtn,pickBtn,row,modeSelect};

        pickBtn.addEventListener('mouseenter',()=>setLastPickerTarget({kind:'field',key:field.key,label:field.label}));
        input.addEventListener('focus',()=>setLastPickerTarget({kind:'field',key:field.key,label:field.label}));
        const startFieldPicker = (preservedTarget=null, preservedCandidates=null, preservedTileRoot=null) => {
            if(field.key!=='tile' && !getTileSelectorValue()){hooks.notify('⚠️ Сначала выберите карточку товара','warning');return;}
            hooks.minimize?.(); pickerRemoveChoice();
            pickBtn.textContent='👆 Кликните на странице…'; pickBtn.disabled=true;
            const finish=()=>{pickBtn.textContent='🎯 Выбрать';pickBtn.disabled=false;};
            if (preservedTarget) {
                const el = preservedTarget;
                let tiles=[]; try{tiles=[...document.querySelectorAll(getTileSelectorValue())];}catch{}
                let tileRoot=preservedTileRoot;
                if(!tileRoot){ try{tileRoot=el.matches?.(getTileSelectorValue())?el:el.closest(getTileSelectorValue());}catch{} }
                if(field.key==='tile'){
                    const root=tileRoot || el;
                    const frozen=preservedCandidates || pickerBuildCandidates(el, root, field.key);
                    pickerShowChoice({field:{...field,_tiles:tiles,_tileSelector:getTileSelectorValue()},clickedEl:el,tileRoot:root,candidates:frozen,initialCandidates:frozen,onAbort:finish,
                        onChoose:(node,sel)=>{fieldEls[field.key].input.value=sel;finish();revalidateAll();}});
                } else if(tileRoot){
                    const frozen=preservedCandidates || pickerBuildCandidates(el, tileRoot, field.key);
                    pickerShowChoice({field:{...field,_tiles:tiles,_tileSelector:getTileSelectorValue()},clickedEl:el,tileRoot,candidates:frozen,initialCandidates:frozen,onAbort:finish,
                        onChoose:(node,sel)=>{
                            if(field.key==='link' && activeLinkMode==='current') return;
                            if(field.multi){const ex=pickerParseMultiline(fieldEls[field.key].input.value);const arr=Array.isArray(ex)?ex:(ex?[ex]:[]);if(!arr.includes(sel))arr.push(sel);fieldEls[field.key].input.value=arr.join('\n');}
                            else fieldEls[field.key].input.value=sel;
                            if(field.key==='link') linkModeUpdate('selector');
                            finish(); revalidateAll();
                        }});
                } else { hooks.notify('⚠️ Зафиксированный элемент оказался вне карточки товара','warning'); finish(); }
            } else pickerStartPicking({
                onCancel:finish,
                onPick:el=>{
                    if(field.key==='tile'){
                        const PRICE_RE = /\d[\d\s\u00A0.,]*[\s\u00A0]*(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)|(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)[\s\u00A0]*\d/i;
                        function isCardLikeNode(node){
                            if(!node || node.nodeType!==1) return false;
                            const hasLink=!!(node.matches?.('a[href]')||node.querySelector?.('a[href]'));
                            const hasImg=!!node.querySelector?.('img');
                            return hasLink && (hasImg || node.children.length>=3) && PRICE_RE.test(node.textContent||'');
                        }
                        let root=el;
                        for(let i=0;i<12 && root && root!==document.body;i++){ if(isCardLikeNode(root)) break; root=root.parentElement; }
                        if(!root || root===document.body) root=el.parentElement||el;
                        pickerShowChoice({field:{...field,_tiles:[] ,_tileSelector:''},clickedEl:el,tileRoot:root,onAbort:finish,
                            onChoose:(node,sel)=>{profiles[activeProfileIndex].tile=sel;fieldEls.tile.input.value=sel;finish();revalidateAll();renderTabs();}});
                        return;
                    }
                    let targetEl=el;
                    if(field.key==='link') targetEl=el.closest('a')||el;
                    const tileSel=getTileSelectorValue();
                    let tileRoot=null; try{tileRoot=targetEl.matches?.(tileSel)?targetEl:targetEl.closest(tileSel);}catch{}
                    if(!tileRoot){hooks.notify('⚠️ Элемент не внутри выбранной карточки','warning');finish();return;}
                    let tiles=[]; try{tiles=[...document.querySelectorAll(tileSel)];}catch{}
                    pickerShowChoice({field:{...field,_tiles:tiles,_tileSelector:tileSel},clickedEl:targetEl,tileRoot,onAbort:finish,
                        onChoose:(node,sel)=>{
                            if(field.key==='link' && activeLinkMode==='current') return;
                            if(field.multi){const ex=pickerParseMultiline(fieldEls[field.key].input.value);const arr=Array.isArray(ex)?ex:(ex?[ex]:[]);if(!arr.includes(sel))arr.push(sel);fieldEls[field.key].input.value=arr.join('\\n');}
                            else fieldEls[field.key].input.value=sel;
                            if(field.key==='link') linkModeUpdate('selector');
                            finish(); revalidateAll();
                        }});
                }
            });
        };
        pickBtn._startPicker = startFieldPicker;
        pickBtn.addEventListener('click',()=>{
            const preservedTarget = pickBtn._preservedPickerTarget || null;
            const preservedCandidates = pickBtn._preservedPickerCandidates || null;
            const preservedTileRoot = pickBtn._preservedPickerTileRoot || null;
            pickBtn._preservedPickerTarget = null;
            pickBtn._preservedPickerCandidates = null;
            pickBtn._preservedPickerTileRoot = null;
            startFieldPicker(preservedTarget,preservedCandidates,preservedTileRoot);
        });

        toggleBtn.addEventListener('click',()=>{
            if(field.key==='link' && activeLinkMode==='current') return;
            if(_pickerActiveHighlights.has(field.key)){_pickerActiveHighlights.delete(field.key);}
            else{
                _pickerActiveHighlights.set(field.key,{color:field.color,getEls:()=>{
                    const tileSel=getTileSelectorValue(); if(!tileSel)return[];
                    if(field.key==='tile'){try{return[...document.querySelectorAll(tileSel)];}catch{return[];}}
                    const raw=fieldEls[field.key].input.value.trim(); if(!raw || raw===CURRENT_PAGE_LINK_SELECTOR)return[];
                    const arr=field.multi?pickerParseMultiline(raw):[raw]; const tiles=[];try{tiles.push(...document.querySelectorAll(tileSel));}catch{return[];}
                    const found=[]; tiles.forEach(t=>{ const elements=getConfiguredElementsForTile(t,arr); if(elements.length) found.push(elements[0]); }); return found;
                }});
            }
            pickerEnsureScrollSync();pickerRedrawHighlights();
        });
    }

    // Поля текущего профиля создаются в loadProfileToUi(), чтобы при переключении
    // каждая вкладка имела полностью независимые значения.

    function revalidateField(key){
        const f=fieldEls[key], field=PICKER_FIELDS.find(x=>x.key===key); if(!f||!field)return;
        const val=key==='tile'?getTileSelectorValue():(field.multi?pickerParseMultiline(f.input.value):f.input.value.trim());
        if(key==='link' && val===CURRENT_PAGE_LINK_SELECTOR){
            let count=0; try{count=document.querySelectorAll(getTileSelectorValue()).length;}catch{}
            f.status.textContent=count?`✅ текущая страница используется для ${count} карточек`:'⚠️ сначала выберите карточки';
            f.status.style.color=count?'#2e7d32':'#e53935'; f.previewBox.textContent=window.location.pathname||'/'; f.previewBox.style.display='flex'; return;
        }
        const res=pickerValidateField(key,val,getTileSelectorValue());
        if(res.error){f.status.textContent='⚠️ '+res.error;f.status.style.color='#e53935';}
        else if(key==='tile'){f.status.textContent=res.count?`✅ найдено карточек: ${res.count}`:'⚠️ ничего не найдено на странице';f.status.style.color=res.count?'#2e7d32':'#e53935';}
        else if(!f.input.value.trim()){f.status.textContent=field.required?'⚠️ обязательное поле':'не задано';f.status.style.color='#999';}
        else{f.status.textContent=res.count?`✅ найдено в ${res.count}/${res.total} карточках`:`⚠️ не найдено в карточках`;f.status.style.color=res.count?'#2e7d32':'#e53935';}
        f.previewBox.innerHTML='';
        if(res.previews?.length){f.previewBox.style.display='flex';res.previews.forEach(p=>{const line=document.createElement('div');line.style.cssText='font-family:monospace;font-size:10px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';line.textContent='→ '+p;f.previewBox.appendChild(line);});}
        else f.previewBox.style.display='none';
        if(_pickerActiveHighlights.has(key))pickerRedrawHighlights();
    }
    function revalidateAll(){PICKER_FIELDS.forEach(f=>revalidateField(f.key)); updateIdCombinationPreview();}

    function loadProfileToUi(index){
        readUiIntoProfile();
        activeProfileIndex=Math.max(0,Math.min(index,profiles.length-1));
        fieldEls={};
        fieldsWrap.innerHTML='';
        PICKER_FIELDS.forEach(makeField);
        const p=getActiveProfile();
        PICKER_FIELDS.forEach(f=>{
            const v=f.multi?pickerParseMultiline(p[f.key]):(p[f.key]??'');
            fieldEls[f.key].input.value=Array.isArray(v)?v.join('\\n'):String(v);
        });
        activeLinkMode=p.link===CURRENT_PAGE_LINK_SELECTOR?'current':'selector';
        if(fieldEls.link?.modeSelect) linkModeUpdate(activeLinkMode);
        renderTabs();
        renderExtras();
        syncIdConfigUi();
        revalidateAll();
    }

    function renderTabs(){
        tabScroll.innerHTML='';
        profiles.forEach((p,i)=>{
            const b=document.createElement('button'); b.type='button'; b.textContent=`${i+1}. ${p.name}`;
            b.title=p.name;
            b.style.cssText=`height:30px;border:1px solid ${i===activeProfileIndex?'#2196F3':'#ddd'};background:${i===activeProfileIndex?'#eef6ff':'#fff'};color:${i===activeProfileIndex?'#1976d2':'#555'};border-radius:7px;padding:0 9px;cursor:pointer;font-size:10.5px;font-weight:${i===activeProfileIndex?'700':'500'};white-space:nowrap;`;
            b.onclick=()=>loadProfileToUi(i);
            tabScroll.appendChild(b);
        });
        addCardBtn.title='Добавить вариант карточки';
        addCardBtn.disabled=profiles.length>=30;
    }

    addCardBtn.addEventListener('click',()=>{
        readUiIntoProfile();
        profiles.push(cleanProfile({name:`Карточка ${profiles.length+1}`},profiles.length));
        loadProfileToUi(profiles.length-1);
    });

    removeCardBtn.addEventListener('click',()=>{
        if (profiles.length <= 1) {
            hooks.notify('⚠️ Должен остаться хотя бы один вариант карточки','warning');
            return;
        }
        readUiIntoProfile();
        const removed = profiles.splice(activeProfileIndex,1)[0];
        activeProfileIndex = Math.max(0, Math.min(activeProfileIndex, profiles.length-1));
        hooks.notify(`🗑 Удалён вариант «${removed?.name || 'Карточка'}»`,'info');
        loadProfileToUi(activeProfileIndex);
    });

    closeX.addEventListener('click',()=>closePanel());

    async function saveProfiles(){
        readUiIntoProfile();
        const cleaned=profiles.map(cleanProfile).filter(p=>p.tile||p.link||p.price||p.title);
        if(!cleaned.length || cleaned.some(p=>!p.tile)){
            hooks.notify('⚠️ Для каждого варианта укажите селектор карточки','warning'); return;
        }
        saveBtn.disabled=true;saveBtn.textContent='⏳ Сохраняю…';
        try{
            const stored=await new Promise(r=>chrome.storage.local.get(['sites'],r));
            const sites=stored.sites || await fetch(chrome.runtime.getURL('sites.json')).then(r=>r.json());
            const name=hooks.siteName || (hostname.replace(/^www\\./,'').split('.')[0]+'_custom');
            const prev=sites[name]||{};
            const first=cleaned[0];
            const newCfg={...prev,domains:[...new Set([...(prev.domains||[]),hostname])],cards:cleaned,tile:first.tile,price:first.price,title:first.title,link:first.link,id:first.id,idConfig:first.idConfig||null,reviews:first.reviews,rating:first.rating,delivery:first.delivery,weight:first.weight};
            delete newCfg.tileExtra;
            sites[name]=newCfg;
            await new Promise(r=>chrome.storage.local.set({sites},r));
            hooks.notify(`✅ Сохранено вариантов карточек: ${cleaned.length}`);
            await hooks.reload?.();
            closePanel();
        }catch(e){hooks.notify('⚠️ Не удалось сохранить: '+e.message,'warning');saveBtn.disabled=false;saveBtn.textContent='💾 Сохранить';}
    }
    saveBtn.addEventListener('click',saveProfiles);

    diffBtn.addEventListener('click',()=>{
        readUiIntoProfile();
        const currentConfig={...(hooks.currentConfig||{}),cards:profiles.map(cleanProfile)};
        ['_broken','_heuristic','_siteName','_originalConfig'].forEach(k=>delete currentConfig[k]);
        const suggestedConfig={...currentConfig,cards:profiles.map(cleanProfile),tile:profiles[0]?.tile||''};
        chrome.storage.local.set({_selectorDiffPending:{siteName:hooks.siteName||hostname,domain:hostname,currentConfig,suggestedConfig,selectorStatus:{}}},()=>chrome.runtime.sendMessage({action:'openSettings'}));
    });

    document.body.appendChild(panel);
    loadProfileToUi(0);
    renderTabs();

    const pickerHoverCapture = e => {
        if (!panel.isConnected) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        let hovered = null;
        for (const node of path) {
            if (!node || node.nodeType !== 1) continue;
            if (node.closest?.('#ss-picker-panel') || node.closest?.('#ss-picker-choice')) continue;
            hovered = node;
            break;
        }
        if (!hovered) {
            try {
                hovered = document.elementsFromPoint(e.clientX, e.clientY).find(el => el && el.nodeType===1 && !el.closest?.('#ss-picker-panel') && !el.closest?.('#ss-picker-choice'));
            } catch {}
        }
        if (!hovered) return;
        lastHoveredPageElement = hovered;
        // Сохраняем сам узел и ближайший корень карточки сразу. Даже если сайт
        // удалит popup после keydown, ссылка на DOM-узел/его subtree уже у нас.
        // Дополнительно запоминаем путь предков для диагностики в окне выбора.
        const hoveredPath = pickerGetPath(hovered, null);
        // Делаем снимки отдельно для каждого типа поля. Селектор и корень
        // вычисляются сейчас, пока popup ещё существует.
        for (const target of [lastPickerTarget, {kind:'field',key:'tile',label:'🧩 Карточка'}]) {
            const key = target.kind==='extra' ? `extra:${target.index}` : target.key;
            if (target.kind==='extra' && !(profiles[activeProfileIndex]?.extras?.[target.index])) continue;
            let tileSel = target.kind==='field' && target.key==='tile' ? '' : getTileSelectorValue();
            let root = null;
            if (!tileSel) root = hovered;
            else { try { root = hovered.matches?.(tileSel) ? hovered : hovered.closest(tileSel); } catch {} }
            let candidates=[];
            try { candidates=pickerBuildCandidates(hovered,root,target.kind==='extra'?'extra':target.key); } catch {}
            lastHoveredSnapshots.set(key,{el:hovered,root,candidates,path:hoveredPath});
        }
    };
    document.addEventListener('mousemove', pickerHoverCapture, true);
    document.addEventListener('pointerover', pickerHoverCapture, true);

    const pickerShortcutHandler = e => {
        if (!panel.isConnected || e.key.toLowerCase() !== 's' || !e.altKey || !e.shiftKey) return;
        if (e.ctrlKey || e.metaKey) return;
        const target = lastPickerTarget;
        const key = target.kind==='extra' ? `extra:${target.index}` : target.key;
        const btn = target.kind==='extra'
            ? document.querySelectorAll('.ss-extra-pick')[target.index]
            : fieldEls[target.key]?.pickBtn;
        // Для дополнительных атрибутов используем сохранённую кнопку напрямую.
        const targetButton = target.kind==='extra' ? (lastPickerTarget.button?.isConnected ? lastPickerTarget.button : null) : btn;
        const activeBtn = target.kind==='extra' ? targetButton : btn;
        if (!activeBtn || activeBtn.disabled) return;
        let snap = lastHoveredSnapshots.get(key) || lastHoveredSnapshots.get(target.kind==='field' && target.key==='tile' ? 'tile' : key);
        // Если мышь не двигалась после открытия панели, пробуем поймать текущий
        // :hover прямо в capture-фазе keydown — до того, как сайт успеет закрыть popup.
        if (!snap?.el) {
            try {
                const hoveredNow = [...document.querySelectorAll(':hover')].reverse().find(el => el && el.nodeType===1 && !el.closest?.('#ss-picker-panel') && !el.closest?.('#ss-picker-choice'));
                if (hoveredNow) {
                    const tileSel = target.kind==='field' && target.key==='tile' ? '' : getTileSelectorValue();
                    let root = null;
                    if (!tileSel) root = hoveredNow;
                    else { try { root = hoveredNow.matches?.(tileSel) ? hoveredNow : hoveredNow.closest(tileSel); } catch {} }
                    let candidates=[]; try { candidates=pickerBuildCandidates(hoveredNow,root,target.kind==='extra'?'extra':target.key); } catch {}
                    snap={el:hoveredNow,root,candidates};
                }
            } catch {}
        }
        if (snap?.el) {
            activeBtn._preservedPickerTarget = snap.el;
            activeBtn._preservedPickerTileRoot = snap.root;
            activeBtn._preservedPickerCandidates = snap.candidates || [];
        }
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Не вызываем .click(): hover-popup может закрыться от смены фокуса/состояния.
        // Snapshot уже сохранён до keydown, поэтому запускаем picker напрямую.
        try {
            const starter=activeBtn._startPicker;
            if(starter) starter(snap?.el||null,snap?.candidates||null,snap?.root||null);
        } catch(err) { console.warn('[ShoppingSorter] shortcut picker failed',err); }
    };
    document.addEventListener('keydown', pickerShortcutHandler, true);

    function closePanel(){
        pickerStopPicking();pickerRemoveChoice();_pickerActiveHighlights.clear();pickerClearHighlightBoxes();pickerTeardownScrollSync();
        panel._cleanupDrag?.(); panel._cleanupIsolation?.(); document.removeEventListener('keydown', pickerShortcutHandler, true); document.removeEventListener('mousemove', pickerHoverCapture, true); document.removeEventListener('pointerover', pickerHoverCapture, true); lastHoveredSnapshots.clear(); lastHoveredPageElement=null; panel.remove();hooks.restore?.();
    }
    revalidateAll();
    return {close:closePanel};
}
