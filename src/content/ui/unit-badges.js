// Предпочтения и оформление бейджей цены за единицу.
// Загрузка предпочтений вызывается из content.js в прежнем порядке.
let ppgBadgeVisible = true;
let ppgBadgePosition = 'top-left';
let ppgBadgeMode = 'all'; // all = все уникальные варианты, current = только выбранная приоритетная величина
// Какая единица показывается в цене за ед. для каждой категории (кг vs г, л vs мл, мм/см/м…).
// Значения по умолчанию сохраняют прежнее поведение (крупная единица: кг/л/шт/м).
let badgeDisplayUnit = { weight: 'кг', volume: 'л', pieces: 'шт', length: 'м' };
const PPG_BADGE_POSITIONS = {
    'top-left':    { top: '8px', bottom: 'auto', left: '8px', right: 'auto' },
    'top-right':   { top: '8px', bottom: 'auto', left: 'auto', right: '8px' },
    'bottom-left': { top: 'auto', bottom: '8px', left: '8px', right: 'auto' },
    'bottom-right':{ top: 'auto', bottom: '8px', left: 'auto', right: '8px' },
};

function loadBadgePreferences() {
    chrome.storage.local.get(['ppgBadgeVisible', 'ppgBadgePosition', 'ppgBadgeMode', 'badgeDisplayUnit'], d => {
        ppgBadgeVisible = d.ppgBadgeVisible !== false;
        if (PPG_BADGE_POSITIONS[d.ppgBadgePosition]) ppgBadgePosition = d.ppgBadgePosition;
        if (d.ppgBadgeMode === 'current' || d.ppgBadgeMode === 'all') ppgBadgeMode = d.ppgBadgeMode;
        if (d.badgeDisplayUnit && typeof d.badgeDisplayUnit === 'object') {
            badgeDisplayUnit = { ...badgeDisplayUnit, ...d.badgeDisplayUnit };
        }
    });
}

// Список единиц, между которыми можно переключаться для категории — все слова,
// заданные в настройках единиц (units.json / настройки → единицы измерения),
// без схлопывания «одинаковых» по множителю. Так пользователь может выбрать
// ровно то обозначение, которое хочет (например «таблетка» вместо «шт»),
// а не то, что система сочла «главным».
function getCategoryUnitChoices(category) {
    const cat = UNITS?.[category];
    if (!cat) return [];
    return Object.entries(cat.units || {})
        .map(([unit, entry]) => ({
            unit,
            multiplier: (entry && typeof entry === 'object') ? Number(entry.multiplier) || 1 : Number(entry) || 1,
        }))
        .sort((a, b) => a.multiplier - b.multiplier || a.unit.localeCompare(b.unit, 'ru'));
}

function applyPpgBadgeSettings(badge) {
    if (!badge) return;
    const pos = PPG_BADGE_POSITIONS[ppgBadgePosition] || PPG_BADGE_POSITIONS['top-left'];
    badge.style.display = ppgBadgeVisible ? 'block' : 'none';
    badge.style.top = pos.top;
    badge.style.bottom = pos.bottom;
    badge.style.left = pos.left;
    badge.style.right = pos.right;
}

function updateAllPpgBadges() {
    document.querySelectorAll('#products-sorted-popup .ppg-badge').forEach(applyPpgBadgeSettings);
}
