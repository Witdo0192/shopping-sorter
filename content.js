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

function normalizeSelectorProfiles(config) {
    if (!config) return [];
    const raw = Array.isArray(config.cards) ? config.cards
        : (Array.isArray(config.profiles) ? config.profiles : null);
    if (raw?.length) {
        return raw.map((p, i) => ({
            name: p?.name || `Карточка ${i + 1}`,
            tile: p?.tile || '',
            price: p?.price ?? '',
            title: p?.title ?? '',
            link: p?.link ?? '',
            id: p?.id ?? '',
            idConfig: p?.idConfig || null,
            extras: Array.isArray(p?.extras) ? p.extras : [],
            reviews: p?.reviews ?? '',
            rating: p?.rating ?? '',
            delivery: p?.delivery ?? '',
            weight: p?.weight ?? '',
        })).filter(p => p.tile || p.name);
    }
    const extras = Array.isArray(config.tileExtra) ? config.tileExtra.filter(Boolean) : (config.tileExtra ? [config.tileExtra] : []);
    const legacy = { ...config };
    delete legacy.cards; delete legacy.profiles; delete legacy.tileExtra;
    const profiles = [];
    if (legacy.tile) profiles.push({
        name: legacy.name || 'Карточка 1',
        tile: Array.isArray(legacy.tile) ? legacy.tile[0] : legacy.tile,
        price: legacy.price ?? '',
        title: legacy.title ?? '',
        link: legacy.link ?? '',
        id: legacy.id ?? '',
        extras: Array.isArray(legacy.extras) ? legacy.extras : [],
        reviews: legacy.reviews ?? '',
        rating: legacy.rating ?? '',
        delivery: legacy.delivery ?? '',
        weight: legacy.weight ?? '',
    });
    extras.forEach(tile => profiles.push({
        name: `Карточка ${profiles.length + 1}`,
        tile, price:'', title:'', link:'', id:'', extras:[], reviews:'', rating:'', delivery:'', weight:''
    }));
    return profiles;
}

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

// ─── Знаков после запятой для единиц измерения ─────────────────────────────
// Настройка чисто визуальная: внутренние расчёты (сравнение, фильтрация,
// сортировка) всегда используют точное значение q.value / pricePerUnit;
// decimals влияет только на то, сколько цифр показывается в бейдже/фильтре.
function defaultDecimalsForCategory(catKey) { return catKey === 'pieces' ? 0 : 2; }

function clampDecimals(d, catKey) {
    const n = Number(d);
    if (!Number.isFinite(n)) return defaultDecimalsForCategory(catKey);
    return Math.max(0, Math.min(6, Math.round(n)));
}

// ─── Приоритет категории (порядок в режиме «Авто», список в фильтре) ───────
// Встроенные категории по умолчанию сохраняют прежний порядок (вес→объём→штуки→длина);
// новые, добавленные пользователем категории по умолчанию идут в конец (99).
// это можно переопределить полем «Приоритет» в настройках единиц.
const DEFAULT_CATEGORY_PRIORITY = { weight: 0, volume: 1, pieces: 2, length: 3 };

function clampPriority(p, catKey) {
    const n = Number(p);
    if (Number.isFinite(n)) return n;
    return DEFAULT_CATEGORY_PRIORITY[catKey] ?? 99;
}

// Приводит units.json (или сохранённые в chrome.storage настройки) к единому
// виду: каждая единица — {multiplier, decimals}. Поддерживает старый формат
// (единица → просто множитель), чтобы не ломать уже сохранённые у пользователя данные.
function normalizeUnitsConfig(raw) {
    const out = {};
    for (const [catKey, cat] of Object.entries(raw || {})) {
        const units = {};
        for (const [word, val] of Object.entries(cat?.units || {})) {
            if (val && typeof val === 'object') {
                units[word] = { multiplier: Number(val.multiplier) || 1, decimals: clampDecimals(val.decimals, catKey) };
            } else {
                units[word] = { multiplier: Number(val) || 1, decimals: defaultDecimalsForCategory(catKey) };
            }
        }
        out[catKey] = { ...cat, units, priority: clampPriority(cat?.priority, catKey) };
    }
    return out;
}

// Человекочитаемое имя категории для UI — берём заданный пользователем label
// (например «📐 Площадь») и отбрасываем ведущий эмодзи/значок, оставляя текст.
// Работает для любой категории, включая добавленные пользователем.
function getCategoryDisplayName(category) {
    const label = UNITS?.[category]?.label || category;
    const stripped = String(label).replace(/^[^\p{L}]+/u, '').trim();
    return stripped || category;
}

// Категории, отсортированные по приоритету (для «Авто» и списков в UI).
function getCategoryOrderIndex(category) {
    return Object.keys(UNITS || {}).indexOf(category);
}

function compareCategoriesByPriority(a, b) {
    const priorityDiff =
        clampPriority(UNITS?.[a]?.priority, a) - clampPriority(UNITS?.[b]?.priority, b);
    if (priorityDiff) return priorityDiff;

    // При одинаковом приоритете сохраняем порядок категорий в конфигурации
    // (Object.keys(UNITS)), а не используем алфавитный тай-брейк.
    const ai = getCategoryOrderIndex(a);
    const bi = getCategoryOrderIndex(b);
    return ai - bi;
}

function getCategoriesByPriority() {
    return Object.keys(UNITS || {}).sort(compareCategoriesByPriority);
}

// Нормализует введённый пользователем домен для сравнения: убирает протокол,
// www., путь/query после первого "/", приводит к нижнему регистру.
function normalizeDomainForMatch(raw) {
    let d = String(raw || '').trim().toLowerCase();
    d = d.replace(/^[a-z]+:\/\//, '');   // http:// https://
    d = d.replace(/^www\./, '');
    d = d.split('/')[0];                 // отрезаем путь, если случайно вставили ссылку целиком
    d = d.split('?')[0].split('#')[0];
    return d;
}

// Домен из настроек считается совпавшим, если это ТОЧНО тот же хост или его
// поддомен (a.ggsel.net матчит ggsel.net) — но НЕ произвольная подстрока.
// Раньше использовался hostname.includes(d), из-за чего один сайт в базе мог
// случайно "перехватить" другой, если его домен оказывался подстрокой (или
// наоборот) — сайт находился, но не тот, что реально открыт.
function hostnameMatchesDomain(hostname, rawDomain) {
    const h = normalizeDomainForMatch(hostname);
    const d = normalizeDomainForMatch(rawDomain);
    if (!h || !d) return false;
    return h === d || h.endsWith('.' + d);
}

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

migrateBase64FromHtml();

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

// Возвращает все настроенные дополнительные величины карточки.
// В отличие от старой логики «первая найденная величина», здесь сохраняются
// все совпадения селектора, чтобы одна карточка могла одновременно иметь,
// например, вес, объём и количество.
function getAllUnitResultsFromText(text) {
    if (!text || !UNITS) return [];
    const t = normalizeUnitText(String(text));
    let allUnits, unitRe, escapedUnits;
    if (_unitParserCache && _unitParserCache.unitsRef === UNITS && Array.isArray(_unitParserCache.escapedUnits) && _unitParserCache.unitRe) {
        ({allUnits, unitRe, escapedUnits} = _unitParserCache);
    } else {
        allUnits = [];
        for (const [category, config] of Object.entries(UNITS)) {
            for (const [unit, entry] of Object.entries(config.units || {})) {
                const multiplier = (entry && typeof entry === 'object') ? Number(entry.multiplier) || 1 : Number(entry) || 1;
                const decimals = (entry && typeof entry === 'object') ? clampDecimals(entry.decimals, category) : defaultDecimalsForCategory(category);
                allUnits.push({unit, multiplier, decimals, category, base:config.base});
            }
        }
        allUnits.sort((a,b)=>b.unit.length-a.unit.length);
        escapedUnits = allUnits.map(u=>u.unit.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
        if (!escapedUnits.length) return [];
        unitRe = new RegExp(`(-?\\d+(?:[\\.,]\\d+)?)\\s*(${escapedUnits.join('|')})(?![A-Za-zА-Яа-яЁё])`, 'giu');
        _unitParserCache = {unitsRef: UNITS, allUnits, escapedUnits, unitRe};
    }
    const out=[];
    let m;
    while ((m=unitRe.exec(t))) {
        const unit = allUnits.find(u=>u.unit.toLowerCase()===m[2].toLowerCase());
        if (!unit) continue;
        const number = parseFloat(m[1].replace(',','.'));
        if (!Number.isFinite(number)) continue;
        out.push({value:number*unit.multiplier, badgeNumber:number, category:unit.category, base:unit.base, unit:unit.unit, decimals:unit.decimals, raw:m[0]});
    }

    // 85 г × 30 шт / 3 x 100 г / 2 шт по 400 г:
    // сохраняем обе независимые величины — массу/объём и количество.
    const addPieces = count => {
        const n = Number(count);
        if (Number.isFinite(n) && n > 0) {
            const piecesDecimals = UNITS?.pieces?.units?.['шт']?.decimals ?? 0;
            out.push({value:n,badgeNumber:n,category:'pieces',base:'шт',unit:'шт',decimals:piecesDecimals,raw:`${n} шт`});
        }
    };
    const multiMeasuredCategories = new Set();
    const addMeasured = (number, unitText, multiplierCount=1) => {
        const n = parseFloat(String(number).replace(',','.'));
        const u = allUnits.find(x => x.unit.toLowerCase() === String(unitText).toLowerCase());
        if (u && Number.isFinite(n) && n > 0) {
            const total = n * u.multiplier * (Number(multiplierCount)||1);
            out.push({value:total,badgeNumber:n*(Number(multiplierCount)||1),category:u.category,base:u.base,unit:u.unit,decimals:u.decimals,raw:`${n*(Number(multiplierCount)||1)} ${u.unit}`});
        }
    };

    const weightXPieces = new RegExp(`(-?\\d+(?:[\\.,]\\d+)?)\\s*(${escapedUnits.join('|')})\\s*[xх×]\\s*(\\d+)\\s*(шт|штук|уп|упаковки|упаковок)`, 'giu');
    let mm;
    while ((mm = weightXPieces.exec(t))) {
        addMeasured(mm[1], mm[2], mm[3]);
        multiMeasuredCategories.add(allUnits.find(u=>u.unit.toLowerCase()===String(mm[2]).toLowerCase())?.category || '');
        addPieces(mm[3]);
    }

    const piecesXWeight = new RegExp(`(\\d+)\\s*[xх×]\\s*(-?\\d+(?:[\\.,]\\d+)?)\\s*(${escapedUnits.join('|')})`, 'giu');
    while ((mm = piecesXWeight.exec(t))) {
        addPieces(mm[1]);
        addMeasured(mm[2], mm[3], mm[1]);
        multiMeasuredCategories.add(allUnits.find(u=>u.unit.toLowerCase()===String(mm[3]).toLowerCase())?.category || '');
    }

    const piecesThenWeight = new RegExp(`(\\d+)\\s*(шт|штук|уп|упаковки|упаковок)\\s*(?:[xх×]|по)\\s*(-?\\d+(?:[\\.,]\\d+)?)\\s*(${escapedUnits.join('|')})`, 'giu');
    while ((mm = piecesThenWeight.exec(t))) {
        addPieces(mm[1]);
        addMeasured(mm[3], mm[4], mm[1]);
        multiMeasuredCategories.add(allUnits.find(u=>u.unit.toLowerCase()===String(mm[4]).toLowerCase())?.category || '');
    }

    const seen=new Set();
    return out.filter(x=>{
        // Если в карточке явно указано «85 г × 30 шт», показываем величину
        // упаковки (2550 г) и количество (30 шт), а не только 85 г.
        if (multiMeasuredCategories.has(x.category) && x.category !== 'pieces') {
            const hasLarger = out.some(y => y !== x && y.category === x.category && y.value > x.value);
            if (hasLarger) return false;
        }
        const key=`${x.category}|${x.value}|${x.base}`;
        if(seen.has(key)) return false; seen.add(key); return true;
    });
}

function getAllUnitResults(tile) {
    if (!tile) return [];
    const m = getTileMetrics(tile);
    if (m.units) return m.units;
    const result=[];
    const seen=new Set();
    const add=(q, sourceName='')=>{
        if(!q || !(q.value>0)) return;
        const key=`${q.category}|${q.value}|${q.base}|${q.name||''}`;
        if(seen.has(key)) return; seen.add(key);
        result.push({...q, sourceName});
    };

    // Сначала явное поле «вес», если оно настроено.
    const weightText=getWeightFieldText(tile);
    if(weightText) getAllUnitResultsFromText(weightText).forEach(q=>add(q,'вес'));

    // Затем название — здесь может быть одновременно «85 г × 30 шт».
    getAllUnitResultsFromText(getTileTitle(tile)).forEach(q=>add(q,'название'));

    // И, наконец, настроенные дополнительные величины. Один селектор может
    // вернуть несколько элементов/значений, поэтому каждое значение разбираем отдельно.
    const profile=getSelectorProfileForTile(tile);
    for(const item of (profile?.extras || [])) {
        if(item?.kind!=='quantity') continue;
        const name=String(item?.name||'').trim();
        if(!name || !item?.selector) continue;
        const configuredUnit=String(item?.unit||'').trim();
        for(const el of findAllWithinTileOrSelf(tile,item.selector)) {
            const raw=String(extractConfiguredElementValue(el)||'').trim();
            if(!raw) continue;
            const parsed=getAllUnitResultsFromText(configuredUnit && !/[A-Za-zА-Яа-яЁё]/.test(raw) ? `${raw} ${configuredUnit}` : raw);
            if(parsed.length) parsed.forEach(q=>add({...q,unit:configuredUnit||q.unit,raw,name},name));
            else {
                const n=parseExtraNumber(raw);
                if(n!=null && configuredUnit) {
                    const byUnit=getAllUnitResultsFromText(`${n} ${configuredUnit}`)[0];
                    if(byUnit) add({...byUnit,unit:configuredUnit,raw,name},name);
                }
            }
        }
    }
    return result;
}

function getExtraQuantityData(tile) {
    return getAllUnitResults(tile)
        .filter(q=>q.name || q.sourceName==='вес' || q.sourceName==='название')
        .sort((a,b)=>clampPriority(UNITS?.[a.category]?.priority,a.category)-clampPriority(UNITS?.[b.category]?.priority,b.category) || String(a.name||'').localeCompare(String(b.name||'')))
        .map(q=>({
            name:q.name || (q.category==='weight'?'Вес':q.category==='volume'?'Объём':q.category==='pieces'?'Количество':getCategoryDisplayName(q.category)),
            raw:q.raw || '', display:q.raw || `${fmtUnit(q.badgeNumber, q.decimals)} ${q.unit||q.base}`,
            value:q.value, badgeNumber:q.badgeNumber, category:q.category, base:q.base, unit:q.unit||q.base
        }));
}

// Единый расчёт цены за единицу для бейджа, фильтра и сортировки.
// Внутренняя величина q.value всегда хранится в базовых единицах категории
// (г / мл / шт / мм). Для сравнения и отображения переводим в единицу,
// выбранную пользователем в настройках бейджа (кг↔г, л↔мл, мм/см/м…);
// по умолчанию — крупная единица (кг/л/шт/м), как и раньше.
const FALLBACK_CANONICAL_UNIT = { weight: 'кг', volume: 'л', pieces: 'шт', length: 'м' };

// Какую единицу показывать для категории: явный выбор пользователя (🏷️ в бейдже),
// иначе — единица по умолчанию для встроенных категорий, иначе — самая крупная
// из настроенных (разумный дефолт для новой пользовательской категории).
function getDisplayUnitForCategory(category) {
    const choices = getCategoryUnitChoices(category);
    if (!choices.length) return null;
    const preferredWord = badgeDisplayUnit[category] || FALLBACK_CANONICAL_UNIT[category];
    return choices.find(c => c.unit === preferredWord)
        || choices.find(c => c.unit === FALLBACK_CANONICAL_UNIT[category])
        || choices[choices.length - 1];
}

function getCanonicalUnitInfo(q) {
    if (!q || !(q.value > 0)) return null;
    const category = q.category || '';
    const chosen = getDisplayUnitForCategory(category);
    if (!chosen) return null;
    const quantityInCanonical = q.value / chosen.multiplier;
    if (!(quantityInCanonical > 0)) return null;
    const decimals = UNITS?.[category]?.units?.[chosen.unit]?.decimals ?? defaultDecimalsForCategory(category);
    return {
        category,
        unit: chosen.unit,
        factor: chosen.multiplier,
        quantity: quantityInCanonical,
        pricePerUnit: null,
        decimals,
        source: q,
    };
}

// Возвращает уникальные варианты цены за каноническую единицу.
// Если карточка содержит несколько одинаковых величин (например, 8 шт,
// 6 шт и 48 шт), для одной единицы измерения оставляем наиболее крупную
// величину: она обычно соответствует итоговому количеству упаковки.
function getUnitPriceOptions(tile) {
    if (!tile) return [];
    const m = getTileMetrics(tile);
    // options itself не зависит от priority, но зависит от UNITS. Кэшируем
    // отдельно и возвращаем тот же массив — он только читается.
    if (m.unitOptions) return m.unitOptions;
    const price = getPrice(tile);
    if (price == null || price === 99999999) return [];

    const byUnit = new Map();
    for (const q of getAllUnitResults(tile)) {
        const info = getCanonicalUnitInfo(q);
        if (!info) continue;
        info.pricePerUnit = price / info.quantity;
        if (!Number.isFinite(info.pricePerUnit)) continue;

        const existing = byUnit.get(info.unit);
        if (!existing || info.quantity > existing.quantity) {
            byUnit.set(info.unit, info);
        }
    }

    return (m.unitOptions = [...byUnit.values()].sort((a, b) =>
        compareCategoriesByPriority(a.category, b.category) ||
        a.unit.localeCompare(b.unit)
    ));
}

// Приоритет для цены за единицу.
// auto = по настроенному приоритету категорий (по умолчанию вес → объём → штуки → длина,
// новые категории — в конце; порядок можно поменять в настройках единиц;
// конкретная категория означает, что для фильтра/сортировки используются только товары с этой величиной.
let unitPricePriority = 'auto';

function getPreferredUnitPriceOption(tile, priority = unitPricePriority) {
    const options = getUnitPriceOptions(tile);
    if (!options.length) return null;
    if (!priority || priority === 'auto') return options[0];
    return options.find(o => o.category === priority) || null;
}

// Основная величина карточки — с учётом выбранного пользователем приоритета.
function getUnitResult(tile, priority = unitPricePriority) {
    return getPreferredUnitPriceOption(tile, priority)?.source || null;
}

// Единый источник истины для цены за единицу: фильтр, сортировка и связанные UI.
function getPricePerUnit(tile, priority = unitPricePriority) {
    const option = getPreferredUnitPriceOption(tile, priority);
    if (!option) return null;
    return {
        value: option.pricePerUnit,
        category: option.category,
        base: option.unit,
        unit: option.unit,
        quantity: option.quantity,
        decimals: option.decimals,
        source: option.source,
    };
}

// Сколько знаков после запятой показывать в фильтре «Цена/ед.» для выбранного приоритета.
// В режиме auto разные товары могут сравниваться по разным величинам — берём стандартные 2 знака.
function getUnitPriceDecimalsForPriority(priority = unitPricePriority) {
    if (priority === 'auto' || !priority) return 2;
    const chosen = getDisplayUnitForCategory(priority);
    return chosen ? (UNITS?.[priority]?.units?.[chosen.unit]?.decimals ?? defaultDecimalsForCategory(priority)) : 2;
}

function getUnitPricePriorityLabel(priority = unitPricePriority) {
    if (priority === 'auto' || !priority) return 'Авто';
    const chosen = getDisplayUnitForCategory(priority);
    if (!chosen) return 'Авто';
    return `${getCategoryDisplayName(priority)} (₽/${chosen.unit})`;
}

function getPpgBadgeInfo(tile) {
    const currency = detectCurrency();
    const allOptions = getUnitPriceOptions(tile);
    if (!allOptions.length) return null;

    // В режиме current показываем только ту же величину, которую использует
    // фильтр/сортировка. В режиме all показываем все уникальные единицы.
    const preferred = getPreferredUnitPriceOption(tile, unitPricePriority);
    const options = ppgBadgeMode === 'current'
        ? (preferred ? [preferred] : [])
        : allOptions;
    if (!options.length) return null;

    const lines = options.map(o => `${o.pricePerUnit.toFixed(o.decimals ?? 2)} ${currency}/${o.unit}`);
    const valueLines = options.map(o => {
        const q = o.source;
        const name = q.name || (q.category === 'weight' ? 'Вес' : q.category === 'volume' ? 'Объём' : q.category === 'pieces' ? 'Количество' : 'Величина');
        return `${name}: ${fmtUnit(q.badgeNumber > 0 ? q.badgeNumber : q.value, q.decimals)} ${q.unit || q.base}`;
    });

    return {
        lines: [lines.join(' · '), valueLines.join(' · ')],
        primary: options[0].source || null,
        multi: options.length > 1,
        options,
    };
}

// Форматирует значение единицы: убирает лишние нули (1.000→1, 1.040→1.04, 1.500→1.5).
// decimals — предел знаков после запятой из настроек единицы (визуальный, на расчёт не влияет).
function fmtUnit(val, decimals) {
    const d = Number.isFinite(decimals) ? decimals : 3;
    return parseFloat(Number(val).toFixed(d)).toString();
}

function extraNumericMatchesRange(tile, name, min, max) {
    const values=getExtraNumericValues(tile,name);
    if(!values.length) return true;
    return values.some(value => (isNaN(min)||value>=min) && (isNaN(max)||value<=max));
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
refreshSavedKeysCache();

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

// ─── Утилиты (глобальные, доступны везде) ─────────────────────────────────────

let detectedCurrency = null;

function detectCurrency() {
    if (detectedCurrency) return detectedCurrency;
    if (!SELECTORS) return '₽';

    const tile = safeQuerySelector(document, SELECTORS.tile);
    if (!tile) return '₽';

    const priceEl = safeQuerySelector(tile, SELECTORS.price);
    const text = priceEl?.textContent || '';

    const match = text.match(/[₽$€£¥₺₴₸]/);
    if (match) { detectedCurrency = match[0]; return detectedCurrency; }

    if (text.includes('руб')) { detectedCurrency = '₽'; return detectedCurrency; }
    if (text.includes('USD')) { detectedCurrency = '$'; return detectedCurrency; }
    if (text.includes('EUR')) { detectedCurrency = '€'; return detectedCurrency; }

    detectedCurrency = '₽';
    return detectedCurrency;
}

// ─── Кэш вычисляемых метрик карточек ────────────────────────────────────────
// Поиск/сортировка раньше многократно обходили DOM одной и той же карточки.
// WeakMap не удерживает удалённые карточки в памяти.
const _tileMetricsCache = new WeakMap();
let _tileMetricsCacheGeneration = 0;
let _unitParserCache = null;

function invalidateTileMetricsCache() {
    _tileMetricsCacheGeneration++;
    _unitParserCache = null;
}

function getTileMetrics(tile) {
    let m = _tileMetricsCache.get(tile);
    if (!m || m.g !== _tileMetricsCacheGeneration) {
        m = { g: _tileMetricsCacheGeneration };
        _tileMetricsCache.set(tile, m);
    }
    return m;
}

function getPrice(tile) {
    if (!tile) return 99999999;
    const m = getTileMetrics(tile);
    if (m.price !== undefined) return m.price;
    if (tile.dataset.ssPrice) return (m.price = parseFloat(tile.dataset.ssPrice));
    for (const sel of profileFieldSelectors(tile, 'price')) {
        const priceSpan = findWithinTileOrSelf(tile, sel);
        if (!priceSpan) continue;
        const normalized = (priceSpan.textContent || '').replace(/\s/g, '').replace(',', '.');
        const match = normalized.match(/\d+(?:\.\d+)?/);
        const price = match ? parseFloat(match[0]) : 0;
        if (price > 0) return (m.price = price);
    }
    return (m.price = 99999999);
}

function parseReviewsCount(text) {
    if (!text) return null;
    const t = text.trim().toLowerCase();

    // Сокращённая запись тысяч: «1,2 тыс.», «3.4k», «5к»
    const kMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(?:тыс\.?|тысяч[а-я]*|k\b|к\b)/);
    if (kMatch) {
        return Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
    }

    // Склеиваем разряды, разделённые пробелом/неразрывным пробелом: «12 345» → «12345»
    // (повторяем, пока есть что склеивать — чисел с несколькими группами разрядов)
    let merged = t;
    let prev;
    do {
        prev = merged;
        merged = merged.replace(/(\d)[\s\u00A0\u202F\u2009\u2007](\d{3})(?!\d)/g, '$1$2');
    } while (merged !== prev);

    // Число в скобках рядом с рейтингом — частый паттерн вида «4.8 (1234)»
    const bracket = merged.match(/\((\d+)\)/);
    if (bracket) return parseInt(bracket[1], 10);

    // Число рядом со словом «отзыв»/«оцен»/«review» (до или после числа)
    const keywordAfter = merged.match(/(\d+)\s*(?:отзыв|оцен|review)/);
    if (keywordAfter) return parseInt(keywordAfter[1], 10);
    const keywordBefore = merged.match(/(?:отзыв\w*|оцен\w*|reviews?)\D{0,3}(\d+)/);
    if (keywordBefore) return parseInt(keywordBefore[1], 10);

    // Иначе — берём наибольшее из найденных чисел: рейтинг почти всегда 1–5,
    // а количество отзывов — заметно больше, если оба присутствуют в одном тексте
    const numbers = [...merged.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
    if (numbers.length === 0) return null;
    return Math.max(...numbers);
}

function getReviewsCount(tile) {
    if (!tile) return null;
    const m = getTileMetrics(tile);
    if ('reviews' in m) return m.reviews;
    if (tile.dataset.ssReviews !== undefined) return (m.reviews = tile.dataset.ssReviews === '' ? null : parseInt(tile.dataset.ssReviews, 10));
    for (const sel of profileFieldSelectors(tile, 'reviews')) {
        const el = findWithinTileOrSelf(tile, sel);
        if (!el) continue;
        const parsed = parseReviewsCount(el.textContent || '');
        if (parsed !== null) return (m.reviews = parsed);
    }
    return (m.reviews = null);
}

function getRating(tile) {
    if (!tile) return null;
    const m = getTileMetrics(tile);
    if ('rating' in m) return m.rating;
    if (tile.dataset.ssRating !== undefined) return (m.rating = tile.dataset.ssRating === '' ? null : parseFloat(tile.dataset.ssRating));
    for (const sel of profileFieldSelectors(tile, 'rating')) {
        const el = findWithinTileOrSelf(tile, sel);
        if (!el) continue;
        const raw = (el.textContent || '').trim().replace(',', '.');
        const match = raw.match(/\d+(\.\d+)?/);
        if (match) return (m.rating = parseFloat(match[0]));
    }
    return (m.rating = null);
}

// ─── Дата доставки ──────────────────────────────────────────────────────────
const RU_MONTHS_GENITIVE = {
    'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5,
    'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
};

function parseDeliveryDate(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (/послезавтра/.test(t)) {
        const d = new Date(startOfToday);
        d.setDate(d.getDate() + 2);
        return d.getTime();
    }
    if (/завтра/.test(t)) {
        const d = new Date(startOfToday);
        d.setDate(d.getDate() + 1);
        return d.getTime();
    }
    if (/сегодня/.test(t)) return startOfToday.getTime();

    const monthPattern = Object.keys(RU_MONTHS_GENITIVE).join('|');
    const m = t.match(new RegExp(`(\\d{1,2})\\s*(${monthPattern})(?:\\s+(\\d{4}))?`));
    if (m) {
        const day = parseInt(m[1], 10);
        const month = RU_MONTHS_GENITIVE[m[2]];
        const explicitYear = m[3] ? parseInt(m[3], 10) : null;
        let year = explicitYear ?? now.getFullYear();
        let d = new Date(year, month, day);
        // Без явного года: если дата уже прошла больше чем на пару дней — это, скорее всего, следующий год
        if (!explicitYear && d.getTime() < startOfToday.getTime() - 2 * 24 * 60 * 60 * 1000) {
            d = new Date(year + 1, month, day);
        }
        return d.getTime();
    }

    return null;
}

function getDeliveryDate(tile) {
    if (!tile) return null;
    const m = getTileMetrics(tile);
    if ('delivery' in m) return m.delivery;
    if (tile.dataset.ssDelivery !== undefined) return (m.delivery = tile.dataset.ssDelivery === '' ? null : parseInt(tile.dataset.ssDelivery, 10));
    for (const sel of profileFieldSelectors(tile, 'delivery')) {
        const el = findWithinTileOrSelf(tile, sel);
        if (!el) continue;
        const parsed = parseDeliveryDate(el.textContent || '');
        if (parsed !== null) return (m.delivery = parsed);
    }
    return (m.delivery = null);
}

// Основные атрибуты доступны в строке поиска через тот же синтаксис @поле(запрос),
// что и пользовательские дополнительные атрибуты.
function normalizePrimarySearchFieldName(name) {
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
    const aliases = {
        'название': 'title', 'наименование': 'title', 'товар': 'title',
        'цена': 'price', 'стоимость': 'price',
        'цена/ед': 'perunit', 'цена/ед.': 'perunit', 'ценазаединицу': 'perunit',
        'рейтинг': 'rating', 'отзывы': 'reviews', 'оценки': 'reviews',
        'доставка': 'delivery', 'дата': 'delivery'
    };
    return aliases[n] || null;
}
function formatPrimarySearchFieldValue(tile, field) {
    if (field === 'title') return String(getTileTitle?.(tile) || '');
    if (field === 'price') { const v = getPrice(tile); return v >= 99999999 ? '' : String(v); }
    if (field === 'perunit') { const p = getPricePerUnit(tile); return p ? `${p.value}${p.unit ? ` ${p.unit}` : ''}` : ''; }
    if (field === 'rating') { const v = getRating(tile); return v == null ? '' : String(v).replace('.', ','); }
    if (field === 'reviews') { const v = getReviewsCount(tile); return v == null ? '' : String(v); }
    if (field === 'delivery') {
        const v = getDeliveryDate(tile); if (v == null) return '';
        const d = new Date(v), day = String(d.getDate()).padStart(2,'0'), month = String(d.getMonth()+1).padStart(2,'0');
        return `${day}.${month} ${day}.${month}.${d.getFullYear()}`;
    }
    return '';
}

/**
 * Парсит строку "ДД.ММ.ГГГГ" или "ДД.ММ.ГГ" в **timestamp** (ms)
 * @param {string} str 
 * @returns {number|null}
 */
function parseStringDate(str) {
    if (!str) return null;
    const match = str.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // В JS месяцы идут от 0 до 11
    let year = parseInt(match[3], 10);

    // Если год указан двумя цифрами (например, 26 превратится в 2026)
    if (year < 100) year += 2000;

    return new Date(year, month, day).getTime();
}

/**
 * Надежный парсер даты из инпута, который сбрасывает время на начало или конец дня 
 * независимо от формата ("ГГГГ-ММ-ДД" или "ДД.ММ.ГГГГ")
 */
function parseStrictDate(valueStr, type = 'start') {
    let day, month, year;
    
    // Если инпут вернул стандартный HTML5 формат "ГГГГ-ММ-ДД"
    if (valueStr.includes('-')) {
        const parts = valueStr.split('-');
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day = parseInt(parts[2], 10);
    } 
    // Если инпут текстовый и вернул формат "ДД.ММ.ГГГГ"
    else if (valueStr.includes('.')) {
        const parts = valueStr.split('.');
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
    } else {
        return NaN;
    }

    if (type === 'start') {
        // Начало дня: 20.08.2026 00:00:00.000 (по вашему местному времени)
        return new Date(year, month, day, 0, 0, 0, 0).getTime();
    } else {
        // Конец дня: 20.08.2026 23:59:59.999 (чтобы захватить весь день целиком)
        return new Date(year, month, day, 23, 59, 59, 999).getTime();
    }
}

/**
 * Превращает **Date** или **timestamp** обратно в строку "ДД.ММ.ГГГГ"
 * @param {Date|number} dateOrTimestamp 
 * @returns {string}
 */
function formatDateToString(dateOrTimestamp) {
    if (!dateOrTimestamp) return '';
    const d = new Date(dateOrTimestamp);

    // Добавляем ведущие нули, если число меньше 10
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0'); // Сдвигаем месяц обратно на +1
    const year = d.getFullYear();

    return `${day}.${month}.${year}`;
}

function normalizeUnitText(text) {
    return text
        .replace(/[\uFF0C\u066B\u00B7\u2019\u2018]/g, ',')
        .replace(/(\d)[\u00A0\u202F\u2009\u2007](\d)/g, '$1$2')
        .replace(/(\d{1,3}) (\d{3})(?!\d)/g, '$1$2')
        .replace(/(?<![.,])(\d) (\d{1,2})(?=\D|$)/g, '$1.$2');
}

function parseUnit(title) {
    if (!title || !UNITS) return null;
    const t = normalizeUnitText(title.toLowerCase());

    // Строим объединённый список всех единиц с их категорией и множителем
    const allUnits = [];
    for (const [category, config] of Object.entries(UNITS)) {
        for (const [unit, entry] of Object.entries(config.units)) {
            const multiplier = (entry && typeof entry === 'object') ? Number(entry.multiplier) || 1 : Number(entry) || 1;
            const decimals = (entry && typeof entry === 'object') ? entry.decimals : undefined;
            allUnits.push({ unit, multiplier, decimals, category, base: config.base });
        }
    }

    // Сортируем по длине — длинные единицы проверяем первыми (литров > литра > л)
    allUnits.sort((a, b) => b.unit.length - a.unit.length);

    // Строим регекс из всех единиц
    const unitsPattern = allUnits.map(u => u.unit).join('|');

    // Убираем характеристики-диапазоны перед поиском
    const bracketPattern = new RegExp(`\\([^)]*\\d+[\\.,]?\\d*\\s*(${unitsPattern})[^)]*\\)`, 'g');
    const rangePattern = new RegExp(`\\d+\\s*[-–]\\s*\\d+[\\.,]?\\d*\\s*(${unitsPattern})`, 'g');
    const upToPattern = new RegExp(`до\\s*\\d+[\\.,]?\\d*\\s*(${unitsPattern})`, 'g');
    const plusCharPattern = new RegExp(`\\d+[\\.,]?\\d*\\s*\\+\\s*(${unitsPattern})`, 'g');

    const clean = t
        .replace(bracketPattern, '')
        .replace(rangePattern, '')
        .replace(upToPattern, '')
        .replace(plusCharPattern, '');

    function findUnit(str) {
        for (const u of allUnits) {
            // Ищем с границами слова
            const re = new RegExp(`(\\d+[\\.,]?\\d*)\\s*${u.unit}(?![а-яёa-z])`, 'i');
            const m = str.match(re);
            if (m) return { value: parseFloat(m[1].replace(',', '.')), ...u };
        }
        return null;
    }

    // (5 + 5 кг), (1 + 2 + 3 г) — скобки с суммой
    const plusMatch = t.match(new RegExp(`\\(([\\d\\s\\+\\.,]+)\\s*(${unitsPattern})\\)`));
    if (plusMatch) {
        const found = allUnits.find(u => u.unit === plusMatch[2]);
        if (found) {
            const total = plusMatch[1]
                .split('+')
                .reduce((sum, part) => sum + parseFloat(part.replace(',', '.').trim()), 0);
            return { value: total * found.multiplier, category: found.category, base: found.base };
        }
    }

    // ( 3 уп. х 160 гр. ) — количество × вес в скобках
    const bracketMultiMatch = t.match(/\(\s*(\d+)\s*(?:уп\.?|шт\.?|штук|пак\.?)\s*[xх×]\s*(\d+[\.,]?\d*)\s*(кг|г|гр|грамм|мл|л)\.?\s*\)/);
    if (bracketMultiMatch) {
        const count = parseFloat(bracketMultiMatch[1]);
        const weight = parseFloat(bracketMultiMatch[2].replace(',', '.'));
        const unitStr = bracketMultiMatch[3];
        const multiplier = unitStr === 'кг' || unitStr === 'л' ? 1000 : 1;
        const category = (unitStr === 'кг' || unitStr === 'г' || unitStr === 'гр' || unitStr === 'грамм') ? 'weight' : 'volume';
        const base = category === 'weight' ? 'г' : 'мл';
        return { value: count * weight * multiplier, category, base };
    }

    // 78 г х 3 шт — вес/объём × количество
    const weightXCount = clean.match(new RegExp(`(\\d+[\\.,]?\\d*)\\s*(${unitsPattern})\\s*[xх×]\\s*(\\d+)\\s*шт`));
    if (weightXCount) {
        const found = allUnits.find(u => u.unit === weightXCount[2]);
        if (found) {
            const val = parseFloat(weightXCount[1].replace(',', '.')) * found.multiplier;
            return { value: val * parseFloat(weightXCount[3]), category: found.category, base: found.base };
        }
    }

    // 3 x 100г, 2шт по 400г — количество × вес/объём
    const multiMatch = clean.match(new RegExp(`(\\d+)\\s*(?:шт(?:ук)?\\.?\\s*)?(?:[xх]|по)\\s*(\\d+[\\.,]?\\d*)\\s*(${unitsPattern})`));
    if (multiMatch) {
        const found = allUnits.find(u => u.unit === multiMatch[3]);
        if (found) {
            const val = parseFloat(multiMatch[2].replace(',', '.')) * found.multiplier;
            return { value: parseFloat(multiMatch[1]) * val, category: found.category, base: found.base };
        }
    }

    // Одиночное значение
    const single = findUnit(clean);
    if (single) {
        return { value: single.value * single.multiplier, category: single.category, base: single.base };
    }

    return null;
}

function getWeightFieldText(tile) {
    const sels = profileFieldSelectors(tile, 'weight');
    for (const sel of sels) {
        const el = findWithinTileOrSelf(tile, sel);
        if (el && el.textContent && el.textContent.trim()) return el.textContent;
    }
    return null;
}

function getSortValue(tile, mode) {
    if (mode === 'asc' || mode === 'desc') return getPrice(tile);
    if (mode === 'per-gram-asc' || mode === 'per-gram-desc') {
        const ppg = getPricePerUnit(tile);
        return ppg?.value ?? Infinity;
    }
    if (mode === 'reviews-asc' || mode === 'reviews-desc') {
        return getReviewsCount(tile) ?? -Infinity;
    }
    if (mode === 'rating-asc' || mode === 'rating-desc') {
        return getRating(tile) ?? -Infinity;
    }
    if (mode === 'delivery-asc' || mode === 'delivery-desc') {
        return getDeliveryDate(tile) ?? -Infinity;
    }
    return getPrice(tile);
}

// Короткая подпись для текущего режима сортировки (используется в счётчиках)
function getSortModeLabel(mode) {
    if (mode.startsWith('per-gram')) return `⚖️ ${getUnitPricePriorityLabel()}`;
    if (mode.startsWith('reviews')) return '💬 отзывы';
    if (mode.startsWith('rating')) return '⭐ рейтинг';
    if (mode.startsWith('delivery')) return '🚚 доставка';
    return '💰 цена';
}

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

// Масштаб шрифта и высота текстового блока карточки «Сохранённые» в зависимости
// от ползунка размера карточек (120–320px). Без этого при увеличении карточек
// текст оставался мелким, а фиксированный бюджет высоты (раньше — константа)
// не вмещал новые строки рейтинга/доставки, и карточки наезжали друг на друга.
function getSavedTileFontScale(cardScale) {
    const factor = cardScale / 180;
    return Math.min(1.35, Math.max(0.85, factor));
}
function getSavedTileBodyHeight(cardScale) {
    return Math.round(150 * getSavedTileFontScale(cardScale));
}

// Выбирает именно основную фотографию товара, а не маленькую иконку/бейдж.
// На некоторых сайтах первая <img> внутри карточки — это SVG-иконка акции,
// поэтому простой querySelector('img') давал неправильную картинку в «Своём» стиле.
function getBestProductImage(tile) {
    if (!tile) return null;

    const candidates = [...tile.querySelectorAll('img[src], img[data-src], img[data-url]')];
    if (!candidates.length) return null;

    const title = (getTileTitle(tile) || '').toLowerCase();
    const scored = candidates.map((img, index) => {
        const src = img.currentSrc || img.src || img.dataset?.src || img.dataset?.url || '';
        const srcLower = String(src).toLowerCase();
        const rect = img.getBoundingClientRect?.() || { width: 0, height: 0 };
        const naturalArea = (img.naturalWidth || 0) * (img.naturalHeight || 0);
        const renderedArea = Math.max(0, rect.width * rect.height);
        let score = 0;

        // Основное изображение обычно заметно крупнее иконок.
        score += Math.log10(1 + Math.max(naturalArea, renderedArea * 100)) * 100;
        if (naturalArea >= 120 * 120) score += 120;
        if (renderedArea >= 120 * 80) score += 120;

        // SVG/служебные картинки почти всегда являются иконками, а не фото товара.
        if (/\.svg(?:[?#]|$)/i.test(srcLower) || srcLower.startsWith('data:image/svg')) score -= 500;

        const inButton = !!img.closest('button, [role="button"]');
        if (inButton) score -= 350;

        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const imgTitle = (img.getAttribute('title') || '').toLowerCase();
        if (title && (alt.includes(title) || title.includes(alt) && alt.length > 8)) score += 160;
        if (alt.length > 8) score += 15;
        if (imgTitle.length > 8) score += 10;

        // Небольшие изображения, которые явно являются иконками, понижаем.
        if (Math.max(rect.width, rect.height) < 70 && naturalArea < 70 * 70) score -= 180;

        return { img, score, index };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored[0]?.img || null;
}

// Текст для строки «⭐ рейтинг · 💬 отзывы» — возвращает '' если данных нет
function formatRatingReviewsDisplay(rating, reviews) {
    const parts = [];
    if (rating != null && !Number.isNaN(rating)) parts.push(`⭐ ${rating.toLocaleString('ru-RU')}`);
    if (reviews != null && !Number.isNaN(reviews)) parts.push(`💬 ${reviews.toLocaleString('ru-RU')}`);
    return parts.join(' · ');
}

// Текст для строки «🚚 дата доставки» — возвращает '' если данных нет
function formatDeliveryDisplay(deliveryTs) {
    if (deliveryTs == null || Number.isNaN(deliveryTs)) return '';
    const d = new Date(deliveryTs);
    if (Number.isNaN(d.getTime())) return '';
    return `🚚 ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

// Проставляет/обновляет data-атрибуты и видимые строки цены/рейтинга/отзывов/доставки
// на уже построенном элементе .ss-tile (используется и для live-DOM, и для патча html)
function applySavedDataToTileEl(tileEl, data, currency) {
    if (data.price != null && data.price < 99999999) {
        tileEl.dataset.ssPrice = String(data.price);
        const priceEl = tileEl.querySelector('.ss-tile__price');
        if (priceEl) priceEl.textContent = `${data.price.toLocaleString('ru-RU')} ${currency}`;
    }

    tileEl.dataset.ssRating = data.rating != null ? String(data.rating) : '';
    tileEl.dataset.ssReviews = data.reviews != null ? String(data.reviews) : '';
    tileEl.dataset.ssDelivery = data.delivery != null ? String(data.delivery) : '';

    const ratingText = formatRatingReviewsDisplay(data.rating, data.reviews);
    let ratingEl = tileEl.querySelector('.ss-tile__rating');
    if (ratingText) {
        if (!ratingEl) {
            ratingEl = document.createElement('div');
            ratingEl.className = 'ss-tile__rating';
            (tileEl.querySelector('.ss-tile__price') || tileEl.querySelector('.ss-tile__title'))
                ?.insertAdjacentElement('afterend', ratingEl);
        }
        ratingEl.textContent = ratingText;
    } else {
        ratingEl?.remove();
    }

    const deliveryText = formatDeliveryDisplay(data.delivery);
    let deliveryEl = tileEl.querySelector('.ss-tile__delivery');
    if (deliveryText) {
        if (!deliveryEl) {
            deliveryEl = document.createElement('div');
            deliveryEl.className = 'ss-tile__delivery';
            (tileEl.querySelector('.ss-tile__rating') || tileEl.querySelector('.ss-tile__price'))
                ?.insertAdjacentElement('afterend', deliveryEl);
        }
        deliveryEl.textContent = deliveryText;
    } else {
        deliveryEl?.remove();
    }
}


// Стандартная (своя) карточка расширения для вкладки «Поиск».
// Использует тот же стиль, что и вкладка «Сохранённые», но данные берёт
// напрямую из живой карточки сайта — без сохранения товара.
function createCustomSearchTile(tile, cardScale = 180) {
    const key = getTileKey(tile) || '';
    const title = getTileTitle(tile) || '—';
    const price = getPrice(tile);
    const rating = getRating(tile);
    const reviews = getReviewsCount(tile);
    const delivery = getDeliveryDate(tile);
    const currency = detectCurrency();

    const url = getTileUrl(tile);

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const imgEl = getBestProductImage(tile);
    const imgSrc = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
    const priceDisplay = price < 99999999 ? `${price.toLocaleString('ru-RU')} ${currency}` : '—';
    const ratingText = formatRatingReviewsDisplay(rating, reviews);
    const deliveryText = formatDeliveryDisplay(delivery);

    const root = document.createElement('div');
    root.className = 'ss-tile ss-tile--search-custom';
    root.dataset.ssKey = key;
    root.dataset.ssTitle = title;
    root.dataset.ssPrice = String(price);
    root.dataset.ssRating = rating != null ? String(rating) : '';
    root.dataset.ssReviews = reviews != null ? String(reviews) : '';
    root.dataset.ssDelivery = delivery != null ? String(delivery) : '';
    root.dataset.ssSite = window.location.hostname;
    root.dataset.ssUrl = url;
    // Высота картинки масштабируется вместе с шириной карточки.
    root.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
    root.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'ss-tile__img-wrap';
    if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = title;
        img.loading = 'lazy';
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'display:block; width:100%; height:100%;';
            a.addEventListener('click', e => e.stopPropagation());
            a.appendChild(img);
            imgWrap.appendChild(a);
        } else {
            imgWrap.appendChild(img);
        }
    } else {
        const noImg = document.createElement('div');
        noImg.className = 'ss-tile__no-img';
        noImg.textContent = '📦';
        imgWrap.appendChild(noImg);
    }
    root.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'ss-tile__body';

    const titleEl = document.createElement('div');
    titleEl.className = 'ss-tile__title';
    if (url) {
        const titleLink = document.createElement('a');
        titleLink.href = url;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.textContent = title;
        titleLink.style.cssText = 'color:inherit; text-decoration:none;';
        titleLink.addEventListener('click', e => e.stopPropagation());
        titleEl.appendChild(titleLink);
    } else {
        titleEl.textContent = title;
    }
    body.appendChild(titleEl);

    const priceEl = document.createElement('div');
    priceEl.className = 'ss-tile__price';
    priceEl.textContent = priceDisplay;
    body.appendChild(priceEl);

    if (ratingText) {
        const el = document.createElement('div');
        el.className = 'ss-tile__rating';
        el.textContent = ratingText;
        body.appendChild(el);
    }
    if (deliveryText) {
        const el = document.createElement('div');
        el.className = 'ss-tile__delivery';
        el.textContent = deliveryText;
        body.appendChild(el);
    }

    const siteEl = document.createElement('div');
    siteEl.className = 'ss-tile__site';
    siteEl.textContent = window.location.hostname;
    body.appendChild(siteEl);

    root.appendChild(body);
    return root;
}

async function buildNormalizedTileHtml(tile) {
    const key = getTileKey(tile);
    const title = getTileTitle(tile);
    const price = getPrice(tile);
    const rating = getRating(tile);
    const reviews = getReviewsCount(tile);
    const delivery = getDeliveryDate(tile);
    const currency = detectCurrency();

    // ищем картинку и сохраняем в background IndexedDB асинхронно
    const imgEl = getBestProductImage(tile);
    const imgSrc = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
    if (imgSrc && key) saveImageToBackground(key, imgSrc);

    // абсолютный URL
    const url = getTileUrl(tile);

    const site = window.location.hostname;
    const priceDisplay = price < 99999999 ? `${price.toLocaleString('ru-RU')} ${currency}` : '—';
    const ratingText = formatRatingReviewsDisplay(rating, reviews);
    const deliveryText = formatDeliveryDisplay(delivery);

    // html не содержит base64 — картинка подгружается при рендере из IndexedDB
    const html = `<div class="ss-tile"
        data-ss-key="${(key || '').replace(/"/g, '&quot;')}"
        data-ss-title="${(title || '').replace(/"/g, '&quot;')}"
        data-ss-price="${price}"
        data-ss-rating="${rating ?? ''}"
        data-ss-reviews="${reviews ?? ''}"
        data-ss-delivery="${delivery ?? ''}"
        data-ss-site="${site}"
        data-ss-url="${url.replace(/"/g, '&quot;')}">
        <div class="ss-tile__img-wrap ss-tile__img-loading">
            <div class="ss-tile__no-img">📦</div>
        </div>
        <div class="ss-tile__body">
            <div class="ss-tile__title">${url ? `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onclick="event.stopPropagation()">${(title || '—').replace(/</g, '&lt;')}</a>` : (title || '—').replace(/</g, '&lt;')}</div>
            <div class="ss-tile__price">${priceDisplay}</div>
            ${ratingText ? `<div class="ss-tile__rating">${ratingText}</div>` : ''}
            ${deliveryText ? `<div class="ss-tile__delivery">${deliveryText}</div>` : ''}
            <div class="ss-tile__site">${site}</div>
        </div>
    </div>`;
    return html;
}

async function getAllFoldersGlobal() {
    const tiles = await getSavedTiles();
    const set = new Set();
    tiles.forEach(t => (t.folders || []).forEach(f => set.add(f)));
    return [...set].sort();
}

function showSaveFolderDialog(anchorBtn, existingFolders, onConfirm) {
    document.querySelector('.ss-save-folder-dialog')?.remove();

    const dialog = document.createElement('div');
    dialog.className = 'ss-save-folder-dialog';
    dialog.style.cssText = `
        position:fixed; z-index:100050;
        background:#fff; border:1px solid #ddd; border-radius:10px;
        padding:14px; min-width:240px; max-width:300px;
        box-shadow:0 4px 20px rgba(0,0,0,0.18); font-family:sans-serif;
    `;

    const chosen = new Set();

    const title = document.createElement('div');
    title.textContent = '📁 Сохранить в папку';
    title.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:10px; color:#333;';
    dialog.appendChild(title);

    // поиск — показываем только если папок много, иначе не мешаем
    let searchInput = null;
    if (existingFolders.length > 6) {
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 Поиск папки...';
        searchInput.style.cssText = 'width:100%; padding:6px 9px; border:1px solid #ddd; border-radius:6px; font-size:12px; outline:none; margin-bottom:8px; box-sizing:border-box;';
        dialog.appendChild(searchInput);
    }

    // прокручиваемый список папок
    const list = document.createElement('div');
    list.style.cssText = 'max-height:240px; overflow-y:auto; display:flex; flex-direction:column;';
    dialog.appendChild(list);

    function addFolderRow(name, checked = false) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 2px; cursor:pointer; font-size:13px;';
        row.dataset.folderName = name.toLowerCase();
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.style.cursor = 'pointer';
        if (checked) chosen.add(name);
        cb.addEventListener('change', () => cb.checked ? chosen.add(name) : chosen.delete(name));
        row.appendChild(cb);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        nameSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        row.appendChild(nameSpan);
        list.appendChild(row);
        return row;
    }

    // существующие папки
    existingFolders.forEach(f => addFolderRow(f));

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            [...list.children].forEach(row => {
                row.style.display = !q || row.dataset.folderName.includes(q) ? '' : 'none';
            });
        });
    }

    // новая папка
    const newRow = document.createElement('div');
    newRow.style.cssText = 'display:flex; gap:6px; margin-top:8px;';
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.placeholder = 'Новая папка...';
    newInput.style.cssText = 'flex:1; padding:4px 8px; border:1px solid #ccc; border-radius:6px; font-size:12px;';
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.style.cssText = 'padding:4px 8px; background:#2196F3; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;';
    addBtn.addEventListener('click', () => {
        const name = newInput.value.trim();
        if (!name || existingFolders.includes(name)) { newInput.focus(); return; }
        existingFolders.push(name);
        addFolderRow(name, true);
        if (searchInput) searchInput.value = '';
        [...list.children].forEach(row => row.style.display = '');
        newInput.value = '';
        list.scrollTop = list.scrollHeight;
    });
    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    newRow.appendChild(newInput);
    newRow.appendChild(addBtn);
    dialog.appendChild(newRow);

    // кнопки
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; margin-top:12px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '🔖 Сохранить';
    saveBtn.style.cssText = 'flex:1; padding:6px; background:#4CAF50; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px; font-weight:bold;';
    saveBtn.addEventListener('click', () => {
        dialog.remove();
        onConfirm([...chosen]);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    cancelBtn.style.cssText = 'padding:6px 10px; background:#f5f5f5; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:12px;';
    cancelBtn.addEventListener('click', () => dialog.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    // позиционирование
    document.body.appendChild(dialog);
    if (searchInput) searchInput.focus();
    const rect = anchorBtn.getBoundingClientRect();
    const dw = dialog.offsetWidth, dh = dialog.offsetHeight;
    let top = rect.bottom + 6, left = rect.left;
    if (left + dw > window.innerWidth - 10) left = window.innerWidth - dw - 10;
    if (top + dh > window.innerHeight - 10) top = rect.top - dh - 6;
    if (top < 10) top = 10;
    dialog.style.top = top + 'px';
    dialog.style.left = left + 'px';

    // закрытие по клику вне
    setTimeout(() => {
        const close = e => { if (!dialog.contains(e.target) && e.target !== anchorBtn) { dialog.remove(); document.removeEventListener('mousedown', close); } };
        document.addEventListener('mousedown', close);
    }, 0);
}

// ─── Визуальное сравнение карточек (pHash + цветовая гистограмма) ─────────────

async function getImageDataFromSrc(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32; canvas.height = 32;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                resolve(ctx.getImageData(0, 0, 32, 32));
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function computePHash(imageData) {
    if (!imageData) return null;
    const { data } = imageData;
    const gray = new Float32Array(64);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            let sum = 0;
            for (let dr = 0; dr < 4; dr++) {
                for (let dc = 0; dc < 4; dc++) {
                    const px = ((r * 4 + dr) * 32 + (c * 4 + dc)) * 4;
                    sum += 0.299 * data[px] + 0.587 * data[px + 1] + 0.114 * data[px + 2];
                }
            }
            gray[r * 8 + c] = sum / 16;
        }
    }
    const avg = gray.reduce((a, b) => a + b, 0) / 64;
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
        if (gray[i] >= avg) hash |= (1n << BigInt(i));
    }
    return hash;
}

function computeColorHistogram(imageData) {
    if (!imageData) return null;
    const { data } = imageData;
    const hist = new Float32Array(48);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        hist[Math.floor(data[i] / 16)] += 1;
        hist[16 + Math.floor(data[i + 1] / 16)] += 1;
        hist[32 + Math.floor(data[i + 2] / 16)] += 1;
        count++;
    }
    if (count > 0) for (let i = 0; i < 48; i++) hist[i] /= count;
    return hist;
}

function hammingDistance(a, b) {
    if (a == null || b == null) return 64;
    let x = a ^ b, d = 0;
    while (x) { d += Number(x & 1n); x >>= 1n; }
    return d;
}

function histogramDistance(a, b) {
    if (!a || !b) return 1;
    let sum = 0;
    for (let i = 0; i < 48; i++) sum += Math.abs(a[i] - b[i]);
    return sum / 3;
}

function combinedSimilarity(fa, fb) {
    const hd = hammingDistance(fa.phash, fb.phash);
    const cd = histogramDistance(fa.hist, fb.hist);
    return 0.6 * (1 - hd / 64) + 0.4 * (1 - cd);
}

const _featureCache = new Map();

async function extractFeatures(key, src) {
    if (_featureCache.has(key)) return _featureCache.get(key);
    const imageData = await getImageDataFromSrc(src);
    const features = { phash: computePHash(imageData), hist: computeColorHistogram(imageData) };
    _featureCache.set(key, features);
    return features;
}

function clusterBySimilarity(items, threshold = 0.72) {
    const clusters = [], assigned = new Set();
    for (let i = 0; i < items.length; i++) {
        if (assigned.has(i)) continue;
        const cluster = [i];
        assigned.add(i);
        for (let j = i + 1; j < items.length; j++) {
            if (assigned.has(j)) continue;
            if (combinedSimilarity(items[i].features, items[j].features) >= threshold) {
                cluster.push(j);
                assigned.add(j);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

async function groupTilesByVisualSimilarity(tiles, getImgSrc) {
    const items = await Promise.all(tiles.map(async (tile, i) => {
        const src = getImgSrc(tile);
        const key = getTileKey(tile) || String(i);
        const features = src ? await extractFeatures(key, src) : { phash: null, hist: null };
        return { tile, features };
    }));
    const clusters = clusterBySimilarity(items);
    clusters.sort((a, b) => b.length - a.length);
    // возвращаем { tiles[], solo } — solo=true для одиночных
    return clusters.map(indices => ({
        tiles: indices.map(i => items[i].tile),
        solo: indices.length === 1
    }));
}

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


function createSortedProductsPopup(mode = 'asc') {
    document.getElementById('products-sorted-popup')?.remove();
    document.getElementById('shopper-sorter-style')?.remove();

    const noSearchTiles = seenTiles.size === 0;

    // Инициализируем контейнеры до любых асинхронных callback'ов.
    const productsContainer = document.createElement('div');
    productsContainer.className = 'products-grid';
    productsContainer.style.setProperty('--tile-img-height', '160px');
    productsContainer.style.setProperty('--tile-font-scale', '1');

    const savedContainer = document.createElement('div');
    savedContainer.className = 'products-grid saved-grid';
    savedContainer.style.cssText = `display:none; --tile-img-height: 160px; --tile-font-scale: 1;`;

    // Инициализируем контейнеры до любых асинхронных callback'ов.
    // Контейнеры и дополнительные фильтры должны быть инициализированы ДО
    // любых асинхронных callback'ов и обработчиков внутри popup. Иначе быстрые
    // callback'и могли обратиться к const в TDZ и ломать открытие поиска.
    // Компактная статистика по дополнительным атрибутам.
    // Фильтрация дополнительных атрибутов выполняется через основную строку поиска;
    // здесь показываем наличие/отсутствие и распределение найденных значений.
    const extraControls = document.createElement('div');
    extraControls.style.cssText='display:flex;flex-direction:column;gap:4px;padding:3px 7px;border:1px dashed #d8dee6;border-radius:7px;background:#fbfcfd;';
    const extraControlsTitle=document.createElement('div');
    extraControlsTitle.textContent='🏷️ Доп. атрибуты и величины';
    extraControlsTitle.style.cssText='font-size:11px;font-weight:700;color:#607D8B;cursor:pointer;user-select:none;min-height:18px;line-height:18px;';
    extraControls.appendChild(extraControlsTitle);
    const extraControlsBody=document.createElement('div');
    extraControlsBody.style.cssText='display:flex;flex-direction:column;gap:4px;';
    extraControls.appendChild(extraControlsBody);
    let extraControlsCollapsed=false;
    chrome.storage.local.get(['extraControlsCollapsed'], d => {
        setExtraControlsCollapsed(d.extraControlsCollapsed === true);
    });

    function setExtraControlsCollapsed(collapsed){
        extraControlsCollapsed=!!collapsed;
        extraControlsBody.hidden=extraControlsCollapsed;
        // Не полагаемся только на hidden: у body задан inline display:flex,
        // который в некоторых стилях страницы может переопределить [hidden].
        extraControlsBody.style.display=extraControlsCollapsed?'none':'flex';
        extraControls.style.padding=extraControlsCollapsed?'2px 7px':'3px 7px';
        extraControls.style.gap=extraControlsCollapsed?'0':'4px';
        extraControlsTitle.textContent=extraControlsCollapsed
            ? '🏷️ Доп. атрибуты и величины ▸'
            : '🏷️ Доп. атрибуты и величины ▾';
        chrome.storage.local.set({ extraControlsCollapsed });
    }
    extraControlsTitle.addEventListener('click',()=>setExtraControlsCollapsed(!extraControlsCollapsed));

    function refreshExtraControls(tiles=[...seenTiles.values()]) {
        extraControlsBody.innerHTML='';
        const total=tiles.length;
        if(!total){
            const empty=document.createElement('div');
            empty.textContent='Нет карточек для анализа';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        const defs=new Map();
        for(const tile of tiles){
            const profile=getSelectorProfileForTile(tile);
            for(const item of (profile?.extras || [])){
                const name=String(item?.name||'').trim();
                if(!name) continue;
                if(!defs.has(name)) defs.set(name,{name,kind:item?.kind==='quantity'?'quantity':'text',unit:String(item?.unit||'').trim()});
            }
        }

        if(!defs.size){
            const empty=document.createElement('div');
            empty.textContent='Дополнительные атрибуты не настроены';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        for(const def of defs.values()){
            let found=0;
            const frequencies=new Map();
            for(const tile of tiles){
                const attrs=getExtraTileAttributes(tile);
                const raw=String(attrs[def.name]||'').trim();
                if(!raw) continue;
                found++;
                for(const value of raw.split(' | ').map(v=>v.trim()).filter(Boolean)){
                    frequencies.set(value,(frequencies.get(value)||0)+1);
                }
            }
            const absent=Math.max(0,total-found);
            const pct=Math.round(found/total*100);
            const topValues=[...frequencies.entries()]
                .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
                .slice(0,6);
            const distinct=frequencies.size;

            const row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;gap:7px;min-height:20px;font-size:10px;';

            const name=document.createElement('span');
            name.textContent=def.name+(def.unit?' ('+def.unit+')':'');
            name.style.cssText='min-width:110px;max-width:180px;font-weight:600;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            name.title=def.name+(def.unit?' ('+def.unit+')':'');

            const foundEl=document.createElement('span');
            foundEl.textContent=`✓ ${found}`;
            foundEl.style.cssText='color:#2e7d32;font-weight:600;white-space:nowrap;';
            foundEl.title=`Найден у ${found} из ${total} карточек`;

            const absentEl=document.createElement('span');
            absentEl.textContent=`✕ ${absent}`;
            absentEl.style.cssText='color:#c62828;font-weight:600;white-space:nowrap;';
            absentEl.title=`Не найден у ${absent} из ${total} карточек`;

            const percent=document.createElement('span');
            percent.textContent=`${pct}%`;
            percent.style.cssText='color:#777;min-width:32px;white-space:nowrap;';
            percent.title=`Заполненность: ${pct}%`;

            const valuesEl=document.createElement('span');
            const valueText=topValues.length
                ? topValues.map(([value,count])=>`${value} ×${count}`).join(' · ') + (distinct>topValues.length?` · +${distinct-topValues.length}`:'')
                : '—';
            valuesEl.textContent=valueText;
            valuesEl.style.cssText='color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:100px;';
            valuesEl.title=topValues.length
                ? `Уникальных значений: ${distinct}. Частые значения: ${topValues.map(([value,count])=>`${value} — ${count}`).join('; ')}${distinct>topValues.length?'; и другие':''}`
                : 'Значений не найдено';

            row.append(name,foundEl,absentEl,percent,valuesEl);
            extraControlsBody.appendChild(row);
        }
    }
    refreshExtraControls();

    const style = document.createElement('style');
    style.id = 'shopper-sorter-style';
    style.textContent = `
        @keyframes slideIn {
            from { opacity: 0; transform: scale(0.8) translateY(-50px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        #products-sorted-popup > .ss-cards-host {
            flex: 1 1 auto !important;
            min-height: 0 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
        }
        #products-sorted-popup > .ss-ui-host,
        #products-sorted-popup > .ss-ui-bottom-host {
            flex: 0 0 auto !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
        }
        #products-sorted-popup .products-grid {
            flex: 1;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            padding: 20px !important;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 15px !important;
            align-items: start;
            scrollbar-width: thin;
            scrollbar-color: #ccc transparent;
            contain: layout style;
        }
        #products-sorted-popup .products-grid::-webkit-scrollbar { width: 8px; }
        #products-sorted-popup .products-grid::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
        #products-sorted-popup .products-grid::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
        #products-sorted-popup .tile-root {
            width: 100% !important; max-width: none !important;
            margin: 0 !important; transform: none !important;
        }
        #products-sorted-popup .tile-root img {
            width: 100% !important; height: auto !important; object-fit: cover;
        }
        #products-sorted-popup .ppg-badge {
            position: absolute; top: 8px; left: 8px; z-index: 10;
            background: rgba(0,0,0,0.75); color: white;
            padding: 3px 6px; border-radius: 4px;
            font-size: 11px; line-height: 1.25; font-weight: bold; font-family: sans-serif;
            pointer-events: none;
            box-sizing: border-box;
            width: min(92%, 220px);
            max-width: min(92%, 220px);
            max-height: 56px;
            overflow: hidden;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        #products-sorted-popup .ppg-badge span {
            display: block;
            margin-top: 2px;
            line-height: 1.2;
            white-space: normal;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #products-sorted-popup .ppg-debug {
            display: none;
            position: absolute; top: 8px; right: 8px; z-index: 10;
            background: rgba(0,0,0,0.75); color: white;
            padding: 3px 7px; border-radius: 4px;
            font-size: 11px; font-weight: bold; font-family: sans-serif;
            pointer-events: none;
        }
        #products-sorted-popup .ss-tile {
            display: flex; flex-direction: column;
            border-radius: 10px;
            background: #fff; border: 1px solid #eee;
            box-shadow: 0 1px 4px rgba(0,0,0,0.07);
            font-family: sans-serif;
            position: relative;
        }
        #products-sorted-popup .products-grid.saved-grid {
        }
        #products-sorted-popup .products-grid.saved-grid > div {
            display: flex; flex-direction: column;
        }
        #products-sorted-popup .products-grid.saved-grid > div > .ss-tile {
            flex: 1;
        }
        #products-sorted-popup .ss-tile__img-wrap {
            width: 100%; height: var(--tile-img-height, 160px); overflow: hidden; flex-shrink: 0;
            background: #f5f5f5; display: flex; align-items: center; justify-content: center;
            border-radius: 10px 10px 0 0;
        }
        #products-sorted-popup .ss-tile__img-wrap img {
            width: 100%; height: 100%; object-fit: contain;
        }
        #products-sorted-popup .ss-tile__no-img {
            font-size: 48px; opacity: 0.3;
        }
        #products-sorted-popup .ss-tile__body {
            padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; flex: 1;
        }
        #products-sorted-popup .ss-tile__title {
            font-size: calc(12px * var(--tile-font-scale, 1)); color: #333; line-height: 1.4;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
        #products-sorted-popup .ss-tile__price {
            font-size: calc(14px * var(--tile-font-scale, 1)); font-weight: bold; color: #e31; margin-top: auto;
        }
        #products-sorted-popup .ss-tile__rating {
            font-size: calc(11px * var(--tile-font-scale, 1)); color: #666;
        }
        #products-sorted-popup .ss-tile__delivery {
            font-size: calc(11px * var(--tile-font-scale, 1)); color: #2e7d32;
        }
        #products-sorted-popup .ss-tile__site {
            font-size: calc(10px * var(--tile-font-scale, 1)); color: #aaa; margin-top: 2px;
        }
        /* Корень карточки сайта — отдельный item сетки расширения. Его
           внутренний дизайн остаётся полностью сайту, но grid/width/float
           самого корня не должны ломать сетку Shopping Sorter. */
        #products-sorted-popup .ss-site-card-clone {
            display: block !important;
            position: relative !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            float: none !important;
            clear: none !important;
            grid-column: auto !important;
            grid-row: auto !important;
            grid-area: auto !important;
            justify-self: stretch !important;
            align-self: stretch !important;
            box-sizing: border-box !important;
        }
        #products-sorted-popup .ss-site-card-clone > * { max-width: 100%; }

        #products-sorted-popup .ss-tile--search-custom {
            width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box;
            overflow: hidden;
            position: relative !important;
            display: flex !important;
            flex-direction: column !important;
            align-self: stretch !important;
            justify-self: stretch !important;
            grid-column: auto !important;
            grid-row: auto !important;
        }
        /* Сетка поиска расширения не должна зависеть от размеров карточки/стилей сайта. */
        #products-sorted-popup .products-grid:not(.saved-grid) {
            grid-auto-rows: max-content;
            align-items: start !important;
            grid-auto-flow: row;
        }
        #products-sorted-popup .products-grid:not(.saved-grid) > .ss-search-tile-wrap {
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            align-self: start !important;
            justify-self: stretch !important;
            box-sizing: border-box !important;
            position: relative !important;
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap {
            height: var(--tile-img-height, 160px);
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap a {
            width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap img {
            width: 100%; height: 100%; object-fit: contain;
        }

        /* Custom-style cards are extension-owned.  Do not let broad site rules
           (button/div/a/img/font/color/box-sizing resets) leak into them. */
        #products-sorted-popup .ss-tile--search-custom {
            box-sizing: border-box !important;
            font-family: sans-serif !important;
            color: #333 !important;
            background: #fff !important;
        }
        #products-sorted-popup .ss-tile--search-custom *,
        #products-sorted-popup .ss-tile--search-custom *::before,
        #products-sorted-popup .ss-tile--search-custom *::after {
            box-sizing: border-box;
        }
        #products-sorted-popup .ss-tile--search-custom a {
            font-family: inherit !important;
        }
    `;
    //     style.textContent += `
    //     #products-sorted-popup ${SELECTORS.link} {
    //         pointer-events: none !important;
    //     }
    // `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'products-sorted-popup';
    overlay.style.cssText = `
        position: fixed; inset: 0; width: 100%; max-width: 100%; height: 100%;
        overflow: hidden; background: rgba(0,0,0,0.7); z-index: 99999;
        display: flex; justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white; width: min(95%, 1400px); max-width: calc(100% - 24px); height: 90vh;
        box-sizing: border-box; min-width: 0;
        border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
        display: flex; flex-direction: column; overflow: hidden;
        position: relative;
    `;

    // Изолируем интерфейс расширения от CSS сайта через Shadow DOM.
    // Карточки остаются в light DOM намеренно: только в режиме «Сайт» они
    // должны получать стили исходного сайта.
    const uiHost = document.createElement('div');
    uiHost.className = 'ss-ui-host';
    uiHost.style.cssText = `
        flex: 0 0 auto; min-width: 0; position: relative;
        box-sizing: border-box; font-family: Arial, sans-serif; color: #333;
    `;
    const uiRoot = uiHost.attachShadow({ mode: 'open' });
    const uiStyle = document.createElement('style');
    uiStyle.textContent = `
        :host { font-family: Arial, sans-serif; color:#333; box-sizing:border-box; }
        *, *::before, *::after { box-sizing:border-box; }
        button, input, select, textarea { font-family: Arial, sans-serif; }
    `;
    uiRoot.appendChild(uiStyle);

    const cardsHost = document.createElement('div');
    cardsHost.className = 'ss-cards-host';
    cardsHost.style.cssText = `
        flex: 1 1 auto; min-height: 0; min-width: 0; position: relative;
        display: flex; flex-direction: column; overflow: hidden;
    `;

    // Нижние панели держим в отдельном Shadow DOM-хосте. Так они остаются
    // снизу popup и CSS сайта не может превратить их в верхнюю flex/grid-строку.
    const bottomUiHost = document.createElement('div');
    bottomUiHost.className = 'ss-ui-bottom-host';
    bottomUiHost.style.cssText = `
        flex: 0 0 auto; min-width: 0; position: relative;
        box-sizing: border-box; font-family: Arial, sans-serif; color: #333;
    `;
    const bottomUiRoot = bottomUiHost.attachShadow({ mode: 'open' });
    const bottomUiStyle = document.createElement('style');
    bottomUiStyle.textContent = `
        :host { display:block; font-family:Arial,sans-serif; color:#333; box-sizing:border-box; }
        *, *::before, *::after { box-sizing:border-box; }
        button, input, select, textarea { font-family:Arial,sans-serif; }
    `;
    bottomUiRoot.appendChild(bottomUiStyle);

    popup.appendChild(uiHost);
    popup.appendChild(cardsHost);
    popup.appendChild(bottomUiHost);

    // ─── Toast-уведомление ─────────────────────────────────────────────────────
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(8px);
        background: #333; color: white; padding: 10px 20px; border-radius: 8px;
        font-size: 13px; font-family: sans-serif; white-space: nowrap;
        opacity: 0; transition: opacity 0.2s, transform 0.2s; pointer-events: none;
        z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    uiRoot.appendChild(toast);

    let toastTimer = null;
    function showNotification(msg, type = 'info') {
        clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.style.background = type === 'error' ? '#c62828' : type === 'warning' ? '#e65100' : '#2e7d32';
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
        }, 3000);
    }

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 15px 20px; border-bottom: 1px solid #eee; flex-shrink: 0;
        box-sizing: border-box; width: 100%; min-width: 0;
        background: #f8f9fa; display: flex; flex-direction: column; gap: 10px;
    `;

    // Верхняя строка
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex; align-items:center; gap:6px; flex-wrap:wrap; width:100%; min-width:0; box-sizing:border-box;';

    const tabSearch = document.createElement('button');
    tabSearch.textContent = '📦 Поиск';
    tabSearch.title = 'Карточки, найденные на текущей странице сайта';
    tabSearch.style.cssText = `
    padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
    font-weight: bold; font-size: 14px;
    background: #2196F3; color: white;
`;

    const tabSaved = document.createElement('button');
    tabSaved.textContent = '🔖 Сохранённые';
    tabSaved.title = 'Карточки, которые вы сохранили вручную — хранятся между сессиями';
    tabSaved.style.cssText = `
    padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
    font-weight: bold; font-size: 14px;
    background: transparent; color: #666; border: 1px solid #ddd;
`;

    const tabsRow = document.createElement('div');
    tabsRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-shrink:0;';
    tabsRow.appendChild(tabSearch);
    tabsRow.appendChild(tabSaved);

    // Стиль карточек во вкладке «Поиск»: сайт или упрощённый стиль расширения.
    let searchCardStyle = 'site';
    const cardStyleWrap = document.createElement('div');
    cardStyleWrap.style.cssText = 'display:flex; align-items:center; gap:3px; margin-left:2px; flex-shrink:0;';

    const cardStyleLabel = document.createElement('span');
    cardStyleLabel.textContent = 'Стиль:';
    cardStyleLabel.style.cssText = 'font-size:11px; color:#888; margin-right:2px;';

    const cardStyleSiteBtn = document.createElement('button');
    cardStyleSiteBtn.textContent = '🌐 Сайт';
    cardStyleSiteBtn.title = 'Показывать карточки в исходном стиле сайта';
    cardStyleSiteBtn.style.cssText = 'padding:4px 7px; border:1px solid #2196F3; border-radius:5px; cursor:pointer; font-size:11px; background:#2196F3; color:#fff;';

    const cardStyleOwnBtn = document.createElement('button');
    cardStyleOwnBtn.textContent = '✨ Упрощённый';
    cardStyleOwnBtn.title = 'Показывать карточки в упрощённом стиле расширения (как в «Сохранённых»)';
    cardStyleOwnBtn.style.cssText = 'padding:4px 7px; border:1px solid #ddd; border-radius:5px; cursor:pointer; font-size:11px; background:#fff; color:#777;';

    cardStyleWrap.appendChild(cardStyleLabel);
    cardStyleWrap.appendChild(cardStyleSiteBtn);
    cardStyleWrap.appendChild(cardStyleOwnBtn);

    function updateCardStyleButtons() {
        const siteActive = searchCardStyle === 'site';
        cardStyleSiteBtn.style.background = siteActive ? '#2196F3' : '#fff';
        cardStyleSiteBtn.style.color = siteActive ? '#fff' : '#777';
        cardStyleSiteBtn.style.borderColor = siteActive ? '#2196F3' : '#ddd';
        cardStyleOwnBtn.style.background = siteActive ? '#fff' : '#4CAF50';
        cardStyleOwnBtn.style.color = siteActive ? '#777' : '#fff';
        cardStyleOwnBtn.style.borderColor = siteActive ? '#ddd' : '#4CAF50';
        cardStyleWrap.style.display = activeTab === 'search' ? 'flex' : 'none';
    }

    cardStyleSiteBtn.addEventListener('click', () => {
        if (searchCardStyle === 'site') return;
        searchCardStyle = 'site';
        chrome.storage.local.set({ searchCardStyle });
        applyActiveGridScale();
        updateCardStyleButtons();
        if (activeTab === 'search') renderTiles(currentTiles);
    });
    cardStyleOwnBtn.addEventListener('click', () => {
        if (searchCardStyle === 'custom') return;
        searchCardStyle = 'custom';
        chrome.storage.local.set({ searchCardStyle });
        applyActiveGridScale();
        updateCardStyleButtons();
        if (activeTab === 'search') renderTiles(currentTiles);
    });

    let activeTab = 'search';
    let currentTiles = []; // текущий отображаемый список
    // Состояние группировки объявляем до любых async callbacks, чтобы не попадать в TDZ.
    let groupingActive = false;
    let groupLayout = 'rows';        // 'rows' | 'flow'
    let referenceFeatures = null;
    let referenceImgSrc = null;
    let _searchGroupCache = null;
    let _savedGroupCache = null;

    chrome.storage.local.get(['searchCardStyle'], d => {
        if (d.searchCardStyle === 'custom' || d.searchCardStyle === 'site') {
            searchCardStyle = d.searchCardStyle;
            updateCardStyleButtons();
            try { applyActiveGridScale(); } catch (_) {}
            // Первый рендер выполняется с безопасным значением по умолчанию ('site'),
            // поэтому после загрузки сохранённого режима обязательно перерисовываем
            // список, если пользователь ранее выбрал другой стиль. Иначе кнопка уже
            // показывала бы «Упрощённый», а карточки оставались в стиле сайта.
            if (activeTab === 'search') {
                renderTiles(getFilteredAndSorted(groupingActive ? '' : searchInput.value));
            }
        }
    });

    function switchTab(tab) {
        activeTab = tab;
        updateCardStyleButtons();
        if (tab === 'search') {
            // сбрасываем кэш групп — saved-вкладка могла изменить seenTiles
            _searchGroupCache = null;
            productsContainer.style.display = '';
            savedContainer.style.display = 'none';
            selectionPanel.style.display = 'flex';
            savedPanel.style.display = 'none';
            folderRow.style.display = 'none';
            refreshSavedKeysCache(); // обновляем значки 🔖
            refreshSearchImgBtn.style.display = debugMode ? 'inline-block' : 'none';
            refreshSavedImgBtn.style.display = 'none';
            tabSearch.style.background = '#2196F3';
            tabSearch.style.color = 'white';
            tabSearch.style.border = 'none';
            tabSaved.style.background = 'transparent';
            tabSaved.style.color = '#666';
            tabSaved.style.border = '1px solid #ddd';
            // обновляем счётчик под текущий список поиска
            const counterMode = getCounterSortMode(searchInput.value);
            const arrow = counterMode.includes('desc') ? '↓' : '↑';
            renderCounterLabel(currentTiles.length, seenTiles.size, counterMode, arrow);
            updateTypeCounts();
            updatePricePlaceholders([...seenTiles.values()]);
        } else {
            productsContainer.style.display = 'none';
            savedContainer.style.display = '';
            selectionPanel.style.display = 'none';
            refreshSearchImgBtn.style.display = 'none';
            refreshSavedImgBtn.style.display = debugMode ? 'inline-block' : 'none';
            savedPanel.style.display = 'flex';
            tabSearch.style.background = 'transparent';
            tabSearch.style.color = '#666';
            tabSearch.style.border = '1px solid #ddd';
            tabSaved.style.background = '#4CAF50';
            tabSaved.style.color = 'white';
            tabSaved.style.border = 'none';
            renderSavedTiles();
        }
    }

    tabSearch.addEventListener('click', () => switchTab('search'));
    tabSaved.addEventListener('click', () => switchTab('saved'));

    const counter = document.createElement('span');
    counter.style.cssText = 'font-size:14px; color:#666; flex:1; text-align:center; white-space:nowrap;';

    // ── Календарь доставки ─────────────────────────────────────────────────────
    // Показывает для каждой даты доставки диапазон цены и/или цены за единицу.
    // По умолчанию обновляется автоматически при изменении текущего набора карточек,
    // но пользователь может отключить автообновление и обновлять календарь вручную.
    let deliveryCalendarAutoRefresh = true;
    let deliveryCalendarMode = 'both'; // legacy compatibility
    let deliveryCalendarAttributes = {price:true, perunit:true};
    let deliveryCalendarScope = 'filtered'; // 'filtered' | 'all'
    let deliveryCalendarExcludeZeroUnit = false;
    let deliveryCalendarSelectedDates = new Set();
    let deliveryCalendarAnchorKey = null;
    let deliveryCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let deliveryCalendarOpen = false;
    let deliveryCalendarRefreshTimer = null;
    let deliveryCalendarDirty = true;
    let deliveryCalendarButton = null;
    let deliveryCalendarPopover = null;
    let deliveryCalendarResizeObserver = null;
    let deliveryCalendarWindowHandler = null;
    let deliveryCalendarMenuClickHandler = null;
    let deliveryCalendarPositions = {
        grid:{left:null,top:null,width:null,height:null},
        horizontal:{left:null,top:null,width:null,height:null},
        vertical:{left:null,top:null,width:null,height:null}
    };
    let deliveryCalendarCellSizes = {grid:105,horizontal:105,vertical:105};
    let deliveryCalendarFontSizes = {grid:12,horizontal:12,vertical:12};
    function getCalendarFontSize(){ return Number(deliveryCalendarFontSizes[deliveryCalendarLayout]) || 12; }
    let deliveryCalendarLayout = 'grid';

    function getCalendarLayoutPosition(){
        if (!deliveryCalendarPositions[deliveryCalendarLayout]) deliveryCalendarPositions[deliveryCalendarLayout]={left:null,top:null,width:null,height:null};
        return deliveryCalendarPositions[deliveryCalendarLayout];
    }
    function getCalendarCellSize(){ return Number(deliveryCalendarCellSizes[deliveryCalendarLayout]) || 105; }
    let deliveryCalendarRibbonScroll = { left:0, top:0, layout:null };
    let deliveryCalendarContentScrollTop = 0;

    chrome.storage.local.get(['deliveryCalendarAutoRefresh', 'deliveryCalendarScope', 'deliveryCalendarMode', 'deliveryCalendarAttributes', 'deliveryCalendarExcludeZeroUnit', 'deliveryCalendarPositions', 'deliveryCalendarPosition', 'deliveryCalendarCellSizes', 'deliveryCalendarCellSize', 'deliveryCalendarFontSizes', 'deliveryCalendarFontSize', 'deliveryCalendarLayout'], d => {
        deliveryCalendarAutoRefresh = d.deliveryCalendarAutoRefresh !== false;
        deliveryCalendarMode = ['price','unit','both'].includes(d.deliveryCalendarMode) ? d.deliveryCalendarMode : 'both';
        if (d.deliveryCalendarAttributes && typeof d.deliveryCalendarAttributes === 'object') {
            deliveryCalendarAttributes = {...d.deliveryCalendarAttributes};
        } else {
            deliveryCalendarAttributes = {price: deliveryCalendarMode !== 'unit', perunit: deliveryCalendarMode !== 'price'};
        }
        if (!('price' in deliveryCalendarAttributes)) deliveryCalendarAttributes.price = true;
        if (!('perunit' in deliveryCalendarAttributes)) deliveryCalendarAttributes.perunit = true;
        deliveryCalendarScope = d.deliveryCalendarScope === 'all' ? 'all' : 'filtered';
        deliveryCalendarExcludeZeroUnit = d.deliveryCalendarExcludeZeroUnit === true;
        if (d.deliveryCalendarPositions && typeof d.deliveryCalendarPositions === 'object') deliveryCalendarPositions = {...deliveryCalendarPositions,...d.deliveryCalendarPositions};
        if (d.deliveryCalendarPosition && typeof d.deliveryCalendarPosition === 'object') deliveryCalendarPositions.grid = {...deliveryCalendarPositions.grid,...d.deliveryCalendarPosition};
        const legacyCell = ['compact','normal','large'].includes(d.deliveryCalendarCellSize) ? (d.deliveryCalendarCellSize === 'compact' ? 80 : d.deliveryCalendarCellSize === 'large' ? 140 : 105) : Number(d.deliveryCalendarCellSize);
        if (d.deliveryCalendarCellSizes && typeof d.deliveryCalendarCellSizes === 'object') deliveryCalendarCellSizes = {...deliveryCalendarCellSizes,...d.deliveryCalendarCellSizes};
        if (Number.isFinite(legacyCell)) deliveryCalendarCellSizes.grid = Math.min(180,Math.max(60,legacyCell));
        for (const k of ['grid','horizontal','vertical']) deliveryCalendarCellSizes[k] = Number.isFinite(Number(deliveryCalendarCellSizes[k])) ? Math.min(180,Math.max(60,Number(deliveryCalendarCellSizes[k]))) : 105;
        const hasPerLayoutFonts = d.deliveryCalendarFontSizes && typeof d.deliveryCalendarFontSizes === 'object';
        if (hasPerLayoutFonts) deliveryCalendarFontSizes = {...deliveryCalendarFontSizes,...d.deliveryCalendarFontSizes};
        const legacyFont = Number(d.deliveryCalendarFontSize);
        // Старый единый параметр используем только как миграцию, если новых
        // раздельных настроек ещё нет. Иначе он не должен затирать значения
        // для grid / horizontal / vertical при каждом запуске.
        if (!hasPerLayoutFonts && Number.isFinite(legacyFont)) deliveryCalendarFontSizes = {grid:legacyFont,horizontal:legacyFont,vertical:legacyFont};
        for (const k of ['grid','horizontal','vertical']) deliveryCalendarFontSizes[k] = Number.isFinite(Number(deliveryCalendarFontSizes[k])) ? Math.min(20,Math.max(8,Number(deliveryCalendarFontSizes[k]))) : 12;
        deliveryCalendarLayout = ['grid','horizontal','vertical'].includes(d.deliveryCalendarLayout) ? d.deliveryCalendarLayout : 'grid';
        // Восстанавливаем не только переменную, но и уже созданные элементы меню.
        if (typeof layoutSelect !== 'undefined' && layoutSelect) layoutSelect.value = deliveryCalendarLayout;
        if (typeof syncSizeControl === 'function') syncSizeControl();
        if (typeof syncFontControl === 'function') syncFontControl();
        updateDeliveryCalendarButton();
        if (deliveryCalendarOpen) renderDeliveryCalendar();
    });

    function getDeliveryCalendarTiles() {
        // В режиме «Фильтрованные» остальные даты не скрываем: они остаются
        // доступными для выбора и только визуально приглушаются.
        return [...seenTiles.values()].filter(tile => getDeliveryDate(tile) != null);
    }

    function getDeliveryCalendarFilteredKeys() {
        if (deliveryCalendarScope !== 'filtered' || !Array.isArray(currentTiles)) return null;
        const keys = new Set();
        currentTiles.forEach(tile => {
            const ts = getDeliveryDate(tile); if (ts == null) return;
            const d = new Date(ts); if (Number.isNaN(d.getTime())) return;
            keys.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        return keys;
    }

    // Важное отличие от filteredKeys: здесь специально исключаем @доставка/@дата
    // из текущего поискового запроса. Так можно определить, есть ли смысл выбирать
    // конкретную дату с учётом ВСЕХ остальных фильтров. Сам @доставка на этот статус
    // не влияет.
    function getDeliveryCalendarInfluenceKeys() {
        if (deliveryCalendarScope !== 'filtered') return null;
        const allTiles = [...seenTiles.values()];
        if (!searchInput || !searchInput.value.trim()) {
            return new Set(allTiles.map(tile => {
                const ts=getDeliveryDate(tile); if(ts==null) return null;
                const d=new Date(ts); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            }).filter(Boolean));
        }
        const withoutDelivery = stripSortRulesFromQuery(searchInput.value)
            .replace(/!?\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu, ' ')
            .replace(/\s{2,}/g, ' ').trim();
        let matched = allTiles;
        if (withoutDelivery) {
            const tokens = parseSearchQuery(withoutDelivery);
            matched = allTiles.filter(tile => matchesTileSearchTokens(tile, tokens));
        }
        const keys = new Set();
        matched.forEach(tile => {
            const ts=getDeliveryDate(tile); if(ts==null) return;
            const d=new Date(ts); if(Number.isNaN(d.getTime())) return;
            keys.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        return keys;
    }

    // Возвращает функцию, которая проверяет, попадает ли дата в явно заданный
    // @доставка/@дата из текущего запроса. Нужна отдельно от currentTiles:
    // currentTiles уже отфильтрован по @доставка, а для отображения ячейки за
    // пределами диапазона нужно сохранить исходную информацию о дате.
    function getDeliveryCalendarQueryDateMatcher() {
        if (!searchInput || !searchInput.value.trim()) return null;
        const re=/@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const matches=[...searchInput.value.matchAll(re)];
        if (!matches.length) return null;
        const ranges=[];
        for (const match of matches) {
            const open=match[0].indexOf('(');
            const close=match[0].lastIndexOf(')');
            if (open<0 || close<=open) continue;
            const parsed=tryParseDateFieldBody(match[0].slice(open+1,close));
            if (!parsed) continue;
            for (const r of parsed.ranges) ranges.push(r);
        }
        if (!ranges.length) return null;
        return ts => ranges.some(r => {
            const hit=ts>=r.minTs && ts<=r.maxTs;
            return r.exclude ? !hit : hit;
        });
    }

    function getDeliveryCalendarRemainingCounts() {
        const counts = new Map();
        const allTiles = [...seenTiles.values()];
        let matched = allTiles;
        if (searchInput && searchInput.value.trim()) {
            const withoutDelivery = stripSortRulesFromQuery(searchInput.value)
                .replace(/!?\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu, ' ')
                .replace(/\s{2,}/g, ' ').trim();
            if (withoutDelivery) {
                const tokens = parseSearchQuery(withoutDelivery);
                matched = allTiles.filter(tile => matchesTileSearchTokens(tile, tokens));
            }
        }
        matched.forEach(tile => {
            const ts=getDeliveryDate(tile); if(ts==null) return;
            const d=new Date(ts); if(Number.isNaN(d.getTime())) return;
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            counts.set(key,(counts.get(key)||0)+1);
        });
        return counts;
    }

    function formatCalendarMoney(value, decimals = 2) {
        if (!Number.isFinite(value)) return '—';
        const digits = decimals > 0 ? Math.min(2, decimals) : 0;
        return `${value.toLocaleString('ru-RU', {minimumFractionDigits: digits, maximumFractionDigits: digits})} ${detectCurrency()}`;
    }

    function getCalendarNumericAttributes(tiles) {
        const defs = new Map();
        for (const tile of tiles) {
            const extra = getExtraTileAttributes(tile) || {};
            for (const [name, raw] of Object.entries(extra)) {
                const values = Array.isArray(raw) ? raw : [raw];
                const nums = [];
                for (const value of values) {
                    const m = String(value ?? '').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/);
                    if (m) { const n = Number(m[0]); if (Number.isFinite(n)) nums.push(n); }
                }
                if (nums.length) {
                    if (!defs.has(name)) defs.set(name, {name, values:[]});
                    defs.get(name).values.push(...nums);
                }
            }
        }
        return [...defs.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    }
    function getCalendarAttrValues(tile, name) {
        const raw = getExtraTileAttributes(tile)?.[name];
        const values = Array.isArray(raw) ? raw : [raw];
        return values.map(v=>String(v??'').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/))
            .filter(Boolean).map(m=>Number(m[0])).filter(Number.isFinite);
    }

    function buildDeliveryCalendarData(tiles) {
        const byDate = new Map();
        for (const tile of tiles) {
            const ts = getDeliveryDate(tile);
            if (ts == null) continue;
            const d = new Date(ts);
            if (Number.isNaN(d.getTime())) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            let item = byDate.get(key);
            if (!item) {
                item = { ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), prices: [], units: new Map(), attrs: new Map(), count: 0 };
                byDate.set(key, item);
            }
            item.count++;
            const price = getPrice(tile);
            if (price != null && price < 99999999 && Number.isFinite(price)) item.prices.push(price);
            for (const [attrName, attrValues] of Object.entries(getExtraTileAttributes(tile) || {})) {
                const nums = (Array.isArray(attrValues) ? attrValues : [attrValues]).flatMap(v => {
                    const m = String(v ?? '').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/);
                    return m && Number.isFinite(Number(m[0])) ? [Number(m[0])] : [];
                });
                if (nums.length) { if (!item.attrs.has(attrName)) item.attrs.set(attrName, []); item.attrs.get(attrName).push(...nums); }
            }
            const ppg = getPricePerUnit(tile);
            if (ppg && Number.isFinite(ppg.value) && !(deliveryCalendarExcludeZeroUnit && ppg.value <= 0)) {
                const unitKey = `${ppg.category}|${ppg.unit}`;
                if (!item.units.has(unitKey)) item.units.set(unitKey, { unit: ppg.unit, values: [], decimals: ppg.decimals ?? 2 });
                item.units.get(unitKey).values.push(ppg.value);
            }
        }
        return byDate;
    }

    function closeDeliveryCalendar() {
        deliveryCalendarOpen = false;
        deliveryCalendarPopover?.remove();
        deliveryCalendarPopover = null;
        deliveryCalendarResizeObserver?.disconnect();
        deliveryCalendarResizeObserver = null;
        if (deliveryCalendarWindowHandler) { window.removeEventListener('resize', deliveryCalendarWindowHandler); deliveryCalendarWindowHandler=null; }
    }

    function scheduleDeliveryCalendarRefresh(immediate = false) {
        deliveryCalendarDirty = true;
        if (!deliveryCalendarOpen || !deliveryCalendarAutoRefresh) return;
        if (deliveryCalendarRefreshTimer) clearTimeout(deliveryCalendarRefreshTimer);
        deliveryCalendarRefreshTimer = setTimeout(() => {
            deliveryCalendarRefreshTimer = null;
            if (deliveryCalendarOpen) renderDeliveryCalendar();
        }, immediate ? 0 : 350);
    }

    function renderDeliveryCalendar() {
        if (!deliveryCalendarPopover) return;
        const tiles = getDeliveryCalendarTiles();
        const data = buildDeliveryCalendarData(tiles);
        const filteredKeys = getDeliveryCalendarFilteredKeys();
        // Рендер пересоздаёт DOM, поэтому запоминаем прокрутку текущей ленты.
        const previousGrid = deliveryCalendarPopover.querySelector('.ss-delivery-calendar-days');
        if (previousGrid) {
            deliveryCalendarRibbonScroll = { left: previousGrid.scrollLeft || 0, top: previousGrid.scrollTop || 0 };
        }
        deliveryCalendarDirty = false;
        // Сохраняем позицию прокрутки перед полной перерисовкой: выбор даты не должен возвращать ленту в начало.
        const oldGrid = deliveryCalendarPopover.querySelector('.ss-delivery-calendar-date-list');
        if (oldGrid) deliveryCalendarRibbonScroll = { left:oldGrid.scrollLeft, top:oldGrid.scrollTop, layout:deliveryCalendarLayout };
        deliveryCalendarContentScrollTop = deliveryCalendarPopover.scrollTop;
        deliveryCalendarPopover.innerHTML = '';
        applyDeliveryCalendarGeometry();

        const head = document.createElement('div');
        head.className = 'ss-delivery-calendar-drag';
        head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:grab;user-select:none;';
        const title = document.createElement('strong');
        title.textContent = '📅 Доставка и цены';
        title.style.cssText = 'font-size:13px;flex:1;';
        head.appendChild(title);

        const attrWrap=document.createElement('div');
        attrWrap.className='ss-delivery-calendar-attr-wrap';
        attrWrap.style.cssText='position:relative;min-width:0;';
        const attrBtn=document.createElement('button');
        attrBtn.type='button'; attrBtn.textContent='Атрибуты ▾';
        attrBtn.style.cssText='font-size:11px;padding:4px 7px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;';
        const attrMenu=document.createElement('div');
        attrMenu.className='ss-delivery-calendar-attr-menu';
        attrMenu.style.cssText='display:none;position:fixed;z-index:2147483647;width:210px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:7px;background:#fff;border:1px solid #ddd;border-radius:7px;box-shadow:0 5px 18px rgba(0,0,0,.18);box-sizing:border-box;';
        const attrDefs=[{key:'price',label:'💰 Цена'},{key:'perunit',label:'⚖️ Цена/ед.'},...getCalendarNumericAttributes(tiles).map(x=>({key:`extra:${x.name}`,label:x.name}))];
        attrDefs.forEach(def=>{
            const lab=document.createElement('label'); lab.style.cssText='display:flex;align-items:center;gap:6px;padding:4px 2px;font-size:11px;cursor:pointer;min-width:0;';
            const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=deliveryCalendarAttributes[def.key] !== false;
            cb.onchange=()=>{ deliveryCalendarAttributes[def.key]=cb.checked; chrome.storage.local.set({deliveryCalendarAttributes}); renderDeliveryCalendar(); const newMenu=deliveryCalendarPopover?.querySelector('.ss-delivery-calendar-attr-menu'); if(newMenu) newMenu.style.display='block'; };
            lab.append(cb,document.createTextNode(def.label)); attrMenu.appendChild(lab);
        });
        const positionAttrMenu=()=>{ const r=attrBtn.getBoundingClientRect(); const w=Math.min(210,Math.max(170,window.innerWidth-16)); let left=r.right-w; if(left<8) left=8; let top=r.bottom+4; const h=Math.min(320,Math.max(80,window.innerHeight-top-8)); if(top+h>window.innerHeight-8) top=Math.max(8,r.top-h-4); attrMenu.style.width=`${w}px`; attrMenu.style.maxHeight=`${h}px`; attrMenu.style.left=`${left}px`; attrMenu.style.top=`${top}px`; };
        attrBtn.onclick=ev=>{ev.stopPropagation(); const opening=attrMenu.style.display==='none'; if(opening) positionAttrMenu(); attrMenu.style.display=opening?'block':'none';};
        attrWrap.append(attrBtn,attrMenu);
        head.appendChild(attrWrap);
        const scope = document.createElement('select');
        scope.style.cssText = 'font-size:11px;padding:3px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;';
        [['filtered','Фильтрованные'],['all','Все карточки']].forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; scope.appendChild(o); });
        scope.value = deliveryCalendarScope;
        scope.title = deliveryCalendarScope === 'all'
            ? 'Считать все карточки текущего поиска, независимо от фильтров'
            : 'Считать только карточки, оставшиеся после текущих фильтров';
        scope.onchange = () => {
            deliveryCalendarScope = scope.value === 'all' ? 'all' : 'filtered';
            chrome.storage.local.set({deliveryCalendarScope});
            deliveryCalendarDirty = true;
            const tiles = getDeliveryCalendarTiles();
            const firstTs = tiles.map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b)[0];
            if (firstTs) { const d=new Date(firstTs); deliveryCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1); }
            updateDeliveryCalendarButton();
            renderDeliveryCalendar();
        };
        head.appendChild(scope);

        const auto = document.createElement('label');
        auto.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;color:#777;white-space:nowrap;';
        const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=deliveryCalendarAutoRefresh;
        cb.onchange = () => { deliveryCalendarAutoRefresh=cb.checked; chrome.storage.local.set({deliveryCalendarAutoRefresh}); };
        auto.append(cb, document.createTextNode('Авто'));
        head.appendChild(auto);

        const refresh = document.createElement('button');
        refresh.type='button'; refresh.textContent='🔄'; refresh.title='Пересчитать календарь сейчас';
        refresh.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;';
        refresh.onclick=()=>{ deliveryCalendarDirty=true; renderDeliveryCalendar(); };
        head.appendChild(refresh);

        const close = document.createElement('button');
        close.type='button'; close.textContent='✕'; close.title='Закрыть';
        close.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;';
        close.onclick=closeDeliveryCalendar;
        head.appendChild(close);
        if(deliveryCalendarLayout==='vertical') {
            head.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin:0 0 5px;flex:0 0 auto;cursor:grab;user-select:none;';
            title.style.cssText='font-size:12px;flex:1 1 100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
attrBtn.style.cssText='font-size:9px;padding:3px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;white-space:nowrap;';
            scope.style.cssText='font-size:9px;padding:3px 4px;border:1px solid #ddd;border-radius:5px;background:#fff;max-width:110px;';
            auto.style.cssText='display:flex;align-items:center;gap:2px;font-size:9px;color:#777;white-space:nowrap;';
            refresh.style.cssText='padding:2px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:11px;';
            close.style.cssText='padding:2px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:11px;';
        }
        deliveryCalendarPopover.appendChild(head);

        if (!tiles.length || !data.size) {
            const empty=document.createElement('div');
            empty.textContent='В текущей выборке нет карточек с датой доставки.';
            empty.style.cssText='padding:18px 8px;color:#888;font-size:12px;text-align:center;';
            deliveryCalendarPopover.appendChild(empty);
            return;
        }

        const selectInfo=document.createElement('div');
        selectInfo.style.cssText='display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0 0 5px;padding:4px 5px;border-radius:6px;background:#f7f9fb;font-size:9px;color:#666;flex:0 0 auto;';
        const selText=document.createElement('span'); selText.textContent=deliveryCalendarSelectedDates.size ? `Выбрано дат: ${deliveryCalendarSelectedDates.size}` : 'Выберите даты'; selectInfo.appendChild(selText);
        const clearSel=document.createElement('button'); clearSel.type='button'; clearSel.textContent='Очистить'; clearSel.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:10px;'; clearSel.onclick=()=>{deliveryCalendarSelectedDates.clear();deliveryCalendarAnchorKey=null;removeCalendarDateFilter();renderDeliveryCalendar();}; selectInfo.appendChild(clearSel);
        const applySel=document.createElement('button'); applySel.type='button'; applySel.textContent='Применить фильтр'; applySel.style.cssText='padding:3px 7px;border:1px solid #90caf9;border-radius:5px;background:#eaf3ff;color:#1565c0;cursor:pointer;font-size:10px;'; applySel.disabled=!deliveryCalendarSelectedDates.size; applySel.onclick=()=>applyCalendarDateFilter([...deliveryCalendarSelectedDates]); selectInfo.appendChild(applySel);
        const zeroLabel=document.createElement('label'); zeroLabel.style.cssText='display:flex;align-items:center;gap:3px;margin-left:auto;'; const zeroCb=document.createElement('input'); zeroCb.type='checkbox'; zeroCb.checked=deliveryCalendarExcludeZeroUnit; zeroCb.onchange=()=>{deliveryCalendarExcludeZeroUnit=zeroCb.checked;chrome.storage.local.set({deliveryCalendarExcludeZeroUnit});renderDeliveryCalendar();}; zeroLabel.append(zeroCb,document.createTextNode('Не учитывать 0 ₽/ед.')); selectInfo.appendChild(zeroLabel);
        deliveryCalendarPopover.appendChild(selectInfo);

        // Непрерывная шкала дат: месяцы больше не являются вкладками.
        const dateEntries=[...data.entries()].sort((a,b)=>a[1].ts-b[1].ts);
        const firstDataTs=dateEntries.length ? dateEntries[0][1].ts : null;
        const lastDataTs=dateEntries.length ? dateEntries[dateEntries.length-1][1].ts : null;
        const firstMonth=firstDataTs!=null ? new Date(new Date(firstDataTs).getFullYear(),new Date(firstDataTs).getMonth(),1) : new Date(deliveryCalendarMonth);
        const lastMonth=lastDataTs!=null ? new Date(new Date(lastDataTs).getFullYear(),new Date(lastDataTs).getMonth(),1) : new Date(firstMonth);
        const monthList=[];
        for(let md=new Date(firstMonth); md<=lastMonth; md=new Date(md.getFullYear(),md.getMonth()+1,1)) monthList.push(new Date(md));
        if(!monthList.length) monthList.push(new Date(deliveryCalendarMonth));
        // Для лент диапазон прокрутки ограничиваем точными датами доставки всех карточек,
        // а не началом/концом календарных месяцев. В режиме «Фильтрованные» этот
        // диапазон намеренно остаётся тем же, поскольку data построена по всем tiles.
        const deliveryRangeStart = firstDataTs != null ? new Date(firstDataTs) : null;
        const deliveryRangeEnd = lastDataTs != null ? new Date(lastDataTs) : null;
        const deliveryStartDay = deliveryRangeStart ? deliveryRangeStart.getDate() : 1;
        const deliveryEndDay = deliveryRangeEnd ? deliveryRangeEnd.getDate() : 31;

        const nav=document.createElement('div');
        nav.className='ss-delivery-calendar-nav';
        nav.style.cssText='display:flex;align-items:center;gap:5px;margin:0 0 5px;min-height:24px;flex:0 0 auto;';
        const currentLabel=document.createElement('strong');
        currentLabel.textContent='';
        currentLabel.title='Текущий месяц по положению прокрутки';
        currentLabel.style.cssText='font-size:11px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-transform:capitalize;';
        const todayBtn=document.createElement('button');
        todayBtn.type='button'; todayBtn.textContent='Сегодня'; todayBtn.title='Прокрутить к сегодняшней дате';
        todayBtn.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:10px;white-space:nowrap;flex:0 0 auto;';
        nav.append(currentLabel,todayBtn);
        deliveryCalendarPopover.appendChild(nav);

        const ribbon=document.createElement('div');
        ribbon.className='ss-delivery-calendar-days ss-delivery-calendar-date-list';
        const sizeValue=getCalendarCellSize();
        const cellScale=Math.min(1.55,Math.max(0.72,sizeValue/105));
        const sc={
            font:Math.max(11,Math.round(12*cellScale*10)/10),
            price:Math.max(9,Math.round(9.5*cellScale*10)/10),
            unit:Math.max(8.5,Math.round(8.5*cellScale*10)/10),
            extra:Math.max(8.5,Math.round(8.5*cellScale*10)/10),
            count:Math.max(8,Math.round(7.5*cellScale*10)/10),
            width:Math.round(sizeValue),
            minHeight:Math.max(72,Math.round(sizeValue*0.82))
        };

        const influenceKeys=getDeliveryCalendarInfluenceKeys();
        const remainingCounts=getDeliveryCalendarRemainingCounts();

        const filteredData = deliveryCalendarScope==='filtered' && Array.isArray(currentTiles)
            ? buildDeliveryCalendarData(currentTiles) : null;
        const deliveryQueryMatcher = deliveryCalendarScope==='filtered'
            ? getDeliveryCalendarQueryDateMatcher() : null;
        // Все сводные показатели должны использовать тот же набор карточек,
        // что и содержимое ячеек в выбранном режиме. В режиме «Фильтрованные»
        // currentTiles уже содержит результат текущих фильтров (включая @доставка).
        const summaryData = filteredData || data;
        const summaryTiles = deliveryCalendarScope==='filtered' && Array.isArray(currentTiles) ? currentTiles : tiles;

        // Даты лучших вариантов для визуального выделения непосредственно в ячейках.
        // Набор строится из summaryData, поэтому в режиме «Фильтрованные» он
        // автоматически соответствует текущему набору карточек.
        const cheapDateKeys=new Set();
        const cheapUnitDateKeys=new Set();
        if(deliveryCalendarAttributes.price !== false){
            const priced=[...summaryData.values()].filter(x=>x.prices?.length);
            if(priced.length){
                const cheapest=priced.reduce((best,x)=>Math.min(best,Math.min(...x.prices)),Infinity);
                for(const [key,x] of summaryData.entries()) if(x.prices?.length && Math.min(...x.prices)===cheapest) cheapDateKeys.add(key);
            }
        }
        if(deliveryCalendarAttributes.perunit !== false){
            let bestValue=Infinity;
            const candidates=[];
            for(const [key,x] of summaryData.entries()) for(const u of x.units.values()) if(u.values?.length){
                const min=Math.min(...u.values);
                candidates.push({key,min});
                if(min<bestValue) bestValue=min;
            }
            candidates.filter(c=>c.min===bestValue).forEach(c=>cheapUnitDateKeys.add(c.key));
        }
        // В режиме «Фильтрованные» значения внутри диапазона @доставка считаем
        // по текущему результату поиска. Но ячейки ВНЕ диапазона @доставка не
        // должны терять информацию: для них показываем исходные данные даты.
        let totalMonthItems=data.size;
        const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

        function makeDateCell(key,item,y,m,day,ribbonCell=true){
            const selected=deliveryCalendarSelectedDates.has(key);
            const inFiltered=filteredKeys ? filteredKeys.has(key) : true;
            const hasInfluence=influenceKeys ? influenceKeys.has(key) : true;
            const noInfluence=deliveryCalendarScope==='filtered' && influenceKeys && item && !hasInfluence;
            const subdued=deliveryCalendarScope==='filtered' && filteredKeys && !inFiltered;
            const isCheapest=cheapDateKeys.has(key);
            const isCheapestUnit=cheapUnitDateKeys.has(key);
            const cell=document.createElement('div');
            const viewScale=ribbonCell?cellScale:1;
            const viewMinHeight=ribbonCell?sc.minHeight:68;
            const cellFont=Math.max(8,Math.min(20,getCalendarFontSize()));
            const cellBorder=noInfluence?'#d89b00':selected?'#1976d2':isCheapest&&isCheapestUnit?'#9b70c9':isCheapest?'#69a96f':isCheapestUnit?'#9a79c9':subdued?'#ddd':'#eee';
            const cellBackground=noInfluence?'#fff8df':selected?'#eaf3ff':isCheapest&&isCheapestUnit?'#f5eefb':isCheapest?'#eff9f0':isCheapestUnit?'#f6f0fb':subdued?'#fafafa':'#fff';
            cell.dataset.deliveryDateState=noInfluence?'no-influence':(subdued?'subdued':'active');
            cell.style.cssText=`position:relative;${ribbonCell?`width:${sc.width}px;min-width:${sc.width}px;flex:0 0 ${sc.width}px;`:''}min-height:${viewMinHeight}px;border:1px solid ${cellBorder};border-radius:7px;padding:${Math.max(5,Math.round(5*cellScale))}px;box-sizing:border-box;background:${cellBackground};opacity:${subdued&&!noInfluence?'0.55':'1'};overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start;`;
            if(noInfluence) cell.style.boxShadow='inset 3px 0 0 #e0a000';
            else if(isCheapest&&isCheapestUnit) cell.style.boxShadow='inset 3px 0 0 #7b4fa3';
            else if(isCheapest) cell.style.boxShadow='inset 3px 0 0 #4d9854';
            else if(isCheapestUnit) cell.style.boxShadow='inset 3px 0 0 #7b5aa6';
            const dayEl=document.createElement('div');dayEl.textContent=`${day} ${['пн','вт','ср','чт','пт','сб','вс'][(new Date(y,m,day).getDay()+6)%7]}`;dayEl.style.cssText=`font-size:${cellFont}px;font-weight:700;color:${subdued?'#999':'#555'};line-height:1.2;`;cell.appendChild(dayEl);
            if(noInfluence){const hint=document.createElement('span');hint.textContent='Не влияет';hint.style.cssText='position:absolute;right:4px;top:4px;font-size:8px;line-height:1;padding:2px 3px;border-radius:3px;background:#fff0b3;color:#9a6b00;font-weight:700;pointer-events:none;white-space:nowrap;';cell.appendChild(hint);}
            if(!noInfluence && (isCheapest || isCheapestUnit)){
                const badge=document.createElement('span');
                badge.textContent=isCheapest&&isCheapestUnit?'💸⚖️':isCheapest?'💸':'⚖️';
                badge.title=isCheapest&&isCheapestUnit?'Дешевле и дешевле за единицу':isCheapest?'Дешевле':'Дешевле за единицу';
                badge.style.cssText='position:absolute;right:4px;top:4px;font-size:10px;line-height:1;padding:2px 3px;border-radius:4px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);pointer-events:none;';
                cell.appendChild(badge);
            }
            if(item){
                // Если есть @доставка и дата ячейки вне его диапазона —
                // оставляем исходные значения. Внутри диапазона используем
                // пересчитанные по текущему фильтру данные.
                const cellTs=new Date(y,m,day).getTime();
                const useFilteredValues=!!filteredData && (!deliveryQueryMatcher || deliveryQueryMatcher(cellTs));
                const displayItem = useFilteredValues ? (filteredData.get(key) || null) : item;
                const prices=displayItem?.prices || [], showPrice=deliveryCalendarAttributes.price!==false, showUnit=deliveryCalendarAttributes.perunit!==false;
                if(showPrice&&prices.length){const min=Math.min(...prices),max=Math.max(...prices),val=document.createElement('div');val.textContent=`💰 ${min===max?formatCalendarMoney(min,2):`${formatCalendarMoney(min,2)}–${formatCalendarMoney(max,2)}`}`;val.style.cssText=`font-size:${cellFont}px;font-weight:700;line-height:1.2;margin-top:3px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);}
                if(showUnit&&displayItem?.units?.size)[...displayItem.units.values()].slice(0,2).forEach(u=>{const min=Math.min(...u.values),max=Math.max(...u.values),val=document.createElement('div'),minText=min.toLocaleString('ru-RU',{maximumFractionDigits:2}),maxText=max.toLocaleString('ru-RU',{maximumFractionDigits:2});val.textContent=`⚖️ ${min===max?minText:`${minText}–${maxText}`} ${detectCurrency()}/${u.unit}`;val.style.cssText=`font-size:${cellFont}px;font-weight:700;line-height:1.15;margin-top:2px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);});
                for(const [attrName,vals] of (displayItem?.attrs || new Map()).entries()){if(deliveryCalendarAttributes[`extra:${attrName}`]===false||!vals.length)continue;const min=Math.min(...vals),max=Math.max(...vals),val=document.createElement('div');val.textContent=`${attrName}: ${min===max?min.toLocaleString('ru-RU',{maximumFractionDigits:2}):`${min.toLocaleString('ru-RU',{maximumFractionDigits:2})}–${max.toLocaleString('ru-RU',{maximumFractionDigits:2})}`}`;val.style.cssText=`font-size:${cellFont}px;line-height:1.15;margin-top:2px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);}
                const count=document.createElement('div');const remaining=remainingCounts.get(key);count.textContent=`${item.count} карточек (${Number.isFinite(remaining)?remaining:0})`;count.style.cssText=`font-size:${cellFont}px;color:#999;margin-top:2px;line-height:1.1;`;cell.appendChild(count);
                const dateText=`${String(day).padStart(2,'0')}.${String(m+1).padStart(2,'0')}.${y}`;
                cell.title=`${dateText} · ${item.count} карточек · клик — выбрать дату, Shift — диапазон, Ctrl/Cmd — добавить/убрать${noInfluence?' · текущие остальные фильтры не оставляют карточек на эту дату':''}`;
                cell.style.cursor='pointer'; cell.dataset.deliveryDateKey=key; cell.addEventListener('click',ev=>toggleCalendarDate(key,dateText,ev));
            } else {
                cell.style.background='#fafafa';
                // Пустая дата всё равно является точкой прокрутки: кнопка «Сегодня»
                // должна работать даже если на сегодня нет карточки с доставкой.
                cell.dataset.deliveryDateKey=key;
            }
            return cell;
        }

        function updateCurrentMonthLabel(){
            const months=monthList;
            let active=null;
            if(deliveryCalendarLayout==='vertical'){
                const top=ribbon.scrollTop||0;
                const rows=ribbon.querySelectorAll('[data-vmonth]');
                let best=null;
                rows.forEach(n=>{const r=n.getBoundingClientRect(), rr=ribbon.getBoundingClientRect(); const dist=Math.abs(r.top-Math.max(rr.top, r.top)); if(r.bottom>=rr.top+20 && (!best||dist<best.dist)) best={node:n,dist};});
                if(best) active=best.node.dataset.vmonth;
                if(!active && months.length) active=`${months[0].getFullYear()}-${String(months[0].getMonth()+1).padStart(2,'0')}`;
            } else {
                const blocks=ribbon.querySelectorAll('[data-month-key]');
                const rr=ribbon.getBoundingClientRect();
                let best=null;
                blocks.forEach(b=>{const r=b.getBoundingClientRect(); const visible=deliveryCalendarLayout==='horizontal'?Math.max(0,Math.min(r.right,rr.right)-Math.max(r.left,rr.left)):Math.max(0,Math.min(r.bottom,rr.bottom)-Math.max(r.top,rr.top)); if(visible>0 && (!best||visible>best.visible)) best={key:b.dataset.monthKey,visible};});
                if(best) active=best.key;
            }
            if(!active){const d=deliveryCalendarMonth;active=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
            const [yy,mm]=active.split('-').map(Number);
            const md=new Date(yy,mm-1,1);
            currentLabel.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
            deliveryCalendarMonth=md;
        }

        if(deliveryCalendarLayout==='horizontal') {
            ribbon.style.cssText='display:flex;align-items:stretch;gap:6px;overflow-x:auto;overflow-y:hidden;flex:1 1 auto;min-height:0;padding:2px 2px 9px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            for(const md of monthList){
                const y=md.getFullYear(),m=md.getMonth();
                const monthWrap=document.createElement('div'); monthWrap.className='ss-delivery-calendar-month-block'; monthWrap.dataset.monthKey=`${y}-${String(m+1).padStart(2,'0')}`;
                monthWrap.style.cssText='display:flex;align-items:stretch;gap:5px;flex:0 0 auto;';
                const monthLabel=document.createElement('div'); monthLabel.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); monthLabel.style.cssText=`flex:0 0 auto;width:${Math.max(70,Math.round(sc.width*.62))}px;display:flex;align-items:center;justify-content:center;padding:4px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px;font-size:9px;font-weight:700;color:#667;writing-mode:vertical-rl;transform:rotate(180deg);box-sizing:border-box;`;
                const daysWrap=document.createElement('div'); daysWrap.style.cssText='display:flex;gap:4px;align-items:stretch;';
                const monthFirstDay=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;
                const monthLastDay=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();
                for(let day=monthFirstDay;day<=monthLastDay;day++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;daysWrap.appendChild(makeDateCell(key,data.get(key),y,m,day,true));}
                monthWrap.append(monthLabel,daysWrap); ribbon.appendChild(monthWrap);
            }
        } else if(deliveryCalendarLayout==='vertical') {
            ribbon.style.cssText='display:block;position:relative;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;height:auto;padding:2px 3px 6px 2px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            const entries=[];
            for(const md of monthList){const y=md.getFullYear(),m=md.getMonth();entries.push({type:'month',y,m,ts:md.getTime()});const monthFirstDay=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;const monthLastDay=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();for(let day=monthFirstDay;day<=monthLastDay;day++)entries.push({type:'date',y,m,day,key:`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`});}
            const monthH=24,rowH=sc.minHeight+5,offsets=new Array(entries.length+1);offsets[0]=0;
            for(let i=0;i<entries.length;i++)offsets[i+1]=offsets[i]+(entries[i].type==='month'?monthH:rowH);
            const canvas=document.createElement('div');canvas.style.cssText=`position:relative;width:100%;height:${offsets[entries.length]}px;`;ribbon.appendChild(canvas);
            const findIndex=scrollTop=>{let lo=0,hi=entries.length;while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid+1]<=scrollTop)lo=mid+1;else hi=mid;}return lo;};
            const renderVirtual=()=>{canvas.querySelectorAll('[data-vrow]').forEach(e=>e.remove());const top=ribbon.scrollTop||0,viewport=ribbon.clientHeight||400,from=Math.max(0,findIndex(Math.max(0,top-rowH*5))),to=Math.min(entries.length,findIndex(top+viewport+rowH*5)+1);for(let i=from;i<to;i++){const e=entries[i],node=document.createElement('div');node.dataset.vrow='1';node.style.cssText=`position:absolute;left:0;right:0;top:${offsets[i]}px;box-sizing:border-box;`;if(e.type==='month'){node.dataset.vmonth=`${e.y}-${String(e.m+1).padStart(2,'0')}`;node.textContent=new Date(e.y,e.m,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});node.style.cssText+=`height:${monthH}px;padding:3px 6px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px;font-size:10px;font-weight:700;color:#667;text-transform:capitalize;display:flex;align-items:center;`;}else{const cell=makeDateCell(e.key,data.get(e.key),e.y,e.m,e.day,false);cell.style.width='100%';cell.style.minWidth='0';cell.style.height=`${sc.minHeight}px`;node.appendChild(cell);}canvas.appendChild(node);}};
            let virtualRaf=0;ribbon.addEventListener('scroll',()=>{cancelAnimationFrame(virtualRaf);virtualRaf=requestAnimationFrame(()=>{renderVirtual();updateCurrentMonthLabel();});},{passive:true});renderVirtual();
        } else {
            // Стандартный календарь: полноценная сетка Пн–Вс для каждого месяца.
            // Ширина ячеек определяется шириной окна, высота — доступной высотой.
            ribbon.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 3px 8px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            for(const md of monthList){
                const y=md.getFullYear(),m=md.getMonth(),block=document.createElement('div');block.dataset.monthKey=`${y}-${String(m+1).padStart(2,'0')}`;block.style.cssText='flex:0 0 auto;';
                const ml=document.createElement('div');ml.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});ml.style.cssText='padding:3px 6px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px 6px 0 0;font-size:10px;font-weight:700;color:#667;text-transform:capitalize;';block.appendChild(ml);
                const week=document.createElement('div');week.style.cssText='display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;padding:3px 2px 0;';weekdays.forEach(w=>{const e=document.createElement('div');e.textContent=w;e.style.cssText='text-align:center;font-size:8px;font-weight:700;color:#999;line-height:14px;';week.appendChild(e);});block.appendChild(week);
                const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;padding:0 2px 3px;';
                const first=(new Date(y,m,1).getDay()+6)%7, days=new Date(y,m+1,0).getDate();
                for(let i=0;i<first;i++){const blank=document.createElement('div');blank.style.cssText='min-width:0;min-height:1px;';grid.appendChild(blank);}
                for(let day=1;day<=days;day++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const cell=makeDateCell(key,data.get(key),y,m,day,false);cell.style.width='100%';cell.style.minWidth='0';grid.appendChild(cell);}
                block.appendChild(grid);ribbon.appendChild(block);
            }
            ribbon.addEventListener('scroll',updateCurrentMonthLabel,{passive:true});
        }
        deliveryCalendarPopover.appendChild(ribbon);
        // В горизонтальной ленте обычное колесо мыши прокручивает по горизонтали.
        if(deliveryCalendarLayout==='horizontal') ribbon.addEventListener('wheel',ev=>{if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)){ev.preventDefault();ribbon.scrollLeft+=ev.deltaY;}},{passive:false});
        requestAnimationFrame(()=>{
            if(deliveryCalendarLayout==='horizontal' || deliveryCalendarLayout==='vertical'){
                ribbon.scrollLeft=deliveryCalendarRibbonScroll.left||0;
                ribbon.scrollTop=deliveryCalendarRibbonScroll.top||0;
            } else {
                ribbon.scrollTop=deliveryCalendarContentScrollTop||0;
            }
            updateCurrentMonthLabel();
        });
        todayBtn.onclick=()=>{
            const now=new Date();
            const todayTs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
            const clampTs=deliveryRangeStart&&deliveryRangeEnd ? Math.min(Math.max(todayTs,deliveryRangeStart.getTime()),deliveryRangeEnd.getTime()) : todayTs;
            const targetDate=new Date(clampTs);
            const key=`${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
            if(deliveryCalendarLayout==='horizontal'){
                const el=ribbon.querySelector(`[data-delivery-date-key="${key}"]`);
                if(el) ribbon.scrollTo({left:Math.max(0,el.offsetLeft-12),behavior:'smooth'});
            } else if(deliveryCalendarLayout==='vertical'){
                // В виртуальной ленте ячейка может отсутствовать в DOM. Вычисляем её
                // положение по той же геометрии, поэтому «Сегодня» работает и для
                // пустой даты, и при большом количестве месяцев.
                const monthH=24,rowH=sc.minHeight+5;
                let offset=0,found=false;
                for(const md of monthList){
                    const y=md.getFullYear(),m=md.getMonth();
                    offset+=monthH;
                    const first=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;
                    const last=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();
                    if(y===targetDate.getFullYear()&&m===targetDate.getMonth()){
                        offset+=(Math.max(0,targetDate.getDate()-first))*rowH; found=true; break;
                    }
                    offset+=(last-first+1)*rowH;
                }
                if(found) ribbon.scrollTo({top:Math.max(0,offset-(ribbon.clientHeight-rowH)/2),behavior:'smooth'});
            } else {
                const el=ribbon.querySelector(`[data-delivery-date-key="${key}"]`);
                if(el) el.scrollIntoView({block:'center',behavior:'smooth'});
            }
        };
        // Короткая подсказка для принятия решения: самая ранняя доставка
        // и самая низкая цена среди текущих карточек.
        const datedItems=[...summaryData.values()].sort((a,b)=>a.ts-b.ts);
        const decision=document.createElement('div');
        decision.style.cssText=`display:flex;flex-wrap:wrap;gap:2px 7px;margin-top:4px;padding:4px 6px;border-radius:6px;background:#f7f9fb;font-size:9px;color:#555;line-height:1.2;box-sizing:border-box;overflow:hidden;flex:0 0 auto;`;
        if(datedItems.length){
            const earliest=new Date(datedItems[0].ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
            const fastest=document.createElement('span'); fastest.className='ss-calendar-decision-fastest'; fastest.textContent=`⚡ Быстрее: ${earliest}`; fastest.style.cssText='padding:2px 5px;border-radius:4px;background:#eef7ff;color:#256a9b;font-weight:600;'; decision.appendChild(fastest);
        }
        const showPriceDecision = deliveryCalendarAttributes.price !== false;
        const showUnitDecision = deliveryCalendarAttributes.perunit !== false;
        if(showPriceDecision){
            const priced=[...summaryData.values()].filter(x=>x.prices.length);
            if(priced.length){
                const cheapest=priced.reduce((best,x)=>Math.min(best,Math.min(...x.prices)),Infinity);
                const cheapDate=priced.find(x=>Math.min(...x.prices)===cheapest);
                if(cheapDate){
                    const cheapLabel=new Date(cheapDate.ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
                    const cheap=document.createElement('span'); cheap.className='ss-calendar-decision-cheap'; cheap.textContent=`💸 Дешевле: ${cheapLabel} · ${formatCalendarMoney(cheapest,2)}`; cheap.style.cssText='padding:2px 5px;border-radius:4px;background:#eefaf0;color:#2e7d32;font-weight:600;'; decision.appendChild(cheap);
                }
            }
        }
        if(showUnitDecision){
            const unitCandidates=[];
            for(const x of summaryData.values()) for(const u of x.units.values()) if(u.values.length){
                unitCandidates.push({x,u,min:Math.min(...u.values)});
            }
            if(unitCandidates.length){
                const best=unitCandidates.reduce((a,b)=>b.min<a.min?b:a);
                const label=new Date(best.x.ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
                const cheap=document.createElement('span'); cheap.className='ss-calendar-decision-unit'; cheap.textContent=`⚖️ Дешевле/ед.: ${label} · ${best.min.toLocaleString('ru-RU',{maximumFractionDigits:2})} ${detectCurrency()}/${best.u.unit}`; cheap.style.cssText='padding:2px 5px;border-radius:4px;background:#f5efff;color:#6a45a0;font-weight:600;'; decision.appendChild(cheap);
            }
        }
        deliveryCalendarPopover.appendChild(decision);

        const statsValues=summaryTiles.map(getPrice).filter(v=>Number.isFinite(v)&&v<99999999&&v>=0).sort((a,b)=>a-b);
        const stats=document.createElement('div'); stats.style.cssText='margin-top:4px;padding:4px 6px;border:1px solid #e6e9ed;border-radius:6px;background:#fff;font-size:9px;color:#555;line-height:1.2;box-sizing:border-box;overflow:hidden;white-space:normal;flex:0 0 auto;';
        if(statsValues.length){
            const sum=statsValues.reduce((a,b)=>a+b,0), avg=sum/statsValues.length, mid=Math.floor(statsValues.length/2), med=statsValues.length%2?statsValues[mid]:(statsValues[mid-1]+statsValues[mid])/2;
            const freq=new Map(); statsValues.forEach(v=>freq.set(v,(freq.get(v)||0)+1)); const maxFreq=Math.max(...freq.values()); const modes=[...freq.entries()].filter(([,n])=>n===maxFreq).map(([v])=>v).sort((a,b)=>a-b);
            stats.innerHTML=`<b>Сводка цен:</b> Средняя ${formatCalendarMoney(avg,2)} · Медиана ${formatCalendarMoney(med,2)} · Мода ${modes.slice(0,3).map(v=>formatCalendarMoney(v,2)).join(', ')}${modes.length>3?'…':''}`; stats.title='Средняя — среднее арифметическое цен. Медиана — центральная цена в отсортированном списке. Мода — наиболее часто встречающаяся цена.';
        } else stats.textContent='Сводка цен: нет корректных цен.';
        deliveryCalendarPopover.appendChild(stats);

        const footer=document.createElement('div');
        footer.style.cssText='font-size:8.5px;color:#888;margin-top:3px;line-height:1.15;white-space:normal;overflow-wrap:anywhere;flex:0 0 auto;';
        const modeText=[deliveryCalendarAttributes.price!==false?'цена':'',deliveryCalendarAttributes.perunit!==false?'цена/ед.':'',...Object.keys(deliveryCalendarAttributes).filter(k=>k.startsWith('extra:')&&deliveryCalendarAttributes[k]).map(k=>k.slice(6))].filter(Boolean).join(', ') || 'ничего не выбрано';
        const scopeText=deliveryCalendarScope==='all'?'все карточки':'отфильтрованные';
        footer.textContent=`${summaryTiles.length} карточек с доставкой · ${totalMonthItems} дат · ${modeText} · ${scopeText}`;
        deliveryCalendarPopover.appendChild(footer);
    }

    function toggleCalendarDate(key, dateText, ev) {
        const keys=[...document.querySelectorAll('#ss-delivery-calendar [data-delivery-date-key]')].map(x=>x.dataset.deliveryDateKey);
        if (ev.shiftKey && deliveryCalendarAnchorKey) {
            const all=[...getDeliveryCalendarTiles()].map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b).map(ts=>{const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
            const a=all.indexOf(deliveryCalendarAnchorKey), b=all.indexOf(key);
            if(a>=0 && b>=0){ const lo=Math.min(a,b), hi=Math.max(a,b); for(let i=lo;i<=hi;i++) deliveryCalendarSelectedDates.add(all[i]); }
        } else if (ev.ctrlKey || ev.metaKey) {
            if(deliveryCalendarSelectedDates.has(key)) deliveryCalendarSelectedDates.delete(key); else deliveryCalendarSelectedDates.add(key);
            deliveryCalendarAnchorKey=key;
        } else {
            if(deliveryCalendarSelectedDates.size===1 && deliveryCalendarSelectedDates.has(key)) deliveryCalendarSelectedDates.delete(key);
            else { deliveryCalendarSelectedDates.clear(); deliveryCalendarSelectedDates.add(key); }
            deliveryCalendarAnchorKey=key;
        }
        renderDeliveryCalendar();
        if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) applyCalendarDateFilter([...deliveryCalendarSelectedDates]);
    }

    function removeCalendarDateFilter() {
        if (!searchInput || activeTab !== 'search') return;
        const dateRe=/\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const next=searchInput.value.replace(dateRe,' ').replace(/\s{2,}/g,' ').trim();
        if (next!==searchInput.value.trim()) { searchInput.value=next; searchInput.dispatchEvent(new Event('input',{bubbles:true})); scheduleApplyFilters(); }
    }

    function applyCalendarDateFilter(dateKeysOrTexts) {
        if (!searchInput || activeTab !== 'search') return;
        const arr=Array.isArray(dateKeysOrTexts)?dateKeysOrTexts:[dateKeysOrTexts];
        const dates=arr.map(v=>{
            if(/^\d{4}-\d{2}-\d{2}$/.test(String(v))){const [y,m,d]=String(v).split('-');return `${d}.${m}.${y}`;}
            return String(v);
        }).filter(Boolean);
        if(!dates.length) return;
        const ts=dates.map(x=>{const m=x.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);return m?new Date(Number(m[3].length===2?'20'+m[3]:m[3]),Number(m[2])-1,Number(m[1])).getTime():NaN;}).filter(Number.isFinite).sort((a,b)=>a-b);
        const ranges=[];
        for(const t of ts){ if(!ranges.length || t>ranges[ranges.length-1].max+86400000) ranges.push({min:t,max:t}); else ranges[ranges.length-1].max=t; }
        const fmt=t=>{const d=new Date(t);return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;};
        const clause=ranges.map(r=>r.min===r.max?fmt(r.min):`${fmt(r.min)}-${fmt(r.max)}`).join(' ');
        const dateClause=`@доставка(${clause})`;
        const current=searchInput.value.trim();
        const dateRe=/@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const next=dateRe.test(current)?current.replace(dateRe,dateClause):(current?`${current} ${dateClause}`:dateClause);
        searchInput.value=next.trim();
        searchInput.dispatchEvent(new Event('input',{bubbles:true}));
        scheduleApplyFilters();
    }

    function clampDeliveryCalendarPosition() {
        if (!deliveryCalendarPopover) return;
        const rect=deliveryCalendarPopover.getBoundingClientRect();
        const margin=8, maxLeft=Math.max(margin, window.innerWidth-80), maxTop=Math.max(margin, window.innerHeight-50);
        const deliveryCalendarPosition=getCalendarLayoutPosition();
        let left=Number.isFinite(deliveryCalendarPosition.left) ? deliveryCalendarPosition.left : Math.max(margin,(window.innerWidth-rect.width)/2);
        let top=Number.isFinite(deliveryCalendarPosition.top) ? deliveryCalendarPosition.top : Math.max(margin,(window.innerHeight-rect.height)/2);
        left=Math.min(Math.max(margin,left),maxLeft); top=Math.min(Math.max(margin,top),maxTop);
        deliveryCalendarPosition.left=left; deliveryCalendarPosition.top=top;
        deliveryCalendarPopover.style.left=`${left}px`; deliveryCalendarPopover.style.top=`${top}px`;
    }
    function applyDeliveryCalendarGeometry(reset=false) {
        if (!deliveryCalendarPopover) return;
        const pos=getCalendarLayoutPosition();
        const cell=getCalendarCellSize();
        let minWidth=360, preferredWidth=520, preferredHeight=null;
        if(deliveryCalendarLayout==='vertical') { minWidth=205; preferredWidth=Math.max(220,Math.min(340,cell+34)); preferredHeight=Math.min(Math.max(420,window.innerHeight*0.72),Math.max(420,window.innerHeight-32)); }
        else if(deliveryCalendarLayout==='horizontal') { minWidth=360; preferredWidth=Math.min(window.innerWidth-16,Math.max(520,Math.min(980,cell*6))); preferredHeight=Math.min(window.innerHeight-16,Math.max(250,cell*2.15)); }
        else { minWidth=520; preferredWidth=Math.min(window.innerWidth-16,Math.max(520,window.innerWidth*0.72)); preferredHeight=Math.min(window.innerHeight-16,Math.max(360,window.innerHeight*0.72)); }
        if(reset || !Number.isFinite(pos.width)) deliveryCalendarPopover.style.width=`${Math.max(minWidth,preferredWidth)}px`;
        else deliveryCalendarPopover.style.width=`${Math.max(minWidth,Math.min(pos.width,Math.max(minWidth,window.innerWidth-16)))}px`;
        if(reset || !Number.isFinite(pos.height)) deliveryCalendarPopover.style.height=preferredHeight?`${Math.max(280,preferredHeight)}px`:'';
        else deliveryCalendarPopover.style.height=`${Math.max(280,Math.min(pos.height,window.innerHeight-16))}px`;
        deliveryCalendarPopover.style.maxWidth='calc(100vw - 16px)';
        deliveryCalendarPopover.style.resize=deliveryCalendarLayout==='vertical'?'vertical':deliveryCalendarLayout==='horizontal'?'horizontal':'both';
        clampDeliveryCalendarPosition();
    }
    function setupDeliveryCalendarDragResize() {
        if (!deliveryCalendarPopover) return;
        if (!deliveryCalendarPopover.dataset.dragBound) {
            deliveryCalendarPopover.dataset.dragBound='1';
            deliveryCalendarPopover.addEventListener('mousedown', ev=>{
                if (!ev.target.closest('.ss-delivery-calendar-drag') || ev.target.closest('button,select,input,label')) return;
                ev.preventDefault();
                const r=deliveryCalendarPopover.getBoundingClientRect(), sx=ev.clientX, sy=ev.clientY, ox=r.left, oy=r.top;
                const move=e=>{ const pos=getCalendarLayoutPosition(); pos.left=ox+(e.clientX-sx); pos.top=oy+(e.clientY-sy); clampDeliveryCalendarPosition(); };
                const up=()=>{ window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up); chrome.storage.local.set({deliveryCalendarPositions}); };
                window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
            });
        }
        deliveryCalendarResizeObserver?.disconnect();
        deliveryCalendarResizeObserver=new ResizeObserver(()=>{
            if (!deliveryCalendarPopover) return;
            const r=deliveryCalendarPopover.getBoundingClientRect();
            const pos=getCalendarLayoutPosition();
            if(deliveryCalendarLayout!=='vertical') pos.width=Math.round(r.width);
            if(deliveryCalendarLayout!=='horizontal') pos.height=Math.round(r.height);
            clampDeliveryCalendarPosition(); chrome.storage.local.set({deliveryCalendarPositions});
        });
        deliveryCalendarResizeObserver.observe(deliveryCalendarPopover);
    }
    function openDeliveryCalendar() {
        if (deliveryCalendarPopover) { closeDeliveryCalendar(); return; }
        deliveryCalendarOpen = true;
        if (deliveryCalendarDirty) {
            const tiles=getDeliveryCalendarTiles(); const firstTs=tiles.map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b)[0];
            if (firstTs) { const d=new Date(firstTs); deliveryCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1); }
        }
        deliveryCalendarPopover=document.createElement('div');
        deliveryCalendarPopover.id='ss-delivery-calendar';
        deliveryCalendarPopover.style.cssText='position:fixed;z-index:2147483646;width:520px;min-width:240px;min-height:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);resize:both;overflow:hidden;background:#fff;color:#333;border:1px solid #d8d8d8;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:8px;font:12px/1.3 sans-serif;box-sizing:border-box;display:flex;flex-direction:column;min-height:280px;';
        // Лента не должна наследовать широкую сеточную геометрию.
        document.body.appendChild(deliveryCalendarPopover);
        applyDeliveryCalendarGeometry();
        renderDeliveryCalendar();
        setupDeliveryCalendarDragResize();
        deliveryCalendarWindowHandler=()=>{ clampDeliveryCalendarPosition(); chrome.storage.local.set({deliveryCalendarPositions}); };
        window.addEventListener('resize',deliveryCalendarWindowHandler);
        deliveryCalendarMenuClickHandler = ev => {
            const attrWrap = deliveryCalendarPopover?.querySelector('.ss-delivery-calendar-attr-wrap');
            const moreWrap = deliveryCalendarActionsWrap;
            if (attrWrap && !attrWrap.contains(ev.target)) {
                const menu=attrWrap.querySelector('.ss-delivery-calendar-attr-menu'); if(menu) menu.style.display='none';
            }
            if (moreWrap && !moreWrap.contains(ev.target)) {
                moreMenu.style.display='none';
            }
        };
        document.addEventListener('click', deliveryCalendarMenuClickHandler);
    }

    function updateDeliveryCalendarButton() {
        if (!deliveryCalendarButton) return;
        const count=getDeliveryCalendarTiles().length;
        deliveryCalendarActionsWrap.style.display=count?'inline-flex':'none';
        deliveryCalendarActionsWrap.style.display=count?'inline-flex':'none';
        deliveryCalendarButton.style.display=count?'inline-flex':'none';
        deliveryCalendarButton.title=count ? `📅 Календарь доставки · ${count} карточек · ${deliveryCalendarScope === 'all' ? 'все' : 'отфильтрованные'}` : 'Нет данных о доставке';
        deliveryCalendarButton.textContent=count ? `📅 ${count}` : '📅';
        if (deliveryCalendarOpen && deliveryCalendarAutoRefresh) scheduleDeliveryCalendarRefresh();
    }

    deliveryCalendarButton=document.createElement('button');
    deliveryCalendarButton.type='button';
    deliveryCalendarButton.textContent='📅';
    deliveryCalendarButton.style.cssText='display:none;align-items:center;gap:3px;padding:4px 7px;border:1px solid #ddd;border-right:0;border-radius:6px 0 0 6px;background:#fff;color:#666;cursor:pointer;font-size:11px;white-space:nowrap;';
    deliveryCalendarButton.addEventListener('click',openDeliveryCalendar);

    // Действия календаря находятся рядом с кнопкой 📅, а не внутри самого окна.
    const deliveryCalendarActionsWrap = document.createElement('div');
    deliveryCalendarActionsWrap.className = 'ss-delivery-calendar-actions-wrap';
    deliveryCalendarActionsWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:0;';
    const more = document.createElement('button');
    more.type='button'; more.textContent='⋮'; more.title='Дополнительные действия';
    more.style.cssText='padding:3px 7px;border:1px solid #ddd;border-radius:0 5px 5px 0;background:#fff;cursor:pointer;font-size:16px;line-height:18px;';
    const moreMenu = document.createElement('div');
    moreMenu.className='ss-delivery-calendar-more-menu';
    moreMenu.style.cssText='display:none;position:absolute;right:0;top:30px;z-index:2147483647;min-width:210px;padding:6px;background:#fff;border:1px solid #ddd;border-radius:7px;box-shadow:0 5px 18px rgba(0,0,0,.18);';
    const resetBtn=document.createElement('button');
    resetBtn.type='button'; resetBtn.textContent='↺ Вернуть и сбросить размер';
    resetBtn.style.cssText='width:100%;padding:6px 8px;border:0;background:#fff;text-align:left;cursor:pointer;font-size:11px;';
    resetBtn.onclick=()=>{deliveryCalendarPositions[deliveryCalendarLayout]={left:null,top:null,width:null,height:null};chrome.storage.local.set({deliveryCalendarPositions});applyDeliveryCalendarGeometry(true);moreMenu.style.display='none';};
    moreMenu.appendChild(resetBtn);
    // Внутренние действия меню не должны закрывать его. Закрытие происходит
    // только при клике вне меню или повторном клике по кнопке ⋮.
    ['pointerdown','mousedown','click','change','input'].forEach(type=>moreMenu.addEventListener(type, ev=>ev.stopPropagation()));

    const sizeLabel=document.createElement('label');
    sizeLabel.style.cssText='display:flex;flex-direction:column;gap:5px;padding:7px 8px;font-size:11px;border-top:1px solid #eee;margin-top:4px;';
    const sizeHead=document.createElement('div');
    sizeHead.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const sizeTitle=document.createElement('span'); sizeTitle.textContent='Размер ячеек';
    const sizeValue=document.createElement('span'); sizeValue.style.cssText='font-variant-numeric:tabular-nums;color:#666;min-width:42px;text-align:right;';
    const sizeRange=document.createElement('input');
    sizeRange.type='range'; sizeRange.min='60'; sizeRange.max='180'; sizeRange.step='5'; sizeRange.value=String(getCalendarCellSize());
    sizeRange.title='Размер ячеек дат';
    sizeRange.style.cssText='width:100%;height:18px;cursor:pointer;';
    const updateSizeValue=()=>{sizeValue.textContent=`${sizeRange.value}px`;};
    updateSizeValue();
    sizeRange.oninput=()=>{
        deliveryCalendarCellSizes[deliveryCalendarLayout]=Math.min(180,Math.max(60,Number(sizeRange.value)));
        updateSizeValue();
        chrome.storage.local.set({deliveryCalendarCellSizes});
        const wasOpen=moreMenu.style.display!=='none';
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    sizeHead.append(sizeTitle,sizeValue); sizeLabel.append(sizeHead,sizeRange); moreMenu.appendChild(sizeLabel);
    const syncSizeControl=()=>{ sizeLabel.style.display=deliveryCalendarLayout==='grid'?'none':'flex'; };
    syncSizeControl();

    const fontLabel=document.createElement('label');
    fontLabel.style.cssText='display:flex;flex-direction:column;gap:5px;padding:7px 8px;font-size:11px;border-top:1px solid #eee;';
    const fontHead=document.createElement('div'); fontHead.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const fontTitle=document.createElement('span'); fontTitle.textContent='Шрифт в ячейках';
    const fontValue=document.createElement('span'); fontValue.style.cssText='font-variant-numeric:tabular-nums;color:#666;min-width:38px;text-align:right;';
    const fontRange=document.createElement('input'); fontRange.type='range'; fontRange.min='8'; fontRange.max='20'; fontRange.step='1'; fontRange.value=String(getCalendarFontSize()); fontRange.style.cssText='width:100%;height:18px;cursor:pointer;';
    const updateFontValue=()=>{fontValue.textContent=`${fontRange.value}px`;}; updateFontValue();
    const syncFontControl=()=>{fontRange.value=String(getCalendarFontSize());updateFontValue();};
    fontRange.oninput=()=>{
        deliveryCalendarFontSizes[deliveryCalendarLayout]=Math.min(20,Math.max(8,Number(fontRange.value)));
        updateFontValue();
        chrome.storage.local.set({deliveryCalendarFontSizes});
        const wasOpen=moreMenu.style.display!=='none';
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    fontHead.append(fontTitle,fontValue); fontLabel.append(fontHead,fontRange); moreMenu.appendChild(fontLabel);

    const layoutLabel=document.createElement('label');
    layoutLabel.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;font-size:11px;';
    layoutLabel.append(document.createTextNode('Вид дат'));
    const layoutSelect=document.createElement('select');
    layoutSelect.style.cssText='font-size:11px;padding:3px 4px;border:1px solid #ddd;border-radius:5px;background:#fff;';
    [['grid','Календарь'],['horizontal','Горизонтальная лента'],['vertical','Вертикальная лента']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;layoutSelect.appendChild(o);});
    layoutSelect.value=deliveryCalendarLayout;
    layoutSelect.onchange=()=>{
        deliveryCalendarLayout=layoutSelect.value;
        syncSizeControl();
        syncFontControl();
        chrome.storage.local.set({deliveryCalendarLayout});
        const wasOpen=moreMenu.style.display!=='none';
        // Меню не закрываем: изменение настройки должно оставить меню открытым.
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    layoutLabel.appendChild(layoutSelect); moreMenu.appendChild(layoutLabel);

    more.onclick=ev=>{ev.stopPropagation();moreMenu.style.display=moreMenu.style.display==='none'?'block':'none';};
    deliveryCalendarActionsWrap.append(deliveryCalendarButton, more, moreMenu);

    const minimizeBtn = document.createElement('button');
    minimizeBtn.textContent = '— Свернуть';
    minimizeBtn.title = 'Свернуть панель (можно кликнуть на страницу)';
    minimizeBtn.style.cssText = `
        padding: 8px 14px; background: #607D8B; color: white;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 500; white-space:nowrap;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Закрыть';
    closeBtn.style.cssText = `
        padding: 8px 14px; background: #dc3545; color: white;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 500; white-space:nowrap;
    `;

    closeBtn.addEventListener('click', closeDeliveryCalendar);

    let debugMode = false;
    chrome.storage.local.get(['debugMode'], d => {
        debugMode = !!d.debugMode;
        updateDebugVisibility();
        if (debugMode) {
            refreshSearchImgBtn.style.display = activeTab === 'search' ? 'inline-block' : 'none';
            refreshSavedImgBtn.style.display = activeTab === 'saved' ? 'inline-block' : 'none';
        }
    });

    // ── Тултип с названием карточки при наведении (можно отключить — при большом
    //    количестве карточек может подтормаживать) ──
    let hoverTooltipEnabled = true;
    chrome.storage.local.get(['hoverTooltipEnabled'], d => {
        hoverTooltipEnabled = d.hoverTooltipEnabled !== false; // по умолчанию включено
        updateHoverBtnStyle();
    });

    function updateHoverBtnStyle() {
        hoverBtn.style.background = hoverTooltipEnabled ? '#2196F3' : 'transparent';
        hoverBtn.style.color = hoverTooltipEnabled ? 'white' : '#999';
        hoverBtn.style.border = hoverTooltipEnabled ? 'none' : '1px solid #ddd';
        hoverBtn.title = hoverTooltipEnabled
            ? 'Подсказка с названием при наведении: включена (нажмите, чтобы отключить — полезно при тормозах на больших списках)'
            : 'Подсказка с названием при наведении: отключена (нажмите, чтобы включить)';
    }

    function updateDebugVisibility() {
        popup.querySelectorAll('.ppg-debug').forEach(el => {
            el.style.display = debugMode ? 'block' : 'none';
        });
        debugBtn.style.background = debugMode ? '#ff9800' : 'transparent';
        debugBtn.style.color = debugMode ? 'white' : '#999';
        debugBtn.style.border = debugMode ? 'none' : '1px solid #ddd';
    }

    const debugBtn = document.createElement('button');
    debugBtn.textContent = '🐛';
    debugBtn.title = 'Debug-режим: показывать отладочную информацию на карточках';
    debugBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s;
    `;
    debugBtn.addEventListener('click', () => {
        debugMode = !debugMode;
        chrome.storage.local.set({ debugMode });
        updateDebugVisibility();
        refreshSearchImgBtn.style.display = debugMode && activeTab === 'search' ? 'inline-block' : 'none';
        refreshSavedImgBtn.style.display = debugMode && activeTab === 'saved' ? 'inline-block' : 'none';
    });

    const hoverBtn = document.createElement('button');
    hoverBtn.textContent = '👁';
    hoverBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s;
    `;
    hoverBtn.addEventListener('click', () => {
        hoverTooltipEnabled = !hoverTooltipEnabled;
        chrome.storage.local.set({ hoverTooltipEnabled });
        updateHoverBtnStyle();
        if (!hoverTooltipEnabled) _ttHide();
    });

    const refreshSearchImgBtn = document.createElement('button');
    refreshSearchImgBtn.textContent = '🖼';
    refreshSearchImgBtn.title = 'Обновить картинки в поиске (сохранить актуальные в IndexedDB)';
    refreshSearchImgBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s; display: none;
    `;
    refreshSearchImgBtn.addEventListener('click', async () => {
        refreshSearchImgBtn.textContent = '⏳';
        refreshSearchImgBtn.disabled = true;
        showNotification('🔄 Принудительная загрузка картинок...');

        // 1. Триггерим загрузку всех ленивых картинок на странице
        //    через IntersectionObserver trick — делаем все img видимыми
        if (SELECTORS) {
            const allImgs = document.querySelectorAll(`${SELECTORS.tile} img[data-src], ${SELECTORS.tile} img[loading="lazy"]`);
            allImgs.forEach(img => {
                if (img.dataset.src && !img.src) img.src = img.dataset.src;
                if (img.loading === 'lazy') img.loading = 'eager';
                // для Intersection Observer — временно помещаем в viewport
                const rect = img.getBoundingClientRect();
                if (rect.top > window.innerHeight || rect.bottom < 0) {
                    img.style.contentVisibility = 'visible';
                }
            });
        }

        // 2. Ждём пока картинки загрузятся (до 3 сек)
        await new Promise(r => setTimeout(r, 1500));

        // 3. Берём картинки с ЖИВЫХ элементов страницы, не из seenTiles
        let count = 0;
        if (SELECTORS) {
            const liveTiles = document.querySelectorAll(SELECTORS.tile);
            await Promise.all([...liveTiles].map(async tile => {
                const key = getTileKey(tile);
                if (!key) return;
                // ищем картинку с наибольшим разрешением
                const imgs = tile.querySelectorAll('img');
                let bestImg = null;
                let bestSize = 0;
                imgs.forEach(img => {
                    const size = (img.naturalWidth || 0) * (img.naturalHeight || 0);
                    if (size > bestSize && img.src && !img.src.startsWith('data:')) {
                        bestSize = size;
                        bestImg = img;
                    }
                });
                const src = bestImg?.currentSrc || bestImg?.src || '';
                if (!src) return;
                const dataUrl = await saveImageToBackground(key, src, true);
                if (dataUrl) {
                    // обновляем seenTiles
                    const clone = tile.cloneNode(true);
                    clone.style.width = '';
                    clone.style.marginRight = '';
                    seenTiles.set(key, clone);
                    // обновляем DOM в сохранённых если открыто
                    const savedTileEl = document.querySelector(`#products-sorted-popup .ss-tile[data-ss-key="${CSS.escape(key)}"]`);
                    if (savedTileEl) {
                        const wrap = savedTileEl.querySelector('.ss-tile__img-wrap');
                        if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
                    }
                    count++;
                }
            }));
        }

        refreshSearchImgBtn.textContent = '🖼';
        refreshSearchImgBtn.disabled = false;
        showNotification(`✅ Обновлено ${count} картинок из поиска`);
    });

    const refreshSavedImgBtn = document.createElement('button');
    refreshSavedImgBtn.textContent = '🖼';
    refreshSavedImgBtn.title = 'Обновить картинки в сохранённых из текущего поиска';
    refreshSavedImgBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s; display: none;
    `;
    refreshSavedImgBtn.addEventListener('click', async () => {
        refreshSavedImgBtn.textContent = '⏳';
        refreshSavedImgBtn.disabled = true;
        let count = 0;
        const saved = await getSavedTiles();
        await Promise.all(saved.map(async item => {
            const liveTile = seenTiles.get(item.key);
            if (!liveTile) return;
            const imgEl = getBestProductImage(liveTile);
            const src = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
            if (!src || src.startsWith('data:')) return;
            const dataUrl = await saveImageToBackground(item.key, src, true);
            if (dataUrl) {
                const tileEl = savedContainer.querySelector(`.ss-tile[data-ss-key="${CSS.escape(item.key)}"]`);
                if (tileEl) {
                    const wrap = tileEl.querySelector('.ss-tile__img-wrap');
                    if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
                }
                count++;
            }
        }));
        refreshSavedImgBtn.textContent = '🖼';
        refreshSavedImgBtn.disabled = false;
        showNotification(`✅ Обновлено ${count} картинок в сохранённых`);
    });

    // Обновление атрибутов карточек — вручную, когда сайт дорисовал рейтинг/отзывы позже.
    const refreshAttrsBtn = document.createElement('button');
    refreshAttrsBtn.type = 'button';
    refreshAttrsBtn.textContent = '🔄';
    refreshAttrsBtn.title = 'Повторно считать атрибуты карточек (рейтинг, отзывы, цена и т.д.)';
    refreshAttrsBtn.style.cssText = `padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px;background:transparent;color:#999;`;
    refreshAttrsBtn.addEventListener('click', async () => {
        refreshAttrsBtn.textContent = '⏳';
        refreshAttrsBtn.disabled = true;
        try {
            collectTiles();
            await new Promise(r => setTimeout(r, 80));
            currentTiles = [...seenTiles.values()];
            updatePricePlaceholders(currentTiles);
            applyFilters();
            showNotification('✅ Атрибуты карточек обновлены');
        } catch (e) {
            showNotification('⚠️ Не удалось обновить атрибуты', 'warning');
        } finally {
            refreshAttrsBtn.textContent = '🔄';
            refreshAttrsBtn.disabled = false;
        }
    });

    const badgeSettingsBtn = document.createElement('button');
    badgeSettingsBtn.type = 'button';
    badgeSettingsBtn.textContent = '🏷️';
    badgeSettingsBtn.title = 'Настройка бейджа цены за единицу';
    badgeSettingsBtn.style.cssText = `padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px;background:transparent;color:#999;`;
    badgeSettingsBtn.addEventListener('click', () => {
        const old = document.getElementById('ss-ppg-settings-menu');
        if (old) { old.remove(); return; }
        const menu = document.createElement('div');
        menu.id = 'ss-ppg-settings-menu';
        menu.style.cssText = `position:fixed;left:58px;top:50%;transform:translateY(-50%);z-index:2147483647;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:10px;width:210px;font:12px sans-serif;color:#333;`;
        const title=document.createElement('div'); title.textContent='🏷️ Бейдж цены/ед.'; title.style.cssText='font-weight:700;margin-bottom:8px;'; menu.appendChild(title);
        const visibleRow=document.createElement('label'); visibleRow.style.cssText='display:flex;align-items:center;gap:7px;margin-bottom:9px;cursor:pointer;';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=ppgBadgeVisible;
        cb.onchange=()=>{ppgBadgeVisible=cb.checked; chrome.storage.local.set({ppgBadgeVisible}); updateAllPpgBadges();};
        visibleRow.appendChild(cb); visibleRow.appendChild(document.createTextNode('Показывать бейдж')); menu.appendChild(visibleRow);
        const modeLabel=document.createElement('div'); modeLabel.textContent='Что показывать в бейдже:'; modeLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(modeLabel);
        const modeSelect=document.createElement('select'); modeSelect.style.cssText='width:100%;padding:5px 7px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;margin-bottom:9px;';
        [['all','Все уникальные величины'],['current','Только текущая величина']].forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;modeSelect.appendChild(o);});
        modeSelect.value=ppgBadgeMode; modeSelect.onchange=()=>{ppgBadgeMode=modeSelect.value==='current'?'current':'all';chrome.storage.local.set({ppgBadgeMode});try{applyFilters();}catch(_){} };
        menu.appendChild(modeSelect);
        const hint=document.createElement('div'); hint.style.cssText='font-size:9.5px;color:#999;line-height:1.3;margin:-3px 0 9px;'; hint.textContent='«Текущая» = выбранный приоритет (или Авто для каждой карточки).'; menu.appendChild(hint);

        // Единица отображения по категориям: кг↔г, л↔мл, мм↔см↔м и т.п.
        // Влияет на бейдж, фильтр «Цена/ед.» и сортировку одновременно (единый источник истины).
        const unitsLabel=document.createElement('div'); unitsLabel.textContent='Единица в цене/ед.:'; unitsLabel.title='Любое обозначение из настроек единиц для этой категории: кг/г, л/мл, шт/таблетка/капсула и т.п. Меняет только подпись — расчёт остаётся точным.'; unitsLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(unitsLabel);
        Object.keys(UNITS || {})
            .sort((a, b) => clampPriority(UNITS[a]?.priority, a) - clampPriority(UNITS[b]?.priority, b))
            .forEach(category => {
            const choices = getCategoryUnitChoices(category);
            if (choices.length < 2) return; // нечего переключать (например, «шт» — единственный вариант)
            const row=document.createElement('div'); row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;';
            const lab=document.createElement('span'); lab.textContent=getCategoryDisplayName(category); lab.style.cssText='font-size:11px;color:#555;';
            const sel=document.createElement('select'); sel.style.cssText='flex:0 0 auto;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;';
            choices.forEach(({unit})=>{const o=document.createElement('option');o.value=unit;o.textContent=`₽/${unit}`;sel.appendChild(o);});
            sel.value = badgeDisplayUnit[category] || FALLBACK_CANONICAL_UNIT[category] || choices[choices.length-1].unit;
            sel.onchange=()=>{
                badgeDisplayUnit={...badgeDisplayUnit,[category]:sel.value};
                chrome.storage.local.set({badgeDisplayUnit});
                try{updateAllPpgBadges();}catch(_){}
                try{updatePriceUnitUI();}catch(_){}
                try{applyFilters();}catch(_){}
            };
            row.appendChild(lab); row.appendChild(sel); menu.appendChild(row);
        });
        const unitsHint=document.createElement('div'); unitsHint.style.cssText='font-size:9.5px;color:#999;line-height:1.3;margin:-2px 0 9px;'; unitsHint.textContent='Меняет только подпись в бейдже/фильтре/сортировке — сравнение и фильтрация по-прежнему точные.'; menu.appendChild(unitsHint);

        const posLabel=document.createElement('div'); posLabel.textContent='Угол области картинки:'; posLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(posLabel);
        const posGrid=document.createElement('div'); posGrid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:5px;';
        [['top-left','↖'],['top-right','↗'],['bottom-left','↙'],['bottom-right','↘']].forEach(([pos,icon])=>{const b=document.createElement('button');b.type='button';b.textContent=icon;b.title=pos;b.dataset.ppgPos=pos;b.style.cssText=`padding:6px;border:1px solid ${ppgBadgePosition===pos?'#2196F3':'#ddd'};border-radius:6px;background:${ppgBadgePosition===pos?'#eef6ff':'#fff'};cursor:pointer;font-size:16px;`;b.onclick=()=>{ppgBadgePosition=pos;chrome.storage.local.set({ppgBadgePosition});updateAllPpgBadges();posGrid.querySelectorAll('[data-ppg-pos]').forEach(x=>{x.style.borderColor=x.dataset.ppgPos===pos?'#2196F3':'#ddd';x.style.background=x.dataset.ppgPos===pos?'#eef6ff':'#fff';});};posGrid.appendChild(b);});
        menu.appendChild(posGrid); document.body.appendChild(menu);
        const close=ev=>{if(!menu.contains(ev.target)&&ev.target!==badgeSettingsBtn){menu.remove();document.removeEventListener('mousedown',close);}};
        setTimeout(()=>document.addEventListener('mousedown',close),0);
    });

    // Группа служебных кнопок — всегда занимает одинаковое место, не двигает counter
    const toolBtnGroup = document.createElement('div');
    toolBtnGroup.style.cssText = 'display:flex; align-items:center; gap:2px; flex-shrink:0;';
    toolBtnGroup.appendChild(refreshSearchImgBtn);
    toolBtnGroup.appendChild(refreshSavedImgBtn);
    toolBtnGroup.appendChild(refreshAttrsBtn);
    toolBtnGroup.appendChild(badgeSettingsBtn);
    toolBtnGroup.appendChild(debugBtn);
    toolBtnGroup.appendChild(hoverBtn);

    topRow.appendChild(tabsRow);
    topRow.appendChild(cardStyleWrap);
    topRow.appendChild(counter);
    // topRow.appendChild(scaleWrap);
    topRow.appendChild(toolBtnGroup);
    topRow.appendChild(minimizeBtn);
    topRow.appendChild(closeBtn);

    // Строка сортировки
    let currentMode = mode;
    let priceFilterByUnit = false;

    // ─── Выделение карточек ────────────────────────────────────────────────────────
    const selectedKeys = new Set();
    let lastSelectedIndex = -1;
    let lastSelectedKey = null; // ключ последней выбранной карточки (для shift в режиме похожих)
    let lastSavedSelectedIndex = -1;
    let lastSavedSelectedKey = null; // для shift по DOM-порядку в режиме похожих
    let currentSavedTiles = [];

    // ─── Авто-применение фильтров ──────────────────────────────────────────────
    let autoFilterEnabled = true; // по умолчанию — авто
    let _filterDebounceTimer = null;
    function scheduleApplyFilters() {
        if (!autoFilterEnabled) return; // ручной режим — ждём кнопку
        clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = setTimeout(() => applyFilters(), 300);
    }

    const sortRow = document.createElement('div');
    sortRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const sortLabel = document.createElement('span');
    sortLabel.textContent = 'Сортировка:';
    sortLabel.style.cssText = 'font-size:13px; color:#666; white-space:nowrap;';

    function createSortBtn(m, label) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            padding: 5px 12px; border: 2px solid #2196F3; border-radius: 20px;
            cursor: pointer; font-size: 12px; font-weight: bold;
            background: ${currentMode === m ? '#2196F3' : 'transparent'};
            color: ${currentMode === m ? 'white' : '#2196F3'};
            transition: all 0.15s;
        `;
        btn.addEventListener('click', () => {
            currentMode = m;
            sortBtns.forEach(([bm, b]) => {
                b.style.background = currentMode === bm ? '#2196F3' : 'transparent';
                b.style.color = currentMode === bm ? 'white' : '#2196F3';
            });
            // сортировка меняет порядок внутри кластеров — сбрасываем кэш
            _searchGroupCache = null;
            _savedGroupCache = null;
            applyFilters();
        });
        return btn;
    }

    const sortBtnDefs = [
        ['asc', '💰 Цена ↑', 'Сортировать по цене от меньшей к большей'],
        ['desc', '💰 Цена ↓', 'Сортировать по цене от большей к меньшей'],
        ['per-gram-asc', '⚖️ Цена/ед. ↑', 'Сортировать по выбранному приоритету цены/ед. от меньшей к большей\nВеличина выбирается в поле «Цена/ед.»'],
        ['per-gram-desc', '⚖️ Цена/ед. ↓', 'Сортировать по выбранному приоритету цены/ед. от большей к меньшей\nВеличина выбирается в поле «Цена/ед.»'],
        ['reviews-desc', '💬 Отзывы ↓', 'Сортировать по количеству отзывов от большего к меньшему\nТовары без данных — в конце'],
        ['reviews-asc', '💬 Отзывы ↑', 'Сортировать по количеству отзывов от меньшего к большему\nТовары без данных — в конце'],
        ['rating-desc', '⭐ Рейтинг ↓', 'Сортировать по рейтингу от большего к меньшему\nТовары без данных — в конце'],
        ['rating-asc', '⭐ Рейтинг ↑', 'Сортировать по рейтингу от меньшего к большему\nТовары без данных — в конце'],
        ['delivery-asc', '🚚 Доставка ↑', 'Сортировать по дате доставки — сначала ближайшие\nТовары без данных — в конце'],
        ['delivery-desc', '🚚 Доставка ↓', 'Сортировать по дате доставки — сначала самые поздние\nТовары без данных — в конце'],
    ];
    const sortBtns = sortBtnDefs.map(([m, label, tip]) => {
        const btn = createSortBtn(m, label);
        btn.title = tip;
        return [m, btn];
    });

    sortBtns.forEach(([, btn]) => sortRow.appendChild(btn));
    sortRow.prepend(sortLabel);

    // Масштаб сетки хранится отдельно для режима «Сайт» и «Упрощённый».
    // Старый cardScale остаётся fallback для совместимости со старыми настройками.
    let siteCardScale = 180;
    let customCardScale = 180;
    let cardScale = 180;
    function getActiveCardScale() {
        return searchCardStyle === 'site' ? siteCardScale : customCardScale;
    }
    function applyActiveGridScale() {
        cardScale = getActiveCardScale();
        if (typeof scaleSlider !== 'undefined') scaleSlider.value = String(cardScale);
        productsContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardScale}px, 1fr))`;
        productsContainer.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
        productsContainer.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));
        productsContainer.querySelectorAll('.ss-tile--search-custom').forEach(el => {
            el.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
            el.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));
        });
        savedContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${customCardScale}px, 1fr))`;
        savedContainer.style.setProperty('--tile-img-height', Math.round(customCardScale * 0.9) + 'px');
        savedContainer.style.setProperty('--tile-font-scale', getSavedTileFontScale(customCardScale));
    }
    chrome.storage.local.get(['cardScale','siteCardScale','customCardScale'], d => {
        const legacy = Number.isFinite(Number(d.cardScale)) ? Number(d.cardScale) : 180;
        siteCardScale = Number.isFinite(Number(d.siteCardScale)) ? Number(d.siteCardScale) : legacy;
        customCardScale = Number.isFinite(Number(d.customCardScale)) ? Number(d.customCardScale) : legacy;
        applyActiveGridScale();
    });

    const scaleWrap = document.createElement('div');
    scaleWrap.style.cssText = 'display:flex; align-items:center; gap:6px; margin-left:auto;';
    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = '⊞';
    scaleLabel.style.cssText = 'font-size:14px; color:#999; cursor:default;';
    scaleLabel.title = 'Масштаб карточек';
    const scaleSlider = document.createElement('input');
    scaleSlider.type = 'range';
    scaleSlider.min = '120';
    scaleSlider.max = '320';
    scaleSlider.step = '10';
    scaleSlider.title = 'Масштаб карточек (120–320px)';
    scaleSlider.style.cssText = 'width:80px; cursor:pointer; accent-color:#2196F3;';
    scaleSlider.addEventListener('input', () => {
        cardScale = parseInt(scaleSlider.value);
        if (searchCardStyle === 'site') siteCardScale = cardScale;
        else customCardScale = cardScale;
        applyActiveGridScale();
        // высота строки грида зависит от масштаба (текстовый блок тоже растёт/уменьшается) —
        // пересчитываем, если сейчас открыта вкладка «Сохранённые», иначе карточки наедут друг на друга
        if (activeTab === 'saved' && !groupingActive) {
            savedContainer.style.gridAutoRows = `${Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale)}px`;
        }
        chrome.storage.local.set({ cardScale, siteCardScale, customCardScale });
    });
    scaleWrap.appendChild(scaleLabel);
    scaleWrap.appendChild(scaleSlider);


    // ── кнопки группировки похожих ─────────────────────────────────────────────
    const btnCSS = `padding:4px 10px; font-size:12px; border-radius:6px; cursor:pointer;
        border:1px solid #ccc; background:#fff; color:#555;
        transition:all 0.15s; white-space:nowrap;`;

    const groupBtn = document.createElement('button');
    groupBtn.textContent = '👁 Похожие';
    groupBtn.title = 'Группировать карточки по визуальному сходству';
    groupBtn.style.cssText = btnCSS;

    const imgSearchBtn = document.createElement('button');
    imgSearchBtn.textContent = '🖼 По картинке';
    imgSearchBtn.title = 'Найти похожие на указанное изображение';
    imgSearchBtn.style.cssText = btnCSS + 'display:none;';

    // переключатель вида: «строки» vs «сетка»
    const layoutBtn = document.createElement('button');
    layoutBtn.title = 'Переключить вид групп';
    layoutBtn.style.cssText = btnCSS + 'display:none; padding:4px 8px;';
    layoutBtn.textContent = '☰';  // строки

    function invalidateGroupCache() {
        _searchGroupCache = null;
        _savedGroupCache = null;
    }
    window._invalidateGroupCache = invalidateGroupCache;

    function updateGroupBtnStyle() {
        groupBtn.style.background = groupingActive ? '#2196F3' : '#fff';
        groupBtn.style.color = groupingActive ? '#fff' : '#555';
        groupBtn.style.borderColor = groupingActive ? '#2196F3' : '#ccc';
        imgSearchBtn.style.display = groupingActive ? '' : 'none';
        layoutBtn.style.display = groupingActive ? '' : 'none';
        if (!groupingActive) {
            imgSearchBtn.textContent = '🖼 По картинке';
            imgSearchBtn.style.background = '#fff';
            imgSearchBtn.style.borderColor = '#ccc';
            imgSearchBtn.style.color = '#555';
        }
    }

    function updateLayoutBtnStyle() {
        layoutBtn.textContent = groupLayout === 'rows' ? '⠿' : '☰';
        layoutBtn.title = groupLayout === 'rows' ? 'Вид: плитка (группы идут подряд с разделителями)' : 'Вид: строки (каждая группа с новой строки)';
    }
    updateLayoutBtnStyle();

    groupBtn.addEventListener('click', () => {
        groupingActive = !groupingActive;
        if (!groupingActive) { referenceFeatures = null; referenceImgSrc = null; }
        updateGroupBtnStyle();
        invalidateGroupCache();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    });

    layoutBtn.addEventListener('click', () => {
        groupLayout = groupLayout === 'rows' ? 'flow' : 'rows';
        updateLayoutBtnStyle();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    });

    // ── поиск по картинке ──────────────────────────────────────────────────────
    const imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/*';
    imgInput.style.display = 'none';

    // Общая функция обработки изображения из любого источника
    async function processReferenceImage(blob) {
        closeImgPickerPopup();
        const url = URL.createObjectURL(blob);
        referenceImgSrc = url;
        imgSearchBtn.textContent = '⏳ Анализ...';
        imgSearchBtn.disabled = true;
        try {
            const imgData = await getImageDataFromSrc(url);
            referenceFeatures = { phash: computePHash(imgData), hist: computeColorHistogram(imgData) };
        } finally {
            URL.revokeObjectURL(url);
        }
        imgSearchBtn.textContent = '🖼 По картинке ✓';
        imgSearchBtn.style.background = '#e8f5e9';
        imgSearchBtn.style.borderColor = '#81c784';
        imgSearchBtn.style.color = '#2e7d32';
        imgSearchBtn.disabled = false;
        invalidateGroupCache();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    }

    imgInput.addEventListener('change', async () => {
        const file = imgInput.files[0];
        if (!file) return;
        imgInput.value = '';
        await processReferenceImage(file);
    });

    // ── Попап выбора изображения ──────────────────────────────────────────────
    let imgPickerPopup = null;

    function closeImgPickerPopup() {
        if (imgPickerPopup) { imgPickerPopup.remove(); imgPickerPopup = null; }
    }

    function openImgPickerPopup() {
        if (imgPickerPopup) { closeImgPickerPopup(); return; }

        imgPickerPopup = document.createElement('div');
        imgPickerPopup.style.cssText = `
            position:absolute; z-index:10000;
            background:#fff; border:1px solid #ddd; border-radius:12px;
            box-shadow:0 4px 20px rgba(0,0,0,.18);
            padding:14px 16px; width:260px;
            display:flex; flex-direction:column; gap:10px;
        `;

        // Позиционируем под кнопкой
        const btnRect = imgSearchBtn.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        imgPickerPopup.style.top = (btnRect.bottom - popupRect.top + 6) + 'px';
        imgPickerPopup.style.left = (btnRect.left - popupRect.left) + 'px';

        // Заголовок
        const title = document.createElement('div');
        title.textContent = 'Выбрать изображение';
        title.style.cssText = 'font-size:13px; font-weight:bold; color:#333;';

        // Зона drag-and-drop / вставки
        const dropZone = document.createElement('div');
        dropZone.style.cssText = `
            border:2px dashed #bbb; border-radius:8px;
            padding:18px 10px; text-align:center;
            font-size:12px; color:#888; cursor:pointer;
            transition: border-color .15s, background .15s;
            user-select:none;
        `;
        dropZone.innerHTML = '📋 Вставьте (Ctrl+V)<br>или перетащите картинку сюда';

        // При фокусе зоны — принимаем Ctrl+V
        dropZone.tabIndex = 0;
        dropZone.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                e.stopPropagation();
                // paste-событие не приходит на div — читаем через clipboardData вручную
                // нужно сфокусировать hidden input и симулировать paste
                pasteInput.focus();
            }
        });

        // Highlight on drag
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#2196F3';
            dropZone.style.background = '#e3f2fd';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#bbb';
            dropZone.style.background = '';
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#bbb';
            dropZone.style.background = '';
            const file = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
            if (file) { await processReferenceImage(file); return; }
            // Может быть img-элемент перетащен из страницы
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && /^https?:\/\//.test(url)) {
                try {
                    const resp = await fetch(url);
                    const blob = await resp.blob();
                    if (blob.type.startsWith('image/')) { await processReferenceImage(blob); return; }
                } catch (_) { }
            }
            showNotification('⚠️ Не удалось получить изображение из перетащенного объекта.');
        });
        dropZone.addEventListener('click', () => pasteInput.focus());

        // Скрытый contenteditable — ловит системный paste (Ctrl+V) без запроса разрешений
        const pasteInput = document.createElement('div');
        pasteInput.contentEditable = 'true';
        pasteInput.style.cssText = 'position:absolute; opacity:0; width:1px; height:1px; overflow:hidden; pointer-events:none;';
        pasteInput.addEventListener('paste', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    if (blob) { await processReferenceImage(blob); return; }
                }
            }
            showNotification('⚠️ В буфере нет изображения.');
        });

        // Кнопка «Выбрать файл»
        const fileBtn = document.createElement('button');
        fileBtn.textContent = '📁 Выбрать файл с компьютера';
        fileBtn.style.cssText = `
            padding:8px 12px; border:1px solid #ddd; border-radius:8px;
            cursor:pointer; font-size:12px; background:#f5f5f5; color:#333;
            text-align:left; transition: background .15s;
        `;
        fileBtn.addEventListener('mouseenter', () => fileBtn.style.background = '#ececec');
        fileBtn.addEventListener('mouseleave', () => fileBtn.style.background = '#f5f5f5');
        fileBtn.addEventListener('click', () => { imgInput.click(); });

        imgPickerPopup.appendChild(title);
        imgPickerPopup.appendChild(dropZone);
        imgPickerPopup.appendChild(pasteInput);
        imgPickerPopup.appendChild(fileBtn);
        uiRoot.appendChild(imgPickerPopup);

        // Автофокус на pasteInput чтобы сразу принимать Ctrl+V
        setTimeout(() => pasteInput.focus(), 50);

        // Закрываем по клику снаружи
        const outsideClick = (e) => {
            if (!imgPickerPopup) return;
            if (!imgPickerPopup.contains(e.target) && e.target !== imgSearchBtn) {
                closeImgPickerPopup();
                document.removeEventListener('mousedown', outsideClick, true);
            }
        };
        document.addEventListener('mousedown', outsideClick, true);
    }

    imgSearchBtn.addEventListener('click', openImgPickerPopup);

    // ── Разделитель ──
    const Divider1 = document.createElement('span');
    Divider1.textContent = '│';
    Divider1.style.cssText = 'color:#ddd; font-size:16px;';

    scaleWrap.appendChild(groupBtn);
    scaleWrap.appendChild(imgSearchBtn);
    scaleWrap.appendChild(layoutBtn);
    scaleWrap.appendChild(imgInput);

    // sortRow.appendChild(scaleWrap);
    topRow.insertBefore(scaleWrap, toolBtnGroup);
    topRow.insertBefore(Divider1, toolBtnGroup);

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

    // Обёртка нужна только для позиционирования подсказки-автокомплита
    // ровно под полем поиска (position:relative + absolute внутри).
    const searchInputWrap = document.createElement('div');
    searchInputWrap.style.cssText = 'position:relative; flex:1; display:flex;';

    const searchInput = document.createElement('textarea');
    searchInput.rows = 1;
    searchInput.placeholder = '🔍 Например: корм @цена({500-1000}) @рейтинг({4.5-5}) @сортировка(цена, возр)';
    searchInput.style.cssText = `
        flex:1; min-width:0; min-height:38px; max-height:120px;
        padding:8px 12px; border:1px solid #ddd; border-radius:6px;
        font:14px sans-serif; line-height:20px; outline:none; resize:none;
        overflow-x:hidden; overflow-y:hidden; box-sizing:border-box;
    `;
    function autoResizeSearchInput() {
        const maxHeight = 120;
        searchInput.style.height = 'auto';
        const h = Math.min(Math.max(searchInput.scrollHeight, 38), maxHeight);
        searchInput.style.height = h + 'px';
        searchInput.style.overflowY = searchInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
    let _searchResizeRaf = null;
    function scheduleAutoResizeSearchInput() {
        // rAF вместо прямого вызова на каждый input — сам по себе ресайз
        // читает scrollHeight (форсирует layout), это дешевле делать один раз
        // за кадр, чем на каждое нажатие клавиши подряд при быстром наборе.
        if (_searchResizeRaf != null) return;
        _searchResizeRaf = requestAnimationFrame(() => {
            _searchResizeRaf = null;
            autoResizeSearchInput();
        });
    }
    searchInput.addEventListener('input', scheduleAutoResizeSearchInput);
    searchInputWrap.appendChild(searchInput);

    // ── Автодополнение @атрибутов и подсказки диапазонов ──
    // Данные берутся ИСКЛЮЧИТЕЛЬНО из attributeSuggestCache (см.
    // rebuildAttributeSuggestCache), который пересчитывается только при
    // обновлении набора карточек (там же, где остальные плейсхолдеры), а
    // не при каждом нажатии клавиши. Здесь — только чтение кэша и
    // лёгкий разбор текста самого поля ввода, поэтому рекурсий и
    // повторных проходов по карточкам тут нет.
    const attrAutocomplete = document.createElement('div');
    attrAutocomplete.style.cssText = `
        display:none; position:absolute; top:calc(100% + 4px); left:0; right:0;
        background:#fff; border:1px solid #ddd; border-radius:8px;
        box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:100000;
        max-height:260px; overflow:auto; font-size:12px;
    `;
    searchInputWrap.appendChild(attrAutocomplete);

    let attrAcItems = [];      // текущие варианты для режима 'name'
    let attrAcHighlight = -1;  // индекс подсвеченного варианта
    let attrAcMode = 'none';   // 'none' | 'name' | 'value'
    let attrAcNameStart = -1;  // индекс начала «@имя» для замены при выборе

    function hideAttrAutocomplete() {
        attrAutocomplete.style.display = 'none';
        attrAcMode = 'none';
        attrAcItems = [];
        attrAcHighlight = -1;
    }

    // Определяет, что сейчас происходит в позиции курсора:
    // — печатается имя атрибута после '@' (mode:'name'),
    // — курсор внутри уже открытых скобок '@имя(...)' (mode:'value'),
    // — ни то, ни другое (mode:'none').
    // Однопроходный разбор без рекурсии, стоимость — O(длины строки поиска).
    function getAttrCursorContext(text, pos) {
        const s = text.slice(0, pos);
        const stack = [];
        let i = 0;
        while (i < s.length) {
            const ch = s[i];
            if (ch === '@') {
                let j = i + 1;
                while (j < s.length && /[\p{L}\p{N}_\/.-]/u.test(s[j])) j++;
                const name = s.slice(i + 1, j);
                if (s[j] === '(') {
                    stack.push(name);
                    i = j + 1;
                    continue;
                }
                if (j === s.length && name.length >= 0) {
                    return { mode: 'name', prefix: name, start: i };
                }
                i = j;
                continue;
            }
            if (ch === '(') { stack.push(null); i++; continue; }
            if (ch === ')') { if (stack.length) stack.pop(); i++; continue; }
            i++;
        }
        for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k] != null) return { mode: 'value', name: stack[k] };
        }
        return { mode: 'none' };
    }

    function renderAttrAcNameList(items) {
        attrAutocomplete.innerHTML = '';
        if (!items.length) { hideAttrAutocomplete(); return; }
        items.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.style.cssText = `
                padding:6px 10px; cursor:pointer; display:flex; gap:8px;
                align-items:baseline; justify-content:space-between;
                background:${idx === attrAcHighlight ? '#e3f2fd' : '#fff'};
            `;
            const nameEl = document.createElement('span');
            nameEl.textContent = '@' + entry.name;
            nameEl.style.cssText = 'font-weight:600; color:#1565C0; white-space:nowrap;';
            const hintEl = document.createElement('span');
            hintEl.textContent = entry.hint || '';
            hintEl.style.cssText = 'color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:ltr; text-align:left;';
            row.appendChild(nameEl);
            row.appendChild(hintEl);
            // mousedown, а не click — чтобы выбор срабатывал раньше blur'а поля.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectAttrAcItem(entry);
            });
            row.addEventListener('mouseenter', () => {
                attrAcHighlight = idx;
                [...attrAutocomplete.children].forEach((c, i2) => {
                    c.style.background = i2 === attrAcHighlight ? '#e3f2fd' : '#fff';
                });
            });
            attrAutocomplete.appendChild(row);
        });
        attrAutocomplete.style.display = 'block';
    }

    function renderAttrAcHint(name) {
        // @сортировка — специальная DSL-команда, а не атрибут карточки.
        if (name.trim().toLowerCase() === 'сортировка') {
            attrAutocomplete.innerHTML = '';
            const row = document.createElement('div');
            row.style.cssText = 'padding:6px 10px; color:#666;';
            row.textContent = 'Сортировка: @сортировка(поле, возр/убыв) · для текста также а-я / я-а';
            attrAutocomplete.appendChild(row);
            attrAutocomplete.style.display = 'block';
            return;
        }
        const entry = attributeSuggestCache.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
        attrAutocomplete.innerHTML = '';
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 10px; color:#666;';
        if (!entry) {
            row.textContent = `Атрибут «${name}» не встречается среди текущих карточек`;
            row.style.color = '#b26a00';
        } else if (entry.static) {
            row.textContent = entry.hint || `@${entry.name}`;
        } else if (entry.hint) {
            row.textContent = (entry.kind.endsWith('text') ? 'Например: ' : 'Диапазон: ') + entry.hint;
        } else {
            row.textContent = `@${entry.name} — значения не найдены среди текущих карточек`;
        }
        attrAutocomplete.appendChild(row);
        attrAutocomplete.style.display = 'block';
    }

    function selectAttrAcItem(entry) {
        const value = searchInput.value;
        const before = value.slice(0, attrAcNameStart);
        const afterCursorIdx = searchInput.selectionStart ?? value.length;
        const after = value.slice(afterCursorIdx);
        let insertion;
        if (entry.sortStage === 'field') insertion = entry.name + ', ';
        else if (entry.sortStage === 'direction') insertion = entry.name + ')';
        else insertion = '@' + entry.name + '(';
        // Для выбора поля сортировки заменяем только текущую часть после '('.
        if (entry.sortStage) {
            const cursor = afterCursorIdx;
            const query = value.slice(0, cursor);
            const open = query.lastIndexOf('(');
            const comma = query.lastIndexOf(',');
            const start = entry.sortStage === 'field' ? open + 1 : comma + 1;
            const prefixBefore = value.slice(0, start);
            searchInput.value = prefixBefore + insertion + after;
            const newPos = (prefixBefore + insertion).length;
            searchInput.focus();
            searchInput.setSelectionRange(newPos, newPos);
            hideAttrAutocomplete();
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        searchInput.value = before + insertion + after;
        const newPos = (before + insertion).length;
        searchInput.focus();
        searchInput.setSelectionRange(newPos, newPos);
        hideAttrAutocomplete();
        // Единое событие 'input' обновит и обычную фильтрацию, и подсказку
        // под новым контекстом (мы теперь внутри скобок) — оба обработчика
        // уже подписаны на этот же событие, повторный вызов не нужен.
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function getDslSortFieldTypeForAutocomplete(fieldName) {
        const n = normalizeSortFieldName(fieldName);
        if (['цена','price','цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit',
             'рейтинг','rating','отзывы','отзыв','reviews','доставка','дата','delivery'].includes(n)) return 'number';
        if (['название','товар','name','title'].includes(n)) return 'text';
        const entry = attributeSuggestCache.find(e => normalizeSortFieldName(e.name) === n);
        if (!entry) return 'text';
        return String(entry.kind || '').includes('quantity') || String(entry.kind || '').includes('number') || String(entry.kind || '').includes('date')
            ? 'number'
            : 'text';
    }

    // Пересчитывает ТОЛЬКО отображение подсказки под текущим положением
    // курсора — без обращения к карточкам страницы (все данные уже в
    // attributeSuggestCache). Вызывается на каждый ввод символа — это
    // дёшево (перебор кэша из нескольких десятков атрибутов максимум).
    function refreshAttributeAutocompleteUi() {
        if (document.activeElement !== searchInput) { hideAttrAutocomplete(); return; }
        const pos = searchInput.selectionStart ?? searchInput.value.length;
        const ctx = getAttrCursorContext(searchInput.value, pos);
        if (ctx.mode === 'name') {
            const prefix = ctx.prefix.toLowerCase();
            attrAcNameStart = ctx.start;
            attrAcMode = 'name';
            // Специальные DSL-команды участвуют в том же автодополнении,
            // но не зависят от наличия одноимённого атрибута в карточках.
            const specialEntries = [{
                name: 'сортировка',
                kind: 'special-sort',
                hint: 'поле, возр/убыв · текст: а-я/я-а'
            }];
            const allEntries = [...specialEntries, ...attributeSuggestCache];
            const starts = allEntries.filter(e => e.name.toLowerCase().startsWith(prefix));
            const includes = allEntries.filter(e => !e.name.toLowerCase().startsWith(prefix) && e.name.toLowerCase().includes(prefix));
            attrAcItems = prefix ? [...starts, ...includes].slice(0, 10) : allEntries.slice(0, 10);
            attrAcHighlight = -1;
            renderAttrAcNameList(attrAcItems);
        } else if (ctx.mode === 'value') {
            // Контекстное автодополнение внутри @сортировка(...).
            // Сначала предлагаем поля, после запятой — допустимые направления.
            if (String(ctx.name || '').trim().toLowerCase() === 'сортировка') {
                const beforeCursor = searchInput.value.slice(0, pos);
                const open = beforeCursor.lastIndexOf('@сортировка');
                const inside = open >= 0 ? beforeCursor.slice(beforeCursor.indexOf('(', open) + 1) : '';
                const parts = inside.split(',');
                const builtins = [
                    {name:'цена', hint:'число'}, {name:'цена/ед.', hint:'число'},
                    {name:'рейтинг', hint:'число'}, {name:'отзывы', hint:'число'},
                    {name:'доставка', hint:'дата'}, {name:'название', hint:'текст'}
                ];
                if (parts.length <= 1) {
                    const prefix = (parts[0] || '').trim().toLowerCase();
                    const seen = new Set();
                    const fields = [...builtins, ...attributeSuggestCache].filter(e => {
                        const key = String(e.name).toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return !prefix || key.includes(prefix);
                    }).slice(0, 12).map(e => ({...e, sortStage:'field'}));
                    attrAcMode = 'sort'; attrAcItems = fields; attrAcHighlight = -1;
                    renderAttrAcNameList(fields);
                } else {
                    const prefix = (parts[parts.length - 1] || '').trim().toLowerCase();
                    const fieldName = (parts[0] || '').trim();
                    const fieldType = getDslSortFieldTypeForAutocomplete(fieldName);
                    const dirs = fieldType === 'text'
                        ? [
                            {name:'а-я', hint:'по алфавиту', sortStage:'direction'},
                            {name:'я-а', hint:'обратный алфавит', sortStage:'direction'}
                        ]
                        : [
                            {name:'возр', hint:'по возрастанию', sortStage:'direction'},
                            {name:'убыв', hint:'по убыванию', sortStage:'direction'}
                        ];
                    const filteredDirs = dirs.filter(e => !prefix || e.name.startsWith(prefix));
                    attrAcMode = 'sort'; attrAcItems = filteredDirs; attrAcHighlight = -1;
                    renderAttrAcNameList(filteredDirs);
                }
            } else {
                attrAcMode = 'value';
                attrAcItems = [];
                renderAttrAcHint(ctx.name);
            }
        } else {
            hideAttrAutocomplete();
        }
    }

    searchInput.addEventListener('input', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('click', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('focus', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('blur', () => {
        // Небольшая задержка, чтобы mousedown по варианту в списке успел
        // сработать раньше, чем скроется сам список.
        setTimeout(() => { if (document.activeElement !== searchInput) hideAttrAutocomplete(); }, 120);
    });
    searchInput.addEventListener('keydown', (e) => {
        if ((attrAcMode !== 'name' && attrAcMode !== 'sort') || !attrAcItems.length) {
            if (e.key === 'Escape') hideAttrAutocomplete();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            attrAcHighlight = (attrAcHighlight + 1) % attrAcItems.length;
            renderAttrAcNameList(attrAcItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            attrAcHighlight = (attrAcHighlight - 1 + attrAcItems.length) % attrAcItems.length;
            renderAttrAcNameList(attrAcItems);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const pick = attrAcItems[attrAcHighlight >= 0 ? attrAcHighlight : 0];
            if (pick) { e.preventDefault(); selectAttrAcItem(pick); }
        } else if (e.key === 'Escape') {
            hideAttrAutocomplete();
        }
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.title = 'Очистить фильтр';
    clearBtn.style.cssText = `
        padding: 8px 12px; background: #6c757d; color: white;
        border: none; border-radius: 6px; cursor: pointer;
    `;

    const hint = document.createElement('span');
    hint.textContent = '?';
    hint.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%;
        background: #6c757d; color: white;
        font-size: 12px; font-weight: bold;
        cursor: help; flex-shrink: 0; user-select: none;
        position: relative;
    `;

    const searchTooltip = document.createElement('div');
    searchTooltip.style.cssText = `
        display: none; position: absolute; top: calc(100% + 8px); right: 0;
        background: #333; color: white; padding: 10px 14px;
        border-radius: 8px; font-size: 12px; line-height: 1.6;
        white-space: pre; z-index: 100000;
        max-width: min(620px, calc(100vw - 32px));
        max-height: min(70vh, 620px);
        overflow: auto;
        box-sizing: border-box;
        scrollbar-width: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    `;
    searchTooltip.textContent = `Спецсимволы:
  *  — любое кол-во символов     farm* → farmina, farmland
  ?  — ровно один символ         кошк? → кошка, кошки
  [аб] — один из символов         к[ио]т → кот, кит
  {N...M} — число в диапазоне     {0.5...2} → «корм 1 кг», «500г»
       Также: {1-2}, {1..2}, {1 до 2}
  !слово — исключить слово         !собак*
  "фраза" — точное словосочетание
  !"фраза" — исключить фразу
  (a|b|c) — OR: одно из нескольких
  !(a|b|c) — исключить группу

Дополнительные атрибуты:
  @имя(запрос) — фильтр только по указанному атрибуту
  @бренд(apple)
  @цвет("тёмно синий")
  @вес({1-2})
  @бренд(!apple !samsung (xiaomi|honor) обязательно)
  @атрибут() — атрибут присутствует
  @атрибут(!) — атрибут отсутствует
  @атрибут(!запрос) — атрибут не содержит запрос

Основные атрибуты (альтернатива отдельным полям):
  @название(корм*)
  @цена({500-1000})
  @цена/ед.({100-300})
  @рейтинг({4-5})
  @отзывы({1000-100000})
  @доставка(30.08) — доставка в эту дату
  @доставка(30.08.2026) — дата с годом
  @доставка({28.08-05.09}) — диапазон дат (текущий год)
  @доставка({28.08-05.09.2026}) — диапазон с годом (год без {} — тоже работает)
  @доставка({28.08-*}) / @доставка({*-05.09}) — открытая граница диапазона
  @доставка({28.08-01.09}|{10.09-15.09}) — несколько диапазонов сразу (ИЛИ)
  @доставка(!28.08-05.09.2026) — доставка НЕ в этом диапазоне
  Для них работают () и (!): @цена() / @цена(!)
  И отрицание значения: @цена(!1000)
  • область атрибута всегда ограничена скобками: @имя(...)
  • ! внутри скобок исключает значение только для этого атрибута
  • @атрибут(...) можно сочетать с названием и другими атрибутами

Гибкие фразы:
  "({1-2} кг|{1000-2000} (гр|грамм|г))"
  • внутри кавычек можно использовать (), | и диапазоны
  • пробелы внутри гибкой фразы необязательны: «1 кг» и «1кг»
  • ~ — явное обозначение необязательного пробела: «1~кг»
  • диапазон проверяется по найденному числу, а не только по тексту

Как работает поиск:
  • отдельные условия разделяются пробелами
  • все условия должны выполняться (AND)
  • порядок слов не важен (кроме фраз)
  • регистр не важен
  • ! перед условием исключает совпадения

Примеры:
  farm* !собак*
  к[ио]т {0.4...1.5}кг
  "корм для кошек" !("сухой"|"гранулы")
  iphone @бренд(hill*|royal*) @вес({0.4-1.5})
  !"({1-2} кг|{1000-2000} (гр|грамм|г))"`;

    hint.appendChild(searchTooltip);
    let searchTooltipHideTimer = null;
    const showSearchTooltip = () => {
        if (searchTooltipHideTimer) { clearTimeout(searchTooltipHideTimer); searchTooltipHideTimer = null; }
        searchTooltip.style.display = 'block';
    };
    const scheduleHideSearchTooltip = () => {
        if (searchTooltipHideTimer) clearTimeout(searchTooltipHideTimer);
        searchTooltipHideTimer = setTimeout(() => {
            searchTooltip.style.display = 'none';
            searchTooltipHideTimer = null;
        }, 300);
    };
    hint.addEventListener('mouseenter', showSearchTooltip);
    hint.addEventListener('mouseleave', scheduleHideSearchTooltip);
    searchTooltip.addEventListener('mouseenter', showSearchTooltip);
    searchTooltip.addEventListener('mouseleave', scheduleHideSearchTooltip);

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        if (activeTab === 'saved') {
            renderSavedTiles();
        } else {
        
    // Делегирование hover/click для карточек. Не создаём по 3 listener'а на каждую карточку.
    function updateVisibleSelectionState() {
        productsContainer.querySelectorAll('[data-tile-key]').forEach(wrap => {
            const key = wrap.dataset.tileKey || '';
            const selected = selectedKeys.has(key);
            wrap.style.outline = selected ? '2px solid #2196F3' : '';
            wrap.style.borderRadius = selected ? '8px' : '';
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) {
                checkbox.style.background = selected ? '#2196F3' : 'rgba(255,255,255,0.9)';
                checkbox.style.borderColor = selected ? '#2196F3' : '#ccc';
                checkbox.style.display = selected ? 'flex' : 'none';
                checkbox.textContent = selected ? '✓' : '';
            }
        });
    }

    productsContainer.addEventListener('mouseover', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const from = e.relatedTarget;
        if (from && wrap.contains(from)) return;
        const checkbox = wrap.querySelector('[data-selection-checkbox]');
        if (checkbox) checkbox.style.display = 'flex';
    });
    productsContainer.addEventListener('mouseout', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const to = e.relatedTarget;
        if (to && wrap.contains(to)) return;
        if (!selectedKeys.has(wrap.dataset.tileKey || '')) {
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) checkbox.style.display = 'none';
        }
    });
    productsContainer.addEventListener('click', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const checkbox = e.target.closest('[data-selection-checkbox]');
        if (!e.ctrlKey && !e.shiftKey && !checkbox) return;

        e.preventDefault();
        e.stopPropagation();
        const tileKey = wrap.dataset.tileKey || '';
        if (!tileKey) return;

        if (e.shiftKey && lastSelectedKey) {
            const allKeys = currentTiles.map(tile => getTileKey(tile)).filter(Boolean);
            const fromIdx = allKeys.indexOf(lastSelectedKey);
            const toIdx = allKeys.indexOf(tileKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                const lo = Math.min(fromIdx, toIdx);
                const hi = Math.max(fromIdx, toIdx);
                for (let i = lo; i <= hi; i++) selectedKeys.add(allKeys[i]);
            }
        } else {
            if (selectedKeys.has(tileKey)) selectedKeys.delete(tileKey);
            else selectedKeys.add(tileKey);
            lastSelectedKey = tileKey;
            lastSelectedIndex = currentTiles.findIndex(tile => getTileKey(tile) === tileKey);
        }
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    renderTiles(getFilteredAndSorted(''));
        }
    });

    searchRow.appendChild(searchInputWrap);

    // ── Сохранённые поисковые запросы ─────────────────────────────────────────
    // Запросы хранятся локально в браузере и доступны при следующих открытиях
    // Shopping Sorter на любых страницах. Сохраняем только текст запроса и имя.
    let savedSearchQueries = [];
    const savedQueriesBtn = document.createElement('button');
    savedQueriesBtn.type = 'button';
    savedQueriesBtn.textContent = '🔖';
    savedQueriesBtn.title = 'Сохранённые поисковые запросы';
    savedQueriesBtn.style.cssText = 'padding:7px 9px; border:1px solid #ddd; border-radius:6px; cursor:pointer; background:#fff; color:#555; font-size:14px; white-space:nowrap; flex:0 0 auto;';

    const savedQueriesMenu = document.createElement('div');
    savedQueriesMenu.style.cssText = 'display:none; position:fixed; z-index:2147483647; width:410px; max-width:calc(100vw - 24px); max-height:420px; overflow:auto; background:#fff; border:1px solid #ddd; border-radius:9px; box-shadow:0 8px 28px rgba(0,0,0,.22); padding:8px; font:12px sans-serif; box-sizing:border-box;';
    document.body.appendChild(savedQueriesMenu);

    function positionSavedQueriesMenu() {
        const r = savedQueriesBtn.getBoundingClientRect();
        const w = Math.min(410, Math.max(220, window.innerWidth - 24));
        savedQueriesMenu.style.width = w + 'px';
        let left = Math.min(r.left, window.innerWidth - w - 12);
        left = Math.max(12, left);
        const h = Math.min(420, window.innerHeight - 24);
        savedQueriesMenu.style.maxHeight = h + 'px';
        let top = r.bottom + 5;
        if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 5);
        savedQueriesMenu.style.left = left + 'px';
        savedQueriesMenu.style.top = top + 'px';
    }

    function showSavedQueryDialog({item=null, onSave=null}={}) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font:13px sans-serif;';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'width:min(760px, calc(100vw - 32px));max-height:min(90vh,720px);display:flex;flex-direction:column;background:#fff;border:1px solid #d8d8d8;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;box-sizing:border-box;';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid #eee;';
        const h = document.createElement('strong');
        h.textContent = item ? '✎ Редактирование сохранённого запроса' : '＋ Сохранить поисковый запрос';
        h.style.cssText = 'font-size:13px;color:#333;';
        const close = document.createElement('button');
        close.type='button'; close.textContent='×'; close.title='Закрыть';
        close.style.cssText='border:0;background:none;color:#777;cursor:pointer;font-size:22px;line-height:1;padding:0 2px;';
        close.onclick=()=>overlay.remove();
        header.append(h,close);

        const body = document.createElement('div');
        body.style.cssText='padding:13px 14px;display:flex;flex-direction:column;gap:9px;overflow:auto;';
        const nameLabel=document.createElement('label');
        nameLabel.textContent='Название'; nameLabel.style.cssText='font-size:11px;font-weight:600;color:#555;';
        const nameInput=document.createElement('input');
        nameInput.type='text'; nameInput.value=item?.name || '';
        nameInput.placeholder='Например: Доставка до 3 дней';
        nameInput.style.cssText='width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #ccc;border-radius:6px;font-size:13px;';
        const queryLabel=document.createElement('label');
        queryLabel.textContent='Поисковый запрос'; queryLabel.style.cssText='font-size:11px;font-weight:600;color:#555;margin-top:2px;';
        const queryInput=document.createElement('textarea');
        queryInput.value=item?.query || searchInput.value.trim();
        queryInput.placeholder='Введите полный поисковый запрос…';
        queryInput.rows=9;
        queryInput.style.cssText='width:100%;min-height:190px;max-height:45vh;box-sizing:border-box;resize:vertical;padding:9px 10px;border:1px solid #ccc;border-radius:6px;font:12px/1.45 monospace;color:#222;white-space:pre-wrap;overflow:auto;';
        const hint=document.createElement('div');
        hint.textContent='Здесь отображается весь запрос — длинные конструкции и @доставка() не обрезаются.';
        hint.style.cssText='font-size:10px;color:#888;line-height:1.35;';
        body.append(nameLabel,nameInput,queryLabel,queryInput,hint);

        const footer=document.createElement('div');
        footer.style.cssText='display:flex;justify-content:flex-end;gap:7px;padding:10px 14px;border-top:1px solid #eee;background:#fafafa;';
        const cancel=document.createElement('button');
        cancel.type='button'; cancel.textContent='Отмена';
        cancel.style.cssText='padding:7px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#555;cursor:pointer;font-size:11px;';
        cancel.onclick=()=>overlay.remove();
        const save=document.createElement('button');
        save.type='button'; save.textContent=item?'Сохранить изменения':'Сохранить';
        save.style.cssText='padding:7px 13px;border:1px solid #4CAF50;border-radius:6px;background:#f1fff3;color:#2e7d32;cursor:pointer;font-size:11px;font-weight:600;';
        save.onclick=()=>{
            const cleanName=String(nameInput.value||'').trim();
            const query=String(queryInput.value||'').trim();
            if(!cleanName){nameInput.focus();showNotification('Укажите название запроса','warning');return;}
            if(!query){queryInput.focus();showNotification('Поисковый запрос пуст','warning');return;}
            onSave?.({name:cleanName,query});
            overlay.remove();
        };
        footer.append(cancel,save);
        dialog.append(header,body,footer); overlay.appendChild(dialog); document.body.appendChild(overlay);
        nameInput.focus();
        overlay.addEventListener('mousedown',e=>{if(e.target===overlay) overlay.remove();});
        dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();overlay.remove();} if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){e.preventDefault();save.click();}});
    }

    let savedQueriesSearchText = '';
    const savedQuerySelectedIds = new Set();

    function renderSavedQueriesMenu() {
        savedQueriesMenu.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 8px;border-bottom:1px solid #eee;margin-bottom:6px;min-width:0;box-sizing:border-box;';
        const title = document.createElement('strong');
        title.textContent = '🔖 Сохранённые запросы';
        title.style.cssText = 'font-size:12px;color:#444;min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const headActions = document.createElement('div');
        headActions.style.cssText = 'display:flex;align-items:center;gap:5px;flex:0 0 auto;min-width:0;';
        const bulkDeleteBtn = document.createElement('button');
        bulkDeleteBtn.type = 'button'; bulkDeleteBtn.textContent = '🗑 Удалить';
        bulkDeleteBtn.title = 'Удалить выбранные сохранённые запросы';
        bulkDeleteBtn.style.cssText = 'padding:4px 7px;border:1px solid #e0b0b0;border-radius:5px;background:#fff5f5;color:#b33;cursor:pointer;font-size:10px;white-space:nowrap;display:none;';
        bulkDeleteBtn.onclick = () => {
            const count = savedQuerySelectedIds.size;
            if (!count) return;
            if (!confirm(`Удалить ${count} сохранённых запрос${count === 1 ? '' : count < 5 ? 'а' : 'ов'}?`)) return;
            savedSearchQueries = savedSearchQueries.filter(q => !savedQuerySelectedIds.has(q.id));
            savedQuerySelectedIds.clear();
            chrome.storage.local.set({savedSearchQueries});
            renderSavedQueriesMenu(); positionSavedQueriesMenu();
        };
        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button'; selectAllBtn.textContent = '☑'; selectAllBtn.title = 'Выбрать все видимые';
        selectAllBtn.style.cssText = 'padding:4px 7px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#555;cursor:pointer;font-size:11px;display:none;';
        selectAllBtn.onclick = () => {
            const ids = visibleQueryIds();
            const allSelected = ids.length && ids.every(id => savedQuerySelectedIds.has(id));
            ids.forEach(id => allSelected ? savedQuerySelectedIds.delete(id) : savedQuerySelectedIds.add(id));
            renderSavedQueriesMenu(); positionSavedQueriesMenu();
        };
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button'; saveBtn.textContent = '＋ Сохранить текущий';
        saveBtn.style.cssText = 'padding:4px 7px;border:1px solid #4CAF50;border-radius:5px;background:#f1fff3;color:#2e7d32;cursor:pointer;font-size:10px;white-space:nowrap;';
        saveBtn.onclick = () => {
            const query = searchInput.value.trim();
            if (!query) { showNotification('Строка поиска пуста', 'warning'); return; }
            const defaultName = query.length > 38 ? query.slice(0, 38) + '…' : query;
            showSavedQueryDialog({
                item: {name: defaultName, query},
                onSave: ({name, query}) => {
                    const existing = savedSearchQueries.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
                    const item = {id: existing >= 0 ? savedSearchQueries[existing].id : Date.now().toString(36), name, query};
                    if (existing >= 0) savedSearchQueries[existing] = item;
                    else savedSearchQueries.unshift(item);
                    savedSearchQueries = savedSearchQueries.slice(0, 100);
                    chrome.storage.local.set({savedSearchQueries});
                    renderSavedQueriesMenu(); positionSavedQueriesMenu();
                }
            });
        };
        headActions.append(selectAllBtn, saveBtn, bulkDeleteBtn);
        head.appendChild(title); head.appendChild(headActions); savedQueriesMenu.appendChild(head);

        const querySearchWrap = document.createElement('div');
        querySearchWrap.style.cssText = 'position:relative;margin:0 0 7px;';
        const querySearch = document.createElement('input');
        querySearch.type = 'search';
        querySearch.value = savedQueriesSearchText;
        querySearch.placeholder = 'Поиск по сохранённым запросам…';
        querySearch.setAttribute('aria-label', 'Поиск по сохранённым запросам');
        querySearch.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 28px 7px 9px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font:12px sans-serif;outline:none;';
        const querySearchClear = document.createElement('button');
        querySearchClear.type = 'button';
        querySearchClear.textContent = '×';
        querySearchClear.title = 'Очистить поиск';
        querySearchClear.style.cssText = 'position:absolute;right:3px;top:3px;width:24px;height:24px;border:0;background:transparent;color:#888;cursor:pointer;font-size:16px;line-height:24px;padding:0;display:' + (savedQueriesSearchText ? 'block' : 'none') + ';';
        querySearch.oninput = () => {
            savedQueriesSearchText = querySearch.value;
            renderSavedQueriesMenu();
            positionSavedQueriesMenu();
            const input = savedQueriesMenu.querySelector('input[type="search"]');
            if (input) { input.focus(); input.setSelectionRange(savedQueriesSearchText.length, savedQueriesSearchText.length); }
        };
        querySearchClear.onclick = () => {
            savedQueriesSearchText = '';
            renderSavedQueriesMenu();
            positionSavedQueriesMenu();
            savedQueriesMenu.querySelector('input[type="search"]')?.focus();
        };
        querySearchWrap.append(querySearch, querySearchClear);
        savedQueriesMenu.appendChild(querySearchWrap);

        if (!savedSearchQueries.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Нет сохранённых запросов. Введите запрос и нажмите «＋ Сохранить текущий».';
            empty.style.cssText = 'padding:12px 8px;color:#999;line-height:1.4;';
            savedQueriesMenu.appendChild(empty);
            return;
        }

        const needle = savedQueriesSearchText.trim().toLocaleLowerCase('ru-RU');
        const visibleQueries = savedSearchQueries
            .map((item, idx) => ({item, idx}))
            .filter(({item}) => {
                if (!needle) return true;
                return String(item.name || '').toLocaleLowerCase('ru-RU').includes(needle)
                    || String(item.query || '').toLocaleLowerCase('ru-RU').includes(needle);
            });

        const visibleQueryIds = () => visibleQueries.map(({item}) => item.id);
        const visibleSelectedCount = visibleQueryIds().filter(id => savedQuerySelectedIds.has(id)).length;
        if (visibleSelectedCount) {
            bulkDeleteBtn.style.display = 'inline-block';
            bulkDeleteBtn.textContent = `🗑 Удалить (${visibleSelectedCount})`;
        }
        if (visibleQueries.length) {
            selectAllBtn.style.display = 'inline-block';
            const allSelected = visibleQueries.every(({item}) => savedQuerySelectedIds.has(item.id));
            selectAllBtn.textContent = allSelected ? '☒' : '☑';
            selectAllBtn.title = allSelected ? 'Снять выделение со всех видимых' : 'Выбрать все видимые';
        }

        if (!visibleQueries.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Ничего не найдено.';
            empty.style.cssText = 'padding:12px 8px;color:#999;line-height:1.4;';
            savedQueriesMenu.appendChild(empty);
            return;
        }

        visibleQueries.forEach(({item, idx}) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 5px;border-radius:6px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = savedQuerySelectedIds.has(item.id);
            cb.title = 'Выбрать запрос';
            cb.style.cssText = 'flex:0 0 auto;margin:0 2px 0 0;cursor:pointer;';
            cb.addEventListener('click', e => e.stopPropagation());
            cb.addEventListener('change', () => {
                if (cb.checked) savedQuerySelectedIds.add(item.id); else savedQuerySelectedIds.delete(item.id);
                renderSavedQueriesMenu(); positionSavedQueriesMenu();
            });
            row.onmouseenter = () => row.style.background = '#f6f8fa';
            row.onmouseleave = () => row.style.background = '';
            const main = document.createElement('button');
            main.type = 'button'; main.title = item.query; main.textContent = item.name;
            main.style.cssText = 'flex:1;min-width:0;text-align:left;border:0;background:none;padding:2px;cursor:pointer;font-size:11px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            main.onclick = () => {
                searchInput.value = item.query;
                searchInput.dispatchEvent(new Event('input', {bubbles:true}));
                searchInput.focus();
                savedQueriesMenu.style.display = 'none';
            };
            const edit = document.createElement('button');
            edit.type = 'button'; edit.textContent = '✎'; edit.title = 'Редактировать запрос';
            edit.style.cssText = 'border:0;background:none;cursor:pointer;color:#888;padding:3px 4px;font-size:12px;';
            edit.onclick = () => {
                showSavedQueryDialog({
                    item,
                    onSave: ({name, query}) => {
                        const duplicate = savedSearchQueries.findIndex(x => x.id !== item.id && x.name.toLowerCase() === name.toLowerCase());
                        if (duplicate >= 0) { showNotification('Запрос с таким названием уже существует','warning'); return; }
                        item.name=name; item.query=query;
                        chrome.storage.local.set({savedSearchQueries});
                        renderSavedQueriesMenu(); positionSavedQueriesMenu();
                    }
                });
            };
            const del = document.createElement('button');
            del.type = 'button'; del.textContent = '×'; del.title = 'Удалить';
            del.style.cssText = 'border:0;background:none;cursor:pointer;color:#b44;padding:3px 4px;font-size:15px;';
            del.onclick = () => {
                savedQuerySelectedIds.delete(item.id);
                savedSearchQueries.splice(idx, 1);
                chrome.storage.local.set({savedSearchQueries});
                renderSavedQueriesMenu(); positionSavedQueriesMenu();
            };
            row.append(cb, main, edit, del); savedQueriesMenu.appendChild(row);
        });
    }

    savedQueriesBtn.onclick = (e) => {
        e.stopPropagation();
        const open = savedQueriesMenu.style.display === 'block';
        if (open) { savedQueriesMenu.style.display = 'none'; return; }
        renderSavedQueriesMenu();
        savedQueriesMenu.style.display = 'block';
        positionSavedQueriesMenu();
    };
    document.addEventListener('mousedown', e => {
        if (savedQueriesMenu.style.display === 'block' && !savedQueriesMenu.contains(e.target) && e.target !== savedQueriesBtn) savedQueriesMenu.style.display = 'none';
    }, true);
    window.addEventListener('resize', () => { if (savedQueriesMenu.style.display === 'block') positionSavedQueriesMenu(); });
    chrome.storage.local.get(['savedSearchQueries'], d => {
        if (Array.isArray(d.savedSearchQueries)) {
            savedSearchQueries = d.savedSearchQueries.filter(x => x && typeof x.name === 'string' && typeof x.query === 'string').slice(0, 100);
            savedQuerySelectedIds.clear();
        }
    });
    searchRow.appendChild(savedQueriesBtn);

    // Кнопка «Применить фильтры» — видна только в ручном режиме
    const applyFiltersBtn = document.createElement('button');
    applyFiltersBtn.textContent = '▶ Применить';
    applyFiltersBtn.title = 'Применить фильтры вручную';
    applyFiltersBtn.style.cssText = 'padding:6px 12px; border:1px solid #2196F3; border-radius:6px; cursor:pointer; background:#e3f2fd; color:#1565C0; font-size:12px; white-space:nowrap; display:none;';
    applyFiltersBtn.addEventListener('click', () => applyFilters());
    searchRow.appendChild(applyFiltersBtn);

    // Галочка авто-применения
    const autoFilterLabel = document.createElement('label');
    autoFilterLabel.title = 'Если выключено — фильтры применяются только по кнопке «Применить». Помогает при большом количестве товаров.';
    autoFilterLabel.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; color:#888; cursor:pointer; white-space:nowrap; flex-shrink:0;';
    const autoFilterChk = document.createElement('input');
    autoFilterChk.type = 'checkbox';
    autoFilterChk.checked = true;
    autoFilterChk.style.cursor = 'pointer';
    autoFilterChk.addEventListener('change', () => {
        autoFilterEnabled = autoFilterChk.checked;
        applyFiltersBtn.style.display = autoFilterEnabled ? 'none' : '';
    });
    autoFilterLabel.appendChild(autoFilterChk);
    autoFilterLabel.appendChild(document.createTextNode('авто'));
    searchRow.appendChild(autoFilterLabel);
    searchRow.appendChild(clearBtn);
    searchRow.appendChild(hint);

    const typeRow = document.createElement('div');
    typeRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Показывать:';
    typeLabel.style.cssText = 'font-size:13px; color:#666; white-space:nowrap;';

    function createTypeBtn(key, label) {
        const btn = document.createElement('button');
        btn.dataset.key = key;
        btn.dataset.label = label;
        btn.dataset.typeBtn = key;
        btn.textContent = label;
        btn.style.cssText = `
            padding: 5px 12px; border: 2px solid #4CAF50; border-radius: 20px;
            cursor: pointer; font-size: 12px; font-weight: bold;
            background: #4CAF50; color: white; transition: all 0.15s;
        `;
        btn.addEventListener('click', () => {
            typeFilter[key] = !typeFilter[key];
            btn.style.background = typeFilter[key] ? '#4CAF50' : 'transparent';
            btn.style.color = typeFilter[key] ? 'white' : '#4CAF50';
            applyFilters();
        });
        return btn;
    }

    // Строка фильтров по типу измерения товара
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.textContent = '✓ Все';
    toggleAllBtn.style.cssText = `
    padding: 5px 12px; border: 2px solid #888; border-radius: 20px;
    cursor: pointer; font-size: 12px; font-weight: bold;
    background: #888; color: white; transition: all 0.15s;
`;
    toggleAllBtn.title = 'Включить или выключить все фильтры по типу товара сразу';
    toggleAllBtn.addEventListener('click', () => {
        const allOn = Object.values(typeFilter).every(v => v);
        const newState = !allOn;
        for (const key of Object.keys(typeFilter)) {
            typeFilter[key] = newState;
        }
        // Обновляем стили всех кнопок
        for (const [category, btn] of Object.entries(typeBtns)) {
            btn.style.background = typeFilter[category] ? '#4CAF50' : 'transparent';
            btn.style.color = typeFilter[category] ? 'white' : '#4CAF50';
        }
        toggleAllBtn.textContent = newState ? '✓ Все' : '○ Все';
        toggleAllBtn.style.background = newState ? '#888' : 'transparent';
        toggleAllBtn.style.color = newState ? 'white' : '#888';
        applyFilters();
    });

    typeRow.appendChild(typeLabel);
    typeRow.appendChild(toggleAllBtn);

    const typeFilter = {};
    const typeBtns = {};

    for (const [category, config] of Object.entries(UNITS)) {
        typeFilter[category] = true;
    }
    typeFilter.none = true;

    const typeTipMap = {
        length: 'Товары, у которых в названии есть длина\n(см, м, мм…) — напр. «кабель 5м»',
        volume: 'Товары, у которых в названии есть объём\n(мл, л, л…) — напр. «шампунь 500мл»',
        weight: 'Товары, у которых в названии есть масса\n(г, кг…) — напр. «корм 2кг»',
        pieces: 'Товары, у которых в названии есть штучность\n(шт, упак, таб…) — напр. «таблетки 30шт»',
    };
    for (const [category, config] of Object.entries(UNITS)) {
        const btn = createTypeBtn(category, config.label);
        if (typeTipMap[category]) btn.title = typeTipMap[category];
        typeBtns[category] = btn;
        typeRow.appendChild(btn);
    }


    const btnNone = createTypeBtn('none', '❓ Без величины');
    btnNone.title = 'Товары, у которых в названии не найдена\nни одна единица измерения';
    typeBtns.none = btnNone;
    typeRow.appendChild(btnNone);

    typeFilter.noPrice = true;
    const btnNoPrice = createTypeBtn('noPrice', '🚫 Без цены');
    btnNoPrice.title = 'Товары, у которых не удалось распознать цену\n(цена отсутствует или скрыта)';
    typeBtns.noPrice = btnNoPrice;
    typeRow.appendChild(btnNoPrice);

    // Строка фильтра по цене (два независимых диапазона)
    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'display:flex; gap:12px; align-items:center; flex-wrap:wrap;';

    // ── Диапазон по полной цене ──
    const priceLabel = document.createElement('span');
    priceLabel.textContent = '💰 Цена:';
    priceLabel.title = 'Фильтр по полной цене товара';
    priceLabel.style.cssText = 'font-size:13px; color:#2196F3; font-weight:bold; white-space:nowrap;';

    const priceMin = document.createElement('input');
    priceMin.type = 'number';
    priceMin.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #90CAF9; border-radius:6px; font-size:13px;';

    const priceSep = document.createElement('span');
    priceSep.textContent = '—';
    priceSep.style.cssText = 'color:#999;';

    const priceMax = document.createElement('input');
    priceMax.type = 'number';
    priceMax.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #90CAF9; border-radius:6px; font-size:13px;';

    // ── Разделитель ──
    const priceDivider = document.createElement('span');
    priceDivider.textContent = '│';
    priceDivider.style.cssText = 'color:#ddd; font-size:16px;';

    // ── Диапазон по цене/величине ──
    const priceUnitLabel = document.createElement('span');
    priceUnitLabel.textContent = '⚖️ Цена/ед.:';
    priceUnitLabel.title = 'Фильтр по цене за единицу (г/мл/шт…)';
    priceUnitLabel.style.cssText = 'font-size:13px; color:#4CAF50; font-weight:bold; white-space:nowrap;';

    const priceUnitMin = document.createElement('input');
    priceUnitMin.type = 'number';
    priceUnitMin.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #A5D6A7; border-radius:6px; font-size:13px;';

    const priceUnitSep = document.createElement('span');
    priceUnitSep.textContent = '—';
    priceUnitSep.style.cssText = 'color:#999;';

    const priceUnitMax = document.createElement('input');
    priceUnitMax.type = 'number';
    priceUnitMax.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #A5D6A7; border-radius:6px; font-size:13px;';

    const unitPrioritySelect = document.createElement('select');
    unitPrioritySelect.title = 'По какой величине сравнивать цену/ед. при фильтрации и сортировке';
    unitPrioritySelect.style.cssText = 'padding:5px 7px; border:1px solid #A5D6A7; border-radius:6px; font-size:12px; background:#fff;';
    function unitPriorityOptionLabel(category) {
        if (category === 'auto') return 'Авто';
        const chosen = getDisplayUnitForCategory(category);
        return chosen ? `${getCategoryDisplayName(category)} · ₽/${chosen.unit}` : getCategoryDisplayName(category);
    }
    function renderUnitPriorityOptions() {
        const prev = unitPrioritySelect.value;
        unitPrioritySelect.innerHTML = '';
        ['auto', ...getCategoriesByPriority()].forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = unitPriorityOptionLabel(value);
            unitPrioritySelect.appendChild(option);
        });
        if (prev) unitPrioritySelect.value = prev;
    }
    renderUnitPriorityOptions();

    priceFilterByUnit = false; // оставляем переменную для совместимости, но она больше не используется

    chrome.storage.local.get(['unitPricePriority'], d => {
        unitPricePriority = d.unitPricePriority || 'auto';
        unitPrioritySelect.value = unitPricePriority;
        updatePriceUnitUI();
    });
    unitPrioritySelect.addEventListener('change', () => {
        unitPricePriority = unitPrioritySelect.value || 'auto';
        chrome.storage.local.set({ unitPricePriority });
        updatePriceUnitUI();
        scheduleApplyFilters();
    });

    function updatePriceUnitUI() {
        renderUnitPriorityOptions();
        const label = getUnitPricePriorityLabel();
        priceUnitLabel.textContent = `⚖️ Цена/ед. (${label}):`;
        priceUnitLabel.title = (unitPricePriority === 'auto'
            ? 'Авто: приоритет Вес → Объём → Штуки → Длина. Если выбранная величина отсутствует, товар не участвует в сравнении по цене/ед.'
            : `Фильтр и сортировка только по выбранной величине: ${label}`)
            + ' Знаков после запятой в настройках единиц влияет только на отображение, точность фильтра не меняет.';
        updatePricePlaceholders([...seenTiles.values()]);
        scheduleDeliveryCalendarRefresh(true);
    }

    priceRow.appendChild(priceLabel);
    priceRow.appendChild(priceMin);
    priceRow.appendChild(priceSep);
    priceRow.appendChild(priceMax);
    priceRow.appendChild(priceDivider);
    priceRow.appendChild(priceUnitLabel);
    priceRow.appendChild(priceUnitMin);
    priceRow.appendChild(priceUnitSep);
    priceRow.appendChild(priceUnitMax);
    priceRow.appendChild(unitPrioritySelect);

    // Компактный вид селектора величины, когда он временно живёт внутри
    // счётчика (см. renderCounterLabel) — тот же элемент, просто другое место в DOM.

    // Обновляет текст счётчика карточек. Когда активна сортировка по
    // «цена/ед.» (режим 'per-gram*'), сам селектор приоритета величины
    // (⚖️ Авто/Вес/Объём/…) переносится внутрь счётчика вместо статичной
    // подписи — это ОДИН И ТОТ ЖЕ элемент (просто перемещается по DOM),
    // поэтому его обработчик 'change' и текущее значение не теряются.
    // В остальных режимах селектор возвращается на своё место в строке
    // фильтра цены/ед.
    function renderCounterLabel(count, total, mode, arrow) {
        counter.replaceChildren();
        if (String(mode).startsWith('per-gram')) {
            counter.appendChild(document.createTextNode(`${count}/${total} шт. · ⚖️ `));
            unitPrioritySelect.style.verticalAlign = 'middle';
            unitPrioritySelect.style.margin = '0 2px';
            counter.appendChild(unitPrioritySelect);
            counter.appendChild(document.createTextNode(` ${arrow}`));
        } else {
            if (unitPrioritySelect.parentElement !== priceRow) {
                priceRow.appendChild(unitPrioritySelect);
            }
            const label = getSortModeLabel(mode);
            counter.appendChild(document.createTextNode(`${count}/${total} шт. · ${label} ${arrow}`));
        }
        counter.appendChild(document.createTextNode(' '));
        counter.appendChild(deliveryCalendarActionsWrap);
        updateDeliveryCalendarButton();
    }

    // ── Вторая строка фильтров: рейтинг и отзывы ──
    const rangeRow2 = document.createElement('div');
    rangeRow2.style.cssText = 'display:flex; gap:12px; align-items:center; flex-wrap:wrap;';

    const ratingLabel = document.createElement('span');
    ratingLabel.textContent = '⭐ Рейтинг:';
    ratingLabel.title = 'Фильтр по рейтингу товара';
    ratingLabel.style.cssText = 'font-size:13px; color:#FF9800; font-weight:bold; white-space:nowrap;';

    const ratingMin = document.createElement('input');
    ratingMin.type = 'number';
    ratingMin.step = '0.1';
    ratingMin.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #FFCC80; border-radius:6px; font-size:13px;';

    const ratingSep = document.createElement('span');
    ratingSep.textContent = '—';
    ratingSep.style.cssText = 'color:#999;';

    const ratingMax = document.createElement('input');
    ratingMax.type = 'number';
    ratingMax.step = '0.1';
    ratingMax.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #FFCC80; border-radius:6px; font-size:13px;';

    const rangeDivider2 = document.createElement('span');
    rangeDivider2.textContent = '│';
    rangeDivider2.style.cssText = 'color:#ddd; font-size:16px;';

    const reviewsLabel = document.createElement('span');
    reviewsLabel.textContent = '💬 Отзывы:';
    reviewsLabel.title = 'Фильтр по количеству отзывов';
    reviewsLabel.style.cssText = 'font-size:13px; color:#7E57C2; font-weight:bold; white-space:nowrap;';

    const reviewsMin = document.createElement('input');
    reviewsMin.type = 'number';
    reviewsMin.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';

    const reviewsSep = document.createElement('span');
    reviewsSep.textContent = '—';
    reviewsSep.style.cssText = 'color:#999;';

    const reviewsMax = document.createElement('input');
    reviewsMax.type = 'number';
    reviewsMax.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';

    const rangeDelivery2 = document.createElement('span');
    rangeDelivery2.textContent = '│';
    rangeDelivery2.style.cssText = 'color:#ddd; font-size:16px;';

    const deliveryLabel = document.createElement('span');
    deliveryLabel.textContent = '🚚 Доставка:';
    deliveryLabel.title = 'Фильтр по дате доставки';
    deliveryLabel.style.cssText = 'font-size:13px; color:#00af90; font-weight:bold; white-space:nowrap;';

    const deliveryMin = document.createElement('input');
    deliveryMin.type = 'text';
    // deliveryMin.type = 'date';
    deliveryMin.style.cssText = 'width:120px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';
    // При фокусе превращаем в календарь
    deliveryMin.addEventListener('focus', () => {
        deliveryMin.type = 'date';
    });
    // При потере фокуса возвращаем текст, только если поле осталось пустым
    deliveryMin.addEventListener('blur', () => {
        if (!deliveryMin.value) {
            deliveryMin.type = 'text';
        }
    });

    const deliverySep = document.createElement('span');
    deliverySep.textContent = '—';
    deliverySep.style.cssText = 'color:#999;';

    const deliveryMax = document.createElement('input');
    deliveryMax.type = 'text'; // Начинаем как текст
    // deliveryMax.type = 'date';
    deliveryMax.style.cssText = 'width:120px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';
    // При фокусе превращаем в календарь
    deliveryMax.addEventListener('focus', () => {
        deliveryMax.type = 'date';
    });
    // При потере фокуса возвращаем текст, только если поле осталось пустым
    deliveryMax.addEventListener('blur', () => {
        if (!deliveryMax.value) {
            deliveryMax.type = 'text';
        }
    });

    rangeRow2.appendChild(ratingLabel);
    rangeRow2.appendChild(ratingMin);
    rangeRow2.appendChild(ratingSep);
    rangeRow2.appendChild(ratingMax);
    rangeRow2.appendChild(rangeDivider2);
    rangeRow2.appendChild(reviewsLabel);
    rangeRow2.appendChild(reviewsMin);
    rangeRow2.appendChild(reviewsSep);
    rangeRow2.appendChild(reviewsMax);
    rangeRow2.appendChild(rangeDelivery2);
    rangeRow2.appendChild(deliveryLabel);
    rangeRow2.appendChild(deliveryMin);
    rangeRow2.appendChild(deliverySep);
    rangeRow2.appendChild(deliveryMax);

    // ── Связь «поисковая строка ↔ поля фильтра» ────────────────────────────────
    // Поля и DSL используют один источник смысла. Простые диапазоны синхронизируются
    // в обе стороны, а сложные выражения (несколько диапазонов, OR, вложенные группы)
    // оставляем в поисковой строке, чтобы не потерять её более богатый синтаксис.
    let linkedFiltersEnabled = true;
    let linkedFiltersSyncing = false;
    let linkedFiltersStatus = null;

    chrome.storage.local.get(['linkedFiltersEnabled'], d => {
        linkedFiltersEnabled = d.linkedFiltersEnabled !== false;
        if (linkedFiltersStatus) updateLinkedFiltersStatus();
    });

    function getLinkedFieldInputSet(field) {
        return {
            price: [priceMin, priceMax],
            perunit: [priceUnitMin, priceUnitMax],
            rating: [ratingMin, ratingMax],
            reviews: [reviewsMin, reviewsMax],
            delivery: [deliveryMin, deliveryMax]
        }[field] || null;
    }

    function clearLinkedField(field) {
        const pair = getLinkedFieldInputSet(field);
        if (pair) pair.forEach(i => { i.value = ''; });
    }

    function formatLinkedNumeric(v) {
        return String(v).replace(',', '.').trim();
    }

    function formatLinkedDateInput(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [y,m,d] = s.split('-');
            return `${d}.${m}.${y}`;
        }
        return s;
    }

    function parseLinkedRangeToken(token) {
        if (!token || token.type !== 'range') return null;
        return { min: token.min, max: token.max };
    }

    function extractLinkedSearchRanges(query) {
        const tokens = parseSearchQuery(stripSortRulesFromQuery(query || ''));
        const out = { price: [], perunit: [], rating: [], reviews: [], delivery: [] };
        let incompatible = false;
        const walk = arr => {
            for (const token of arr) {
                if (token.type === 'field') {
                    const field = normalizePrimarySearchFieldName(token.name);
                    if (!field || field === 'title' || token.exclude || token.presence) { incompatible = true; continue; }
                    if (field === 'delivery' && token.dateQuery) {
                        if (token.dateQuery.exclude || !token.dateQuery.ranges?.length) { incompatible = true; continue; }
                        for (const r of token.dateQuery.ranges) out.delivery.push({min:r.minTs,max:r.maxTs});
                        continue;
                    }
                    // Новая форма числовых атрибутов хранится в token.numericQuery:
                    // @цена/ед.(0.01-1 2 3.1-3.2) / через ';'. Старую форму
                    // с фигурными скобками также поддерживаем через innerTokens.
                    if (token.numericQuery?.items?.length) {
                        const items = token.numericQuery.items;
                        if (items.some(r => r.exclude)) { incompatible = true; continue; }
                        items.forEach(r => out[field].push({min:r.min,max:r.max}));
                        continue;
                    }
                    if (!token.innerTokens?.length) { incompatible = true; continue; }
                    const ranges = token.innerTokens.filter(t => t.type === 'range');
                    if (ranges.length !== token.innerTokens.length || !ranges.length) { incompatible = true; continue; }
                    ranges.forEach(r => out[field].push({min:r.min,max:r.max}));
                } else if (token.type === 'or-group' || token.type === 'query-group') {
                    incompatible = true;
                } else {
                    incompatible = true;
                }
            }
        };
        walk(tokens);
        return { out, incompatible };
    }

    function updateLinkedFiltersStatus(text = null) {
        if (!linkedFiltersStatus) return;
        if (text) { linkedFiltersStatus.textContent = text; linkedFiltersStatus.style.color = '#b26a00'; return; }
        linkedFiltersStatus.textContent = linkedFiltersEnabled ? '↔ Связано' : '↔ Связь выкл.';
        linkedFiltersStatus.style.color = linkedFiltersEnabled ? '#2e7d32' : '#999';
    }

    function syncFieldsFromSearch() {
        if (!linkedFiltersEnabled || linkedFiltersSyncing) return;
        const query = searchInput.value.trim();
        if (!query) {
            linkedFiltersSyncing = true;
            ['price','perunit','rating','reviews','delivery'].forEach(clearLinkedField);
            linkedFiltersSyncing = false;
            updateLinkedFiltersStatus();
            return;
        }
        const parsed = extractLinkedSearchRanges(query);
        if (parsed.incompatible) {
            updateLinkedFiltersStatus('↔ Сложный запрос — поля не меняют его');
            return;
        }
        linkedFiltersSyncing = true;
        ['price','perunit','rating','reviews','delivery'].forEach(clearLinkedField);
        const setPair = (field, r) => {
            const pair=getLinkedFieldInputSet(field); if(!pair || !r) return;
            if(field==='delivery') {
                pair[0].value = formatDateInputFromTs(r.min);
                pair[1].value = formatDateInputFromTs(r.max);
            } else {
                pair[0].value = formatLinkedNumeric(r.min);
                pair[1].value = formatLinkedNumeric(r.max);
            }
        };
        for (const field of Object.keys(parsed.out)) {
            const ranges=parsed.out[field];
            if (ranges.length === 1) setPair(field, ranges[0]);
            else if (ranges.length > 1) { linkedFiltersSyncing=false; updateLinkedFiltersStatus(`↔ ${field === 'delivery' ? 'Доставка' : field}: несколько диапазонов — управляются из строки поиска`); return; }
        }
        linkedFiltersSyncing = false;
        updateLinkedFiltersStatus();
    }

    function formatDateInputFromTs(ts) {
        const d = new Date(ts);
        if (!Number.isFinite(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function isSimpleLinkedFieldClauseName(name) {
        const f=normalizePrimarySearchFieldName(name);
        return ['price','perunit','rating','reviews','delivery'].includes(f);
    }

    function fieldClauseFromInputs(field) {
        const pair=getLinkedFieldInputSet(field); if(!pair) return null;
        const a=String(pair[0].value||'').trim(), b=String(pair[1].value||'').trim();
        if(!a && !b) return null;
        if(!a || !b) return { unsupported:true };
        if(field==='delivery') {
            const da=parseStrictDate(a,'start'), db=parseStrictDate(b,'end');
            if(!Number.isFinite(da)||!Number.isFinite(db)) return {unsupported:true};
            const d1=new Date(da), d2=new Date(db);
            const f=d=>`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
            return `@доставка({${f(d1)}-${f(d2)}})`;
        }
        const min=formatLinkedNumeric(a), max=formatLinkedNumeric(b);
        if(!/^[-+]?\d+(?:\.\d+)?$/.test(min)||!/^[-+]?\d+(?:\.\d+)?$/.test(max)) return {unsupported:true};
        const names={price:'цена',perunit:'цена/ед.',rating:'рейтинг',reviews:'отзывы'};
        return `@${names[field]}({${min}-${max}})`;
    }

    function syncSearchFromFields() {
        if (!linkedFiltersEnabled || linkedFiltersSyncing) return;
        const clauses=[];
        for (const field of ['price','perunit','rating','reviews','delivery']) {
            const clause=fieldClauseFromInputs(field);
            if (clause?.unsupported) { updateLinkedFiltersStatus('↔ Заполните обе границы диапазона'); return; }
            if (clause) clauses.push(clause);
        }
        let query=searchInput.value.trim();
        // Удаляем только простые primary-field clauses. Остальной пользовательский
        // запрос (например, «корм*») сохраняем. Сложные field-выражения не трогаем.
        const simpleClauseRe=/@([\p{L}\p{N}_\/.-]+)\((\{[^(){}]+\})\)/giu;
        query=query.replace(simpleClauseRe, (full,name)=> isSimpleLinkedFieldClauseName(name) ? '' : full).replace(/\s{2,}/g,' ').trim();
        if (clauses.length) query=query ? `${query} ${clauses.join(' ')}` : clauses.join(' ');
        linkedFiltersSyncing=true;
        searchInput.value=query;
        linkedFiltersSyncing=false;
        updateLinkedFiltersStatus();
        searchInput.dispatchEvent(new Event('input',{bubbles:true}));
    }

    const linkedToggleWrap=document.createElement('label');
    linkedToggleWrap.style.cssText='display:flex;align-items:center;gap:4px;font-size:10px;color:#777;white-space:nowrap;margin-left:4px;';
    const linkedToggle=document.createElement('input'); linkedToggle.type='checkbox'; linkedToggle.checked=linkedFiltersEnabled;
    linkedToggle.title='Синхронизировать простые диапазоны между поисковой строкой и полями';
    linkedToggle.addEventListener('change',()=>{linkedFiltersEnabled=linkedToggle.checked;chrome.storage.local.set({linkedFiltersEnabled});updateLinkedFiltersStatus();if(linkedFiltersEnabled) syncFieldsFromSearch();});
    linkedToggleWrap.append(linkedToggle,document.createTextNode('↔ Поиск/поля'));
    linkedFiltersStatus=document.createElement('span');
    linkedFiltersStatus.style.cssText='font-size:10px;color:#2e7d32;white-space:nowrap;';
    updateLinkedFiltersStatus();
    rangeRow2.appendChild(linkedToggleWrap);
    rangeRow2.appendChild(linkedFiltersStatus);

    [priceMin, priceMax, priceUnitMin, priceUnitMax, ratingMin, ratingMax, reviewsMin, reviewsMax, deliveryMin, deliveryMax].forEach(input => {
        input.addEventListener('input', () => { syncSearchFromFields(); scheduleApplyFilters(); });
    });

    function updatePricePlaceholders(tiles) {
        if (tiles.length === 0) return;
        // Цены
        const priceVals = tiles.map(t => getPrice(t)).filter(v => v < 99999999);
        if (priceVals.length > 0) {
            priceMin.placeholder = Math.min(...priceVals).toFixed(0);
            priceMax.placeholder = Math.max(...priceVals).toFixed(0);
        }
        // Цены/ед.
        const unitVals = tiles.map(t => getPricePerUnit(t)?.value).filter(v => v != null && Number.isFinite(v));
        if (unitVals.length > 0) {
            const d = getUnitPriceDecimalsForPriority();
            priceUnitMin.placeholder = Math.min(...unitVals).toFixed(d);
            priceUnitMax.placeholder = Math.max(...unitVals).toFixed(d);
        } else {
            priceUnitMin.placeholder = '';
            priceUnitMax.placeholder = '';
        }
        // Рейтинг
        const ratingVals = tiles.map(t => getRating(t)).filter(v => v != null);
        if (ratingVals.length > 0) {
            ratingMin.placeholder = Math.min(...ratingVals).toString();
            ratingMax.placeholder = Math.max(...ratingVals).toString();
        }
        // Отзывы
        const reviewsVals = tiles.map(t => getReviewsCount(t)).filter(v => v != null);
        if (reviewsVals.length > 0) {
            reviewsMin.placeholder = Math.min(...reviewsVals).toString();
            reviewsMax.placeholder = Math.max(...reviewsVals).toString();
        }
        // Дата доставки
        const deliveryVals = tiles.map(t => getDeliveryDate(t)).filter(v => v != null);
        if (deliveryVals.length > 0) {
            deliveryMin.placeholder = formatDateToString(Math.min(...deliveryVals));
            deliveryMax.placeholder = formatDateToString(Math.max(...deliveryVals));
        }

        // ── Кэш подсказок для автодополнения @атрибутов в поисковой строке ──
        // Считается один раз здесь (там же, где и остальные плейсхолдеры —
        // то есть при обновлении набора карточек), а не на каждое нажатие
        // клавиши в поле поиска. Строка поиска только читает готовый кэш.
        rebuildAttributeSuggestCache(tiles, { priceVals, unitVals, ratingVals, reviewsVals, deliveryVals });
    }

    // Список «основных» атрибутов, доступных через @имя(...) — их можно
    // ввести и в отдельные поля фильтра, но эти алиасы тоже нужно предлагать.
    const PRIMARY_ATTR_HINTS = [
        { name: 'название', kind: 'primary-text', staticHint: 'обычный текстовый поиск, например @название(корм*)' },
        { name: 'цена', kind: 'primary-number', vals: 'priceVals', unit: '₽' },
        { name: 'цена/ед.', kind: 'primary-number', vals: 'unitVals' },
        { name: 'рейтинг', kind: 'primary-number', vals: 'ratingVals' },
        { name: 'отзывы', kind: 'primary-number', vals: 'reviewsVals' },
        { name: 'доставка', kind: 'primary-date', vals: 'deliveryVals' },
    ];

    let attributeSuggestCache = [];

    function rebuildAttributeSuggestCache(tiles, primaryVals) {
        const entries = [];

        for (const def of PRIMARY_ATTR_HINTS) {
            if (def.kind === 'primary-number') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                const d = def.name === 'цена/ед.' ? getUnitPriceDecimalsForPriority() : (def.name === 'рейтинг' ? undefined : 0);
                const min = Math.min(...vals), max = Math.max(...vals);
                const fmt = v => d != null ? v.toFixed(d) : String(v);
                entries.push({ name: def.name, kind: def.kind, hint: `${fmt(min)} – ${fmt(max)}` });
            } else if (def.kind === 'primary-date') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                entries.push({ name: def.name, kind: def.kind, hint: `${formatDateToString(Math.min(...vals))} – ${formatDateToString(Math.max(...vals))}` });
            } else {
                entries.push({ name: def.name, kind: def.kind, hint: def.staticHint || null, static: true });
            }
        }

        // Настраиваемые (дополнительные) атрибуты — те же данные, что уже
        // используются панелью «Доп. атрибуты и величины» ниже.
        let extraDefs = [];
        try { extraDefs = getExtraDefinitions(tiles); } catch { extraDefs = []; }
        for (const def of extraDefs) {
            const name = def.name;
            if (!name) continue;
            let hint = null;
            if (def.kind === 'quantity') {
                const nums = def.values.map(parseExtraNumber).filter(v => v != null);
                if (nums.length) {
                    const min = Math.min(...nums), max = Math.max(...nums);
                    hint = `${min}${def.unit ? ' ' + def.unit : ''} – ${max}${def.unit ? ' ' + def.unit : ''}`;
                }
            } else {
                const freq = new Map();
                for (const raw of def.values) {
                    for (const v of String(raw).split(' | ').map(s => s.trim()).filter(Boolean)) {
                        freq.set(v, (freq.get(v) || 0) + 1);
                    }
                }
                const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
                if (top.length) hint = top.join(', ') + (freq.size > top.length ? ', …' : '');
            }
            entries.push({ name, kind: def.kind === 'quantity' ? 'extra-quantity' : 'extra-text', hint });
        }

        attributeSuggestCache = entries;
        refreshAttributeAutocompleteUi();
    }

    // ── Кнопка «Сбросить всё» ──
    const resetFiltersBtn = document.createElement('button');
    resetFiltersBtn.textContent = '↺ Сбросить';
    resetFiltersBtn.title = 'Сбросить все фильтры и сортировку к значениям по умолчанию:\n• Сортировка: Цена ↑\n• Все типы товаров включены\n• Диапазон цены очищен\n• Поисковая строка очищена\n• Режим: по цене';
    resetFiltersBtn.style.cssText = `
        padding: 4px 10px; border: 1px solid #bbb; border-radius: 14px;
        cursor: pointer; font-size: 11px; font-weight: 500;
        background: #f5f5f5; color: #666; transition: all 0.15s;
        margin-left: auto; white-space: nowrap; flex-shrink: 0;
    `;
    resetFiltersBtn.addEventListener('mouseenter', () => {
        resetFiltersBtn.style.background = '#e0e0e0';
        resetFiltersBtn.style.color = '#333';
        resetFiltersBtn.style.borderColor = '#999';
    });
    resetFiltersBtn.addEventListener('mouseleave', () => {
        resetFiltersBtn.style.background = '#f5f5f5';
        resetFiltersBtn.style.color = '#666';
        resetFiltersBtn.style.borderColor = '#bbb';
    });
    resetFiltersBtn.addEventListener('click', () => {
        // Сброс сортировки
        currentMode = 'asc';
        sortBtns.forEach(([bm, b]) => {
            b.style.background = bm === 'asc' ? '#2196F3' : 'transparent';
            b.style.color = bm === 'asc' ? 'white' : '#2196F3';
        });
        // Сброс фильтров типов
        for (const key of Object.keys(typeFilter)) typeFilter[key] = true;
        for (const [cat, btn] of Object.entries(typeBtns)) {
            btn.style.background = '#4CAF50';
            btn.style.color = 'white';
        }
        toggleAllBtn.textContent = '✓ Все';
        toggleAllBtn.style.background = '#888';
        toggleAllBtn.style.color = 'white';
        // Сброс диапазонов цены
        priceMin.value = '';
        priceMax.value = '';
        priceUnitMin.value = '';
        priceUnitMax.value = '';
        unitPricePriority = 'auto';
        unitPrioritySelect.value = 'auto';
        chrome.storage.local.set({ unitPricePriority: 'auto' });
        updatePriceUnitUI();
        ratingMin.value = '';
        ratingMax.value = '';
        reviewsMin.value = '';
        reviewsMax.value = '';
        deliveryMin.value = '';
        deliveryMax.value = '';
        // Сброс строки поиска
        searchInput.value = '';
        // Сброс кэша групп
        _searchGroupCache = null;
        _savedGroupCache = null;
        applyFilters();
    });
    sortRow.appendChild(resetFiltersBtn);

    // Компактный общий сворачиваемый контейнер для всех быстрых фильтров и сортировки.
    const filtersPanel = document.createElement('div');
    filtersPanel.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:7px 9px; border:1px solid #d8dee6; border-radius:8px; background:#fbfcfd;';
    const filtersToggle = document.createElement('div');
    filtersToggle.style.cssText = 'font-size:12px; font-weight:700; color:#546e7a; cursor:pointer; user-select:none; min-height:20px; line-height:20px;';
    const filtersBody = document.createElement('div');
    filtersBody.style.cssText = 'display:none; flex-direction:column; gap:8px;';
    let filtersPanelOpen = false;
    function setFiltersPanelOpen(open) {
        filtersPanelOpen = !!open;
        filtersToggle.textContent = (filtersPanelOpen ? '▼' : '▶') + ' ⚙ Фильтры и сортировка';
        filtersBody.style.display = filtersPanelOpen ? 'flex' : 'none';
    }
    filtersToggle.addEventListener('click', () => setFiltersPanelOpen(!filtersPanelOpen));
    filtersBody.appendChild(sortRow);
    filtersBody.appendChild(typeRow);
    filtersBody.appendChild(priceRow);
    filtersBody.appendChild(rangeRow2);
    filtersBody.appendChild(extraControls);
    filtersPanel.appendChild(filtersToggle);
    filtersPanel.appendChild(filtersBody);
    setFiltersPanelOpen(false);

    header.appendChild(topRow);
    header.appendChild(searchRow);
    header.appendChild(filtersPanel);

    // ─── Панель выделения ──────────────────────────────────────────────────────────
    const selectionPanel = document.createElement('div');
    selectionPanel.style.cssText = `
    display: flex; padding: 10px 20px;
    background: #e3f2fd; border-top: 1px solid #90caf9;
    flex-shrink: 0; gap: 10px; align-items: center;
    flex-wrap: wrap;
`;

    const selectionCounter = document.createElement('span');
    selectionCounter.style.cssText = 'font-size:13px; color:#1565c0; font-weight:bold;';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '☑ Выбрать все';
    selectAllBtn.style.cssText = 'padding:6px 12px; background:#2196F3; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const deselectBtn = document.createElement('button');
    deselectBtn.textContent = '✕ Снять выделение';
    deselectBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';

    const saveSelectedBtn = document.createElement('button');
    saveSelectedBtn.textContent = '🔖 Сохранить выбранные';
    saveSelectedBtn.style.cssText = 'padding:6px 12px; background:#4CAF50; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const invertBtn = document.createElement('button');
    invertBtn.textContent = '⇄ Инвертировать';
    invertBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    invertBtn.addEventListener('click', () => {
        currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (selectedKeys.has(k)) selectedKeys.delete(k);
            else selectedKeys.add(k);
        });
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    selectionPanel.appendChild(selectionCounter);
    selectionPanel.appendChild(selectAllBtn);
    selectionPanel.appendChild(deselectBtn);
    selectionPanel.appendChild(invertBtn);
    selectionPanel.appendChild(saveSelectedBtn);

    function updateSelectionPanel() {
        selectionCounter.textContent = selectedKeys.size > 0 ? `Выбрано: ${selectedKeys.size}` : '';
    }

    selectAllBtn.addEventListener('click', () => {
        currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (k) selectedKeys.add(k);
        });
        lastSelectedIndex = -1; lastSelectedKey = null;
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    deselectBtn.addEventListener('click', () => {
        selectedKeys.clear();
        lastSelectedIndex = -1; lastSelectedKey = null;
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    saveSelectedBtn.addEventListener('click', async () => {
        const tilesToSave = currentTiles
            .filter(tile => selectedKeys.has(getTileKey(tile)));
        if (tilesToSave.length === 0) return;

        // показываем диалог выбора папок
        const existingFolders = getAllFoldersGlobal ? await getAllFoldersGlobal() : [];
        showSaveFolderDialog(saveSelectedBtn, existingFolders, async (chosenFolders) => {
            const total = tilesToSave.length;
            const progress = total > 3 ? createProgressBar(
                '⏳ Подготовка: 0 / ' + total + ' карточек...'
            ) : null;

            // Собираем HTML карточек с прогрессом
            const toSave = [];
            for (let i = 0; i < tilesToSave.length; i++) {
                const tile = tilesToSave[i];
                const key = getTileKey(tile);
                const title = getTileTitle(tile);
                const price = getPrice(tile);
                const rating = getRating(tile);
                const reviews = getReviewsCount(tile);
                const delivery = getDeliveryDate(tile);
                const html = await buildNormalizedTileHtml(tile);
                toSave.push({ key, title, price, rating, reviews, delivery, html, site: window.location.hostname, savedAt: Date.now(), folders: chosenFolders });
                if (progress) {
                    const pct = Math.round((i + 1) / total * 60);
                    progress.update(pct, '⏳ Подготовка: ' + (i + 1) + ' / ' + total + ' карточек...');
                }
            }

            if (progress) progress.update(65, '⏳ Сохранение в базу...');

            let added = 0;
            try {
                // Читаем один раз — используем для addToSaved и для обновления папок
                const existingAll = await getSavedTiles();
                const existingMap = new Map(existingAll.map(t => [t.key, t])); // O(1) lookup

                const saveKeys = new Set(toSave.map(t => t.key));
                const reallyNew = toSave.filter(t => !existingMap.has(t.key));

                // Добавляем новые карточки
                const withNew = [...existingAll, ...reallyNew];
                added = reallyNew.length;

                // Обновляем папки у уже существующих карточек из toSave — за O(n), без find()
                let folderChanged = false;
                if (chosenFolders.length > 0) {
                    for (const tile of toSave) {
                        const existing = existingMap.get(tile.key);
                        if (!existing) continue; // новая — папки уже проставлены при создании
                        const merged = [...new Set([...(existing.folders || []), ...chosenFolders])];
                        if (merged.length !== (existing.folders || []).length) {
                            existing.folders = merged;
                            folderChanged = true;
                        }
                    }
                }

                // Одна запись вместо двух
                if (added > 0 || folderChanged) {
                    if (progress) progress.update(80, '⏳ Сохранение...');
                    await saveTiles(withNew);
                    reallyNew.forEach(t => savedKeysCache.add(t.key));
                    refreshSavedKeysCache();
                    window._invalidateGroupCache?.();
                }
            } catch (e) {
                progress?.remove();
                showNotification(`❌ Ошибка сохранения: ${e?.message || e}`, 'error');
                return;
            }

            selectedKeys.clear();
            updateSelectionPanel();
            renderTiles(currentTiles);

            const folderStr = chosenFolders.length ? ` → 📁 ${chosenFolders.join(', ')}` : '';
            let msg;
            if (added === 0 && chosenFolders.length === 0) {
                msg = '⚠️ Все выбранные товары уже сохранены';
            } else if (added === 0) {
                msg = '📁 Папки обновлены для ' + toSave.length + ' товаров' + folderStr;
            } else if (added < toSave.length) {
                msg = '🔖 Сохранено: ' + added + ' из ' + toSave.length + folderStr;
            } else {
                msg = '🔖 Сохранено: ' + added + ' товаров' + folderStr;
            }

            if (progress) {
                progress.update(100, msg);
                setTimeout(() => progress.remove(), 2000);
            } else {
                showNotification(msg, added === 0 && chosenFolders.length === 0 ? 'warning' : 'info');
            }
        });
    });

    uiRoot.appendChild(header);
    cardsHost.appendChild(productsContainer);
    bottomUiRoot.appendChild(selectionPanel);

    // ─── Контейнер сохранённых товаров ────────────────────────────────────────────
    // savedContainer добавляется после folderRow (ниже)

    // Панель действий для сохранённых
    const savedPanel = document.createElement('div');
    savedPanel.style.cssText = `
    display: none; padding: 8px 20px;
    background: #fff8e1; border-top: 1px solid #ffe082;
    flex-shrink: 0; flex-direction: column; gap: 6px;
`;

    // строка 1: счётчик, кнопки выделения, хранилище
    const savedPanelRow1 = document.createElement('div');
    savedPanelRow1.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';
    // строка 2: импорт/экспорт/очистка
    const savedPanelRow2 = document.createElement('div');
    savedPanelRow2.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const savedCounter = document.createElement('span');
    savedCounter.style.cssText = 'font-size:13px; color:#f57f17; font-weight:bold;';

    const storageIndicator = document.createElement('span');
    storageIndicator.className = 'storageIndicator';
    storageIndicator.style.cssText = 'font-size:12px; color:#999; margin-left: auto; cursor:help;';

    async function updateStorageIndicator() {
        // chrome.storage.local — только savedTiles
        const localUsed = await new Promise(r =>
            chrome.storage.local.getBytesInUse ? chrome.storage.local.getBytesInUse('savedTiles', r) : r(0)
        );
        const localMb = (localUsed / 1024 / 1024).toFixed(2);
        const localLimit = 10;
        const localPct = Math.round(localUsed / (localLimit * 1024 * 1024) * 100);

        // IndexedDB — картинки, размер из background (его origin)
        let imgMb = '?';
        let imgCount = '';
        try {
            const resp = await new Promise(r => chrome.runtime.sendMessage({ action: 'getStorageSize' }, r));
            if (resp?.ok) {
                imgMb = (resp.bytes / 1024 / 1024).toFixed(1);
                imgCount = ` (${resp.count} шт.)`;
            }
        } catch { }

        const color = localPct > 80 ? '#e53935' : localPct > 50 ? '#f57f17' : '#999';
        storageIndicator.style.color = color;
        storageIndicator.textContent = `💾 атрибуты: ${localMb}/${localLimit} МБ · картинки: ${imgMb} МБ${imgCount}`;
        storageIndicator.title =
            `chrome.storage.local (метаданные): ${localMb} МБ из ${localLimit} МБ (${localPct}%)\n` +
            `IndexedDB (картинки): ~${imgMb} МБ${imgCount} (лимит — десятки ГБ)`;
    }

    const clearSavedBtn = document.createElement('button');
    clearSavedBtn.textContent = '🗑 Очистить всё';
    clearSavedBtn.style.cssText = 'padding:6px 12px; background:#ff5722; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const removeSelectedSavedBtn = document.createElement('button');
    removeSelectedSavedBtn.textContent = '✕ Удалить выбранные';
    removeSelectedSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';

    const savedSelectionCounter = document.createElement('span');
    savedSelectionCounter.style.cssText = 'font-size:13px; color:#e64a19; font-weight:bold; display:none;';

    function updateSavedSelectionCounter() {
        const n = savedSelectedKeys.size;
        savedSelectionCounter.style.display = n > 0 ? 'inline' : 'none';
        savedSelectionCounter.textContent = `Выбрано: ${n}`;
        removeSelectedSavedBtn.style.display = n > 0 ? 'block' : 'none';
        invertSavedBtn.style.display = n > 0 ? 'inline-block' : 'none';
        exportSelectedBtn.style.display = n > 0 ? 'inline-block' : 'none';
        deselectSavedBtn.style.display = n > 0 ? 'inline-block' : 'none';
    }

    const invertSavedBtn = document.createElement('button');
    invertSavedBtn.textContent = '⇄ Инвертировать';
    invertSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    invertSavedBtn.addEventListener('click', () => {
        currentSavedTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (savedSelectedKeys.has(k)) savedSelectedKeys.delete(k);
            else savedSelectedKeys.add(k);
        });
        // обновляем визуал всех карточек
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const k = w.dataset.savedKey;
            const selected = savedSelectedKeys.has(k);
            const cb = w.querySelector('.saved-checkbox');
            if (cb) {
                cb.style.display = selected ? 'flex' : 'none';
                cb.style.background = selected ? '#ff5722' : 'rgba(255,255,255,0.9)';
                cb.style.borderColor = selected ? '#ff5722' : '#ccc';
                cb.textContent = selected ? '✓' : '';
            }
            w.style.outline = selected ? '2px solid #ff5722' : '';
            w.style.borderRadius = selected ? '8px' : '';
        });
        updateSavedSelectionCounter();
    });

    invertSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';

    function downloadJson(tiles, suffix = '') {
        const json = JSON.stringify(tiles, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shopping-sorter${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Экспорт с картинками: подгружает dataUrl из IndexedDB и вшивает в JSON
    // ── Прогресс-бар экспорта/импорта ─────────────────────────────────────────
    function createProgressBar(label) {
        const el = document.createElement('div');
        el.style.cssText = `
            position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
            background:#fff; border:1px solid #ddd; border-radius:10px;
            padding:14px 20px; box-shadow:0 4px 20px rgba(0,0,0,0.2);
            z-index:2147483647; min-width:300px; font-family:sans-serif;
        `;
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:13px; color:#333; margin-bottom:8px; font-weight:500;';
        lbl.textContent = label;
        const track = document.createElement('div');
        track.style.cssText = 'height:6px; background:#eee; border-radius:3px; overflow:hidden;';
        const fill = document.createElement('div');
        fill.style.cssText = 'height:100%; width:0%; background:#2196F3; border-radius:3px; transition:width 0.15s ease;';
        track.appendChild(fill);
        el.appendChild(lbl);
        el.appendChild(track);
        document.body.appendChild(el);
        return {
            update(pct, text) {
                fill.style.width = pct + '%';
                if (text) lbl.textContent = text;
            },
            remove() { el.remove(); }
        };
    }

    async function exportWithImages(tiles, suffix = '') {
        const keys = tiles.map(t => t.key).filter(Boolean);
        const total = keys.length;
        if (total === 0) { showNotification('⚠️ Нет карточек для экспорта', 'warning'); return; }

        const progress = createProgressBar(`⏳ Экспорт: загрузка картинок 0 / ${total}...`);
        const BATCH = 50; // по 50 ключей за раз — безопасный размер сообщения
        const allImages = {};

        try {
            // Батчевая загрузка картинок из IndexedDB
            for (let i = 0; i < keys.length; i += BATCH) {
                const batch = keys.slice(i, i + BATCH);
                const images = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'getImages', keys: batch }, resp => {
                        resolve(resp?.result || {});
                    });
                });
                Object.assign(allImages, images);
                const loaded = Math.min(i + BATCH, total);
                progress.update(
                    Math.round(loaded / total * 80),
                    `⏳ Экспорт: картинки ${loaded} / ${total}...`
                );
                // Даём браузеру «подышать» между батчами
                await new Promise(r => setTimeout(r, 0));
            }

            progress.update(85, '⏳ Сборка JSON...');
            await new Promise(r => setTimeout(r, 0));

            // Собираем итоговый массив
            const withImages = tiles.map(t => ({
                ...t,
                imageDataUrl: allImages[t.key]?.dataUrl || null,
            }));

            progress.update(90, '⏳ Создание файла...');
            await new Promise(r => setTimeout(r, 0));

            // JSON.stringify может заморозить поток на секунду при 100+ МБ
            // Делаем построчно чтобы не блокировать
            const jsonStr = JSON.stringify(withImages, null, 2);

            progress.update(97, '⏳ Сохранение...');
            await new Promise(r => setTimeout(r, 0));

            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `shopping-sorter${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            progress.update(100, `✅ Экспортировано ${total} карточек`);
            setTimeout(() => progress.remove(), 2000);
        } catch (e) {
            progress.remove();
            showNotification('❌ Ошибка экспорта: ' + e.message, 'error');
        }
    }

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬆ Экспорт всех';
    exportBtn.title = 'Сохранить все карточки в JSON-файл (с изображениями)';
    exportBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    exportBtn.addEventListener('click', async () => {
        const saved = await getSavedTiles();
        if (!saved.length) { showNotification('⚠️ Нет сохранённых товаров', 'warning'); return; }
        await exportWithImages(saved);
    });

    const exportSelectedBtn = document.createElement('button');
    exportSelectedBtn.textContent = '⬆ Экспорт выбранных';
    exportSelectedBtn.title = 'Сохранить выбранные карточки в JSON-файл (с изображениями)';
    exportSelectedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';
    exportSelectedBtn.addEventListener('click', async () => {
        if (!savedSelectedKeys.size) { showNotification('⚠️ Ничего не выбрано', 'warning'); return; }
        const saved = await getSavedTiles();
        const selected = saved.filter(t => savedSelectedKeys.has(t.key));
        await exportWithImages(selected, '-selected');
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', async () => {
        const file = importInput.files[0];
        if (!file) return;
        importInput.value = '';
        let progress = null;
        try {
            progress = createProgressBar('⏳ Импорт: чтение файла...');
            const text = await file.text();

            progress.update(10, '⏳ Импорт: разбор JSON...');
            await new Promise(r => setTimeout(r, 0));

            const items = JSON.parse(text);
            if (!Array.isArray(items)) throw new Error('Неверный формат — ожидается массив');
            const valid = items.filter(t => t.key && t.html);
            if (!valid.length) throw new Error('Нет валидных карточек (нужны поля key и html)');

            // Отделяем картинки от метаданных —
            // imageDataUrl НЕ должны попадать в chrome.storage.local (лимит ~5МБ)
            const withImg = valid.filter(t => t.imageDataUrl);
            const metaOnly = valid.map(({ imageDataUrl, ...rest }) => rest);

            progress.update(20, `⏳ Импорт: сохранение ${valid.length} карточек...`);
            await new Promise(r => setTimeout(r, 0));
            const added = await addToSaved(metaOnly);

            // Восстанавливаем картинки в IndexedDB батчами с ожиданием ответа
            if (withImg.length > 0) {
                const IMG_BATCH = 20;
                for (let i = 0; i < withImg.length; i += IMG_BATCH) {
                    const batch = withImg.slice(i, i + IMG_BATCH);
                    await Promise.all(batch.map(item => new Promise(resolve => {
                        chrome.runtime.sendMessage(
                            { action: 'setImage', key: item.key, dataUrl: item.imageDataUrl, force: false },
                            resp => resolve(resp)
                        );
                    })));
                    const done = Math.min(i + IMG_BATCH, withImg.length);
                    progress.update(
                        20 + Math.round(done / withImg.length * 70),
                        `⏳ Импорт: картинки ${done} / ${withImg.length}...`
                    );
                    await new Promise(r => setTimeout(r, 20));
                }
            }

            progress.update(100, `✅ Импортировано: ${added} новых, ${valid.length - added} уже были`);
            setTimeout(() => progress.remove(), 2500);
            switchTab('saved');

            // Подгружаем картинки из текущей страницы для карточек без imageDataUrl
            valid.forEach(async item => {
                const liveTile = seenTiles.get(item.key);
                if (!liveTile) return;
                const imgEl = getBestProductImage(liveTile);
                const src = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
                if (!src) return;
                await saveImageToBackground(item.key, src, true);
                const tileEl = savedContainer.querySelector(`.ss-tile[data-ss-key="${CSS.escape(item.key)}"]`);
                if (!tileEl) return;
                const imgData = await new Promise(r =>
                    chrome.runtime.sendMessage({ action: 'getImages', keys: [item.key] }, resp => r(resp?.result?.[item.key]))
                );
                if (imgData?.dataUrl) {
                    const wrap = tileEl.querySelector('.ss-tile__img-wrap');
                    if (wrap) wrap.innerHTML = `<img src="${imgData.dataUrl}" alt="" loading="lazy">`;
                }
            });

        } catch (e) {
            progress?.remove();
            showNotification(`❌ Ошибка импорта: ${e.message}`, 'error');
            console.error('[import]', e);
        }
    });

    const importBtn = document.createElement('button');
    importBtn.textContent = '⬇ Импорт';
    importBtn.title = 'Загрузить карточки из JSON-файла';
    importBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    importBtn.addEventListener('click', () => importInput.click());

    const deselectSavedBtn = document.createElement('button');
    deselectSavedBtn.textContent = '✕ Снять';
    deselectSavedBtn.title = 'Снять выделение';
    deselectSavedBtn.style.cssText = 'padding:5px 10px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';
    deselectSavedBtn.addEventListener('click', () => {
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const cb = w.querySelector('.saved-checkbox');
            if (cb) { cb.style.display = 'none'; cb.textContent = ''; cb.style.background = 'rgba(255,255,255,0.9)'; cb.style.borderColor = '#ccc'; }
            w.style.outline = '';
        });
        updateSavedSelectionCounter();
    });

    const selectAllSavedBtn = document.createElement('button');
    selectAllSavedBtn.textContent = '☑ Все';
    selectAllSavedBtn.title = 'Выбрать все карточки';
    selectAllSavedBtn.style.cssText = 'padding:5px 10px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    selectAllSavedBtn.addEventListener('click', () => {
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const k = w.dataset.savedKey;
            if (k) savedSelectedKeys.add(k);
            const cb = w.querySelector('.saved-checkbox');
            if (cb) { cb.style.display = 'flex'; cb.style.background = '#ff5722'; cb.style.borderColor = '#ff5722'; cb.textContent = '✓'; }
            w.style.outline = '2px solid #ff5722';
            w.style.borderRadius = '8px';
        });
        updateSavedSelectionCounter();
    });

    // строка 1: выделение
    savedPanelRow1.appendChild(selectAllSavedBtn);
    savedPanelRow1.appendChild(savedSelectionCounter);
    savedPanelRow1.appendChild(deselectSavedBtn);
    savedPanelRow1.appendChild(invertSavedBtn);
    savedPanelRow1.appendChild(removeSelectedSavedBtn);
    savedPanelRow1.appendChild(exportSelectedBtn);

    // строка 2: импорт/экспорт/очистка + счётчик и хранилище прижаты вправо
    savedPanelRow2.appendChild(exportBtn);
    savedPanelRow2.appendChild(importBtn);
    savedPanelRow2.appendChild(importInput);
    savedPanelRow2.appendChild(clearSavedBtn);
    savedCounter.style.marginLeft = 'auto';
    savedPanelRow2.appendChild(savedCounter);
    savedPanelRow2.appendChild(storageIndicator);

    savedPanel.appendChild(savedPanelRow1);
    savedPanel.appendChild(savedPanelRow2);
    const folderRow = document.createElement('div');
    folderRow.style.cssText = `
        display: none; flex-direction: column; gap: 6px; padding: 6px 20px;
        background: #f5f5f5; border-bottom: 1px solid #e0e0e0;
        flex-shrink: 0;
    `;

    let activeFolderFilter = null; // null = все
    let folderSearchQuery = '';

    function getAllFolders(tiles) {
        const set = new Set();
        tiles.forEach(t => (t.folders || []).forEach(f => set.add(f)));
        return [...set].sort();
    }

    function renderFolderRow(tiles) {
        folderRow.innerHTML = '';
        const folders = getAllFolders(tiles);
        // сбрасываем фильтр если папка исчезла
        if (activeFolderFilter && !folders.includes(activeFolderFilter)) {
            activeFolderFilter = null;
        }
        if (!folders.length) { folderRow.style.display = 'none'; return; }
        folderRow.style.display = 'flex';

        // верхняя строка: поиск (если папок много) + кнопка управления — всегда на виду, не скроллится
        const topBar = document.createElement('div');
        topBar.style.cssText = 'display:flex; align-items:center; gap:6px;';

        let searchInput = null;
        if (folders.length > 6) {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '🔍 Поиск папки...';
            searchInput.value = folderSearchQuery;
            searchInput.style.cssText = 'flex:1; min-width:0; padding:5px 10px; border:1px solid #ddd; border-radius:14px; font-size:12px; outline:none; background:#fff;';
            searchInput.addEventListener('input', () => {
                folderSearchQuery = searchInput.value;
                renderPills();
            });
            topBar.appendChild(searchInput);
        }

        // кнопка управления папками
        const manageFoldersBtn = document.createElement('button');
        manageFoldersBtn.textContent = '✏️';
        manageFoldersBtn.title = 'Управление папками (переименование, удаление)';
        manageFoldersBtn.style.cssText = `padding:4px 8px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; margin-left:${searchInput ? '0' : 'auto'}; background:#fff; flex-shrink:0;`;
        manageFoldersBtn.addEventListener('click', e => { e.stopPropagation(); showManageFoldersMenu(manageFoldersBtn, folders); });
        topBar.appendChild(manageFoldersBtn);

        folderRow.appendChild(topBar);

        // прокручиваемая область с папками
        const pillsWrap = document.createElement('div');
        pillsWrap.style.cssText = `display:flex; gap:6px; align-items:center; flex-wrap:wrap;
            max-height:76px; overflow-y:auto; padding-right:2px;`;
        folderRow.appendChild(pillsWrap);

        function renderPills() {
            pillsWrap.innerHTML = '';
            const q = folderSearchQuery.trim().toLowerCase();

            if (!q) {
                const allBtn = document.createElement('button');
                allBtn.textContent = '📂 Все';
                allBtn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${activeFolderFilter === null ? '#2196F3' : '#fff'}; color:${activeFolderFilter === null ? '#fff' : '#444'};`;
                allBtn.addEventListener('click', () => { activeFolderFilter = null; invalidateGroupCache(); renderSavedTiles(); });
                pillsWrap.appendChild(allBtn);
            }

            const filtered = q ? folders.filter(f => f.toLowerCase().includes(q)) : folders;
            filtered.forEach(f => {
                const btn = document.createElement('button');
                btn.textContent = `📁 ${f}`;
                btn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${activeFolderFilter === f ? '#2196F3' : '#fff'}; color:${activeFolderFilter === f ? '#fff' : '#444'};`;
                btn.addEventListener('click', () => { activeFolderFilter = f; invalidateGroupCache(); renderSavedTiles(); });
                pillsWrap.appendChild(btn);
            });

            if (q && !filtered.length) {
                const empty = document.createElement('span');
                empty.textContent = 'Ничего не найдено';
                empty.style.cssText = 'font-size:12px; color:#999; padding:4px 2px;';
                pillsWrap.appendChild(empty);
            }
        }
        renderPills();
    }

    function showManageFoldersMenu(anchorBtn, folders) {
        uiRoot.querySelector('#ss-manage-folders-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'ss-manage-folders-menu';
        menu.style.cssText = `
            position:fixed; z-index:100010; background:#fff;
            border:1px solid #ddd; border-radius:8px; padding:8px;
            box-shadow:0 4px 16px rgba(0,0,0,0.2); width:260px; max-width:calc(100vw - 16px);
            font-size:13px; box-sizing:border-box;
        `;

        const title = document.createElement('div');
        title.textContent = 'Управление папками';
        title.style.cssText = 'font-weight:bold; padding:2px 6px 8px; border-bottom:1px solid #eee; margin-bottom:6px;';
        menu.appendChild(title);

        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = '🔍 Поиск папки...';
        search.autocomplete = 'off';
        search.style.cssText = 'width:100%; box-sizing:border-box; padding:6px 9px; border:1px solid #ddd; border-radius:6px; font-size:12px; outline:none; margin-bottom:6px;';
        menu.appendChild(search);

        const listWrap = document.createElement('div');
        listWrap.style.cssText = 'max-height:300px; overflow-y:auto; overflow-x:hidden; padding-right:2px; display:flex; flex-direction:column; gap:2px;';
        menu.appendChild(listWrap);

        const selectedFolders = new Set();
        const rows = [];
        let deleteSelBtn = null;
        let mergeSelBtn = null;

        const updateActionButtons = () => {
            if (deleteSelBtn) deleteSelBtn.style.display = selectedFolders.size > 0 ? 'block' : 'none';
            if (mergeSelBtn) mergeSelBtn.style.display = selectedFolders.size >= 2 ? 'block' : 'none';
        };

        folders.forEach(f => {
            const row = document.createElement('div');
            row.dataset.folderName = f.toLowerCase();
            row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; min-height:28px;';
            row.addEventListener('mouseenter', () => row.style.background = '#f5f5f5');
            row.addEventListener('mouseleave', () => row.style.background = '');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.style.cursor = 'pointer';
            cb.addEventListener('change', () => {
                if (cb.checked) selectedFolders.add(f); else selectedFolders.delete(f);
                updateActionButtons();
            });

            const nameSpan = document.createElement('span');
            nameSpan.textContent = f;
            nameSpan.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

            const renameBtn = document.createElement('button');
            renameBtn.textContent = '✏️';
            renameBtn.title = 'Переименовать';
            renameBtn.style.cssText = 'padding:2px 5px; border:1px solid #ddd; border-radius:4px; cursor:pointer; font-size:11px; background:#fff; flex-shrink:0;';
            renameBtn.addEventListener('click', async e => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = f;
                input.style.cssText = 'flex:1; min-width:0; padding:2px 4px; border:1px solid #2196F3; border-radius:4px; font-size:12px; outline:none;';
                row.replaceChild(input, nameSpan);
                renameBtn.textContent = '✓';
                input.focus();
                input.select();

                const doRename = async () => {
                    const newName = input.value.trim();
                    if (!newName || newName === f) { row.replaceChild(nameSpan, input); renameBtn.textContent = '✏️'; return; }
                    const tiles = await getSavedTiles();
                    const updated = tiles.map(t => ({
                        ...t,
                        folders: (t.folders || []).map(fn => fn === f ? newName : fn)
                    }));
                    await saveTiles(updated);
                    if (activeFolderFilter === f) activeFolderFilter = newName;
                    menu.remove();
                    renderSavedTiles();
                };
                renameBtn.addEventListener('click', doRename, { once: true });
                input.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') { row.replaceChild(nameSpan, input); renameBtn.textContent = '✏️'; } });
            });

            row.appendChild(cb);
            row.appendChild(nameSpan);
            row.appendChild(renameBtn);
            listWrap.appendChild(row);
            rows.push(row);
        });

        const empty = document.createElement('div');
        empty.textContent = 'Ничего не найдено';
        empty.style.cssText = 'display:none; font-size:12px; color:#999; padding:6px 4px;';
        listWrap.appendChild(empty);

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            let visible = 0;
            rows.forEach(row => {
                const show = !q || row.dataset.folderName.includes(q);
                row.style.display = show ? 'flex' : 'none';
                if (show) visible++;
            });
            empty.style.display = visible ? 'none' : 'block';
        });

        // Действия вынесены за пределы прокручиваемого списка, поэтому
        // «Удалить» и «Объединить» всегда остаются доступны.
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:6px; padding-top:6px; border-top:1px solid #eee;';
        menu.appendChild(actions);

        mergeSelBtn = document.createElement('button');
        mergeSelBtn.textContent = '🗂 Объединить выбранные...';
        mergeSelBtn.style.cssText = 'display:none; width:100%; padding:6px; border:1px solid #b3e5fc; border-radius:4px; cursor:pointer; background:#e1f5fe; color:#01579B; font-size:12px;';
        mergeSelBtn.addEventListener('click', async () => {
            if (selectedFolders.size < 2) { alert('Выберите хотя бы 2 папки для объединения'); return; }
            const folderList = [...selectedFolders].join(', ');
            const targetName = prompt(`Объединить папки:\n${folderList}\n\nНазвание итоговой папки:`, [...selectedFolders][0]);
            if (!targetName?.trim()) return;
            const target = targetName.trim();
            const deleteSource = confirm(`Удалить исходные папки после объединения?\n(Карточки перейдут в «${target}»)`);
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => {
                const oldFolders = t.folders || [];
                const inSelected = oldFolders.some(f => selectedFolders.has(f));
                if (!inSelected) return t;
                let newFolders = deleteSource
                    ? oldFolders.filter(f => !selectedFolders.has(f))
                    : [...oldFolders];
                if (!newFolders.includes(target)) newFolders.push(target);
                return { ...t, folders: newFolders };
            });
            await saveTiles(updated);
            if (selectedFolders.has(activeFolderFilter)) activeFolderFilter = target;
            menu.remove();
            renderSavedTiles();
        });
        actions.appendChild(mergeSelBtn);

        deleteSelBtn = document.createElement('button');
        deleteSelBtn.textContent = '🗑 Удалить выбранные папки';
        deleteSelBtn.style.cssText = 'display:none; width:100%; padding:6px; border:1px solid #ffcdd2; border-radius:4px; cursor:pointer; background:#fff8f8; color:#c62828; font-size:12px;';
        deleteSelBtn.addEventListener('click', async () => {
            if (!confirm(`Удалить папки: ${[...selectedFolders].join(', ')}?\nКарточки останутся, только уберутся из этих папок.`)) return;
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => ({
                ...t,
                folders: (t.folders || []).filter(f => !selectedFolders.has(f))
            }));
            await saveTiles(updated);
            if (selectedFolders.has(activeFolderFilter)) activeFolderFilter = null;
            menu.remove();
            renderSavedTiles();
        });
        actions.appendChild(deleteSelBtn);

        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = Math.max(8, document.documentElement.clientWidth - rect.right) + 'px';
        document.body.appendChild(menu);
        search.focus();

        const closeHandler = e => {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    uiRoot.appendChild(folderRow);
    cardsHost.appendChild(savedContainer);
    bottomUiRoot.appendChild(savedPanel);
    const savedSelectedKeys = new Set();

    function showFolderMenu(anchorBtn, tileKey, savedItem, allSaved) {
        uiRoot.querySelector('#ss-folder-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'ss-folder-menu';
        menu.style.cssText = `
            position:absolute; z-index:100001; background:#fff;
            border:1px solid #ddd; border-radius:8px; padding:8px;
            box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:200px;
            font-size:13px;
        `;

        // Определяем какие ключи затронуты: выделенные или только эта карточка
        const targetKeys = savedSelectedKeys.size > 0
            ? [...savedSelectedKeys]
            : [tileKey];
        const isMulti = targetKeys.length > 1;

        if (isMulti) {
            const hint = document.createElement('div');
            hint.textContent = `Выбрано: ${targetKeys.length} карточек`;
            hint.style.cssText = 'font-size:11px; color:#888; padding:2px 6px 6px; border-bottom:1px solid #eee; margin-bottom:4px;';
            menu.appendChild(hint);
        }

        const currentFolders = new Set(savedItem.folders || []);
        const allFolders = getAllFolders(allSaved);

        // кнопка «удалить из текущей папки» — только если активна папка
        if (activeFolderFilter) {
            const removeFromFolderBtn = document.createElement('button');
            removeFromFolderBtn.textContent = `📤 Убрать из «${activeFolderFilter}»`;
            removeFromFolderBtn.style.cssText = 'display:block;width:100%;margin-bottom:6px;padding:6px;border:1px solid #ffe0b2;border-radius:4px;cursor:pointer;text-align:left;background:#fff8f3;color:#e65100;';
            removeFromFolderBtn.addEventListener('click', async () => {
                menu.remove();
                const tiles = await getSavedTiles();
                const updated = tiles.map(t => {
                    if (!targetKeys.includes(t.key)) return t;
                    return { ...t, folders: (t.folders || []).filter(f => f !== activeFolderFilter) };
                });
                await saveTiles(updated);
                // если папка опустела — сбрасываем фильтр
                const remaining = updated.filter(t => (t.folders || []).includes(activeFolderFilter));
                if (remaining.length === 0) activeFolderFilter = null;
                renderSavedTiles();
            });
            menu.appendChild(removeFromFolderBtn);
        }

        // существующие папки с чекбоксами
        if (allFolders.length > 0) {
            const folderLabel = document.createElement('div');
            folderLabel.textContent = 'Папки:';
            folderLabel.style.cssText = 'font-size:11px; color:#888; padding:2px 6px 4px;';
            menu.appendChild(folderLabel);

            allFolders.forEach(f => {
                const row = document.createElement('label');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 6px; cursor:pointer; border-radius:4px;';
                row.addEventListener('mouseenter', () => row.style.background = '#f5f5f5');
                row.addEventListener('mouseleave', () => row.style.background = '');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                // для мульти — checked если ВСЕ выбранные в этой папке
                if (isMulti) {
                    const inFolder = targetKeys.filter(k => (allSaved.find(s => s.key === k)?.folders || []).includes(f));
                    cb.checked = inFolder.length === targetKeys.length;
                    cb.indeterminate = inFolder.length > 0 && inFolder.length < targetKeys.length;
                } else {
                    cb.checked = currentFolders.has(f);
                }
                cb.addEventListener('change', async () => {
                    const tiles = await getSavedTiles();
                    const updated = tiles.map(t => {
                        if (!targetKeys.includes(t.key)) return t;
                        const folders = new Set(t.folders || []);
                        if (cb.checked) folders.add(f); else folders.delete(f);
                        return { ...t, folders: [...folders] };
                    });
                    await saveTiles(updated);
                    renderSavedTiles();
                });
                row.appendChild(cb);
                row.appendChild(document.createTextNode(f));
                menu.appendChild(row);
            });
        }

        // новая папка
        const newRow = document.createElement('div');
        newRow.style.cssText = 'display:flex; gap:4px; margin-top:6px; padding-top:6px; border-top:1px solid #eee;';
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.placeholder = 'Новая папка...';
        newInput.style.cssText = 'flex:1; padding:4px 6px; border:1px solid #ddd; border-radius:4px; font-size:12px;';
        const addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.style.cssText = 'padding:4px 8px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer;';
        addBtn.addEventListener('click', async () => {
            const name = newInput.value.trim();
            if (!name) return;
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => {
                if (!targetKeys.includes(t.key)) return t;
                const folders = new Set(t.folders || []);
                folders.add(name);
                return { ...t, folders: [...folders] };
            });
            await saveTiles(updated);
            menu.remove();
            renderSavedTiles();
        });
        newInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
        newRow.appendChild(newInput);
        newRow.appendChild(addBtn);
        menu.appendChild(newRow);

        // позиционируем около кнопки
        const rect = anchorBtn.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        menu.style.top = (rect.bottom - popupRect.top + popup.scrollTop + 4) + 'px';
        menu.style.left = (rect.left - popupRect.left) + 'px';

        popup.style.position = 'relative';
        uiRoot.appendChild(menu);
        newInput.focus();
        // закрываем только при клике ВНЕ меню
        const closeHandler = e => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }


    async function updateTileFolders(key, folders) {
        const tiles = await getSavedTiles();
        const updated = tiles.map(t => t.key === key ? { ...t, folders } : t);
        await saveTiles(updated);
    }

    async function renderSavedTiles() {
        // Отключаем предыдущий observer картинок если есть
        savedContainer._imgObserver?.disconnect();
        savedContainer._imgObserver = null;
        savedContainer.innerHTML = '';
        // высота ячейки = картинка + текстовая область (масштабируется вместе с размером карточек)
        const imgH = Math.round(cardScale * 0.9);
        // при группировке grid-auto-rows убирается в renderSavedClusters чтобы разделители не растягивались
        if (!groupingActive) savedContainer.style.gridAutoRows = `${imgH + getSavedTileBodyHeight(cardScale)}px`;
        const saved = await getSavedTiles();

        savedCounter.textContent = `Сохранено: ${saved.length} товаров`;
        savedPanel.style.display = 'flex';
        updateSavedSelectionCounter();
        updateStorageIndicator();
        renderFolderRow(saved);

        // фильтруем по активной папке
        const visibleSaved = activeFolderFilter === null
            ? saved
            : saved.filter(t => (t.folders || []).includes(activeFolderFilter));

        if (saved.length === 0) {
            savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">Нет сохранённых товаров</div>';
            return;
        }
        if (visibleSaved.length === 0) {
            savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">В этой папке нет товаров</div>';
            return;
        }

        // Парсим HTML обратно в DOM-элементы
        const savedTileMap = new Map();
        visibleSaved.forEach(item => {
            const tmp = document.createElement('div');
            tmp.innerHTML = item.html;
            const el = tmp.firstElementChild;
            if (el) savedTileMap.set(item.key, el);
        });

        // Применяем те же фильтры и сортировку через getFilteredAndSorted
        // но на основе savedTileMap вместо seenTiles
        const originalSeenTiles = seenTiles;
        // Временно подменяем seenTiles
        seenTiles.clear();
        savedTileMap.forEach((tile, key) => seenTiles.set(key, tile));

        let tiles = getFilteredAndSorted(searchInput.value);

        // Восстанавливаем seenTiles
        seenTiles.clear();
        originalSeenTiles.forEach((tile, key) => seenTiles.set(key, tile));

        updateTypeCounts([...savedTileMap.values()]);
        updatePricePlaceholders([...savedTileMap.values()]);
        updateDebugVisibility();
        const counterMode = getCounterSortMode(searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        renderCounterLabel(tiles.length, savedTileMap.size, counterMode, arrow);

        currentSavedTiles = tiles;

        const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

        async function renderSavedTilesList(orderedTiles, groupColorMap, groupLabel) {
            const tileH = groupingActive ? `${Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale)}px` : '100%';
            orderedTiles.forEach((tile, tileIndex) => {
                const groupColor = groupColorMap?.get(getTileKey(tile)) || null;
                const tileKey = getTileKey(tile);
                const savedItem = visibleSaved.find(s => s.key === tileKey) || saved.find(s => s.key === tileKey) || {};
                const wrap = document.createElement('div');
                wrap.style.cssText = `position:relative; display:flex; flex-direction:column; height:${tileH};`;
                wrap.dataset.savedKey = tileKey;
                const tileUrl = tile.dataset?.ssUrl || savedItem.url || '';
                wrap.dataset.tileUrl = tileUrl;


                const clone = tile.cloneNode(true);

                // ppg-badge — учитывает все настроенные дополнительные величины.
                const ppgInfo = getPpgBadgeInfo(tile);
                const ppg = getPricePerUnit(tile);
                if (ppgInfo) {
                    const badge = document.createElement('div');
                    badge.className = 'ppg-badge';
                    badge.innerHTML = ppgInfo.lines.map((line, i) => i === 0
                        ? line
                        : `<span style="font-weight:normal;font-size:10px;opacity:0.85">${line}</span>`).join('\n');
                    badge.style.whiteSpace = 'normal';
                    badge.title = ppgInfo.multi ? 'Рассчитано по нескольким дополнительным величинам' : '';
                    applyPpgBadgeSettings(badge);
                    wrap.appendChild(badge);
                }

                // ppg-debug
                {
                    const debugBadge = document.createElement('div');
                    debugBadge.className = 'ppg-debug';
                    const safePpg = (ppg && typeof ppg === 'object') ? ppg : { value: null, category: '???', base: '???' };
                    const currency = detectCurrency?.() ?? '';
                    const price = getPrice?.(tile) ?? '';
                    const base = safePpg.base ?? '???';
                    const value = typeof safePpg.value === 'number' ? safePpg.value.toFixed(2) : '';
                    const priceLabel = base ? `${currency}/${base}` : '';
                    const result = parseUnit?.(getTileTitle?.(tile));
                    let weightLabel = '';
                    if (result && typeof result.value === 'number') {
                        if (result.value >= 1000 && base === 'г') weightLabel = fmtUnit(result.value / 1000) + ' кг';
                        else if (result.value >= 1000 && base === 'мл') weightLabel = fmtUnit(result.value / 1000) + ' л';
                        else weightLabel = result.value + ' ' + base;
                    }
                    const syncedStr = savedItem.syncedAt
                        ? (() => { const d = new Date(savedItem.syncedAt); return `🔄 ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`; })()
                        : '';
                    const reviewsCount = getReviewsCount(tile);
                    const ratingVal = getRating(tile);
                    const deliveryDate = formatDateToString(getDeliveryDate(tile));
                    debugBadge.innerHTML =
                        `цена1: ${value} ${priceLabel}` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">вес: ${weightLabel ?? '???'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">цена2: ${price}&nbsp;</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">отзывы: ${reviewsCount ?? '—'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">рейтинг: ${ratingVal ?? '—'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">доставка: ${deliveryDate ?? '—'}</span>` +
                        (syncedStr ? `\n<span class="sync-line" style="font-size:9px;opacity:0.8">${syncedStr}</span>` : '');
                    debugBadge.style.whiteSpace = 'pre';
                    wrap.appendChild(debugBadge);
                }

                const checkbox = document.createElement('div');
                checkbox.className = 'saved-checkbox';
                checkbox.style.cssText = `
            position: absolute; bottom: 8px; right: 8px; z-index: 20;
            width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
            background: ${savedSelectedKeys.has(tileKey) ? '#ff5722' : 'rgba(255,255,255,0.9)'};
            border: 2px solid ${savedSelectedKeys.has(tileKey) ? '#ff5722' : '#ccc'};
            align-items: center; justify-content: center;
            font-size: 12px; color: white; font-weight: bold; transition: all 0.15s;
            display: ${savedSelectedKeys.has(tileKey) ? 'flex' : 'none'};
        `;
                checkbox.textContent = savedSelectedKeys.has(tileKey) ? '✓' : '';

                if (savedSelectedKeys.has(tileKey)) {
                    wrap.style.outline = '2px solid #ff5722';
                    wrap.style.borderRadius = '8px';
                }

                wrap.addEventListener('mouseenter', () => { checkbox.style.display = 'flex'; });
                wrap.addEventListener('mouseleave', () => {
                    if (!savedSelectedKeys.has(tileKey)) checkbox.style.display = 'none';
                });
                wrap.addEventListener('click', (e) => {
                    if (e.target.closest('a')) return; // не перехватываем клики по ссылкам
                    if (!e.ctrlKey && !e.shiftKey && e.target !== checkbox) return;
                    e.preventDefault();

                    if (e.shiftKey && lastSavedSelectedKey) {
                        // Диапазон по реальному DOM-порядку — работает и в режиме похожих
                        const allWraps = [...savedContainer.querySelectorAll('[data-saved-key]')];
                        const allKeys = allWraps.map(w => w.dataset.savedKey);
                        const fromIdx = allKeys.indexOf(lastSavedSelectedKey);
                        const toIdx = allKeys.indexOf(tileKey);
                        if (fromIdx !== -1 && toIdx !== -1) {
                            const lo = Math.min(fromIdx, toIdx);
                            const hi = Math.max(fromIdx, toIdx);
                            for (let i = lo; i <= hi; i++) {
                                if (allKeys[i]) savedSelectedKeys.add(allKeys[i]);
                            }
                        }
                    } else {
                        if (savedSelectedKeys.has(tileKey)) {
                            savedSelectedKeys.delete(tileKey);
                        } else {
                            savedSelectedKeys.add(tileKey);
                        }
                        lastSavedSelectedIndex = tileIndex;
                        lastSavedSelectedKey = tileKey;
                    }

                    // обновляем визуал всех затронутых карточек без ребилда DOM
                    savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
                        const k = w.dataset.savedKey;
                        const selected = savedSelectedKeys.has(k);
                        const cb = w.querySelector('.saved-checkbox');
                        if (cb) {
                            cb.style.display = selected ? 'flex' : 'none';
                            cb.style.background = selected ? '#ff5722' : 'rgba(255,255,255,0.9)';
                            cb.style.borderColor = selected ? '#ff5722' : '#ccc';
                            cb.textContent = selected ? '✓' : '';
                        }
                        w.style.outline = selected ? '2px solid #ff5722' : '';
                        w.style.borderRadius = selected ? '8px' : '';
                    });

                    // обновляем панель кнопок
                    updateSavedSelectionCounter();
                });

                const fullTitle = getTileTitle(tile);
                if (fullTitle) wrap.setAttribute('data-tooltip', fullTitle);

                // кликабельная ссылка на картинку с абсолютным URL
                const ssUrl = clone.dataset.ssUrl;
                const imgEl = clone.querySelector('img');
                if (ssUrl && imgEl) {
                    const a = document.createElement('a');
                    a.href = ssUrl;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.style.cssText = 'display:block; pointer-events: auto !important;';
                    imgEl.parentNode.insertBefore(a, imgEl);
                    a.appendChild(imgEl);
                }

                // ссылка на заголовке
                if (ssUrl) {
                    const titleEl = clone.querySelector('.ss-tile__title');
                    if (titleEl && !titleEl.querySelector('a')) {
                        const a = document.createElement('a');
                        a.href = ssUrl;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.style.cssText = 'color:inherit; text-decoration:none;';
                        a.textContent = titleEl.textContent;
                        titleEl.textContent = '';
                        titleEl.appendChild(a);
                    }
                }

                wrap.appendChild(clone);

                // значок 🔍 если карточка найдена в текущем поиске — добавляем внутрь ss-tile
                if (seenTiles.has(tileKey)) {
                    const searchBadge = document.createElement('div');
                    searchBadge.className = 'ss-search-indicator';
                    searchBadge.textContent = '🔍';
                    searchBadge.style.cssText = `
                    position:absolute; top:6px; right:6px; z-index:25;
                    background:#2196F3; color:white; border-radius:50%;
                    width:22px; height:22px; display:flex; align-items:center;
                    justify-content:center; font-size:12px;
                    box-shadow:0 1px 4px rgba(0,0,0,0.3); pointer-events:none;
                `;
                    clone.appendChild(searchBadge);
                } else {
                }
                const itemFolders = savedItem.folders || [];
                const folderBtn = document.createElement('button');
                folderBtn.textContent = itemFolders.length ? '📁' : '📂';
                folderBtn.title = itemFolders.length ? `Папки: ${itemFolders.join(', ')}` : 'Добавить в папку';
                folderBtn.style.cssText = `
                position:absolute; top:8px; left:8px; z-index:20;
                padding:2px 6px; font-size:13px; border-radius:6px; cursor:pointer;
                background:rgba(255,255,255,0.9); border:1px solid #ddd;
                display:none; transition:all 0.15s;
            `;
                folderBtn.addEventListener('click', async e => {
                    e.stopPropagation();
                    showFolderMenu(folderBtn, tileKey, savedItem, saved);
                });
                wrap.addEventListener('mouseenter', () => { folderBtn.style.display = 'block'; });
                wrap.addEventListener('mouseleave', () => { folderBtn.style.display = 'none'; });

                wrap.appendChild(checkbox);
                wrap.appendChild(folderBtn);
                if (groupColor) wrap.style.outline = `2px solid ${groupColor}`;
                // Разделитель группы на первой карточке (слева, абсолютный)
                if (groupingActive && tileIndex === 0 && groupLabel) {
                    const lbl = groupLabel;
                    const gc = groupColor || '#f5f5f5';
                    const isRef = lbl.startsWith('🖼');
                    const isSolo = lbl.startsWith('Разные') || lbl.startsWith('Не распознан');
                    // Зазор слева чтобы разделитель не наслаивался на предыдущую группу
                    wrap.style.marginLeft = '11px';
                    const badge = document.createElement('div');
                    badge.style.cssText = `
                    position:absolute; left:0; top:0; z-index:10;
                    height:100%; width:22px;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#e8e8e8' : gc};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#bbb' : 'rgba(0,0,0,.12)')}; 
                    border-radius:8px;
                    font-size:9px; font-weight:bold; padding:4px 3px;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:translateX(-100%) rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    pointer-events:none;
                `;
                    badge.textContent = lbl;
                    wrap.appendChild(badge);
                }
                savedContainer.appendChild(wrap);
            }); // end orderedTiles.forEach
        } // end renderSavedTilesList

        if (groupingActive) {
            // Фильтруем тайлы внутри групп через getFilteredAndSorted с sourceTiles —
            // без подмены seenTiles, безопасно для параллельных вкладок
            function filterCluster(clusterTiles) {
                return getFilteredAndSorted(searchInput.value, clusterTiles);
            }
            function savedTileMatchesSearch(tile) {
                return filterCluster([tile]).length > 0;
            }

            function makeSep(text, color, isSolo, isRef) {
                const sep = document.createElement('div');
                const isFlow = groupLayout === 'flow';
                if (isFlow) {
                    sep.style.cssText = `width:100%; display:flex; align-items:center; gap:8px; padding:3px 8px;
                        background:${isSolo ? '#f5f5f5' : color}; border-radius:5px; font-size:11px;
                        color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                        ${isRef ? 'border:1px solid #2980b9;' : ''}
                        ${isSolo ? 'margin-top:4px;' : ''}
                        flex-shrink:0; margin-bottom:2px; white-space:nowrap;`;
                } else {
                    sep.style.cssText = `grid-column:1/-1; align-self:start; height:auto;
                        display:flex; align-items:center; gap:8px; padding:4px 8px;
                        background:${isSolo ? '#f5f5f5' : color}; border-radius:6px;
                        font-size:12px; color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                        ${isRef ? 'border:1px solid #2980b9;' : ''}
                        ${isSolo ? 'border-top:2px solid #ddd; margin-top:4px;' : ''}`;
                }
                sep.textContent = text;
                return sep;
            }

            // создаёт разделитель-карточку для flow-режима (вписывается в грид как обычная карточка)
            function makeFlowDividerCard(text, color, isSolo, isRef) {
                const card = document.createElement('div');
                const tileH = Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale);
                card.style.cssText = `
                    height:${tileH}px; width:fit-content; min-width:28px;
                    justify-self:end;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#f5f5f5' : color};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#ddd' : color)};
                    border-radius:10px; font-size:10px; font-weight:bold;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    padding:8px 6px; line-height:1.4;
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
                card.textContent = text;
                return card;
            }

            function renderSavedClusters(clusters, preloadedImages) {
                const isFlow = groupLayout === 'flow';
                // Очищаем контейнер (убираем прогресс-блок и старые карточки)
                savedContainer._imgObserver?.disconnect();
                savedContainer._imgObserver = null;
                savedContainer.innerHTML = '';
                savedContainer.style.gridAutoRows = '';
                savedContainer.style.display = '';
                savedContainer.style.flexWrap = '';
                savedContainer.style.alignContent = '';

                const colorMap = new Map();
                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» ──
                if (referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles }) => {
                        const filtered = filterCluster(clusterTiles);
                        filtered.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(referenceFeatures, feat) >= THRESHOLD) {
                                refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `🖼 Похожие на указанное изображение · ${refMatches.length}`, refColor, false, true));
                    }
                    if (refMatches.length > 0) {
                        refMatches.forEach(t => colorMap.set(getTileKey(t), refColor));
                        renderSavedTilesList(refMatches, colorMap, `🖼 По картинке · ${refMatches.length}`);
                    }
                }

                // ── обычные группы ──
                clusters.forEach(({ tiles: clusterTiles, solo }) => {
                    if (solo) {
                        if (savedTileMatchesSearch(clusterTiles[0])) soloTiles.push(clusterTiles[0]);
                        return;
                    }
                    const color = palette[groupIdx % palette.length];
                    groupIdx++;
                    const visible = filterCluster(clusterTiles);
                    visible.forEach(t => colorMap.set(getTileKey(t), color));
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих`, color, false, false));
                    }
                    renderSavedTilesList(visible, colorMap, `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`);
                });

                // ── одиночные ──
                const totalSolo = clusters.filter(c => c.solo).length;
                if (totalSolo > 0) {
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '', true, false));
                    }
                    renderSavedTilesList(soloTiles, null, `Разные ${soloTiles.length}/${totalSolo}`);
                }
                // Загружаем картинки — передаём уже полученные из IndexedDB если есть
                loadSavedImages(preloadedImages);
            }

            // используем кэш если есть
            if (_savedGroupCache) {
                renderSavedClusters(_savedGroupCache, null);
            } else {
                // Батчевая загрузка картинок с прогрессом и кнопкой отмены
                let cancelled = false;
                const allKeys = tiles.map(t => getTileKey(t)).filter(Boolean);
                const total = allKeys.length;
                const IMG_BATCH = 50;

                // Прогресс-блок внутри savedContainer
                savedContainer.innerHTML = '';
                const progressWrap = document.createElement('div');
                progressWrap.style.cssText = 'grid-column:1/-1; padding:30px 20px; display:flex; flex-direction:column; align-items:center; gap:14px;';

                const progressLabel = document.createElement('div');
                progressLabel.style.cssText = 'font-size:13px; color:#555;';
                progressLabel.textContent = `🔍 Загружаю картинки для анализа: 0 / ${total}`;

                const progressTrack = document.createElement('div');
                progressTrack.style.cssText = 'width:280px; height:6px; background:#eee; border-radius:3px; overflow:hidden;';
                const progressFill = document.createElement('div');
                progressFill.style.cssText = 'height:100%; width:0%; background:#2196F3; border-radius:3px; transition:width 0.2s;';
                progressTrack.appendChild(progressFill);

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = '✕ Отмена';
                cancelBtn.style.cssText = 'padding:5px 16px; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; background:#f9f9f9; color:#555;';
                cancelBtn.onclick = () => {
                    cancelled = true;
                    // Выключаем режим похожих и возвращаемся к обычному виду
                    groupingActive = false;
                    groupBtn.style.background = '#fff';
                    groupBtn.style.color = '#555';
                    groupBtn.style.borderColor = '#ccc';
                    renderSavedTiles();
                };

                progressWrap.appendChild(progressLabel);
                progressWrap.appendChild(progressTrack);
                progressWrap.appendChild(cancelBtn);
                savedContainer.appendChild(progressWrap);

                // Батчевая загрузка
                const allImages = {};
                (async () => {
                    for (let i = 0; i < allKeys.length; i += IMG_BATCH) {
                        if (cancelled) return;
                        const batch = allKeys.slice(i, i + IMG_BATCH);
                        const images = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ action: 'getImages', keys: batch }, resp => {
                                resolve(resp?.result || {});
                            });
                        });
                        Object.assign(allImages, images);
                        const loaded = Math.min(i + IMG_BATCH, total);
                        progressFill.style.width = Math.round(loaded / total * 70) + '%';
                        progressLabel.textContent = `🔍 Загружаю картинки: ${loaded} / ${total}`;
                        await new Promise(r => setTimeout(r, 0)); // уступаем поток UI
                    }
                    if (cancelled) return;

                    progressLabel.textContent = '🔍 Анализирую похожие...';
                    progressFill.style.width = '80%';
                    await new Promise(r => setTimeout(r, 0));

                    const getImgSrc = tile => {
                        const key = getTileKey(tile);
                        return allImages[key]?.dataUrl || tile.querySelector('img[src]')?.src || '';
                    };

                    if (cancelled) return;
                    groupTilesByVisualSimilarity(tiles, getImgSrc).then(clusters => {
                        if (cancelled) return;
                        progressFill.style.width = '100%';
                        _savedGroupCache = clusters;
                        // Передаём уже загруженные картинки чтобы не грузить повторно
                        renderSavedClusters(clusters, allImages);
                    });
                })();
            }
        } else {
            renderSavedTilesList(tiles, null);
            loadSavedImages();
        }
    }

    // Загружает картинки для карточек в savedContainer.
    // preloaded — уже полученные из IndexedDB данные (чтобы не грузить дважды).
    function loadSavedImages(preloaded) {
        savedContainer._imgObserver?.disconnect();
        savedContainer._imgObserver = null;

        const IMG_BATCH = 30;
        const pendingImgKeys = new Map(); // key → { wrap, tileEl }

        savedContainer.querySelectorAll('.ss-tile').forEach(tileEl => {
            const key = tileEl.dataset.ssKey;
            if (!key) return;
            const wrap = tileEl.querySelector('.ss-tile__img-wrap');
            // Не добавляем если картинка уже загружена (есть тег img с src)
            if (wrap && !wrap.querySelector('img[src]')) {
                pendingImgKeys.set(key, { wrap, tileEl });
            }
        });

        if (!pendingImgKeys.size) return;

        // Применяем загруженные картинки.
        // Итерируем по images (не по pendingImgKeys) чтобы избежать
        // изменения Map во время итерации по ней.
        function applyImages(images) {
            for (const [key, imgData] of Object.entries(images)) {
                const entry = pendingImgKeys.get(key);
                if (!entry || !imgData?.dataUrl) continue;
                const { wrap, tileEl } = entry;
                wrap.classList.remove('ss-tile__img-loading');
                wrap.innerHTML = `<img src="${imgData.dataUrl}" alt="" loading="lazy">`;
                pendingImgKeys.delete(key);
                const debugBadge = tileEl.closest('[style*="position:relative"]')?.querySelector('.ppg-debug');
                if (debugBadge && imgData.syncedAt) {
                    const d = new Date(imgData.syncedAt);
                    const ts = `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
                    const syncLine = debugBadge.querySelector('.sync-line');
                    if (syncLine) syncLine.textContent = `🔄 ${ts}`;
                    else debugBadge.innerHTML += `\n<span class="sync-line" style="font-size:9px;opacity:0.8">🔄 ${ts}</span>`;
                }
            }
        }

        // Предзагруженные (из кластеризации) — применяем сразу
        if (preloaded && Object.keys(preloaded).length) {
            applyImages(preloaded);
            if (!pendingImgKeys.size) return;
        }

        // Загружаем батч ключей через background, с повтором при ошибке
        async function loadBatch(keys) {
            if (!keys.length) return;
            try {
                const images = await loadImagesFromBackground(keys);
                applyImages(images);
                // Если часть не вернулась — повторим через секунду (фоновый скрипт мог быть занят)
                const missed = keys.filter(k => pendingImgKeys.has(k));
                if (missed.length && missed.length < keys.length) {
                    // Вернулось хотя бы что-то, значит связь есть — повторяем оставшиеся
                    setTimeout(() => loadBatch(missed), 1000);
                }
            } catch (e) {
                console.warn('[loadSavedImages] batch error:', e);
            }
        }

        // Всегда используем IntersectionObserver — загружаем только видимые карточки.
        // Порог: если карточек мало (≤ IMG_BATCH) — всё равно через observer,
        // но с rootMargin 1000px чтобы загрузить сразу все.
        const isSmall = pendingImgKeys.size <= IMG_BATCH;
        let observerBatch = [];
        let batchTimer = null;

        const imgObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                // img-wrap наблюдается напрямую, key ищем у родительского .ss-tile
                const tileEl = entry.target.closest('.ss-tile');
                if (!tileEl) continue;
                const key = tileEl.dataset.ssKey;
                if (!key || !pendingImgKeys.has(key)) {
                    imgObserver.unobserve(entry.target);
                    continue;
                }
                observerBatch.push(key);
                imgObserver.unobserve(entry.target);
                if (observerBatch.length >= IMG_BATCH) {
                    loadBatch(observerBatch.splice(0, IMG_BATCH));
                } else {
                    clearTimeout(batchTimer);
                    batchTimer = setTimeout(() => {
                        if (observerBatch.length) loadBatch(observerBatch.splice(0));
                    }, 80);
                }
            }
        }, { rootMargin: isSmall ? '2000px' : '300px' });

        savedContainer.querySelectorAll('.ss-tile__img-wrap').forEach(w => {
            // Наблюдаем только если карточка ещё в pendingImgKeys
            const key = w.closest('.ss-tile')?.dataset?.ssKey;
            if (key && pendingImgKeys.has(key)) imgObserver.observe(w);
        });
        savedContainer._imgObserver = imgObserver;
    }

    // Удалить выбранные
    removeSelectedSavedBtn.addEventListener('click', async () => {
        if (!confirm(`Удалить ${savedSelectedKeys.size} выбранных товаров?`)) return;
        await removeFromSaved(savedSelectedKeys);
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        renderSavedTiles();
    });

    // Очистить всё
    clearSavedBtn.addEventListener('click', async () => {
        if (!confirm('Удалить все сохранённые товары?')) return;
        chrome.runtime.sendMessage({ action: 'clearImages' });
        await saveTiles([]);
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        renderSavedTiles();
    });

    // ─── Toast-уведомление ─────────────────────────────────────────────────────
    // Основные служебные кнопки вынесены в компактную панель слева от окна.
    toolBtnGroup.style.cssText = `position:absolute;
        left:max(4px, calc((100vw - min(95vw, 1400px))/2 - 48px)); top:50%; transform:translateY(-50%);
        display:flex; flex-direction:column; align-items:center; gap:5px; padding:6px;
        background:rgba(255,255,255,.96); border:1px solid #ddd; border-radius:10px;
        box-shadow:0 6px 18px rgba(0,0,0,.18); z-index:2147483646;`;
    toolBtnGroup.querySelectorAll('button').forEach(b => {
        b.style.width='34px'; b.style.height='34px'; b.style.padding='0'; b.style.margin='0';
    });

    overlay.appendChild(popup);
    // Перемещаем боковую панель из шапки в overlay, чтобы она не обрезалась overflow:hidden окна.
    overlay.appendChild(toolBtnGroup);
    document.body.appendChild(overlay);

    // Кастомный тултип для названий карточек
    const tileTooltip = document.createElement('div');
    tileTooltip.style.cssText = 'display:none;position:fixed;z-index:100001;'
        + 'background:rgba(0,0,0,0.85);color:white;'
        + 'padding:6px 10px;border-radius:6px;'
        + 'font-size:12px;line-height:1.4;max-width:300px;'
        + 'pointer-events:none;white-space:normal;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);'
        + 'will-change:transform;'; // подсказка GPU что элемент будет двигаться
    // Используем transform вместо left/top — не вызывает layout reflow
    tileTooltip.style.top = '0';
    tileTooltip.style.left = '0';
    document.body.appendChild(tileTooltip);

    // Кешируем DOM-узлы тултипа чтобы не пересоздавать innerHTML
    const _ttTitle = document.createElement('div');
    _ttTitle.style.marginBottom = '4px';
    const _ttStatus = document.createElement('span');
    tileTooltip.appendChild(_ttTitle);
    tileTooltip.appendChild(_ttStatus);

    let tooltipTimer = null;
    let _ttCurrentEl = null; // элемент над которым сейчас тултип
    let _ttMouseX = 0, _ttMouseY = 0; // последние координаты мыши
    let _ttRafId = null; // requestAnimationFrame id для позиционирования

    function _ttPosition() {
        // transform не вызывает reflow — в отличие от left/top
        const x = _ttMouseX + 14;
        const y = _ttMouseY + 14;
        // не выходим за правый/нижний край экрана
        const maxX = window.innerWidth - tileTooltip.offsetWidth - 4;
        const maxY = window.innerHeight - tileTooltip.offsetHeight - 4;
        tileTooltip.style.transform = `translate(${Math.min(x, maxX)}px, ${Math.min(y, maxY)}px)`;
        _ttRafId = null;
    }

    function _ttShow(el, title, statusHtml) {
        _ttTitle.style.display = title ? '' : 'none';
        if (title) _ttTitle.textContent = title;
        _ttStatus.innerHTML = statusHtml;
        tileTooltip.style.display = 'block';
        // Позиционируем сразу (offsetWidth нужен после display:block)
        requestAnimationFrame(_ttPosition);
    }

    function _ttHide() {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
        _ttCurrentEl = null;
        tileTooltip.style.display = 'none';
    }

    // Единый mousemove-обработчик через rAF — не дёргаем DOM на каждый пиксель
    function _onMouseMove(e) {
        _ttMouseX = e.clientX;
        _ttMouseY = e.clientY;
        if (tileTooltip.style.display !== 'none' && !_ttRafId) {
            _ttRafId = requestAnimationFrame(_ttPosition);
        }
    }

    // Проверка "сохранён ли" только по key — O(1) через Set, без итерации
    function _isSaved(key) { return key ? savedKeysCache.has(key) : false; }
    function _isInSearch(key) { return key ? seenTiles.has(key) : false; }

    // productsContainer — делегирование через mouseover + mouseleave
    productsContainer.addEventListener('mouseover', (e) => {
        if (!hoverTooltipEnabled) return; // подсказка отключена — не тратим время на closest()/таймер
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return; // уже над этим элементом — ничего не делаем
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.tileKey;
            const status = _isSaved(key)
                ? '<span style="color:#81c784">🔖 Сохранён</span>'
                : '<span style="color:#ef9a9a">🔖 Не сохранён</span>';
            _ttShow(tooltipEl, title, status);
        }, 300); // увеличили задержку с 100 до 300мс — меньше лишних показов при быстром движении
    });

    productsContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    productsContainer.addEventListener('mousemove', _onMouseMove);

    // savedContainer — аналогично
    savedContainer.addEventListener('mouseover', (e) => {
        if (!hoverTooltipEnabled) return;
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return;
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.savedKey;
            const status = _isInSearch(key)
                ? '<span style="color:#81c784">🔍 Есть в поиске</span>'
                : '<span style="color:#ef9a9a">🔍 Нет в поиске</span>';
            _ttShow(tooltipEl, title, status);
        }, 300);
    });

    savedContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    savedContainer.addEventListener('mousemove', _onMouseMove);

    // ─── Фильтрация и сортировка ───────────────────────────────────────────────

    // @сортировка(поле, направление) — специальная часть DSL, не участвующая в фильтрации.
    // Поддерживаются: возр/убыв, asc/desc, а-я/я-а и старые ↑/↓ как алиасы.
    function parseSortRulesFromQuery(query) {
        const rules = [];
        const re = /@сортировка\s*\(([^()]*)\)/giu;
        let m;
        while ((m = re.exec(String(query || ''))) !== null) {
            const parts = m[1].split(',').map(x => x.trim()).filter(Boolean);
            const field = parts[0] || '';
            const rawDir = (parts[1] || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');
            let direction = null;
            if (['возр','возрастание','повозрастанию','asc','а-я','ая','↑'].includes(rawDir)) direction = 'asc';
            if (['убыв','убывание','поубыванию','desc','я-а','яа','↓'].includes(rawDir)) direction = 'desc';
            if (field) rules.push({ field, direction });
        }
        return rules;
    }
    function stripSortRulesFromQuery(query) {
        return String(query || '').replace(/@сортировка\s*\([^()]*\)/giu, ' ').replace(/\s+/g, ' ').trim();
    }
    function normalizeSortFieldName(name) {
        return String(name || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    }
    function getCounterSortMode(searchQuery) {
        const rules = parseSortRulesFromQuery(searchQuery);
        const first = rules[0];
        if (!first) return currentMode;
        const n = normalizeSortFieldName(first.field);
        const dir = first.direction || 'asc';
        if (['цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit'].includes(n)) {
            return dir === 'desc' ? 'per-gram-desc' : 'per-gram-asc';
        }
        return currentMode;
    }

    function getDslSortFieldValue(tile, field) {
        const n = normalizeSortFieldName(field);
        if (['цена','price'].includes(n)) return { type:'number', value:getPrice(tile), missing:getPrice(tile) >= 99999999, defaultDir:'asc' };
        if (['цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit'].includes(n)) {
            const v=getPricePerUnit(tile); return { type:'number', value:v?.value ?? null, missing:!v, defaultDir:'asc' };
        }
        if (['рейтинг','rating'].includes(n)) { const v=getRating(tile); return { type:'number', value:v, missing:v==null, defaultDir:'desc' }; }
        if (['отзывы','отзыв','reviews'].includes(n)) { const v=getReviewsCount(tile); return { type:'number', value:v, missing:v==null, defaultDir:'desc' }; }
        if (['доставка','дата','delivery'].includes(n)) { const v=getDeliveryDate(tile); return { type:'date', value:v, missing:v==null, defaultDir:'asc' }; }
        if (['название','товар','name','title'].includes(n)) { const v=String(tile?.querySelector?.('a')?.textContent || tile?.textContent || '').trim(); return { type:'text', value:v, missing:!v, defaultDir:'asc' }; }
        const defs=getExtraDefinitions([tile]);
        const def=defs.find(x=>normalizeSortFieldName(x.name)===n);
        if (!def) return { type:'text', value:null, missing:true, defaultDir:'asc' };
        if (def.kind === 'quantity') { const v=getExtraNumericValue(tile, def.name); return { type:'number', value:v, missing:v==null, defaultDir:'asc' }; }
        const attrs=getExtraTileAttributes(tile);
        const key=Object.keys(attrs).find(k=>normalizeSortFieldName(k)===n);
        const v=key ? String(attrs[key]).trim() : '';
        return { type:'text', value:v, missing:!v, defaultDir:'asc' };
    }
    const dslTextCollator = new Intl.Collator('ru', { numeric:true, sensitivity:'base' });
    function compareByDslSortRules(a, b, rules) {
        for (const rule of rules) {
            const av=getDslSortFieldValue(a, rule.field), bv=getDslSortFieldValue(b, rule.field);
            const dir=rule.direction || av.defaultDir || bv.defaultDir || 'asc';
            if (av.missing && !bv.missing) return 1;
            if (!av.missing && bv.missing) return -1;
            if (av.missing && bv.missing) continue;
            let diff = av.type === 'text' || bv.type === 'text' ? dslTextCollator.compare(String(av.value), String(bv.value)) : av.value - bv.value;
            if (diff !== 0) return dir === 'desc' ? -diff : diff;
        }
        return 0;
    }

    function getFilteredAndSorted(searchQuery, sourceTiles = null) {
        let tiles = sourceTiles ? [...sourceTiles] : [...seenTiles.values()];

        const sortRules = parseSortRulesFromQuery(searchQuery);
        const filterQuery = stripSortRulesFromQuery(searchQuery);
        if (filterQuery) {
            const tokens = parseSearchQuery(filterQuery);
            tiles = tiles.filter(tile => matchesTileSearchTokens(tile, tokens));
        }

        tiles = tiles.filter(tile => {
            if (getPrice(tile) === 99999999) return typeFilter.noPrice ?? true;
            const results = getAllUnitResults(tile);
            if (!results.length) return typeFilter.none;
            const categories = new Set(results.map(r=>r.category).filter(Boolean));
            // Карточка с несколькими величинами принадлежит сразу нескольким
            // категориям: «85 г × 30 шт» одновременно видна в «По весу» и «Штучные».
            return [...categories].some(category => typeFilter[category] ?? true);
        });

        tiles.sort((a, b) => {
            if (sortRules.length) return compareByDslSortRules(a, b, sortRules);
            const isPerUnit = currentMode.includes('per-gram');
            const isReviews = currentMode.startsWith('reviews');
            const isRating = currentMode.startsWith('rating');
            const isDelivery = currentMode.startsWith('delivery');
            const desc = currentMode.includes('desc');

            if (isPerUnit) {
                // Сортировка использует ровно тот же канонический расчёт,
                // что и фильтр/бейдж: ₽/кг, ₽/л, ₽/шт или ₽/м.
                const ppgA = getPricePerUnit(a);
                const ppgB = getPricePerUnit(b);
                const hasA = !!ppgA;
                const hasB = !!ppgB;

                // Товары без величины — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;

                // Оба без величины — сортируем по цене с учётом направления
                if (!hasA && !hasB) {
                    const diff = getPrice(a) - getPrice(b);
                    return desc ? -diff : diff;
                }

                const diff = ppgA.value - ppgB.value;
                if (diff !== 0) return desc ? -diff : diff;
            }

            if (isReviews || isRating || isDelivery) {
                const getVal = isReviews ? getReviewsCount : isRating ? getRating : getDeliveryDate;
                const valA = getVal(a);
                const valB = getVal(b);
                const hasA = valA !== null;
                const hasB = valB !== null;

                // Товары без данных (нет селектора/не распарсилось) — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;
                if (!hasA && !hasB) return 0;

                const diff = valA - valB;
                return desc ? -diff : diff;
            }

            const valA = getSortValue(a, currentMode);
            const valB = getSortValue(b, currentMode);
            return desc ? valB - valA : valA - valB;
        });

        // Фильтр по полной цене
        const minVal = parseFloat(priceMin.value);
        const maxVal = parseFloat(priceMax.value);
        if (!isNaN(minVal) || !isNaN(maxVal)) {
            tiles = tiles.filter(tile => {
                const val = getPrice(tile);
                if (val >= 99999999) return true; // без цены — пропускаем
                if (!isNaN(minVal) && val < minVal) return false;
                if (!isNaN(maxVal) && val > maxVal) return false;
                return true;
            });
        }

        // Фильтр по цене/единице (независимый)
        const minUnit = parseFloat(priceUnitMin.value);
        const maxUnit = parseFloat(priceUnitMax.value);
        if (!isNaN(minUnit) || !isNaN(maxUnit)) {
            tiles = tiles.filter(tile => {
                const ppg = getPricePerUnit(tile);
                if (!ppg) return true; // без величины — пропускаем
                const val = ppg.value;
                if (!isNaN(minUnit) && val < minUnit) return false;
                if (!isNaN(maxUnit) && val > maxUnit) return false;
                return true;
            });
        }

        // Фильтр по рейтингу (независимый)
        const minRating = parseFloat(ratingMin.value);
        const maxRating = parseFloat(ratingMax.value);
        if (!isNaN(minRating) || !isNaN(maxRating)) {
            tiles = tiles.filter(tile => {
                const val = getRating(tile);
                if (val === null) return true; // без рейтинга — пропускаем
                if (!isNaN(minRating) && val < minRating) return false;
                if (!isNaN(maxRating) && val > maxRating) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minReviews = parseFloat(reviewsMin.value);
        const maxReviews = parseFloat(reviewsMax.value);
        if (!isNaN(minReviews) || !isNaN(maxReviews)) {
            tiles = tiles.filter(tile => {
                const val = getReviewsCount(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minReviews) && val < minReviews) return false;
                if (!isNaN(maxReviews) && val > maxReviews) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minDelivery = deliveryMin.value ? parseStrictDate(deliveryMin.value, 'start') : NaN;
        const maxDelivery = deliveryMax.value ? parseStrictDate(deliveryMax.value, 'end') : NaN;
        if (!isNaN(minDelivery) || !isNaN(maxDelivery)) {
            tiles = tiles.filter(tile => {
                const val = getDeliveryDate(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minDelivery) && val < minDelivery) return false;
                if (!isNaN(maxDelivery) && val > maxDelivery) return false;
                return true;
            });
        }

        return tiles;
    }

    function updateTypeCounts(tilesOverride) {
        let allFiltered = tilesOverride ? [...tilesOverride] : [...seenTiles.values()];

        const countFilterQuery = stripSortRulesFromQuery(searchInput.value);
        if (countFilterQuery) {
            const tokens = parseSearchQuery(countFilterQuery);
            allFiltered = allFiltered.filter(tile => matchesTileSearchTokens(tile, tokens));
        }

        const counts = { none: 0, noPrice: 0 };
        for (const category of Object.keys(UNITS)) counts[category] = 0;

        allFiltered.forEach(tile => {
            if (getPrice(tile) === 99999999) { counts.noPrice++; return; }
            const results = getAllUnitResults(tile);
            const categories = new Set(results.map(r=>r.category).filter(Boolean));
            if (!categories.size) counts.none++;
            else categories.forEach(category => { if (category in counts) counts[category]++; });
        });

        for (const [category, btn] of Object.entries(typeBtns)) {
            btn.textContent = `${btn.dataset.label} (${counts[category] || 0})`;
        }
    }

    function applyFilters() {
        if (activeTab === 'saved') {
            renderSavedTiles();
        } else {
            // при активной группировке текстовый фильтр применяется внутри групп
            const query = groupingActive ? '' : searchInput.value;
            renderTiles(getFilteredAndSorted(query));
        }
    }

    // Ограниченный LRU-кэш готовых клонов карточек для site-style.
    // Не держим тысячи DOM-клонов: максимум несколько последних экранов.
    const _renderCloneCache = new Map();
    const RENDER_CLONE_CACHE_LIMIT = 120;
    function getCachedSiteClone(tile) {
        let clone = _renderCloneCache.get(tile);
        if (clone) {
            _renderCloneCache.delete(tile);
            _renderCloneCache.set(tile, clone);
            return clone;
        }
        clone = tile.cloneNode(true);
        _renderCloneCache.set(tile, clone);
        while (_renderCloneCache.size > RENDER_CLONE_CACHE_LIMIT) {
            const first = _renderCloneCache.keys().next().value;
            _renderCloneCache.delete(first);
        }
        return clone;
    }

    function renderTiles(tiles) {
        refreshExtraControls([...seenTiles.values()]);
        currentTiles = tiles;
        if (virtualRenderCleanup) { try { virtualRenderCleanup(); } catch (_) {} virtualRenderCleanup = null; }
        productsContainer.style.display = '';
        productsContainer.style.position = '';
        productsContainer.style.overflowY = '';
        productsContainer.style.overflowX = '';
        productsContainer.innerHTML = '';

        if (noSearchTiles) {
            productsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">На странице товары не найдены</div>';
            return;
        }

        if (groupingActive) {
            const searchText = searchInput.value.trim().toLowerCase();
            const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

            // фильтр по тексту с поддержкой parseSearchQuery (!, пробел, кавычки)
            const searchTokens = searchInput.value.trim() ? parseSearchQuery(searchInput.value) : null;
            function tileMatchesSearch(tile) {
                if (!searchTokens) return true;
                return matchesTileSearchTokens(tile, searchTokens);
            }

            function makeSepSearch(text, color, isSolo, isRef) {
                const sep = document.createElement('div');
                sep.style.cssText = `grid-column:1/-1; display:flex; align-items:center; gap:8px; padding:4px 8px;
                       background:${isSolo ? '#f5f5f5' : color}; border-radius:6px; font-size:12px;
                       color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                       ${isRef ? 'border:1px solid #2980b9;' : ''}
                       ${isSolo ? 'border-top:2px solid #ddd; margin-top:4px;' : ''}`;
                sep.textContent = text;
                return sep;
            }

            // карточка-разделитель для flow-режима в search-табе
            function makeFlowDividerSearch(text, color, isSolo, isRef) {
                const card = document.createElement('div');
                card.style.cssText = `
                    width:fit-content; min-width:28px;
                    justify-self:end; align-self:stretch;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#f5f5f5' : color};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#ddd' : color)};
                    border-radius:10px; font-size:10px; font-weight:bold;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    padding:8px 6px; line-height:1.4;
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
                card.textContent = text;
                return card;
            }

            function renderClusters(clusters) {
                productsContainer.innerHTML = '';
                const isFlow = groupLayout === 'flow';
                productsContainer.style.display = '';
                productsContainer.style.flexWrap = '';
                productsContainer.style.alignContent = '';

                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» (если задано эталонное изображение) ──
                if (referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles, solo }) => {
                        clusterTiles.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(referenceFeatures, feat) >= THRESHOLD) {
                                if (tileMatchesSearch(tile)) refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (isFlow) {
                        productsContainer.appendChild(makeFlowDividerSearch(
                            `🖼 По картинке · ${refMatches.length}`, refColor, false, true));
                    } else {
                        productsContainer.appendChild(makeSepSearch(
                            `🖼 Похожие на указанное изображение · ${refMatches.length}`, refColor, false, true));
                    }
                    if (refMatches.length > 0) {
                        const sorted = getFilteredAndSorted('', refMatches);
                        const refLabel = `🖼 По картинке · ${refMatches.length}`;
                        sorted.forEach((tile, idx) => renderOneTile(tile, refColor, true, idx === 0 && isFlow ? refLabel : null));
                    }
                    if (!isFlow) {
                        const divider = document.createElement('div');
                        divider.style.cssText = 'grid-column:1/-1; height:1px; background:#ddd; margin:4px 0;';
                        productsContainer.appendChild(divider);
                    }
                }

                // ── обычные группы ──
                clusters.forEach(({ tiles: clusterTiles, solo }) => {
                    if (solo) {
                        if (tileMatchesSearch(clusterTiles[0])) soloTiles.push(clusterTiles[0]);
                        return;
                    }
                    const color = palette[groupIdx % palette.length];
                    groupIdx++;
                    const sorted = getFilteredAndSorted('', clusterTiles);
                    const visible = sorted.filter(tileMatchesSearch);
                    if (!isFlow) {
                        productsContainer.appendChild(makeSepSearch(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих товаров`, color, false, false));
                    }
                    const clusterLabel = `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`;
                    visible.forEach((tile, idx) => renderOneTile(tile, color, true, idx === 0 && isFlow ? clusterLabel : null));
                });

                // ── одиночные ──
                if (soloTiles.length > 0 || clusters.some(c => c.solo)) {
                    const totalSolo = clusters.filter(c => c.solo).length;
                    if (!isFlow) {
                        productsContainer.appendChild(makeSepSearch(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '#f5f5f5', true, false));
                    }
                    const soloLabel = `Разные ${soloTiles.length}/${totalSolo}`;
                    const sortedSolo = getFilteredAndSorted('', soloTiles);
                    sortedSolo.forEach((tile, idx) => renderOneTile(tile, null, false, idx === 0 && isFlow ? soloLabel : null));
                }
                refreshSavedKeysCache();
                // Обновляем счётчик — считаем реально отрисованные карточки
                const visibleCount = productsContainer.querySelectorAll('[data-tile-key]').length;
                const counterMode = getCounterSortMode(searchInput.value);
                const arrow2 = counterMode.includes('desc') ? '↓' : '↑';
                renderCounterLabel(visibleCount, seenTiles.size, counterMode, arrow2);
            }

            // используем кэш если есть — группы стабильны
            if (_searchGroupCache) {
                renderClusters(_searchGroupCache);
                return;
            }

            productsContainer.innerHTML = '';
            const searchGroupProgress = document.createElement('div');
            searchGroupProgress.style.cssText = 'padding:20px; text-align:center; color:#999; font-size:13px; display:flex; flex-direction:column; align-items:center; gap:10px;';
            searchGroupProgress.innerHTML = '<div>🔍 Анализирую изображения...</div>';
            const searchCancelBtn = document.createElement('button');
            searchCancelBtn.textContent = '✕ Отмена';
            searchCancelBtn.style.cssText = 'padding:4px 14px; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; background:#f9f9f9; color:#555;';
            let searchGroupCancelled = false;
            searchCancelBtn.onclick = () => {
                searchGroupCancelled = true;
                groupingActive = false;
                groupBtn.style.background = '#fff';
                groupBtn.style.color = '#555';
                groupBtn.style.borderColor = '#ccc';
                applyFilters();
            };
            searchGroupProgress.appendChild(searchCancelBtn);
            productsContainer.appendChild(searchGroupProgress);
            // снапшот seenTiles на момент начала анализа — не захватываем saved-тайлы
            const allTiles = [...seenTiles.values()].filter(t => !t.dataset?.savedKey);
            const getImgSrc = tile => tile.querySelector('img[src]')?.src || '';
            groupTilesByVisualSimilarity(allTiles, getImgSrc).then(clusters => {
                if (searchGroupCancelled) return;
                _searchGroupCache = clusters;
                renderClusters(clusters);
            });
            return;
        }

        // Для больших выдач включаем настоящую виртуализацию: в DOM находятся
        // только карточки около viewport, а не все отфильтрованные товары.
        if (virtualizationThreshold > 0 && tiles.length >= virtualizationThreshold) {
            renderVirtualizedTiles(tiles);
            return;
        }

        tiles.forEach(tile => renderOneTile(tile, null, false));

        function renderOneTile(tile, groupColor, inGroup, groupLabel, append = true, reuseWrap = null) {
            const wrap = reuseWrap || document.createElement('div');
            if (reuseWrap) {
                wrap.innerHTML = '';
                wrap.removeAttribute('style');
                wrap.removeAttribute('data-tooltip');
                wrap.removeAttribute('data-tile-key');
                wrap.removeAttribute('data-tile-url');
                wrap.removeAttribute('data-virtual-index');
            }
            // ВАЖНО: раньше здесь стояло height:100% — из-за известной особенности CSS Grid
            // процентная высота на элементе грида резолвится относительно итоговой высоты
            // строки (даже при align-items:start это правило не спасает), поэтому все карточки
            // в одной строке растягивались под самую высокую соседнюю. Явный align-self:start
            // без height даёт карточке расти только под своё содержимое.
            wrap.className = 'ss-search-tile-wrap';
            wrap.style.cssText = 'position:relative; display:flex; flex-direction:column; align-self:start; min-width:0; width:100%; max-width:100%; box-sizing:border-box;' +
                (tiles.length > 500
                    ? ' content-visibility:auto; contain-intrinsic-size:280px; contain:layout paint style;'
                    : '');

            const ppgInfo = getPpgBadgeInfo(tile);
            const ppg = getPricePerUnit(tile);
            if (ppgInfo) {
                const badge = document.createElement('div');
                badge.className = 'ppg-badge';
                badge.innerHTML = ppgInfo.lines.map((line, i) => i === 0
                    ? line
                    : `<span style="font-weight:normal;font-size:10px;opacity:0.85">${line}</span>`).join('\n');
                badge.style.whiteSpace = 'normal';
                badge.title = ppgInfo.multi ? 'Рассчитано по нескольким дополнительным величинам' : '';
                applyPpgBadgeSettings(badge);
                wrap.appendChild(badge);
            }

            if (debugMode) {
                const debugBadge = document.createElement('div');
                debugBadge.className = 'ppg-debug';

                const safePpg = (ppg && typeof ppg === 'object')
                    ? ppg
                    : { value: null, category: '???', base: '???' };
                const currency = detectCurrency?.() ?? '';
                const price = getPrice?.(tile) ?? '';
                const base = safePpg.base ?? '???';
                const value = typeof safePpg.value === 'number' ? safePpg.value.toFixed(2) : '';
                const priceLabel = base ? `${currency}/${base}` : '';
                const result = parseUnit?.(getTileTitle?.(tile));
                let weightLabel = '';
                if (result && typeof result.value === 'number') {
                    if (result.value >= 1000 && base === 'г') weightLabel = fmtUnit(result.value / 1000) + ' кг';
                    else if (result.value >= 1000 && base === 'мл') weightLabel = fmtUnit(result.value / 1000) + ' л';
                    else weightLabel = result.value + ' ' + base;
                }
                debugBadge.innerHTML =
                    `цена1: ${value} ${priceLabel}` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">вес: ${weightLabel ?? '???'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">цена2: ${price}&nbsp;</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">отзывы: ${getReviewsCount(tile) ?? '—'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">рейтинг: ${getRating(tile) ?? '—'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">доставка: ${formatDateToString(getDeliveryDate(tile)) ?? '—'}</span>`;
                debugBadge.style.whiteSpace = 'pre';
                wrap.appendChild(debugBadge);
            }

            const clone = searchCardStyle === 'custom'
                ? createCustomSearchTile(tile, cardScale)
                : getCachedSiteClone(tile);

            if (searchCardStyle === 'site' && clone instanceof Element) {
                clone.classList.add('ss-site-card-clone');
                const gridSafeStyles = {
                    display: 'block', position: 'relative', width: '100%',
                    minWidth: '0', maxWidth: 'none', height: 'auto', minHeight: '0',
                    margin: '0', float: 'none', clear: 'none', gridColumn: 'auto',
                    gridRow: 'auto', gridArea: 'auto', justifySelf: 'stretch',
                    alignSelf: 'stretch', boxSizing: 'border-box'
                };
                for (const [prop, value] of Object.entries(gridSafeStyles)) {
                    clone.style.setProperty(prop, value, 'important');
                }
            }
            const tileKey = getTileKey(tile);
            const tileIndex = tiles.indexOf(tile);
            const tileUrl = tile.dataset?.ssUrl || clone.dataset?.ssUrl || '';
            wrap.dataset.tileKey = tileKey;
            wrap.dataset.tileUrl = tileUrl;

            // Чекбокс выделения
            const checkbox = document.createElement('div');
            checkbox.style.cssText = `
    position: absolute; bottom: 8px; right: 8px; z-index: 20;
    width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
    background: ${selectedKeys.has(tileKey) ? '#2196F3' : 'rgba(255,255,255,0.9)'};
    border: 2px solid ${selectedKeys.has(tileKey) ? '#2196F3' : '#ccc'};
    display: ${selectedKeys.has(tileKey) ? 'flex' : 'none'};
    align-items: center; justify-content: center;
    font-size: 12px; color: white; font-weight: bold;
    transition: all 0.15s;
`;
            checkbox.textContent = selectedKeys.has(tileKey) ? '✓' : '';

            // Подсветка выделенной карточки
            if (selectedKeys.has(tileKey)) {
                wrap.style.outline = '2px solid #2196F3';
                wrap.style.borderRadius = '8px';
            }

            // События карточек обрабатываются делегированно на productsContainer.
            // Это существенно уменьшает количество listener'ов при виртуализации.
            checkbox.dataset.selectionCheckbox = '1';
            wrap.appendChild(checkbox);

            const fullTitle = getTileTitle(tile);
            if (fullTitle) {
                wrap.setAttribute('data-tooltip', fullTitle);
            }

            // В режиме сайта используем исходную карточку; в своём стиле
            // ссылки уже создаются внутри createCustomSearchTile().
            if (searchCardStyle === 'site') {
                // Добавляем кликабельную ссылку на картинку
                const linkEl = safeQuerySelector(clone, SELECTORS?.link);
                const imgEl = clone.querySelector('img');
                if (linkEl && imgEl && imgEl.parentElement?.tagName !== 'A') {
                    const href = linkEl.getAttribute('href');
                    if (href) {
                        const a = document.createElement('a');
                        a.href = href;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.style.cssText = 'display:block; pointer-events:auto !important;';
                        imgEl.parentNode.insertBefore(a, imgEl);
                        a.appendChild(imgEl);
                    }
                }
            }

            // Показ дополнительных атрибутов/величин прямо на карточке поиска.
            const extras=getExtraTileAttributes(tile);
            if(Object.keys(extras).length){
                const exBox=document.createElement('div'); exBox.className='ss-extra-data'; exBox.style.cssText='display:flex;flex-wrap:wrap;gap:3px;margin:5px 0 0;';
                Object.entries(extras).forEach(([name,val])=>{ const b=document.createElement('span'); b.textContent=`${name}: ${val}`; b.title='Дополнительный атрибут'; b.style.cssText='font-size:9px;line-height:1.2;padding:3px 5px;border-radius:8px;background:#eef3f7;color:#546e7a;'; exBox.appendChild(b); });
                wrap.appendChild(exBox);
            }
            wrap.appendChild(clone);
            if (groupColor && inGroup) wrap.style.outline = `2px solid ${groupColor}`;
            // Разделитель группы на первой карточке (search tab, flow)
            if (groupLabel && groupingActive && groupLayout === 'flow') {
                const isRef = groupLabel.startsWith('🖼');
                const isSolo = groupLabel.startsWith('Разные') || groupLabel.startsWith('Не распознан');
                const gc = groupColor || '#e8e8e8';
                wrap.style.marginLeft = '11px';
                const badge = document.createElement('div');
                badge.style.cssText = `
                    position:absolute; left:0; top:0; z-index:10;
                    height:100%; width:22px;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#e8e8e8' : gc};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#bbb' : 'rgba(0,0,0,.12)')}; 
                    border-radius:8px;
                    font-size:9px; font-weight:bold; padding:4px 3px;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:translateX(-100%) rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    pointer-events:none;
                `;
                badge.textContent = groupLabel;
                wrap.appendChild(badge);
            }
            if (append) productsContainer.appendChild(wrap);
            return wrap;
        } // end renderOneTile

        function renderVirtualizedTiles(virtualTiles) {
            const gap = 15;
            const minCardWidth = Math.max(120, Number(cardScale) || 180);
            const overscanRows = 2;
            let rowHeight = searchCardStyle === 'custom'
                ? Math.max(300, Math.round((Number(cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(cardScale) || 180) + gap)
                : 300;
            let raf = 0;
            let resizeObserver = null;
            let lastRange = '';
            let savedScrollTop = productsContainer.scrollTop;
            let resizeHandler = null;
            let scrollHandler = null;
            // Переиспользуем wrapper'ы при прокрутке вместо постоянного create/remove.
            const wrapperPool = [];

            productsContainer.innerHTML = '';
            productsContainer.style.display = 'block';
            productsContainer.style.position = 'relative';
            productsContainer.style.overflowY = 'auto';
            productsContainer.style.overflowX = 'hidden';

            const stage = document.createElement('div');
            stage.className = 'ss-virtual-stage';
            stage.style.cssText = 'position:relative;width:100%;min-height:1px;';
            productsContainer.appendChild(stage);

            function getMetrics() {
                const cs = getComputedStyle(productsContainer);
                const pl = parseFloat(cs.paddingLeft) || 0;
                const pr = parseFloat(cs.paddingRight) || 0;
                const contentWidth = Math.max(1, productsContainer.clientWidth - pl - pr);
                const columns = Math.max(1, Math.floor((contentWidth + gap) / (minCardWidth + gap)));
                const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
                return { columns, cellWidth };
            }

            function updateStageHeight(columns) {
                const rows = Math.ceil(virtualTiles.length / columns);
                stage.style.height = Math.max(0, rows * rowHeight - gap) + 'px';
                return rows;
            }

            function renderWindow(force = false) {
                raf = 0;
                const { columns, cellWidth } = getMetrics();
                const rows = Math.ceil(virtualTiles.length / columns);
                stage.style.height = Math.max(0, rows * rowHeight - gap) + 'px';
                if (!rows) { stage.replaceChildren(); return; }

                const viewportHeight = productsContainer.clientHeight || 600;
                const scrollTop = productsContainer.scrollTop;
                const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
                const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
                const rangeKey = `${columns}:${firstRow}:${lastRow}`;
                if (!force && rangeKey === lastRange) return;
                lastRange = rangeKey;

                const count = Math.max(0, (lastRow - firstRow + 1) * columns);
                const fragment = document.createDocumentFragment();
                for (let slot = 0; slot < count; slot++) {
                    const linear = firstRow * columns + slot;
                    if (linear >= virtualTiles.length) break;
                    const row = Math.floor(linear / columns);
                    const col = linear % columns;
                    const tile = virtualTiles[linear];
                    const wrap = renderOneTile(tile, null, false, null, false, wrapperPool[slot] || null);
                    wrapperPool[slot] = wrap;
                    wrap.dataset.virtualIndex = String(linear);
                    wrap.style.position = 'absolute';
                    wrap.style.left = `${col * (cellWidth + gap)}px`;
                    wrap.style.top = `${row * rowHeight}px`;
                    wrap.style.width = `${cellWidth}px`;
                    wrap.style.margin = '0';
                    fragment.appendChild(wrap);
                }
                stage.replaceChildren(fragment);

                if (resizeObserver) resizeObserver.disconnect();
                for (let slot = 0; slot < count; slot++) {
                    const wrap = wrapperPool[slot];
                    if (wrap) resizeObserver.observe(wrap);
                }
            }

            resizeObserver = new ResizeObserver(entries => {
                let changed = false;
                let maxObserved = 0;
                for (const entry of entries) {
                    const h = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
                    if (Number.isFinite(h)) maxObserved = Math.max(maxObserved, h);
                }
                if (maxObserved > 0) {
                    const baseHeight = searchCardStyle === 'custom'
                        ? Math.round((Number(cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(cardScale) || 180)
                        : 300 - gap;
                    const nextRowHeight = Math.max(baseHeight + gap, Math.ceil(maxObserved + gap));
                    if (Math.abs(nextRowHeight - rowHeight) > 2) {
                        rowHeight = nextRowHeight;
                        changed = true;
                    }
                }
                if (changed) {
                    const { columns } = getMetrics();
                    updateStageHeight(columns);
                    lastRange = '';
                    scheduleRender();
                }
            });

            function scheduleRender() {
                if (raf) return;
                raf = requestAnimationFrame(() => renderWindow(false));
            }

            scrollHandler = scheduleRender;
            resizeHandler = () => { lastRange = ''; scheduleRender(); };
            productsContainer.addEventListener('scroll', scrollHandler, { passive: true });
            window.addEventListener('resize', resizeHandler, { passive: true });
            virtualRenderCleanup = () => {
                if (raf) cancelAnimationFrame(raf);
                productsContainer.removeEventListener('scroll', scrollHandler);
                window.removeEventListener('resize', resizeHandler);
                if (resizeObserver) resizeObserver.disconnect();
                wrapperPool.length = 0;
            };

            const { columns } = getMetrics();
            updateStageHeight(columns);
            renderWindow(true);
            productsContainer.scrollTop = Math.min(savedScrollTop, Math.max(0, stage.scrollHeight - productsContainer.clientHeight));
            renderWindow(true);

            refreshSavedKeysCache();
            const counterMode = getCounterSortMode(searchInput.value);
            const arrow = counterMode.includes('desc') ? '↓' : '↑';
            renderCounterLabel(virtualTiles.length, seenTiles.size, counterMode, arrow);
        }

        refreshSavedKeysCache(); // расставляем значки 🔖 сразу после рендера
        const counterMode = getCounterSortMode(searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        renderCounterLabel(tiles.length, seenTiles.size, counterMode, arrow);

        if (seenTiles.size > 500) {
            const task = () => {
                if (!productsContainer.isConnected) return;
                updateTypeCounts();
                updatePricePlaceholders([...seenTiles.values()]);
                updateDebugVisibility();
            };
            if ('requestIdleCallback' in window) requestIdleCallback(task, {timeout: 700});
            else setTimeout(task, 0);
        } else {
            updateTypeCounts();
            updatePricePlaceholders([...seenTiles.values()]);
            updateDebugVisibility();
        }
    }


    // Делегирование hover/click для карточек. Не создаём по 3 listener'а на каждую карточку.
    function updateVisibleSelectionState() {
        productsContainer.querySelectorAll('[data-tile-key]').forEach(wrap => {
            const key = wrap.dataset.tileKey || '';
            const selected = selectedKeys.has(key);
            wrap.style.outline = selected ? '2px solid #2196F3' : '';
            wrap.style.borderRadius = selected ? '8px' : '';
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) {
                checkbox.style.background = selected ? '#2196F3' : 'rgba(255,255,255,0.9)';
                checkbox.style.borderColor = selected ? '#2196F3' : '#ccc';
                checkbox.style.display = selected ? 'flex' : 'none';
                checkbox.textContent = selected ? '✓' : '';
            }
        });
    }

    productsContainer.addEventListener('mouseover', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const from = e.relatedTarget;
        if (from && wrap.contains(from)) return;
        const checkbox = wrap.querySelector('[data-selection-checkbox]');
        if (checkbox) checkbox.style.display = 'flex';
    });
    productsContainer.addEventListener('mouseout', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const to = e.relatedTarget;
        if (to && wrap.contains(to)) return;
        if (!selectedKeys.has(wrap.dataset.tileKey || '')) {
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) checkbox.style.display = 'none';
        }
    });
    productsContainer.addEventListener('click', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const checkbox = e.target.closest('[data-selection-checkbox]');
        if (!e.ctrlKey && !e.shiftKey && !checkbox) return;

        e.preventDefault();
        e.stopPropagation();
        const tileKey = wrap.dataset.tileKey || '';
        if (!tileKey) return;

        if (e.shiftKey && lastSelectedKey) {
            const allKeys = currentTiles.map(tile => getTileKey(tile)).filter(Boolean);
            const fromIdx = allKeys.indexOf(lastSelectedKey);
            const toIdx = allKeys.indexOf(tileKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                const lo = Math.min(fromIdx, toIdx);
                const hi = Math.max(fromIdx, toIdx);
                for (let i = lo; i <= hi; i++) selectedKeys.add(allKeys[i]);
            }
        } else {
            if (selectedKeys.has(tileKey)) selectedKeys.delete(tileKey);
            else selectedKeys.add(tileKey);
            lastSelectedKey = tileKey;
            lastSelectedIndex = currentTiles.findIndex(tile => getTileKey(tile) === tileKey);
        }
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    renderTiles(getFilteredAndSorted(''));

    // Callback для внешнего обновления поиска (используется в applyHeuristicSelectors)
    window._ssRefreshSearch = () => { collectTiles(); applyFilters(); };
    // Показываем баннер если эвристика уже нашла что-то до открытия попапа
    showHeuristicBanner();

    searchInput.addEventListener('input', () => {
        if (activeTab === 'search') {
            syncFieldsFromSearch();
            scheduleApplyFilters();
        } else {
            if (autoFilterEnabled) {
                clearTimeout(_filterDebounceTimer);
                _filterDebounceTimer = setTimeout(() => renderSavedTiles(), 300);
            }
        }
    });

    // Блокируем скролл страницы
    const scrollY = window.scrollY;
    document.body.style.cssText += `position:fixed;top:-${scrollY}px;width:100%;`;

    let isMinimized = false;

    // Мини-попап: только две кнопки 🗖 ✕ в правом нижнем углу
    const miniBar = document.createElement('div');
    miniBar.style.cssText = `
        display:none; position:fixed; bottom:16px; left:16px; z-index:2147483645;
        background:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.25);
        padding:6px 8px; gap:4px; align-items:center; pointer-events:auto;
        font-family:sans-serif;
    `;
    const miniRestoreBtn = document.createElement('button');
    miniRestoreBtn.textContent = '🗖';
    miniRestoreBtn.title = 'Развернуть';
    miniRestoreBtn.style.cssText = 'font-size:18px;background:none;border:none;cursor:pointer;padding:2px 6px;line-height:1;';
    const miniCloseBtn = document.createElement('button');
    miniCloseBtn.textContent = '✕';
    miniCloseBtn.title = 'Закрыть';
    miniCloseBtn.style.cssText = 'font-size:14px;background:none;border:none;cursor:pointer;padding:2px 6px;line-height:1;color:#888;';
    miniBar.appendChild(miniRestoreBtn);
    miniBar.appendChild(miniCloseBtn);
    document.body.appendChild(miniBar);
    miniRestoreBtn.onclick = () => restorePopup();
    miniCloseBtn.onclick = () => closePopup();

    function minimizePopup() {
        if (isMinimized) return;
        isMinimized = true;
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
        overlay.style.display = 'none';
        miniBar.style.display = 'flex';
    }

    function restorePopup() {
        if (!isMinimized) return;
        isMinimized = false;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';
        // Явно возвращаем flex-центрирование, чтобы после сворачивания/разворачивания
        // окно не «прилипало» к левому верхнему углу.
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        popup.style.position = 'relative';
        popup.style.left = 'auto';
        popup.style.top = 'auto';
        popup.style.margin = '0';
        miniBar.style.display = 'none';
        minimizeBtn.textContent = '— Свернуть';
    }

    minimizeBtn.onclick = () => isMinimized ? restorePopup() : minimizePopup();

    function closePopup() {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        if (!isMinimized) window.scrollTo(0, scrollY);
        overlay.remove();
        miniBar.remove();
        style.remove();
        tileTooltip.remove();
        if (pickerActive) stopCardPicker();
        document.removeEventListener('keydown', escHandler);
        updateLiveCounterBadge(); // возвращаем плашку счётчика, если она включена
        if (window._ssClosePopup === closePopup) window._ssClosePopup = null;
    }

    window._ssClosePopup = closePopup;
    closeBtn.onclick = closePopup;

    function escHandler(e) {
        if (e.key !== 'Escape') return;
        if (pickerActive) return; // picker сам обработает Esc
        if (isMinimized) restorePopup();
        else closePopup();
    }
    document.addEventListener('keydown', escHandler);

    return seenTiles.size;
}

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
