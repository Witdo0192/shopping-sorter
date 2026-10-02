// Диагностика, обновление данных и настройки бейджей.
// dependencies связывает эту часть с состоянием и действиями панели.
function createPanelTools(dependencies) {
    const lifecycle = createUiLifecycle();
    let debugMode = false;
    chrome.storage.local.get(['debugMode'], d => {
        debugMode = !!d.debugMode;
        updateDebugVisibility();
        if (debugMode) {
            refreshSearchImgBtn.style.display = dependencies.activeTab === 'search' ? 'inline-block' : 'none';
            refreshSavedImgBtn.style.display = dependencies.activeTab === 'saved' ? 'inline-block' : 'none';
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
        dependencies.popup.querySelectorAll('.ppg-debug').forEach(el => {
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
        refreshSearchImgBtn.style.display = debugMode && dependencies.activeTab === 'search' ? 'inline-block' : 'none';
        refreshSavedImgBtn.style.display = debugMode && dependencies.activeTab === 'saved' ? 'inline-block' : 'none';
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
        if (!hoverTooltipEnabled) dependencies._ttHide();
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
        dependencies.showNotification('🔄 Принудительная загрузка картинок...');

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
        dependencies.showNotification(`✅ Обновлено ${count} картинок из поиска`);
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
                const tileEl = dependencies.savedContainer.querySelector(`.ss-tile[data-ss-key="${CSS.escape(item.key)}"]`);
                if (tileEl) {
                    const wrap = tileEl.querySelector('.ss-tile__img-wrap');
                    if (wrap) wrap.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;
                }
                count++;
            }
        }));
        refreshSavedImgBtn.textContent = '🖼';
        refreshSavedImgBtn.disabled = false;
        dependencies.showNotification(`✅ Обновлено ${count} картинок в сохранённых`);
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
            dependencies.currentTiles = [...seenTiles.values()];
            dependencies.updatePricePlaceholders(dependencies.currentTiles);
            dependencies.applyFilters();
            dependencies.showNotification('✅ Атрибуты карточек обновлены');
        } catch (e) {
            dependencies.showNotification('⚠️ Не удалось обновить атрибуты', 'warning');
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
        modeSelect.value=ppgBadgeMode; modeSelect.onchange=()=>{ppgBadgeMode=modeSelect.value==='current'?'current':'all';chrome.storage.local.set({ppgBadgeMode});try{dependencies.applyFilters();}catch(_){} };
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
                try{dependencies.updatePriceUnitUI();}catch(_){}
                try{dependencies.applyFilters();}catch(_){}
            };
            row.appendChild(lab); row.appendChild(sel); menu.appendChild(row);
        });
        const unitsHint=document.createElement('div'); unitsHint.style.cssText='font-size:9.5px;color:#999;line-height:1.3;margin:-2px 0 9px;'; unitsHint.textContent='Меняет только подпись в бейдже/фильтре/сортировке — сравнение и фильтрация по-прежнему точные.'; menu.appendChild(unitsHint);

        const posLabel=document.createElement('div'); posLabel.textContent='Угол области картинки:'; posLabel.style.cssText='font-size:11px;color:#777;margin-bottom:5px;'; menu.appendChild(posLabel);
        const posGrid=document.createElement('div'); posGrid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:5px;';
        [['top-left','↖'],['top-right','↗'],['bottom-left','↙'],['bottom-right','↘']].forEach(([pos,icon])=>{const b=document.createElement('button');b.type='button';b.textContent=icon;b.title=pos;b.dataset.ppgPos=pos;b.style.cssText=`padding:6px;border:1px solid ${ppgBadgePosition===pos?'#2196F3':'#ddd'};border-radius:6px;background:${ppgBadgePosition===pos?'#eef6ff':'#fff'};cursor:pointer;font-size:16px;`;b.onclick=()=>{ppgBadgePosition=pos;chrome.storage.local.set({ppgBadgePosition});updateAllPpgBadges();posGrid.querySelectorAll('[data-ppg-pos]').forEach(x=>{x.style.borderColor=x.dataset.ppgPos===pos?'#2196F3':'#ddd';x.style.background=x.dataset.ppgPos===pos?'#eef6ff':'#fff';});};posGrid.appendChild(b);});
        menu.appendChild(posGrid); document.body.appendChild(menu);
        lifecycle.add(() => menu.remove());
        const close=ev=>{if(!menu.contains(ev.target)&&ev.target!==badgeSettingsBtn){menu.remove();document.removeEventListener('mousedown',close);}};
        setTimeout(()=>lifecycle.listen(document,'mousedown',close),0);
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

    dependencies.topRow.appendChild(dependencies.tabsRow);
    dependencies.topRow.appendChild(dependencies.cardStyleWrap);
    dependencies.topRow.appendChild(dependencies.counter);
    // topRow.appendChild(scaleWrap);
    dependencies.topRow.appendChild(toolBtnGroup);
    dependencies.topRow.appendChild(dependencies.minimizeBtn);
    dependencies.topRow.appendChild(dependencies.closeBtn);

    // Строка сортировки
    return { get debugMode() { return debugMode; }, get hoverTooltipEnabled() { return hoverTooltipEnabled; }, refreshSavedImgBtn, refreshSearchImgBtn, toolBtnGroup, updateDebugVisibility, destroy: lifecycle.destroy };
}
