console.log('✅ Shopping фильтр content.js загружен');

// ─── Селекторы загружаются из sites.json ──────────────────────────────────────
let SELECTORS = null;
let SELECTOR_PROFILES = [];
// Живой счётчик карточек показываем только для сайтов, которые явно
// присутствуют в базе и совпали по домену. На случайных страницах (например
// YouTube) он не должен появляться даже если на странице есть похожие элементы.
let siteKnownInDatabase = false;
let TILE_PROFILE_MAP = new WeakMap();
let UNITS = null;

const CURRENT_PAGE_LINK_SELECTOR = '__CURRENT_PAGE__';

// Глобальный переключатель расширения. В выключенном состоянии content script
// остаётся загруженным браузером, но тяжёлая инициализация, наблюдатели,
// периодические пересборы и живой счётчик не работают.
let extensionEnabled = true;
let extensionInitialized = false;
let extensionInitInProgress = false;
let virtualizationThreshold = 500; // 0 = always use normal rendering
let virtualRenderCleanup = null;
let ssMutationObserver = null;
let ssMutationTimer = null;
let ssScrollTimer = null;
let ssPeriodicTimer = null;

function removeExtensionRuntime() {
    if (ssMutationTimer) { clearTimeout(ssMutationTimer); ssMutationTimer = null; }
    if (ssScrollTimer) { clearTimeout(ssScrollTimer); ssScrollTimer = null; }
    if (ssPeriodicTimer) { clearInterval(ssPeriodicTimer); ssPeriodicTimer = null; }
    if (ssMutationObserver) { try { ssMutationObserver.disconnect(); } catch {} ssMutationObserver = null; }
    try { window.removeEventListener('scroll', window._ssCollectOnScroll); } catch {}
    if (window._ssClosePopup) { try { window._ssClosePopup(); } catch {} }
    window._ssCollectOnScroll = null;
    try { liveCounterEnabled = false; } catch {}
    try { liveCounterEl?.remove(); } catch {}
    liveCounterEl = null;
    try { rejectedPanelEl?.remove(); } catch {}
    rejectedPanelEl = null;
    extensionInitialized = false;
}

function setExtensionEnabled(enabled) {
    extensionEnabled = enabled !== false;
    if (!extensionEnabled) {
        removeExtensionRuntime();
        return;
    }
    if (!extensionInitialized && !extensionInitInProgress) init();
}

// Изначально extensionEnabled и liveCounterEnabled читались двумя ОТДЕЛЬНЫМИ
// асинхронными chrome.storage.local.get — из-за этого при выключенном
// расширении счётчик карточек (🔎 плашка внизу страницы) мог всё равно
// показаться после обновления страницы: его собственный колбэк ничего не
// знал про extensionEnabled и мог отработать раньше или независимо от него.
// Читаем оба флага одним вызовом, чтобы решение принималось по обоим сразу.
chrome.storage.local.get(['extensionEnabled', 'liveCounterEnabled', 'virtualizationThreshold'], d => {
    extensionEnabled = d.extensionEnabled !== false;
    liveCounterEnabled = extensionEnabled && !!d.liveCounterEnabled;
    const vt = Number(d.virtualizationThreshold);
    virtualizationThreshold = Number.isFinite(vt) && vt >= 0 ? Math.min(10000, Math.round(vt)) : 500;
    if (extensionEnabled) init();
    updateLiveCounterBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.extensionEnabled) setExtensionEnabled(changes.extensionEnabled.newValue !== false);
    if (changes.virtualizationThreshold) {
        const vt = Number(changes.virtualizationThreshold.newValue);
        virtualizationThreshold = Number.isFinite(vt) && vt >= 0 ? Math.min(10000, Math.round(vt)) : 500;
        try { if (typeof currentTiles !== 'undefined' && productsContainer?.isConnected) applyFilters(); } catch (_) {}
    }
});

// Настройки бейджа цены/единицы (ppg-badge).
let ppgBadgeVisible = true;
let ppgBadgePosition = 'top-left';
let ppgBadgeMode = 'all'; // all = все уникальные варианты, current = только выбранная приоритетная величина
// Какая единица показывается в цене за ед. для каждой категории (кг vs г, л vs мл, мм/см/м…).
// Значения по умолчанию сохраняют прежнее поведение (крупная единица: кг/л/шт/м).
let badgeDisplayUnit = { weight: 'кг', volume: 'л', pieces: 'шт', length: 'м' };
const PPG_BADGE_POSITIONS = {
    'top-left':    { top: '8px', bottom: 'auto', left: '8px', right: 'auto' },
    'top-right':   { top: '8px', bottom: 'auto', left: 'auto', right: '8px' },
    'bottom-left': { top: 'auto', bottom: '8px', left: '8px', right: 'auto' },
    'bottom-right':{ top: 'auto', bottom: '8px', left: 'auto', right: '8px' },
};

chrome.storage.local.get(['ppgBadgeVisible', 'ppgBadgePosition', 'ppgBadgeMode', 'badgeDisplayUnit'], d => {
    ppgBadgeVisible = d.ppgBadgeVisible !== false;
    if (PPG_BADGE_POSITIONS[d.ppgBadgePosition]) ppgBadgePosition = d.ppgBadgePosition;
    if (d.ppgBadgeMode === 'current' || d.ppgBadgeMode === 'all') ppgBadgeMode = d.ppgBadgeMode;
    if (d.badgeDisplayUnit && typeof d.badgeDisplayUnit === 'object') {
        badgeDisplayUnit = { ...badgeDisplayUnit, ...d.badgeDisplayUnit };
    }
});

// Список единиц, между которыми можно переключаться для категории — все слова,
// заданные в настройках единиц (units.json / настройки → единицы измерения),
// без схлопывания «одинаковых» по множителю. Так пользователь может выбрать
// ровно то обозначение, которое хочет (например «таблетка» вместо «шт»),
// а не то, что система сочла «главным».
function getCategoryUnitChoices(category) {
    const cat = UNITS?.[category];
    if (!cat) return [];
    return Object.entries(cat.units || {})
        .map(([unit, entry]) => ({
            unit,
            multiplier: (entry && typeof entry === 'object') ? Number(entry.multiplier) || 1 : Number(entry) || 1,
        }))
        .sort((a, b) => a.multiplier - b.multiplier || a.unit.localeCompare(b.unit, 'ru'));
}

function applyPpgBadgeSettings(badge) {
    if (!badge) return;
    const pos = PPG_BADGE_POSITIONS[ppgBadgePosition] || PPG_BADGE_POSITIONS['top-left'];
    badge.style.display = ppgBadgeVisible ? 'block' : 'none';
    badge.style.top = pos.top;
    badge.style.bottom = pos.bottom;
    badge.style.left = pos.left;
    badge.style.right = pos.right;
}

function updateAllPpgBadges() {
    document.querySelectorAll('#products-sorted-popup .ppg-badge').forEach(applyPpgBadgeSettings);
}

// src/content/config/sites.js

function getSelectorProfileForTile(tile) {
    if (!tile) return null;
    const mapped = TILE_PROFILE_MAP.get(tile);
    if (mapped) return mapped;
    for (const p of SELECTOR_PROFILES) {
        for (const sel of selectorValueArray(p?.tile)) {
            try { if (sel && tile.matches?.(sel)) return p; } catch { }
        }
    }
    return SELECTOR_PROFILES[0] || null;
}

function selectorValueArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
}

function profileFieldSelectors(tile, field) {
    const profile = getSelectorProfileForTile(tile);
    if (!profile) return [];
    return selectorValueArray(profile[field]);
}

function findWithinTileOrSelf(tile, selector) {
    if (!tile || !selector) return null;
    if (selector === CURRENT_PAGE_LINK_SELECTOR) return tile;
    try { if (tile.matches?.(selector)) return tile; } catch { }
    try { return tile.querySelector(selector); } catch { return null; }
}

// src/content/config/units.js

// src/content/config/domains.js

async function loadSelectors() {
    try {
        const [defaultSites, defaultUnits] = await Promise.all([
            fetch(chrome.runtime.getURL('sites.json')).then(r => r.json()),
            fetch(chrome.runtime.getURL('units.json')).then(r => r.json()),
        ]);
        const stored = await new Promise(resolve => chrome.storage.local.get(['sites', 'units'], resolve));
        const sites = stored.sites ?? defaultSites;
        UNITS = normalizeUnitsConfig(stored.units ?? defaultUnits);
        invalidateTileMetricsCache();
        window.__SS_UNITS_FOR_PICKER = UNITS;
        const hostname = window.location.hostname;
        siteKnownInDatabase = false;

        function tryConfig(config) {
            const profiles = normalizeSelectorProfiles(config);
            if (!profiles.length) return null;
            return profiles.map((p, index) => {
                let best = null;
                for (const sel of selectorValueArray(p.tile)) {
                    try {
                        const count = document.querySelectorAll(sel).length;
                        if (count && (!best || count > best.count)) best = { sel, count };
                    } catch { }
                }
                return { ...p, tile: best?.sel || p.tile, _foundCount: best?.count || 0, _profileIndex: index };
            });
        }

        for (const [name, config] of Object.entries(sites)) {
            if (config.domains?.some(d => hostnameMatchesDomain(hostname, d))) {
                const working = tryConfig(config);
                if (working) {
                    SELECTOR_PROFILES = working;
                invalidateTileMetricsCache();
                    invalidateTileMetricsCache();
                    siteKnownInDatabase = true;
                    SELECTORS = { ...config, cards: working, tile: working.map(p => p.tile).join(', '), _originalConfig: config, _siteName: name, _knownInDatabase: true };
                    console.log(`✅ определён сайт по домену — ${name}, шаблонов карточек: ${working.length}`);
                    scheduleBreakCheck();
                    return;
                }
                SELECTOR_PROFILES = normalizeSelectorProfiles(config);
                invalidateTileMetricsCache();
                siteKnownInDatabase = true;
                SELECTORS = { ...config, _broken: true, _siteName: name, _originalConfig: config, _knownInDatabase: true };
                scheduleBreakCheck();
                return;
            }
        }

        for (const [name, config] of Object.entries(sites)) {
            const working = tryConfig(config);
            if (working) {
                SELECTOR_PROFILES = working;
                SELECTORS = { ...config, cards: working, tile: working.map(p => p.tile).join(', '), _originalConfig: config, _siteName: name, _knownInDatabase: false };
                console.log(`✅ определён сайт по DOM — ${name}, шаблонов карточек: ${working.length}`);
                scheduleBreakCheck();
                return;
            }
        }

        console.warn('⚠️ сайт не распознан:', hostname);
        SELECTOR_PROFILES = [];
        invalidateTileMetricsCache();
        SELECTORS = {
            tile:'', price:'', title:'', link:'', id:'', _broken:true, _knownInDatabase:false,
            _siteName:hostname, _originalConfig:{tile:'',price:'',title:'',link:'',domains:[hostname]}
        };
        scheduleBreakCheck();
    } catch (e) {
        console.error('⚠️ ошибка загрузки конфига:', e);
    }
}

// ─── Эвристическое обнаружение карточек без селекторов ────────────────────────

function detectTilesHeuristic() {
    const PRICE_RE = /\d[\d\s\u00A0.,]*[\s\u00A0]*(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)|(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)[\s\u00A0]*\d/i;

    // ── Шаг 1: все «листовые» элементы с ценой ──────────────────────────────
    const allEls = [...document.querySelectorAll('*')];
    const priceEls = allEls.filter(el => {
        if (el.children.length > 1) return false;
        const t = el.textContent.trim();
        if (t.length < 2 || t.length > 50) return false;
        return PRICE_RE.test(t);
    });

    console.log('🔍 эвристика шаг1: ценовых', priceEls.length);
    if (priceEls.length < 2) return null;

    // ── Шаг 2: от каждого ценового элемента идём вверх до карточки ─────────
    // Карточка = предок который содержит и ссылку и картинку (или достаточно детей)
    function walkUpToCard(el) {
        let cur = el.parentElement;
        let steps = 0;
        while (cur && cur.tagName !== 'BODY' && steps < 15) {
            const hasLink = !!(cur.matches?.('a[href]') || cur.querySelector('a[href]'));
            const hasImg = !!cur.querySelector('img');
            // Достаточный признак карточки: есть ссылка + картинка, или ссылка + много детей
            if (hasLink && (hasImg || cur.children.length >= 3)) return cur;
            cur = cur.parentElement;
            steps++;
        }
        return null;
    }

    // ── Шаг 3: строим стабильный CSS-селектор ────────────────────────────────
    function buildSel(el) {
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        if (el.id && /^[a-zA-Z][a-zA-Z-_]*$/.test(el.id)) return '#' + el.id;
        const stable = [...el.classList].filter(cls =>
            cls.length > 2 && cls.length < 50 &&
            !/\d{3,}/.test(cls) &&        // нет 3+ цифр подряд (хэши типа Ab3f9c)
            !/^[_\d]/.test(cls) &&         // не начинается с _ или цифры
            !/^j-/.test(cls)               // не служебные j-* (wildberries)
        );
        // Предпочитаем классы без BEM-модификатора (--), берём ТОЛЬКО ОДИН —
        // чтобы не создавать составные селекторы которые не совпадут с частью карточек
        const noMod = stable.filter(c => !c.includes('--'));
        const chosen = (noMod.length ? noMod : stable)[0];
        if (!chosen) return tag;
        return tag + '.' + chosen;
    }

    // ── Шаг 4: группируем карточки по селектору, считаем голоса ─────────────
    const votes = new Map(); // selector → count

    for (const priceEl of priceEls.slice(0, 60)) {
        const card = walkUpToCard(priceEl);
        if (!card) continue;
        const sel = buildSel(card);
        if (!sel || sel.length < 3) continue;
        votes.set(sel, (votes.get(sel) || 0) + 1);
    }

    if (!votes.size) return null;

    // ── Шаг 5: выбираем победителя ───────────────────────────────────────────
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);

    let tileSel = null;
    let tileCards = null;

    for (const [sel] of ranked) {
        let found;
        try { found = [...document.querySelectorAll(sel)]; } catch { continue; }
        if (found.length < 2) continue;
        // Большинство карточек должны содержать ссылку и цену
        const withLink = found.filter(c => c.matches?.('a[href]') || c.querySelector('a[href]')).length;
        const withPrice = found.filter(c => PRICE_RE.test(c.textContent)).length;
        if (withLink < found.length * 0.5) continue;
        if (withPrice < found.length * 0.4) continue;
        tileSel = sel;
        tileCards = found;
        break;
    }

    if (!tileSel || !tileCards) return null;

    // ── Шаг 5б: поднимаемся вверх до «верхнего» элемента карточки ───────────
    // Идея: tile должен быть прямым потомком контейнера-сетки.
    // Идём от найденной карточки вверх: пока родитель содержит ≥3 siblings
    // с ценой и ссылкой — значит мы ещё внутри карточки, поднимаемся выше.
    // Останавливаемся когда родитель перестаёт быть «списком карточек».
    function liftToContainer(card) {
        let cur = card;
        while (cur.parentElement && cur.parentElement.tagName !== 'BODY') {
            const parent = cur.parentElement;
            // Считаем сколько прямых детей родителя похожи на карточки
            const siblings = [...parent.children].filter(ch =>
                ch !== cur &&
                PRICE_RE.test(ch.textContent) &&
                (ch.matches?.('a[href]') || !!ch.querySelector('a[href]'))
            );
            // Если родитель содержит ≥2 других карточек — он контейнер, cur = нужный tile
            if (siblings.length >= 2) return cur;
            // Иначе поднимаемся
            cur = parent;
        }
        return card; // fallback
    }

    const liftedCard = liftToContainer(tileCards[0]);
    if (liftedCard !== tileCards[0]) {
        const liftedSel = buildSel(liftedCard);
        if (liftedSel) {
            try {
                const liftedAll = [...document.querySelectorAll(liftedSel)];
                if (liftedAll.length >= 2 &&
                    liftedAll.filter(c => c.matches?.('a[href]') || c.querySelector('a[href]')).length >= liftedAll.length * 0.5 &&
                    liftedAll.filter(c => PRICE_RE.test(c.textContent)).length >= liftedAll.length * 0.4) {
                    tileSel = liftedSel;
                    tileCards = liftedAll;
                }
            } catch { }
        }
    }

    // ── Шаг 6: ищем дочерние селекторы price / title / link ─────────────────
    const sample = tileCards.slice(0, 20);

    function findCommonChild(cards, predicate) {
        const score = new Map();
        for (const card of cards) {
            const matches = [...card.querySelectorAll('*')].filter(predicate);
            if (!matches.length) continue;
            // Самый глубокий подходящий элемент — наиболее специфичный
            const best = matches[matches.length - 1];
            const sel = buildSel(best);
            if (sel && sel !== tileSel) score.set(sel, (score.get(sel) || 0) + 1);
        }
        if (!score.size) return null;
        const [[bestSel, hits]] = [...score.entries()].sort((a, b) => b[1] - a[1]);
        return hits >= Math.max(2, cards.length * 0.4) ? bestSel : null;
    }

    // Цена: ищем элемент с наименьшей суммой среди «чистых» цен.
    // Чистая цена = только число + знак валюты, без лишних слов (рассрочка, х мес и т.п.)
    // Зачёркнутые цены (del, s, strike, text-decoration:line-through) исключаем.
    const PRICE_CLEAN_RE = /^[~≈]?\s*\d[\d\s\u00A0.,]*\s*(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)\s*$|^(?:[₽$€£¥₺₴₸]|руб(?:лей|ля|ль)?\.?|тенге|сом|драм|лари|манат|тг\.?|грн\.?)\s*\d[\d\s\u00A0.,]*\s*$/i;
    const STRIKETHROUGH_TAGS = new Set(['DEL', 'S', 'STRIKE']);

    function parsePrice(t) {
        const m = t.replace(/[\s\u00A0]/g, '').match(/[\d.,]+/);
        if (!m) return Infinity;
        return parseFloat(m[0].replace(',', '.'));
    }

    function isStrikethrough(el) {
        if (STRIKETHROUGH_TAGS.has(el.tagName)) return true;
        // Проверяем CSS text-decoration на самом элементе и ближайших предках
        let cur = el;
        for (let i = 0; i < 4 && cur; i++) {
            const td = getComputedStyle(cur).textDecorationLine || '';
            if (td.includes('line-through')) return true;
            cur = cur.parentElement;
        }
        return false;
    }

    const priceSel = (() => {
        // Для каждой карточки из sample собираем все чистые не-зачёркнутые цены
        const score = new Map(); // sel → { hits, minPrice }

        for (const card of sample) {
            const candidates = [...card.querySelectorAll('*')].filter(el => {
                if (el.children.length > 1) return false;
                const t = el.textContent.trim();
                if (!PRICE_CLEAN_RE.test(t)) return false;       // только чистый формат
                if (isStrikethrough(el)) return false;            // не зачёркнутые
                return true;
            });
            if (!candidates.length) continue;

            // Берём кандидата с минимальной суммой (актуальная цена, не старая)
            const best = candidates.reduce((a, b) =>
                parsePrice(a.textContent) <= parsePrice(b.textContent) ? a : b
            );
            const sel = buildSel(best);
            if (!sel || sel === tileSel) continue;
            const prev = score.get(sel) || { hits: 0, minPrice: Infinity };
            score.set(sel, { hits: prev.hits + 1, minPrice: Math.min(prev.minPrice, parsePrice(best.textContent)) });
        }

        if (!score.size) return null;
        const threshold = Math.max(2, sample.length * 0.4);
        const valid = [...score.entries()].filter(([, v]) => v.hits >= threshold);
        if (!valid.length) return null;
        // Из прошедших порог — берём с наименьшей медианной ценой
        valid.sort((a, b) => a[1].minPrice - b[1].minPrice);
        return valid[0][0];
    })();

    // Заголовок: текстовый элемент без цены, достаточно длинный.
    // Исключаем: числа-рейтинги (короткие числа/дроби), счётчики оценок ("60 оценок"),
    // кнопки, даты доставки и прочие нетекстовые блоки.
    const RATING_RE = /^\d[\d.,]*$|оцен|отзыв|рейтинг|\bзвезд|\bstar/i;
    const titleSel = findCommonChild(sample, el => {
        if (el.children.length > 2) return false;
        const t = el.textContent.trim();
        if (t.length <= 10 || t.length >= 300) return false;
        if (PRICE_RE.test(t)) return false;
        if (RATING_RE.test(t)) return false;
        // Не должен быть кнопкой или интерактивным элементом
        if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return false;
        return true;
    });

    // Ссылка: a[href] с уникальным href (не одинаковым у всех карточек — например «В корзину»).
    // Собираем href всех кандидатов и выбираем селектор у которого href уникален в каждой карточке.
    const linkSel = (() => {
        const score = new Map(); // sel → { hits, uniqueCount }
        for (const card of sample) {
            const links = [...card.querySelectorAll('a[href]')];
            if (!links.length) continue;
            for (const a of links) {
                const href = a.getAttribute('href');
                if (!href || href === '#' || href === '/lk/basket' || href.startsWith('javascript')) continue;
                const sel = buildSel(a);
                if (!sel || sel === tileSel) continue;
                score.set(sel, (score.get(sel) || 0) + 1);
            }
        }
        if (!score.size) return null;
        const threshold = Math.max(2, sample.length * 0.4);
        // Из кандидатов прошедших порог выбираем тот чьи href уникальны (не одинаковые у всех)
        const valid = [...score.entries()].filter(([, hits]) => hits >= threshold);
        if (!valid.length) return null;
        // Проверяем уникальность href: берём первые 5 карточек, смотрим разные ли href
        for (const [sel] of valid.sort((a, b) => b[1] - a[1])) {
            const hrefs = sample.slice(0, 5).map(card => {
                try { return card.querySelector(sel)?.getAttribute('href'); } catch { return null; }
            }).filter(Boolean);
            const unique = new Set(hrefs);
            if (unique.size >= Math.min(3, hrefs.length)) return sel; // ≥3 разных href = уникальные ссылки
        }
        return valid[0]?.[0] || null;
    })();

    console.log('🔍 Эвристика результат:', { tileSel, priceSel, titleSel, linkSel, found: tileCards.length });

    return {
        tile: tileSel,
        price: priceSel || '[class*="price"]',
        title: titleSel || '[class*="title"]',
        link: linkSel || 'a[href]',
    };
}

// Строит минимальный стабильный CSS-селектор для элемента
function buildMinimalSelector(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (el.id && /^[a-zA-Z][a-zA-Z-_]*$/.test(el.id)) return '#' + el.id;
    const stable = [...el.classList].filter(cls =>
        cls.length > 2 && cls.length < 50 &&
        !/\d{3,}/.test(cls) &&
        !/^[_\d]/.test(cls) &&
        !/^j-/.test(cls)
    );
    const noMod = stable.filter(c => !c.includes('--'));
    const chosen = (noMod.length ? noMod : stable)[0];
    if (!chosen) return tag;
    return tag + '.' + chosen;
}

// Находит CSS-селектор дочернего элемента, который встречается в большинстве карточек
function findCommonChildSelector(cards, predicate) {
    if (!cards.length) return null;
    const selScore = new Map();
    for (const card of cards.slice(0, 20)) {
        const all = [...card.querySelectorAll('*')];
        const matches = all.filter(predicate);
        if (!matches.length) continue;
        const best = matches[matches.length - 1];
        const sel = buildMinimalSelector(best);
        if (sel) selScore.set(sel, (selScore.get(sel) || 0) + 1);
    }
    if (!selScore.size) return null;
    const [[bestSel, hits]] = [...selScore.entries()].sort((a, b) => b[1] - a[1]);
    if (hits < Math.max(2, cards.length * 0.4)) return null;
    return bestSel;
}

// Ожидает подтверждения пользователя перед применением
let _pendingHeuristic = null;

function tryHeuristicSelectors(brokenConfig) {
    const heuristic = detectTilesHeuristic();
    if (!heuristic) return;
    console.log('🔍 эвристика нашла кандидатов:', heuristic.tile);
    _pendingHeuristic = {
        heuristic,
        resolvedConfig: {
            ...brokenConfig,
            tile: heuristic.tile,
            price: heuristic.price || brokenConfig.price,
            title: heuristic.title || brokenConfig.title,
            link: heuristic.link || brokenConfig.link,
            _heuristic: true,
            _broken: true,
            _originalConfig: brokenConfig._originalConfig || brokenConfig,
        },
    };
    showHeuristicBanner();
}

function showHeuristicBanner() {
    if (!_pendingHeuristic) return;
    const popup = document.getElementById('products-sorted-popup');
    if (!popup) return; // попап не открыт — покажем при открытии
    popup.querySelector('#ss-heuristic-banner')?.remove();
    const h = _pendingHeuristic.heuristic;
    const count = (() => {
        try { return document.querySelectorAll(h.tile).length; } catch { return 0; }
    })();
    if (count === 0) return;
    const banner = document.createElement('div');
    banner.id = 'ss-heuristic-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
        + 'background:#fff;border:1px solid #ffb74d;border-radius:10px;'
        + 'padding:14px 20px;box-shadow:0 4px 20px rgba(0,0,0,0.18);'
        + 'z-index:2147483646;font-family:sans-serif;font-size:13px;'
        + 'display:flex;flex-direction:column;gap:10px;max-width:420px;width:90%;';
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#555;line-height:1.5;';
    msg.innerHTML = '🔍 <b>Эвристика нашла ~' + count
        + ' карточек</b> на этой странице.<br>'
        + '<span style="font-size:11px;color:#888;">Селектор: <code>' + h.tile + '</code></span>';
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '✅ Показать в поиске';
    applyBtn.style.cssText = 'padding:6px 14px;border:1px solid #4CAF50;border-radius:6px;cursor:pointer;'
        + 'background:#e8f5e9;color:#2e7d32;font-weight:bold;font-size:12px;';
    applyBtn.onclick = () => { applyHeuristicSelectors(); banner.remove(); };
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Не сейчас';
    dismissBtn.style.cssText = 'padding:6px 12px;border:1px solid #ccc;border-radius:6px;cursor:pointer;'
        + 'background:#f9f9f9;color:#666;font-size:12px;';
    dismissBtn.onclick = () => { _pendingHeuristic = null; banner.remove(); };
    btns.appendChild(applyBtn);
    btns.appendChild(dismissBtn);
    banner.appendChild(msg);
    banner.appendChild(btns);
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 20000);
}

function applyHeuristicSelectors() {
    if (!_pendingHeuristic) return;
    SELECTORS = _pendingHeuristic.resolvedConfig;
    _pendingHeuristic = null;
    console.log('🔍 эвристика применена:', SELECTORS.tile);
    collectTiles();
    window._ssRefreshSearch?.();
}


// Через 3с после загрузки проверяем нашли ли карточки
function checkSelectorWorks(sel, context) {
    if (!sel) return false;
    try {
        const els = Array.isArray(sel) ? sel : [sel];
        return els.some(s => (context || document).querySelector(s));
    } catch { return false; }
}

function scheduleBreakCheck() {
    setTimeout(() => {
        // Повторная проверка после позднего рендера SPA. Каждый профиль карточки проверяется независимо.
        for (const p of SELECTOR_PROFILES) {
            if (p && p._foundCount === 0) {
                let best = null;
                for (const sel of selectorValueArray(p.tile)) { try { const n=document.querySelectorAll(sel).length; if(n && (!best || n>best.count)) best={sel,count:n}; } catch {} }
                if(best){ p.tile=best.sel; p._foundCount=best.count; }
            }
        }
        if (!SELECTORS) { window._tileCheckResult = { found: 0, broken: true }; return; }

        // SELECTORS.tile может быть массивом или строкой — нормализуем
        const tileSels = Array.isArray(SELECTORS.tile) ? SELECTORS.tile : [SELECTORS.tile].filter(Boolean);
        const priceSels = Array.isArray(SELECTORS.price) ? SELECTORS.price : [SELECTORS.price].filter(Boolean);
        const titleSels = Array.isArray(SELECTORS.title) ? SELECTORS.title : [SELECTORS.title].filter(Boolean);
        const linkSels = Array.isArray(SELECTORS.link) ? SELECTORS.link : [SELECTORS.link].filter(Boolean);

        // Ищем первый работающий tile-селектор из массива
        let workingTileSel = null;
        let found = 0;
        for (const s of tileSels) {
            try {
                const n = document.querySelectorAll(s).length;
                if (n > 0) { workingTileSel = s; found = n; break; }
            } catch { }
        }
        const checkTileEl = workingTileSel ? document.querySelector(workingTileSel) : null;

        console.log('🔍 scheduleBreakCheck:', {
            tileSels, workingTileSel, found,
            priceSels, titleSels, linkSels,
            checkTileEl: checkTileEl?.className,
        });

        // Если tile не найден — запускаем эвристику для получения контекста
        let heuristic = null;
        let checkTile = checkTileEl;

        if (!checkTile) {
            heuristic = detectTilesHeuristic();
            console.log('🔍 эвристика (tile=0):', heuristic);
            if (heuristic) {
                checkTile = document.querySelector(heuristic.tile);
            }
        }

        // Реальное количество карточек
        const foundReal = found > 0 ? found
            : (heuristic ? document.querySelectorAll(heuristic.tile).length : 0);

        // Проверяем каждый селектор на реальной карточке
        const selectorStatus = {};
        for (const [key, sels] of [['tile', tileSels], ['price', priceSels], ['title', titleSels], ['link', linkSels]]) {
            if (!sels.length) { selectorStatus[key] = 'missing'; continue; }
            const works = key === 'tile'
                ? found > 0
                : sels.some(sel => {
                    if (!checkTile) return false;
                    if (sel === CURRENT_PAGE_LINK_SELECTOR) return true;
                    return !!findWithinTileOrSelf(checkTile, sel);
                });
            selectorStatus[key] = works ? 'ok' : 'broken';
        }
        for (const key of ['id','reviews','rating','delivery','weight']) {
            const sels = selectorValueArray(orig[key]);
            if (!sels.length) { selectorStatus[key] = 'missing'; continue; }
            if (!checkTile) { selectorStatus[key] = 'broken'; continue; }
            selectorStatus[key] = sels.some(sel => sel === CURRENT_PAGE_LINK_SELECTOR || !!findWithinTileOrSelf(checkTile, sel)) ? 'ok' : 'broken';
        }

        console.log('🔍 selectorStatus:', selectorStatus, 'checkTile:', checkTile?.className);

        // Полный оригинальный конфиг с массивами (для diff-модала)
        const orig = SELECTORS._originalConfig || SELECTORS;
        const toArr = v => !v ? [] : Array.isArray(v) ? v : [v];

        // Эвристические подсказки для сломанных полей
        const anyBroken = Object.values(selectorStatus).some(s => s === 'broken' || s === 'missing');
        let heuristicSuggestions = null;
        if (anyBroken) {
            if (!heuristic) heuristic = detectTilesHeuristic();
            console.log('🔍 эвристика (anyBroken):', heuristic);
            if (heuristic) {
                heuristicSuggestions = {};
                if (selectorStatus.tile !== 'ok' && heuristic.tile) heuristicSuggestions.tile = heuristic.tile;
                if (selectorStatus.price !== 'ok' && heuristic.price) heuristicSuggestions.price = heuristic.price;
                if (selectorStatus.title !== 'ok' && heuristic.title) heuristicSuggestions.title = heuristic.title;
                if (selectorStatus.link !== 'ok' && heuristic.link) heuristicSuggestions.link = heuristic.link;
            }
        }

        console.log('🔍 heuristicSuggestions:', heuristicSuggestions);

        window._tileCheckResult = {
            found: foundReal,
            broken: SELECTORS._broken,
            heuristic: SELECTORS._heuristic,
            siteName: SELECTORS._siteName,
            selectorStatus,
            anyBroken,
            heuristicSuggestions,
            selectors: {
                tile: toArr(orig.tile),
                price: toArr(orig.price),
                title: toArr(orig.title),
                link: toArr(orig.link),
                domains: toArr(orig.domains),
            },
            fullConfig: orig,
        };
        if (found === 0 && !SELECTORS._heuristic) tryHeuristicSelectors(SELECTORS);
    }, 3000);
    [4200, 6500, 9000].forEach(delay => setTimeout(() => {
        let changed = false;
        for (const p of SELECTOR_PROFILES) {
            if (!p || p._foundCount > 0) continue;
            for (const sel of selectorValueArray(p.tile)) { try { const n=document.querySelectorAll(sel).length; if(n){p._foundCount=n; changed=true; break;} } catch {} }
        }
        if (changed) { collectTiles(); window._ssRefreshSearch?.(); }
        updateLiveCounterBadge();
    }, delay));
}


// ─── Хранилище всех увиденных плиток ───────────────────────────────────────────
const seenTiles = new Map();

// ─── Живой счётчик найденных карточек (небольшая плашка на странице) ──────────
// Показывает seenTiles.size в реальном времени, ещё до открытия окна расширения.
// Включается/выключается через popup расширения (чекбокс).
// По клику показывает список карточек, которые сейчас есть на странице,
// но не распознаются расширением — и почему (нет названия/цены/ссылки).
let liveCounterEnabled = false;
let liveCounterEl = null;
let lastRejectedTiles = []; // [{ tile, reasons: string[], snippet: string }] — заполняется в collectTiles()
let rejectedPanelEl = null;

// Начальное значение читается вместе с extensionEnabled (см. выше, в одном
// storage.get) — здесь только реакция на изменение уже после загрузки страницы.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.liveCounterEnabled) return;
    liveCounterEnabled = extensionEnabled && !!changes.liveCounterEnabled.newValue;
    updateLiveCounterBadge();
});

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

// src/content/storage/saved-products.js

migrateBase64FromHtml();

// src/content/products/fields.js

// src/content/products/quantities.js

// src/content/products/fields.js

// src/content/products/collection.js
refreshSavedKeysCache();

// src/content/products/metrics.js

// ─── Обработчик сообщений от popup.js ─────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'sortProducts') {
        if (!extensionEnabled) {
            sendResponse({ success: false, count: 0, reason: 'disabled' });
            return true;
        }
        if (!SELECTORS) {
            createSortedProductsPopup(message.mode || 'asc');
            sendResponse({ success: true, count: 0, reason: 'unsupported' });
            return true;
        }
        const count = createSortedProductsPopup(message.mode || 'asc');
        sendResponse({ success: count > 0, count });
    } else if (message.action === 'openSelectorPicker') {
        openSelectorPickerPanel({
            minimize: () => {},
            restore: () => {},
            notify: (msg, type) => {
                try {
                    const n = document.createElement('div');
                    n.textContent = msg;
                    n.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;
                        background:${type === 'warning' ? '#e65100' : '#2e7d32'};color:#fff;padding:9px 16px;border-radius:8px;
                        font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);`;
                    document.body.appendChild(n);
                    setTimeout(() => n.remove(), 2800);
                } catch {}
            },
            reload: loadSelectors,
            currentConfig: SELECTORS?._originalConfig || SELECTORS || null,
            siteName: SELECTORS?._siteName || null,
            knownInDatabase: !!SELECTORS?._knownInDatabase
        });
        sendResponse({ success: true });
    }
    return true;
});

// src/content/images/storage.js

// src/content/ui/product-card.js

// src/content/ui/folder-dialog.js

// src/content/ui/products-panel.js

// ─── Инициализация ─────────────────────────────────────────────────────────────
async function init() {
    if (!extensionEnabled || extensionInitialized || extensionInitInProgress) return;
    extensionInitInProgress = true;
    try {
        await loadSelectors();
        if (!extensionEnabled || !SELECTORS) return;

        updateLiveCounterBadge();
        collectTiles();

        // Мутации, добавляющие узлы, дебаунсим — на SPA-сайтах один
        // «батч» рендера часто приходит несколькими последовательными мутациями.
        //
        // ВАЖНО: собственный попап расширения (#products-sorted-popup) тоже
        // лежит внутри document.body, а значит попадает под subtree:true.
        // Любое изменение ВНУТРИ попапа — набор текста в поиске (ресайз
        // textarea), открытие/закрытие автодополнения, наведение на бейдж,
        // любые меню и тултипы — это тоже мутации DOM, и раньше каждая из
        // них ложно считалась «страница обновилась», перезапуская 220мс
        // таймер и в итоге вызывая collectTiles() по ВСЕЙ странице (не по
        // попапу!). При 500+ карточках это и ощущалось как лаг при вводе —
        // причём совершенно независимо от галочки «авто», которая управляет
        // только применением ФИЛЬТРОВ, а не пересбором карточек. Поэтому
        // мутации внутри своего же попапа игнорируем целиком.
        const isInsideOwnPopup = node => {
            if (!node) return false;
            const el = node.nodeType === 1 ? node : node.parentElement;
            return !!el?.closest?.('#products-sorted-popup');
        };
        ssMutationObserver = new MutationObserver((mutations) => {
            if (!extensionEnabled) return;
            const relevant = mutations.some(m => {
                if (isInsideOwnPopup(m.target)) return false;
                return m.addedNodes.length > 0 || m.type === 'characterData' || m.type === 'attributes';
            });
            if (!relevant) return;
            clearTimeout(ssMutationTimer);
            ssMutationTimer = setTimeout(() => {
                if (extensionEnabled) collectTiles();
            }, 220);
        });
        if (document.body) {
            ssMutationObserver.observe(document.body, {
                childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['class','style','title','aria-label','data-rating','data-reviews']
            });
        }

        window._ssCollectOnScroll = () => {
            if (!extensionEnabled) return;
            clearTimeout(ssScrollTimer);
            ssScrollTimer = setTimeout(() => { if (extensionEnabled) collectTiles(); }, 150);
        };
        window.addEventListener('scroll', window._ssCollectOnScroll, { passive: true });

        // Подстраховочный периодический пересбор.
        ssPeriodicTimer = setInterval(() => {
            if (extensionEnabled) collectTiles();
        }, 2000);

        extensionInitialized = true;
    } finally {
        extensionInitInProgress = false;
    }
}
