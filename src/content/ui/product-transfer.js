// Импорт/экспорт карточек и изображений. dependencies предоставляет выбор, контейнер и действия панели.
function createProductTransfer(dependencies) {
    function downloadJson(tiles, suffix = '') {
        const json = JSON.stringify(tiles, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shopping-sorter${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Экспорт с картинками: подгружает dataUrl из IndexedDB и вшивает в JSON
    // ── Прогресс-бар экспорта/импорта ─────────────────────────────────────────
    function createProgressBar(label) {
        const el = document.createElement('div');
        el.style.cssText = `
            position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
            background:#fff; border:1px solid #ddd; border-radius:10px;
            padding:14px 20px; box-shadow:0 4px 20px rgba(0,0,0,0.2);
            z-index:2147483647; min-width:300px; font-family:sans-serif;
        `;
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:13px; color:#333; margin-bottom:8px; font-weight:500;';
        lbl.textContent = label;
        const track = document.createElement('div');
        track.style.cssText = 'height:6px; background:#eee; border-radius:3px; overflow:hidden;';
        const fill = document.createElement('div');
        fill.style.cssText = 'height:100%; width:0%; background:#2196F3; border-radius:3px; transition:width 0.15s ease;';
        track.appendChild(fill);
        el.appendChild(lbl);
        el.appendChild(track);
        document.body.appendChild(el);
        return {
            update(pct, text) {
                fill.style.width = pct + '%';
                if (text) lbl.textContent = text;
            },
            remove() { el.remove(); }
        };
    }

    async function exportWithImages(tiles, suffix = '') {
        const keys = tiles.map(t => t.key).filter(Boolean);
        const total = keys.length;
        if (total === 0) { dependencies.showNotification('⚠️ Нет карточек для экспорта', 'warning'); return; }

        const progress = createProgressBar(`⏳ Экспорт: загрузка картинок 0 / ${total}...`);
        const BATCH = 50; // по 50 ключей за раз — безопасный размер сообщения
        const allImages = {};

        try {
            // Батчевая загрузка картинок из IndexedDB
            for (let i = 0; i < keys.length; i += BATCH) {
                const batch = keys.slice(i, i + BATCH);
                const images = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'getImages', keys: batch }, resp => {
                        resolve(resp?.result || {});
                    });
                });
                Object.assign(allImages, images);
                const loaded = Math.min(i + BATCH, total);
                progress.update(
                    Math.round(loaded / total * 80),
                    `⏳ Экспорт: картинки ${loaded} / ${total}...`
                );
                // Даём браузеру «подышать» между батчами
                await new Promise(r => setTimeout(r, 0));
            }

            progress.update(85, '⏳ Сборка JSON...');
            await new Promise(r => setTimeout(r, 0));

            // Собираем итоговый массив
            const withImages = tiles.map(t => ({
                ...t,
                imageDataUrl: allImages[t.key]?.dataUrl || null,
            }));

            progress.update(90, '⏳ Создание файла...');
            await new Promise(r => setTimeout(r, 0));

            // JSON.stringify может заморозить поток на секунду при 100+ МБ
            // Делаем построчно чтобы не блокировать
            const jsonStr = JSON.stringify(withImages, null, 2);

            progress.update(97, '⏳ Сохранение...');
            await new Promise(r => setTimeout(r, 0));

            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `shopping-sorter${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            progress.update(100, `✅ Экспортировано ${total} карточек`);
            setTimeout(() => progress.remove(), 2000);
        } catch (e) {
            progress.remove();
            dependencies.showNotification('❌ Ошибка экспорта: ' + e.message, 'error');
        }
    }

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬆ Экспорт всех';
    exportBtn.title = 'Сохранить все карточки в JSON-файл (с изображениями)';
    exportBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    exportBtn.addEventListener('click', async () => {
        const saved = await getSavedTiles();
        if (!saved.length) { dependencies.showNotification('⚠️ Нет сохранённых товаров', 'warning'); return; }
        await exportWithImages(saved);
    });

    const exportSelectedBtn = document.createElement('button');
    exportSelectedBtn.textContent = '⬆ Экспорт выбранных';
    exportSelectedBtn.title = 'Сохранить выбранные карточки в JSON-файл (с изображениями)';
    exportSelectedBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px; display:none;';
    exportSelectedBtn.addEventListener('click', async () => {
        if (!dependencies.savedSelectedKeys.size) { dependencies.showNotification('⚠️ Ничего не выбрано', 'warning'); return; }
        const saved = await getSavedTiles();
        const selected = saved.filter(t => dependencies.savedSelectedKeys.has(t.key));
        await exportWithImages(selected, '-selected');
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', async () => {
        const file = importInput.files[0];
        if (!file) return;
        importInput.value = '';
        let progress = null;
        try {
            progress = createProgressBar('⏳ Импорт: чтение файла...');
            const text = await file.text();

            progress.update(10, '⏳ Импорт: разбор JSON...');
            await new Promise(r => setTimeout(r, 0));

            const items = JSON.parse(text);
            if (!Array.isArray(items)) throw new Error('Неверный формат — ожидается массив');
            const valid = items.filter(t => t.key && t.html);
            if (!valid.length) throw new Error('Нет валидных карточек (нужны поля key и html)');

            // Отделяем картинки от метаданных —
            // imageDataUrl НЕ должны попадать в chrome.storage.local (лимит ~5МБ)
            const withImg = valid.filter(t => t.imageDataUrl);
            const metaOnly = valid.map(({ imageDataUrl, ...rest }) => rest);

            progress.update(20, `⏳ Импорт: сохранение ${valid.length} карточек...`);
            await new Promise(r => setTimeout(r, 0));
            const added = await addToSaved(metaOnly);

            // Восстанавливаем картинки в IndexedDB батчами с ожиданием ответа
            if (withImg.length > 0) {
                const IMG_BATCH = 20;
                for (let i = 0; i < withImg.length; i += IMG_BATCH) {
                    const batch = withImg.slice(i, i + IMG_BATCH);
                    await Promise.all(batch.map(item => new Promise(resolve => {
                        chrome.runtime.sendMessage(
                            { action: 'setImage', key: item.key, dataUrl: item.imageDataUrl, force: false },
                            resp => resolve(resp)
                        );
                    })));
                    const done = Math.min(i + IMG_BATCH, withImg.length);
                    progress.update(
                        20 + Math.round(done / withImg.length * 70),
                        `⏳ Импорт: картинки ${done} / ${withImg.length}...`
                    );
                    await new Promise(r => setTimeout(r, 20));
                }
            }

            progress.update(100, `✅ Импортировано: ${added} новых, ${valid.length - added} уже были`);
            setTimeout(() => progress.remove(), 2500);
            dependencies.switchTab('saved');

            // Подгружаем картинки из текущей страницы для карточек без imageDataUrl
            valid.forEach(async item => {
                const liveTile = seenTiles.get(item.key);
                if (!liveTile) return;
                const imgEl = getBestProductImage(liveTile);
                const src = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
                if (!src) return;
                await saveImageToBackground(item.key, src, true);
                const tileEl = dependencies.savedContainer.querySelector(`.ss-tile[data-ss-key="${CSS.escape(item.key)}"]`);
                if (!tileEl) return;
                const imgData = await new Promise(r =>
                    chrome.runtime.sendMessage({ action: 'getImages', keys: [item.key] }, resp => r(resp?.result?.[item.key]))
                );
                if (imgData?.dataUrl) {
                    const wrap = tileEl.querySelector('.ss-tile__img-wrap');
                    if (wrap) wrap.innerHTML = `<img src="${imgData.dataUrl}" alt="" loading="lazy">`;
                }
            });

        } catch (e) {
            progress?.remove();
            dependencies.showNotification(`❌ Ошибка импорта: ${e.message}`, 'error');
            console.error('[import]', e);
        }
    });

    const importBtn = document.createElement('button');
    importBtn.textContent = '⬇ Импорт';
    importBtn.title = 'Загрузить карточки из JSON-файла';
    importBtn.style.cssText = 'padding:6px 12px; background:transparent; color:#555; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-size:12px;';
    importBtn.addEventListener('click', () => importInput.click());

    return { createProgressBar, exportBtn, exportSelectedBtn, importBtn, importInput };
}

