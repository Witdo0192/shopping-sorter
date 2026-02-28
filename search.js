console.log('✅ Ozon Sorter search.js загружен');

// ─── Парсер поисковых запросов ────────────────────────────────────────────────

function wordToRegex(word) {
    // Экранируем спецсимволы regex, но оставляем [] нетронутыми — они обработаются ниже
    // Порядок: сначала проверяем наличие [] и заменяем на regex-класс символов
    // [ио] → [ио], [аб] → [аб] и т.д.
    // Экранируем всё кроме *, ?, [] и их содержимого
    let pattern = '';
    let i = 0;
    while (i < word.length) {
        const ch = word[i];
        if (ch === '[') {
            // Найти закрывающую скобку
            const end = word.indexOf(']', i + 1);
            if (end !== -1) {
                // Содержимое [...] — варианты символов, передаём как regex character class
                const inner = word.slice(i + 1, end);
                // Экранируем спецсимволы внутри класса (кроме дефиса в конце/начале)
                pattern += '[' + inner.replace(/[.+^${}()|\\]/g, '\\$&') + ']';
                i = end + 1;
                continue;
            }
        }
        if (ch === '*') { pattern += '.*'; i++; continue; }
        if (ch === '?') { pattern += '.';  i++; continue; }
        // Экранируем спецсимволы regex
        pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        i++;
    }
    return { regex: new RegExp(pattern, 'i'), exclude: false };
}

// Нормализует текст: заменяет все варианты десятичных разделителей на '.'
// и убирает символы-разделители тысяч, чтобы '0，5', '0·5', '0 5' → '0.5'
function normalizeNumberText(text) {
    return text
        // Типографские и unicode варианты запятой/точки как десятичного разделителя
        .replace(/[\uFF0C\u066B\u00B7\u2019\u2018]/g, ',') // fullwidth comma, arabic decimal, middle dot, quotes
        // Неразрывные пробелы между цифрами — убираем (разделители тысяч)
        .replace(/(\d)[\u00A0\u202F\u2009\u2007](\d)/g, '$1$2')
        // Обычные пробелы как разделители тысяч: строго 3 цифры после пробела (1 000, 10 000)
        .replace(/(\d{1,3}) (\d{3})(?!\d)/g, '$1$2')
        // Дробные числа записанные через пробел вместо точки/запятой:
        // "0 5 кг" → "0.5 кг", "1 95л" → "1.95л"
        // Правило: 1-2 цифры после пробела, за которыми не-цифра или конец строки
        // (тысячи уже обработаны выше и имеют ровно 3 цифры)
        .replace(/(?<![.,])(\d) (\d{1,2})(?=\D|$)/g, '$1.$2');
}

// Проверяет, содержит ли текст число в диапазоне [min, max]
function textContainsNumberInRange(text, min, max) {
    const normalized = normalizeNumberText(text);
    // Матчим автономные числа:
    // Lookbehind: не должно быть буквы, цифры или разделителя (.,) перед числом
    //   → блокирует артикулы (K0004), версии (v2.0), слитные слова (iPhone15)
    //   → X/x не блокирует — чтобы размеры "50x30" парсились как [50, 30]
    // Lookahead: не должно быть разделителя или цифры после
    //   → число может заканчиваться буквой-единицей (1.95л, 0.5кг) — это ОК
    const numRe = /(?<![A-WYZa-wyzА-Яа-яЁё\d.,])(\d+(?:[.,]\d+)*)(?![.,\d])/g;
    let match;
    while ((match = numRe.exec(normalized)) !== null) {
        const v = parseFloat(match[1].replace(',', '.'));
        if (v >= min && v <= max) return true;
    }
    return false;
}


// Гибкое выражение внутри кавычек:
// !"({1-2} кг|{1000-2000} (гр|грамм|г))"
// Пробелы в таком выражении трактуются как \s*, а '~' — явный необязательный пробел.
// Диапазоны проверяются по фактическим числам после совпадения regex.
function splitTopLevelExpression(str, separator='|') {
    const out=[]; let start=0, depth=0, quote=false, brace=0;
    for(let i=0;i<str.length;i++){
        const ch=str[i];
        if(ch==='"'){ quote=!quote; continue; }
        if(quote) continue;
        if(ch==='(') depth++;
        else if(ch===')') depth=Math.max(0,depth-1);
        else if(ch==='{') brace++;
        else if(ch==='}') brace=Math.max(0,brace-1);
        else if(ch===separator && depth===0 && brace===0){ out.push(str.slice(start,i)); start=i+1; }
    }
    out.push(str.slice(start));
    return out;
}
function findMatchingParen(str, start) {
    let depth=0, quote=false;
    for(let i=start;i<str.length;i++){
        if(str[i]==='"'){quote=!quote;continue;}
        if(quote) continue;
        if(str[i]==='(') depth++;
        else if(str[i]===')' && --depth===0) return i;
    }
    return -1;
}
function compileFlexibleExpression(expr) {
    const ranges=[];
    let groupCount=0;
    function compileSeq(src) {
        let out='';
        for(let i=0;i<src.length;){
            const ch=src[i];
            if(ch==='('){
                const end=findMatchingParen(src,i);
                if(end!==-1){
                    const inner=src.slice(i+1,end);
                    const parts=splitTopLevelExpression(inner);
                    out += '(?:' + parts.map(compileSeq).join('|') + ')';
                    i=end+1; continue;
                }
            }
            if(ch==='{'){
                const end=src.indexOf('}',i+1);
                if(end!==-1){
                    const inner=src.slice(i+1,end).trim();
                    const m=inner.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:\.{2,3}|[–-]|до)\s*(-?\d+(?:[.,]\d+)?)$/i);
                    if(m){
                        const min=parseFloat(m[1].replace(',','.')), max=parseFloat(m[2].replace(',','.'));
                        ranges.push({min,max});
                        groupCount++;
                        out += '(-?\\d+(?:[.,]\\d+)?)';
                        i=end+1; continue;
                    }
                }
            }
            if(ch==='~'){ out+='\\s*'; i++; continue; }
            if(/\s/.test(ch)){
                while(i<src.length && /\s/.test(src[i])) i++;
                out+='\\s*'; continue;
            }
            // обычный текст до следующего спецсимвола
            let j=i;
            while(j<src.length && !/[(){}~\s]/.test(src[j])) j++;
            out += src.slice(i,j).replace(/[.+^$\\[\]]/g,'\\$&');
            i=j;
        }
        return out;
    }
    const parts=splitTopLevelExpression(expr);
    const pattern=parts.map(compileSeq).join('|');
    if(!pattern) return null;
    try { return {regex:new RegExp(pattern,'i'), ranges}; } catch { return null; }
}
function matchesFlexibleExpression(text, expr) {
    const t=normalizeNumberText(text);
    const compiled=compileFlexibleExpression(expr);
    if(!compiled) return false;
    const m=compiled.regex.exec(t);
    if(!m) return false;
    let group=1;
    for(const r of compiled.ranges){
        const raw=m[group++];
        if(raw==null) continue; // диапазон находится в другой ветке OR
        const value=parseFloat(raw.replace(',','.'));
        if(!Number.isFinite(value) || value<r.min || value>r.max) return false;
    }
    return true;
}

function splitByPipe(str) {
    const parts = [];
    let current = '';
    let inQuote = false;
    for (const ch of str) {
        if (ch === '"') { inQuote = !inQuote; current += ch; }
        else if (ch === '|' && !inQuote) { parts.push(current.trim()); current = ''; }
        else { current += ch; }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.map(part => {
        if (part.startsWith('"') && part.endsWith('"')) {
            return { type: 'phrase', value: part.slice(1, -1).toLowerCase() };
        }
        return { type: 'word', regex: wordToRegex(part).regex };
    });
}

// ─── Диапазоны дат для полей-дат (@доставка / @дата) ──────────────────────────
// Раньше диапазон вида {02.09-09.09.2026} по ошибке уходил в общий числовой
// парсер диапазонов ({-?\d+(?:[.,]\d+)?}), который понимает только ОДНУ группу
// цифр после точки — поэтому "9.09.2026" (две точки) вообще не распознавался
// как число, а само сравнение шло не по датам, а по "ДД.ММ", притворяющемуся
// десятичной дробью (02.09 → 2.09) — отсюда и работало только совпадение
// месяцев без года. Здесь — отдельный, полноценный разбор дат.

function isDateFieldName(name) {
    try {
        if (typeof normalizePrimarySearchFieldName === 'function') {
            return normalizePrimarySearchFieldName(name) === 'delivery';
        }
    } catch (_) { /* content.js мог ещё не выполниться — используем локальный фоллбэк ниже */ }
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
    return n === 'доставка' || n === 'дата' || n === 'delivery';
}

// Один "край" диапазона: 'ДД.ММ', 'ДД.ММ.ГГ(ГГ)' или '*' (открытая граница).
function parseSingleDateToken(str) {
    const s = String(str || '').trim();
    if (s === '*') return { open: true };
    const m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    if (day < 1 || day > 31 || month < 0 || month > 11) return null;
    let year = m[3] != null ? parseInt(m[3], 10) : null;
    if (year != null && year < 100) year += 2000;
    return { open: false, day, month, year };
}

// Собирает диапазон timestamp'ов из двух краёв с учётом наследования года
// (год, заданный явно только на одной границе, применяется и к другой)
// и открытых границ '*' (± бесконечность).
function buildDateRangeTs(leftRaw, rightRaw) {
    const left = parseSingleDateToken(leftRaw);
    const right = parseSingleDateToken(rightRaw);
    if (!left || !right) return null;
    if (left.open && right.open) return null; // обе границы открыты — не диапазон

    const currentYear = new Date().getFullYear();
    const leftYear = left.open ? null : (left.year ?? right.year ?? currentYear);
    const rightYear = right.open ? null : (right.year ?? left.year ?? currentYear);

    const minTs = left.open ? -Infinity : new Date(leftYear, left.month, left.day, 0, 0, 0, 0).getTime();
    const maxTs = right.open ? Infinity : new Date(rightYear, right.month, right.day, 23, 59, 59, 999).getTime();
    if (!(minTs <= maxTs)) return null;
    return { minTs, maxTs };
}

// Разбирает ОДНУ дату или ОДИН диапазон (без учёта |): со скобками {...} или без.
// Возвращает {minTs, maxTs} или null, если это не похоже на дату/диапазон.
function parseOneDatePart(rawPart) {
    let body = String(rawPart || '').trim();
    if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1).trim();
    if (!body) return null;

    const dashIdx = body.indexOf('-');
    if (dashIdx === -1) {
        // Одиночная дата — весь этот день целиком.
        const d = parseSingleDateToken(body);
        if (!d || d.open) return null;
        const year = d.year ?? new Date().getFullYear();
        return {
            minTs: new Date(year, d.month, d.day, 0, 0, 0, 0).getTime(),
            maxTs: new Date(year, d.month, d.day, 23, 59, 59, 999).getTime(),
        };
    }
    return buildDateRangeTs(body.slice(0, dashIdx), body.slice(dashIdx + 1));
}


function parseNumericAtom(raw) {
    const s = String(raw || '').trim();
    const normUnit = u => String(u || '').trim().toLowerCase().replace(/^\//,'').replace(/\s+/g,'');
    const withUnit = (base, tail) => { const unit=normUnit(tail); return unit ? {...base, unit} : base; };
    const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:\.{2,3}|[–-]|до)\s*(-?\d+(?:[.,]\d+)?|\*)(?:\s+(.+))?$/i);
    if (m) {
        const min = parseFloat(m[1].replace(',', '.'));
        const max = m[2] === '*' ? Infinity : parseFloat(m[2].replace(',', '.'));
        return Number.isFinite(min) && (max === Infinity || Number.isFinite(max)) && min <= max ? withUnit({min, max}, m[3]) : null;
    }
    const openMin = s.match(/^\*\s*(?:[–-])\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (openMin) { const max=parseFloat(openMin[1].replace(',', '.')); return Number.isFinite(max) ? withUnit({min:-Infinity,max},openMin[2]) : null; }
    const mo = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (mo) { const v=parseFloat(mo[1].replace(',', '.')); return Number.isFinite(v) ? withUnit({min:v,max:v},mo[2]) : null; }
    return null;
}
function tryParseNumericFieldBody(rawBody) {
    const body=String(rawBody||'').trim(); if(!body) return null;
    const parts=body.replace(/;/g,' ').split(/\s+/).filter(Boolean);
    if(!parts.length) return null;
    const items=[];
    for(const raw of parts){
        let exclude=false, part=raw;
        if(part.startsWith('!')){exclude=true;part=part.slice(1);}
        const r=parseNumericAtom(part); if(!r) return null;
        items.push({...r,exclude});
    }
    return {items};
}
function matchesNumericFieldText(text, query) {
    const normalized=normalizeNumberText(String(text??''));
    const entries=[]; const numRe=/(?<![A-WYZa-wyzА-Яа-яЁё\d.,])(-?\d+(?:[.,]\d+)?)(?![.,\d])/g;
    let m; while((m=numRe.exec(normalized))!==null){ const v=parseFloat(m[1].replace(',','.')); if(Number.isFinite(v)) entries.push({value:v, unit:normalized.slice(m.index+m[0].length).match(/^\s*(?:\/\s*)?([^\d\s.,;|)]+)/)?.[1]?.toLowerCase().replace(/\s+/g,'') || ''}); }
    if(!entries.length) return false;
    const matches=(r,e)=>e.value>=r.min&&e.value<=r.max&&(!r.unit || e.unit===r.unit || e.unit.includes(r.unit) || r.unit.includes(e.unit));
    const positive=query.items.filter(x=>!x.exclude), negative=query.items.filter(x=>x.exclude);
    const posOk=positive.length ? positive.some(r=>entries.some(e=>matches(r,e))) : true;
    const negHit=negative.some(r=>entries.some(e=>matches(r,e)));
    return posOk && !negHit;
}

// Разбирает содержимое @доставка(...) целиком: одну дату/диапазон, или несколько
// через | — @доставка({02.09-05.09}|{10.09-15.09}) / @доставка(02.09-05.09|10.09.2026)
// / @доставка({02.09-05.09|10.09-15.09}). Совпадение — если дата попадает
// ХОТЯ БЫ в один из перечисленных диапазонов (OR).
// Возвращает {ranges:[{minTs,maxTs}, ...]} или null, если хоть одна часть не
// похожа на дату (тогда используется обычный текстовый разбор — не ломаем
// нестандартное использование поля).
function tryParseDateFieldBody(rawBody) {
    let body = String(rawBody || '').trim();
    if (!body) return null;
    if (body.startsWith('{') && body.endsWith('}') && findMatchingParenLike(body, '{', '}', 0) === body.length - 1) body = body.slice(1, -1).trim();
    const parts = body.replace(/;/g, ' ').replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const ranges=[];
    for (let part of parts) {
        let exclude=false;
        if(part.startsWith('!')){ exclude=true; part=part.slice(1).trim(); }
        const r=parseOneDatePart(part);
        if(!r) return null;
        ranges.push({...r, exclude});
    }
    return { ranges };
}

// Аналог findMatchingParen, но для произвольной пары открывающего/закрывающего символа.
function findMatchingParenLike(str, open, close, start) {
    let depth = 0;
    for (let i = start; i < str.length; i++) {
        if (str[i] === open) depth++;
        else if (str[i] === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
}


function isNumericPrimaryFieldName(name) {
    const n=String(name||'').trim().toLowerCase().replace(/\s+/g,'');
    return ['цена','стоимость','цена/ед','цена/ед.','ценазаединицу','рейтинг','отзывы','оценки'].includes(n);
}

function parseSearchQuery(searchQuery) {
    const tokens = [];
    let i = 0;
    const s = String(searchQuery ?? '').trim();

    while (i < s.length) {
        if (/\s/.test(s[i])) { i++; continue; }

        let exclude = false;
        if (s[i] === '!') { exclude = true; i++; while (i < s.length && /\s/.test(s[i])) i++; }

        // Атрибут имеет строго ограниченную область запроса:
        // @имя_атрибута(поисковый запрос)
        // @имя_атрибута() — атрибут присутствует
        // @имя_атрибута(!) — атрибут отсутствует
        // @имя_атрибута(!запрос) — атрибут не содержит запрос
        // Внутри скобок используется тот же синтаксис, включая !, (), |, "", {}, *, ?.
        if (s[i] === '@') {
            let j = i + 1;
            // Имя поля может содержать буквы/цифры, подчёркивания, дефисы и '/'
            // (например, @цена/ед.). Точку специально не включаем, чтобы не
            // конфликтовать с обычным текстовым поиском и дробными значениями.
            while (j < s.length && /[\p{L}\p{N}_\/.-]/u.test(s[j])) j++;
            const name = s.slice(i + 1, j).trim();
            if (name && s[j] === '(') {
                const pe = findMatchingParen(s, j);
                if (pe !== -1) {
                    const innerText = s.slice(j + 1, pe).trim();
                    let presence = null;
                    let innerTokens = [];
                    let dateQuery = null;
                    if (innerText === '') {
                        // Пустые скобки: атрибут должен присутствовать.
                        presence = 'exists';
                    } else if (innerText === '!') {
                        // Одинокий !: атрибут должен отсутствовать.
                        presence = 'missing';
                    } else if (isDateFieldName(name)) {
                        // @доставка(...) / @дата(...) — отдельный разбор дат, а не общий
                        // числовой/текстовый механизм (см. tryParseDateFieldBody выше).
                        let dateExclude = false;
                        let dateBody = innerText;
                        if (dateBody.startsWith('!')) { dateExclude = true; dateBody = dateBody.slice(1).trim(); }
                        const range = tryParseDateFieldBody(dateBody);
                        if (range) {
                            dateQuery = { ranges: range.ranges, exclude: dateExclude };
                        } else {
                            // Не похоже на дату/диапазон — не ломаем поведение, используем обычный разбор.
                            innerTokens = parseSearchQuery(innerText);
                        }
                    } else if (isNumericPrimaryFieldName(name)) {
                        const numericQuery = tryParseNumericFieldBody(innerText);
                        if (numericQuery) dateQuery = null;
                        if (numericQuery) {
                            tokens.push({ type:'field', name, presence, exclude, innerTokens:[], numericQuery });
                            i = pe + 1;
                            continue;
                        }
                        innerTokens = parseSearchQuery(innerText);
                    } else {
                        // ! внутри запроса остаётся обычным отрицанием значения:
                        // @атрибут(!32) — атрибут не содержит 32.
                        innerTokens = parseSearchQuery(innerText);
                    }
                    tokens.push({
                        type: 'field',
                        name,
                        presence,
                        exclude,
                        innerTokens,
                        dateQuery
                    });
                    i = pe + 1;
                    continue;
                }
            }
        }

        // Диапазон чисел: {5...7}, {5..7}, {5.5-10.2}, {5 до 7}
        if (s[i] === '{') {
            const end = s.indexOf('}', i + 1);
            if (end !== -1) {
                const inner = s.slice(i + 1, end).trim();
                const rangeMatch = inner.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:\.{2,3}|[–-]|до)\s*(-?\d+(?:[.,]\d+)?)$/i);
                if (rangeMatch) {
                    const min = parseFloat(rangeMatch[1].replace(',', '.'));
                    const max = parseFloat(rangeMatch[2].replace(',', '.'));
                    tokens.push({ type: 'range', min, max, exclude });
                    i = end + 1;
                    continue;
                }
            }
        }

        // Группа OR: (a|b|c), с поддержкой вложенных групп.
        if (s[i] === '(') {
            const end = findMatchingParen(s, i);
            if (end !== -1) {
                const inner = s.slice(i + 1, end);
                const variants = splitTopLevelExpression(inner).map(part => {
                    const partTokens = parseSearchQuery(part.trim());
                    return { type: 'query-group', tokens: partTokens };
                });
                tokens.push({ type: 'or-group', variants, exclude });
                i = end + 1;
                continue;
            }
        }

        if (s[i] === '"') {
            const end = s.indexOf('"', i + 1);
            if (end !== -1) {
                const value = s.slice(i + 1, end);
                if (/[{}()|~]/.test(value)) tokens.push({ type: 'flex', expr: value, exclude });
                else tokens.push({ type: 'phrase', value: value.toLowerCase(), exclude });
                i = end + 1;
                continue;
            }
        }

        // Обычное слово. Для ! сохраняем отрицание в token.exclude.
        let end = i;
        while (end < s.length && !/\s/.test(s[end])) end++;
        const word = s.slice(i, end);
        const parsed = wordToRegex(word);
        tokens.push({ type: 'word', regex: parsed.regex, exclude: exclude || parsed.exclude });
        i = end;
    }

    return tokens;
}

function matchesQueryTokens(text, tokens) {
    const t = normalizeNumberText(String(text ?? ''));
    return tokens.every(token => {
        if (token.type === 'or-group') {
            const matched = token.variants.some(v => matchesQueryTokens(t, v.tokens));
            return token.exclude ? !matched : matched;
        }
        const matched = matchesToken(t, token);
        return token.exclude ? !matched : matched;
    });
}

function matchesTileSearchTokens(tile, tokens) {
    const title = getTileTitle?.(tile) || '';
    return tokens.every(token => {
        if (token.type === 'field') {
            const targetName = String(token.name).trim().toLowerCase();
            const primaryField = normalizePrimarySearchFieldName?.(targetName);
            if (primaryField) {
                // Диапазон дат (@доставка({02.09-09.09.2026}) и т.п.) — сравниваем напрямую
                // по timestamp'у даты доставки, а не через текстовое представление поля.
                if (primaryField === 'delivery' && token.dateQuery) {
                    const ts = getDeliveryDate(tile);
                    const positives=token.dateQuery.ranges.filter(r=>!r.exclude);
                    const negatives=token.dateQuery.ranges.filter(r=>r.exclude);
                    const inPositive=positives.length ? positives.some(r => ts != null && ts >= r.minTs && ts <= r.maxTs) : true;
                    const inNegative=negatives.some(r => ts != null && ts >= r.minTs && ts <= r.maxTs);
                    const matched=inPositive && !inNegative;
                    return token.exclude ? !matched : matched;
                }
                const fieldText = formatPrimarySearchFieldValue(tile, primaryField);
                if (token.numericQuery) {
                    const matched=matchesNumericFieldText(fieldText, token.numericQuery);
                    return token.exclude ? !matched : matched;
                }
                if (token.presence === 'exists') return token.exclude ? !fieldText : !!fieldText;
                if (token.presence === 'missing') return token.exclude ? !!fieldText : !fieldText;
                return token.exclude
                    ? !matchesQueryTokens(fieldText, token.innerTokens)
                    : matchesQueryTokens(fieldText, token.innerTokens);
            }

            const profile = getSelectorProfileForTile?.(tile);
            const items = (profile?.extras || []).filter(item =>
                String(item?.name || '').trim().toLowerCase() === targetName
            );
            const found = items.some(item => {
                const selector = item?.selector;
                if (!selector) return false;
                try {
                    return findAllWithinTileOrSelf?.(tile, selector)?.length > 0;
                } catch {
                    return false;
                }
            });

            if (token.presence === 'exists') return token.exclude ? !found : found;
            if (token.presence === 'missing') return token.exclude ? found : !found;

            // У дополнительного атрибута может быть несколько элементов/значений.
            // Условие атрибута выполняется по всему набору значений карточки.
            const extra = getExtraTileAttributes?.(tile) || {};
            const values = Object.entries(extra)
                .filter(([name]) => String(name).trim().toLowerCase() === targetName)
                .flatMap(([, value]) => Array.isArray(value) ? value : [value])
                .filter(v => v != null && String(v).trim() !== '');
            const fieldText = values.join(' | ');
            return token.exclude ? !matchesQueryTokens(fieldText, token.innerTokens) : matchesQueryTokens(fieldText, token.innerTokens);
        }
        const matched = matchesToken(title, token);
        return token.exclude ? !matched : matched;
    });
}

function matchesToken(text, token) {
    // Нормализуем текст — приводим "0 5 кг" → "0.5 кг", "1 95л" → "1.95л"
    // чтобы поиск работал даже если сайт не использует точку в числах
    const t = normalizeNumberText(text);
    if (token.type === 'phrase') return t.includes(token.value);
    if (token.type === 'flex') return matchesFlexibleExpression(t, token.expr);
    if (token.type === 'field') return matchesQueryTokens(t, token.innerTokens || []);
    if (token.type === 'word') return token.regex.test(t);
    if (token.type === 'range') return textContainsNumberInRange(t, token.min, token.max);
    if (token.type === 'or-group') return token.variants.some(v => matchesQueryTokens(t, v.tokens || []));
    return true;
}