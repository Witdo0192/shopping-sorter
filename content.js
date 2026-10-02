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
        window._ssApplyFilters?.();
    }
});

// Настройки бейджа цены/единицы (ppg-badge).
loadBadgePreferences();

// Сопоставление карточек и профилей: src/content/products/fields.js

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

// Распознавание и диагностика: src/content/selectors/heuristics.js
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

// Представление счётчика: src/content/ui/live-counter.js

// Начальные операции хранения выполняются после объявления состояния runtime.
migrateBase64FromHtml();
refreshSavedKeysCache();

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
