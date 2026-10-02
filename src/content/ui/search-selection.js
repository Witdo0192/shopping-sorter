// Выбор товаров страницы и их сохранение.
// dependencies связывает эту часть с состоянием и действиями панели.
function createSearchSelection(dependencies) {
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
        dependencies.currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (dependencies.selectedKeys.has(k)) dependencies.selectedKeys.delete(k);
            else dependencies.selectedKeys.add(k);
        });
        updateSelectionPanel();
        dependencies.updateVisibleSelectionState();
    });

    selectionPanel.appendChild(selectionCounter);
    selectionPanel.appendChild(selectAllBtn);
    selectionPanel.appendChild(deselectBtn);
    selectionPanel.appendChild(invertBtn);
    selectionPanel.appendChild(saveSelectedBtn);

    function updateSelectionPanel() {
        selectionCounter.textContent = dependencies.selectedKeys.size > 0 ? `Выбрано: ${dependencies.selectedKeys.size}` : '';
    }

    selectAllBtn.addEventListener('click', () => {
        dependencies.currentTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (k) dependencies.selectedKeys.add(k);
        });
        dependencies.lastSelectedIndex = -1; dependencies.lastSelectedKey = null;
        updateSelectionPanel();
        dependencies.updateVisibleSelectionState();
    });

    deselectBtn.addEventListener('click', () => {
        dependencies.selectedKeys.clear();
        dependencies.lastSelectedIndex = -1; dependencies.lastSelectedKey = null;
        updateSelectionPanel();
        dependencies.updateVisibleSelectionState();
    });

    saveSelectedBtn.addEventListener('click', async () => {
        const tilesToSave = dependencies.currentTiles
            .filter(tile => dependencies.selectedKeys.has(getTileKey(tile)));
        if (tilesToSave.length === 0) return;

        // показываем диалог выбора папок
        const existingFolders = getAllFoldersGlobal ? await getAllFoldersGlobal() : [];
        showSaveFolderDialog(saveSelectedBtn, existingFolders, async (chosenFolders) => {
            const total = tilesToSave.length;
            const progress = total > 3 ? dependencies.createProgressBar(
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
                dependencies.showNotification(`❌ Ошибка сохранения: ${e?.message || e}`, 'error');
                return;
            }

            dependencies.selectedKeys.clear();
            updateSelectionPanel();
            dependencies.renderTiles(dependencies.currentTiles);

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
                dependencies.showNotification(msg, added === 0 && chosenFolders.length === 0 ? 'warning' : 'info');
            }
        });
    });

    dependencies.uiRoot.appendChild(dependencies.header);
    dependencies.cardsHost.appendChild(dependencies.productsContainer);
    dependencies.bottomUiRoot.appendChild(selectionPanel);

    // ─── Контейнер сохранённых товаров ────────────────────────────────────────────
    // savedContainer добавляется после folderRow (ниже)

    // Панель действий для сохранённых
    return { selectionPanel, updateSelectionPanel };
}
