// Папки сохранённых товаров: меню, поиск, переименование и выбор.
// Геттеры читают текущее состояние; сеттеры сохраняют изменения в панели.
function createProductFolders(dependencies) {
    function getAllFolders(tiles) {
        const set = new Set();
        tiles.forEach(t => (t.folders || []).forEach(f => set.add(f)));
        return [...set].sort();
    }

    function renderFolderRow(tiles) {
        dependencies.folderRow.innerHTML = '';
        const folders = getAllFolders(tiles);
        // сбрасываем фильтр если папка исчезла
        if (dependencies.activeFolderFilter && !folders.includes(dependencies.activeFolderFilter)) {
            dependencies.activeFolderFilter = null;
        }
        if (!folders.length) { dependencies.folderRow.style.display = 'none'; return; }
        dependencies.folderRow.style.display = 'flex';

        // верхняя строка: поиск (если папок много) + кнопка управления — всегда на виду, не скроллится
        const topBar = document.createElement('div');
        topBar.style.cssText = 'display:flex; align-items:center; gap:6px;';

        let searchInput = null;
        if (folders.length > 6) {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '🔍 Поиск папки...';
            searchInput.value = dependencies.folderSearchQuery;
            searchInput.style.cssText = 'flex:1; min-width:0; padding:5px 10px; border:1px solid #ddd; border-radius:14px; font-size:12px; outline:none; background:#fff;';
            searchInput.addEventListener('input', () => {
                dependencies.folderSearchQuery = searchInput.value;
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

        dependencies.folderRow.appendChild(topBar);

        // прокручиваемая область с папками
        const pillsWrap = document.createElement('div');
        pillsWrap.style.cssText = `display:flex; gap:6px; align-items:center; flex-wrap:wrap;
            max-height:76px; overflow-y:auto; padding-right:2px;`;
        dependencies.folderRow.appendChild(pillsWrap);

        function renderPills() {
            pillsWrap.innerHTML = '';
            const q = dependencies.folderSearchQuery.trim().toLowerCase();

            if (!q) {
                const allBtn = document.createElement('button');
                allBtn.textContent = '📂 Все';
                allBtn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${dependencies.activeFolderFilter === null ? '#2196F3' : '#fff'}; color:${dependencies.activeFolderFilter === null ? '#fff' : '#444'};`;
                allBtn.addEventListener('click', () => { dependencies.activeFolderFilter = null; dependencies.invalidateGroupCache(); dependencies.renderSavedTiles(); });
                pillsWrap.appendChild(allBtn);
            }

            const filtered = q ? folders.filter(f => f.toLowerCase().includes(q)) : folders;
            filtered.forEach(f => {
                const btn = document.createElement('button');
                btn.textContent = `📁 ${f}`;
                btn.style.cssText = `padding:4px 10px; border-radius:14px; border:1px solid #bbb; cursor:pointer; font-size:12px; flex-shrink:0;
                    background:${dependencies.activeFolderFilter === f ? '#2196F3' : '#fff'}; color:${dependencies.activeFolderFilter === f ? '#fff' : '#444'};`;
                btn.addEventListener('click', () => { dependencies.activeFolderFilter = f; dependencies.invalidateGroupCache(); dependencies.renderSavedTiles(); });
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
        dependencies.uiRoot.querySelector('#ss-manage-folders-menu')?.remove();
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
                    if (dependencies.activeFolderFilter === f) dependencies.activeFolderFilter = newName;
                    menu.remove();
                    dependencies.renderSavedTiles();
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
            if (selectedFolders.has(dependencies.activeFolderFilter)) dependencies.activeFolderFilter = target;
            menu.remove();
            dependencies.renderSavedTiles();
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
            if (selectedFolders.has(dependencies.activeFolderFilter)) dependencies.activeFolderFilter = null;
            menu.remove();
            dependencies.renderSavedTiles();
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

    dependencies.uiRoot.appendChild(dependencies.folderRow);
    dependencies.cardsHost.appendChild(dependencies.savedContainer);
    dependencies.bottomUiRoot.appendChild(dependencies.savedPanel);
    const savedSelectedKeys = new Set();

    function showFolderMenu(anchorBtn, tileKey, savedItem, allSaved) {
        dependencies.uiRoot.querySelector('#ss-folder-menu')?.remove();
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
        if (dependencies.activeFolderFilter) {
            const removeFromFolderBtn = document.createElement('button');
            removeFromFolderBtn.textContent = `📤 Убрать из «${dependencies.activeFolderFilter}»`;
            removeFromFolderBtn.style.cssText = 'display:block;width:100%;margin-bottom:6px;padding:6px;border:1px solid #ffe0b2;border-radius:4px;cursor:pointer;text-align:left;background:#fff8f3;color:#e65100;';
            removeFromFolderBtn.addEventListener('click', async () => {
                menu.remove();
                const tiles = await getSavedTiles();
                const updated = tiles.map(t => {
                    if (!targetKeys.includes(t.key)) return t;
                    return { ...t, folders: (t.folders || []).filter(f => f !== dependencies.activeFolderFilter) };
                });
                await saveTiles(updated);
                // если папка опустела — сбрасываем фильтр
                const remaining = updated.filter(t => (t.folders || []).includes(dependencies.activeFolderFilter));
                if (remaining.length === 0) dependencies.activeFolderFilter = null;
                dependencies.renderSavedTiles();
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
                    dependencies.renderSavedTiles();
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
            dependencies.renderSavedTiles();
        });
        newInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
        newRow.appendChild(newInput);
        newRow.appendChild(addBtn);
        menu.appendChild(newRow);

        // позиционируем около кнопки
        const rect = anchorBtn.getBoundingClientRect();
        const popupRect = dependencies.popup.getBoundingClientRect();
        menu.style.top = (rect.bottom - popupRect.top + dependencies.popup.scrollTop + 4) + 'px';
        menu.style.left = (rect.left - popupRect.left) + 'px';

        dependencies.popup.style.position = 'relative';
        dependencies.uiRoot.appendChild(menu);
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

    return { renderFolderRow, savedSelectedKeys, showFolderMenu };
}
