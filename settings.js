let defaultSites = null;
let defaultUnits = null;
let currentSites = null;
let currentUnits = null;

const SITE_VIEW_PREF_KEY = 'shopping-sorter-site-view';
let siteViewPrefs = loadSiteViewPrefs();

function loadSiteViewPrefs() {
    try {
        const raw = localStorage.getItem(SITE_VIEW_PREF_KEY);
        const p = raw ? JSON.parse(raw) : {};
        return {
            sort: ['order','name','domain','key'].includes(p.sort) ? p.sort : 'order',
            dir: p.dir === -1 ? -1 : 1,
        };
    } catch { return { sort: 'order', dir: 1 }; }
}

function saveSiteViewPrefs() {
    try { localStorage.setItem(SITE_VIEW_PREF_KEY, JSON.stringify(siteViewPrefs)); } catch {}
}

// ─── Performance settings ─────────────────────────────────────────────────────
const VIRTUALIZATION_MIN = 0;
const VIRTUALIZATION_MAX = 10000;
let virtualizationThresholdSetting = 500;

function renderVirtualizationSetting(value) {
    const select = document.getElementById('virtualizationThreshold');
    const status = document.getElementById('virtualizationStatus');
    if (!select) return;
    const n = Number(value);
    virtualizationThresholdSetting = Number.isFinite(n) && n >= VIRTUALIZATION_MIN && n <= VIRTUALIZATION_MAX ? Math.round(n) : 500;
    select.value = String(virtualizationThresholdSetting);
    if (status) status.textContent = virtualizationThresholdSetting === 0
        ? 'виртуализация выключена'
        : `включается от ${virtualizationThresholdSetting} карточек`;
}

chrome.storage.local.get(['virtualizationThreshold'], d => renderVirtualizationSetting(d.virtualizationThreshold));

document.getElementById('virtualizationThreshold')?.addEventListener('change', e => {
    const value = Number(e.target.value);
    virtualizationThresholdSetting = Number.isFinite(value) && value >= VIRTUALIZATION_MIN && value <= VIRTUALIZATION_MAX ? Math.round(value) : 500;
    chrome.storage.local.set({ virtualizationThreshold: virtualizationThresholdSetting }, () => {
        renderVirtualizationSetting(virtualizationThresholdSetting);
        showToast('⚡ Порог виртуализации сохранён', 'success');
    });
});

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
    const [s, u] = await Promise.all([
        fetch(chrome.runtime.getURL('sites.json')).then(r => r.json()),
        fetch(chrome.runtime.getURL('units.json')).then(r => r.json()),
    ]);
    defaultSites = s;
    defaultUnits = u;
    chrome.storage.local.get(['sites', 'units'], data => {
        currentSites = JSON.parse(JSON.stringify(data.sites ?? defaultSites));
        currentUnits = JSON.parse(JSON.stringify(data.units ?? defaultUnits));
        renderSiteList();
        syncSitesJsonEditor();
        renderUnitsList();
        syncUnitsJsonEditor();
        setStatus(data.sites || data.units ? 'есть изменения' : 'стандартные настройки', !!(data.sites || data.units));
    });
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => {
            t.style.borderBottomColor = 'transparent';
            t.style.color = 'var(--text2)';
        });
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.style.borderBottomColor = 'var(--accent)';
        tab.style.color = 'var(--accent)';
        const key = tab.dataset.tab;
        if (key === 'data') {
            document.getElementById('section-data').style.display = 'block';
            document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
        } else {
            document.getElementById('section-data').style.display = 'none';
            document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
            document.getElementById('panel-' + key).classList.add('active');
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SITES VISUAL EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

const FIELD_META = {
    tile:     { label: 'Карточка товара', hint: 'Блок одного товара в каталоге', placeholder: 'div.product-card' },
    price:    { label: 'Цена',            hint: 'Элемент с ценой внутри карточки', placeholder: 'span.price' },
    title:    { label: 'Название',        hint: 'Элемент с названием товара',     placeholder: 'span.product-name' },
    link:     { label: 'Ссылка',          hint: 'Ссылка (тег <a>)',               placeholder: 'a[href]' },
    id:       { label: 'ID товара',        hint: 'Отдельный идентификатор для защиты от дублей; например [data-id] или .product-id', placeholder: '[data-product-id]' },
    reviews:  { label: 'Кол-во отзывов',  hint: 'Необязательно — для сортировки по отзывам', placeholder: 'span.reviews-count' },
    rating:   { label: 'Рейтинг',         hint: 'Необязательно — для сортировки по рейтингу', placeholder: 'span.rating' },
    delivery: { label: 'Дата доставки',   hint: 'Необязательно — для сортировки по дате доставки (напр. «18 августа», «завтра»)', placeholder: 'span.delivery-date' },
    weight:   { label: 'Вес/объём',       hint: 'Необязательно — если вес/объём не в названии, а в отдельном элементе (напр. «380 гр»)', placeholder: 'span.product-weight' },
};

function getSiteDisplayName(key, config) {
    return String(config?.displayName || key);
}

function getSiteEntriesForView() {
    const entries = Object.entries(currentSites || {});
    if (siteViewPrefs.sort === 'order') return siteViewPrefs.dir === 1 ? entries : entries.reverse();

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const value = ([key, config]) => {
        if (siteViewPrefs.sort === 'name') return getSiteDisplayName(key, config);
        if (siteViewPrefs.sort === 'domain') return (config?.domains || []).join(' ');
        return key;
    };
    return entries.sort((a, b) => {
        const d = collator.compare(value(a), value(b));
        return d * siteViewPrefs.dir;
    });
}

function updateSiteViewControls() {
    const search = document.getElementById('siteSearch');
    const sort = document.getElementById('siteSort');
    const dir = document.getElementById('siteSortDir');
    if (sort) sort.value = siteViewPrefs.sort;
    if (dir) {
        dir.textContent = siteViewPrefs.dir === 1 ? '↑' : '↓';
        dir.title = siteViewPrefs.dir === 1 ? 'По возрастанию' : 'По убыванию';
    }
    if (search && search.value == null) search.value = '';
}

function renderSiteList() {
    const list = document.getElementById('siteList');
    list.innerHTML = '';
    const query = (document.getElementById('siteSearch')?.value || '').trim().toLocaleLowerCase();
    let shown = 0;
    for (const [key, config] of getSiteEntriesForView()) {
        const haystack = [key, getSiteDisplayName(key, config), ...(config?.domains || [])].join(' ').toLocaleLowerCase();
        if (query && !haystack.includes(query)) continue;
        list.appendChild(makeSiteCard(key, config));
        shown++;
    }
    if (!shown) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:24px;text-align:center;color:var(--text2);background:var(--surface);border:1px dashed var(--border);border-radius:10px;font-size:12px;';
        empty.textContent = query ? 'Ничего не найдено' : 'Сайтов пока нет';
        list.appendChild(empty);
    }
    updateSiteViewControls();
}

function setupSiteViewControls() {
    const search = document.getElementById('siteSearch');
    const sort = document.getElementById('siteSort');
    const dir = document.getElementById('siteSortDir');
    sort?.addEventListener('change', () => {
        siteViewPrefs.sort = sort.value;
        saveSiteViewPrefs();
        renderSiteList();
    });
    dir?.addEventListener('click', () => {
        siteViewPrefs.dir *= -1;
        saveSiteViewPrefs();
        renderSiteList();
    });
    search?.addEventListener('input', () => renderSiteList());
    updateSiteViewControls();
}

function setupUnitDrag(list) {
    let dragged = null;
    list.querySelectorAll('.site-card[data-key]').forEach(card => {
        const handle = card.querySelector('.drag-handle');
        if (!handle) return;
        handle.draggable = true;
        handle.addEventListener('dragstart', e => {
            dragged = card;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.key);
            requestAnimationFrame(() => card.classList.add('dragging'));
        });
        handle.addEventListener('dragend', () => {
            if (dragged) dragged.classList.remove('dragging');
            list.querySelectorAll('.drop-before,.drop-after').forEach(c => c.classList.remove('drop-before','drop-after'));
            dragged = null;
        });
        card.addEventListener('dragover', e => {
            if (!dragged || dragged === card) return;
            e.preventDefault();
            const r = card.getBoundingClientRect();
            const before = e.clientY < r.top + r.height / 2;
            list.querySelectorAll('.drop-before,.drop-after').forEach(c => c.classList.remove('drop-before','drop-after'));
            card.classList.add(before ? 'drop-before' : 'drop-after');
            e.dataTransfer.dropEffect = 'move';
        });
        card.addEventListener('drop', e => {
            e.preventDefault();
            if (!dragged || dragged === card) return;
            const r = card.getBoundingClientRect();
            const before = e.clientY < r.top + r.height / 2;
            if (before) list.insertBefore(dragged, card);
            else list.insertBefore(dragged, card.nextSibling);
            persistUnitVisualOrder(list);
        });
    });
}

function persistUnitVisualOrder(list) {
    const cards = [...list.querySelectorAll('.site-card[data-key]')];
    cards.forEach((card, index) => {
        const key = card.dataset.key;
        if (currentUnits[key]) currentUnits[key].priority = index;
    });
    list.querySelectorAll('.drop-before,.drop-after').forEach(c => c.classList.remove('drop-before','drop-after'));
    syncUnitsJsonEditor();
    markChanged();
    refreshUnitsTester();
}

function applyUnitPriorityInput(catKey, value) {
    let desired = parseInt(value, 10);
    if (!Number.isFinite(desired)) desired = 99;
    desired = Math.max(-999999, Math.min(999999, desired));

    const otherEntries = Object.entries(currentUnits).filter(([key]) => key !== catKey);
    const occupied = otherEntries.some(([, config]) => Number(config?.priority) === desired);

    if (occupied) {
        const ordered = Object.entries(currentUnits)
            .map(([key, config], index) => ({ key, config, index }))
            .filter(x => x.key !== catKey)
            .sort((a, b) => (Number(a.config?.priority ?? 99) - Number(b.config?.priority ?? 99)) || (a.index - b.index));
        const insertAt = ordered.findIndex(x => Number(x.config?.priority ?? 99) >= desired);
        const start = insertAt < 0 ? ordered.length : insertAt;
        currentUnits[catKey].priority = desired;
        for (let i = start; i < ordered.length; i++) {
            ordered[i].config.priority = Number(ordered[i].config.priority ?? 99) + 1;
        }
    } else {
        currentUnits[catKey].priority = desired;
    }

    renderUnitsList();
    syncUnitsJsonEditor();
    markChanged();
    const card = document.querySelector(`#unitsList .site-card[data-key="${CSS.escape(catKey)}"]`);
    if (card) card.classList.add('open');
}

function makeSiteCard(siteKey, config) {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.dataset.key = siteKey;

    const header = document.createElement('div');
    header.className = 'site-header';
    header.innerHTML = `<span class="site-name">${esc(getSiteDisplayName(siteKey, config))}</span><span class="site-domains">${esc((config.domains||[]).join(', '))}</span><span class="site-toggle">▼</span>`;
    header.addEventListener('click', () => card.classList.toggle('open'));

    const body = document.createElement('div');
    body.className = 'site-body';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'field-group';
    nameWrap.innerHTML = `<div class="field-label">Имя в настройках <span class="field-hint">— внутренний ключ сайта не меняется</span></div><input class="field-input" data-field="displayName" value="${esc(config.displayName || '')}" placeholder="Например: Ozon Россия">`;
    body.appendChild(nameWrap);

    const domWrap = document.createElement('div');
    domWrap.className = 'field-group';
    domWrap.innerHTML = `<div class="field-label">Домены <span class="field-hint">— через запятую</span></div><input class="field-input" data-field="domains" value="${esc((config.domains||[]).join(', '))}" placeholder="myshop.ru, myshop.by">`;
    body.appendChild(domWrap);

    const info = document.createElement('div');
    info.style.cssText='font-size:11px;line-height:1.5;color:#555;background:#f5f7fa;border:1px solid #e5e9ef;border-radius:8px;padding:8px 10px;';
    info.innerHTML='🧩 <b>Карточки ищутся независимо.</b> Конфигурация поддерживает несколько вариантов в <code>cards</code>: у каждого свой <code>tile</code> и свои атрибуты. <b>ID</b> задаёт приоритетный ключ для удаления дублей; ссылка больше не обязана быть идентификатором.';
    body.appendChild(info);

    const fieldRow = document.createElement('div');
    fieldRow.className = 'field-row';
    ['tile','id','price','title','link','reviews','rating','delivery','weight'].forEach(field => {
        const m = FIELD_META[field];
        const val = config[field];
        const arr = Array.isArray(val) ? val : (val ? [val] : ['']);
        const wrap = document.createElement('div');
        if (field === 'tile') wrap.style.gridColumn = '1/-1';
        wrap.appendChild(makeFallbackField(field, m.label, m.hint, arr, m.placeholder));
        fieldRow.appendChild(wrap);
    });
    body.appendChild(fieldRow);

    if (Array.isArray(config.cards) && config.cards.length) {
        const multiBox=document.createElement('div');
        multiBox.style.cssText='margin-top:10px;border:1px solid #e3e7ea;border-radius:8px;padding:8px;background:#fafafa;';
        const h=document.createElement('div'); h.style.cssText='font-weight:700;font-size:11px;margin-bottom:6px;'; h.textContent=`🧩 Варианты карточек (${config.cards.length})`; multiBox.appendChild(h);
        config.cards.forEach((profile,idx)=>{
            const tab=document.createElement('details'); tab.style.cssText='border:1px solid #e6e8ea;border-radius:6px;background:#fff;margin:5px 0;'; if(idx===0) tab.open=true;
            const sum=document.createElement('summary'); sum.style.cssText='cursor:pointer;padding:6px 8px;font-size:11px;font-weight:600;'; sum.textContent=`${idx+1}. ${profile.name||`Карточка ${idx+1}`}`; tab.appendChild(sum);
            const inner=document.createElement('div'); inner.style.cssText='padding:7px;display:grid;grid-template-columns:1fr 1fr;gap:7px;';
            ['tile','id','price','title','link','reviews','rating','delivery','weight'].forEach(field=>{
                const wrap=document.createElement('div'); wrap.style.gridColumn=field==='tile'?'1/-1':'';
                const lab=document.createElement('div'); lab.style.cssText='font-size:10px;color:#666;margin-bottom:3px;'; lab.textContent=FIELD_META[field]?.label||field;
                const ta=document.createElement('textarea'); ta.rows=2; ta.value=Array.isArray(profile[field])?profile[field].join('\n'):(profile[field]||''); ta.style.cssText='width:100%;box-sizing:border-box;resize:vertical;font:10px monospace;padding:5px;border:1px solid #ddd;border-radius:5px;';
                ta.addEventListener('input',()=>{ const vals=ta.value.split('\n').map(x=>x.trim()).filter(Boolean); profile[field]=vals.length<=1?(vals[0]||''):vals; currentSites[siteKey].cards=config.cards; syncSitesJsonEditor(); markChanged(); });
                wrap.append(lab,ta); inner.appendChild(wrap);
            });
            const ex=document.createElement('div'); ex.style.cssText='grid-column:1/-1;';
            const exLab=document.createElement('div'); exLab.style.cssText='font-size:10px;color:#666;margin-bottom:3px;'; exLab.textContent='Доп. атрибуты (JSON: [{name,selector}]):';
            const exTa=document.createElement('textarea'); exTa.rows=2; exTa.value=JSON.stringify(profile.extras||[]); exTa.style.cssText='width:100%;box-sizing:border-box;resize:vertical;font:10px monospace;padding:5px;border:1px solid #ddd;border-radius:5px;';
            exTa.addEventListener('input',()=>{ try{ const v=JSON.parse(exTa.value||'[]'); profile.extras=Array.isArray(v)?v:[]; currentSites[siteKey].cards=config.cards; syncSitesJsonEditor(); markChanged(); }catch{} });
            ex.append(exLab,exTa); inner.appendChild(ex);
            tab.appendChild(inner); multiBox.appendChild(tab);
        });
        body.appendChild(multiBox);
    }

    const actions = document.createElement('div');
    actions.className = 'site-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.style.fontSize = '12px';
    delBtn.textContent = '🗑 Удалить сайт';
    delBtn.addEventListener('click', () => {
        if (!confirm(`Удалить «${siteKey}»?`)) return;
        delete currentSites[siteKey];
        renderSiteList(); syncSitesJsonEditor(); markChanged();
    });
    actions.appendChild(delBtn);
    body.appendChild(actions);

    body.addEventListener('input', () => { readCardValues(card, siteKey); syncSitesJsonEditor(); markChanged(); });
    body.querySelector('[data-field="displayName"]')?.addEventListener('change', () => { if (siteViewPrefs.sort === 'name') renderSiteList(); });
    body.querySelector('[data-field="domains"]')?.addEventListener('change', () => { if (siteViewPrefs.sort === 'domain') renderSiteList(); });
    card.appendChild(header);
    card.appendChild(body);
    return card;
}

function makeFallbackField(key, label, hint, values, placeholder) {
    const wrap = document.createElement('div');
    wrap.className = 'field-group';
    wrap.innerHTML = `<div class="field-label">${label} <span class="field-hint">— ${hint}</span></div>`;
    const list = document.createElement('div');
    list.className = 'fallback-list';
    list.dataset.field = key;
    values.forEach(v => list.appendChild(makeFallbackRow(v, placeholder)));
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-icon add';
    addBtn.title = 'Добавить резервный вариант';
    addBtn.textContent = '+';
    addBtn.type = 'button';
    addBtn.addEventListener('click', e => { e.stopPropagation(); list.insertBefore(makeFallbackRow('', placeholder), addBtn); });
    list.appendChild(addBtn);
    wrap.appendChild(list);
    return wrap;
}

function makeFallbackRow(value, placeholder) {
    const row = document.createElement('div');
    row.className = 'fallback-item';
    const inp = document.createElement('input');
    inp.className = 'field-input';
    inp.value = value; inp.placeholder = placeholder; inp.dataset.fallback = '1';
    const del = document.createElement('button');
    del.className = 'btn-icon'; del.title = 'Удалить вариант'; del.textContent = '✕'; del.type = 'button';
    del.addEventListener('click', e => {
        e.stopPropagation();
        const list = row.parentElement; // сохраняем до remove()
        const siblings = list?.querySelectorAll('.fallback-item');
        if (siblings?.length <= 1) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
        row.remove();
        list?.closest('.site-body')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    row.appendChild(inp); row.appendChild(del);
    return row;
}

function readCardValues(card, siteKey) {
    const body = card.querySelector('.site-body');
    const domainsRaw = body.querySelector('[data-field="domains"]')?.value?.trim() || '';
    const domains = domainsRaw ? domainsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    function getFallbacks(field) {
        const list = body.querySelector(`.fallback-list[data-field="${field}"]`);
        if (!list) return '';
        const vals = [...list.querySelectorAll('[data-fallback]')].map(i => i.value.trim()).filter(Boolean);
        return vals.length === 1 ? vals[0] : vals;
    }
    const displayName = body.querySelector('[data-field="displayName"]')?.value?.trim() || '';
    currentSites[siteKey] = { ...currentSites[siteKey], displayName, domains, tile: getFallbacks('tile'), id: getFallbacks('id'), price: getFallbacks('price'), title: getFallbacks('title'), link: getFallbacks('link'), reviews: getFallbacks('reviews'), rating: getFallbacks('rating'), delivery: getFallbacks('delivery'), weight: getFallbacks('weight') };
    const titleEl = card.querySelector('.site-name');
    if (titleEl) titleEl.textContent = getSiteDisplayName(siteKey, currentSites[siteKey]);
}

document.getElementById('addSiteBtn').addEventListener('click', () => {
    const name = prompt('Имя для нового сайта (латиницей):');
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase().replace(/\s+/g,'_');
    if (currentSites[key]) { showToast('Сайт уже существует', 'error'); return; }
    currentSites[key] = { displayName: name.trim(), domains: [], cards:[{name:'Карточка 1',tile:'',id:'',price:'',title:'',link:'a[href]',reviews:'',rating:'',delivery:'',weight:'',extras:[]}], tile: '', id:'', price: '', title: '', link: 'a[href]', reviews: '', rating: '', delivery: '', weight: '' };
    renderSiteList(); syncSitesJsonEditor(); markChanged();
    const newCard = document.querySelector(`.site-card[data-key="${key}"]`);
    if (newCard) { newCard.classList.add('open'); newCard.scrollIntoView({ behavior: 'smooth' }); }
});

document.getElementById('saveSites').addEventListener('click', () => {
    chrome.storage.local.set({ sites: currentSites }, () => { setStatus('сохранено ✓', true); showToast('💾 Сайты сохранены', 'success'); });
});

document.getElementById('resetSites').addEventListener('click', () => {
    if (!confirm('Сбросить настройки сайтов к стандартным?')) return;
    chrome.storage.local.remove('sites', () => {
        currentSites = JSON.parse(JSON.stringify(defaultSites));
        renderSiteList(); syncSitesJsonEditor(); setStatus('стандартные настройки', false); showToast('↺ Сброшено', 'success');
    });
});

// Sites JSON modal
function syncSitesJsonEditor() {
    const editor = document.getElementById('sitesEditor');
    editor.value = JSON.stringify(currentSites, null, 4);
    updateLines('sitesEditor', 'sitesLines');
}
document.getElementById('showJsonBtn').addEventListener('click', () => { syncSitesJsonEditor(); document.getElementById('jsonModal').classList.add('open'); });
document.getElementById('closeJson').addEventListener('click', () => document.getElementById('jsonModal').classList.remove('open'));
// backdrop click removed — close only via ✕ button or Escape
document.getElementById('validateJson').addEventListener('click', () => validateEditor('sitesEditor', 'sitesError'));
document.getElementById('applyJson').addEventListener('click', () => {
    if (!validateEditor('sitesEditor', 'sitesError', true)) return;
    currentSites = JSON.parse(document.getElementById('sitesEditor').value);
    renderSiteList(); markChanged();
    document.getElementById('jsonModal').classList.remove('open');
    showToast('✓ JSON применён', 'success');
});
document.getElementById('sitesEditor').addEventListener('input', () => updateLines('sitesEditor', 'sitesLines'));
document.getElementById('sitesEditor').addEventListener('scroll', () => {
    document.getElementById('sitesLines').scrollTop = document.getElementById('sitesEditor').scrollTop;
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNITS VISUAL EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Live-тестер распознавания величин ─────────────────────────────────────
// Облегчённая копия основного цикла getAllUnitResultsFromText из content.js —
// специально работает поверх currentUnits (то есть видит ещё не сохранённые
// правки), чтобы можно было проверить новую категорию/слово до сохранения.
// Приближённая копия: без учёта normalizeUnitText и составных шаблонов
// (85г×30шт и т.п.) — для проверки одного шаблона этого достаточно.
function parseWithUnitsConfig(unitsConfig, text) {
    if (!text) return [];
    const allUnits = [];
    for (const [category, cat] of Object.entries(unitsConfig || {})) {
        for (const [unit, entry] of Object.entries(cat.units || {})) {
            const multiplier = (entry && typeof entry === 'object') ? Number(entry.multiplier) || 1 : Number(entry) || 1;
            const decimals = (entry && typeof entry === 'object' && entry.decimals != null) ? entry.decimals : (category === 'pieces' ? 0 : 2);
            allUnits.push({ unit, multiplier, decimals, category, base: cat.base, categoryLabel: cat.label || category });
        }
    }
    allUnits.sort((a, b) => b.unit.length - a.unit.length);
    const escapedUnits = allUnits.map(u => u.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
    if (!escapedUnits.length) return [];
    let re;
    try { re = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(${escapedUnits.join('|')})(?![A-Za-zА-Яа-яЁё])`, 'giu'); }
    catch { return []; }
    const out = [];
    let m;
    while ((m = re.exec(text))) {
        const unit = allUnits.find(u => u.unit.toLowerCase() === m[2].toLowerCase());
        if (!unit) continue;
        const number = parseFloat(m[1].replace(',', '.'));
        if (!Number.isFinite(number)) continue;
        out.push({ badgeNumber: number, category: unit.category, categoryLabel: unit.categoryLabel, unit: unit.unit, decimals: unit.decimals, raw: m[0] });
    }
    return out;
}

function refreshUnitsTester() {
    const out = document.getElementById('unitsTesterResult');
    if (!out) return;
    const title = document.getElementById('unitsTesterTitle')?.value?.trim() || '';
    const priceRaw = document.getElementById('unitsTesterPrice')?.value;
    const price = priceRaw !== '' && priceRaw != null ? Number(priceRaw) : null;

    if (!title) { out.innerHTML = '<i style="color:#888">Ничего не введено.</i>'; return; }

    const found = parseWithUnitsConfig(currentUnits, title);
    if (!found.length) {
        out.innerHTML = '<b style="color:#c62828">Ничего не распознано.</b> Проверьте, есть ли нужное слово в списке единиц ниже (или добавьте новое).';
        return;
    }
    out.innerHTML = found.map(q => {
        const name = q.categoryLabel.replace(/^[^\p{L}]+/u, '').trim() || q.categoryLabel;
        let priceLine = '';
        if (Number.isFinite(price) && q.badgeNumber > 0) {
            const perUnit = price / q.badgeNumber;
            priceLine = ` — <b>${perUnit.toFixed(Math.max(0, Math.min(6, q.decimals ?? 2)))} ₽/${q.unit}</b>`;
        }
        return `✅ «${esc(q.raw)}» → ${esc(name)}: ${q.badgeNumber} ${esc(q.unit)}${priceLine}`;
    }).join('<br>');
}

document.getElementById('unitsTesterTitle')?.addEventListener('input', refreshUnitsTester);
document.getElementById('unitsTesterPrice')?.addEventListener('input', refreshUnitsTester);

function getOrderedUnitEntries() {
    return Object.entries(currentUnits || {})
        .map(([key, config], index) => ({ key, config, index }))
        .sort((a, b) => (Number(a.config?.priority ?? 99) - Number(b.config?.priority ?? 99)) || (a.index - b.index))
        .map(x => [x.key, x.config]);
}

function renderUnitsList() {
    const list = document.getElementById('unitsList');
    list.innerHTML = '';
    getOrderedUnitEntries().forEach(([key, config]) => list.appendChild(makeUnitCard(key, config)));
    setupUnitDrag(list);
    refreshUnitsTester();
}

function makeUnitCard(catKey, config) {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.dataset.key = catKey;

    // parse emoji from label
    const labelText = config.label || catKey;
    const emojiMatch = labelText.match(/^(\p{Emoji}[\uFE0F]?)\s*/u);
    const emoji = emojiMatch ? emojiMatch[1] : '📦';
    const nameText = labelText.replace(/^(\p{Emoji}[\uFE0F]?\s*)/u, '') || catKey;

    const header = document.createElement('div');
    header.className = 'site-header';
    header.innerHTML = `
        <span class="drag-handle" draggable="true" title="Перетащить категорию — порядок изменит приоритет">⋮⋮</span>
        <span class="category-emoji">${emoji}</span>
        <span class="site-name">${esc(nameText)}</span>
        <span class="site-domains" style="font-family:var(--mono)">база: <b>${esc(config.base || '')}</b> · ${Object.keys(config.units || {}).length} единиц</span>
        <span class="site-toggle">▼</span>`;
    header.addEventListener('click', () => card.classList.toggle('open'));

    const body = document.createElement('div');
    body.className = 'site-body';

    // Label + emoji + base row
    const metaRow = document.createElement('div');
    metaRow.className = 'field-row';
    metaRow.style.marginTop = '14px';
    metaRow.innerHTML = `
        <div class="field-group">
            <div class="field-label">Название категории</div>
            <div style="display:flex;gap:6px">
                <input class="field-input" style="width:52px" data-meta="emoji" value="${esc(emoji)}" placeholder="⚖️">
                <input class="field-input" data-meta="name" value="${esc(nameText)}" placeholder="По весу">
            </div>
        </div>
        <div class="field-group">
            <div class="field-label">Базовая единица <span class="field-hint">— к ней приводятся все остальные</span></div>
            <input class="field-input" style="width:120px;font-family:var(--mono);font-weight:600" data-meta="base" value="${esc(config.base || '')}" placeholder="г">
        </div>
        <div class="field-group">
            <div class="field-label" title="Порядок категорий в режиме «Авто» и в списке фильтра «Цена/ед.». Меньше — выше в списке/приоритетнее. При одинаковом числе сохраняется порядок категорий в настройках.">Приоритет</div>
            <input class="field-input" type="number" step="1" style="width:70px;font-family:var(--mono)" data-meta="priority" value="${esc(String(Number.isFinite(config.priority) ? config.priority : 99))}" placeholder="99">
        </div>`;
    body.appendChild(metaRow);

    // Units table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'field-group';
    tableWrap.innerHTML = `<div class="field-label" title="Словарь единиц, которые распознаёт парсер в названии товара и которые доступны для расчёта цены/ед.">Единицы измерения <span class="field-hint">— слово из названия → множитель к базовой единице и знаки после запятой при отображении</span></div>`;

    // decimals по умолчанию для новых строк: у штучных величин — 0, у остальных — 2
    const defaultDecimals = catKey === 'pieces' ? 0 : 2;

    const table = document.createElement('table');
    table.className = 'units-table';
    table.dataset.cat = catKey;
    table.innerHTML = `<thead><tr>
        <th style="width:40%">Слово в названии товара</th>
        <th style="width:25%" title="Коэффициент приведения к базовой единице. Одинаковый множитель у двух единиц означает, что для расчётов они полностью равнозначны.">Множитель</th>
        <th style="width:25%" title="Сколько цифр после запятой показывать в бейдже, фильтре и сортировке для этой единицы. Влияет только на отображение — на сам расчёт, фильтрацию и сортировку не влияет.">Знаков после запятой</th>
        <th style="width:10%"></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    Object.entries(config.units || {}).forEach(([word, val]) => {
        const mult = (val && typeof val === 'object') ? val.multiplier : val;
        const dec  = (val && typeof val === 'object' && val.decimals != null) ? val.decimals : defaultDecimals;
        tbody.appendChild(makeUnitRow(word, mult, dec));
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    // Add unit row button
    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'btn-icon add';
    addRowBtn.style.cssText = 'margin-top:6px;width:auto;padding:4px 12px;font-size:12px;gap:4px;display:inline-flex;align-items:center;border-radius:6px';
    addRowBtn.innerHTML = '+ добавить единицу';
    addRowBtn.type = 'button';
    addRowBtn.addEventListener('click', e => {
        e.stopPropagation();
        tbody.appendChild(makeUnitRow('', 1, defaultDecimals));
        readUnitCard(card, catKey);
        syncUnitsJsonEditor(); markChanged();
    });
    tableWrap.appendChild(addRowBtn);
    body.appendChild(tableWrap);

    // Delete category
    const actions = document.createElement('div');
    actions.className = 'site-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger'; delBtn.style.fontSize = '12px';
    delBtn.textContent = '🗑 Удалить категорию';
    delBtn.addEventListener('click', () => {
        if (!confirm(`Удалить категорию «${catKey}»?`)) return;
        delete currentUnits[catKey];
        renderUnitsList(); syncUnitsJsonEditor(); markChanged();
    });
    actions.appendChild(delBtn);
    body.appendChild(actions);

    body.addEventListener('input', () => { readUnitCard(card, catKey); syncUnitsJsonEditor(); markChanged(); });
    const priorityInput = body.querySelector('[data-meta="priority"]');
    priorityInput?.addEventListener('change', e => {
        e.stopPropagation();
        applyUnitPriorityInput(catKey, e.target.value);
    });
    priorityInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    });

    card.appendChild(header); card.appendChild(body);
    return card;
}

function makeUnitRow(word, multiplier, decimals = 2) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input class="unit-input" data-role="word" value="${esc(String(word))}" placeholder="кг"></td>
        <td><input class="unit-input multiplier" data-role="mult" value="${esc(String(multiplier))}" placeholder="1000"></td>
        <td><input class="unit-input" data-role="decimals" type="number" min="0" max="6" step="1" value="${esc(String(decimals))}" placeholder="2" title="0–6 знаков. Только для отображения — расчёт и сортировку не меняет."></td>
        <td style="text-align:center">
            <button class="btn-icon" type="button" title="Удалить" style="margin:0 auto">✕</button>
        </td>`;
    tr.querySelector('.btn-icon').addEventListener('click', e => {
        e.stopPropagation();
        const tbody = tr.parentElement;
        if (tbody.querySelectorAll('tr').length <= 1) { tr.querySelector('[data-role="word"]').value = ''; return; }
        tr.remove();
        tbody.closest('.site-body')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return tr;
}

function readUnitCard(card, catKey) {
    const body = card.querySelector('.site-body');
    const emoji = body.querySelector('[data-meta="emoji"]')?.value?.trim() || '';
    const name  = body.querySelector('[data-meta="name"]')?.value?.trim() || catKey;
    const base  = body.querySelector('[data-meta="base"]')?.value?.trim() || '';
    const label = (emoji ? emoji + ' ' : '') + name;
    let priority = parseInt(body.querySelector('[data-meta="priority"]')?.value, 10);
    if (!Number.isFinite(priority)) priority = 99;

    const units = {};
    body.querySelectorAll('table tbody tr').forEach(tr => {
        const word = tr.querySelector('[data-role="word"]')?.value?.trim();
        const mult = parseFloat(tr.querySelector('[data-role="mult"]')?.value) || 1;
        let dec = parseInt(tr.querySelector('[data-role="decimals"]')?.value, 10);
        if (!Number.isFinite(dec)) dec = 2;
        dec = Math.max(0, Math.min(6, dec));
        if (word) units[word] = { multiplier: mult, decimals: dec };
    });

    currentUnits[catKey] = { label, base, units, priority };

    // update header preview
    const header = card.querySelector('.site-header');
    if (header) {
        header.querySelector('.category-emoji').textContent = emoji || '📦';
        header.querySelector('.site-name').textContent = name;
        header.querySelector('.site-domains').innerHTML = `база: <b>${esc(base)}</b> · ${Object.keys(units).length} единиц · приоритет ${priority}`;
    }
    refreshUnitsTester();
}

document.getElementById('addCategoryBtn').addEventListener('click', () => {
    const name = prompt('Название новой категории (напр. «Площадь»):');
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-zа-яё0-9_]/gi,'');
    if (!key) { showToast('Недопустимое имя', 'error'); return; }
    if (currentUnits[key]) { showToast('Категория уже существует', 'error'); return; }
    const maxPriority = Math.max(0, ...Object.values(currentUnits).map(c => Number.isFinite(c.priority) ? c.priority : 0));
    currentUnits[key] = { label: name.trim(), base: '', units: {}, priority: maxPriority + 1 };
    renderUnitsList(); syncUnitsJsonEditor(); markChanged();
    const newCard = document.querySelector(`#unitsList .site-card[data-key="${key}"]`);
    if (newCard) { newCard.classList.add('open'); newCard.scrollIntoView({ behavior: 'smooth' }); }
});

document.getElementById('unitsSave').addEventListener('click', () => {
    chrome.storage.local.set({ units: currentUnits }, () => { setStatus('сохранено ✓', true); showToast('💾 Единицы сохранены', 'success'); });
});

document.getElementById('unitsReset').addEventListener('click', () => {
    if (!confirm('Сбросить единицы к стандартным?')) return;
    chrome.storage.local.remove('units', () => {
        currentUnits = JSON.parse(JSON.stringify(defaultUnits));
        virtualizationThresholdSetting = 500;
        chrome.storage.local.remove('virtualizationThreshold');
        renderVirtualizationSetting(500);
        renderUnitsList(); syncUnitsJsonEditor(); setStatus('стандартные настройки', false); showToast('↺ Сброшено', 'success');
    });
});

// Units JSON modal
function syncUnitsJsonEditor() {
    const editor = document.getElementById('unitsEditor');
    editor.value = JSON.stringify(currentUnits, null, 4);
    updateLines('unitsEditor', 'unitsJsonLines');
}

document.getElementById('showUnitsJsonBtn').addEventListener('click', () => { syncUnitsJsonEditor(); document.getElementById('unitsJsonModal').classList.add('open'); });
document.getElementById('closeUnitsJson').addEventListener('click', () => document.getElementById('unitsJsonModal').classList.remove('open'));
// backdrop click removed — close only via ✕ button or Escape
document.getElementById('validateUnitsJson').addEventListener('click', () => validateEditor('unitsEditor', 'unitsError'));
document.getElementById('applyUnitsJson').addEventListener('click', () => {
    if (!validateEditor('unitsEditor', 'unitsError', true)) return;
    currentUnits = JSON.parse(document.getElementById('unitsEditor').value);
    renderUnitsList(); markChanged();
    document.getElementById('unitsJsonModal').classList.remove('open');
    showToast('✓ JSON применён', 'success');
});
document.getElementById('unitsEditor').addEventListener('input', () => updateLines('unitsEditor', 'unitsJsonLines'));
document.getElementById('unitsEditor').addEventListener('scroll', () => {
    document.getElementById('unitsJsonLines').scrollTop = document.getElementById('unitsEditor').scrollTop;
});

// ─── Export / Import ───────────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
    const payload = {
        version: 1,
        exported: new Date().toISOString(),
        sites: currentSites,
        units: currentUnits,
        virtualizationThreshold: virtualizationThresholdSetting,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shopping-sorter-settings-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇ Настройки экспортированы', 'success');
});

document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            // support both wrapped {sites,units} format and raw sites.json
            const newSites = data.sites ?? (data[Object.keys(data)[0]]?.domains ? data : null);
            const newUnits = data.units ?? (data[Object.keys(data)[0]]?.base ? data : null);
            const newVirtualizationThreshold = Number(data.virtualizationThreshold);

            const validVirtualizationThreshold = Number.isFinite(newVirtualizationThreshold) && newVirtualizationThreshold >= VIRTUALIZATION_MIN && newVirtualizationThreshold <= VIRTUALIZATION_MAX;
            if (!newSites && !newUnits && !validVirtualizationThreshold) {
                showToast('❌ Файл не распознан', 'error'); return;
            }

            const parts = [];
            if (newSites) { currentSites = newSites; renderSiteList(); syncSitesJsonEditor(); parts.push('сайты'); }
            if (newUnits) { currentUnits = newUnits; renderUnitsList(); syncUnitsJsonEditor(); parts.push('единицы'); }
            if (validVirtualizationThreshold) { virtualizationThresholdSetting = Math.round(newVirtualizationThreshold); renderVirtualizationSetting(virtualizationThresholdSetting); parts.push('производительность'); }

            // save immediately
            const toSave = {};
            if (newSites) toSave.sites = currentSites;
            if (newUnits) toSave.units = currentUnits;
            if (validVirtualizationThreshold) toSave.virtualizationThreshold = Math.round(newVirtualizationThreshold);
            chrome.storage.local.set(toSave, () => {
                markChanged();
                showToast(`⬆ Импортировано: ${parts.join(', ')}`, 'success');
            });
        } catch (err) {
            showToast('❌ Ошибка разбора JSON: ' + err.message, 'error');
        }
        // reset so same file can be re-imported
        e.target.value = '';
    };
    reader.readAsText(file);
});

// ─── Danger zone ───────────────────────────────────────────────────────────────

document.getElementById('clearIndexedDB').addEventListener('click', () => {
    if (!confirm('Удалить все сохранённые товары?')) return;
    chrome.storage.local.remove('savedTiles', () => chrome.runtime.sendMessage({ action: 'clearImages' }, () => showToast('✅ Товары очищены', 'success')));
});

document.getElementById('resetAllBtn').addEventListener('click', () => {
    if (!confirm('Сбросить все настройки (сайты и единицы) к стандартным?')) return;
    chrome.storage.local.remove(['sites', 'units', 'virtualizationThreshold'], () => {
        currentSites = JSON.parse(JSON.stringify(defaultSites));
        currentUnits = JSON.parse(JSON.stringify(defaultUnits));
        renderSiteList(); syncSitesJsonEditor();
        renderUnitsList(); syncUnitsJsonEditor();
        setStatus('стандартные настройки', false);
        showToast('↺ Все настройки сброшены', 'success');
    });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function validateEditor(editorId, errorId, silent = false) {
    const editor = document.getElementById(editorId);
    const errorEl = document.getElementById(errorId);
    try {
        JSON.parse(editor.value);
        errorEl.textContent = '';
        errorEl.classList.remove('visible');
        if (!silent) showToast('✓ JSON корректный', 'success');
        return true;
    }
    catch (e) { errorEl.textContent = '✗ ' + e.message; errorEl.classList.add('visible'); showToast('✗ ' + e.message, 'error'); return false; }
}

function updateLines(editorId, linesId) {
    const e = document.getElementById(editorId), l = document.getElementById(linesId);
    if (!e || !l) return;
    l.textContent = Array.from({ length: e.value.split('\n').length }, (_, i) => i + 1).join('\n');
}

function markChanged() { setStatus('несохранённые изменения', true); }

function setStatus(text, active) {
    document.getElementById('statusText').textContent = text;
    document.getElementById('statusDot').className = 'status-dot' + (active ? ' ok' : '');
}

let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show ' + type;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', 2500);
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

setupSiteViewControls();
init();
// Закрытие модалов по Escape
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.getElementById('jsonModal').classList.remove('open');
    document.getElementById('unitsJsonModal').classList.remove('open');
    const diff = document.getElementById('selectorDiffModal');
    if (diff) diff.classList.remove('open');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTOR DIFF MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function renderDiffModal(data) {
    const { siteName, currentConfig, suggestedConfig, selectorStatus } = data;

    document.getElementById('diffSiteName').textContent = siteName;

    // Статус-строка
    const statusRow = document.getElementById('diffStatusRow');
    statusRow.innerHTML = ['tile','price','title','link'].map(k => {
        const st = selectorStatus?.[k] || 'ok';
        const label = { ok: '✅ OK', broken: '❌ Сломан', missing: '⚠️ Не задан' }[st] || st;
        return `<span class="diff-status-item"><b>${k}:</b> <span class="diff-badge ${st}">${label}</span></span>`;
    }).join('');

    // Генерируем JSON-строки для обеих сторон (полный конфиг сайта)
    const currentObj  = { [siteName]: currentConfig };
    const suggestedObj = { [siteName]: suggestedConfig };
    const currentLines  = JSON.stringify(currentObj,  null, 2).split('\n');
    const suggestedLines = JSON.stringify(suggestedObj, null, 2).split('\n');

    // Проверяем есть ли реальная разница
    const hasDiff = JSON.stringify(currentConfig) !== JSON.stringify(suggestedConfig);
    document.getElementById('diffApplyBtn').style.display = hasDiff ? '' : 'none';

    // Если diff нет — показываем пояснение вместо пустых колонок
    let noDiffNote = document.getElementById('diffNoDiffNote');
    if (!noDiffNote) {
        noDiffNote = document.createElement('div');
        noDiffNote.id = 'diffNoDiffNote';
        noDiffNote.style.cssText = 'grid-column:1/-1; padding:24px 28px; font-size:15px; line-height:1.7; color:#555; text-align:center; background:#fffbf0; border-top:2px solid #ffe082;';
        document.querySelector('.diff-cols').after(noDiffNote);
    }
    if (!hasDiff) {
        noDiffNote.style.display = '';
        noDiffNote.innerHTML = '⚠️ Не удалось автоматически определить варианты исправления.<br>' +
            '<span style="font-size:11px">Откройте DevTools (Ctrl+Shift+I) → Elements, найдите повторяющийся элемент карточки и введите его селектор вручную.</span>';
    } else {
        noDiffNote.style.display = 'none';
    }

    function renderDiffLines(container, lines, otherLines, side) {
        container.innerHTML = '';
        lines.forEach((line, i) => {
            const span = document.createElement('span');
            span.className = 'diff-line';
            span.textContent = line;
            const other = otherLines[i];
            if (other === undefined) {
                span.classList.add(side === 'current' ? 'removed' : 'added');
            } else if (line !== other) {
                span.classList.add(side === 'current' ? 'changed-old' : 'changed-new');
            }
            container.appendChild(span);
        });
    }

    renderDiffLines(document.getElementById('diffCurrentEditor'),  currentLines,  suggestedLines, 'current');
    renderDiffLines(document.getElementById('diffSuggestedEditor'), suggestedLines, currentLines,  'suggested');

    // Синхронизация скролла
    const curEl = document.getElementById('diffCurrentEditor');
    const sugEl = document.getElementById('diffSuggestedEditor');
    curEl.onscroll = () => { sugEl.scrollTop = curEl.scrollTop; };
    sugEl.onscroll = () => { curEl.scrollTop = sugEl.scrollTop; };

    document.getElementById('selectorDiffModal').classList.add('open');

    // Применить предложенные — заменяем весь конфиг сайта (или добавляем новый)
    const isNewSite = !currentSites[siteName];
    document.getElementById('diffApplyBtn').textContent = isNewSite
        ? '✓ Добавить сайт' : '✓ Применить предложенные';
    document.getElementById('diffApplyBtn').onclick = () => {
        currentSites[siteName] = { ...suggestedConfig };
        renderSiteList();
        markChanged();
        // Сохраняем сразу
        chrome.storage.local.set({ sites: currentSites }, () => {
            setStatus('сохранено ✓', true);
        });
        document.getElementById('selectorDiffModal').classList.remove('open');
        showToast('✓ Селекторы обновлены', 'success');
        chrome.storage.local.remove('_selectorDiffPending');
    };
}

document.getElementById('closeDiffModal').addEventListener('click', () => {
    document.getElementById('selectorDiffModal').classList.remove('open');
    chrome.storage.local.remove('_selectorDiffPending');
});

// При загрузке страницы проверяем есть ли pending diff — читаем и сразу удаляем
chrome.storage.local.get('_selectorDiffPending', result => {
    if (result._selectorDiffPending) {
        chrome.storage.local.remove('_selectorDiffPending');
        setTimeout(() => {
            renderDiffModal(result._selectorDiffPending);
        }, 400);
    }
});