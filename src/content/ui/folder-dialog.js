// Получение папок и диалог выбора папки при сохранении.
// Точка входа showSaveFolderDialog принимает подтверждение через callback.

async function getAllFoldersGlobal() {
    const tiles = await getSavedTiles();
    const set = new Set();
    tiles.forEach(t => (t.folders || []).forEach(f => set.add(f)));
    return [...set].sort();
}

function showSaveFolderDialog(anchorBtn, existingFolders, onConfirm) {
    document.querySelector('.ss-save-folder-dialog')?.remove();

    const dialog = document.createElement('div');
    dialog.className = 'ss-save-folder-dialog';
    dialog.style.cssText = `
        position:fixed; z-index:100050;
        background:#fff; border:1px solid #ddd; border-radius:10px;
        padding:14px; min-width:240px; max-width:300px;
        box-shadow:0 4px 20px rgba(0,0,0,0.18); font-family:sans-serif;
    `;

    const chosen = new Set();

    const title = document.createElement('div');
    title.textContent = '📁 Сохранить в папку';
    title.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:10px; color:#333;';
    dialog.appendChild(title);

    // поиск — показываем только если папок много, иначе не мешаем
    let searchInput = null;
    if (existingFolders.length > 6) {
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 Поиск папки...';
        searchInput.style.cssText = 'width:100%; padding:6px 9px; border:1px solid #ddd; border-radius:6px; font-size:12px; outline:none; margin-bottom:8px; box-sizing:border-box;';
        dialog.appendChild(searchInput);
    }

    // прокручиваемый список папок
    const list = document.createElement('div');
    list.style.cssText = 'max-height:240px; overflow-y:auto; display:flex; flex-direction:column;';
    dialog.appendChild(list);

    function addFolderRow(name, checked = false) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 2px; cursor:pointer; font-size:13px;';
        row.dataset.folderName = name.toLowerCase();
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.style.cursor = 'pointer';
        if (checked) chosen.add(name);
        cb.addEventListener('change', () => cb.checked ? chosen.add(name) : chosen.delete(name));
        row.appendChild(cb);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        nameSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        row.appendChild(nameSpan);
        list.appendChild(row);
        return row;
    }

    // существующие папки
    existingFolders.forEach(f => addFolderRow(f));

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            [...list.children].forEach(row => {
                row.style.display = !q || row.dataset.folderName.includes(q) ? '' : 'none';
            });
        });
    }

    // новая папка
    const newRow = document.createElement('div');
    newRow.style.cssText = 'display:flex; gap:6px; margin-top:8px;';
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.placeholder = 'Новая папка...';
    newInput.style.cssText = 'flex:1; padding:4px 8px; border:1px solid #ccc; border-radius:6px; font-size:12px;';
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.style.cssText = 'padding:4px 8px; background:#2196F3; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;';
    addBtn.addEventListener('click', () => {
        const name = newInput.value.trim();
        if (!name || existingFolders.includes(name)) { newInput.focus(); return; }
        existingFolders.push(name);
        addFolderRow(name, true);
        if (searchInput) searchInput.value = '';
        [...list.children].forEach(row => row.style.display = '');
        newInput.value = '';
        list.scrollTop = list.scrollHeight;
    });
    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    newRow.appendChild(newInput);
    newRow.appendChild(addBtn);
    dialog.appendChild(newRow);

    // кнопки
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; margin-top:12px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '🔖 Сохранить';
    saveBtn.style.cssText = 'flex:1; padding:6px; background:#4CAF50; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px; font-weight:bold;';
    saveBtn.addEventListener('click', () => {
        dialog.remove();
        onConfirm([...chosen]);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    cancelBtn.style.cssText = 'padding:6px 10px; background:#f5f5f5; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:12px;';
    cancelBtn.addEventListener('click', () => dialog.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    // позиционирование
    document.body.appendChild(dialog);
    if (searchInput) searchInput.focus();
    const rect = anchorBtn.getBoundingClientRect();
    const dw = dialog.offsetWidth, dh = dialog.offsetHeight;
    let top = rect.bottom + 6, left = rect.left;
    if (left + dw > window.innerWidth - 10) left = window.innerWidth - dw - 10;
    if (top + dh > window.innerHeight - 10) top = rect.top - dh - 6;
    if (top < 10) top = 10;
    dialog.style.top = top + 'px';
    dialog.style.left = left + 'px';

    // закрытие по клику вне
    setTimeout(() => {
        const close = e => { if (!dialog.contains(e.target) && e.target !== anchorBtn) { dialog.remove(); document.removeEventListener('mousedown', close); } };
        document.addEventListener('mousedown', close);
    }, 0);
}

// src/content/images/similarity.js

// src/content/selectors/picker.js
