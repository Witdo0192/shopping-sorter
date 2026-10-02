// Сохранённые запросы: локальное состояние, диалог, меню и storage. dependencies связывает меню со строкой поиска и уведомлениями.
function createSavedQueries(dependencies) {
    let savedSearchQueries = [];
    const savedQueriesBtn = document.createElement('button');
    savedQueriesBtn.type = 'button';
    savedQueriesBtn.textContent = '🔖';
    savedQueriesBtn.title = 'Сохранённые поисковые запросы';
    savedQueriesBtn.style.cssText = 'padding:7px 9px; border:1px solid #ddd; border-radius:6px; cursor:pointer; background:#fff; color:#555; font-size:14px; white-space:nowrap; flex:0 0 auto;';

    const savedQueriesMenu = document.createElement('div');
    savedQueriesMenu.style.cssText = 'display:none; position:fixed; z-index:2147483647; width:410px; max-width:calc(100vw - 24px); max-height:420px; overflow:auto; background:#fff; border:1px solid #ddd; border-radius:9px; box-shadow:0 8px 28px rgba(0,0,0,.22); padding:8px; font:12px sans-serif; box-sizing:border-box;';
    document.body.appendChild(savedQueriesMenu);

    function positionSavedQueriesMenu() {
        const r = savedQueriesBtn.getBoundingClientRect();
        const w = Math.min(410, Math.max(220, window.innerWidth - 24));
        savedQueriesMenu.style.width = w + 'px';
        let left = Math.min(r.left, window.innerWidth - w - 12);
        left = Math.max(12, left);
        const h = Math.min(420, window.innerHeight - 24);
        savedQueriesMenu.style.maxHeight = h + 'px';
        let top = r.bottom + 5;
        if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 5);
        savedQueriesMenu.style.left = left + 'px';
        savedQueriesMenu.style.top = top + 'px';
    }

    function showSavedQueryDialog({item=null, onSave=null}={}) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font:13px sans-serif;';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'width:min(760px, calc(100vw - 32px));max-height:min(90vh,720px);display:flex;flex-direction:column;background:#fff;border:1px solid #d8d8d8;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;box-sizing:border-box;';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid #eee;';
        const h = document.createElement('strong');
        h.textContent = item ? '✎ Редактирование сохранённого запроса' : '＋ Сохранить поисковый запрос';
        h.style.cssText = 'font-size:13px;color:#333;';
        const close = document.createElement('button');
        close.type='button'; close.textContent='×'; close.title='Закрыть';
        close.style.cssText='border:0;background:none;color:#777;cursor:pointer;font-size:22px;line-height:1;padding:0 2px;';
        close.onclick=()=>overlay.remove();
        header.append(h,close);

        const body = document.createElement('div');
        body.style.cssText='padding:13px 14px;display:flex;flex-direction:column;gap:9px;overflow:auto;';
        const nameLabel=document.createElement('label');
        nameLabel.textContent='Название'; nameLabel.style.cssText='font-size:11px;font-weight:600;color:#555;';
        const nameInput=document.createElement('input');
        nameInput.type='text'; nameInput.value=item?.name || '';
        nameInput.placeholder='Например: Доставка до 3 дней';
        nameInput.style.cssText='width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #ccc;border-radius:6px;font-size:13px;';
        const queryLabel=document.createElement('label');
        queryLabel.textContent='Поисковый запрос'; queryLabel.style.cssText='font-size:11px;font-weight:600;color:#555;margin-top:2px;';
        const queryInput=document.createElement('textarea');
        queryInput.value=item?.query || dependencies.searchInput.value.trim();
        queryInput.placeholder='Введите полный поисковый запрос…';
        queryInput.rows=9;
        queryInput.style.cssText='width:100%;min-height:190px;max-height:45vh;box-sizing:border-box;resize:vertical;padding:9px 10px;border:1px solid #ccc;border-radius:6px;font:12px/1.45 monospace;color:#222;white-space:pre-wrap;overflow:auto;';
        const hint=document.createElement('div');
        hint.textContent='Здесь отображается весь запрос — длинные конструкции и @доставка() не обрезаются.';
        hint.style.cssText='font-size:10px;color:#888;line-height:1.35;';
        body.append(nameLabel,nameInput,queryLabel,queryInput,hint);

        const footer=document.createElement('div');
        footer.style.cssText='display:flex;justify-content:flex-end;gap:7px;padding:10px 14px;border-top:1px solid #eee;background:#fafafa;';
        const cancel=document.createElement('button');
        cancel.type='button'; cancel.textContent='Отмена';
        cancel.style.cssText='padding:7px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#555;cursor:pointer;font-size:11px;';
        cancel.onclick=()=>overlay.remove();
        const save=document.createElement('button');
        save.type='button'; save.textContent=item?'Сохранить изменения':'Сохранить';
        save.style.cssText='padding:7px 13px;border:1px solid #4CAF50;border-radius:6px;background:#f1fff3;color:#2e7d32;cursor:pointer;font-size:11px;font-weight:600;';
        save.onclick=()=>{
            const cleanName=String(nameInput.value||'').trim();
            const query=String(queryInput.value||'').trim();
            if(!cleanName){nameInput.focus();dependencies.showNotification('Укажите название запроса','warning');return;}
            if(!query){queryInput.focus();dependencies.showNotification('Поисковый запрос пуст','warning');return;}
            onSave?.({name:cleanName,query});
            overlay.remove();
        };
        footer.append(cancel,save);
        dialog.append(header,body,footer); overlay.appendChild(dialog); document.body.appendChild(overlay);
        nameInput.focus();
        overlay.addEventListener('mousedown',e=>{if(e.target===overlay) overlay.remove();});
        dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();overlay.remove();} if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){e.preventDefault();save.click();}});
    }

    let savedQueriesSearchText = '';
    const savedQuerySelectedIds = new Set();

    function renderSavedQueriesMenu() {
        savedQueriesMenu.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 8px;border-bottom:1px solid #eee;margin-bottom:6px;min-width:0;box-sizing:border-box;';
        const title = document.createElement('strong');
        title.textContent = '🔖 Сохранённые запросы';
        title.style.cssText = 'font-size:12px;color:#444;min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const headActions = document.createElement('div');
        headActions.style.cssText = 'display:flex;align-items:center;gap:5px;flex:0 0 auto;min-width:0;';
        const bulkDeleteBtn = document.createElement('button');
        bulkDeleteBtn.type = 'button'; bulkDeleteBtn.textContent = '🗑 Удалить';
        bulkDeleteBtn.title = 'Удалить выбранные сохранённые запросы';
        bulkDeleteBtn.style.cssText = 'padding:4px 7px;border:1px solid #e0b0b0;border-radius:5px;background:#fff5f5;color:#b33;cursor:pointer;font-size:10px;white-space:nowrap;display:none;';
        bulkDeleteBtn.onclick = () => {
            const count = savedQuerySelectedIds.size;
            if (!count) return;
            if (!confirm(`Удалить ${count} сохранённых запрос${count === 1 ? '' : count < 5 ? 'а' : 'ов'}?`)) return;
            savedSearchQueries = savedSearchQueries.filter(q => !savedQuerySelectedIds.has(q.id));
            savedQuerySelectedIds.clear();
            chrome.storage.local.set({savedSearchQueries});
            renderSavedQueriesMenu(); positionSavedQueriesMenu();
        };
        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button'; selectAllBtn.textContent = '☑'; selectAllBtn.title = 'Выбрать все видимые';
        selectAllBtn.style.cssText = 'padding:4px 7px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#555;cursor:pointer;font-size:11px;display:none;';
        selectAllBtn.onclick = () => {
            const ids = visibleQueryIds();
            const allSelected = ids.length && ids.every(id => savedQuerySelectedIds.has(id));
            ids.forEach(id => allSelected ? savedQuerySelectedIds.delete(id) : savedQuerySelectedIds.add(id));
            renderSavedQueriesMenu(); positionSavedQueriesMenu();
        };
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button'; saveBtn.textContent = '＋ Сохранить текущий';
        saveBtn.style.cssText = 'padding:4px 7px;border:1px solid #4CAF50;border-radius:5px;background:#f1fff3;color:#2e7d32;cursor:pointer;font-size:10px;white-space:nowrap;';
        saveBtn.onclick = () => {
            const query = dependencies.searchInput.value.trim();
            if (!query) { dependencies.showNotification('Строка поиска пуста', 'warning'); return; }
            const defaultName = query.length > 38 ? query.slice(0, 38) + '…' : query;
            showSavedQueryDialog({
                item: {name: defaultName, query},
                onSave: ({name, query}) => {
                    const existing = savedSearchQueries.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
                    const item = {id: existing >= 0 ? savedSearchQueries[existing].id : Date.now().toString(36), name, query};
                    if (existing >= 0) savedSearchQueries[existing] = item;
                    else savedSearchQueries.unshift(item);
                    savedSearchQueries = savedSearchQueries.slice(0, 100);
                    chrome.storage.local.set({savedSearchQueries});
                    renderSavedQueriesMenu(); positionSavedQueriesMenu();
                }
            });
        };
        headActions.append(selectAllBtn, saveBtn, bulkDeleteBtn);
        head.appendChild(title); head.appendChild(headActions); savedQueriesMenu.appendChild(head);

        const querySearchWrap = document.createElement('div');
        querySearchWrap.style.cssText = 'position:relative;margin:0 0 7px;';
        const querySearch = document.createElement('input');
        querySearch.type = 'search';
        querySearch.value = savedQueriesSearchText;
        querySearch.placeholder = 'Поиск по сохранённым запросам…';
        querySearch.setAttribute('aria-label', 'Поиск по сохранённым запросам');
        querySearch.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 28px 7px 9px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font:12px sans-serif;outline:none;';
        const querySearchClear = document.createElement('button');
        querySearchClear.type = 'button';
        querySearchClear.textContent = '×';
        querySearchClear.title = 'Очистить поиск';
        querySearchClear.style.cssText = 'position:absolute;right:3px;top:3px;width:24px;height:24px;border:0;background:transparent;color:#888;cursor:pointer;font-size:16px;line-height:24px;padding:0;display:' + (savedQueriesSearchText ? 'block' : 'none') + ';';
        querySearch.oninput = () => {
            savedQueriesSearchText = querySearch.value;
            renderSavedQueriesMenu();
            positionSavedQueriesMenu();
            const input = savedQueriesMenu.querySelector('input[type="search"]');
            if (input) { input.focus(); input.setSelectionRange(savedQueriesSearchText.length, savedQueriesSearchText.length); }
        };
        querySearchClear.onclick = () => {
            savedQueriesSearchText = '';
            renderSavedQueriesMenu();
            positionSavedQueriesMenu();
            savedQueriesMenu.querySelector('input[type="search"]')?.focus();
        };
        querySearchWrap.append(querySearch, querySearchClear);
        savedQueriesMenu.appendChild(querySearchWrap);

        if (!savedSearchQueries.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Нет сохранённых запросов. Введите запрос и нажмите «＋ Сохранить текущий».';
            empty.style.cssText = 'padding:12px 8px;color:#999;line-height:1.4;';
            savedQueriesMenu.appendChild(empty);
            return;
        }

        const needle = savedQueriesSearchText.trim().toLocaleLowerCase('ru-RU');
        const visibleQueries = savedSearchQueries
            .map((item, idx) => ({item, idx}))
            .filter(({item}) => {
                if (!needle) return true;
                return String(item.name || '').toLocaleLowerCase('ru-RU').includes(needle)
                    || String(item.query || '').toLocaleLowerCase('ru-RU').includes(needle);
            });

        const visibleQueryIds = () => visibleQueries.map(({item}) => item.id);
        const visibleSelectedCount = visibleQueryIds().filter(id => savedQuerySelectedIds.has(id)).length;
        if (visibleSelectedCount) {
            bulkDeleteBtn.style.display = 'inline-block';
            bulkDeleteBtn.textContent = `🗑 Удалить (${visibleSelectedCount})`;
        }
        if (visibleQueries.length) {
            selectAllBtn.style.display = 'inline-block';
            const allSelected = visibleQueries.every(({item}) => savedQuerySelectedIds.has(item.id));
            selectAllBtn.textContent = allSelected ? '☒' : '☑';
            selectAllBtn.title = allSelected ? 'Снять выделение со всех видимых' : 'Выбрать все видимые';
        }

        if (!visibleQueries.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Ничего не найдено.';
            empty.style.cssText = 'padding:12px 8px;color:#999;line-height:1.4;';
            savedQueriesMenu.appendChild(empty);
            return;
        }

        visibleQueries.forEach(({item, idx}) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 5px;border-radius:6px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = savedQuerySelectedIds.has(item.id);
            cb.title = 'Выбрать запрос';
            cb.style.cssText = 'flex:0 0 auto;margin:0 2px 0 0;cursor:pointer;';
            cb.addEventListener('click', e => e.stopPropagation());
            cb.addEventListener('change', () => {
                if (cb.checked) savedQuerySelectedIds.add(item.id); else savedQuerySelectedIds.delete(item.id);
                renderSavedQueriesMenu(); positionSavedQueriesMenu();
            });
            row.onmouseenter = () => row.style.background = '#f6f8fa';
            row.onmouseleave = () => row.style.background = '';
            const main = document.createElement('button');
            main.type = 'button'; main.title = item.query; main.textContent = item.name;
            main.style.cssText = 'flex:1;min-width:0;text-align:left;border:0;background:none;padding:2px;cursor:pointer;font-size:11px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            main.onclick = () => {
                dependencies.searchInput.value = item.query;
                dependencies.searchInput.dispatchEvent(new Event('input', {bubbles:true}));
                dependencies.searchInput.focus();
                savedQueriesMenu.style.display = 'none';
            };
            const edit = document.createElement('button');
            edit.type = 'button'; edit.textContent = '✎'; edit.title = 'Редактировать запрос';
            edit.style.cssText = 'border:0;background:none;cursor:pointer;color:#888;padding:3px 4px;font-size:12px;';
            edit.onclick = () => {
                showSavedQueryDialog({
                    item,
                    onSave: ({name, query}) => {
                        const duplicate = savedSearchQueries.findIndex(x => x.id !== item.id && x.name.toLowerCase() === name.toLowerCase());
                        if (duplicate >= 0) { dependencies.showNotification('Запрос с таким названием уже существует','warning'); return; }
                        item.name=name; item.query=query;
                        chrome.storage.local.set({savedSearchQueries});
                        renderSavedQueriesMenu(); positionSavedQueriesMenu();
                    }
                });
            };
            const del = document.createElement('button');
            del.type = 'button'; del.textContent = '×'; del.title = 'Удалить';
            del.style.cssText = 'border:0;background:none;cursor:pointer;color:#b44;padding:3px 4px;font-size:15px;';
            del.onclick = () => {
                savedQuerySelectedIds.delete(item.id);
                savedSearchQueries.splice(idx, 1);
                chrome.storage.local.set({savedSearchQueries});
                renderSavedQueriesMenu(); positionSavedQueriesMenu();
            };
            row.append(cb, main, edit, del); savedQueriesMenu.appendChild(row);
        });
    }

    savedQueriesBtn.onclick = (e) => {
        e.stopPropagation();
        const open = savedQueriesMenu.style.display === 'block';
        if (open) { savedQueriesMenu.style.display = 'none'; return; }
        renderSavedQueriesMenu();
        savedQueriesMenu.style.display = 'block';
        positionSavedQueriesMenu();
    };
    const onOutsideMouseDown = e => {
        if (savedQueriesMenu.style.display === 'block' && !savedQueriesMenu.contains(e.target) && e.target !== savedQueriesBtn) savedQueriesMenu.style.display = 'none';
    };
    const onWindowResize = () => { if (savedQueriesMenu.style.display === 'block') positionSavedQueriesMenu(); };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    window.addEventListener('resize', onWindowResize);
    chrome.storage.local.get(['savedSearchQueries'], d => {
        if (Array.isArray(d.savedSearchQueries)) {
            savedSearchQueries = d.savedSearchQueries.filter(x => x && typeof x.name === 'string' && typeof x.query === 'string').slice(0, 100);
            savedQuerySelectedIds.clear();
        }
    });
    dependencies.searchRow.appendChild(savedQueriesBtn);

    return {
        destroy() {
            savedQueriesMenu.remove();
            document.removeEventListener('mousedown', onOutsideMouseDown, true);
            window.removeEventListener('resize', onWindowResize);
        }
    };
}

