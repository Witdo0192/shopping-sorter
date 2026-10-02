// Правила @сортировка, значения полей и сравнение товаров.
// Не зависит от DOM панели; использует функции извлечения данных products.

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
