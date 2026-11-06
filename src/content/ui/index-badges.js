// Плашка с номером карточки в исходной выдаче магазина: предпочтения, создание, обновление, меню настроек.
// Номер хранит products/collection.js (getTileOriginIndex); здесь только отображение.
// Загрузка предпочтений вызывается из content.js рядом с loadBadgePreferences().
let indexBadgeVisible = false;
let indexBadgePosition = 'bottom-left';
const INDEX_BADGE_POSITIONS = {
    'top-left':    { top: '6px', bottom: 'auto', left: '6px', right: 'auto' },
    'top-right':   { top: '6px', bottom: 'auto', left: 'auto', right: '6px' },
    'bottom-left': { top: 'auto', bottom: '6px', left: '6px', right: 'auto' },
    'bottom-right':{ top: 'auto', bottom: '6px', left: 'auto', right: '6px' },
};

function loadIndexBadgePreferences() {
    chrome.storage.local.get(['indexBadgeVisible', 'indexBadgePosition'], d => {
        indexBadgeVisible = d.indexBadgeVisible === true;
        if (INDEX_BADGE_POSITIONS[d.indexBadgePosition]) indexBadgePosition = d.indexBadgePosition;
    });
}

function applyIndexBadgeSettings(badge) {
    if (!badge) return;
    const pos = INDEX_BADGE_POSITIONS[indexBadgePosition] || INDEX_BADGE_POSITIONS['bottom-left'];
    badge.style.display = indexBadgeVisible ? 'block' : 'none';
    badge.style.top = pos.top;
    badge.style.bottom = pos.bottom;
    badge.style.left = pos.left;
    badge.style.right = pos.right;
}

// Возвращает null, если номера нет (карточка без ключа или добавлена не из выдачи).
function createIndexBadge(index) {
    if (!Number.isInteger(index) || index < 1) return null;
    const badge = document.createElement('div');
    badge.className = 'ss-index-badge';
    badge.textContent = '#' + index;
    badge.title = 'Номер в исходной выдаче на странице магазина';
    applyIndexBadgeSettings(badge);
    return badge;
}

function updateAllIndexBadges() {
    document.querySelectorAll('#products-sorted-popup .ss-index-badge').forEach(applyIndexBadgeSettings);
}

// Раздел «№ в выдаче» в меню 🏷️ (panel-tools.js). Изменения применяются сразу, без перерисовки списка.
function appendIndexBadgeSettings(menu) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #eee;';
    const title = document.createElement('div');
    title.textContent = '🔢 Номер в выдаче';
    title.style.cssText = 'font-weight:700;margin-bottom:8px;';
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:6px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = indexBadgeVisible;
    cb.onchange = () => { indexBadgeVisible = cb.checked; chrome.storage.local.set({ indexBadgeVisible }); updateAllIndexBadges(); };
    row.append(cb, document.createTextNode('Показывать на карточках'));
    const hint = document.createElement('div');
    hint.textContent = 'Порядок первого появления карточки на странице магазина.';
    hint.style.cssText = 'font-size:9.5px;color:#999;line-height:1.3;margin-bottom:8px;';
    const posLabel = document.createElement('div');
    posLabel.textContent = 'Угол карточки:';
    posLabel.style.cssText = 'font-size:11px;color:#777;margin-bottom:5px;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;';
    const paint = btn => {
        const active = btn.dataset.indexPos === indexBadgePosition;
        btn.style.borderColor = active ? '#2196F3' : '#ddd';
        btn.style.background = active ? '#eef6ff' : '#fff';
    };
    [['top-left', '↖'], ['top-right', '↗'], ['bottom-left', '↙'], ['bottom-right', '↘']].forEach(([pos, icon]) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = icon; btn.title = pos; btn.dataset.indexPos = pos;
        btn.style.cssText = 'padding:6px;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:16px;';
        btn.onclick = () => {
            indexBadgePosition = pos;
            chrome.storage.local.set({ indexBadgePosition });
            updateAllIndexBadges();
            grid.querySelectorAll('[data-index-pos]').forEach(paint);
        };
        paint(btn);
        grid.appendChild(btn);
    });
    section.append(title, row, hint, posLabel, grid);
    menu.appendChild(section);
}
