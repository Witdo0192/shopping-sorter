// Отображение товаров страницы: группировка, клоны карточек и виртуализация.
// Геттеры читают текущее состояние; сеттеры сохраняют изменения в панели.
function createSearchProductsView(dependencies) {
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
        dependencies.refreshExtraControls([...seenTiles.values()]);
        dependencies.currentTiles = tiles;
        if (virtualRenderCleanup) { try { virtualRenderCleanup(); } catch (_) {} virtualRenderCleanup = null; }
        dependencies.productsContainer.style.display = '';
        dependencies.productsContainer.style.position = '';
        dependencies.productsContainer.style.overflowY = '';
        dependencies.productsContainer.style.overflowX = '';
        dependencies.productsContainer.innerHTML = '';

        if (dependencies.noSearchTiles) {
            dependencies.productsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-size:14px;">На странице товары не найдены</div>';
            return;
        }

        if (dependencies.groupingActive) {
            const searchText = dependencies.searchInput.value.trim().toLowerCase();
            const palette = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0', '#FCE4EC', '#E0F7FA', '#F9FBE7', '#EDE7F6'];

            // фильтр по тексту с поддержкой parseSearchQuery (!, пробел, кавычки)
            const searchTokens = dependencies.searchInput.value.trim() ? parseSearchQuery(dependencies.searchInput.value) : null;
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
                dependencies.productsContainer.innerHTML = '';
                const isFlow = dependencies.groupLayout === 'flow';
                dependencies.productsContainer.style.display = '';
                dependencies.productsContainer.style.flexWrap = '';
                dependencies.productsContainer.style.alignContent = '';

                const soloTiles = [];
                let groupIdx = 0;

                // ── группа «по картинке» (если задано эталонное изображение) ──
                if (dependencies.referenceFeatures) {
                    const THRESHOLD = 0.60;
                    const refMatches = [];
                    clusters.forEach(({ tiles: clusterTiles, solo }) => {
                        clusterTiles.forEach(tile => {
                            const key = getTileKey(tile) || '';
                            const feat = _featureCache.get(key);
                            if (feat && combinedSimilarity(dependencies.referenceFeatures, feat) >= THRESHOLD) {
                                if (tileMatchesSearch(tile)) refMatches.push(tile);
                            }
                        });
                    });
                    const refColor = '#DDEEFF';
                    if (isFlow) {
                        dependencies.productsContainer.appendChild(makeFlowDividerSearch(
                            `🖼 По картинке · ${refMatches.length}`, refColor, false, true));
                    } else {
                        dependencies.productsContainer.appendChild(makeSepSearch(
                            `🖼 Похожие на указанное изображение · ${refMatches.length}`, refColor, false, true));
                    }
                    if (refMatches.length > 0) {
                        const sorted = dependencies.getFilteredAndSorted('', refMatches);
                        const refLabel = `🖼 По картинке · ${refMatches.length}`;
                        sorted.forEach((tile, idx) => renderOneTile(tile, refColor, true, idx === 0 && isFlow ? refLabel : null));
                    }
                    if (!isFlow) {
                        const divider = document.createElement('div');
                        divider.style.cssText = 'grid-column:1/-1; height:1px; background:#ddd; margin:4px 0;';
                        dependencies.productsContainer.appendChild(divider);
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
                    const sorted = dependencies.getFilteredAndSorted('', clusterTiles);
                    const visible = sorted.filter(tileMatchesSearch);
                    if (!isFlow) {
                        dependencies.productsContainer.appendChild(makeSepSearch(
                            `Группа ${groupIdx} · ${visible.length}/${clusterTiles.length} похожих товаров`, color, false, false));
                    }
                    const clusterLabel = `Гр.${groupIdx} ${visible.length}/${clusterTiles.length}`;
                    visible.forEach((tile, idx) => renderOneTile(tile, color, true, idx === 0 && isFlow ? clusterLabel : null));
                });

                // ── одиночные ──
                if (soloTiles.length > 0 || clusters.some(c => c.solo)) {
                    const totalSolo = clusters.filter(c => c.solo).length;
                    if (!isFlow) {
                        dependencies.productsContainer.appendChild(makeSepSearch(
                            `Не распознанные · ${soloTiles.length}/${totalSolo}`, '#f5f5f5', true, false));
                    }
                    const soloLabel = `Разные ${soloTiles.length}/${totalSolo}`;
                    const sortedSolo = dependencies.getFilteredAndSorted('', soloTiles);
                    sortedSolo.forEach((tile, idx) => renderOneTile(tile, null, false, idx === 0 && isFlow ? soloLabel : null));
                }
                refreshSavedKeysCache();
                // Обновляем счётчик — считаем реально отрисованные карточки
                const visibleCount = dependencies.productsContainer.querySelectorAll('[data-tile-key]').length;
                const counterMode = dependencies.getCounterSortMode(dependencies.searchInput.value);
                const arrow2 = counterMode.includes('desc') ? '↓' : '↑';
                dependencies.renderCounterLabel(visibleCount, seenTiles.size, counterMode, arrow2);
            }

            // используем кэш если есть — группы стабильны
            if (dependencies._searchGroupCache) {
                renderClusters(dependencies._searchGroupCache);
                return;
            }

            dependencies.productsContainer.innerHTML = '';
            const searchGroupProgress = document.createElement('div');
            searchGroupProgress.style.cssText = 'padding:20px; text-align:center; color:#999; font-size:13px; display:flex; flex-direction:column; align-items:center; gap:10px;';
            searchGroupProgress.innerHTML = '<div>🔍 Анализирую изображения...</div>';
            const searchCancelBtn = document.createElement('button');
            searchCancelBtn.textContent = '✕ Отмена';
            searchCancelBtn.style.cssText = 'padding:4px 14px; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; background:#f9f9f9; color:#555;';
            let searchGroupCancelled = false;
            searchCancelBtn.onclick = () => {
                searchGroupCancelled = true;
                dependencies.groupingActive = false;
                dependencies.groupBtn.style.background = '#fff';
                dependencies.groupBtn.style.color = '#555';
                dependencies.groupBtn.style.borderColor = '#ccc';
                dependencies.applyFilters();
            };
            searchGroupProgress.appendChild(searchCancelBtn);
            dependencies.productsContainer.appendChild(searchGroupProgress);
            // снапшот seenTiles на момент начала анализа — не захватываем saved-тайлы
            const allTiles = [...seenTiles.values()].filter(t => !t.dataset?.savedKey);
            const getImgSrc = tile => tile.querySelector('img[src]')?.src || '';
            groupTilesByVisualSimilarity(allTiles, getImgSrc).then(clusters => {
                if (searchGroupCancelled) return;
                dependencies._searchGroupCache = clusters;
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

            if (dependencies.debugMode) {
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

            const clone = dependencies.searchCardStyle === 'custom'
                ? createCustomSearchTile(tile, dependencies.cardScale)
                : getCachedSiteClone(tile);

            if (dependencies.searchCardStyle === 'site' && clone instanceof Element) {
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
    background: ${dependencies.selectedKeys.has(tileKey) ? '#2196F3' : 'rgba(255,255,255,0.9)'};
    border: 2px solid ${dependencies.selectedKeys.has(tileKey) ? '#2196F3' : '#ccc'};
    display: ${dependencies.selectedKeys.has(tileKey) ? 'flex' : 'none'};
    align-items: center; justify-content: center;
    font-size: 12px; color: white; font-weight: bold;
    transition: all 0.15s;
`;
            checkbox.textContent = dependencies.selectedKeys.has(tileKey) ? '✓' : '';

            // Подсветка выделенной карточки
            if (dependencies.selectedKeys.has(tileKey)) {
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
            if (dependencies.searchCardStyle === 'site') {
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
            if (groupLabel && dependencies.groupingActive && dependencies.groupLayout === 'flow') {
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
            if (append) dependencies.productsContainer.appendChild(wrap);
            return wrap;
        } // end renderOneTile

        function renderVirtualizedTiles(virtualTiles) {
            const gap = 15;
            const minCardWidth = Math.max(120, Number(dependencies.cardScale) || 180);
            const overscanRows = 2;
            let rowHeight = dependencies.searchCardStyle === 'custom'
                ? Math.max(300, Math.round((Number(dependencies.cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(dependencies.cardScale) || 180) + gap)
                : 300;
            let raf = 0;
            let resizeObserver = null;
            let lastRange = '';
            let savedScrollTop = dependencies.productsContainer.scrollTop;
            let resizeHandler = null;
            let scrollHandler = null;
            // Переиспользуем wrapper'ы при прокрутке вместо постоянного create/remove.
            const wrapperPool = [];

            dependencies.productsContainer.innerHTML = '';
            dependencies.productsContainer.style.display = 'block';
            dependencies.productsContainer.style.position = 'relative';
            dependencies.productsContainer.style.overflowY = 'auto';
            dependencies.productsContainer.style.overflowX = 'hidden';

            const stage = document.createElement('div');
            stage.className = 'ss-virtual-stage';
            stage.style.cssText = 'position:relative;width:100%;min-height:1px;';
            dependencies.productsContainer.appendChild(stage);

            function getMetrics() {
                const cs = getComputedStyle(dependencies.productsContainer);
                const pl = parseFloat(cs.paddingLeft) || 0;
                const pr = parseFloat(cs.paddingRight) || 0;
                const contentWidth = Math.max(1, dependencies.productsContainer.clientWidth - pl - pr);
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

                const viewportHeight = dependencies.productsContainer.clientHeight || 600;
                const scrollTop = dependencies.productsContainer.scrollTop;
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
                    const baseHeight = dependencies.searchCardStyle === 'custom'
                        ? Math.round((Number(dependencies.cardScale) || 180) * 0.9) + getSavedTileBodyHeight(Number(dependencies.cardScale) || 180)
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
            dependencies.productsContainer.addEventListener('scroll', scrollHandler, { passive: true });
            window.addEventListener('resize', resizeHandler, { passive: true });
            virtualRenderCleanup = () => {
                if (raf) cancelAnimationFrame(raf);
                dependencies.productsContainer.removeEventListener('scroll', scrollHandler);
                window.removeEventListener('resize', resizeHandler);
                if (resizeObserver) resizeObserver.disconnect();
                wrapperPool.length = 0;
            };

            const { columns } = getMetrics();
            updateStageHeight(columns);
            renderWindow(true);
            dependencies.productsContainer.scrollTop = Math.min(savedScrollTop, Math.max(0, stage.scrollHeight - dependencies.productsContainer.clientHeight));
            renderWindow(true);

            refreshSavedKeysCache();
            const counterMode = dependencies.getCounterSortMode(dependencies.searchInput.value);
            const arrow = counterMode.includes('desc') ? '↓' : '↑';
            dependencies.renderCounterLabel(virtualTiles.length, seenTiles.size, counterMode, arrow);
        }

        refreshSavedKeysCache(); // расставляем значки 🔖 сразу после рендера
        const counterMode = dependencies.getCounterSortMode(dependencies.searchInput.value);
        const arrow = counterMode.includes('desc') ? '↓' : '↑';
        dependencies.renderCounterLabel(tiles.length, seenTiles.size, counterMode, arrow);

        if (seenTiles.size > 500) {
            const task = () => {
                if (!dependencies.productsContainer.isConnected) return;
                dependencies.updateTypeCounts();
                dependencies.updatePricePlaceholders([...seenTiles.values()]);
                dependencies.updateDebugVisibility();
            };
            if ('requestIdleCallback' in window) requestIdleCallback(task, {timeout: 700});
            else setTimeout(task, 0);
        } else {
            dependencies.updateTypeCounts();
            dependencies.updatePricePlaceholders([...seenTiles.values()]);
            dependencies.updateDebugVisibility();
        }
    }


    // Делегирование hover/click для карточек. Не создаём по 3 listener'а на каждую карточку.
    return { renderTiles,
        destroy() {
            if (virtualRenderCleanup) { virtualRenderCleanup(); virtualRenderCleanup = null; }
            _renderCloneCache.clear();
        }
    };
}
