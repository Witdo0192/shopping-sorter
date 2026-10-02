// Большая панель товаров: создание, события, фильтры, списки и закрытие.
// Общие данные и вычисления находятся в соседних файлах; замыкание UI пока сохранено.

function createSortedProductsPopup(mode = 'asc') {
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
    const extraControls = document.createElement('div');
    extraControls.style.cssText='display:flex;flex-direction:column;gap:4px;padding:3px 7px;border:1px dashed #d8dee6;border-radius:7px;background:#fbfcfd;';
    const extraControlsTitle=document.createElement('div');
    extraControlsTitle.textContent='🏷️ Доп. атрибуты и величины';
    extraControlsTitle.style.cssText='font-size:11px;font-weight:700;color:#607D8B;cursor:pointer;user-select:none;min-height:18px;line-height:18px;';
    extraControls.appendChild(extraControlsTitle);
    const extraControlsBody=document.createElement('div');
    extraControlsBody.style.cssText='display:flex;flex-direction:column;gap:4px;';
    extraControls.appendChild(extraControlsBody);
    let extraControlsCollapsed=false;
    chrome.storage.local.get(['extraControlsCollapsed'], d => {
        setExtraControlsCollapsed(d.extraControlsCollapsed === true);
    });

    function setExtraControlsCollapsed(collapsed){
        extraControlsCollapsed=!!collapsed;
        extraControlsBody.hidden=extraControlsCollapsed;
        // Не полагаемся только на hidden: у body задан inline display:flex,
        // который в некоторых стилях страницы может переопределить [hidden].
        extraControlsBody.style.display=extraControlsCollapsed?'none':'flex';
        extraControls.style.padding=extraControlsCollapsed?'2px 7px':'3px 7px';
        extraControls.style.gap=extraControlsCollapsed?'0':'4px';
        extraControlsTitle.textContent=extraControlsCollapsed
            ? '🏷️ Доп. атрибуты и величины ▸'
            : '🏷️ Доп. атрибуты и величины ▾';
        chrome.storage.local.set({ extraControlsCollapsed });
    }
    extraControlsTitle.addEventListener('click',()=>setExtraControlsCollapsed(!extraControlsCollapsed));

    function refreshExtraControls(tiles=[...seenTiles.values()]) {
        extraControlsBody.innerHTML='';
        const total=tiles.length;
        if(!total){
            const empty=document.createElement('div');
            empty.textContent='Нет карточек для анализа';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        const defs=new Map();
        for(const tile of tiles){
            const profile=getSelectorProfileForTile(tile);
            for(const item of (profile?.extras || [])){
                const name=String(item?.name||'').trim();
                if(!name) continue;
                if(!defs.has(name)) defs.set(name,{name,kind:item?.kind==='quantity'?'quantity':'text',unit:String(item?.unit||'').trim()});
            }
        }

        if(!defs.size){
            const empty=document.createElement('div');
            empty.textContent='Дополнительные атрибуты не настроены';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        for(const def of defs.values()){
            let found=0;
            const frequencies=new Map();
            for(const tile of tiles){
                const attrs=getExtraTileAttributes(tile);
                const raw=String(attrs[def.name]||'').trim();
                if(!raw) continue;
                found++;
                for(const value of raw.split(' | ').map(v=>v.trim()).filter(Boolean)){
                    frequencies.set(value,(frequencies.get(value)||0)+1);
                }
            }
            const absent=Math.max(0,total-found);
            const pct=Math.round(found/total*100);
            const topValues=[...frequencies.entries()]
                .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
                .slice(0,6);
            const distinct=frequencies.size;

            const row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;gap:7px;min-height:20px;font-size:10px;';

            const name=document.createElement('span');
            name.textContent=def.name+(def.unit?' ('+def.unit+')':'');
            name.style.cssText='min-width:110px;max-width:180px;font-weight:600;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            name.title=def.name+(def.unit?' ('+def.unit+')':'');

            const foundEl=document.createElement('span');
            foundEl.textContent=`✓ ${found}`;
            foundEl.style.cssText='color:#2e7d32;font-weight:600;white-space:nowrap;';
            foundEl.title=`Найден у ${found} из ${total} карточек`;

            const absentEl=document.createElement('span');
            absentEl.textContent=`✕ ${absent}`;
            absentEl.style.cssText='color:#c62828;font-weight:600;white-space:nowrap;';
            absentEl.title=`Не найден у ${absent} из ${total} карточек`;

            const percent=document.createElement('span');
            percent.textContent=`${pct}%`;
            percent.style.cssText='color:#777;min-width:32px;white-space:nowrap;';
            percent.title=`Заполненность: ${pct}%`;

            const valuesEl=document.createElement('span');
            const valueText=topValues.length
                ? topValues.map(([value,count])=>`${value} ×${count}`).join(' · ') + (distinct>topValues.length?` · +${distinct-topValues.length}`:'')
                : '—';
            valuesEl.textContent=valueText;
            valuesEl.style.cssText='color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:100px;';
            valuesEl.title=topValues.length
                ? `Уникальных значений: ${distinct}. Частые значения: ${topValues.map(([value,count])=>`${value} — ${count}`).join('; ')}${distinct>topValues.length?'; и другие':''}`
                : 'Значений не найдено';

            row.append(name,foundEl,absentEl,percent,valuesEl);
            extraControlsBody.appendChild(row);
        }
    }
    refreshExtraControls();

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
            refreshSearchImgBtn.style.display = debugMode ? 'inline-block' : 'none';
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
            refreshSavedImgBtn.style.display = debugMode ? 'inline-block' : 'none';
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

    let debugMode = false;
    chrome.storage.local.get(['debugMode'], d => {
        debugMode = !!d.debugMode;
        updateDebugVisibility();
        if (debugMode) {
            refreshSearchImgBtn.style.display = activeTab === 'search' ? 'inline-block' : 'none';
            refreshSavedImgBtn.style.display = activeTab === 'saved' ? 'inline-block' : 'none';
        }
    });

    // ── Тултип с названием карточки при наведении (можно отключить — при большом
    //    количестве карточек может подтормаживать) ──
    let hoverTooltipEnabled = true;
    chrome.storage.local.get(['hoverTooltipEnabled'], d => {
        hoverTooltipEnabled = d.hoverTooltipEnabled !== false; // по умолчанию включено
        updateHoverBtnStyle();
    });

    function updateHoverBtnStyle() {
        hoverBtn.style.background = hoverTooltipEnabled ? '#2196F3' : 'transparent';
        hoverBtn.style.color = hoverTooltipEnabled ? 'white' : '#999';
        hoverBtn.style.border = hoverTooltipEnabled ? 'none' : '1px solid #ddd';
        hoverBtn.title = hoverTooltipEnabled
            ? 'Подсказка с названием при наведении: включена (нажмите, чтобы отключить — полезно при тормозах на больших списках)'
            : 'Подсказка с названием при наведении: отключена (нажмите, чтобы включить)';
    }

    function updateDebugVisibility() {
        popup.querySelectorAll('.ppg-debug').forEach(el => {
            el.style.display = debugMode ? 'block' : 'none';
        });
        debugBtn.style.background = debugMode ? '#ff9800' : 'transparent';
        debugBtn.style.color = debugMode ? 'white' : '#999';
        debugBtn.style.border = debugMode ? 'none' : '1px solid #ddd';
    }

    const debugBtn = document.createElement('button');
    debugBtn.textContent = '🐛';
    debugBtn.title = 'Debug-режим: показывать отладочную информацию на карточках';
    debugBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s;
    `;
    debugBtn.addEventListener('click', () => {
        debugMode = !debugMode;
        chrome.storage.local.set({ debugMode });
        updateDebugVisibility();
        refreshSearchImgBtn.style.display = debugMode && activeTab === 'search' ? 'inline-block' : 'none';
        refreshSavedImgBtn.style.display = debugMode && activeTab === 'saved' ? 'inline-block' : 'none';
    });

    const hoverBtn = document.createElement('button');
    hoverBtn.textContent = '👁';
    hoverBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s;
    `;
    hoverBtn.addEventListener('click', () => {
        hoverTooltipEnabled = !hoverTooltipEnabled;
        chrome.storage.local.set({ hoverTooltipEnabled });
        updateHoverBtnStyle();
        if (!hoverTooltipEnabled) _ttHide();
    });

    const refreshSearchImgBtn = document.createElement('button');
    refreshSearchImgBtn.textContent = '🖼';
    refreshSearchImgBtn.title = 'Обновить картинки в поиске (сохранить актуальные в IndexedDB)';
    refreshSearchImgBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s; display: none;
    `;
    refreshSearchImgBtn.addEventListener('click', async () => {
        refreshSearchImgBtn.textContent = '⏳';
        refreshSearchImgBtn.disabled = true;
        showNotification('🔄 Принудительная загрузка картинок...');

        // 1. Триггерим загрузку всех ленивых картинок на странице
        //    через IntersectionObserver trick — делаем все img видимыми
        if (SELECTORS) {
            const allImgs = document.querySelectorAll(`${SELECTORS.tile} img[data-src], ${SELECTORS.tile} img[loading="lazy"]`);
            allImgs.forEach(img => {
                if (img.dataset.src && !img.src) img.src = img.dataset.src;
                if (img.loading === 'lazy') img.loading = 'eager';
                // для Intersection Observer — временно помещаем в viewport
                const rect = img.getBoundingClientRect();
                if (rect.top > window.innerHeight || rect.bottom < 0) {
                    img.style.contentVisibility = 'visible';
                }
            });
        }

        // 2. Ждём пока картинки загрузятся (до 3 сек)
        await new Promise(r => setTimeout(r, 1500));

        // 3. Берём картинки с ЖИВЫХ элементов страницы, не из seenTiles
        let count = 0;
        if (SELECTORS) {
            const liveTiles = document.querySelectorAll(SELECTORS.tile);
            await Promise.all([...liveTiles].map(async tile => {
                const key = getTileKey(tile);
                if (!key) return;
                // ищем картинку с наибольшим разрешением
                const imgs = tile.querySelectorAll('img');
                let bestImg = null;
                let bestSize = 0;
                imgs.forEach(img => {
                    const size = (img.naturalWidth || 0) * (img.naturalHeight || 0);
                    if (size > bestSize && img.src && !img.src.startsWith('data:')) {
                        bestSize = size;
                        bestImg = img;
                    }
                });
                const src = bestImg?.currentSrc || bestImg?.src || '';
                if (!src) return;
                const dataUrl = await saveImageToBackground(key, src, true);
                if (dataUrl) {
                    // обновляем seenTiles
                    const clone = tile.cloneNode(true);
                    clone.style.width = '';
                    clone.style.marginRight = '';
                    seenTiles.set(key, clone);
                    // обновляем DOM в сохранённых если открыто
                    const savedTileEl = document.querySelector(`#products-sorted-popup .ss-tile[data-ss-key="${CSS.escape(key)}"]`);
                    if (savedTileEl) {
                        const wrap = savedTileEl.querySelector('.ss-tile__img-wrap');
                        if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
                    }
                    count++;
                }
            }));
        }

        refreshSearchImgBtn.textContent = '🖼';
        refreshSearchImgBtn.disabled = false;
        showNotification(`✅ Обновлено ${count} картинок из поиска`);
    });

    const refreshSavedImgBtn = document.createElement('button');
    refreshSavedImgBtn.textContent = '🖼';
    refreshSavedImgBtn.title = 'Обновить картинки в сохранённых из текущего поиска';
    refreshSavedImgBtn.style.cssText = `
        padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px;
        cursor: pointer; font-size: 13px; background: transparent; color: #999;
        transition: all 0.15s; display: none;
    `;
    refreshSavedImgBtn.addEventListener('click', async () => {
        refreshSavedImgBtn.textContent = '⏳';
        refreshSavedImgBtn.disabled = true;
        let count = 0;
        const saved = await getSavedTiles();
        await Promise.all(saved.map(async item => {
            const liveTile = seenTiles.get(item.key);
            if (!liveTile) return;
            const imgEl = getBestProductImage(liveTile);
            const src = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
            if (!src || src.startsWith('data:')) return;
            const dataUrl = await saveImageToBackground(item.key, src, true);
            if (dataUrl) {
                const tileEl = savedContainer.querySelector(`.ss-tile[data-ss-key="${CSS.escape(item.key)}"]`);
                if (tileEl) {
                    const wrap = tileEl.querySelector('.ss-tile__img-wrap');
                    if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
                }
                count++;
            }
        }));
        refreshSavedImgBtn.textContent = '🖼';
        refreshSavedImgBtn.disabled = false;
        showNotification(`✅ Обновлено ${count} картинок в сохранённых`);
    });

    // Обновление атрибутов карточек — вручную, когда сайт дорисовал рейтинг/отзывы позже.
    const refreshAttrsBtn = document.createElement('button');
    refreshAttrsBtn.type = 'button';
    refreshAttrsBtn.textContent = '🔄';
    refreshAttrsBtn.title = 'Повторно считать атрибуты карточек (рейтинг, отзывы, цена и т.д.)';
    refreshAttrsBtn.style.cssText = `padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px;background:transparent;color:#999;`;
    refreshAttrsBtn.addEventListener('click', async () => {
        refreshAttrsBtn.textContent = '⏳';
        refreshAttrsBtn.disabled = true;
        try {
            collectTiles();
            await new Promise(r => setTimeout(r, 80));
            currentTiles = [...seenTiles.values()];
            updatePricePlaceholders(currentTiles);
            applyFilters();
            showNotification('✅ Атрибуты карточек обновлены');
        } catch (e) {
            showNotification('⚠️ Не удалось обновить атрибуты', 'warning');
        } finally {
            refreshAttrsBtn.textContent = '🔄';
            refreshAttrsBtn.disabled = false;
        }
    });

    const badgeSettingsBtn = document.createElement('button');
    badgeSettingsBtn.type = 'button';
    badgeSettingsBtn.textContent = '🏷️';
    badgeSettingsBtn.title = 'Настройка бейджа цены за единицу';
    badgeSettingsBtn.style.cssText = `padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px;background:transparent;color:#999;`;
    badgeSettingsBtn.addEventListener('click', () => {
        const old = document.getElementById('ss-ppg-settings-menu');
        if (old) { old.remove(); return; }
        const menu = document.createElement('div');
        menu.id = 'ss-ppg-settings-menu';
        menu.style.cssText = `position:fixed;left:58px;top:50%;transform:translateY(-50%);z-index:2147483647;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:10px;width:210px;font:12px sans-serif;color:#333;`;
        const title=document.createElement('div'); title.textContent='🏷️ Бейдж цены/ед.'; title.style.cssText='font-weight:700;margin-bottom:8px;'; menu.appendChild(title);
        const visibleRow=document.createElement('label'); visibleRow.style.cssText='display:flex;align-items:center;gap:7px;margin-bottom:9px;cursor:pointer;';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=ppgBadgeVisible;
        cb.onchange=()=>{ppgBadgeVisible=cb.checked; chrome.storage.local.set({ppgBadgeVisible}); updateAllPpgBadges();};
        visibleRow.appendChild(cb); visibleRow.appendChild(document.createTextNode('Показывать бейдж')); menu.appendChild(visibleRow);
        const modeLabel=document.createElement('div'); modeLabel.textContent='Что показывать в бейдже:'; modeLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(modeLabel);
        const modeSelect=document.createElement('select'); modeSelect.style.cssText='width:100%;padding:5px 7px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;margin-bottom:9px;';
        [['all','Все уникальные величины'],['current','Только текущая величина']].forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;modeSelect.appendChild(o);});
        modeSelect.value=ppgBadgeMode; modeSelect.onchange=()=>{ppgBadgeMode=modeSelect.value==='current'?'current':'all';chrome.storage.local.set({ppgBadgeMode});try{applyFilters();}catch(_){} };
        menu.appendChild(modeSelect);
        const hint=document.createElement('div'); hint.style.cssText='font-size:9.5px;color:#999;line-height:1.3;margin:-3px 0 9px;'; hint.textContent='«Текущая» = выбранный приоритет (или Авто для каждой карточки).'; menu.appendChild(hint);

        // Единица отображения по категориям: кг↔г, л↔мл, мм↔см↔м и т.п.
        // Влияет на бейдж, фильтр «Цена/ед.» и сортировку одновременно (единый источник истины).
        const unitsLabel=document.createElement('div'); unitsLabel.textContent='Единица в цене/ед.:'; unitsLabel.title='Любое обозначение из настроек единиц для этой категории: кг/г, л/мл, шт/таблетка/капсула и т.п. Меняет только подпись — расчёт остаётся точным.'; unitsLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(unitsLabel);
        Object.keys(UNITS || {})
            .sort((a, b) => clampPriority(UNITS[a]?.priority, a) - clampPriority(UNITS[b]?.priority, b))
            .forEach(category => {
            const choices = getCategoryUnitChoices(category);
            if (choices.length < 2) return; // нечего переключать (например, «шт» — единственный вариант)
            const row=document.createElement('div'); row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;';
            const lab=document.createElement('span'); lab.textContent=getCategoryDisplayName(category); lab.style.cssText='font-size:11px;color:#555;';
            const sel=document.createElement('select'); sel.style.cssText='flex:0 0 auto;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;';
            choices.forEach(({unit})=>{const o=document.createElement('option');o.value=unit;o.textContent=`₽/${unit}`;sel.appendChild(o);});
            sel.value = badgeDisplayUnit[category] || FALLBACK_CANONICAL_UNIT[category] || choices[choices.length-1].unit;
            sel.onchange=()=>{
                badgeDisplayUnit={...badgeDisplayUnit,[category]:sel.value};
                chrome.storage.local.set({badgeDisplayUnit});
                try{updateAllPpgBadges();}catch(_){}
                try{updatePriceUnitUI();}catch(_){}
                try{applyFilters();}catch(_){}
            };
            row.appendChild(lab); row.appendChild(sel); menu.appendChild(row);
        });
        const unitsHint=document.createElement('div'); unitsHint.style.cssText='font-size:9.5px;color:#999;line-height:1.3;margin:-2px 0 9px;'; unitsHint.textContent='Меняет только подпись в бейдже/фильтре/сортировке — сравнение и фильтрация по-прежнему точные.'; menu.appendChild(unitsHint);

        const posLabel=document.createElement('div'); posLabel.textContent='Угол области картинки:'; posLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(posLabel);
        const posGrid=document.createElement('div'); posGrid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:5px;';
        [['top-left','↖'],['top-right','↗'],['bottom-left','↙'],['bottom-right','↘']].forEach(([pos,icon])=>{const b=document.createElement('button');b.type='button';b.textContent=icon;b.title=pos;b.dataset.ppgPos=pos;b.style.cssText=`padding:6px;border:1px solid ${ppgBadgePosition===pos?'#2196F3':'#ddd'};border-radius:6px;background:${ppgBadgePosition===pos?'#eef6ff':'#fff'};cursor:pointer;font-size:16px;`;b.onclick=()=>{ppgBadgePosition=pos;chrome.storage.local.set({ppgBadgePosition});updateAllPpgBadges();posGrid.querySelectorAll('[data-ppg-pos]').forEach(x=>{x.style.borderColor=x.dataset.ppgPos===pos?'#2196F3':'#ddd';x.style.background=x.dataset.ppgPos===pos?'#eef6ff':'#fff';});};posGrid.appendChild(b);});
        menu.appendChild(posGrid); document.body.appendChild(menu);
        const close=ev=>{if(!menu.contains(ev.target)&&ev.target!==badgeSettingsBtn){menu.remove();document.removeEventListener('mousedown',close);}};
        setTimeout(()=>document.addEventListener('mousedown',close),0);
    });

    // Группа служебных кнопок — всегда занимает одинаковое место, не двигает counter
    const toolBtnGroup = document.createElement('div');
    toolBtnGroup.style.cssText = 'display:flex; align-items:center; gap:2px; flex-shrink:0;';
    toolBtnGroup.appendChild(refreshSearchImgBtn);
    toolBtnGroup.appendChild(refreshSavedImgBtn);
    toolBtnGroup.appendChild(refreshAttrsBtn);
    toolBtnGroup.appendChild(badgeSettingsBtn);
    toolBtnGroup.appendChild(debugBtn);
    toolBtnGroup.appendChild(hoverBtn);

    topRow.appendChild(tabsRow);
    topRow.appendChild(cardStyleWrap);
    topRow.appendChild(counter);
    // topRow.appendChild(scaleWrap);
    topRow.appendChild(toolBtnGroup);
    topRow.appendChild(minimizeBtn);
    topRow.appendChild(closeBtn);

    // Строка сортировки
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
    const btnCSS = `padding:4px 10px; font-size:12px; border-radius:6px; cursor:pointer;
        border:1px solid #ccc; background:#fff; color:#555;
        transition:all 0.15s; white-space:nowrap;`;

    const groupBtn = document.createElement('button');
    groupBtn.textContent = '👁 Похожие';
    groupBtn.title = 'Группировать карточки по визуальному сходству';
    groupBtn.style.cssText = btnCSS;

    const imgSearchBtn = document.createElement('button');
    imgSearchBtn.textContent = '🖼 По картинке';
    imgSearchBtn.title = 'Найти похожие на указанное изображение';
    imgSearchBtn.style.cssText = btnCSS + 'display:none;';

    // переключатель вида: «строки» vs «сетка»
    const layoutBtn = document.createElement('button');
    layoutBtn.title = 'Переключить вид групп';
    layoutBtn.style.cssText = btnCSS + 'display:none; padding:4px 8px;';
    layoutBtn.textContent = '☰';  // строки

    function invalidateGroupCache() {
        _searchGroupCache = null;
        _savedGroupCache = null;
    }
    window._invalidateGroupCache = invalidateGroupCache;

    function updateGroupBtnStyle() {
        groupBtn.style.background = groupingActive ? '#2196F3' : '#fff';
        groupBtn.style.color = groupingActive ? '#fff' : '#555';
        groupBtn.style.borderColor = groupingActive ? '#2196F3' : '#ccc';
        imgSearchBtn.style.display = groupingActive ? '' : 'none';
        layoutBtn.style.display = groupingActive ? '' : 'none';
        if (!groupingActive) {
            imgSearchBtn.textContent = '🖼 По картинке';
            imgSearchBtn.style.background = '#fff';
            imgSearchBtn.style.borderColor = '#ccc';
            imgSearchBtn.style.color = '#555';
        }
    }

    function updateLayoutBtnStyle() {
        layoutBtn.textContent = groupLayout === 'rows' ? '⠿' : '☰';
        layoutBtn.title = groupLayout === 'rows' ? 'Вид: плитка (группы идут подряд с разделителями)' : 'Вид: строки (каждая группа с новой строки)';
    }
    updateLayoutBtnStyle();

    groupBtn.addEventListener('click', () => {
        groupingActive = !groupingActive;
        if (!groupingActive) { referenceFeatures = null; referenceImgSrc = null; }
        updateGroupBtnStyle();
        invalidateGroupCache();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    });

    layoutBtn.addEventListener('click', () => {
        groupLayout = groupLayout === 'rows' ? 'flow' : 'rows';
        updateLayoutBtnStyle();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    });

    // ── поиск по картинке ──────────────────────────────────────────────────────
    const imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/*';
    imgInput.style.display = 'none';

    // Общая функция обработки изображения из любого источника
    async function processReferenceImage(blob) {
        closeImgPickerPopup();
        const url = URL.createObjectURL(blob);
        referenceImgSrc = url;
        imgSearchBtn.textContent = '⏳ Анализ...';
        imgSearchBtn.disabled = true;
        try {
            const imgData = await getImageDataFromSrc(url);
            referenceFeatures = { phash: computePHash(imgData), hist: computeColorHistogram(imgData) };
        } finally {
            URL.revokeObjectURL(url);
        }
        imgSearchBtn.textContent = '🖼 По картинке ✓';
        imgSearchBtn.style.background = '#e8f5e9';
        imgSearchBtn.style.borderColor = '#81c784';
        imgSearchBtn.style.color = '#2e7d32';
        imgSearchBtn.disabled = false;
        invalidateGroupCache();
        if (activeTab === 'search') renderTiles(getFilteredAndSorted(searchInput.value));
        else renderSavedTiles();
    }

    imgInput.addEventListener('change', async () => {
        const file = imgInput.files[0];
        if (!file) return;
        imgInput.value = '';
        await processReferenceImage(file);
    });

    // ── Попап выбора изображения ──────────────────────────────────────────────
    let imgPickerPopup = null;

    function closeImgPickerPopup() {
        if (imgPickerPopup) { imgPickerPopup.remove(); imgPickerPopup = null; }
    }

    function openImgPickerPopup() {
        if (imgPickerPopup) { closeImgPickerPopup(); return; }

        imgPickerPopup = document.createElement('div');
        imgPickerPopup.style.cssText = `
            position:absolute; z-index:10000;
            background:#fff; border:1px solid #ddd; border-radius:12px;
            box-shadow:0 4px 20px rgba(0,0,0,.18);
            padding:14px 16px; width:260px;
            display:flex; flex-direction:column; gap:10px;
        `;

        // Позиционируем под кнопкой
        const btnRect = imgSearchBtn.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        imgPickerPopup.style.top = (btnRect.bottom - popupRect.top + 6) + 'px';
        imgPickerPopup.style.left = (btnRect.left - popupRect.left) + 'px';

        // Заголовок
        const title = document.createElement('div');
        title.textContent = 'Выбрать изображение';
        title.style.cssText = 'font-size:13px; font-weight:bold; color:#333;';

        // Зона drag-and-drop / вставки
        const dropZone = document.createElement('div');
        dropZone.style.cssText = `
            border:2px dashed #bbb; border-radius:8px;
            padding:18px 10px; text-align:center;
            font-size:12px; color:#888; cursor:pointer;
            transition: border-color .15s, background .15s;
            user-select:none;
        `;
        dropZone.innerHTML = '📋 Вставьте (Ctrl+V)<br>или перетащите картинку сюда';

        // При фокусе зоны — принимаем Ctrl+V
        dropZone.tabIndex = 0;
        dropZone.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                e.stopPropagation();
                // paste-событие не приходит на div — читаем через clipboardData вручную
                // нужно сфокусировать hidden input и симулировать paste
                pasteInput.focus();
            }
        });

        // Highlight on drag
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#2196F3';
            dropZone.style.background = '#e3f2fd';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#bbb';
            dropZone.style.background = '';
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#bbb';
            dropZone.style.background = '';
            const file = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
            if (file) { await processReferenceImage(file); return; }
            // Может быть img-элемент перетащен из страницы
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && /^https?:\/\//.test(url)) {
                try {
                    const resp = await fetch(url);
                    const blob = await resp.blob();
                    if (blob.type.startsWith('image/')) { await processReferenceImage(blob); return; }
                } catch (_) { }
            }
            showNotification('⚠️ Не удалось получить изображение из перетащенного объекта.');
        });
        dropZone.addEventListener('click', () => pasteInput.focus());

        // Скрытый contenteditable — ловит системный paste (Ctrl+V) без запроса разрешений
        const pasteInput = document.createElement('div');
        pasteInput.contentEditable = 'true';
        pasteInput.style.cssText = 'position:absolute; opacity:0; width:1px; height:1px; overflow:hidden; pointer-events:none;';
        pasteInput.addEventListener('paste', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    if (blob) { await processReferenceImage(blob); return; }
                }
            }
            showNotification('⚠️ В буфере нет изображения.');
        });

        // Кнопка «Выбрать файл»
        const fileBtn = document.createElement('button');
        fileBtn.textContent = '📁 Выбрать файл с компьютера';
        fileBtn.style.cssText = `
            padding:8px 12px; border:1px solid #ddd; border-radius:8px;
            cursor:pointer; font-size:12px; background:#f5f5f5; color:#333;
            text-align:left; transition: background .15s;
        `;
        fileBtn.addEventListener('mouseenter', () => fileBtn.style.background = '#ececec');
        fileBtn.addEventListener('mouseleave', () => fileBtn.style.background = '#f5f5f5');
        fileBtn.addEventListener('click', () => { imgInput.click(); });

        imgPickerPopup.appendChild(title);
        imgPickerPopup.appendChild(dropZone);
        imgPickerPopup.appendChild(pasteInput);
        imgPickerPopup.appendChild(fileBtn);
        uiRoot.appendChild(imgPickerPopup);

        // Автофокус на pasteInput чтобы сразу принимать Ctrl+V
        setTimeout(() => pasteInput.focus(), 50);

        // Закрываем по клику снаружи
        const outsideClick = (e) => {
            if (!imgPickerPopup) return;
            if (!imgPickerPopup.contains(e.target) && e.target !== imgSearchBtn) {
                closeImgPickerPopup();
                document.removeEventListener('mousedown', outsideClick, true);
            }
        };
        document.addEventListener('mousedown', outsideClick, true);
    }

    imgSearchBtn.addEventListener('click', openImgPickerPopup);

    // ── Разделитель ──
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
        const entry = attributeSuggestCache.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
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
        const entry = attributeSuggestCache.find(e => normalizeSortFieldName(e.name) === n);
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
        const searchRootActive = uiRoot.activeElement || document.activeElement;
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
            const allEntries = [...specialEntries, ...attributeSuggestCache];
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
                    const fields = [...builtins, ...attributeSuggestCache].filter(e => {
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
            const searchRootActive = uiRoot.activeElement || document.activeElement;
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

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.title = 'Очистить фильтр';
    clearBtn.style.cssText = `
        padding: 8px 12px; background: #6c757d; color: white;
        border: none; border-radius: 6px; cursor: pointer;
    `;

    const hint = document.createElement('span');
    hint.textContent = '?';
    hint.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%;
        background: #6c757d; color: white;
        font-size: 12px; font-weight: bold;
        cursor: help; flex-shrink: 0; user-select: none;
        position: relative;
    `;

    const searchTooltip = document.createElement('div');
    searchTooltip.style.cssText = `
        display: none; position: absolute; top: calc(100% + 8px); right: 0;
        background: #333; color: white; padding: 10px 14px;
        border-radius: 8px; font-size: 12px; line-height: 1.6;
        white-space: pre; z-index: 100000;
        max-width: min(620px, calc(100vw - 32px));
        max-height: min(70vh, 620px);
        overflow: auto;
        box-sizing: border-box;
        scrollbar-width: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    `;
    searchTooltip.textContent = `Спецсимволы:
  *  — любое кол-во символов     farm* → farmina, farmland
  ?  — ровно один символ         кошк? → кошка, кошки
  [аб] — один из символов         к[ио]т → кот, кит
  {N...M} — число в диапазоне     {0.5...2} → «корм 1 кг», «500г»
       Также: {1-2}, {1..2}, {1 до 2}
  !слово — исключить слово         !собак*
  "фраза" — точное словосочетание
  !"фраза" — исключить фразу
  (a|b|c) — OR: одно из нескольких
  !(a|b|c) — исключить группу

Дополнительные атрибуты:
  @имя(запрос) — фильтр только по указанному атрибуту
  @бренд(apple)
  @цвет("тёмно синий")
  @вес({1-2})
  @бренд(!apple !samsung (xiaomi|honor) обязательно)
  @атрибут() — атрибут присутствует
  @атрибут(!) — атрибут отсутствует
  @атрибут(!запрос) — атрибут не содержит запрос

Основные атрибуты (альтернатива отдельным полям):
  @название(корм*)
  @цена({500-1000})
  @цена/ед.({100-300})
  @рейтинг({4-5})
  @отзывы({1000-100000})
  @доставка(30.08) — доставка в эту дату
  @доставка(30.08.2026) — дата с годом
  @доставка({28.08-05.09}) — диапазон дат (текущий год)
  @доставка({28.08-05.09.2026}) — диапазон с годом (год без {} — тоже работает)
  @доставка({28.08-*}) / @доставка({*-05.09}) — открытая граница диапазона
  @доставка({28.08-01.09}|{10.09-15.09}) — несколько диапазонов сразу (ИЛИ)
  @доставка(!28.08-05.09.2026) — доставка НЕ в этом диапазоне
  Для них работают () и (!): @цена() / @цена(!)
  И отрицание значения: @цена(!1000)
  • область атрибута всегда ограничена скобками: @имя(...)
  • ! внутри скобок исключает значение только для этого атрибута
  • @атрибут(...) можно сочетать с названием и другими атрибутами

Гибкие фразы:
  "({1-2} кг|{1000-2000} (гр|грамм|г))"
  • внутри кавычек можно использовать (), | и диапазоны
  • пробелы внутри гибкой фразы необязательны: «1 кг» и «1кг»
  • ~ — явное обозначение необязательного пробела: «1~кг»
  • диапазон проверяется по найденному числу, а не только по тексту

Как работает поиск:
  • отдельные условия разделяются пробелами
  • все условия должны выполняться (AND)
  • порядок слов не важен (кроме фраз)
  • регистр не важен
  • ! перед условием исключает совпадения

Примеры:
  farm* !собак*
  к[ио]т {0.4...1.5}кг
  "корм для кошек" !("сухой"|"гранулы")
  iphone @бренд(hill*|royal*) @вес({0.4-1.5})
  !"({1-2} кг|{1000-2000} (гр|грамм|г))"`;

    hint.appendChild(searchTooltip);
    let searchTooltipHideTimer = null;
    const showSearchTooltip = () => {
        if (searchTooltipHideTimer) { clearTimeout(searchTooltipHideTimer); searchTooltipHideTimer = null; }
        searchTooltip.style.display = 'block';
    };
    const scheduleHideSearchTooltip = () => {
        if (searchTooltipHideTimer) clearTimeout(searchTooltipHideTimer);
        searchTooltipHideTimer = setTimeout(() => {
            searchTooltip.style.display = 'none';
            searchTooltipHideTimer = null;
        }, 300);
    };
    hint.addEventListener('mouseenter', showSearchTooltip);
    hint.addEventListener('mouseleave', scheduleHideSearchTooltip);
    searchTooltip.addEventListener('mouseenter', showSearchTooltip);
    searchTooltip.addEventListener('mouseleave', scheduleHideSearchTooltip);

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        if (activeTab === 'saved') {
            renderSavedTiles();
        } else {

    // Делегирование hover/click для карточек. Не создаём по 3 listener'а на каждую карточку.
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
            applyFilters();
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
        applyFilters();
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

    priceFilterByUnit = false; // оставляем переменную для совместимости, но она больше не используется

    chrome.storage.local.get(['unitPricePriority'], d => {
        unitPricePriority = d.unitPricePriority || 'auto';
        unitPrioritySelect.value = unitPricePriority;
        updatePriceUnitUI();
    });
    unitPrioritySelect.addEventListener('change', () => {
        unitPricePriority = unitPrioritySelect.value || 'auto';
        chrome.storage.local.set({ unitPricePriority });
        updatePriceUnitUI();
        scheduleApplyFilters();
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
        scheduleDeliveryCalendarRefresh(true);
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
        counter.replaceChildren();
        if (String(mode).startsWith('per-gram')) {
            counter.appendChild(document.createTextNode(`${count}/${total} шт. · ⚖️ `));
            unitPrioritySelect.style.verticalAlign = 'middle';
            unitPrioritySelect.style.margin = '0 2px';
            counter.appendChild(unitPrioritySelect);
            counter.appendChild(document.createTextNode(` ${arrow}`));
        } else {
            if (unitPrioritySelect.parentElement !== priceRow) {
                priceRow.appendChild(unitPrioritySelect);
            }
            const label = getSortModeLabel(mode);
            counter.appendChild(document.createTextNode(`${count}/${total} шт. · ${label} ${arrow}`));
        }
        counter.appendChild(document.createTextNode(' '));
        counter.appendChild(deliveryCalendarActionsWrap);
        updateDeliveryCalendarButton();
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
    let linkedFiltersEnabled = true;
    let linkedFiltersSyncing = false;
    let linkedFiltersStatus = null;

    chrome.storage.local.get(['linkedFiltersEnabled'], d => {
        linkedFiltersEnabled = d.linkedFiltersEnabled !== false;
        if (linkedFiltersStatus) updateLinkedFiltersStatus();
    });

    function getLinkedFieldInputSet(field) {
        return {
            price: [priceMin, priceMax],
            perunit: [priceUnitMin, priceUnitMax],
            rating: [ratingMin, ratingMax],
            reviews: [reviewsMin, reviewsMax],
            delivery: [deliveryMin, deliveryMax]
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
        const query = searchInput.value.trim();
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
        let query=searchInput.value.trim();
        // Удаляем только простые primary-field clauses. Остальной пользовательский
        // запрос (например, «корм*») сохраняем. Сложные field-выражения не трогаем.
        const simpleClauseRe=/@([\p{L}\p{N}_\/.-]+)\((\{[^(){}]+\})\)/giu;
        query=query.replace(simpleClauseRe, (full,name)=> isSimpleLinkedFieldClauseName(name) ? '' : full).replace(/\s{2,}/g,' ').trim();
        if (clauses.length) query=query ? `${query} ${clauses.join(' ')}` : clauses.join(' ');
        linkedFiltersSyncing=true;
        searchInput.value=query;
        linkedFiltersSyncing=false;
        updateLinkedFiltersStatus();
        searchInput.dispatchEvent(new Event('input',{bubbles:true}));
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
    rangeRow2.appendChild(linkedToggleWrap);
    rangeRow2.appendChild(linkedFiltersStatus);

    [priceMin, priceMax, priceUnitMin, priceUnitMax, ratingMin, ratingMax, reviewsMin, reviewsMax, deliveryMin, deliveryMax].forEach(input => {
        input.addEventListener('input', () => { syncSearchFromFields(); scheduleApplyFilters(); });
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
    const PRIMARY_ATTR_HINTS = [
        { name: 'название', kind: 'primary-text', staticHint: 'обычный текстовый поиск, например @название(корм*)' },
        { name: 'цена', kind: 'primary-number', vals: 'priceVals', unit: '₽' },
        { name: 'цена/ед.', kind: 'primary-number', vals: 'unitVals' },
        { name: 'рейтинг', kind: 'primary-number', vals: 'ratingVals' },
        { name: 'отзывы', kind: 'primary-number', vals: 'reviewsVals' },
        { name: 'доставка', kind: 'primary-date', vals: 'deliveryVals' },
    ];

    let attributeSuggestCache = [];

    function rebuildAttributeSuggestCache(tiles, primaryVals) {
        const entries = [];

        for (const def of PRIMARY_ATTR_HINTS) {
            if (def.kind === 'primary-number') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                const d = def.name === 'цена/ед.' ? getUnitPriceDecimalsForPriority() : (def.name === 'рейтинг' ? undefined : 0);
                const min = Math.min(...vals), max = Math.max(...vals);
                const fmt = v => d != null ? v.toFixed(d) : String(v);
                entries.push({ name: def.name, kind: def.kind, hint: `${fmt(min)} – ${fmt(max)}` });
            } else if (def.kind === 'primary-date') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                entries.push({ name: def.name, kind: def.kind, hint: `${formatDateToString(Math.min(...vals))} – ${formatDateToString(Math.max(...vals))}` });
            } else {
                entries.push({ name: def.name, kind: def.kind, hint: def.staticHint || null, static: true });
            }
        }

        // Настраиваемые (дополнительные) атрибуты — те же данные, что уже
        // используются панелью «Доп. атрибуты и величины» ниже.
        let extraDefs = [];
        try { extraDefs = getExtraDefinitions(tiles); } catch { extraDefs = []; }
        for (const def of extraDefs) {
            const name = def.name;
            if (!name) continue;
            let hint = null;
            if (def.kind === 'quantity') {
                const nums = def.values.map(parseExtraNumber).filter(v => v != null);
                if (nums.length) {
                    const min = Math.min(...nums), max = Math.max(...nums);
                    hint = `${min}${def.unit ? ' ' + def.unit : ''} – ${max}${def.unit ? ' ' + def.unit : ''}`;
                }
            } else {
                const freq = new Map();
                for (const raw of def.values) {
                    for (const v of String(raw).split(' | ').map(s => s.trim()).filter(Boolean)) {
                        freq.set(v, (freq.get(v) || 0) + 1);
                    }
                }
                const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
                if (top.length) hint = top.join(', ') + (freq.size > top.length ? ', …' : '');
            }
            entries.push({ name, kind: def.kind === 'quantity' ? 'extra-quantity' : 'extra-text', hint });
        }

        attributeSuggestCache = entries;
        refreshAttributeAutocompleteUi();
    }

    // ── Кнопка «Сбросить всё» ──
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
        currentMode = 'asc';
        sortBtns.forEach(([bm, b]) => {
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
        searchInput.value = '';
        // Сброс кэша групп
        _searchGroupCache = null;
        _savedGroupCache = null;
        applyFilters();
    });
    sortRow.appendChild(resetFiltersBtn);

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
    filtersBody.appendChild(sortRow);
    filtersBody.appendChild(typeRow);
    filtersBody.appendChild(priceRow);
    filtersBody.appendChild(rangeRow2);
    filtersBody.appendChild(extraControls);
    filtersPanel.appendChild(filtersToggle);
    filtersPanel.appendChild(filtersBody);
    setFiltersPanelOpen(false);

    header.appendChild(topRow);
    header.appendChild(searchRow);
    header.appendChild(filtersPanel);

    // ─── Панель выделения ──────────────────────────────────────────────────────────
    const selectionPanel = document.createElement('div');
    selectionPanel.style.cssText = `
    display: flex; padding: 10px 20px;
    background: #e3f2fd; border-top: 1px solid #90caf9;
    flex-shrink: 0; gap: 10px; align-items: center;
    flex-wrap: wrap;
`;

    const selectionCounter = document.createElement('span');
    selectionCounter.style.cssText = 'font-size:13px; color:#1565c0; font-weight:bold;';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '☑ Выбрать все';
    selectAllBtn.style.cssText = 'padding:6px 12px; background:#2196F3; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const deselectBtn = document.createElement('button');
    deselectBtn.textContent = '✕ Снять выделение';
    deselectBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';

    const saveSelectedBtn = document.createElement('button');
    saveSelectedBtn.textContent = '🔖 Сохранить выбранные';
    saveSelectedBtn.style.cssText = 'padding:6px 12px; background:#4CAF50; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const invertBtn = document.createElement('button');
    invertBtn.textContent = '⇄ Инвертировать';
    invertBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    invertBtn.addEventListener('click', () => {
        currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (selectedKeys.has(k)) selectedKeys.delete(k);
            else selectedKeys.add(k);
        });
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    selectionPanel.appendChild(selectionCounter);
    selectionPanel.appendChild(selectAllBtn);
    selectionPanel.appendChild(deselectBtn);
    selectionPanel.appendChild(invertBtn);
    selectionPanel.appendChild(saveSelectedBtn);

    function updateSelectionPanel() {
        selectionCounter.textContent = selectedKeys.size > 0 ? `Выбрано: ${selectedKeys.size}` : '';
    }

    selectAllBtn.addEventListener('click', () => {
        currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (k) selectedKeys.add(k);
        });
        lastSelectedIndex = -1; lastSelectedKey = null;
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    deselectBtn.addEventListener('click', () => {
        selectedKeys.clear();
        lastSelectedIndex = -1; lastSelectedKey = null;
        updateSelectionPanel();
        updateVisibleSelectionState();
    });

    saveSelectedBtn.addEventListener('click', async () => {
        const tilesToSave = currentTiles
            .filter(tile => selectedKeys.has(getTileKey(tile)));
        if (tilesToSave.length === 0) return;

        // показываем диалог выбора папок
        const existingFolders = getAllFoldersGlobal ? await getAllFoldersGlobal() : [];
        showSaveFolderDialog(saveSelectedBtn, existingFolders, async (chosenFolders) => {
            const total = tilesToSave.length;
            const progress = total > 3 ? createProgressBar(
                '⏳ Подготовка: 0 / ' + total + ' карточек...'
            ) : null;

            // Собираем HTML карточек с прогрессом
            const toSave = [];
            for (let i = 0; i < tilesToSave.length; i++) {
                const tile = tilesToSave[i];
                const key = getTileKey(tile);
                const title = getTileTitle(tile);
                const price = getPrice(tile);
                const rating = getRating(tile);
                const reviews = getReviewsCount(tile);
                const delivery = getDeliveryDate(tile);
                const html = await buildNormalizedTileHtml(tile);
                toSave.push({ key, title, price, rating, reviews, delivery, html, site: window.location.hostname, savedAt: Date.now(), folders: chosenFolders });
                if (progress) {
                    const pct = Math.round((i + 1) / total * 60);
                    progress.update(pct, '⏳ Подготовка: ' + (i + 1) + ' / ' + total + ' карточек...');
                }
            }

            if (progress) progress.update(65, '⏳ Сохранение в базу...');

            let added = 0;
            try {
                // Читаем один раз — используем для addToSaved и для обновления папок
                const existingAll = await getSavedTiles();
                const existingMap = new Map(existingAll.map(t => [t.key, t])); // O(1) lookup

                const saveKeys = new Set(toSave.map(t => t.key));
                const reallyNew = toSave.filter(t => !existingMap.has(t.key));

                // Добавляем новые карточки
                const withNew = [...existingAll, ...reallyNew];
                added = reallyNew.length;

                // Обновляем папки у уже существующих карточек из toSave — за O(n), без find()
                let folderChanged = false;
                if (chosenFolders.length > 0) {
                    for (const tile of toSave) {
                        const existing = existingMap.get(tile.key);
                        if (!existing) continue; // новая — папки уже проставлены при создании
                        const merged = [...new Set([...(existing.folders || []), ...chosenFolders])];
                        if (merged.length !== (existing.folders || []).length) {
                            existing.folders = merged;
                            folderChanged = true;
                        }
                    }
                }

                // Одна запись вместо двух
                if (added > 0 || folderChanged) {
                    if (progress) progress.update(80, '⏳ Сохранение...');
                    await saveTiles(withNew);
                    reallyNew.forEach(t => savedKeysCache.add(t.key));
                    refreshSavedKeysCache();
                    window._invalidateGroupCache?.();
                }
            } catch (e) {
                progress?.remove();
                showNotification(`❌ Ошибка сохранения: ${e?.message || e}`, 'error');
                return;
            }

            selectedKeys.clear();
            updateSelectionPanel();
            renderTiles(currentTiles);

            const folderStr = chosenFolders.length ? ` → 📁 ${chosenFolders.join(', ')}` : '';
            let msg;
            if (added === 0 && chosenFolders.length === 0) {
                msg = '⚠️ Все выбранные товары уже сохранены';
            } else if (added === 0) {
                msg = '📁 Папки обновлены для ' + toSave.length + ' товаров' + folderStr;
            } else if (added < toSave.length) {
                msg = '🔖 Сохранено: ' + added + ' из ' + toSave.length + folderStr;
            } else {
                msg = '🔖 Сохранено: ' + added + ' товаров' + folderStr;
            }

            if (progress) {
                progress.update(100, msg);
                setTimeout(() => progress.remove(), 2000);
            } else {
                showNotification(msg, added === 0 && chosenFolders.length === 0 ? 'warning' : 'info');
            }
        });
    });

    uiRoot.appendChild(header);
    cardsHost.appendChild(productsContainer);
    bottomUiRoot.appendChild(selectionPanel);

    // ─── Контейнер сохранённых товаров ────────────────────────────────────────────
    // savedContainer добавляется после folderRow (ниже)

    // Панель действий для сохранённых
    const savedPanel = document.createElement('div');
    savedPanel.style.cssText = `
    display: none; padding: 8px 20px;
    background: #fff8e1; border-top: 1px solid #ffe082;
    flex-shrink: 0; flex-direction: column; gap: 6px;
`;

    // строка 1: счётчик, кнопки выделения, хранилище
    const savedPanelRow1 = document.createElement('div');
    savedPanelRow1.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';
    // строка 2: импорт/экспорт/очистка
    const savedPanelRow2 = document.createElement('div');
    savedPanelRow2.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';

    const savedCounter = document.createElement('span');
    savedCounter.style.cssText = 'font-size:13px; color:#f57f17; font-weight:bold;';

    const storageIndicator = document.createElement('span');
    storageIndicator.className = 'storageIndicator';
    storageIndicator.style.cssText = 'font-size:12px; color:#999; margin-left: auto; cursor:help;';

    async function updateStorageIndicator() {
        // chrome.storage.local — только savedTiles
        const localUsed = await new Promise(r =>
            chrome.storage.local.getBytesInUse ? chrome.storage.local.getBytesInUse('savedTiles', r) : r(0)
        );
        const localMb = (localUsed / 1024 / 1024).toFixed(2);
        const localLimit = 10;
        const localPct = Math.round(localUsed / (localLimit * 1024 * 1024) * 100);

        // IndexedDB — картинки, размер из background (его origin)
        let imgMb = '?';
        let imgCount = '';
        try {
            const resp = await new Promise(r => chrome.runtime.sendMessage({ action: 'getStorageSize' }, r));
            if (resp?.ok) {
                imgMb = (resp.bytes / 1024 / 1024).toFixed(1);
                imgCount = ` (${resp.count} шт.)`;
            }
        } catch { }

        const color = localPct > 80 ? '#e53935' : localPct > 50 ? '#f57f17' : '#999';
        storageIndicator.style.color = color;
        storageIndicator.textContent = `💾 атрибуты: ${localMb}/${localLimit} МБ · картинки: ${imgMb} МБ${imgCount}`;
        storageIndicator.title =
            `chrome.storage.local (метаданные): ${localMb} МБ из ${localLimit} МБ (${localPct}%)\n` +
            `IndexedDB (картинки): ~${imgMb} МБ${imgCount} (лимит — десятки ГБ)`;
    }

    const clearSavedBtn = document.createElement('button');
    clearSavedBtn.textContent = '🗑 Очистить всё';
    clearSavedBtn.style.cssText = 'padding:6px 12px; background:#ff5722; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const removeSelectedSavedBtn = document.createElement('button');
    removeSelectedSavedBtn.textContent = '✕ Удалить выбранные';
    removeSelectedSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';

    const savedSelectionCounter = document.createElement('span');
    savedSelectionCounter.style.cssText = 'font-size:13px; color:#e64a19; font-weight:bold; display:none;';

    function updateSavedSelectionCounter() {
        const n = savedSelectedKeys.size;
        savedSelectionCounter.style.display = n > 0 ? 'inline' : 'none';
        savedSelectionCounter.textContent = `Выбрано: ${n}`;
        removeSelectedSavedBtn.style.display = n > 0 ? 'block' : 'none';
        invertSavedBtn.style.display = n > 0 ? 'inline-block' : 'none';
        exportSelectedBtn.style.display = n > 0 ? 'inline-block' : 'none';
        deselectSavedBtn.style.display = n > 0 ? 'inline-block' : 'none';
    }

    const invertSavedBtn = document.createElement('button');
    invertSavedBtn.textContent = '⇄ Инвертировать';
    invertSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    invertSavedBtn.addEventListener('click', () => {
        currentSavedTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (savedSelectedKeys.has(k)) savedSelectedKeys.delete(k);
            else savedSelectedKeys.add(k);
        });
        // обновляем визуал всех карточек
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const k = w.dataset.savedKey;
            const selected = savedSelectedKeys.has(k);
            const cb = w.querySelector('.saved-checkbox');
            if (cb) {
                cb.style.display = selected ? 'flex' : 'none';
                cb.style.background = selected ? '#ff5722' : 'rgba(255,255,255,0.9)';
                cb.style.borderColor = selected ? '#ff5722' : '#ccc';
                cb.textContent = selected ? '✓' : '';
            }
            w.style.outline = selected ? '2px solid #ff5722' : '';
            w.style.borderRadius = selected ? '8px' : '';
        });
        updateSavedSelectionCounter();
    });

    invertSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';

    const { createProgressBar, exportBtn, exportSelectedBtn, importBtn, importInput } = createProductTransfer({
        get savedContainer() { return savedContainer; },
        get savedSelectedKeys() { return savedSelectedKeys; },
        get showNotification() { return showNotification; },
        get switchTab() { return switchTab; }
    });

    const deselectSavedBtn = document.createElement('button');
    deselectSavedBtn.textContent = '✕ Снять';
    deselectSavedBtn.title = 'Снять выделение';
    deselectSavedBtn.style.cssText = 'padding:5px 10px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';
    deselectSavedBtn.addEventListener('click', () => {
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const cb = w.querySelector('.saved-checkbox');
            if (cb) { cb.style.display = 'none'; cb.textContent = ''; cb.style.background = 'rgba(255,255,255,0.9)'; cb.style.borderColor = '#ccc'; }
            w.style.outline = '';
        });
        updateSavedSelectionCounter();
    });

    const selectAllSavedBtn = document.createElement('button');
    selectAllSavedBtn.textContent = '☑ Все';
    selectAllSavedBtn.title = 'Выбрать все карточки';
    selectAllSavedBtn.style.cssText = 'padding:5px 10px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    selectAllSavedBtn.addEventListener('click', () => {
        savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const k = w.dataset.savedKey;
            if (k) savedSelectedKeys.add(k);
            const cb = w.querySelector('.saved-checkbox');
            if (cb) { cb.style.display = 'flex'; cb.style.background = '#ff5722'; cb.style.borderColor = '#ff5722'; cb.textContent = '✓'; }
            w.style.outline = '2px solid #ff5722';
            w.style.borderRadius = '8px';
        });
        updateSavedSelectionCounter();
    });

    // строка 1: выделение
    savedPanelRow1.appendChild(selectAllSavedBtn);
    savedPanelRow1.appendChild(savedSelectionCounter);
    savedPanelRow1.appendChild(deselectSavedBtn);
    savedPanelRow1.appendChild(invertSavedBtn);
    savedPanelRow1.appendChild(removeSelectedSavedBtn);
    savedPanelRow1.appendChild(exportSelectedBtn);

    // строка 2: импорт/экспорт/очистка + счётчик и хранилище прижаты вправо
    savedPanelRow2.appendChild(exportBtn);
    savedPanelRow2.appendChild(importBtn);
    savedPanelRow2.appendChild(importInput);
    savedPanelRow2.appendChild(clearSavedBtn);
    savedCounter.style.marginLeft = 'auto';
    savedPanelRow2.appendChild(savedCounter);
    savedPanelRow2.appendChild(storageIndicator);

    savedPanel.appendChild(savedPanelRow1);
    savedPanel.appendChild(savedPanelRow2);
    const folderRow = document.createElement('div');
    folderRow.style.cssText = `
        display: none; flex-direction: column; gap: 6px; padding: 6px 20px;
        background: #f5f5f5; border-bottom: 1px solid #e0e0e0;
        flex-shrink: 0;
    `;

    let activeFolderFilter = null; // null = все
    let folderSearchQuery = '';

    function getAllFolders(tiles) {
        const set = new Set();
        tiles.forEach(t => (t.folders || []).forEach(f => set.add(f)));
        return [...set].sort();
    }

    function renderFolderRow(tiles) {
        folderRow.innerHTML = '';
        const folders = getAllFolders(tiles);
        // сбрасываем фильтр если папка исчезла
        if (activeFolderFilter && !folders.includes(activeFolderFilter)) {
            activeFolderFilter = null;
        }
        if (!folders.length) { folderRow.style.display = 'none'; return; }
        folderRow.style.display = 'flex';

        // верхняя строка: поиск (если папок много) + кнопка управления — всегда на виду, не скроллится
        const topBar = document.createElement('div');
        topBar.style.cssText = 'display:flex; align-items:center; gap:6px;';

        let searchInput = null;
        if (folders.length > 6) {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '🔍 Поиск папки...';
            searchInput.value = folderSearchQuery;
            searchInput.style.cssText = 'flex:1; min-width:0; padding:5px 10px; border:1px solid #ddd; border-radius:14px; font-size:12px; outline:none; background:#fff;';
            searchInput.addEventListener('input', () => {
                folderSearchQuery = searchInput.value;
                renderPills();
            });
            topBar.appendChild(searchInput);
        }

        // кнопка управления папками
        const manageFoldersBtn = document.createElement('button');
        manageFoldersBtn.textContent = '✏️';
        manageFoldersBtn.title = 'Управление папками (переименование, удаление)';
        manageFoldersBtn.style.cssText = `padding:4px 8px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; margin-left:${searchInput ? '0' : 'auto'}; background:#fff; flex-shrink:0;`;
        manageFoldersBtn.addEventListener('click', e => { e.stopPropagation(); showManageFoldersMenu(manageFoldersBtn, folders); });
        topBar.appendChild(manageFoldersBtn);

        folderRow.appendChild(topBar);

        // прокручиваемая область с папками
        const pillsWrap = document.createElement('div');
        pillsWrap.style.cssText = `display:flex; gap:6px; align-items:center; flex-wrap:wrap;
            max-height:76px; overflow-y:auto; padding-right:2px;`;
        folderRow.appendChild(pillsWrap);

        function renderPills() {
            pillsWrap.innerHTML = '';
            const q = folderSearchQuery.trim().toLowerCase();

            if (!q) {
                const allBtn = document.createElement('button');
                allBtn.textContent = '📂 Все';
                allBtn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${activeFolderFilter === null ? '#2196F3' : '#fff'}; color:${activeFolderFilter === null ? '#fff' : '#444'};`;
                allBtn.addEventListener('click', () => { activeFolderFilter = null; invalidateGroupCache(); renderSavedTiles(); });
                pillsWrap.appendChild(allBtn);
            }

            const filtered = q ? folders.filter(f => f.toLowerCase().includes(q)) : folders;
            filtered.forEach(f => {
                const btn = document.createElement('button');
                btn.textContent = `📁 ${f}`;
                btn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${activeFolderFilter === f ? '#2196F3' : '#fff'}; color:${activeFolderFilter === f ? '#fff' : '#444'};`;
                btn.addEventListener('click', () => { activeFolderFilter = f; invalidateGroupCache(); renderSavedTiles(); });
                pillsWrap.appendChild(btn);
            });

            if (q && !filtered.length) {
                const empty = document.createElement('span');
                empty.textContent = 'Ничего не найдено';
                empty.style.cssText = 'font-size:12px; color:#999; padding:4px 2px;';
                pillsWrap.appendChild(empty);
            }
        }
        renderPills();
    }

    function showManageFoldersMenu(anchorBtn, folders) {
        uiRoot.querySelector('#ss-manage-folders-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'ss-manage-folders-menu';
        menu.style.cssText = `
            position:fixed; z-index:100010; background:#fff;
            border:1px solid #ddd; border-radius:8px; padding:8px;
            box-shadow:0 4px 16px rgba(0,0,0,0.2); width:260px; max-width:calc(100vw - 16px);
            font-size:13px; box-sizing:border-box;
        `;

        const title = document.createElement('div');
        title.textContent = 'Управление папками';
        title.style.cssText = 'font-weight:bold; padding:2px 6px 8px; border-bottom:1px solid #eee; margin-bottom:6px;';
        menu.appendChild(title);

        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = '🔍 Поиск папки...';
        search.autocomplete = 'off';
        search.style.cssText = 'width:100%; box-sizing:border-box; padding:6px 9px; border:1px solid #ddd; border-radius:6px; font-size:12px; outline:none; margin-bottom:6px;';
        menu.appendChild(search);

        const listWrap = document.createElement('div');
        listWrap.style.cssText = 'max-height:300px; overflow-y:auto; overflow-x:hidden; padding-right:2px; display:flex; flex-direction:column; gap:2px;';
        menu.appendChild(listWrap);

        const selectedFolders = new Set();
        const rows = [];
        let deleteSelBtn = null;
        let mergeSelBtn = null;

        const updateActionButtons = () => {
            if (deleteSelBtn) deleteSelBtn.style.display = selectedFolders.size > 0 ? 'block' : 'none';
            if (mergeSelBtn) mergeSelBtn.style.display = selectedFolders.size >= 2 ? 'block' : 'none';
        };

        folders.forEach(f => {
            const row = document.createElement('div');
            row.dataset.folderName = f.toLowerCase();
            row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; min-height:28px;';
            row.addEventListener('mouseenter', () => row.style.background = '#f5f5f5');
            row.addEventListener('mouseleave', () => row.style.background = '');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.style.cursor = 'pointer';
            cb.addEventListener('change', () => {
                if (cb.checked) selectedFolders.add(f); else selectedFolders.delete(f);
                updateActionButtons();
            });

            const nameSpan = document.createElement('span');
            nameSpan.textContent = f;
            nameSpan.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

            const renameBtn = document.createElement('button');
            renameBtn.textContent = '✏️';
            renameBtn.title = 'Переименовать';
            renameBtn.style.cssText = 'padding:2px 5px; border:1px solid #ddd; border-radius:4px; cursor:pointer; font-size:11px; background:#fff; flex-shrink:0;';
            renameBtn.addEventListener('click', async e => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = f;
                input.style.cssText = 'flex:1; min-width:0; padding:2px 4px; border:1px solid #2196F3; border-radius:4px; font-size:12px; outline:none;';
                row.replaceChild(input, nameSpan);
                renameBtn.textContent = '✓';
                input.focus();
                input.select();

                const doRename = async () => {
                    const newName = input.value.trim();
                    if (!newName || newName === f) { row.replaceChild(nameSpan, input); renameBtn.textContent = '✏️'; return; }
                    const tiles = await getSavedTiles();
                    const updated = tiles.map(t => ({
                        ...t,
                        folders: (t.folders || []).map(fn => fn === f ? newName : fn)
                    }));
                    await saveTiles(updated);
                    if (activeFolderFilter === f) activeFolderFilter = newName;
                    menu.remove();
                    renderSavedTiles();
                };
                renameBtn.addEventListener('click', doRename, { once: true });
                input.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') { row.replaceChild(nameSpan, input); renameBtn.textContent = '✏️'; } });
            });

            row.appendChild(cb);
            row.appendChild(nameSpan);
            row.appendChild(renameBtn);
            listWrap.appendChild(row);
            rows.push(row);
        });

        const empty = document.createElement('div');
        empty.textContent = 'Ничего не найдено';
        empty.style.cssText = 'display:none; font-size:12px; color:#999; padding:6px 4px;';
        listWrap.appendChild(empty);

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            let visible = 0;
            rows.forEach(row => {
                const show = !q || row.dataset.folderName.includes(q);
                row.style.display = show ? 'flex' : 'none';
                if (show) visible++;
            });
            empty.style.display = visible ? 'none' : 'block';
        });

        // Действия вынесены за пределы прокручиваемого списка, поэтому
        // «Удалить» и «Объединить» всегда остаются доступны.
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:6px; padding-top:6px; border-top:1px solid #eee;';
        menu.appendChild(actions);

        mergeSelBtn = document.createElement('button');
        mergeSelBtn.textContent = '🗂 Объединить выбранные...';
        mergeSelBtn.style.cssText = 'display:none; width:100%; padding:6px; border:1px solid #b3e5fc; border-radius:4px; cursor:pointer; background:#e1f5fe; color:#01579B; font-size:12px;';
        mergeSelBtn.addEventListener('click', async () => {
            if (selectedFolders.size < 2) { alert('Выберите хотя бы 2 папки для объединения'); return; }
            const folderList = [...selectedFolders].join(', ');
            const targetName = prompt(`Объединить папки:\n${folderList}\n\nНазвание итоговой папки:`, [...selectedFolders][0]);
            if (!targetName?.trim()) return;
            const target = targetName.trim();
            const deleteSource = confirm(`Удалить исходные папки после объединения?\n(Карточки перейдут в «${target}»)`);
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => {
                const oldFolders = t.folders || [];
                const inSelected = oldFolders.some(f => selectedFolders.has(f));
                if (!inSelected) return t;
                let newFolders = deleteSource
                    ? oldFolders.filter(f => !selectedFolders.has(f))
                    : [...oldFolders];
                if (!newFolders.includes(target)) newFolders.push(target);
                return { ...t, folders: newFolders };
            });
            await saveTiles(updated);
            if (selectedFolders.has(activeFolderFilter)) activeFolderFilter = target;
            menu.remove();
            renderSavedTiles();
        });
        actions.appendChild(mergeSelBtn);

        deleteSelBtn = document.createElement('button');
        deleteSelBtn.textContent = '🗑 Удалить выбранные папки';
        deleteSelBtn.style.cssText = 'display:none; width:100%; padding:6px; border:1px solid #ffcdd2; border-radius:4px; cursor:pointer; background:#fff8f8; color:#c62828; font-size:12px;';
        deleteSelBtn.addEventListener('click', async () => {
            if (!confirm(`Удалить папки: ${[...selectedFolders].join(', ')}?\nКарточки останутся, только уберутся из этих папок.`)) return;
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => ({
                ...t,
                folders: (t.folders || []).filter(f => !selectedFolders.has(f))
            }));
            await saveTiles(updated);
            if (selectedFolders.has(activeFolderFilter)) activeFolderFilter = null;
            menu.remove();
            renderSavedTiles();
        });
        actions.appendChild(deleteSelBtn);

        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = Math.max(8, document.documentElement.clientWidth - rect.right) + 'px';
        document.body.appendChild(menu);
        search.focus();

        const closeHandler = e => {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    uiRoot.appendChild(folderRow);
    cardsHost.appendChild(savedContainer);
    bottomUiRoot.appendChild(savedPanel);
    const savedSelectedKeys = new Set();

    function showFolderMenu(anchorBtn, tileKey, savedItem, allSaved) {
        uiRoot.querySelector('#ss-folder-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'ss-folder-menu';
        menu.style.cssText = `
            position:absolute; z-index:100001; background:#fff;
            border:1px solid #ddd; border-radius:8px; padding:8px;
            box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:200px;
            font-size:13px;
        `;

        // Определяем какие ключи затронуты: выделенные или только эта карточка
        const targetKeys = savedSelectedKeys.size > 0
            ? [...savedSelectedKeys]
            : [tileKey];
        const isMulti = targetKeys.length > 1;

        if (isMulti) {
            const hint = document.createElement('div');
            hint.textContent = `Выбрано: ${targetKeys.length} карточек`;
            hint.style.cssText = 'font-size:11px; color:#888; padding:2px 6px 6px; border-bottom:1px solid #eee; margin-bottom:4px;';
            menu.appendChild(hint);
        }

        const currentFolders = new Set(savedItem.folders || []);
        const allFolders = getAllFolders(allSaved);

        // кнопка «удалить из текущей папки» — только если активна папка
        if (activeFolderFilter) {
            const removeFromFolderBtn = document.createElement('button');
            removeFromFolderBtn.textContent = `📤 Убрать из «${activeFolderFilter}»`;
            removeFromFolderBtn.style.cssText = 'display:block;width:100%;margin-bottom:6px;padding:6px;border:1px solid #ffe0b2;border-radius:4px;cursor:pointer;text-align:left;background:#fff8f3;color:#e65100;';
            removeFromFolderBtn.addEventListener('click', async () => {
                menu.remove();
                const tiles = await getSavedTiles();
                const updated = tiles.map(t => {
                    if (!targetKeys.includes(t.key)) return t;
                    return { ...t, folders: (t.folders || []).filter(f => f !== activeFolderFilter) };
                });
                await saveTiles(updated);
                // если папка опустела — сбрасываем фильтр
                const remaining = updated.filter(t => (t.folders || []).includes(activeFolderFilter));
                if (remaining.length === 0) activeFolderFilter = null;
                renderSavedTiles();
            });
            menu.appendChild(removeFromFolderBtn);
        }

        // существующие папки с чекбоксами
        if (allFolders.length > 0) {
            const folderLabel = document.createElement('div');
            folderLabel.textContent = 'Папки:';
            folderLabel.style.cssText = 'font-size:11px; color:#888; padding:2px 6px 4px;';
            menu.appendChild(folderLabel);

            allFolders.forEach(f => {
                const row = document.createElement('label');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 6px; cursor:pointer; border-radius:4px;';
                row.addEventListener('mouseenter', () => row.style.background = '#f5f5f5');
                row.addEventListener('mouseleave', () => row.style.background = '');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                // для мульти — checked если ВСЕ выбранные в этой папке
                if (isMulti) {
                    const inFolder = targetKeys.filter(k => (allSaved.find(s => s.key === k)?.folders || []).includes(f));
                    cb.checked = inFolder.length === targetKeys.length;
                    cb.indeterminate = inFolder.length > 0 && inFolder.length < targetKeys.length;
                } else {
                    cb.checked = currentFolders.has(f);
                }
                cb.addEventListener('change', async () => {
                    const tiles = await getSavedTiles();
                    const updated = tiles.map(t => {
                        if (!targetKeys.includes(t.key)) return t;
                        const folders = new Set(t.folders || []);
                        if (cb.checked) folders.add(f); else folders.delete(f);
                        return { ...t, folders: [...folders] };
                    });
                    await saveTiles(updated);
                    renderSavedTiles();
                });
                row.appendChild(cb);
                row.appendChild(document.createTextNode(f));
                menu.appendChild(row);
            });
        }

        // новая папка
        const newRow = document.createElement('div');
        newRow.style.cssText = 'display:flex; gap:4px; margin-top:6px; padding-top:6px; border-top:1px solid #eee;';
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.placeholder = 'Новая папка...';
        newInput.style.cssText = 'flex:1; padding:4px 6px; border:1px solid #ddd; border-radius:4px; font-size:12px;';
        const addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.style.cssText = 'padding:4px 8px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer;';
        addBtn.addEventListener('click', async () => {
            const name = newInput.value.trim();
            if (!name) return;
            const tiles = await getSavedTiles();
            const updated = tiles.map(t => {
                if (!targetKeys.includes(t.key)) return t;
                const folders = new Set(t.folders || []);
                folders.add(name);
                return { ...t, folders: [...folders] };
            });
            await saveTiles(updated);
            menu.remove();
            renderSavedTiles();
        });
        newInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
        newRow.appendChild(newInput);
        newRow.appendChild(addBtn);
        menu.appendChild(newRow);

        // позиционируем около кнопки
        const rect = anchorBtn.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        menu.style.top = (rect.bottom - popupRect.top + popup.scrollTop + 4) + 'px';
        menu.style.left = (rect.left - popupRect.left) + 'px';

        popup.style.position = 'relative';
        uiRoot.appendChild(menu);
        newInput.focus();
        // закрываем только при клике ВНЕ меню
        const closeHandler = e => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }


    async function updateTileFolders(key, folders) {
        const tiles = await getSavedTiles();
        const updated = tiles.map(t => t.key === key ? { ...t, folders } : t);
        await saveTiles(updated);
    }

    async function renderSavedTiles() {
        // Отключаем предыдущий observer картинок если есть
        savedContainer._imgObserver?.disconnect();
        savedContainer._imgObserver = null;
        savedContainer.innerHTML = '';
        // высота ячейки = картинка + текстовая область (масштабируется вместе с размером карточек)
        const imgH = Math.round(cardScale * 0.9);
        // при группировке grid-auto-rows убирается в renderSavedClusters чтобы разделители не растягивались
        if (!groupingActive) savedContainer.style.gridAutoRows = `${imgH + getSavedTileBodyHeight(cardScale)}px`;
        const saved = await getSavedTiles();

        savedCounter.textContent = `Сохранено: ${saved.length} товаров`;
        savedPanel.style.display = 'flex';
        updateSavedSelectionCounter();
        updateStorageIndicator();
        renderFolderRow(saved);

        // фильтруем по активной папке
        const visibleSaved = activeFolderFilter === null
            ? saved
            : saved.filter(t => (t.folders || []).includes(activeFolderFilter));

        if (saved.length === 0) {
            savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">Нет сохранённых товаров</div>';
            return;
        }
        if (visibleSaved.length === 0) {
            savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">В этой папке нет товаров</div>';
            return;
        }

        // Парсим HTML обратно в DOM-элементы
        const savedTileMap = new Map();
        visibleSaved.forEach(item => {
            const tmp = document.createElement('div');
            tmp.innerHTML = item.html;
            const el = tmp.firstElementChild;
            if (el) savedTileMap.set(item.key, el);
        });

        // Применяем те же фильтры и сортировку через getFilteredAndSorted
        // но на основе savedTileMap вместо seenTiles
        const originalSeenTiles = seenTiles;
        // Временно подменяем seenTiles
        seenTiles.clear();
        savedTileMap.forEach((tile, key) => seenTiles.set(key, tile));

        let tiles = getFilteredAndSorted(searchInput.value);

        // Восстанавливаем seenTiles
        seenTiles.clear();
        originalSeenTiles.forEach((tile, key) => seenTiles.set(key, tile));

        updateTypeCounts([...savedTileMap.values()]);
        updatePricePlaceholders([...savedTileMap.values()]);
        updateDebugVisibility();
        const counterMode = getCounterSortMode(searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        renderCounterLabel(tiles.length, savedTileMap.size, counterMode, arrow);

        currentSavedTiles = tiles;

        const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

        async function renderSavedTilesList(orderedTiles, groupColorMap, groupLabel) {
            const tileH = groupingActive ? `${Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale)}px` : '100%';
            orderedTiles.forEach((tile, tileIndex) => {
                const groupColor = groupColorMap?.get(getTileKey(tile)) || null;
                const tileKey = getTileKey(tile);
                const savedItem = visibleSaved.find(s => s.key === tileKey) || saved.find(s => s.key === tileKey) || {};
                const wrap = document.createElement('div');
                wrap.style.cssText = `position:relative; display:flex; flex-direction:column; height:${tileH};`;
                wrap.dataset.savedKey = tileKey;
                const tileUrl = tile.dataset?.ssUrl || savedItem.url || '';
                wrap.dataset.tileUrl = tileUrl;


                const clone = tile.cloneNode(true);

                // ppg-badge — учитывает все настроенные дополнительные величины.
                const ppgInfo = getPpgBadgeInfo(tile);
                const ppg = getPricePerUnit(tile);
                if (ppgInfo) {
                    const badge = document.createElement('div');
                    badge.className = 'ppg-badge';
                    badge.innerHTML = ppgInfo.lines.map((line, i) => i === 0
                        ? line
                        : `<span style="font-weight:normal;font-size:10px;opacity:0.85">${line}</span>`).join('\n');
                    badge.style.whiteSpace = 'normal';
                    badge.title = ppgInfo.multi ? 'Рассчитано по нескольким дополнительным величинам' : '';
                    applyPpgBadgeSettings(badge);
                    wrap.appendChild(badge);
                }

                // ppg-debug
                {
                    const debugBadge = document.createElement('div');
                    debugBadge.className = 'ppg-debug';
                    const safePpg = (ppg && typeof ppg === 'object') ? ppg : { value: null, category: '???', base: '???' };
                    const currency = detectCurrency?.() ?? '';
                    const price = getPrice?.(tile) ?? '';
                    const base = safePpg.base ?? '???';
                    const value = typeof safePpg.value === 'number' ? safePpg.value.toFixed(2) : '';
                    const priceLabel = base ? `${currency}/${base}` : '';
                    const result = parseUnit?.(getTileTitle?.(tile));
                    let weightLabel = '';
                    if (result && typeof result.value === 'number') {
                        if (result.value >= 1000 && base === 'г') weightLabel = fmtUnit(result.value / 1000) + ' кг';
                        else if (result.value >= 1000 && base === 'мл') weightLabel = fmtUnit(result.value / 1000) + ' л';
                        else weightLabel = result.value + ' ' + base;
                    }
                    const syncedStr = savedItem.syncedAt
                        ? (() => { const d = new Date(savedItem.syncedAt); return `🔄 ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`; })()
                        : '';
                    const reviewsCount = getReviewsCount(tile);
                    const ratingVal = getRating(tile);
                    const deliveryDate = formatDateToString(getDeliveryDate(tile));
                    debugBadge.innerHTML =
                        `цена1: ${value} ${priceLabel}` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">вес: ${weightLabel ?? '???'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">цена2: ${price}&nbsp;</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">отзывы: ${reviewsCount ?? '—'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">рейтинг: ${ratingVal ?? '—'}</span>` +
                        `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">доставка: ${deliveryDate ?? '—'}</span>` +
                        (syncedStr ? `\n<span class="sync-line" style="font-size:9px;opacity:0.8">${syncedStr}</span>` : '');
                    debugBadge.style.whiteSpace = 'pre';
                    wrap.appendChild(debugBadge);
                }

                const checkbox = document.createElement('div');
                checkbox.className = 'saved-checkbox';
                checkbox.style.cssText = `
            position: absolute; bottom: 8px; right: 8px; z-index: 20;
            width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
            background: ${savedSelectedKeys.has(tileKey) ? '#ff5722' : 'rgba(255,255,255,0.9)'};
            border: 2px solid ${savedSelectedKeys.has(tileKey) ? '#ff5722' : '#ccc'};
            align-items: center; justify-content: center;
            font-size: 12px; color: white; font-weight: bold; transition: all 0.15s;
            display: ${savedSelectedKeys.has(tileKey) ? 'flex' : 'none'};
        `;
                checkbox.textContent = savedSelectedKeys.has(tileKey) ? '✓' : '';

                if (savedSelectedKeys.has(tileKey)) {
                    wrap.style.outline = '2px solid #ff5722';
                    wrap.style.borderRadius = '8px';
                }

                wrap.addEventListener('mouseenter', () => { checkbox.style.display = 'flex'; });
                wrap.addEventListener('mouseleave', () => {
                    if (!savedSelectedKeys.has(tileKey)) checkbox.style.display = 'none';
                });
                wrap.addEventListener('click', (e) => {
                    if (e.target.closest('a')) return; // не перехватываем клики по ссылкам
                    if (!e.ctrlKey && !e.shiftKey && e.target !== checkbox) return;
                    e.preventDefault();

                    if (e.shiftKey && lastSavedSelectedKey) {
                        // Диапазон по реальному DOM-порядку — работает и в режиме похожих
                        const allWraps = [...savedContainer.querySelectorAll('[data-saved-key]')];
                        const allKeys = allWraps.map(w => w.dataset.savedKey);
                        const fromIdx = allKeys.indexOf(lastSavedSelectedKey);
                        const toIdx = allKeys.indexOf(tileKey);
                        if (fromIdx !== -1 && toIdx !== -1) {
                            const lo = Math.min(fromIdx, toIdx);
                            const hi = Math.max(fromIdx, toIdx);
                            for (let i = lo; i <= hi; i++) {
                                if (allKeys[i]) savedSelectedKeys.add(allKeys[i]);
                            }
                        }
                    } else {
                        if (savedSelectedKeys.has(tileKey)) {
                            savedSelectedKeys.delete(tileKey);
                        } else {
                            savedSelectedKeys.add(tileKey);
                        }
                        lastSavedSelectedIndex = tileIndex;
                        lastSavedSelectedKey = tileKey;
                    }

                    // обновляем визуал всех затронутых карточек без ребилда DOM
                    savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
                        const k = w.dataset.savedKey;
                        const selected = savedSelectedKeys.has(k);
                        const cb = w.querySelector('.saved-checkbox');
                        if (cb) {
                            cb.style.display = selected ? 'flex' : 'none';
                            cb.style.background = selected ? '#ff5722' : 'rgba(255,255,255,0.9)';
                            cb.style.borderColor = selected ? '#ff5722' : '#ccc';
                            cb.textContent = selected ? '✓' : '';
                        }
                        w.style.outline = selected ? '2px solid #ff5722' : '';
                        w.style.borderRadius = selected ? '8px' : '';
                    });

                    // обновляем панель кнопок
                    updateSavedSelectionCounter();
                });

                const fullTitle = getTileTitle(tile);
                if (fullTitle) wrap.setAttribute('data-tooltip', fullTitle);

                // кликабельная ссылка на картинку с абсолютным URL
                const ssUrl = clone.dataset.ssUrl;
                const imgEl = clone.querySelector('img');
                if (ssUrl && imgEl) {
                    const a = document.createElement('a');
                    a.href = ssUrl;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.style.cssText = 'display:block; pointer-events: auto !important;';
                    imgEl.parentNode.insertBefore(a, imgEl);
                    a.appendChild(imgEl);
                }

                // ссылка на заголовке
                if (ssUrl) {
                    const titleEl = clone.querySelector('.ss-tile__title');
                    if (titleEl && !titleEl.querySelector('a')) {
                        const a = document.createElement('a');
                        a.href = ssUrl;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.style.cssText = 'color:inherit; text-decoration:none;';
                        a.textContent = titleEl.textContent;
                        titleEl.textContent = '';
                        titleEl.appendChild(a);
                    }
                }

                wrap.appendChild(clone);

                // значок 🔍 если карточка найдена в текущем поиске — добавляем внутрь ss-tile
                if (seenTiles.has(tileKey)) {
                    const searchBadge = document.createElement('div');
                    searchBadge.className = 'ss-search-indicator';
                    searchBadge.textContent = '🔍';
                    searchBadge.style.cssText = `
                    position:absolute; top:6px; right:6px; z-index:25;
                    background:#2196F3; color:white; border-radius:50%;
                    width:22px; height:22px; display:flex; align-items:center;
                    justify-content:center; font-size:12px;
                    box-shadow:0 1px 4px rgba(0,0,0,0.3); pointer-events:none;
                `;
                    clone.appendChild(searchBadge);
                } else {
                }
                const itemFolders = savedItem.folders || [];
                const folderBtn = document.createElement('button');
                folderBtn.textContent = itemFolders.length ? '📁' : '📂';
                folderBtn.title = itemFolders.length ? `Папки: ${itemFolders.join(', ')}` : 'Добавить в папку';
                folderBtn.style.cssText = `
                position:absolute; top:8px; left:8px; z-index:20;
                padding:2px 6px; font-size:13px; border-radius:6px; cursor:pointer;
                background:rgba(255,255,255,0.9); border:1px solid #ddd;
                display:none; transition:all 0.15s;
            `;
                folderBtn.addEventListener('click', async e => {
                    e.stopPropagation();
                    showFolderMenu(folderBtn, tileKey, savedItem, saved);
                });
                wrap.addEventListener('mouseenter', () => { folderBtn.style.display = 'block'; });
                wrap.addEventListener('mouseleave', () => { folderBtn.style.display = 'none'; });

                wrap.appendChild(checkbox);
                wrap.appendChild(folderBtn);
                if (groupColor) wrap.style.outline = `2px solid ${groupColor}`;
                // Разделитель группы на первой карточке (слева, абсолютный)
                if (groupingActive && tileIndex === 0 && groupLabel) {
                    const lbl = groupLabel;
                    const gc = groupColor || '#f5f5f5';
                    const isRef = lbl.startsWith('🖼');
                    const isSolo = lbl.startsWith('Разные') || lbl.startsWith('Не распознан');
                    // Зазор слева чтобы разделитель не наслаивался на предыдущую группу
                    wrap.style.marginLeft = '11px';
                    const badge = document.createElement('div');
                    badge.style.cssText = `
                    position:absolute; left:0; top:0; z-index:10;
                    height:100%; width:22px;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#e8e8e8' : gc};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#bbb' : 'rgba(0,0,0,.12)')};
                    border-radius:8px;
                    font-size:9px; font-weight:bold; padding:4px 3px;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:translateX(-100%) rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    pointer-events:none;
                `;
                    badge.textContent = lbl;
                    wrap.appendChild(badge);
                }
                savedContainer.appendChild(wrap);
            }); // end orderedTiles.forEach
        } // end renderSavedTilesList

        if (groupingActive) {
            // Фильтруем тайлы внутри групп через getFilteredAndSorted с sourceTiles —
            // без подмены seenTiles, безопасно для параллельных вкладок
            function filterCluster(clusterTiles) {
                return getFilteredAndSorted(searchInput.value, clusterTiles);
            }
            function savedTileMatchesSearch(tile) {
                return filterCluster([tile]).length > 0;
            }

            function makeSep(text, color, isSolo, isRef) {
                const sep = document.createElement('div');
                const isFlow = groupLayout === 'flow';
                if (isFlow) {
                    sep.style.cssText = `width:100%; display:flex; align-items:center; gap:8px; padding:3px 8px;
                        background:${isSolo ? '#f5f5f5' : color}; border-radius:5px; font-size:11px;
                        color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                        ${isRef ? 'border:1px solid #2980b9;' : ''}
                        ${isSolo ? 'margin-top:4px;' : ''}
                        flex-shrink:0; margin-bottom:2px; white-space:nowrap;`;
                } else {
                    sep.style.cssText = `grid-column:1/-1; align-self:start; height:auto;
                        display:flex; align-items:center; gap:8px; padding:4px 8px;
                        background:${isSolo ? '#f5f5f5' : color}; border-radius:6px;
                        font-size:12px; color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                        ${isRef ? 'border:1px solid #2980b9;' : ''}
                        ${isSolo ? 'border-top:2px solid #ddd; margin-top:4px;' : ''}`;
                }
                sep.textContent = text;
                return sep;
            }

            // создаёт разделитель-карточку для flow-режима (вписывается в грид как обычная карточка)
            function makeFlowDividerCard(text, color, isSolo, isRef) {
                const card = document.createElement('div');
                const tileH = Math.round(cardScale * 0.9) + getSavedTileBodyHeight(cardScale);
                card.style.cssText = `
                    height:${tileH}px; width:fit-content; min-width:28px;
                    justify-self:end;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#f5f5f5' : color};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#ddd' : color)};
                    border-radius:10px; font-size:10px; font-weight:bold;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    padding:8px 6px; line-height:1.4;
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
                card.textContent = text;
                return card;
            }

            function renderSavedClusters(clusters, preloadedImages) {
                const isFlow = groupLayout === 'flow';
                // Очищаем контейнер (убираем прогресс-блок и старые карточки)
                savedContainer._imgObserver?.disconnect();
                savedContainer._imgObserver = null;
                savedContainer.innerHTML = '';
                savedContainer.style.gridAutoRows = '';
                savedContainer.style.display = '';
                savedContainer.style.flexWrap = '';
                savedContainer.style.alignContent = '';

                const colorMap = new Map();
                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» ──
                if (referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles }) => {
                        const filtered = filterCluster(clusterTiles);
                        filtered.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(referenceFeatures, feat) >= THRESHOLD) {
                                refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `🖼 Похожие на указанное изображение · ${refMatches.length}`, refColor, false, true));
                    }
                    if (refMatches.length > 0) {
                        refMatches.forEach(t => colorMap.set(getTileKey(t), refColor));
                        renderSavedTilesList(refMatches, colorMap, `🖼 По картинке · ${refMatches.length}`);
                    }
                }

                // ── обычные группы ──
                clusters.forEach(({ tiles: clusterTiles, solo }) => {
                    if (solo) {
                        if (savedTileMatchesSearch(clusterTiles[0])) soloTiles.push(clusterTiles[0]);
                        return;
                    }
                    const color = palette[groupIdx % palette.length];
                    groupIdx++;
                    const visible = filterCluster(clusterTiles);
                    visible.forEach(t => colorMap.set(getTileKey(t), color));
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих`, color, false, false));
                    }
                    renderSavedTilesList(visible, colorMap, `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`);
                });

                // ── одиночные ──
                const totalSolo = clusters.filter(c => c.solo).length;
                if (totalSolo > 0) {
                    if (!isFlow) {
                        savedContainer.appendChild(makeSep(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '', true, false));
                    }
                    renderSavedTilesList(soloTiles, null, `Разные ${soloTiles.length}/${totalSolo}`);
                }
                // Загружаем картинки — передаём уже полученные из IndexedDB если есть
                loadSavedImages(preloadedImages);
            }

            // используем кэш если есть
            if (_savedGroupCache) {
                renderSavedClusters(_savedGroupCache, null);
            } else {
                // Батчевая загрузка картинок с прогрессом и кнопкой отмены
                let cancelled = false;
                const allKeys = tiles.map(t => getTileKey(t)).filter(Boolean);
                const total = allKeys.length;
                const IMG_BATCH = 50;

                // Прогресс-блок внутри savedContainer
                savedContainer.innerHTML = '';
                const progressWrap = document.createElement('div');
                progressWrap.style.cssText = 'grid-column:1/-1; padding:30px 20px; display:flex; flex-direction:column; align-items:center; gap:14px;';

                const progressLabel = document.createElement('div');
                progressLabel.style.cssText = 'font-size:13px; color:#555;';
                progressLabel.textContent = `🔍 Загружаю картинки для анализа: 0 / ${total}`;

                const progressTrack = document.createElement('div');
                progressTrack.style.cssText = 'width:280px; height:6px; background:#eee; border-radius:3px; overflow:hidden;';
                const progressFill = document.createElement('div');
                progressFill.style.cssText = 'height:100%; width:0%; background:#2196F3; border-radius:3px; transition:width 0.2s;';
                progressTrack.appendChild(progressFill);

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = '✕ Отмена';
                cancelBtn.style.cssText = 'padding:5px 16px; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; background:#f9f9f9; color:#555;';
                cancelBtn.onclick = () => {
                    cancelled = true;
                    // Выключаем режим похожих и возвращаемся к обычному виду
                    groupingActive = false;
                    groupBtn.style.background = '#fff';
                    groupBtn.style.color = '#555';
                    groupBtn.style.borderColor = '#ccc';
                    renderSavedTiles();
                };

                progressWrap.appendChild(progressLabel);
                progressWrap.appendChild(progressTrack);
                progressWrap.appendChild(cancelBtn);
                savedContainer.appendChild(progressWrap);

                // Батчевая загрузка
                const allImages = {};
                (async () => {
                    for (let i = 0; i < allKeys.length; i += IMG_BATCH) {
                        if (cancelled) return;
                        const batch = allKeys.slice(i, i + IMG_BATCH);
                        const images = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ action: 'getImages', keys: batch }, resp => {
                                resolve(resp?.result || {});
                            });
                        });
                        Object.assign(allImages, images);
                        const loaded = Math.min(i + IMG_BATCH, total);
                        progressFill.style.width = Math.round(loaded / total * 70) + '%';
                        progressLabel.textContent = `🔍 Загружаю картинки: ${loaded} / ${total}`;
                        await new Promise(r => setTimeout(r, 0)); // уступаем поток UI
                    }
                    if (cancelled) return;

                    progressLabel.textContent = '🔍 Анализирую похожие...';
                    progressFill.style.width = '80%';
                    await new Promise(r => setTimeout(r, 0));

                    const getImgSrc = tile => {
                        const key = getTileKey(tile);
                        return allImages[key]?.dataUrl || tile.querySelector('img[src]')?.src || '';
                    };

                    if (cancelled) return;
                    groupTilesByVisualSimilarity(tiles, getImgSrc).then(clusters => {
                        if (cancelled) return;
                        progressFill.style.width = '100%';
                        _savedGroupCache = clusters;
                        // Передаём уже загруженные картинки чтобы не грузить повторно
                        renderSavedClusters(clusters, allImages);
                    });
                })();
            }
        } else {
            renderSavedTilesList(tiles, null);
            loadSavedImages();
        }
    }

    // Загружает картинки для карточек в savedContainer.
    // preloaded — уже полученные из IndexedDB данные (чтобы не грузить дважды).
    function loadSavedImages(preloaded) {
        savedContainer._imgObserver?.disconnect();
        savedContainer._imgObserver = null;

        const IMG_BATCH = 30;
        const pendingImgKeys = new Map(); // key → { wrap, tileEl }

        savedContainer.querySelectorAll('.ss-tile').forEach(tileEl => {
            const key = tileEl.dataset.ssKey;
            if (!key) return;
            const wrap = tileEl.querySelector('.ss-tile__img-wrap');
            // Не добавляем если картинка уже загружена (есть тег img с src)
            if (wrap && !wrap.querySelector('img[src]')) {
                pendingImgKeys.set(key, { wrap, tileEl });
            }
        });

        if (!pendingImgKeys.size) return;

        // Применяем загруженные картинки.
        // Итерируем по images (не по pendingImgKeys) чтобы избежать
        // изменения Map во время итерации по ней.
        function applyImages(images) {
            for (const [key, imgData] of Object.entries(images)) {
                const entry = pendingImgKeys.get(key);
                if (!entry || !imgData?.dataUrl) continue;
                const { wrap, tileEl } = entry;
                wrap.classList.remove('ss-tile__img-loading');
                wrap.innerHTML = `<img src="${imgData.dataUrl}" alt="" loading="lazy">`;
                pendingImgKeys.delete(key);
                const debugBadge = tileEl.closest('[style*="position:relative"]')?.querySelector('.ppg-debug');
                if (debugBadge && imgData.syncedAt) {
                    const d = new Date(imgData.syncedAt);
                    const ts = `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
                    const syncLine = debugBadge.querySelector('.sync-line');
                    if (syncLine) syncLine.textContent = `🔄 ${ts}`;
                    else debugBadge.innerHTML += `\n<span class="sync-line" style="font-size:9px;opacity:0.8">🔄 ${ts}</span>`;
                }
            }
        }

        // Предзагруженные (из кластеризации) — применяем сразу
        if (preloaded && Object.keys(preloaded).length) {
            applyImages(preloaded);
            if (!pendingImgKeys.size) return;
        }

        // Загружаем батч ключей через background, с повтором при ошибке
        async function loadBatch(keys) {
            if (!keys.length) return;
            try {
                const images = await loadImagesFromBackground(keys);
                applyImages(images);
                // Если часть не вернулась — повторим через секунду (фоновый скрипт мог быть занят)
                const missed = keys.filter(k => pendingImgKeys.has(k));
                if (missed.length && missed.length < keys.length) {
                    // Вернулось хотя бы что-то, значит связь есть — повторяем оставшиеся
                    setTimeout(() => loadBatch(missed), 1000);
                }
            } catch (e) {
                console.warn('[loadSavedImages] batch error:', e);
            }
        }

        // Всегда используем IntersectionObserver — загружаем только видимые карточки.
        // Порог: если карточек мало (≤ IMG_BATCH) — всё равно через observer,
        // но с rootMargin 1000px чтобы загрузить сразу все.
        const isSmall = pendingImgKeys.size <= IMG_BATCH;
        let observerBatch = [];
        let batchTimer = null;

        const imgObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                // img-wrap наблюдается напрямую, key ищем у родительского .ss-tile
                const tileEl = entry.target.closest('.ss-tile');
                if (!tileEl) continue;
                const key = tileEl.dataset.ssKey;
                if (!key || !pendingImgKeys.has(key)) {
                    imgObserver.unobserve(entry.target);
                    continue;
                }
                observerBatch.push(key);
                imgObserver.unobserve(entry.target);
                if (observerBatch.length >= IMG_BATCH) {
                    loadBatch(observerBatch.splice(0, IMG_BATCH));
                } else {
                    clearTimeout(batchTimer);
                    batchTimer = setTimeout(() => {
                        if (observerBatch.length) loadBatch(observerBatch.splice(0));
                    }, 80);
                }
            }
        }, { rootMargin: isSmall ? '2000px' : '300px' });

        savedContainer.querySelectorAll('.ss-tile__img-wrap').forEach(w => {
            // Наблюдаем только если карточка ещё в pendingImgKeys
            const key = w.closest('.ss-tile')?.dataset?.ssKey;
            if (key && pendingImgKeys.has(key)) imgObserver.observe(w);
        });
        savedContainer._imgObserver = imgObserver;
    }

    // Удалить выбранные
    removeSelectedSavedBtn.addEventListener('click', async () => {
        if (!confirm(`Удалить ${savedSelectedKeys.size} выбранных товаров?`)) return;
        await removeFromSaved(savedSelectedKeys);
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        renderSavedTiles();
    });

    // Очистить всё
    clearSavedBtn.addEventListener('click', async () => {
        if (!confirm('Удалить все сохранённые товары?')) return;
        chrome.runtime.sendMessage({ action: 'clearImages' });
        await saveTiles([]);
        savedSelectedKeys.clear();
        lastSavedSelectedKey = null; lastSavedSelectedIndex = -1;
        renderSavedTiles();
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
    const tileTooltip = document.createElement('div');
    tileTooltip.style.cssText = 'display:none;position:fixed;z-index:100001;'
        + 'background:rgba(0,0,0,0.85);color:white;'
        + 'padding:6px 10px;border-radius:6px;'
        + 'font-size:12px;line-height:1.4;max-width:300px;'
        + 'pointer-events:none;white-space:normal;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);'
        + 'will-change:transform;'; // подсказка GPU что элемент будет двигаться
    // Используем transform вместо left/top — не вызывает layout reflow
    tileTooltip.style.top = '0';
    tileTooltip.style.left = '0';
    document.body.appendChild(tileTooltip);

    // Кешируем DOM-узлы тултипа чтобы не пересоздавать innerHTML
    const _ttTitle = document.createElement('div');
    _ttTitle.style.marginBottom = '4px';
    const _ttStatus = document.createElement('span');
    tileTooltip.appendChild(_ttTitle);
    tileTooltip.appendChild(_ttStatus);

    let tooltipTimer = null;
    let _ttCurrentEl = null; // элемент над которым сейчас тултип
    let _ttMouseX = 0, _ttMouseY = 0; // последние координаты мыши
    let _ttRafId = null; // requestAnimationFrame id для позиционирования

    function _ttPosition() {
        // transform не вызывает reflow — в отличие от left/top
        const x = _ttMouseX + 14;
        const y = _ttMouseY + 14;
        // не выходим за правый/нижний край экрана
        const maxX = window.innerWidth - tileTooltip.offsetWidth - 4;
        const maxY = window.innerHeight - tileTooltip.offsetHeight - 4;
        tileTooltip.style.transform = `translate(${Math.min(x, maxX)}px, ${Math.min(y, maxY)}px)`;
        _ttRafId = null;
    }

    function _ttShow(el, title, statusHtml) {
        _ttTitle.style.display = title ? '' : 'none';
        if (title) _ttTitle.textContent = title;
        _ttStatus.innerHTML = statusHtml;
        tileTooltip.style.display = 'block';
        // Позиционируем сразу (offsetWidth нужен после display:block)
        requestAnimationFrame(_ttPosition);
    }

    function _ttHide() {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
        _ttCurrentEl = null;
        tileTooltip.style.display = 'none';
    }

    // Единый mousemove-обработчик через rAF — не дёргаем DOM на каждый пиксель
    function _onMouseMove(e) {
        _ttMouseX = e.clientX;
        _ttMouseY = e.clientY;
        if (tileTooltip.style.display !== 'none' && !_ttRafId) {
            _ttRafId = requestAnimationFrame(_ttPosition);
        }
    }

    // Проверка "сохранён ли" только по key — O(1) через Set, без итерации
    function _isSaved(key) { return key ? savedKeysCache.has(key) : false; }
    function _isInSearch(key) { return key ? seenTiles.has(key) : false; }

    // productsContainer — делегирование через mouseover + mouseleave
    productsContainer.addEventListener('mouseover', (e) => {
        if (!hoverTooltipEnabled) return; // подсказка отключена — не тратим время на closest()/таймер
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return; // уже над этим элементом — ничего не делаем
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.tileKey;
            const status = _isSaved(key)
                ? '<span style="color:#81c784">🔖 Сохранён</span>'
                : '<span style="color:#ef9a9a">🔖 Не сохранён</span>';
            _ttShow(tooltipEl, title, status);
        }, 300); // увеличили задержку с 100 до 300мс — меньше лишних показов при быстром движении
    });

    productsContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    productsContainer.addEventListener('mousemove', _onMouseMove);

    // savedContainer — аналогично
    savedContainer.addEventListener('mouseover', (e) => {
        if (!hoverTooltipEnabled) return;
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return;
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.savedKey;
            const status = _isInSearch(key)
                ? '<span style="color:#81c784">🔍 Есть в поиске</span>'
                : '<span style="color:#ef9a9a">🔍 Нет в поиске</span>';
            _ttShow(tooltipEl, title, status);
        }, 300);
    });

    savedContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    savedContainer.addEventListener('mousemove', _onMouseMove);

    // ─── Фильтрация и сортировка ───────────────────────────────────────────────

    // @сортировка(поле, направление) — специальная часть DSL, не участвующая в фильтрации.
    // Поддерживаются: возр/убыв, asc/desc, а-я/я-а и старые ↑/↓ как алиасы.
    // Правила сортировки: src/content/products/sorting.js

    function getCounterSortMode(searchQuery) {
        const rules = parseSortRulesFromQuery(searchQuery);
        const first = rules[0];
        if (!first) return currentMode;
        const n = normalizeSortFieldName(first.field);
        const dir = first.direction || 'asc';
        if (['цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit'].includes(n)) {
            return dir === 'desc' ? 'per-gram-desc' : 'per-gram-asc';
        }
        return currentMode;
    }

    // Правила сортировки: src/content/products/sorting.js

    function getFilteredAndSorted(searchQuery, sourceTiles = null) {
        let tiles = sourceTiles ? [...sourceTiles] : [...seenTiles.values()];

        const sortRules = parseSortRulesFromQuery(searchQuery);
        const filterQuery = stripSortRulesFromQuery(searchQuery);
        if (filterQuery) {
            const tokens = parseSearchQuery(filterQuery);
            tiles = tiles.filter(tile => matchesTileSearchTokens(tile, tokens));
        }

        tiles = tiles.filter(tile => {
            if (getPrice(tile) === 99999999) return typeFilter.noPrice ?? true;
            const results = getAllUnitResults(tile);
            if (!results.length) return typeFilter.none;
            const categories = new Set(results.map(r=>r.category).filter(Boolean));
            // Карточка с несколькими величинами принадлежит сразу нескольким
            // категориям: «85 г × 30 шт» одновременно видна в «По весу» и «Штучные».
            return [...categories].some(category => typeFilter[category] ?? true);
        });

        tiles.sort((a, b) => {
            if (sortRules.length) return compareByDslSortRules(a, b, sortRules);
            const isPerUnit = currentMode.includes('per-gram');
            const isReviews = currentMode.startsWith('reviews');
            const isRating = currentMode.startsWith('rating');
            const isDelivery = currentMode.startsWith('delivery');
            const desc = currentMode.includes('desc');

            if (isPerUnit) {
                // Сортировка использует ровно тот же канонический расчёт,
                // что и фильтр/бейдж: ₽/кг, ₽/л, ₽/шт или ₽/м.
                const ppgA = getPricePerUnit(a);
                const ppgB = getPricePerUnit(b);
                const hasA = !!ppgA;
                const hasB = !!ppgB;

                // Товары без величины — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;

                // Оба без величины — сортируем по цене с учётом направления
                if (!hasA && !hasB) {
                    const diff = getPrice(a) - getPrice(b);
                    return desc ? -diff : diff;
                }

                const diff = ppgA.value - ppgB.value;
                if (diff !== 0) return desc ? -diff : diff;
            }

            if (isReviews || isRating || isDelivery) {
                const getVal = isReviews ? getReviewsCount : isRating ? getRating : getDeliveryDate;
                const valA = getVal(a);
                const valB = getVal(b);
                const hasA = valA !== null;
                const hasB = valB !== null;

                // Товары без данных (нет селектора/не распарсилось) — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;
                if (!hasA && !hasB) return 0;

                const diff = valA - valB;
                return desc ? -diff : diff;
            }

            const valA = getSortValue(a, currentMode);
            const valB = getSortValue(b, currentMode);
            return desc ? valB - valA : valA - valB;
        });

        // Фильтр по полной цене
        const minVal = parseFloat(priceMin.value);
        const maxVal = parseFloat(priceMax.value);
        if (!isNaN(minVal) || !isNaN(maxVal)) {
            tiles = tiles.filter(tile => {
                const val = getPrice(tile);
                if (val >= 99999999) return true; // без цены — пропускаем
                if (!isNaN(minVal) && val < minVal) return false;
                if (!isNaN(maxVal) && val > maxVal) return false;
                return true;
            });
        }

        // Фильтр по цене/единице (независимый)
        const minUnit = parseFloat(priceUnitMin.value);
        const maxUnit = parseFloat(priceUnitMax.value);
        if (!isNaN(minUnit) || !isNaN(maxUnit)) {
            tiles = tiles.filter(tile => {
                const ppg = getPricePerUnit(tile);
                if (!ppg) return true; // без величины — пропускаем
                const val = ppg.value;
                if (!isNaN(minUnit) && val < minUnit) return false;
                if (!isNaN(maxUnit) && val > maxUnit) return false;
                return true;
            });
        }

        // Фильтр по рейтингу (независимый)
        const minRating = parseFloat(ratingMin.value);
        const maxRating = parseFloat(ratingMax.value);
        if (!isNaN(minRating) || !isNaN(maxRating)) {
            tiles = tiles.filter(tile => {
                const val = getRating(tile);
                if (val === null) return true; // без рейтинга — пропускаем
                if (!isNaN(minRating) && val < minRating) return false;
                if (!isNaN(maxRating) && val > maxRating) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minReviews = parseFloat(reviewsMin.value);
        const maxReviews = parseFloat(reviewsMax.value);
        if (!isNaN(minReviews) || !isNaN(maxReviews)) {
            tiles = tiles.filter(tile => {
                const val = getReviewsCount(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minReviews) && val < minReviews) return false;
                if (!isNaN(maxReviews) && val > maxReviews) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minDelivery = deliveryMin.value ? parseStrictDate(deliveryMin.value, 'start') : NaN;
        const maxDelivery = deliveryMax.value ? parseStrictDate(deliveryMax.value, 'end') : NaN;
        if (!isNaN(minDelivery) || !isNaN(maxDelivery)) {
            tiles = tiles.filter(tile => {
                const val = getDeliveryDate(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minDelivery) && val < minDelivery) return false;
                if (!isNaN(maxDelivery) && val > maxDelivery) return false;
                return true;
            });
        }

        return tiles;
    }

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
    const _renderCloneCache = new Map();
    const RENDER_CLONE_CACHE_LIMIT = 120;
    function getCachedSiteClone(tile) {
        let clone = _renderCloneCache.get(tile);
        if (clone) {
            _renderCloneCache.delete(tile);
            _renderCloneCache.set(tile, clone);
            return clone;
        }
        clone = tile.cloneNode(true);
        _renderCloneCache.set(tile, clone);
        while (_renderCloneCache.size > RENDER_CLONE_CACHE_LIMIT) {
            const first = _renderCloneCache.keys().next().value;
            _renderCloneCache.delete(first);
        }
        return clone;
    }

    function renderTiles(tiles) {
        refreshExtraControls([...seenTiles.values()]);
        currentTiles = tiles;
        if (virtualRenderCleanup) { try { virtualRenderCleanup(); } catch (_) {} virtualRenderCleanup = null; }
        productsContainer.style.display = '';
        productsContainer.style.position = '';
        productsContainer.style.overflowY = '';
        productsContainer.style.overflowX = '';
        productsContainer.innerHTML = '';

        if (noSearchTiles) {
            productsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">На странице товары не найдены</div>';
            return;
        }

        if (groupingActive) {
            const searchText = searchInput.value.trim().toLowerCase();
            const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

            // фильтр по тексту с поддержкой parseSearchQuery (!, пробел, кавычки)
            const searchTokens = searchInput.value.trim() ? parseSearchQuery(searchInput.value) : null;
            function tileMatchesSearch(tile) {
                if (!searchTokens) return true;
                return matchesTileSearchTokens(tile, searchTokens);
            }

            function makeSepSearch(text, color, isSolo, isRef) {
                const sep = document.createElement('div');
                sep.style.cssText = `grid-column:1/-1; display:flex; align-items:center; gap:8px; padding:4px 8px;
                       background:${isSolo ? '#f5f5f5' : color}; border-radius:6px; font-size:12px;
                       color:${isSolo ? '#888' : (isRef ? '#1a5276' : '#555')}; font-weight:bold;
                       ${isRef ? 'border:1px solid #2980b9;' : ''}
                       ${isSolo ? 'border-top:2px solid #ddd; margin-top:4px;' : ''}`;
                sep.textContent = text;
                return sep;
            }

            // карточка-разделитель для flow-режима в search-табе
            function makeFlowDividerSearch(text, color, isSolo, isRef) {
                const card = document.createElement('div');
                card.style.cssText = `
                    width:fit-content; min-width:28px;
                    justify-self:end; align-self:stretch;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#f5f5f5' : color};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#ddd' : color)};
                    border-radius:10px; font-size:10px; font-weight:bold;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    padding:8px 6px; line-height:1.4;
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
                card.textContent = text;
                return card;
            }

            function renderClusters(clusters) {
                productsContainer.innerHTML = '';
                const isFlow = groupLayout === 'flow';
                productsContainer.style.display = '';
                productsContainer.style.flexWrap = '';
                productsContainer.style.alignContent = '';

                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» (если задано эталонное изображение) ──
                if (referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles, solo }) => {
                        clusterTiles.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(referenceFeatures, feat) >= THRESHOLD) {
                                if (tileMatchesSearch(tile)) refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (isFlow) {
                        productsContainer.appendChild(makeFlowDividerSearch(
                            `🖼 По картинке · ${refMatches.length}`, refColor, false, true));
                    } else {
                        productsContainer.appendChild(makeSepSearch(
                            `🖼 Похожие на указанное изображение · ${refMatches.length}`, refColor, false, true));
                    }
                    if (refMatches.length > 0) {
                        const sorted = getFilteredAndSorted('', refMatches);
                        const refLabel = `🖼 По картинке · ${refMatches.length}`;
                        sorted.forEach((tile, idx) => renderOneTile(tile, refColor, true, idx === 0 && isFlow ? refLabel : null));
                    }
                    if (!isFlow) {
                        const divider = document.createElement('div');
                        divider.style.cssText = 'grid-column:1/-1; height:1px; background:#ddd; margin:4px 0;';
                        productsContainer.appendChild(divider);
                    }
                }

                // ── обычные группы ──
                clusters.forEach(({ tiles: clusterTiles, solo }) => {
                    if (solo) {
                        if (tileMatchesSearch(clusterTiles[0])) soloTiles.push(clusterTiles[0]);
                        return;
                    }
                    const color = palette[groupIdx % palette.length];
                    groupIdx++;
                    const sorted = getFilteredAndSorted('', clusterTiles);
                    const visible = sorted.filter(tileMatchesSearch);
                    if (!isFlow) {
                        productsContainer.appendChild(makeSepSearch(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих товаров`, color, false, false));
                    }
                    const clusterLabel = `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`;
                    visible.forEach((tile, idx) => renderOneTile(tile, color, true, idx === 0 && isFlow ? clusterLabel : null));
                });

                // ── одиночные ──
                if (soloTiles.length > 0 || clusters.some(c => c.solo)) {
                    const totalSolo = clusters.filter(c => c.solo).length;
                    if (!isFlow) {
                        productsContainer.appendChild(makeSepSearch(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '#f5f5f5', true, false));
                    }
                    const soloLabel = `Разные ${soloTiles.length}/${totalSolo}`;
                    const sortedSolo = getFilteredAndSorted('', soloTiles);
                    sortedSolo.forEach((tile, idx) => renderOneTile(tile, null, false, idx === 0 && isFlow ? soloLabel : null));
                }
                refreshSavedKeysCache();
                // Обновляем счётчик — считаем реально отрисованные карточки
                const visibleCount = productsContainer.querySelectorAll('[data-tile-key]').length;
                const counterMode = getCounterSortMode(searchInput.value);
                const arrow2 = counterMode.includes('desc') ? '↓' : '↑';
                renderCounterLabel(visibleCount, seenTiles.size, counterMode, arrow2);
            }

            // используем кэш если есть — группы стабильны
            if (_searchGroupCache) {
                renderClusters(_searchGroupCache);
                return;
            }

            productsContainer.innerHTML = '';
            const searchGroupProgress = document.createElement('div');
            searchGroupProgress.style.cssText = 'padding:20px; text-align:center; color:#999; font-size:13px; display:flex; flex-direction:column; align-items:center; gap:10px;';
            searchGroupProgress.innerHTML = '<div>🔍 Анализирую изображения...</div>';
            const searchCancelBtn = document.createElement('button');
            searchCancelBtn.textContent = '✕ Отмена';
            searchCancelBtn.style.cssText = 'padding:4px 14px; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; background:#f9f9f9; color:#555;';
            let searchGroupCancelled = false;
            searchCancelBtn.onclick = () => {
                searchGroupCancelled = true;
                groupingActive = false;
                groupBtn.style.background = '#fff';
                groupBtn.style.color = '#555';
                groupBtn.style.borderColor = '#ccc';
                applyFilters();
            };
            searchGroupProgress.appendChild(searchCancelBtn);
            productsContainer.appendChild(searchGroupProgress);
            // снапшот seenTiles на момент начала анализа — не захватываем saved-тайлы
            const allTiles = [...seenTiles.values()].filter(t => !t.dataset?.savedKey);
            const getImgSrc = tile => tile.querySelector('img[src]')?.src || '';
            groupTilesByVisualSimilarity(allTiles, getImgSrc).then(clusters => {
                if (searchGroupCancelled) return;
                _searchGroupCache = clusters;
                renderClusters(clusters);
            });
            return;
        }

        // Для больших выдач включаем настоящую виртуализацию: в DOM находятся
        // только карточки около viewport, а не все отфильтрованные товары.
        if (virtualizationThreshold > 0 && tiles.length >= virtualizationThreshold) {
            renderVirtualizedTiles(tiles);
            return;
        }

        tiles.forEach(tile => renderOneTile(tile, null, false));

        function renderOneTile(tile, groupColor, inGroup, groupLabel, append = true, reuseWrap = null) {
            const wrap = reuseWrap || document.createElement('div');
            if (reuseWrap) {
                wrap.innerHTML = '';
                wrap.removeAttribute('style');
                wrap.removeAttribute('data-tooltip');
                wrap.removeAttribute('data-tile-key');
                wrap.removeAttribute('data-tile-url');
                wrap.removeAttribute('data-virtual-index');
            }
            // ВАЖНО: раньше здесь стояло height:100% — из-за известной особенности CSS Grid
            // процентная высота на элементе грида резолвится относительно итоговой высоты
            // строки (даже при align-items:start это правило не спасает), поэтому все карточки
            // в одной строке растягивались под самую высокую соседнюю. Явный align-self:start
            // без height даёт карточке расти только под своё содержимое.
            wrap.className = 'ss-search-tile-wrap';
            wrap.style.cssText = 'position:relative; display:flex; flex-direction:column; align-self:start; min-width:0; width:100%; max-width:100%; box-sizing:border-box;' +
                (tiles.length > 500
                    ? ' content-visibility:auto; contain-intrinsic-size:280px; contain:layout paint style;'
                    : '');

            const ppgInfo = getPpgBadgeInfo(tile);
            const ppg = getPricePerUnit(tile);
            if (ppgInfo) {
                const badge = document.createElement('div');
                badge.className = 'ppg-badge';
                badge.innerHTML = ppgInfo.lines.map((line, i) => i === 0
                    ? line
                    : `<span style="font-weight:normal;font-size:10px;opacity:0.85">${line}</span>`).join('\n');
                badge.style.whiteSpace = 'normal';
                badge.title = ppgInfo.multi ? 'Рассчитано по нескольким дополнительным величинам' : '';
                applyPpgBadgeSettings(badge);
                wrap.appendChild(badge);
            }

            if (debugMode) {
                const debugBadge = document.createElement('div');
                debugBadge.className = 'ppg-debug';

                const safePpg = (ppg && typeof ppg === 'object')
                    ? ppg
                    : { value: null, category: '???', base: '???' };
                const currency = detectCurrency?.() ?? '';
                const price = getPrice?.(tile) ?? '';
                const base = safePpg.base ?? '???';
                const value = typeof safePpg.value === 'number' ? safePpg.value.toFixed(2) : '';
                const priceLabel = base ? `${currency}/${base}` : '';
                const result = parseUnit?.(getTileTitle?.(tile));
                let weightLabel = '';
                if (result && typeof result.value === 'number') {
                    if (result.value >= 1000 && base === 'г') weightLabel = fmtUnit(result.value / 1000) + ' кг';
                    else if (result.value >= 1000 && base === 'мл') weightLabel = fmtUnit(result.value / 1000) + ' л';
                    else weightLabel = result.value + ' ' + base;
                }
                debugBadge.innerHTML =
                    `цена1: ${value} ${priceLabel}` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">вес: ${weightLabel ?? '???'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">цена2: ${price}&nbsp;</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">отзывы: ${getReviewsCount(tile) ?? '—'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">рейтинг: ${getRating(tile) ?? '—'}</span>` +
                    `\n<span style="font-weight:normal;font-size:10px;opacity:0.85">доставка: ${formatDateToString(getDeliveryDate(tile)) ?? '—'}</span>`;
                debugBadge.style.whiteSpace = 'pre';
                wrap.appendChild(debugBadge);
            }

            const clone = searchCardStyle === 'custom'
                ? createCustomSearchTile(tile, cardScale)
                : getCachedSiteClone(tile);

            if (searchCardStyle === 'site' && clone instanceof Element) {
                clone.classList.add('ss-site-card-clone');
                const gridSafeStyles = {
                    display: 'block', position: 'relative', width: '100%',
                    minWidth: '0', maxWidth: 'none', height: 'auto', minHeight: '0',
                    margin: '0', float: 'none', clear: 'none', gridColumn: 'auto',
                    gridRow: 'auto', gridArea: 'auto', justifySelf: 'stretch',
                    alignSelf: 'stretch', boxSizing: 'border-box'
                };
                for (const [prop, value] of Object.entries(gridSafeStyles)) {
                    clone.style.setProperty(prop, value, 'important');
                }
            }
            const tileKey = getTileKey(tile);
            const tileIndex = tiles.indexOf(tile);
            const tileUrl = tile.dataset?.ssUrl || clone.dataset?.ssUrl || '';
            wrap.dataset.tileKey = tileKey;
            wrap.dataset.tileUrl = tileUrl;

            // Чекбокс выделения
            const checkbox = document.createElement('div');
            checkbox.style.cssText = `
    position: absolute; bottom: 8px; right: 8px; z-index: 20;
    width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
    background: ${selectedKeys.has(tileKey) ? '#2196F3' : 'rgba(255,255,255,0.9)'};
    border: 2px solid ${selectedKeys.has(tileKey) ? '#2196F3' : '#ccc'};
    display: ${selectedKeys.has(tileKey) ? 'flex' : 'none'};
    align-items: center; justify-content: center;
    font-size: 12px; color: white; font-weight: bold;
    transition: all 0.15s;
`;
            checkbox.textContent = selectedKeys.has(tileKey) ? '✓' : '';

            // Подсветка выделенной карточки
            if (selectedKeys.has(tileKey)) {
                wrap.style.outline = '2px solid #2196F3';
                wrap.style.borderRadius = '8px';
            }

            // События карточек обрабатываются делегированно на productsContainer.
            // Это существенно уменьшает количество listener'ов при виртуализации.
            checkbox.dataset.selectionCheckbox = '1';
            wrap.appendChild(checkbox);

            const fullTitle = getTileTitle(tile);
            if (fullTitle) {
                wrap.setAttribute('data-tooltip', fullTitle);
            }

            // В режиме сайта используем исходную карточку; в своём стиле
            // ссылки уже создаются внутри createCustomSearchTile().
            if (searchCardStyle === 'site') {
                // Добавляем кликабельную ссылку на картинку
                const linkEl = safeQuerySelector(clone, SELECTORS?.link);
                const imgEl = clone.querySelector('img');
                if (linkEl && imgEl && imgEl.parentElement?.tagName !== 'A') {
                    const href = linkEl.getAttribute('href');
                    if (href) {
                        const a = document.createElement('a');
                        a.href = href;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.style.cssText = 'display:block; pointer-events:auto !important;';
                        imgEl.parentNode.insertBefore(a, imgEl);
                        a.appendChild(imgEl);
                    }
                }
            }

            // Показ дополнительных атрибутов/величин прямо на карточке поиска.
            const extras=getExtraTileAttributes(tile);
            if(Object.keys(extras).length){
                const exBox=document.createElement('div'); exBox.className='ss-extra-data'; exBox.style.cssText='display:flex;flex-wrap:wrap;gap:3px;margin:5px 0 0;';
                Object.entries(extras).forEach(([name,val])=>{ const b=document.createElement('span'); b.textContent=`${name}: ${val}`; b.title='Дополнительный атрибут'; b.style.cssText='font-size:9px;line-height:1.2;padding:3px 5px;border-radius:8px;background:#eef3f7;color:#546e7a;'; exBox.appendChild(b); });
                wrap.appendChild(exBox);
            }
            wrap.appendChild(clone);
            if (groupColor && inGroup) wrap.style.outline = `2px solid ${groupColor}`;
            // Разделитель группы на первой карточке (search tab, flow)
            if (groupLabel && groupingActive && groupLayout === 'flow') {
                const isRef = groupLabel.startsWith('🖼');
                const isSolo = groupLabel.startsWith('Разные') || groupLabel.startsWith('Не распознан');
                const gc = groupColor || '#e8e8e8';
                wrap.style.marginLeft = '11px';
                const badge = document.createElement('div');
                badge.style.cssText = `
                    position:absolute; left:0; top:0; z-index:10;
                    height:100%; width:22px;
                    display:flex; align-items:center; justify-content:center;
                    background:${isSolo ? '#e8e8e8' : gc};
                    border:2px solid ${isRef ? '#2980b9' : (isSolo ? '#bbb' : 'rgba(0,0,0,.12)')};
                    border-radius:8px;
                    font-size:9px; font-weight:bold; padding:4px 3px;
                    color:${isSolo ? '#999' : (isRef ? '#1a5276' : '#555')};
                    cursor:default; user-select:none;
                    writing-mode:vertical-rl; transform:translateX(-100%) rotate(180deg);
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    pointer-events:none;
                `;
                badge.textContent = groupLabel;
                wrap.appendChild(badge);
            }
            if (append) productsContainer.appendChild(wrap);
            return wrap;
        } // end renderOneTile

        function renderVirtualizedTiles(virtualTiles) {
            const gap = 15;
            const minCardWidth = Math.max(120, Number(cardScale) || 180);
            const overscanRows = 2;
            let rowHeight = searchCardStyle === 'custom'
                ? Math.max(300, Math.round((Number(cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(cardScale) || 180) + gap)
                : 300;
            let raf = 0;
            let resizeObserver = null;
            let lastRange = '';
            let savedScrollTop = productsContainer.scrollTop;
            let resizeHandler = null;
            let scrollHandler = null;
            // Переиспользуем wrapper'ы при прокрутке вместо постоянного create/remove.
            const wrapperPool = [];

            productsContainer.innerHTML = '';
            productsContainer.style.display = 'block';
            productsContainer.style.position = 'relative';
            productsContainer.style.overflowY = 'auto';
            productsContainer.style.overflowX = 'hidden';

            const stage = document.createElement('div');
            stage.className = 'ss-virtual-stage';
            stage.style.cssText = 'position:relative;width:100%;min-height:1px;';
            productsContainer.appendChild(stage);

            function getMetrics() {
                const cs = getComputedStyle(productsContainer);
                const pl = parseFloat(cs.paddingLeft) || 0;
                const pr = parseFloat(cs.paddingRight) || 0;
                const contentWidth = Math.max(1, productsContainer.clientWidth - pl - pr);
                const columns = Math.max(1, Math.floor((contentWidth + gap) / (minCardWidth + gap)));
                const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
                return { columns, cellWidth };
            }

            function updateStageHeight(columns) {
                const rows = Math.ceil(virtualTiles.length / columns);
                stage.style.height = Math.max(0, rows * rowHeight - gap) + 'px';
                return rows;
            }

            function renderWindow(force = false) {
                raf = 0;
                const { columns, cellWidth } = getMetrics();
                const rows = Math.ceil(virtualTiles.length / columns);
                stage.style.height = Math.max(0, rows * rowHeight - gap) + 'px';
                if (!rows) { stage.replaceChildren(); return; }

                const viewportHeight = productsContainer.clientHeight || 600;
                const scrollTop = productsContainer.scrollTop;
                const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
                const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
                const rangeKey = `${columns}:${firstRow}:${lastRow}`;
                if (!force && rangeKey === lastRange) return;
                lastRange = rangeKey;

                const count = Math.max(0, (lastRow - firstRow + 1) * columns);
                const fragment = document.createDocumentFragment();
                for (let slot = 0; slot < count; slot++) {
                    const linear = firstRow * columns + slot;
                    if (linear >= virtualTiles.length) break;
                    const row = Math.floor(linear / columns);
                    const col = linear % columns;
                    const tile = virtualTiles[linear];
                    const wrap = renderOneTile(tile, null, false, null, false, wrapperPool[slot] || null);
                    wrapperPool[slot] = wrap;
                    wrap.dataset.virtualIndex = String(linear);
                    wrap.style.position = 'absolute';
                    wrap.style.left = `${col * (cellWidth + gap)}px`;
                    wrap.style.top = `${row * rowHeight}px`;
                    wrap.style.width = `${cellWidth}px`;
                    wrap.style.margin = '0';
                    fragment.appendChild(wrap);
                }
                stage.replaceChildren(fragment);

                if (resizeObserver) resizeObserver.disconnect();
                for (let slot = 0; slot < count; slot++) {
                    const wrap = wrapperPool[slot];
                    if (wrap) resizeObserver.observe(wrap);
                }
            }

            resizeObserver = new ResizeObserver(entries => {
                let changed = false;
                let maxObserved = 0;
                for (const entry of entries) {
                    const h = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
                    if (Number.isFinite(h)) maxObserved = Math.max(maxObserved, h);
                }
                if (maxObserved > 0) {
                    const baseHeight = searchCardStyle === 'custom'
                        ? Math.round((Number(cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(cardScale) || 180)
                        : 300 - gap;
                    const nextRowHeight = Math.max(baseHeight + gap, Math.ceil(maxObserved + gap));
                    if (Math.abs(nextRowHeight - rowHeight) > 2) {
                        rowHeight = nextRowHeight;
                        changed = true;
                    }
                }
                if (changed) {
                    const { columns } = getMetrics();
                    updateStageHeight(columns);
                    lastRange = '';
                    scheduleRender();
                }
            });

            function scheduleRender() {
                if (raf) return;
                raf = requestAnimationFrame(() => renderWindow(false));
            }

            scrollHandler = scheduleRender;
            resizeHandler = () => { lastRange = ''; scheduleRender(); };
            productsContainer.addEventListener('scroll', scrollHandler, { passive: true });
            window.addEventListener('resize', resizeHandler, { passive: true });
            virtualRenderCleanup = () => {
                if (raf) cancelAnimationFrame(raf);
                productsContainer.removeEventListener('scroll', scrollHandler);
                window.removeEventListener('resize', resizeHandler);
                if (resizeObserver) resizeObserver.disconnect();
                wrapperPool.length = 0;
            };

            const { columns } = getMetrics();
            updateStageHeight(columns);
            renderWindow(true);
            productsContainer.scrollTop = Math.min(savedScrollTop, Math.max(0, stage.scrollHeight - productsContainer.clientHeight));
            renderWindow(true);

            refreshSavedKeysCache();
            const counterMode = getCounterSortMode(searchInput.value);
            const arrow = counterMode.includes('desc') ? '↓' : '↑';
            renderCounterLabel(virtualTiles.length, seenTiles.size, counterMode, arrow);
        }

        refreshSavedKeysCache(); // расставляем значки 🔖 сразу после рендера
        const counterMode = getCounterSortMode(searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        renderCounterLabel(tiles.length, seenTiles.size, counterMode, arrow);

        if (seenTiles.size > 500) {
            const task = () => {
                if (!productsContainer.isConnected) return;
                updateTypeCounts();
                updatePricePlaceholders([...seenTiles.values()]);
                updateDebugVisibility();
            };
            if ('requestIdleCallback' in window) requestIdleCallback(task, {timeout: 700});
            else setTimeout(task, 0);
        } else {
            updateTypeCounts();
            updatePricePlaceholders([...seenTiles.values()]);
            updateDebugVisibility();
        }
    }


    // Делегирование hover/click для карточек. Не создаём по 3 listener'а на каждую карточку.
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
    window._ssRefreshSearch = () => { collectTiles(); applyFilters(); };
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
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        if (!isMinimized) window.scrollTo(0, scrollY);
        overlay.remove();
        miniBar.remove();
        style.remove();
        tileTooltip.remove();
        closeDeliveryCalendar();
        savedQueries.destroy();
        if (pickerActive) stopCardPicker();
        document.removeEventListener('keydown', escHandler);
        updateLiveCounterBadge(); // возвращаем плашку счётчика, если она включена
        if (window._ssClosePopup === closePopup) window._ssClosePopup = null;
    }

    window._ssClosePopup = closePopup;
    closeBtn.onclick = closePopup;

    function escHandler(e) {
        if (e.key !== 'Escape') return;
        if (pickerActive) return; // picker сам обработает Esc
        if (isMinimized) restorePopup();
        else closePopup();
    }
    document.addEventListener('keydown', escHandler);

    return seenTiles.size;
}
