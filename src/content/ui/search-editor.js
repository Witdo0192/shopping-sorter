// Поле поиска и автодополнение.
// dependencies связывает эту часть с состоянием и действиями панели.
function createSearchEditor(dependencies) {
    const searchInputWrap = document.createElement('div');
    searchInputWrap.style.cssText = 'position:relative; flex:1; display:flex;';

    const searchInput = document.createElement('textarea');
    searchInput.rows = 1;
    searchInput.placeholder = '🔍 Например: корм @цена({500-1000}) @рейтинг({4.5-5}) @сортировка(цена, возр)';
    searchInput.style.cssText = `
        flex:1; min-width:0; min-height:38px; max-height:120px;
        padding:8px 12px; border:1px solid #ddd; border-radius:6px;
        font:14px sans-serif; line-height:20px; outline:none; resize:none;
        overflow-x:hidden; overflow-y:hidden; box-sizing:border-box;
    `;
    function autoResizeSearchInput() {
        const maxHeight = 120;
        searchInput.style.height = 'auto';
        const h = Math.min(Math.max(searchInput.scrollHeight, 38), maxHeight);
        searchInput.style.height = h + 'px';
        searchInput.style.overflowY = searchInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
    let _searchResizeRaf = null;
    function scheduleAutoResizeSearchInput() {
        // rAF вместо прямого вызова на каждый input — сам по себе ресайз
        // читает scrollHeight (форсирует layout), это дешевле делать один раз
        // за кадр, чем на каждое нажатие клавиши подряд при быстром наборе.
        if (_searchResizeRaf != null) return;
        _searchResizeRaf = requestAnimationFrame(() => {
            _searchResizeRaf = null;
            autoResizeSearchInput();
        });
    }
    searchInput.addEventListener('input', scheduleAutoResizeSearchInput);
    searchInputWrap.appendChild(searchInput);

    // ── Автодополнение @атрибутов и подсказки диапазонов ──
    // Данные берутся ИСКЛЮЧИТЕЛЬНО из attributeSuggestCache (см.
    // rebuildAttributeSuggestCache), который пересчитывается только при
    // обновлении набора карточек (там же, где остальные плейсхолдеры), а
    // не при каждом нажатии клавиши. Здесь — только чтение кэша и
    // лёгкий разбор текста самого поля ввода, поэтому рекурсий и
    // повторных проходов по карточкам тут нет.
    const attrAutocomplete = document.createElement('div');
    attrAutocomplete.style.cssText = `
        display:none; position:absolute; top:calc(100% + 4px); left:0; right:0;
        background:#fff; border:1px solid #ddd; border-radius:8px;
        box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:100000;
        max-height:260px; overflow:auto; font-size:12px;
    `;
    searchInputWrap.appendChild(attrAutocomplete);

    let attrAcItems = [];      // текущие варианты для режима 'name'
    let attrAcHighlight = -1;  // индекс подсвеченного варианта
    let attrAcMode = 'none';   // 'none' | 'name' | 'value'
    let attrAcNameStart = -1;  // индекс начала «@имя» для замены при выборе

    function hideAttrAutocomplete() {
        attrAutocomplete.style.display = 'none';
        attrAcMode = 'none';
        attrAcItems = [];
        attrAcHighlight = -1;
    }

    // Определяет, что сейчас происходит в позиции курсора:
    // — печатается имя атрибута после '@' (mode:'name'),
    // — курсор внутри уже открытых скобок '@имя(...)' (mode:'value'),
    // — ни то, ни другое (mode:'none').
    // Однопроходный разбор без рекурсии, стоимость — O(длины строки поиска).
    function getAttrCursorContext(text, pos) {
        const s = text.slice(0, pos);
        const stack = [];
        let i = 0;
        while (i < s.length) {
            const ch = s[i];
            if (ch === '@') {
                let j = i + 1;
                while (j < s.length && /[\p{L}\p{N}_\/.-]/u.test(s[j])) j++;
                const name = s.slice(i + 1, j);
                if (s[j] === '(') {
                    stack.push(name);
                    i = j + 1;
                    continue;
                }
                if (j === s.length && name.length >= 0) {
                    return { mode: 'name', prefix: name, start: i };
                }
                i = j;
                continue;
            }
            if (ch === '(') { stack.push(null); i++; continue; }
            if (ch === ')') { if (stack.length) stack.pop(); i++; continue; }
            i++;
        }
        for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k] != null) return { mode: 'value', name: stack[k] };
        }
        return { mode: 'none' };
    }

    function renderAttrAcNameList(items) {
        attrAutocomplete.innerHTML = '';
        if (!items.length) { hideAttrAutocomplete(); return; }
        items.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.style.cssText = `
                padding:6px 10px; cursor:pointer; display:flex; gap:8px;
                align-items:baseline; justify-content:space-between;
                background:${idx === attrAcHighlight ? '#e3f2fd' : '#fff'};
            `;
            const nameEl = document.createElement('span');
            nameEl.textContent = '@' + entry.name;
            nameEl.style.cssText = 'font-weight:600; color:#1565C0; white-space:nowrap;';
            const hintEl = document.createElement('span');
            hintEl.textContent = entry.hint || '';
            hintEl.style.cssText = 'color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:ltr; text-align:left;';
            row.appendChild(nameEl);
            row.appendChild(hintEl);
            // mousedown, а не click — чтобы выбор срабатывал раньше blur'а поля.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectAttrAcItem(entry);
            });
            row.addEventListener('mouseenter', () => {
                attrAcHighlight = idx;
                [...attrAutocomplete.children].forEach((c, i2) => {
                    c.style.background = i2 === attrAcHighlight ? '#e3f2fd' : '#fff';
                });
            });
            attrAutocomplete.appendChild(row);
        });
        attrAutocomplete.style.display = 'block';
    }

    function renderAttrAcHint(name) {
        // @сортировка — специальная DSL-команда, а не атрибут карточки.
        if (name.trim().toLowerCase() === 'сортировка') {
            attrAutocomplete.innerHTML = '';
            const row = document.createElement('div');
            row.style.cssText = 'padding:6px 10px; color:#666;';
            row.textContent = 'Сортировка: @сортировка(поле, возр/убыв) · для текста также а-я / я-а';
            attrAutocomplete.appendChild(row);
            attrAutocomplete.style.display = 'block';
            return;
        }
        const entry = dependencies.attributeSuggestCache.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
        attrAutocomplete.innerHTML = '';
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 10px; color:#666;';
        if (!entry) {
            row.textContent = `Атрибут «${name}» не встречается среди текущих карточек`;
            row.style.color = '#b26a00';
        } else if (entry.static) {
            row.textContent = entry.hint || `@${entry.name}`;
        } else if (entry.hint) {
            row.textContent = (entry.kind.endsWith('text') ? 'Например: ' : 'Диапазон: ') + entry.hint;
        } else {
            row.textContent = `@${entry.name} — значения не найдены среди текущих карточек`;
        }
        attrAutocomplete.appendChild(row);
        attrAutocomplete.style.display = 'block';
    }

    function selectAttrAcItem(entry) {
        const value = searchInput.value;
        const before = value.slice(0, attrAcNameStart);
        const afterCursorIdx = searchInput.selectionStart ?? value.length;
        const after = value.slice(afterCursorIdx);
        let insertion;
        if (entry.sortStage === 'field') insertion = entry.name + ', ';
        else if (entry.sortStage === 'direction') insertion = entry.name + ')';
        else insertion = '@' + entry.name + '(';
        // Для выбора поля сортировки заменяем только текущую часть после '('.
        if (entry.sortStage) {
            const cursor = afterCursorIdx;
            const query = value.slice(0, cursor);
            const open = query.lastIndexOf('(');
            const comma = query.lastIndexOf(',');
            const start = entry.sortStage === 'field' ? open + 1 : comma + 1;
            const prefixBefore = value.slice(0, start);
            searchInput.value = prefixBefore + insertion + after;
            const newPos = (prefixBefore + insertion).length;
            searchInput.focus();
            searchInput.setSelectionRange(newPos, newPos);
            hideAttrAutocomplete();
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        searchInput.value = before + insertion + after;
        const newPos = (before + insertion).length;
        searchInput.focus();
        searchInput.setSelectionRange(newPos, newPos);
        hideAttrAutocomplete();
        // Единое событие 'input' обновит и обычную фильтрацию, и подсказку
        // под новым контекстом (мы теперь внутри скобок) — оба обработчика
        // уже подписаны на этот же событие, повторный вызов не нужен.
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function getDslSortFieldTypeForAutocomplete(fieldName) {
        const n = normalizeSortFieldName(fieldName);
        if (['цена','price','цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit',
             'рейтинг','rating','отзывы','отзыв','reviews','доставка','дата','delivery'].includes(n)) return 'number';
        if (['название','товар','name','title'].includes(n)) return 'text';
        const entry = dependencies.attributeSuggestCache.find(e => normalizeSortFieldName(e.name) === n);
        if (!entry) return 'text';
        return String(entry.kind || '').includes('quantity') || String(entry.kind || '').includes('number') || String(entry.kind || '').includes('date')
            ? 'number'
            : 'text';
    }

    // Пересчитывает ТОЛЬКО отображение подсказки под текущим положением
    // курсора — без обращения к карточкам страницы (все данные уже в
    // attributeSuggestCache). Вызывается на каждый ввод символа — это
    // дёшево (перебор кэша из нескольких десятков атрибутов максимум).
    function refreshAttributeAutocompleteUi() {
        const searchRootActive = dependencies.uiRoot.activeElement || document.activeElement;
        if (searchRootActive !== searchInput) { hideAttrAutocomplete(); return; }
        const pos = searchInput.selectionStart ?? searchInput.value.length;
        const ctx = getAttrCursorContext(searchInput.value, pos);
        if (ctx.mode === 'name') {
            const prefix = ctx.prefix.toLowerCase();
            attrAcNameStart = ctx.start;
            attrAcMode = 'name';
            // Специальные DSL-команды участвуют в том же автодополнении,
            // но не зависят от наличия одноимённого атрибута в карточках.
            const specialEntries = [{
                name: 'сортировка',
                kind: 'special-sort',
                hint: 'поле, возр/убыв · текст: а-я/я-а'
            }];
            const allEntries = [...specialEntries, ...dependencies.attributeSuggestCache];
            const starts = allEntries.filter(e => e.name.toLowerCase().startsWith(prefix));
            const includes = allEntries.filter(e => !e.name.toLowerCase().startsWith(prefix) && e.name.toLowerCase().includes(prefix));
            attrAcItems = prefix ? [...starts, ...includes].slice(0, 10) : allEntries.slice(0, 10);
            attrAcHighlight = -1;
            renderAttrAcNameList(attrAcItems);
        } else if (ctx.mode === 'value') {
            // Контекстное автодополнение внутри @сортировка(...).
            // Сначала предлагаем поля, после запятой — допустимые направления.
            if (String(ctx.name || '').trim().toLowerCase() === 'сортировка') {
                const beforeCursor = searchInput.value.slice(0, pos);
                const open = beforeCursor.lastIndexOf('@сортировка');
                const inside = open >= 0 ? beforeCursor.slice(beforeCursor.indexOf('(', open) + 1) : '';
                const parts = inside.split(',');
                const builtins = [
                    {name:'цена', hint:'число'}, {name:'цена/ед.', hint:'число'},
                    {name:'рейтинг', hint:'число'}, {name:'отзывы', hint:'число'},
                    {name:'доставка', hint:'дата'}, {name:'название', hint:'текст'}
                ];
                if (parts.length <= 1) {
                    const prefix = (parts[0] || '').trim().toLowerCase();
                    const seen = new Set();
                    const fields = [...builtins, ...dependencies.attributeSuggestCache].filter(e => {
                        const key = String(e.name).toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return !prefix || key.includes(prefix);
                    }).slice(0, 12).map(e => ({...e, sortStage:'field'}));
                    attrAcMode = 'sort'; attrAcItems = fields; attrAcHighlight = -1;
                    renderAttrAcNameList(fields);
                } else {
                    const prefix = (parts[parts.length - 1] || '').trim().toLowerCase();
                    const fieldName = (parts[0] || '').trim();
                    const fieldType = getDslSortFieldTypeForAutocomplete(fieldName);
                    const dirs = fieldType === 'text'
                        ? [
                            {name:'а-я', hint:'по алфавиту', sortStage:'direction'},
                            {name:'я-а', hint:'обратный алфавит', sortStage:'direction'}
                        ]
                        : [
                            {name:'возр', hint:'по возрастанию', sortStage:'direction'},
                            {name:'убыв', hint:'по убыванию', sortStage:'direction'}
                        ];
                    const filteredDirs = dirs.filter(e => !prefix || e.name.startsWith(prefix));
                    attrAcMode = 'sort'; attrAcItems = filteredDirs; attrAcHighlight = -1;
                    renderAttrAcNameList(filteredDirs);
                }
            } else {
                attrAcMode = 'value';
                attrAcItems = [];
                renderAttrAcHint(ctx.name);
            }
        } else {
            hideAttrAutocomplete();
        }
    }

    searchInput.addEventListener('input', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('click', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('focus', refreshAttributeAutocompleteUi);
    searchInput.addEventListener('blur', () => {
        // Небольшая задержка, чтобы mousedown по варианту в списке успел
        // сработать раньше, чем скроется сам список.
        setTimeout(() => {
            const searchRootActive = dependencies.uiRoot.activeElement || document.activeElement;
            if (searchRootActive !== searchInput) hideAttrAutocomplete();
        }, 120);
    });
    searchInput.addEventListener('keydown', (e) => {
        if ((attrAcMode !== 'name' && attrAcMode !== 'sort') || !attrAcItems.length) {
            if (e.key === 'Escape') hideAttrAutocomplete();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            attrAcHighlight = (attrAcHighlight + 1) % attrAcItems.length;
            renderAttrAcNameList(attrAcItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            attrAcHighlight = (attrAcHighlight - 1 + attrAcItems.length) % attrAcItems.length;
            renderAttrAcNameList(attrAcItems);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const pick = attrAcItems[attrAcHighlight >= 0 ? attrAcHighlight : 0];
            if (pick) { e.preventDefault(); selectAttrAcItem(pick); }
        } else if (e.key === 'Escape') {
            hideAttrAutocomplete();
        }
    });

    return { refreshAttributeAutocompleteUi, searchInput, searchInputWrap,
        destroy() { if (_searchResizeRaf != null) cancelAnimationFrame(_searchResizeRaf); }
    };
}
