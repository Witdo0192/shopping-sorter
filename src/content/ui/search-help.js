// Подсказка синтаксиса поиска.
// dependencies связывает эту часть с состоянием и действиями панели.
function createSearchHelp(dependencies) {
    const hint = document.createElement('span');
    hint.textContent = '?';
    hint.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%;
        background: #6c757d; color: white;
        font-size: 12px; font-weight: bold;
        cursor: help; flex-shrink: 0; user-select: none;
        position: relative;
    `;

    const searchTooltip = document.createElement('div');
    searchTooltip.style.cssText = `
        display: none; position: absolute; top: calc(100% + 8px); right: 0;
        background: #333; color: white; padding: 10px 14px;
        border-radius: 8px; font-size: 12px; line-height: 1.6;
        white-space: pre; z-index: 100000;
        max-width: min(620px, calc(100vw - 32px));
        max-height: min(70vh, 620px);
        overflow: auto;
        box-sizing: border-box;
        scrollbar-width: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    `;
    searchTooltip.textContent = `Спецсимволы:
  *  — любое кол-во символов     farm* → farmina, farmland
  ?  — ровно один символ         кошк? → кошка, кошки
  [аб] — один из символов         к[ио]т → кот, кит
  {N...M} — число в диапазоне     {0.5...2} → «корм 1 кг», «500г»
       Также: {1-2}, {1..2}, {1 до 2}
  !слово — исключить слово         !собак*
  "фраза" — точное словосочетание
  !"фраза" — исключить фразу
  (a|b|c) — OR: одно из нескольких
  !(a|b|c) — исключить группу

Дополнительные атрибуты:
  @имя(запрос) — фильтр только по указанному атрибуту
  @бренд(apple)
  @цвет("тёмно синий")
  @вес({1-2})
  @бренд(!apple !samsung (xiaomi|honor) обязательно)
  @атрибут() — атрибут присутствует
  @атрибут(!) — атрибут отсутствует
  @атрибут(!запрос) — атрибут не содержит запрос

Основные атрибуты (альтернатива отдельным полям):
  @название(корм*)
  @цена({500-1000})
  @цена/ед.({100-300})
  @рейтинг({4-5})
  @отзывы({1000-100000})
  @доставка(30.08) — доставка в эту дату
  @доставка(30.08.2026) — дата с годом
  @доставка({28.08-05.09}) — диапазон дат (текущий год)
  @доставка({28.08-05.09.2026}) — диапазон с годом (год без {} — тоже работает)
  @доставка({28.08-*}) / @доставка({*-05.09}) — открытая граница диапазона
  @доставка({28.08-01.09}|{10.09-15.09}) — несколько диапазонов сразу (ИЛИ)
  @доставка(!28.08-05.09.2026) — доставка НЕ в этом диапазоне
  Для них работают () и (!): @цена() / @цена(!)
  И отрицание значения: @цена(!1000)
  • область атрибута всегда ограничена скобками: @имя(...)
  • ! внутри скобок исключает значение только для этого атрибута
  • @атрибут(...) можно сочетать с названием и другими атрибутами

Гибкие фразы:
  "({1-2} кг|{1000-2000} (гр|грамм|г))"
  • внутри кавычек можно использовать (), | и диапазоны
  • пробелы внутри гибкой фразы необязательны: «1 кг» и «1кг»
  • ~ — явное обозначение необязательного пробела: «1~кг»
  • диапазон проверяется по найденному числу, а не только по тексту

Как работает поиск:
  • отдельные условия разделяются пробелами
  • все условия должны выполняться (AND)
  • порядок слов не важен (кроме фраз)
  • регистр не важен
  • ! перед условием исключает совпадения

Примеры:
  farm* !собак*
  к[ио]т {0.4...1.5}кг
  "корм для кошек" !("сухой"|"гранулы")
  iphone @бренд(hill*|royal*) @вес({0.4-1.5})
  !"({1-2} кг|{1000-2000} (гр|грамм|г))"`;

    hint.appendChild(searchTooltip);
    let searchTooltipHideTimer = null;
    const showSearchTooltip = () => {
        if (searchTooltipHideTimer) { clearTimeout(searchTooltipHideTimer); searchTooltipHideTimer = null; }
        searchTooltip.style.display = 'block';
    };
    const scheduleHideSearchTooltip = () => {
        if (searchTooltipHideTimer) clearTimeout(searchTooltipHideTimer);
        searchTooltipHideTimer = setTimeout(() => {
            searchTooltip.style.display = 'none';
            searchTooltipHideTimer = null;
        }, 300);
    };
    hint.addEventListener('mouseenter', showSearchTooltip);
    hint.addEventListener('mouseleave', scheduleHideSearchTooltip);
    searchTooltip.addEventListener('mouseenter', showSearchTooltip);
    searchTooltip.addEventListener('mouseleave', scheduleHideSearchTooltip);

    return { hint, destroy() { clearTimeout(searchTooltipHideTimer); } };
}
