// Поиск по изображению и управление группировкой.
// dependencies связывает эту часть с состоянием и действиями панели.
function createImageSearchControls(dependencies) {
    const lifecycle = createUiLifecycle();
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
        dependencies._searchGroupCache = null;
        dependencies._savedGroupCache = null;
    }
    window._invalidateGroupCache = invalidateGroupCache;

    function updateGroupBtnStyle() {
        groupBtn.style.background = dependencies.groupingActive ? '#2196F3' : '#fff';
        groupBtn.style.color = dependencies.groupingActive ? '#fff' : '#555';
        groupBtn.style.borderColor = dependencies.groupingActive ? '#2196F3' : '#ccc';
        imgSearchBtn.style.display = dependencies.groupingActive ? '' : 'none';
        layoutBtn.style.display = dependencies.groupingActive ? '' : 'none';
        if (!dependencies.groupingActive) {
            imgSearchBtn.textContent = '🖼 По картинке';
            imgSearchBtn.style.background = '#fff';
            imgSearchBtn.style.borderColor = '#ccc';
            imgSearchBtn.style.color = '#555';
        }
    }

    function updateLayoutBtnStyle() {
        layoutBtn.textContent = dependencies.groupLayout === 'rows' ? '⠿' : '☰';
        layoutBtn.title = dependencies.groupLayout === 'rows' ? 'Вид: плитка (группы идут подряд с разделителями)' : 'Вид: строки (каждая группа с новой строки)';
    }
    updateLayoutBtnStyle();

    groupBtn.addEventListener('click', () => {
        dependencies.groupingActive = !dependencies.groupingActive;
        if (!dependencies.groupingActive) { dependencies.referenceFeatures = null; dependencies.referenceImgSrc = null; }
        updateGroupBtnStyle();
        invalidateGroupCache();
        if (dependencies.activeTab === 'search') dependencies.renderTiles(dependencies.getFilteredAndSorted(dependencies.searchInput.value));
        else dependencies.renderSavedTiles();
    });

    layoutBtn.addEventListener('click', () => {
        dependencies.groupLayout = dependencies.groupLayout === 'rows' ? 'flow' : 'rows';
        updateLayoutBtnStyle();
        if (dependencies.activeTab === 'search') dependencies.renderTiles(dependencies.getFilteredAndSorted(dependencies.searchInput.value));
        else dependencies.renderSavedTiles();
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
        dependencies.referenceImgSrc = url;
        imgSearchBtn.textContent = '⏳ Анализ...';
        imgSearchBtn.disabled = true;
        try {
            const imgData = await getImageDataFromSrc(url);
            dependencies.referenceFeatures = { phash: computePHash(imgData), hist: computeColorHistogram(imgData) };
        } finally {
            URL.revokeObjectURL(url);
        }
        imgSearchBtn.textContent = '🖼 По картинке ✓';
        imgSearchBtn.style.background = '#e8f5e9';
        imgSearchBtn.style.borderColor = '#81c784';
        imgSearchBtn.style.color = '#2e7d32';
        imgSearchBtn.disabled = false;
        invalidateGroupCache();
        if (dependencies.activeTab === 'search') dependencies.renderTiles(dependencies.getFilteredAndSorted(dependencies.searchInput.value));
        else dependencies.renderSavedTiles();
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
        const popupRect = dependencies.popup.getBoundingClientRect();
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
            dependencies.showNotification('⚠️ Не удалось получить изображение из перетащенного объекта.');
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
            dependencies.showNotification('⚠️ В буфере нет изображения.');
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
        dependencies.uiRoot.appendChild(imgPickerPopup);

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
        lifecycle.listen(document, 'mousedown', outsideClick, true);
    }

    imgSearchBtn.addEventListener('click', openImgPickerPopup);

    // ── Разделитель ──
    return { groupBtn, imgInput, imgSearchBtn, invalidateGroupCache, layoutBtn,
        destroy() {
            closeImgPickerPopup();
            lifecycle.destroy();
            if (window._invalidateGroupCache === invalidateGroupCache) window._invalidateGroupCache = null;
        }
    };
}
