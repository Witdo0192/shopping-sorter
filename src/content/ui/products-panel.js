// Композиция панели: общее состояние, создание частей, связи и жизненный цикл.
// Части UI получают dependencies через геттеры/сеттеры и владеют своим состоянием.

function createSortedProductsPopup(mode = 'asc') {
    window._ssClosePopup?.();
    document.getElementById('products-sorted-popup')?.remove();
    document.getElementById('shopper-sorter-style')?.remove();

    const noSearchTiles = seenTiles.size === 0;

    // Инициализируем контейнеры до любых асинхронных callback'ов.
    const productsContainer = document.createElement('div');
    productsContainer.className = 'products-grid';
    productsContainer.style.setProperty('--tile-img-height', '160px');
    productsContainer.style.setProperty('--tile-font-scale', '1');

    const savedContainer = document.createElement('div');
    savedContainer.className = 'products-grid saved-grid';
    savedContainer.style.cssText = `display:none; --tile-img-height: 160px; --tile-font-scale: 1;`;

    // Инициализируем контейнеры до любых асинхронных callback'ов.
    // Контейнеры и дополнительные фильтры должны быть инициализированы ДО
    // любых асинхронных callback'ов и обработчиков внутри popup. Иначе быстрые
    // callback'и могли обратиться к const в TDZ и ломать открытие поиска.
    // Компактная статистика по дополнительным атрибутам.
    // Фильтрация дополнительных атрибутов выполняется через основную строку поиска;
    // здесь показываем наличие/отсутствие и распределение найденных значений.
    const { extraControls, refreshExtraControls } = createExtraAttributesSummary({

    });

    const style = createProductsPanelStyle();

    const overlay = document.createElement('div');
    overlay.id = 'products-sorted-popup';
    overlay.style.cssText = `
        position: fixed; inset: 0; width: 100%; max-width: 100%; height: 100%;
        overflow: hidden; background: rgba(0,0,0,0.7); z-index: 99999;
        display: flex; justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white; width: min(95%, 1400px); max-width: calc(100% - 24px); height: 90vh;
        box-sizing: border-box; min-width: 0;
        border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
        display: flex; flex-direction: column; overflow: hidden;
        position: relative;
    `;

    // Изолируем интерфейс расширения от CSS сайта через Shadow DOM.
    // Карточки остаются в light DOM намеренно: только в режиме «Сайт» они
    // должны получать стили исходного сайта.
    const uiHost = document.createElement('div');
    uiHost.className = 'ss-ui-host';
    uiHost.style.cssText = `
        flex: 0 0 auto; min-width: 0; position: relative;
        box-sizing: border-box; font-family: Arial, sans-serif; color: #333;
    `;
    const uiRoot = uiHost.attachShadow({ mode: 'open' });
    const uiStyle = document.createElement('style');
    uiStyle.textContent = `
        :host { font-family: Arial, sans-serif; color:#333; box-sizing:border-box; }
        *, *::before, *::after { box-sizing:border-box; }
        button, input, select, textarea { font-family: Arial, sans-serif; }
    `;
    uiRoot.appendChild(uiStyle);

    const cardsHost = document.createElement('div');
    cardsHost.className = 'ss-cards-host';
    cardsHost.style.cssText = `
        flex: 1 1 auto; min-height: 0; min-width: 0; position: relative;
        display: flex; flex-direction: column; overflow: hidden;
    `;

    // Нижние панели держим в отдельном Shadow DOM-хосте. Так они остаются
    // снизу popup и CSS сайта не может превратить их в верхнюю flex/grid-строку.
    const bottomUiHost = document.createElement('div');
    bottomUiHost.className = 'ss-ui-bottom-host';
    bottomUiHost.style.cssText = `
        flex: 0 0 auto; min-width: 0; position: relative;
        box-sizing: border-box; font-family: Arial, sans-serif; color: #333;
    `;
    const bottomUiRoot = bottomUiHost.attachShadow({ mode: 'open' });
    const bottomUiStyle = document.createElement('style');
    bottomUiStyle.textContent = `
        :host { display:block; font-family:Arial,sans-serif; color:#333; box-sizing:border-box; }
        *, *::before, *::after { box-sizing:border-box; }
        button, input, select, textarea { font-family:Arial,sans-serif; }
    `;
    bottomUiRoot.appendChild(bottomUiStyle);

    popup.appendChild(uiHost);
    popup.appendChild(cardsHost);
    popup.appendChild(bottomUiHost);

    // ─── Toast-уведомление ─────────────────────────────────────────────────────
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(8px);
        background: #333; color: white; padding: 10px 20px; border-radius: 8px;
        font-size: 13px; font-family: sans-serif; white-space: nowrap;
        opacity: 0; transition: opacity 0.2s, transform 0.2s; pointer-events: none;
        z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    uiRoot.appendChild(toast);

    let toastTimer = null;
    function showNotification(msg, type = 'info') {
        clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.style.background = type === 'error' ? '#c62828' : type === 'warning' ? '#e65100' : '#2e7d32';
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
        }, 3000);
    }

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 15px 20px; border-bottom: 1px solid #eee; flex-shrink: 0;
        box-sizing: border-box; width: 100%; min-width: 0;
        background: #f8f9fa; display: flex; flex-direction: column; gap: 10px;
    `;

    // Верхняя строка
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex; align-items:center; gap:6px; flex-wrap:wrap; width:100%; min-width:0; box-sizing:border-box;';

    const tabSearch = document.createElement('button');
    tabSearch.textContent = '📦 Поиск';
    tabSearch.title = 'Карточки, найденные на текущей странице сайта';
    tabSearch.style.cssText = `
    padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
    font-weight: bold; font-size: 14px;
    background: #2196F3; color: white;
`;

    const tabSaved = document.createElement('button');
    tabSaved.textContent = '🔖 Сохранённые';
    tabSaved.title = 'Карточки, которые вы сохранили вручную — хранятся между сессиями';
    tabSaved.style.cssText = `
    padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
    font-weight: bold; font-size: 14px;
    background: transparent; color: #666; border: 1px solid #ddd;
`;

    const tabsRow = document.createElement('div');
    tabsRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-shrink:0;';
    tabsRow.appendChild(tabSearch);
    tabsRow.appendChild(tabSaved);

    // Стиль карточек во вкладке «Поиск»: сайт или упрощённый стиль расширения.
    let searchCardStyle = 'site';
    const cardStyleWrap = document.createElement('div');
    cardStyleWrap.style.cssText = 'display:flex; align-items:center; gap:3px; margin-left:2px; flex-shrink:0;';

    const cardStyleLabel = document.createElement('span');
    cardStyleLabel.textContent = 'Стиль:';
    cardStyleLabel.style.cssText = 'font-size:11px; color:#888; margin-right:2px;';

    const cardStyleSiteBtn = document.createElement('button');
    cardStyleSiteBtn.textContent = '🌐 Сайт';
    cardStyleSiteBtn.title = 'Показывать карточки в исходном стиле сайта';
    cardStyleSiteBtn.style.cssText = 'padding:4px 7px; border:1px solid #2196F3; border-radius:5px; cursor:pointer; font-size:11px; background:#2196F3; color:#fff;';

    const cardStyleOwnBtn = document.createElement('button');
    cardStyleOwnBtn.textContent = '✨ Упрощённый';
    cardStyleOwnBtn.title = 'Показывать карточки в упрощённом стиле расширения (как в «Сохранённых»)';
    cardStyleOwnBtn.style.cssText = 'padding:4px 7px; border:1px solid #ddd; border-radius:5px; cursor:pointer; font-size:11px; background:#fff; color:#777;';

    cardStyleWrap.appendChild(cardStyleLabel);
    cardStyleWrap.appendChild(cardStyleSiteBtn);
    cardStyleWrap.appendChild(cardStyleOwnBtn);

    function updateCardStyleButtons() {
        const siteActive = searchCardStyle === 'site';
        cardStyleSiteBtn.style.background = siteActive ? '#2196F3' : '#fff';
        cardStyleSiteBtn.style.color = siteActive ? '#fff' : '#777';
        cardStyleSiteBtn.style.borderColor = siteActive ? '#2196F3' : '#ddd';
        cardStyleOwnBtn.style.background = siteActive ? '#fff' : '#4CAF50';
        cardStyleOwnBtn.style.color = siteActive ? '#777' : '#fff';
        cardStyleOwnBtn.style.borderColor = siteActive ? '#ddd' : '#4CAF50';
        cardStyleWrap.style.display = activeTab === 'search' ? 'flex' : 'none';
    }

    cardStyleSiteBtn.addEventListener('click', () => {
        if (searchCardStyle === 'site') return;
        searchCardStyle = 'site';
        chrome.storage.local.set({ searchCardStyle });
        applyActiveGridScale();
        updateCardStyleButtons();
        if (activeTab === 'search') renderTiles(currentTiles);
    });
    cardStyleOwnBtn.addEventListener('click', () => {
        if (searchCardStyle === 'custom') return;
        searchCardStyle = 'custom';
        chrome.storage.local.set({ searchCardStyle });
        applyActiveGridScale();
        updateCardStyleButtons();
        if (activeTab === 'search') renderTiles(currentTiles);
    });

    let activeTab = 'search';
    let currentTiles = []; // текущий отображаемый список
    // Состояние группировки объявляем до любых async callbacks, чтобы не попадать в TDZ.
    let groupingActive = false;
    let groupLayout = 'rows';        // 'rows' | 'flow'
    let referenceFeatures = null;
    let referenceImgSrc = null;
    let _searchGroupCache = null;
    let _savedGroupCache = null;

    chrome.storage.local.get(['searchCardStyle'], d => {
        if (d.searchCardStyle === 'custom' || d.searchCardStyle === 'site') {
            searchCardStyle = d.searchCardStyle;
            updateCardStyleButtons();
            try { applyActiveGridScale(); } catch (_) {}
            // Первый рендер выполняется с безопасным значением по умолчанию ('site'),
            // поэтому после загрузки сохранённого режима обязательно перерисовываем
            // список, если пользователь ранее выбрал другой стиль. Иначе кнопка уже
            // показывала бы «Упрощённый», а карточки оставались в стиле сайта.
            if (activeTab === 'search') {
                renderTiles(getFilteredAndSorted(groupingActive ? '' : searchInput.value));
            }
        }
    });

    function switchTab(tab) {
        activeTab = tab;
        updateCardStyleButtons();
        if (tab === 'search') {
            // сбрасываем кэш групп — saved-вкладка могла изменить seenTiles
            _searchGroupCache = null;
            productsContainer.style.display = '';
            savedContainer.style.display = 'none';
            selectionPanel.style.display = 'flex';
            savedPanel.style.display = 'none';
            folderRow.style.display = 'none';
            refreshSavedKeysCache(); // обновляем значки 🔖
            refreshSearchImgBtn.style.display = panelTools.debugMode ? 'inline-block' : 'none';
            refreshSavedImgBtn.style.display = 'none';
            tabSearch.style.background = '#2196F3';
            tabSearch.style.color = 'white';
            tabSearch.style.border = 'none';
            tabSaved.style.background = 'transparent';
            tabSaved.style.color = '#666';
            tabSaved.style.border = '1px solid #ddd';
            // обновляем счётчик под текущий список поиска
            const counterMode = getCounterSortMode(searchInput.value);
            const arrow = counterMode.includes('desc') ? '↓' : '↑';
            renderCounterLabel(currentTiles.length, seenTiles.size, counterMode, arrow);
            updateTypeCounts();
            updatePricePlaceholders([...seenTiles.values()]);
        } else {
            productsContainer.style.display = 'none';
            savedContainer.style.display = '';
            selectionPanel.style.display = 'none';
            refreshSearchImgBtn.style.display = 'none';
            refreshSavedImgBtn.style.display = panelTools.debugMode ? 'inline-block' : 'none';
            savedPanel.style.display = 'flex';
            tabSearch.style.background = 'transparent';
            tabSearch.style.color = '#666';
            tabSearch.style.border = '1px solid #ddd';
            tabSaved.style.background = '#4CAF50';
            tabSaved.style.color = 'white';
            tabSaved.style.border = 'none';
            renderSavedTiles();
        }
    }

    tabSearch.addEventListener('click', () => switchTab('search'));
    tabSaved.addEventListener('click', () => switchTab('saved'));

    const counter = document.createElement('span');
    counter.style.cssText = 'font-size:14px; color:#666; flex:1; text-align:center; white-space:nowrap;';

    // ── Календарь доставки ─────────────────────────────────────────────────────
    // Показывает для каждой даты доставки диапазон цены и/или цены за единицу.
    // По умолчанию обновляется автоматически при изменении текущего набора карточек,
    // но пользователь может отключить автообновление и обновлять календарь вручную.
    const { closeDeliveryCalendar, deliveryCalendarActionsWrap, scheduleDeliveryCalendarRefresh, updateDeliveryCalendarButton } = createDeliveryCalendar({
        get activeTab() { return activeTab; },
        get currentTiles() { return currentTiles; },
        get scheduleApplyFilters() { return scheduleApplyFilters; },
        get searchInput() { return searchInput; }
    });

    const minimizeBtn = document.createElement('button');
    minimizeBtn.textContent = '— Свернуть';
    minimizeBtn.title = 'Свернуть панель (можно кликнуть на страницу)';
    minimizeBtn.style.cssText = `
        padding: 8px 14px; background: #607D8B; color: white;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 500; white-space:nowrap;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Закрыть';
    closeBtn.style.cssText = `
        padding: 8px 14px; background: #dc3545; color: white;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 500; white-space:nowrap;
    `;

    closeBtn.addEventListener('click', closeDeliveryCalendar);

    const panelTools = createPanelTools({
        get _ttHide() { return _ttHide; },
        get activeTab() { return activeTab; },
        get applyFilters() { return applyFilters; },
        get cardStyleWrap() { return cardStyleWrap; },
        get closeBtn() { return closeBtn; },
        get counter() { return counter; },
        get currentTiles() { return currentTiles; },
        set currentTiles(value) { currentTiles = value; },
        get minimizeBtn() { return minimizeBtn; },
        get popup() { return popup; },
        get savedContainer() { return savedContainer; },
        get showNotification() { return showNotification; },
        get tabsRow() { return tabsRow; },
        get topRow() { return topRow; },
        get updatePricePlaceholders() { return updatePricePlaceholders; },
        get updatePriceUnitUI() { return updatePriceUnitUI; }
    });
    const { refreshSavedImgBtn, refreshSearchImgBtn, toolBtnGroup, updateDebugVisibility } = panelTools;
    let currentMode = mode;
    let priceFilterByUnit = false;

    // ─── Выделение карточек ────────────────────────────────────────────────────────
    const selectedKeys = new Set();
    let lastSelectedIndex = -1;
    let lastSelectedKey = null; // ключ последней выбранной карточки (для shift в режиме похожих)
    let lastSavedSelectedIndex = -1;
    let lastSavedSelectedKey = null; // для shift по DOM-порядку в режиме похожих
    let currentSavedTiles = [];

    // ─── Авто-применение фильтров ──────────────────────────────────────────────
    let autoFilterEnabled = true; // по умолчанию — авто
    let _filterDebounceTimer = null;
    function scheduleApplyFilters() {
        if (!autoFilterEnabled) return; // ручной режим — ждём кнопку
        clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = setTimeout(() => applyFilters(), 300);
    }

    const sortRow = document.createElement('div');
    sortRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const sortLabel = document.createElement('span');
    sortLabel.textContent = 'Сортировка:';
    sortLabel.style.cssText = 'font-size:13px; color:#666; white-space:nowrap;';

    function createSortBtn(m, label) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            padding: 5px 12px; border: 2px solid #2196F3; border-radius: 20px;
            cursor: pointer; font-size: 12px; font-weight: bold;
            background: ${currentMode === m ? '#2196F3' : 'transparent'};
            color: ${currentMode === m ? 'white' : '#2196F3'};
            transition: all 0.15s;
        `;
        btn.addEventListener('click', () => {
            currentMode = m;
            sortBtns.forEach(([bm, b]) => {
                b.style.background = currentMode === bm ? '#2196F3' : 'transparent';
                b.style.color = currentMode === bm ? 'white' : '#2196F3';
            });
            // сортировка меняет порядок внутри кластеров — сбрасываем кэш
            _searchGroupCache = null;
            _savedGroupCache = null;
            applyFilters();
        });
        return btn;
    }

    const sortBtnDefs = [
        ['asc', '💰 Цена ↑', 'Сортировать по цене от меньшей к большей'],
        ['desc', '💰 Цена ↓', 'Сортировать по цене от большей к меньшей'],
        ['per-gram-asc', '⚖️ Цена/ед. ↑', 'Сортировать по выбранному приоритету цены/ед. от меньшей к большей\nВеличина выбирается в поле «Цена/ед.»'],
        ['per-gram-desc', '⚖️ Цена/ед. ↓', 'Сортировать по выбранному приоритету цены/ед. от большей к меньшей\nВеличина выбирается в поле «Цена/ед.»'],
        ['reviews-desc', '💬 Отзывы ↓', 'Сортировать по количеству отзывов от большего к меньшему\nТовары без данных — в конце'],
        ['reviews-asc', '💬 Отзывы ↑', 'Сортировать по количеству отзывов от меньшего к большему\nТовары без данных — в конце'],
        ['rating-desc', '⭐ Рейтинг ↓', 'Сортировать по рейтингу от большего к меньшему\nТовары без данных — в конце'],
        ['rating-asc', '⭐ Рейтинг ↑', 'Сортировать по рейтингу от меньшего к большему\nТовары без данных — в конце'],
        ['delivery-asc', '🚚 Доставка ↑', 'Сортировать по дате доставки — сначала ближайшие\nТовары без данных — в конце'],
        ['delivery-desc', '🚚 Доставка ↓', 'Сортировать по дате доставки — сначала самые поздние\nТовары без данных — в конце'],
    ];
    const sortBtns = sortBtnDefs.map(([m, label, tip]) => {
        const btn = createSortBtn(m, label);
        btn.title = tip;
        return [m, btn];
    });

    sortBtns.forEach(([, btn]) => sortRow.appendChild(btn));
    sortRow.prepend(sortLabel);

    // Масштаб сетки хранится отдельно для режима «Сайт» и «Упрощённый».
    // Старый cardScale остаётся fallback для совместимости со старыми настройками.
    let siteCardScale = 180;
    let customCardScale = 180;
    let cardScale = 180;
    function getActiveCardScale() {
        return searchCardStyle === 'site' ? siteCardScale : customCardScale;
    }
    function applyActiveGridScale() {
        cardScale = getActiveCardScale();
        if (typeof scaleSlider !== 'undefined') scaleSlider.value = String(cardScale);
        productsContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardScale}px, 1fr))`;
        productsContainer.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
        productsContainer.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));
        productsContainer.querySelectorAll('.ss-tile--search-custom').forEach(el => {
            el.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
            el.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));
        });
        savedContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${customCardScale}px, 1fr))`;
        savedContainer.style.setProperty('--tile-img-height', Math.round(customCardScale * 0.9) + 'px');
        savedContainer.style.setProperty('--tile-font-scale', getSavedTileFontScale(customCardScale));
    }
    chrome.storage.local.get(['cardScale','siteCardScale','customCardScale'], d => {
        const legacy = Number.isFinite(Number(d.cardScale)) ? Number(d.cardScale) : 180;
        siteCardScale = Number.isFinite(Number(d.siteCardScale)) ? Number(d.siteCardScale) : legacy;
        customCardScale = Number.isFinite(Number(d.customCardScale)) ? Number(d.customCardScale) : legacy;
        applyActiveGridScale();
    });

    const scaleWrap = document.createElement('div');
    scaleWrap.style.cssText = 'display:flex; align-items:center; gap:6px; margin-left:auto;';
    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = '⊞';
    scaleLabel.style.cssText = 'font-size:14px; color:#999; cursor:default;';
    scaleLabel.title = 'Масштаб карточек';
    const scaleSlider = document.createElement('input');
    scaleSlider.type = 'range';
    scaleSlider.min = '120';
    scaleSlider.max = '320';
    scaleSlider.step = '10';
    scaleSlider.title = 'Масштаб карточек (120–320px)';
    scaleSlider.style.cssText = 'width:80px; cursor:pointer; accent-color:#2196F3;';
    scaleSlider.addEventListener('input', () => {
        cardScale = parseInt(scaleSlider.value);
        if (searchCardStyle === 'site') siteCardScale = cardScale;
        else customCardScale = cardScale;
        applyActiveGridScale();
        // высота строки грида зависит от масштаба (текстовый блок тоже растёт/уменьшается) —
        // пересчитываем, если сейчас открыта вкладка «Сохранённые», иначе карточки наедут друг на друга
        if (activeTab === 'saved' && !groupingActive) {
            savedContainer.style.gridAutoRows = `${Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale)}px`;
        }
        chrome.storage.local.set({ cardScale, siteCardScale, customCardScale });
    });
    scaleWrap.appendChild(scaleLabel);
    scaleWrap.appendChild(scaleSlider);


    // ── кнопки группировки похожих ─────────────────────────────────────────────
    const { groupBtn, imgInput, imgSearchBtn, invalidateGroupCache, layoutBtn, destroy: destroyImageSearch } = createImageSearchControls({
        get _savedGroupCache() { return _savedGroupCache; },
        set _savedGroupCache(value) { _savedGroupCache = value; },
        get _searchGroupCache() { return _searchGroupCache; },
        set _searchGroupCache(value) { _searchGroupCache = value; },
        get activeTab() { return activeTab; },
        get getFilteredAndSorted() { return getFilteredAndSorted; },
        get groupLayout() { return groupLayout; },
        set groupLayout(value) { groupLayout = value; },
        get groupingActive() { return groupingActive; },
        set groupingActive(value) { groupingActive = value; },
        get popup() { return popup; },
        get referenceFeatures() { return referenceFeatures; },
        set referenceFeatures(value) { referenceFeatures = value; },
        get referenceImgSrc() { return referenceImgSrc; },
        set referenceImgSrc(value) { referenceImgSrc = value; },
        get renderSavedTiles() { return renderSavedTiles; },
        get renderTiles() { return renderTiles; },
        get searchInput() { return searchInput; },
        get showNotification() { return showNotification; },
        get uiRoot() { return uiRoot; }
    });
    const Divider1 = document.createElement('span');
    Divider1.textContent = '│';
    Divider1.style.cssText = 'color:#ddd; font-size:16px;';

    scaleWrap.appendChild(groupBtn);
    scaleWrap.appendChild(imgSearchBtn);
    scaleWrap.appendChild(layoutBtn);
    scaleWrap.appendChild(imgInput);

    // sortRow.appendChild(scaleWrap);
    topRow.insertBefore(scaleWrap, toolBtnGroup);
    topRow.insertBefore(Divider1, toolBtnGroup);

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

    // Обёртка нужна только для позиционирования подсказки-автокомплита
    // ровно под полем поиска (position:relative + absolute внутри).
    const { refreshAttributeAutocompleteUi, searchInput, searchInputWrap, destroy: destroySearchEditor } = createSearchEditor({
        get attributeSuggestCache() { return attributeSuggestions.attributeSuggestCache; },
        get uiRoot() { return uiRoot; }
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.title = 'Очистить фильтр';
    clearBtn.style.cssText = `
        padding: 8px 12px; background: #6c757d; color: white;
        border: none; border-radius: 6px; cursor: pointer;
    `;

    const { hint, destroy: destroySearchHelp } = createSearchHelp({

    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        if (activeTab === 'saved') {
            renderSavedTiles();
        } else {

            // Обработчики выделения регистрируются один раз при создании панели.

    renderTiles(getFilteredAndSorted(''));
        }
    });

    searchRow.appendChild(searchInputWrap);

    // ── Сохранённые поисковые запросы ─────────────────────────────────────────
    // Запросы хранятся локально в браузере и доступны при следующих открытиях
    // Shopping Sorter на любых страницах. Сохраняем только текст запроса и имя.
    const savedQueries = createSavedQueries({
        get searchInput() { return searchInput; },
        get searchRow() { return searchRow; },
        get showNotification() { return showNotification; }
    });

    // Кнопка «Применить фильтры» — видна только в ручном режиме
    const applyFiltersBtn = document.createElement('button');
    applyFiltersBtn.textContent = '▶ Применить';
    applyFiltersBtn.title = 'Применить фильтры вручную';
    applyFiltersBtn.style.cssText = 'padding:6px 12px; border:1px solid #2196F3; border-radius:6px; cursor:pointer; background:#e3f2fd; color:#1565C0; font-size:12px; white-space:nowrap; display:none;';
    applyFiltersBtn.addEventListener('click', () => applyFilters());
    searchRow.appendChild(applyFiltersBtn);

    // Галочка авто-применения
    const autoFilterLabel = document.createElement('label');
    autoFilterLabel.title = 'Если выключено — фильтры применяются только по кнопке «Применить». Помогает при большом количестве товаров.';
    autoFilterLabel.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; color:#888; cursor:pointer; white-space:nowrap; flex-shrink:0;';
    const autoFilterChk = document.createElement('input');
    autoFilterChk.type = 'checkbox';
    autoFilterChk.checked = true;
    autoFilterChk.style.cursor = 'pointer';
    autoFilterChk.addEventListener('change', () => {
        autoFilterEnabled = autoFilterChk.checked;
        applyFiltersBtn.style.display = autoFilterEnabled ? 'none' : '';
    });
    autoFilterLabel.appendChild(autoFilterChk);
    autoFilterLabel.appendChild(document.createTextNode('авто'));
    searchRow.appendChild(autoFilterLabel);
    searchRow.appendChild(clearBtn);
    searchRow.appendChild(hint);

    const { attributeSuggestions, deliveryMax, deliveryMin, priceMax, priceMin, priceUnitMax, priceUnitMin, ratingMax, ratingMin, renderCounterLabel, reviewsMax, reviewsMin, syncFieldsFromSearch, typeBtns, typeFilter, updatePricePlaceholders, updatePriceUnitUI } = createFilterControls({
        get _savedGroupCache() { return _savedGroupCache; },
        set _savedGroupCache(value) { _savedGroupCache = value; },
        get _searchGroupCache() { return _searchGroupCache; },
        set _searchGroupCache(value) { _searchGroupCache = value; },
        get applyFilters() { return applyFilters; },
        get counter() { return counter; },
        get currentMode() { return currentMode; },
        set currentMode(value) { currentMode = value; },
        get deliveryCalendarActionsWrap() { return deliveryCalendarActionsWrap; },
        get extraControls() { return extraControls; },
        get header() { return header; },
        get priceFilterByUnit() { return priceFilterByUnit; },
        set priceFilterByUnit(value) { priceFilterByUnit = value; },
        get refreshAttributeAutocompleteUi() { return refreshAttributeAutocompleteUi; },
        get scheduleApplyFilters() { return scheduleApplyFilters; },
        get scheduleDeliveryCalendarRefresh() { return scheduleDeliveryCalendarRefresh; },
        get searchInput() { return searchInput; },
        get searchRow() { return searchRow; },
        get sortBtns() { return sortBtns; },
        get sortRow() { return sortRow; },
        get topRow() { return topRow; },
        get updateDeliveryCalendarButton() { return updateDeliveryCalendarButton; }
    });
    const { selectionPanel, updateSelectionPanel } = createSearchSelection({
        get bottomUiRoot() { return bottomUiRoot; },
        get cardsHost() { return cardsHost; },
        get createProgressBar() { return createProgressBar; },
        get currentTiles() { return currentTiles; },
        get header() { return header; },
        get lastSelectedIndex() { return lastSelectedIndex; },
        set lastSelectedIndex(value) { lastSelectedIndex = value; },
        get lastSelectedKey() { return lastSelectedKey; },
        set lastSelectedKey(value) { lastSelectedKey = value; },
        get productsContainer() { return productsContainer; },
        get renderTiles() { return renderTiles; },
        get selectedKeys() { return selectedKeys; },
        get showNotification() { return showNotification; },
        get uiRoot() { return uiRoot; },
        get updateVisibleSelectionState() { return updateVisibleSelectionState; }
    });
    const { clearSavedBtn, createProgressBar, removeSelectedSavedBtn, savedCounter, savedPanel, updateSavedSelectionCounter, updateStorageIndicator } = createSavedProductsToolbar({
        get currentSavedTiles() { return currentSavedTiles; },
        get lastSavedSelectedIndex() { return lastSavedSelectedIndex; },
        set lastSavedSelectedIndex(value) { lastSavedSelectedIndex = value; },
        get lastSavedSelectedKey() { return lastSavedSelectedKey; },
        set lastSavedSelectedKey(value) { lastSavedSelectedKey = value; },
        get savedContainer() { return savedContainer; },
        get savedSelectedKeys() { return savedSelectedKeys; },
        get showNotification() { return showNotification; },
        get switchTab() { return switchTab; }
    });
    const folderRow = document.createElement('div');
    folderRow.style.cssText = `
        display: none; flex-direction: column; gap: 6px; padding: 6px 20px;
        background: #f5f5f5; border-bottom: 1px solid #e0e0e0;
        flex-shrink: 0;
    `;

    let activeFolderFilter = null; // null = все
    let folderSearchQuery = '';

    const { renderFolderRow, savedSelectedKeys, showFolderMenu, destroy: destroyFolders } = createProductFolders({
        get activeFolderFilter() { return activeFolderFilter; },
        set activeFolderFilter(value) { activeFolderFilter = value; },
        get bottomUiRoot() { return bottomUiRoot; },
        get cardsHost() { return cardsHost; },
        get folderRow() { return folderRow; },
        get folderSearchQuery() { return folderSearchQuery; },
        set folderSearchQuery(value) { folderSearchQuery = value; },
        get invalidateGroupCache() { return invalidateGroupCache; },
        get popup() { return popup; },
        get renderSavedTiles() { return renderSavedTiles; },
        get savedContainer() { return savedContainer; },
        get savedPanel() { return savedPanel; },
        get uiRoot() { return uiRoot; }
    });

    const { renderSavedTiles, destroy: destroySavedView } = createSavedProductsView({
        get _savedGroupCache() { return _savedGroupCache; },
        set _savedGroupCache(value) { _savedGroupCache = value; },
        get activeFolderFilter() { return activeFolderFilter; },
        get cardScale() { return cardScale; },
        get clearSavedBtn() { return clearSavedBtn; },
        get currentSavedTiles() { return currentSavedTiles; },
        set currentSavedTiles(value) { currentSavedTiles = value; },
        get getCounterSortMode() { return getCounterSortMode; },
        get getFilteredAndSorted() { return getFilteredAndSorted; },
        get groupBtn() { return groupBtn; },
        get groupLayout() { return groupLayout; },
        get groupingActive() { return groupingActive; },
        set groupingActive(value) { groupingActive = value; },
        get lastSavedSelectedIndex() { return lastSavedSelectedIndex; },
        set lastSavedSelectedIndex(value) { lastSavedSelectedIndex = value; },
        get lastSavedSelectedKey() { return lastSavedSelectedKey; },
        set lastSavedSelectedKey(value) { lastSavedSelectedKey = value; },
        get referenceFeatures() { return referenceFeatures; },
        get removeSelectedSavedBtn() { return removeSelectedSavedBtn; },
        get renderCounterLabel() { return renderCounterLabel; },
        get renderFolderRow() { return renderFolderRow; },
        get savedContainer() { return savedContainer; },
        get savedCounter() { return savedCounter; },
        get savedPanel() { return savedPanel; },
        get savedSelectedKeys() { return savedSelectedKeys; },
        get searchInput() { return searchInput; },
        get showFolderMenu() { return showFolderMenu; },
        get updateDebugVisibility() { return updateDebugVisibility; },
        get updatePricePlaceholders() { return updatePricePlaceholders; },
        get updateSavedSelectionCounter() { return updateSavedSelectionCounter; },
        get updateStorageIndicator() { return updateStorageIndicator; },
        get updateTypeCounts() { return updateTypeCounts; }
    });

    // ─── Toast-уведомление ─────────────────────────────────────────────────────
    // Основные служебные кнопки вынесены в компактную панель слева от окна.
    toolBtnGroup.style.cssText = `position:absolute;
        left:max(4px, calc((100vw - min(95vw, 1400px))/2 - 48px)); top:50%; transform:translateY(-50%);
        display:flex; flex-direction:column; align-items:center; gap:5px; padding:6px;
        background:rgba(255,255,255,.96); border:1px solid #ddd; border-radius:10px;
        box-shadow:0 6px 18px rgba(0,0,0,.18); z-index:2147483646;`;
    toolBtnGroup.querySelectorAll('button').forEach(b => {
        b.style.width='34px'; b.style.height='34px'; b.style.padding='0'; b.style.margin='0';
    });

    overlay.appendChild(popup);
    // Перемещаем боковую панель из шапки в overlay, чтобы она не обрезалась overflow:hidden окна.
    overlay.appendChild(toolBtnGroup);
    document.body.appendChild(overlay);

    // Кастомный тултип для названий карточек
    const { _ttHide, destroy: destroyTooltip } = createProductTooltip({
        get hoverTooltipEnabled() { return panelTools.hoverTooltipEnabled; },
        get productsContainer() { return productsContainer; },
        get savedContainer() { return savedContainer; }
    });

    const { getCounterSortMode, getFilteredAndSorted } = createProductFilters({
        get currentMode() { return currentMode; },
        get deliveryMax() { return deliveryMax; },
        get deliveryMin() { return deliveryMin; },
        get priceMax() { return priceMax; },
        get priceMin() { return priceMin; },
        get priceUnitMax() { return priceUnitMax; },
        get priceUnitMin() { return priceUnitMin; },
        get ratingMax() { return ratingMax; },
        get ratingMin() { return ratingMin; },
        get reviewsMax() { return reviewsMax; },
        get reviewsMin() { return reviewsMin; },
        get typeFilter() { return typeFilter; }
    });

    function updateTypeCounts(tilesOverride) {
        let allFiltered = tilesOverride ? [...tilesOverride] : [...seenTiles.values()];

        const countFilterQuery = stripSortRulesFromQuery(searchInput.value);
        if (countFilterQuery) {
            const tokens = parseSearchQuery(countFilterQuery);
            allFiltered = allFiltered.filter(tile => matchesTileSearchTokens(tile, tokens));
        }

        const counts = { none: 0, noPrice: 0 };
        for (const category of Object.keys(UNITS)) counts[category] = 0;

        allFiltered.forEach(tile => {
            if (getPrice(tile) === 99999999) { counts.noPrice++; return; }
            const results = getAllUnitResults(tile);
            const categories = new Set(results.map(r=>r.category).filter(Boolean));
            if (!categories.size) counts.none++;
            else categories.forEach(category => { if (category in counts) counts[category]++; });
        });

        for (const [category, btn] of Object.entries(typeBtns)) {
            btn.textContent = `${btn.dataset.label} (${counts[category] || 0})`;
        }
    }

    function applyFilters() {
        if (activeTab === 'saved') {
            renderSavedTiles();
        } else {
            // при активной группировке текстовый фильтр применяется внутри групп
            const query = groupingActive ? '' : searchInput.value;
            renderTiles(getFilteredAndSorted(query));
        }
    }

    // Ограниченный LRU-кэш готовых клонов карточек для site-style.
    // Не держим тысячи DOM-клонов: максимум несколько последних экранов.
    const { renderTiles, destroy: destroySearchView } = createSearchProductsView({
        get _searchGroupCache() { return _searchGroupCache; },
        set _searchGroupCache(value) { _searchGroupCache = value; },
        get applyFilters() { return applyFilters; },
        get cardScale() { return cardScale; },
        get currentTiles() { return currentTiles; },
        set currentTiles(value) { currentTiles = value; },
        get debugMode() { return panelTools.debugMode; },
        get getCounterSortMode() { return getCounterSortMode; },
        get getFilteredAndSorted() { return getFilteredAndSorted; },
        get groupBtn() { return groupBtn; },
        get groupLayout() { return groupLayout; },
        get groupingActive() { return groupingActive; },
        set groupingActive(value) { groupingActive = value; },
        get noSearchTiles() { return noSearchTiles; },
        get productsContainer() { return productsContainer; },
        get referenceFeatures() { return referenceFeatures; },
        get refreshExtraControls() { return refreshExtraControls; },
        get renderCounterLabel() { return renderCounterLabel; },
        get searchCardStyle() { return searchCardStyle; },
        get searchInput() { return searchInput; },
        get selectedKeys() { return selectedKeys; },
        get updateDebugVisibility() { return updateDebugVisibility; },
        get updatePricePlaceholders() { return updatePricePlaceholders; },
        get updateTypeCounts() { return updateTypeCounts; }
    });
    function updateVisibleSelectionState() {
        productsContainer.querySelectorAll('[data-tile-key]').forEach(wrap => {
            const key = wrap.dataset.tileKey || '';
            const selected = selectedKeys.has(key);
            wrap.style.outline = selected ? '2px solid #2196F3' : '';
            wrap.style.borderRadius = selected ? '8px' : '';
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) {
                checkbox.style.background = selected ? '#2196F3' : 'rgba(255,255,255,0.9)';
                checkbox.style.borderColor = selected ? '#2196F3' : '#ccc';
                checkbox.style.display = selected ? 'flex' : 'none';
                checkbox.textContent = selected ? '✓' : '';
            }
        });
    }

    productsContainer.addEventListener('mouseover', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const from = e.relatedTarget;
        if (from && wrap.contains(from)) return;
        const checkbox = wrap.querySelector('[data-selection-checkbox]');
        if (checkbox) checkbox.style.display = 'flex';
    });
    productsContainer.addEventListener('mouseout', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const to = e.relatedTarget;
        if (to && wrap.contains(to)) return;
        if (!selectedKeys.has(wrap.dataset.tileKey || '')) {
            const checkbox = wrap.querySelector('[data-selection-checkbox]');
            if (checkbox) checkbox.style.display = 'none';
        }
    });
    productsContainer.addEventListener('click', e => {
        const wrap = e.target.closest('[data-tile-key]');
        if (!wrap || !productsContainer.contains(wrap)) return;
        const checkbox = e.target.closest('[data-selection-checkbox]');
        if (!e.ctrlKey && !e.shiftKey && !checkbox) return;

        e.preventDefault();
        e.stopPropagation();
        const tileKey = wrap.dataset.tileKey || '';
        if (!tileKey) return;

        if (e.shiftKey && lastSelectedKey) {
            const allKeys = currentTiles.map(tile => getTileKey(tile)).filter(Boolean);
            const fromIdx = allKeys.indexOf(lastSelectedKey);
            const toIdx = allKeys.indexOf(tileKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                const lo = Math.min(fromIdx, toIdx);
                const hi = Math.max(fromIdx, toIdx);
                for (let i = lo; i <= hi; i++) selectedKeys.add(allKeys[i]);
            }
        } else {
            if (selectedKeys.has(tileKey)) selectedKeys.delete(tileKey);
            else selectedKeys.add(tileKey);
            lastSelectedKey = tileKey;
            lastSelectedIndex = currentTiles.findIndex(tile => getTileKey(tile) === tileKey);
        }
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    renderTiles(getFilteredAndSorted(''));

    // Callback для внешнего обновления поиска (используется в applyHeuristicSelectors)
    const refreshSearch = () => { collectTiles(); applyFilters(); };
    window._ssRefreshSearch = refreshSearch;
    window._ssApplyFilters = applyFilters;
    // Показываем баннер если эвристика уже нашла что-то до открытия попапа
    showHeuristicBanner();

    searchInput.addEventListener('input', () => {
        if (activeTab === 'search') {
            syncFieldsFromSearch();
            scheduleApplyFilters();
        } else {
            if (autoFilterEnabled) {
                clearTimeout(_filterDebounceTimer);
                _filterDebounceTimer = setTimeout(() => renderSavedTiles(), 300);
            }
        }
    });

    // Блокируем скролл страницы
    const scrollY = window.scrollY;
    document.body.style.cssText += `position:fixed;top:-${scrollY}px;width:100%;`;

    let isMinimized = false;
    let panelClosed = false;

    // Мини-попап: только две кнопки 🗖 ✕ в правом нижнем углу
    const miniBar = document.createElement('div');
    miniBar.style.cssText = `
        display:none; position:fixed; bottom:16px; left:16px; z-index:2147483645;
        background:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.25);
        padding:6px 8px; gap:4px; align-items:center; pointer-events:auto;
        font-family:sans-serif;
    `;
    const miniRestoreBtn = document.createElement('button');
    miniRestoreBtn.textContent = '🗖';
    miniRestoreBtn.title = 'Развернуть';
    miniRestoreBtn.style.cssText = 'font-size:18px;background:none;border:none;cursor:pointer;padding:2px 6px;line-height:1;';
    const miniCloseBtn = document.createElement('button');
    miniCloseBtn.textContent = '✕';
    miniCloseBtn.title = 'Закрыть';
    miniCloseBtn.style.cssText = 'font-size:14px;background:none;border:none;cursor:pointer;padding:2px 6px;line-height:1;color:#888;';
    miniBar.appendChild(miniRestoreBtn);
    miniBar.appendChild(miniCloseBtn);
    document.body.appendChild(miniBar);
    miniRestoreBtn.onclick = () => restorePopup();
    miniCloseBtn.onclick = () => closePopup();

    function minimizePopup() {
        if (isMinimized) return;
        isMinimized = true;
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
        overlay.style.display = 'none';
        miniBar.style.display = 'flex';
    }

    function restorePopup() {
        if (!isMinimized) return;
        isMinimized = false;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';
        // Явно возвращаем flex-центрирование, чтобы после сворачивания/разворачивания
        // окно не «прилипало» к левому верхнему углу.
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        popup.style.position = 'relative';
        popup.style.left = 'auto';
        popup.style.top = 'auto';
        popup.style.margin = '0';
        miniBar.style.display = 'none';
        minimizeBtn.textContent = '— Свернуть';
    }

    minimizeBtn.onclick = () => isMinimized ? restorePopup() : minimizePopup();

    function closePopup() {
        if (panelClosed) return;
        panelClosed = true;
        clearTimeout(toastTimer);
        clearTimeout(_filterDebounceTimer);
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        if (!isMinimized) window.scrollTo(0, scrollY);
        overlay.remove();
        miniBar.remove();
        style.remove();
        destroyTooltip();
        destroySearchEditor();
        destroySearchHelp();
        destroyImageSearch();
        destroyFolders();
        destroySearchView();
        destroySavedView();
        panelTools.destroy();
        closeDeliveryCalendar();
        savedQueries.destroy();
        if (isSelectorPicking()) pickerStopPicking();
        document.removeEventListener('keydown', escHandler);
        updateLiveCounterBadge(); // возвращаем плашку счётчика, если она включена
        if (window._ssClosePopup === closePopup) window._ssClosePopup = null;
        if (window._ssRefreshSearch === refreshSearch) window._ssRefreshSearch = null;
        if (window._ssApplyFilters === applyFilters) window._ssApplyFilters = null;
    }

    window._ssClosePopup = closePopup;
    closeBtn.onclick = closePopup;

    function escHandler(e) {
        if (e.key !== 'Escape') return;
        if (isSelectorPicking()) return; // picker сам обработает Esc
        if (isMinimized) restorePopup();
        else closePopup();
    }
    document.addEventListener('keydown', escHandler);

    return seenTiles.size;
}
