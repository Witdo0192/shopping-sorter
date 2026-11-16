// Синхронизация строки поиска и полей фильтра.
// dependencies связывает эту часть с состоянием и действиями панели.
function createLinkedFilters(dependencies) {
    let linkedFiltersEnabled = true;
    let linkedFiltersSyncing = false;
    let linkedFiltersStatus = null;

    chrome.storage.local.get(['linkedFiltersEnabled'], d => {
        linkedFiltersEnabled = d.linkedFiltersEnabled !== false;
        if (linkedFiltersStatus) updateLinkedFiltersStatus();
    });

    function getLinkedFieldInputSet(field) {
        return {
            price: [dependencies.priceMin, dependencies.priceMax],
            perunit: [dependencies.priceUnitMin, dependencies.priceUnitMax],
            rating: [dependencies.ratingMin, dependencies.ratingMax],
            reviews: [dependencies.reviewsMin, dependencies.reviewsMax],
            delivery: [dependencies.deliveryMin, dependencies.deliveryMax]
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
        const query = dependencies.searchInput.value.trim();
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
        let query=dependencies.searchInput.value.trim();
        // Удаляем только простые primary-field clauses. Остальной пользовательский
        // запрос (например, «корм*») сохраняем. Сложные field-выражения не трогаем.
        const simpleClauseRe=/@([\p{L}\p{N}_\/.-]+)\((\{[^(){}]+\})\)/giu;
        query=query.replace(simpleClauseRe, (full,name)=> isSimpleLinkedFieldClauseName(name) ? '' : full).replace(/\s{2,}/g,' ').trim();
        if (clauses.length) query=query ? `${query} ${clauses.join(' ')}` : clauses.join(' ');
        linkedFiltersSyncing=true;
        dependencies.searchInput.value=query;
        linkedFiltersSyncing=false;
        updateLinkedFiltersStatus();
        dependencies.searchInput.dispatchEvent(new Event('input',{bubbles:true}));
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
    dependencies.rangeRow2.appendChild(linkedToggleWrap);
    dependencies.rangeRow2.appendChild(linkedFiltersStatus);

    [dependencies.priceMin, dependencies.priceMax, dependencies.priceUnitMin, dependencies.priceUnitMax, dependencies.ratingMin, dependencies.ratingMax, dependencies.reviewsMin, dependencies.reviewsMax, dependencies.deliveryMin, dependencies.deliveryMax].forEach(input => {
        input.addEventListener('input', () => { syncSearchFromFields(); dependencies.scheduleApplyFilters(); });
    });

    return { syncFieldsFromSearch };
}
