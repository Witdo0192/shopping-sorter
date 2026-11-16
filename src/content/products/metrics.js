// Цены, рейтинги, отзывы, даты, разбор единиц и кэш метрик карточек.
// Используется сбором, поиском, сортировкой и отображением товаров.

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
