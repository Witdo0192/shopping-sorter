// Управление сохранёнными товарами и импортом/экспортом.
// dependencies связывает эту часть с состоянием и действиями панели.
function createSavedProductsToolbar(dependencies) {
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
        const n = dependencies.savedSelectedKeys.size;
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
        dependencies.currentSavedTiles.forEach(tile => {
            const k = getTileKey(tile);
            if (!k) return;
            if (dependencies.savedSelectedKeys.has(k)) dependencies.savedSelectedKeys.delete(k);
            else dependencies.savedSelectedKeys.add(k);
        });
        // обновляем визуал всех карточек
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
        updateSavedSelectionCounter();
    });

    invertSavedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';

    const { createProgressBar, exportBtn, exportSelectedBtn, importBtn, importInput } = createProductTransfer({
        get savedContainer() { return dependencies.savedContainer; },
        get savedSelectedKeys() { return dependencies.savedSelectedKeys; },
        get showNotification() { return dependencies.showNotification; },
        get switchTab() { return dependencies.switchTab; }
    });

    const deselectSavedBtn = document.createElement('button');
    deselectSavedBtn.textContent = '✕ Снять';
    deselectSavedBtn.title = 'Снять выделение';
    deselectSavedBtn.style.cssText = 'padding:5px 10px; background:transparent; color:#666; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';
    deselectSavedBtn.addEventListener('click', () => {
        dependencies.savedSelectedKeys.clear();
        dependencies.lastSavedSelectedKey = null; dependencies.lastSavedSelectedIndex = -1;
        dependencies.savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
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
        dependencies.savedContainer.querySelectorAll('[data-saved-key]').forEach(w => {
            const k = w.dataset.savedKey;
            if (k) dependencies.savedSelectedKeys.add(k);
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
    return { clearSavedBtn, createProgressBar, removeSelectedSavedBtn, savedCounter, savedPanel, updateSavedSelectionCounter, updateStorageIndicator };
}
