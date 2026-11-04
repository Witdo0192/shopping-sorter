// Страница «Поиск на сайтах»: ввод запроса, выбор сайтов, открытие вкладок, сохранённые запросы.
// Логика адресов и нормализации — в multi-search-core.js. Данные — chrome.storage.local:
// searchSites [{id,name,template,enabled}] и savedShopSearches [{id,query,siteIds}].
const MULTI_SEARCH_CONFIRM_TABS = 8;

let searchSites = [];
let savedShopSearches = [];
const checkedSiteIds = new Set();
let editingSiteId = null;

const queryInput = document.getElementById('queryInput');
const saveCheck = document.getElementById('saveCheck');
const openBtn = document.getElementById('openBtn');
const formHint = document.getElementById('formHint');
const siteChips = document.getElementById('siteChips');
const savedList = document.getElementById('savedList');
const siteList = document.getElementById('siteList');
const presetsBox = document.getElementById('presets');
const newSiteName = document.getElementById('newSiteName');
const newSiteTemplate = document.getElementById('newSiteTemplate');
const addSiteForm = document.getElementById('addSiteForm');
const addSiteSubmit = addSiteForm.querySelector('button[type="submit"]');

let toastTimer = null;
function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function makeButton(text, title, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    if (title) btn.title = title;
    if (className) btn.className = className;
    btn.addEventListener('click', onClick);
    return btn;
}

function persistSites() {
    chrome.storage.local.set({searchSites});
}

function persistSaved() {
    chrome.storage.local.set({savedShopSearches});
}

function pluralSites(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} сайт`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} сайта`;
    return `${n} сайтов`;
}

function renderChips() {
    siteChips.replaceChildren();
    if (!searchSites.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Сайтов пока нет — добавьте первый в блоке «Сайты для поиска» ниже.';
        siteChips.appendChild(empty);
    }
    for (const site of searchSites) {
        const chip = document.createElement('label');
        chip.className = 'chip' + (checkedSiteIds.has(site.id) ? ' on' : '');
        chip.title = site.template;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checkedSiteIds.has(site.id);
        cb.addEventListener('change', () => {
            if (cb.checked) checkedSiteIds.add(site.id); else checkedSiteIds.delete(site.id);
            site.enabled = cb.checked; // отметка запоминается как выбор по умолчанию
            persistSites();
            renderChips();
        });
        chip.append(cb, document.createTextNode(site.name));
        siteChips.appendChild(chip);
    }
    const count = checkedSiteIds.size;
    formHint.textContent = count ? `Будет открыто вкладок: ${count}` : '';
    openBtn.disabled = !searchSites.length;
}

function renderSaved() {
    savedList.replaceChildren();
    if (!savedShopSearches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Пока пусто. Отметьте «Запомнить этот запрос» при поиске — он появится здесь.';
        savedList.appendChild(empty);
        return;
    }
    for (const item of savedShopSearches) {
        const known = item.siteIds ? item.siteIds.filter(id => searchSites.some(s => s.id === id)) : null;
        const row = document.createElement('div');
        row.className = 'saved-item';
        const q = makeButton(item.query, 'Подставить запрос и выбранные сайты', 'q', () => {
            applySaved(item);
            queryInput.focus();
        });
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = known ? pluralSites(known.length) : 'текущий выбор';
        row.append(
            q, meta,
            makeButton('▶', 'Открыть сразу', '', () => { applySaved(item); openSearch(false); }),
            makeButton('×', 'Удалить запрос', 'icon', () => {
                savedShopSearches = savedShopSearches.filter(x => x.id !== item.id);
                persistSaved();
                renderSaved();
            })
        );
        savedList.appendChild(row);
    }
}

function applySaved(item) {
    queryInput.value = item.query;
    if (item.siteIds) {
        checkedSiteIds.clear();
        item.siteIds.forEach(id => { if (searchSites.some(s => s.id === id)) checkedSiteIds.add(id); });
        renderChips();
    }
}

function renderSites() {
    siteList.replaceChildren();
    if (!searchSites.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Список пуст.';
        siteList.appendChild(empty);
    }
    for (const site of searchSites) {
        const row = document.createElement('div');
        row.className = 'site-item';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = site.name;
        const tpl = document.createElement('span');
        tpl.className = 'tpl';
        tpl.textContent = site.template;
        tpl.title = site.template;
        row.append(
            name, tpl,
            makeButton('✎', 'Изменить', 'icon', () => {
                editingSiteId = site.id;
                newSiteName.value = site.name;
                newSiteTemplate.value = site.template;
                addSiteSubmit.textContent = '✓ Сохранить';
                newSiteTemplate.focus();
            }),
            makeButton('×', 'Удалить сайт', 'icon', () => {
                searchSites = searchSites.filter(s => s.id !== site.id);
                checkedSiteIds.delete(site.id);
                if (editingSiteId === site.id) resetSiteForm();
                persistSites();
                renderAll();
            })
        );
        siteList.appendChild(row);
    }
    renderPresets();
}

function renderPresets() {
    presetsBox.replaceChildren();
    const have = new Set(searchSites.map(s => s.template));
    const free = MULTI_SEARCH_PRESETS.filter(p => !have.has(p.template));
    if (!free.length) return;
    presetsBox.append(document.createTextNode('Быстро добавить:'));
    for (const preset of free) {
        presetsBox.appendChild(makeButton('＋ ' + preset.name, preset.template, '', () => {
            addSite(preset.name, preset.template);
        }));
    }
}

function resetSiteForm() {
    editingSiteId = null;
    newSiteName.value = '';
    newSiteTemplate.value = '';
    addSiteSubmit.textContent = '＋ Добавить';
}

function addSite(name, rawTemplate) {
    const cleanName = String(name || '').trim();
    if (!cleanName) { toast('Укажите название сайта'); newSiteName.focus(); return false; }
    const checked = validateSearchTemplate(rawTemplate);
    if (!checked.ok) { toast(checked.error); newSiteTemplate.focus(); return false; }
    const duplicate = searchSites.some(s => s.id !== editingSiteId && s.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) { toast('Сайт с таким названием уже есть'); newSiteName.focus(); return false; }
    if (editingSiteId) {
        const site = searchSites.find(s => s.id === editingSiteId);
        if (site) { site.name = cleanName; site.template = checked.template; }
    } else {
        if (searchSites.length >= MULTI_SEARCH_MAX_SITES) { toast('Достигнут предел числа сайтов'); return false; }
        const site = {id: makeMultiSearchId(), name: cleanName, template: checked.template, enabled: true};
        searchSites.push(site);
        checkedSiteIds.add(site.id);
    }
    resetSiteForm();
    persistSites();
    renderAll();
    return true;
}

// withSave: true для обычной отправки формы (учитывает чекбокс сохранения); ▶ у сохранённого запроса не пересохраняет.
function openSearch(withSave) {
    const query = queryInput.value.trim().replace(/\s+/g, ' ');
    if (!query) { toast('Введите, что искать'); queryInput.focus(); return; }
    const targets = buildSearchTargets(searchSites, [...checkedSiteIds], query);
    if (!targets.length) { toast('Выберите хотя бы один сайт'); return; }
    if (targets.length > MULTI_SEARCH_CONFIRM_TABS &&
        !confirm(`Будет открыто ${targets.length} вкладок. Продолжить?`)) return;
    if (withSave && saveCheck.checked) {
        savedShopSearches = upsertSavedShopSearch(savedShopSearches, query, [...checkedSiteIds]);
        persistSaved();
        saveCheck.checked = false;
        renderSaved();
        toast('Запрос сохранён');
    }
    targets.forEach((target, index) => chrome.tabs.create({url: target.url, active: index === 0}));
}

document.getElementById('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    openSearch(true);
});
document.getElementById('selectAllBtn').addEventListener('click', () => {
    searchSites.forEach(s => { checkedSiteIds.add(s.id); s.enabled = true; });
    persistSites();
    renderChips();
});
document.getElementById('selectNoneBtn').addEventListener('click', () => {
    searchSites.forEach(s => { s.enabled = false; });
    checkedSiteIds.clear();
    persistSites();
    renderChips();
});
addSiteForm.addEventListener('submit', e => {
    e.preventDefault();
    addSite(newSiteName.value, newSiteTemplate.value);
});

function renderAll() {
    renderChips();
    renderSaved();
    renderSites();
}

chrome.storage.local.get(['searchSites', 'savedShopSearches'], data => {
    searchSites = normalizeSearchSites(data.searchSites);
    savedShopSearches = normalizeSavedShopSearches(data.savedShopSearches);
    searchSites.filter(s => s.enabled).forEach(s => checkedSiteIds.add(s.id));
    renderAll();
    queryInput.focus();
});
