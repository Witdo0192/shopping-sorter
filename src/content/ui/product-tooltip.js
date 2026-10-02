// Подсказки карточек.
// dependencies связывает эту часть с состоянием и действиями панели.
function createProductTooltip(dependencies) {
    const tileTooltip = document.createElement('div');
    tileTooltip.style.cssText = 'display:none;position:fixed;z-index:100001;'
        + 'background:rgba(0,0,0,0.85);color:white;'
        + 'padding:6px 10px;border-radius:6px;'
        + 'font-size:12px;line-height:1.4;max-width:300px;'
        + 'pointer-events:none;white-space:normal;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);'
        + 'will-change:transform;'; // подсказка GPU что элемент будет двигаться
    // Используем transform вместо left/top — не вызывает layout reflow
    tileTooltip.style.top = '0';
    tileTooltip.style.left = '0';
    document.body.appendChild(tileTooltip);

    // Кешируем DOM-узлы тултипа чтобы не пересоздавать innerHTML
    const _ttTitle = document.createElement('div');
    _ttTitle.style.marginBottom = '4px';
    const _ttStatus = document.createElement('span');
    tileTooltip.appendChild(_ttTitle);
    tileTooltip.appendChild(_ttStatus);

    let tooltipTimer = null;
    let _ttCurrentEl = null; // элемент над которым сейчас тултип
    let _ttMouseX = 0, _ttMouseY = 0; // последние координаты мыши
    let _ttRafId = null; // requestAnimationFrame id для позиционирования

    function _ttPosition() {
        // transform не вызывает reflow — в отличие от left/top
        const x = _ttMouseX + 14;
        const y = _ttMouseY + 14;
        // не выходим за правый/нижний край экрана
        const maxX = window.innerWidth - tileTooltip.offsetWidth - 4;
        const maxY = window.innerHeight - tileTooltip.offsetHeight - 4;
        tileTooltip.style.transform = `translate(${Math.min(x, maxX)}px, ${Math.min(y, maxY)}px)`;
        _ttRafId = null;
    }

    function _ttShow(el, title, statusHtml) {
        _ttTitle.style.display = title ? '' : 'none';
        if (title) _ttTitle.textContent = title;
        _ttStatus.innerHTML = statusHtml;
        tileTooltip.style.display = 'block';
        // Позиционируем сразу (offsetWidth нужен после display:block)
        requestAnimationFrame(_ttPosition);
    }

    function _ttHide() {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
        _ttCurrentEl = null;
        tileTooltip.style.display = 'none';
    }

    // Единый mousemove-обработчик через rAF — не дёргаем DOM на каждый пиксель
    function _onMouseMove(e) {
        _ttMouseX = e.clientX;
        _ttMouseY = e.clientY;
        if (tileTooltip.style.display !== 'none' && !_ttRafId) {
            _ttRafId = requestAnimationFrame(_ttPosition);
        }
    }

    // Проверка "сохранён ли" только по key — O(1) через Set, без итерации
    function _isSaved(key) { return key ? savedKeysCache.has(key) : false; }
    function _isInSearch(key) { return key ? seenTiles.has(key) : false; }

    // productsContainer — делегирование через mouseover + mouseleave
    dependencies.productsContainer.addEventListener('mouseover', (e) => {
        if (!dependencies.hoverTooltipEnabled) return; // подсказка отключена — не тратим время на closest()/таймер
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return; // уже над этим элементом — ничего не делаем
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.tileKey;
            const status = _isSaved(key)
                ? '<span style="color:#81c784">🔖 Сохранён</span>'
                : '<span style="color:#ef9a9a">🔖 Не сохранён</span>';
            _ttShow(tooltipEl, title, status);
        }, 300); // увеличили задержку с 100 до 300мс — меньше лишних показов при быстром движении
    });

    dependencies.productsContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    dependencies.productsContainer.addEventListener('mousemove', _onMouseMove);

    // savedContainer — аналогично
    dependencies.savedContainer.addEventListener('mouseover', (e) => {
        if (!dependencies.hoverTooltipEnabled) return;
        const tooltipEl = e.target.closest('[data-tooltip]');
        if (tooltipEl === _ttCurrentEl) return;
        _ttHide();
        if (!tooltipEl) return;
        _ttCurrentEl = tooltipEl;
        tooltipTimer = setTimeout(() => {
            const title = tooltipEl.getAttribute('data-tooltip') || '';
            const key = tooltipEl.dataset.savedKey;
            const status = _isInSearch(key)
                ? '<span style="color:#81c784">🔍 Есть в поиске</span>'
                : '<span style="color:#ef9a9a">🔍 Нет в поиске</span>';
            _ttShow(tooltipEl, title, status);
        }, 300);
    });

    dependencies.savedContainer.addEventListener('mouseleave', () => { _ttHide(); }, true);
    dependencies.savedContainer.addEventListener('mousemove', _onMouseMove);

    // ─── Фильтрация и сортировка ───────────────────────────────────────────────

    // @сортировка(поле, направление) — специальная часть DSL, не участвующая в фильтрации.
    // Поддерживаются: возр/убыв, asc/desc, а-я/я-а и старые ↑/↓ как алиасы.
    // Правила сортировки: src/content/products/sorting.js

    return { _ttHide, tileTooltip,
        destroy() {
            _ttHide();
            if (_ttRafId) cancelAnimationFrame(_ttRafId);
            tileTooltip.remove();
        }
    };
}
