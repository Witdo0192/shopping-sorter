// Поля фильтров, категории, сброс, статистика и композиция блока фильтров.
// Алгоритм применения находится в products/filtering.js.
function createFilterControls(dependencies) {
    const typeRow = document.createElement('div');
    typeRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Показывать:';
    typeLabel.style.cssText = 'font-size:13px; color:#666; white-space:nowrap;';

    function createTypeBtn(key, label) {
        const btn = document.createElement('button');
        btn.dataset.key = key;
        btn.dataset.label = label;
        btn.dataset.typeBtn = key;
        btn.textContent = label;
        btn.style.cssText = `
            padding: 5px 12px; border: 2px solid #4CAF50; border-radius: 20px;
            cursor: pointer; font-size: 12px; font-weight: bold;
            background: #4CAF50; color: white; transition: all 0.15s;
        `;
        btn.addEventListener('click', () => {
            typeFilter[key] = !typeFilter[key];
            btn.style.background = typeFilter[key] ? '#4CAF50' : 'transparent';
            btn.style.color = typeFilter[key] ? 'white' : '#4CAF50';
            dependencies.applyFilters();
        });
        return btn;
    }

    // Строка фильтров по типу измерения товара
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.textContent = '✓ Все';
    toggleAllBtn.style.cssText = `
    padding: 5px 12px; border: 2px solid #888; border-radius: 20px;
    cursor: pointer; font-size: 12px; font-weight: bold;
    background: #888; color: white; transition: all 0.15s;
`;
    toggleAllBtn.title = 'Включить или выключить все фильтры по типу товара сразу';
    toggleAllBtn.addEventListener('click', () => {
        const allOn = Object.values(typeFilter).every(v => v);
        const newState = !allOn;
        for (const key of Object.keys(typeFilter)) {
            typeFilter[key] = newState;
        }
        // Обновляем стили всех кнопок
        for (const [category, btn] of Object.entries(typeBtns)) {
            btn.style.background = typeFilter[category] ? '#4CAF50' : 'transparent';
            btn.style.color = typeFilter[category] ? 'white' : '#4CAF50';
        }
        toggleAllBtn.textContent = newState ? '✓ Все' : '○ Все';
        toggleAllBtn.style.background = newState ? '#888' : 'transparent';
        toggleAllBtn.style.color = newState ? 'white' : '#888';
        dependencies.applyFilters();
    });

    typeRow.appendChild(typeLabel);
    typeRow.appendChild(toggleAllBtn);

    const typeFilter = {};
    const typeBtns = {};

    for (const [category, config] of Object.entries(UNITS)) {
        typeFilter[category] = true;
    }
    typeFilter.none = true;

    const typeTipMap = {
        length: 'Товары, у которых в названии есть длина\n(см, м, мм…) — напр. «кабель 5м»',
        volume: 'Товары, у которых в названии есть объём\n(мл, л, л…) — напр. «шампунь 500мл»',
        weight: 'Товары, у которых в названии есть масса\n(г, кг…) — напр. «корм 2кг»',
        pieces: 'Товары, у которых в названии есть штучность\n(шт, упак, таб…) — напр. «таблетки 30шт»',
    };
    for (const [category, config] of Object.entries(UNITS)) {
        const btn = createTypeBtn(category, config.label);
        if (typeTipMap[category]) btn.title = typeTipMap[category];
        typeBtns[category] = btn;
        typeRow.appendChild(btn);
    }


    const btnNone = createTypeBtn('none', '❓ Без величины');
    btnNone.title = 'Товары, у которых в названии не найдена\nни одна единица измерения';
    typeBtns.none = btnNone;
    typeRow.appendChild(btnNone);

    typeFilter.noPrice = true;
    const btnNoPrice = createTypeBtn('noPrice', '🚫 Без цены');
    btnNoPrice.title = 'Товары, у которых не удалось распознать цену\n(цена отсутствует или скрыта)';
    typeBtns.noPrice = btnNoPrice;
    typeRow.appendChild(btnNoPrice);

    // Строка фильтра по цене (два независимых диапазона)
    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'display:flex; gap:12px; align-items:center; flex-wrap:wrap;';

    // ── Диапазон по полной цене ──
    const priceLabel = document.createElement('span');
    priceLabel.textContent = '💰 Цена:';
    priceLabel.title = 'Фильтр по полной цене товара';
    priceLabel.style.cssText = 'font-size:13px; color:#2196F3; font-weight:bold; white-space:nowrap;';

    const priceMin = document.createElement('input');
    priceMin.type = 'number';
    priceMin.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #90CAF9; border-radius:6px; font-size:13px;';

    const priceSep = document.createElement('span');
    priceSep.textContent = '—';
    priceSep.style.cssText = 'color:#999;';

    const priceMax = document.createElement('input');
    priceMax.type = 'number';
    priceMax.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #90CAF9; border-radius:6px; font-size:13px;';

    // ── Разделитель ──
    const priceDivider = document.createElement('span');
    priceDivider.textContent = '│';
    priceDivider.style.cssText = 'color:#ddd; font-size:16px;';

    // ── Диапазон по цене/величине ──
    const priceUnitLabel = document.createElement('span');
    priceUnitLabel.textContent = '⚖️ Цена/ед.:';
    priceUnitLabel.title = 'Фильтр по цене за единицу (г/мл/шт…)';
    priceUnitLabel.style.cssText = 'font-size:13px; color:#4CAF50; font-weight:bold; white-space:nowrap;';

    const priceUnitMin = document.createElement('input');
    priceUnitMin.type = 'number';
    priceUnitMin.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #A5D6A7; border-radius:6px; font-size:13px;';

    const priceUnitSep = document.createElement('span');
    priceUnitSep.textContent = '—';
    priceUnitSep.style.cssText = 'color:#999;';

    const priceUnitMax = document.createElement('input');
    priceUnitMax.type = 'number';
    priceUnitMax.style.cssText = 'width:80px; padding:5px 8px; border:1px solid #A5D6A7; border-radius:6px; font-size:13px;';

    const unitPrioritySelect = document.createElement('select');
    unitPrioritySelect.title = 'По какой величине сравнивать цену/ед. при фильтрации и сортировке';
    unitPrioritySelect.style.cssText = 'padding:5px 7px; border:1px solid #A5D6A7; border-radius:6px; font-size:12px; background:#fff;';
    function unitPriorityOptionLabel(category) {
        if (category === 'auto') return 'Авто';
        const chosen = getDisplayUnitForCategory(category);
        return chosen ? `${getCategoryDisplayName(category)} · ₽/${chosen.unit}` : getCategoryDisplayName(category);
    }
    function renderUnitPriorityOptions() {
        const prev = unitPrioritySelect.value;
        unitPrioritySelect.innerHTML = '';
        ['auto', ...getCategoriesByPriority()].forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = unitPriorityOptionLabel(value);
            unitPrioritySelect.appendChild(option);
        });
        if (prev) unitPrioritySelect.value = prev;
    }
    renderUnitPriorityOptions();

    dependencies.priceFilterByUnit = false; // оставляем переменную для совместимости, но она больше не используется

    chrome.storage.local.get(['unitPricePriority'], d => {
        unitPricePriority = d.unitPricePriority || 'auto';
        unitPrioritySelect.value = unitPricePriority;
        updatePriceUnitUI();
    });
    unitPrioritySelect.addEventListener('change', () => {
        unitPricePriority = unitPrioritySelect.value || 'auto';
        chrome.storage.local.set({ unitPricePriority });
        updatePriceUnitUI();
        dependencies.scheduleApplyFilters();
    });

    function updatePriceUnitUI() {
        renderUnitPriorityOptions();
        const label = getUnitPricePriorityLabel();
        priceUnitLabel.textContent = `⚖️ Цена/ед. (${label}):`;
        priceUnitLabel.title = (unitPricePriority === 'auto'
            ? 'Авто: приоритет Вес → Объём → Штуки → Длина. Если выбранная величина отсутствует, товар не участвует в сравнении по цене/ед.'
            : `Фильтр и сортировка только по выбранной величине: ${label}`)
            + ' Знаков после запятой в настройках единиц влияет только на отображение, точность фильтра не меняет.';
        updatePricePlaceholders([...seenTiles.values()]);
        dependencies.scheduleDeliveryCalendarRefresh(true);
    }

    priceRow.appendChild(priceLabel);
    priceRow.appendChild(priceMin);
    priceRow.appendChild(priceSep);
    priceRow.appendChild(priceMax);
    priceRow.appendChild(priceDivider);
    priceRow.appendChild(priceUnitLabel);
    priceRow.appendChild(priceUnitMin);
    priceRow.appendChild(priceUnitSep);
    priceRow.appendChild(priceUnitMax);
    priceRow.appendChild(unitPrioritySelect);

    // Компактный вид селектора величины, когда он временно живёт внутри
    // счётчика (см. renderCounterLabel) — тот же элемент, просто другое место в DOM.

    // Обновляет текст счётчика карточек. Когда активна сортировка по
    // «цена/ед.» (режим 'per-gram*'), сам селектор приоритета величины
    // (⚖️ Авто/Вес/Объём/…) переносится внутрь счётчика вместо статичной
    // подписи — это ОДИН И ТОТ ЖЕ элемент (просто перемещается по DOM),
    // поэтому его обработчик 'change' и текущее значение не теряются.
    // В остальных режимах селектор возвращается на своё место в строке
    // фильтра цены/ед.
    function renderCounterLabel(count, total, mode, arrow) {
        dependencies.counter.replaceChildren();
        if (String(mode).startsWith('per-gram')) {
            dependencies.counter.appendChild(document.createTextNode(`${count}/${total} шт. · ⚖️ `));
            unitPrioritySelect.style.verticalAlign = 'middle';
            unitPrioritySelect.style.margin = '0 2px';
            dependencies.counter.appendChild(unitPrioritySelect);
            dependencies.counter.appendChild(document.createTextNode(` ${arrow}`));
        } else {
            if (unitPrioritySelect.parentElement !== priceRow) {
                priceRow.appendChild(unitPrioritySelect);
            }
            const label = getSortModeLabel(mode);
            dependencies.counter.appendChild(document.createTextNode(`${count}/${total} шт. · ${label} ${arrow}`));
        }
        dependencies.counter.appendChild(document.createTextNode(' '));
        dependencies.counter.appendChild(dependencies.deliveryCalendarActionsWrap);
        dependencies.updateDeliveryCalendarButton();
    }

    // ── Вторая строка фильтров: рейтинг и отзывы ──
    const rangeRow2 = document.createElement('div');
    rangeRow2.style.cssText = 'display:flex; gap:12px; align-items:center; flex-wrap:wrap;';

    const ratingLabel = document.createElement('span');
    ratingLabel.textContent = '⭐ Рейтинг:';
    ratingLabel.title = 'Фильтр по рейтингу товара';
    ratingLabel.style.cssText = 'font-size:13px; color:#FF9800; font-weight:bold; white-space:nowrap;';

    const ratingMin = document.createElement('input');
    ratingMin.type = 'number';
    ratingMin.step = '0.1';
    ratingMin.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #FFCC80; border-radius:6px; font-size:13px;';

    const ratingSep = document.createElement('span');
    ratingSep.textContent = '—';
    ratingSep.style.cssText = 'color:#999;';

    const ratingMax = document.createElement('input');
    ratingMax.type = 'number';
    ratingMax.step = '0.1';
    ratingMax.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #FFCC80; border-radius:6px; font-size:13px;';

    const rangeDivider2 = document.createElement('span');
    rangeDivider2.textContent = '│';
    rangeDivider2.style.cssText = 'color:#ddd; font-size:16px;';

    const reviewsLabel = document.createElement('span');
    reviewsLabel.textContent = '💬 Отзывы:';
    reviewsLabel.title = 'Фильтр по количеству отзывов';
    reviewsLabel.style.cssText = 'font-size:13px; color:#7E57C2; font-weight:bold; white-space:nowrap;';

    const reviewsMin = document.createElement('input');
    reviewsMin.type = 'number';
    reviewsMin.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';

    const reviewsSep = document.createElement('span');
    reviewsSep.textContent = '—';
    reviewsSep.style.cssText = 'color:#999;';

    const reviewsMax = document.createElement('input');
    reviewsMax.type = 'number';
    reviewsMax.style.cssText = 'width:70px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';

    const rangeDelivery2 = document.createElement('span');
    rangeDelivery2.textContent = '│';
    rangeDelivery2.style.cssText = 'color:#ddd; font-size:16px;';

    const deliveryLabel = document.createElement('span');
    deliveryLabel.textContent = '🚚 Доставка:';
    deliveryLabel.title = 'Фильтр по дате доставки';
    deliveryLabel.style.cssText = 'font-size:13px; color:#00af90; font-weight:bold; white-space:nowrap;';

    const deliveryMin = document.createElement('input');
    deliveryMin.type = 'text';
    // deliveryMin.type = 'date';
    deliveryMin.style.cssText = 'width:120px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';
    // При фокусе превращаем в календарь
    deliveryMin.addEventListener('focus', () => {
        deliveryMin.type = 'date';
    });
    // При потере фокуса возвращаем текст, только если поле осталось пустым
    deliveryMin.addEventListener('blur', () => {
        if (!deliveryMin.value) {
            deliveryMin.type = 'text';
        }
    });

    const deliverySep = document.createElement('span');
    deliverySep.textContent = '—';
    deliverySep.style.cssText = 'color:#999;';

    const deliveryMax = document.createElement('input');
    deliveryMax.type = 'text'; // Начинаем как текст
    // deliveryMax.type = 'date';
    deliveryMax.style.cssText = 'width:120px; padding:5px 8px; border:1px solid #D1C4E9; border-radius:6px; font-size:13px;';
    // При фокусе превращаем в календарь
    deliveryMax.addEventListener('focus', () => {
        deliveryMax.type = 'date';
    });
    // При потере фокуса возвращаем текст, только если поле осталось пустым
    deliveryMax.addEventListener('blur', () => {
        if (!deliveryMax.value) {
            deliveryMax.type = 'text';
        }
    });

    rangeRow2.appendChild(ratingLabel);
    rangeRow2.appendChild(ratingMin);
    rangeRow2.appendChild(ratingSep);
    rangeRow2.appendChild(ratingMax);
    rangeRow2.appendChild(rangeDivider2);
    rangeRow2.appendChild(reviewsLabel);
    rangeRow2.appendChild(reviewsMin);
    rangeRow2.appendChild(reviewsSep);
    rangeRow2.appendChild(reviewsMax);
    rangeRow2.appendChild(rangeDelivery2);
    rangeRow2.appendChild(deliveryLabel);
    rangeRow2.appendChild(deliveryMin);
    rangeRow2.appendChild(deliverySep);
    rangeRow2.appendChild(deliveryMax);

    // ── Связь «поисковая строка ↔ поля фильтра» ────────────────────────────────
    // Поля и DSL используют один источник смысла. Простые диапазоны синхронизируются
    // в обе стороны, а сложные выражения (несколько диапазонов, OR, вложенные группы)
    // оставляем в поисковой строке, чтобы не потерять её более богатый синтаксис.
    const { syncFieldsFromSearch } = createLinkedFilters({
        get deliveryMax() { return deliveryMax; },
        get deliveryMin() { return deliveryMin; },
        get priceMax() { return priceMax; },
        get priceMin() { return priceMin; },
        get priceUnitMax() { return priceUnitMax; },
        get priceUnitMin() { return priceUnitMin; },
        get rangeRow2() { return rangeRow2; },
        get ratingMax() { return ratingMax; },
        get ratingMin() { return ratingMin; },
        get reviewsMax() { return reviewsMax; },
        get reviewsMin() { return reviewsMin; },
        get scheduleApplyFilters() { return dependencies.scheduleApplyFilters; },
        get searchInput() { return dependencies.searchInput; }
    });

    function updatePricePlaceholders(tiles) {
        if (tiles.length === 0) return;
        // Цены
        const priceVals = tiles.map(t => getPrice(t)).filter(v => v < 99999999);
        if (priceVals.length > 0) {
            priceMin.placeholder = Math.min(...priceVals).toFixed(0);
            priceMax.placeholder = Math.max(...priceVals).toFixed(0);
        }
        // Цены/ед.
        const unitVals = tiles.map(t => getPricePerUnit(t)?.value).filter(v => v != null && Number.isFinite(v));
        if (unitVals.length > 0) {
            const d = getUnitPriceDecimalsForPriority();
            priceUnitMin.placeholder = Math.min(...unitVals).toFixed(d);
            priceUnitMax.placeholder = Math.max(...unitVals).toFixed(d);
        } else {
            priceUnitMin.placeholder = '';
            priceUnitMax.placeholder = '';
        }
        // Рейтинг
        const ratingVals = tiles.map(t => getRating(t)).filter(v => v != null);
        if (ratingVals.length > 0) {
            ratingMin.placeholder = Math.min(...ratingVals).toString();
            ratingMax.placeholder = Math.max(...ratingVals).toString();
        }
        // Отзывы
        const reviewsVals = tiles.map(t => getReviewsCount(t)).filter(v => v != null);
        if (reviewsVals.length > 0) {
            reviewsMin.placeholder = Math.min(...reviewsVals).toString();
            reviewsMax.placeholder = Math.max(...reviewsVals).toString();
        }
        // Дата доставки
        const deliveryVals = tiles.map(t => getDeliveryDate(t)).filter(v => v != null);
        if (deliveryVals.length > 0) {
            deliveryMin.placeholder = formatDateToString(Math.min(...deliveryVals));
            deliveryMax.placeholder = formatDateToString(Math.max(...deliveryVals));
        }

        // ── Кэш подсказок для автодополнения @атрибутов в поисковой строке ──
        // Считается один раз здесь (там же, где и остальные плейсхолдеры —
        // то есть при обновлении набора карточек), а не на каждое нажатие
        // клавиши в поле поиска. Строка поиска только читает готовый кэш.
        rebuildAttributeSuggestCache(tiles, { priceVals, unitVals, ratingVals, reviewsVals, deliveryVals });
    }

    // Список «основных» атрибутов, доступных через @имя(...) — их можно
    // ввести и в отдельные поля фильтра, но эти алиасы тоже нужно предлагать.
    const attributeSuggestions = createAttributeSuggestions({
        get refreshAttributeAutocompleteUi() { return dependencies.refreshAttributeAutocompleteUi; }
    });
    const { rebuildAttributeSuggestCache } = attributeSuggestions;
    const resetFiltersBtn = document.createElement('button');
    resetFiltersBtn.textContent = '↺ Сбросить';
    resetFiltersBtn.title = 'Сбросить все фильтры и сортировку к значениям по умолчанию:\n• Сортировка: Цена ↑\n• Все типы товаров включены\n• Диапазон цены очищен\n• Поисковая строка очищена\n• Режим: по цене';
    resetFiltersBtn.style.cssText = `
        padding: 4px 10px; border: 1px solid #bbb; border-radius: 14px;
        cursor: pointer; font-size: 11px; font-weight: 500;
        background: #f5f5f5; color: #666; transition: all 0.15s;
        margin-left: auto; white-space: nowrap; flex-shrink: 0;
    `;
    resetFiltersBtn.addEventListener('mouseenter', () => {
        resetFiltersBtn.style.background = '#e0e0e0';
        resetFiltersBtn.style.color = '#333';
        resetFiltersBtn.style.borderColor = '#999';
    });
    resetFiltersBtn.addEventListener('mouseleave', () => {
        resetFiltersBtn.style.background = '#f5f5f5';
        resetFiltersBtn.style.color = '#666';
        resetFiltersBtn.style.borderColor = '#bbb';
    });
    resetFiltersBtn.addEventListener('click', () => {
        // Сброс сортировки
        dependencies.currentMode = 'asc';
        dependencies.sortBtns.forEach(([bm, b]) => {
            b.style.background = bm === 'asc' ? '#2196F3' : 'transparent';
            b.style.color = bm === 'asc' ? 'white' : '#2196F3';
        });
        // Сброс фильтров типов
        for (const key of Object.keys(typeFilter)) typeFilter[key] = true;
        for (const [cat, btn] of Object.entries(typeBtns)) {
            btn.style.background = '#4CAF50';
            btn.style.color = 'white';
        }
        toggleAllBtn.textContent = '✓ Все';
        toggleAllBtn.style.background = '#888';
        toggleAllBtn.style.color = 'white';
        // Сброс диапазонов цены
        priceMin.value = '';
        priceMax.value = '';
        priceUnitMin.value = '';
        priceUnitMax.value = '';
        unitPricePriority = 'auto';
        unitPrioritySelect.value = 'auto';
        chrome.storage.local.set({ unitPricePriority: 'auto' });
        updatePriceUnitUI();
        ratingMin.value = '';
        ratingMax.value = '';
        reviewsMin.value = '';
        reviewsMax.value = '';
        deliveryMin.value = '';
        deliveryMax.value = '';
        // Сброс строки поиска
        dependencies.searchInput.value = '';
        // Сброс кэша групп
        dependencies._searchGroupCache = null;
        dependencies._savedGroupCache = null;
        dependencies.applyFilters();
    });
    dependencies.sortRow.appendChild(resetFiltersBtn);

    // Компактный общий сворачиваемый контейнер для всех быстрых фильтров и сортировки.
    const filtersPanel = document.createElement('div');
    filtersPanel.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:7px 9px; border:1px solid #d8dee6; border-radius:8px; background:#fbfcfd;';
    const filtersToggle = document.createElement('div');
    filtersToggle.style.cssText = 'font-size:12px; font-weight:700; color:#546e7a; cursor:pointer; user-select:none; min-height:20px; line-height:20px;';
    const filtersBody = document.createElement('div');
    filtersBody.style.cssText = 'display:none; flex-direction:column; gap:8px;';
    let filtersPanelOpen = false;
    function setFiltersPanelOpen(open) {
        filtersPanelOpen = !!open;
        filtersToggle.textContent = (filtersPanelOpen ? '▼' : '▶') + ' ⚙ Фильтры и сортировка';
        filtersBody.style.display = filtersPanelOpen ? 'flex' : 'none';
    }
    filtersToggle.addEventListener('click', () => setFiltersPanelOpen(!filtersPanelOpen));
    filtersBody.appendChild(dependencies.sortRow);
    filtersBody.appendChild(typeRow);
    filtersBody.appendChild(priceRow);
    filtersBody.appendChild(rangeRow2);
    filtersBody.appendChild(dependencies.extraControls);
    filtersPanel.appendChild(filtersToggle);
    filtersPanel.appendChild(filtersBody);
    setFiltersPanelOpen(false);

    dependencies.header.appendChild(dependencies.topRow);
    dependencies.header.appendChild(dependencies.searchRow);
    dependencies.header.appendChild(filtersPanel);

    // ─── Панель выделения ──────────────────────────────────────────────────────────
    return { attributeSuggestions, deliveryMax, deliveryMin, priceMax, priceMin, priceUnitMax, priceUnitMin, ratingMax, ratingMin, renderCounterLabel, reviewsMax, reviewsMin, syncFieldsFromSearch, typeBtns, typeFilter, updatePricePlaceholders, updatePriceUnitUI };
}
