// Количества и единая цена за единицу для фильтров, сортировки и бейджей.
// Использует конфигурацию UNITS, настройки бейджей, поля и метрики карточек.

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
