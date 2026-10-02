// Отображение сохранённых товаров, группировка и ленивое получение изображений.
// Геттеры читают текущее состояние; сеттеры сохраняют изменения в панели.
function createSavedProductsView(dependencies) {
    async function renderSavedTiles() {
        // Отключаем предыдущий observer картинок если есть
        dependencies.savedContainer._imgObserver?.disconnect();
        dependencies.savedContainer._imgObserver = null;
        dependencies.savedContainer.innerHTML = '';
        // высота ячейки = картинка + текстовая область (масштабируется вместе с размером карточек)
        const imgH = Math.round(dependencies.cardScale * 0.9);
        // при группировке grid-auto-rows убирается в renderSavedClusters чтобы разделители не растягивались
        if (!dependencies.groupingActive) dependencies.savedContainer.style.gridAutoRows = `${imgH + getSavedTileBodyHeight(dependencies.cardScale)}px`;
        const saved = await getSavedTiles();

        dependencies.savedCounter.textContent = `Сохранено: ${saved.length} товаров`;
        dependencies.savedPanel.style.display = 'flex';
        dependencies.updateSavedSelectionCounter();
        dependencies.updateStorageIndicator();
        dependencies.renderFolderRow(saved);

        // фильтруем по активной папке
        const visibleSaved = dependencies.activeFolderFilter === null
            ? saved
            : saved.filter(t => (t.folders || []).includes(dependencies.activeFolderFilter));

        if (saved.length === 0) {
            dependencies.savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">Нет сохранённых товаров</div>';
            return;
        }
        if (visibleSaved.length === 0) {
            dependencies.savedContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">В этой папке нет товаров</div>';
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

        let tiles = dependencies.getFilteredAndSorted(dependencies.searchInput.value);

        // Восстанавливаем seenTiles
        seenTiles.clear();
        originalSeenTiles.forEach((tile, key) => seenTiles.set(key, tile));

        dependencies.updateTypeCounts([...savedTileMap.values()]);
        dependencies.updatePricePlaceholders([...savedTileMap.values()]);
        dependencies.updateDebugVisibility();
        const counterMode = dependencies.getCounterSortMode(dependencies.searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        dependencies.renderCounterLabel(tiles.length, savedTileMap.size, counterMode, arrow);

        dependencies.currentSavedTiles = tiles;

        const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

        async function renderSavedTilesList(orderedTiles, groupColorMap, groupLabel) {
            const tileH = dependencies.groupingActive ? `${Math.round(dependencies.cardScale * 0.9) + getSavedTileBodyHeight(dependencies.cardScale)}px` : '100%';
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
            background: ${dependencies.savedSelectedKeys.has(tileKey) ? '#ff5722' : 'rgba(255,255,255,0.9)'};
            border: 2px solid ${dependencies.savedSelectedKeys.has(tileKey) ? '#ff5722' : '#ccc'};
            align-items: center; justify-content: center;
            font-size: 12px; color: white; font-weight: bold; transition: all 0.15s;
            display: ${dependencies.savedSelectedKeys.has(tileKey) ? 'flex' : 'none'};
        `;
                checkbox.textContent = dependencies.savedSelectedKeys.has(tileKey) ? '✓' : '';

                if (dependencies.savedSelectedKeys.has(tileKey)) {
                    wrap.style.outline = '2px solid #ff5722';
                    wrap.style.borderRadius = '8px';
                }

                wrap.addEventListener('mouseenter', () => { checkbox.style.display = 'flex'; });
                wrap.addEventListener('mouseleave', () => {
                    if (!dependencies.savedSelectedKeys.has(tileKey)) checkbox.style.display = 'none';
                });
                wrap.addEventListener('click', (e) => {
                    if (e.target.closest('a')) return; // не перехватываем клики по ссылкам
                    if (!e.ctrlKey && !e.shiftKey && e.target !== checkbox) return;
                    e.preventDefault();

                    if (e.shiftKey && dependencies.lastSavedSelectedKey) {
                        // Диапазон по реальному DOM-порядку — работает и в режиме похожих
                        const allWraps = [...dependencies.savedContainer.querySelectorAll('[data-saved-key]')];
                        const allKeys = allWraps.map(w => w.dataset.savedKey);
                        const fromIdx = allKeys.indexOf(dependencies.lastSavedSelectedKey);
                        const toIdx = allKeys.indexOf(tileKey);
                        if (fromIdx !== -1 && toIdx !== -1) {
                            const lo = Math.min(fromIdx, toIdx);
                            const hi = Math.max(fromIdx, toIdx);
                            for (let i = lo; i <= hi; i++) {
                                if (allKeys[i]) dependencies.savedSelectedKeys.add(allKeys[i]);
                            }
                        }
                    } else {
                        if (dependencies.savedSelectedKeys.has(tileKey)) {
                            dependencies.savedSelectedKeys.delete(tileKey);
                        } else {
                            dependencies.savedSelectedKeys.add(tileKey);
                        }
                        dependencies.lastSavedSelectedIndex = tileIndex;
                        dependencies.lastSavedSelectedKey = tileKey;
                    }

                    // обновляем визуал всех затронутых карточек без ребилда DOM
                    dependencies.savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
                        const k = w.dataset.savedKey;
                        const selected = dependencies.savedSelectedKeys.has(k);
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
                    dependencies.updateSavedSelectionCounter();
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
                    dependencies.showFolderMenu(folderBtn, tileKey, savedItem, saved);
                });
                wrap.addEventListener('mouseenter', () => { folderBtn.style.display = 'block'; });
                wrap.addEventListener('mouseleave', () => { folderBtn.style.display = 'none'; });

                wrap.appendChild(checkbox);
                wrap.appendChild(folderBtn);
                if (groupColor) wrap.style.outline = `2px solid ${groupColor}`;
                // Разделитель группы на первой карточке (слева, абсолютный)
                if (dependencies.groupingActive && tileIndex === 0 && groupLabel) {
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
                dependencies.savedContainer.appendChild(wrap);
            }); // end orderedTiles.forEach
        } // end renderSavedTilesList

        if (dependencies.groupingActive) {
            // Фильтруем тайлы внутри групп через getFilteredAndSorted с sourceTiles —
            // без подмены seenTiles, безопасно для параллельных вкладок
            function filterCluster(clusterTiles) {
                return dependencies.getFilteredAndSorted(dependencies.searchInput.value, clusterTiles);
            }
            function savedTileMatchesSearch(tile) {
                return filterCluster([tile]).length > 0;
            }

            function makeSep(text, color, isSolo, isRef) {
                const sep = document.createElement('div');
                const isFlow = dependencies.groupLayout === 'flow';
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
                const tileH = Math.round(dependencies.cardScale * 0.9) + getSavedTileBodyHeight(dependencies.cardScale);
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
                const isFlow = dependencies.groupLayout === 'flow';
                // Очищаем контейнер (убираем прогресс-блок и старые карточки)
                dependencies.savedContainer._imgObserver?.disconnect();
                dependencies.savedContainer._imgObserver = null;
                dependencies.savedContainer.innerHTML = '';
                dependencies.savedContainer.style.gridAutoRows = '';
                dependencies.savedContainer.style.display = '';
                dependencies.savedContainer.style.flexWrap = '';
                dependencies.savedContainer.style.alignContent = '';

                const colorMap = new Map();
                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» ──
                if (dependencies.referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles }) => {
                        const filtered = filterCluster(clusterTiles);
                        filtered.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(dependencies.referenceFeatures, feat) >= THRESHOLD) {
                                refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (!isFlow) {
                        dependencies.savedContainer.appendChild(makeSep(
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
                        dependencies.savedContainer.appendChild(makeSep(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих`, color, false, false));
                    }
                    renderSavedTilesList(visible, colorMap, `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`);
                });

                // ── одиночные ──
                const totalSolo = clusters.filter(c => c.solo).length;
                if (totalSolo > 0) {
                    if (!isFlow) {
                        dependencies.savedContainer.appendChild(makeSep(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '', true, false));
                    }
                    renderSavedTilesList(soloTiles, null, `Разные ${soloTiles.length}/${totalSolo}`);
                }
                // Загружаем картинки — передаём уже полученные из IndexedDB если есть
                loadSavedImages(preloadedImages);
            }

            // используем кэш если есть
            if (dependencies._savedGroupCache) {
                renderSavedClusters(dependencies._savedGroupCache, null);
            } else {
                // Батчевая загрузка картинок с прогрессом и кнопкой отмены
                let cancelled = false;
                const allKeys = tiles.map(t => getTileKey(t)).filter(Boolean);
                const total = allKeys.length;
                const IMG_BATCH = 50;

                // Прогресс-блок внутри savedContainer
                dependencies.savedContainer.innerHTML = '';
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
                    dependencies.groupingActive = false;
                    dependencies.groupBtn.style.background = '#fff';
                    dependencies.groupBtn.style.color = '#555';
                    dependencies.groupBtn.style.borderColor = '#ccc';
                    renderSavedTiles();
                };

                progressWrap.appendChild(progressLabel);
                progressWrap.appendChild(progressTrack);
                progressWrap.appendChild(cancelBtn);
                dependencies.savedContainer.appendChild(progressWrap);

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
                        dependencies._savedGroupCache = clusters;
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
        dependencies.savedContainer._imgObserver?.disconnect();
        dependencies.savedContainer._imgObserver = null;

        const IMG_BATCH = 30;
        const pendingImgKeys = new Map(); // key → { wrap, tileEl }

        dependencies.savedContainer.querySelectorAll('.ss-tile').forEach(tileEl => {
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

        dependencies.savedContainer.querySelectorAll('.ss-tile__img-wrap').forEach(w => {
            // Наблюдаем только если карточка ещё в pendingImgKeys
            const key = w.closest('.ss-tile')?.dataset?.ssKey;
            if (key && pendingImgKeys.has(key)) imgObserver.observe(w);
        });
        dependencies.savedContainer._imgObserver = imgObserver;
    }

    // Удалить выбранные
    dependencies.removeSelectedSavedBtn.addEventListener('click', async () => {
        if (!confirm(`Удалить ${dependencies.savedSelectedKeys.size} выбранных товаров?`)) return;
        await removeFromSaved(dependencies.savedSelectedKeys);
        dependencies.savedSelectedKeys.clear();
        dependencies.lastSavedSelectedKey = null; dependencies.lastSavedSelectedIndex = -1;
        renderSavedTiles();
    });

    // Очистить всё
    dependencies.clearSavedBtn.addEventListener('click', async () => {
        if (!confirm('Удалить все сохранённые товары?')) return;
        chrome.runtime.sendMessage({ action: 'clearImages' });
        await saveTiles([]);
        dependencies.savedSelectedKeys.clear();
        dependencies.lastSavedSelectedKey = null; dependencies.lastSavedSelectedIndex = -1;
        renderSavedTiles();
    });

    return { renderSavedTiles };
}
