// Кнопка 🔄 в левом меню: повторно считывает атрибуты карточек и синхронизирует панель с БД
// (chrome.storage). Если данные изменились в другой вкладке — сохранённые товары, сайты/селекторы,
// единицы, настройки бейджей — кнопка подсвечивается, и достаточно нажать её, не перезагружая вкладку.
function createDataSync(dependencies) {
    const lifecycle = createUiLifecycle();
    const pending = new Set(); // человекочитаемые названия того, что изменилось в БД
    let syncedSavedSig = null; // подпись сохранённых на момент последней синхронизации
    let busy = false;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '🔄';
    const IDLE_TITLE = 'Повторно считать атрибуты карточек (рейтинг, отзывы, цена и т.д.) и синхронизировать данные с БД';

    function paint() {
        const has = pending.size > 0;
        button.style.cssText = `padding:6px 10px;border:${has ? 'none' : '1px solid #ddd'};border-radius:6px;cursor:pointer;font-size:13px;` +
            `background:${has ? '#ff9800' : 'transparent'};color:${has ? 'white' : '#999'};` +
            (has ? 'box-shadow:0 0 0 3px rgba(255,152,0,.35);' : '');
        button.title = has
            ? `Есть обновления в БД (${[...pending].join(', ')}). Нажмите, чтобы синхронизировать`
            : IDLE_TITLE;
        try { button.animate?.(has ? [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }] : [], { duration: 900, iterations: 3 }); } catch { /* анимация необязательна */ }
    }
    function mark(reason) {
        if (pending.has(reason)) return;
        pending.add(reason);
        paint();
    }
    paint();

    getSavedTiles().then(saved => { if (syncedSavedSig === null) syncedSavedSig = sigOfSavedTiles(saved); });

    // Что считается «изменилось в другой вкладке»: собственные записи этой вкладки и значения,
    // которые уже загружены в память, не считаются.
    const prefCurrent = {
        ppgBadgeVisible: () => ppgBadgeVisible,
        ppgBadgePosition: () => ppgBadgePosition,
        ppgBadgeMode: () => ppgBadgeMode,
        badgeDisplayUnit: () => JSON.stringify(badgeDisplayUnit),
        indexBadgeVisible: () => indexBadgeVisible,
        indexBadgePosition: () => indexBadgePosition
    };
    function onStorageChanged(changes, area) {
        if (area !== 'local') return;
        if (changes.savedTiles) {
            const sig = sigOfSavedTiles(changes.savedTiles.newValue);
            if (sig !== lastOwnSavedSig && sig !== syncedSavedSig) mark('сохранённые товары');
        }
        if (changes.sites && JSON.stringify(changes.sites.newValue) !== loadedSitesSig) mark('сайты и селекторы');
        if (changes.units && JSON.stringify(changes.units.newValue) !== loadedUnitsSig) mark('единицы измерения');
        for (const [key, current] of Object.entries(prefCurrent)) {
            if (!changes[key]) continue;
            const value = key === 'badgeDisplayUnit'
                ? JSON.stringify({ ...badgeDisplayUnit, ...changes[key].newValue })
                : changes[key].newValue;
            if (value !== current()) { mark('настройки бейджей'); break; }
        }
    }
    chrome.storage.onChanged.addListener(onStorageChanged);
    lifecycle.add(() => chrome.storage.onChanged.removeListener?.(onStorageChanged));

    async function sync() {
        const hadSites = pending.has('сайты и селекторы') || pending.has('единицы измерения');
        // 1. Конфигурация сайтов и единиц — перечитываем только если она менялась.
        if (hadSites) {
            await loadSelectors();
            invalidateTileMetricsCache();
        }
        // 2. Настройки бейджей.
        await Promise.all([loadBadgePreferences(), loadIndexBadgePreferences()]);
        try { updateAllPpgBadges(); updateAllIndexBadges(); } catch { /* бейджи могут быть не созданы */ }
        // 3. Сохранённые товары.
        const saved = await getSavedTiles();
        const sig = sigOfSavedTiles(saved);
        const savedChanged = sig !== syncedSavedSig;
        syncedSavedSig = sig;
        if (savedChanged) {
            savedKeysCache.clear();
            saved.forEach(item => savedKeysCache.add(item.key));
            window._invalidateGroupCache?.();
            dependencies.updateStorageIndicator?.();
        }
        // 4. Атрибуты карточек на странице и перерисовка.
        collectTiles();
        await new Promise(r => setTimeout(r, 80));
        dependencies.currentTiles = [...seenTiles.values()];
        if (hadSites) dependencies.updatePriceUnitUI();
        dependencies.updatePricePlaceholders(dependencies.currentTiles);
        dependencies.applyFilters();
        if ((savedChanged || hadSites) && dependencies.activeTab === 'saved') await dependencies.renderSavedTiles();
        return { savedChanged, hadSites };
    }

    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        const wasPending = pending.size > 0;
        button.textContent = '⏳';
        button.disabled = true;
        try {
            const result = await sync();
            pending.clear();
            dependencies.showNotification(wasPending || result.savedChanged
                ? '✅ Данные синхронизированы с БД, атрибуты карточек обновлены'
                : '✅ Атрибуты карточек обновлены, в БД изменений нет');
        } catch (e) {
            console.error('Синхронизация с БД не удалась:', e);
            dependencies.showNotification('⚠️ Не удалось синхронизировать данные', 'warning');
        } finally {
            button.textContent = '🔄';
            button.disabled = false;
            busy = false;
            paint();
        }
    });

    return { button, destroy: lifecycle.destroy };
}
