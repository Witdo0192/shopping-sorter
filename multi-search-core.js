// Поиск товара на нескольких сайтах: чистая логика без DOM и chrome API.
// Подключается в multi-search.html обычным скриптом и проверяется в tests/multi-search.test.cjs.
// Хранилище chrome.storage.local: searchSites (сайты) и savedShopSearches (сохранённые запросы).
// Не путать с savedSearchQueries — это фильтры внутри панели товаров (ui/saved-queries.js).

const MULTI_SEARCH_QUERY_PLACEHOLDER = '{query}';
const MULTI_SEARCH_MAX_SITES = 50;
const MULTI_SEARCH_MAX_SAVED = 200;

// Примеры шаблонов для быстрого добавления. Магазины меняют адреса поиска,
// поэтому пользователь может исправить шаблон после добавления.
const MULTI_SEARCH_PRESETS = [
    {name: 'Ozon', template: 'https://www.ozon.ru/search/?text={query}'},
    {name: 'Wildberries', template: 'https://www.wildberries.ru/catalog/0/search.aspx?search={query}'},
    {name: 'Яндекс Маркет', template: 'https://market.yandex.ru/search?text={query}'},
    {name: 'Мегамаркет', template: 'https://megamarket.ru/catalog/?q={query}'},
    {name: 'Lamoda', template: 'https://www.lamoda.ru/catalogsearch/result/?q={query}'},
    {name: 'AliExpress', template: 'https://aliexpress.ru/wholesale?SearchText={query}'}
];

function makeMultiSearchId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Возвращает {ok:true, template} или {ok:false, error}. Допустимы только http/https
// и обязательно {query}: адрес без подстановки открывал бы одну и ту же страницу.
function validateSearchTemplate(rawTemplate) {
    const template = String(rawTemplate ?? '').trim();
    if (!template) return {ok: false, error: 'Укажите адрес поиска'};
    if (!template.includes(MULTI_SEARCH_QUERY_PLACEHOLDER)) {
        return {ok: false, error: 'В адресе должно быть {query} на месте искомого слова'};
    }
    let url;
    try {
        url = new URL(template.split(MULTI_SEARCH_QUERY_PLACEHOLDER).join('test'));
    } catch {
        return {ok: false, error: 'Адрес не похож на ссылку (нужно https://…)'};
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return {ok: false, error: 'Допустимы только адреса http:// и https://'};
    }
    return {ok: true, template};
}

// Подставляет закодированный запрос во все вхождения {query}.
// Возвращает строку-адрес или null, если шаблон или запрос непригодны.
function buildSearchUrl(template, query) {
    const text = String(query ?? '').trim().replace(/\s+/g, ' ');
    if (!text || !validateSearchTemplate(template).ok) return null;
    return String(template).trim().split(MULTI_SEARCH_QUERY_PLACEHOLDER).join(encodeURIComponent(text));
}

function normalizeSearchSites(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const sites = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const checked = validateSearchTemplate(item.template);
        const name = String(item.name ?? '').trim();
        if (!checked.ok || !name) continue;
        let id = typeof item.id === 'string' && item.id ? item.id : makeMultiSearchId();
        while (seen.has(id)) id = makeMultiSearchId();
        seen.add(id);
        sites.push({id, name, template: checked.template, enabled: item.enabled !== false});
        if (sites.length >= MULTI_SEARCH_MAX_SITES) break;
    }
    return sites;
}

// siteIds: массив id сайтов, выбранных при сохранении, либо null — «как отмечено сейчас».
function normalizeSavedShopSearches(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const items = [];
    for (const item of raw) {
        if (!item || typeof item.query !== 'string') continue;
        const query = item.query.trim().replace(/\s+/g, ' ');
        if (!query) continue;
        const key = query.toLocaleLowerCase('ru-RU');
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
            id: typeof item.id === 'string' && item.id ? item.id : makeMultiSearchId(),
            query,
            siteIds: Array.isArray(item.siteIds) ? item.siteIds.filter(id => typeof id === 'string') : null
        });
        if (items.length >= MULTI_SEARCH_MAX_SAVED) break;
    }
    return items;
}

// Добавляет запрос или обновляет выбор сайтов у уже сохранённого (без учёта регистра). Новые — сверху.
function upsertSavedShopSearch(list, query, siteIds) {
    const text = String(query ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return normalizeSavedShopSearches(list);
    const key = text.toLocaleLowerCase('ru-RU');
    const current = normalizeSavedShopSearches(list);
    const index = current.findIndex(x => x.query.toLocaleLowerCase('ru-RU') === key);
    const item = {id: index >= 0 ? current[index].id : makeMultiSearchId(), query: text, siteIds: Array.isArray(siteIds) ? siteIds : null};
    if (index >= 0) current.splice(index, 1);
    current.unshift(item);
    return current.slice(0, MULTI_SEARCH_MAX_SAVED);
}

// Адреса для открытия: по выбранным сайтам, в порядке списка.
function buildSearchTargets(sites, selectedIds, query) {
    const selected = new Set(selectedIds);
    const targets = [];
    for (const site of sites) {
        if (!selected.has(site.id)) continue;
        const url = buildSearchUrl(site.template, query);
        if (url) targets.push({id: site.id, name: site.name, url});
    }
    return targets;
}
