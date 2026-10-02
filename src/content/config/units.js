// Конфигурация единиц: совместимость, точность и порядок категорий.
// Функции отображения читают текущий UNITS из content.js при вызове.

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
