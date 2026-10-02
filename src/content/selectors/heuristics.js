// Распознавание карточек по эвристикам, диагностика селекторов и предложения исправлений.
// Читает текущую конфигурацию и использует callback обновления панели из runtime.
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
