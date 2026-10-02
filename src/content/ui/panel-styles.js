// Создание и подключение стилей панели; возвращает узел для удаления при закрытии.

function createProductsPanelStyle() {
    const style = document.createElement('style');
    style.id = 'shopper-sorter-style';
    style.textContent = `
        @keyframes slideIn {
            from { opacity: 0; transform: scale(0.8) translateY(-50px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        #products-sorted-popup > .ss-cards-host {
            flex: 1 1 auto !important;
            min-height: 0 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
        }
        #products-sorted-popup > .ss-ui-host,
        #products-sorted-popup > .ss-ui-bottom-host {
            flex: 0 0 auto !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
        }
        #products-sorted-popup .products-grid {
            flex: 1;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            padding: 20px !important;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 15px !important;
            align-items: start;
            scrollbar-width: thin;
            scrollbar-color: #ccc transparent;
            contain: layout style;
        }
        #products-sorted-popup .products-grid::-webkit-scrollbar { width: 8px; }
        #products-sorted-popup .products-grid::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
        #products-sorted-popup .products-grid::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
        #products-sorted-popup .tile-root {
            width: 100% !important; max-width: none !important;
            margin: 0 !important; transform: none !important;
        }
        #products-sorted-popup .tile-root img {
            width: 100% !important; height: auto !important; object-fit: cover;
        }
        #products-sorted-popup .ppg-badge {
            position: absolute; top: 8px; left: 8px; z-index: 10;
            background: rgba(0,0,0,0.75); color: white;
            padding: 3px 6px; border-radius: 4px;
            font-size: 11px; line-height: 1.25; font-weight: bold; font-family: sans-serif;
            pointer-events: none;
            box-sizing: border-box;
            width: min(92%, 220px);
            max-width: min(92%, 220px);
            max-height: 56px;
            overflow: hidden;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        #products-sorted-popup .ppg-badge span {
            display: block;
            margin-top: 2px;
            line-height: 1.2;
            white-space: normal;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #products-sorted-popup .ppg-debug {
            display: none;
            position: absolute; top: 8px; right: 8px; z-index: 10;
            background: rgba(0,0,0,0.75); color: white;
            padding: 3px 7px; border-radius: 4px;
            font-size: 11px; font-weight: bold; font-family: sans-serif;
            pointer-events: none;
        }
        #products-sorted-popup .ss-tile {
            display: flex; flex-direction: column;
            border-radius: 10px;
            background: #fff; border: 1px solid #eee;
            box-shadow: 0 1px 4px rgba(0,0,0,0.07);
            font-family: sans-serif;
            position: relative;
        }
        #products-sorted-popup .products-grid.saved-grid {
        }
        #products-sorted-popup .products-grid.saved-grid > div {
            display: flex; flex-direction: column;
        }
        #products-sorted-popup .products-grid.saved-grid > div > .ss-tile {
            flex: 1;
        }
        #products-sorted-popup .ss-tile__img-wrap {
            width: 100%; height: var(--tile-img-height, 160px); overflow: hidden; flex-shrink: 0;
            background: #f5f5f5; display: flex; align-items: center; justify-content: center;
            border-radius: 10px 10px 0 0;
        }
        #products-sorted-popup .ss-tile__img-wrap img {
            width: 100%; height: 100%; object-fit: contain;
        }
        #products-sorted-popup .ss-tile__no-img {
            font-size: 48px; opacity: 0.3;
        }
        #products-sorted-popup .ss-tile__body {
            padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; flex: 1;
        }
        #products-sorted-popup .ss-tile__title {
            font-size: calc(12px * var(--tile-font-scale, 1)); color: #333; line-height: 1.4;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
        #products-sorted-popup .ss-tile__price {
            font-size: calc(14px * var(--tile-font-scale, 1)); font-weight: bold; color: #e31; margin-top: auto;
        }
        #products-sorted-popup .ss-tile__rating {
            font-size: calc(11px * var(--tile-font-scale, 1)); color: #666;
        }
        #products-sorted-popup .ss-tile__delivery {
            font-size: calc(11px * var(--tile-font-scale, 1)); color: #2e7d32;
        }
        #products-sorted-popup .ss-tile__site {
            font-size: calc(10px * var(--tile-font-scale, 1)); color: #aaa; margin-top: 2px;
        }
        /* Корень карточки сайта — отдельный item сетки расширения. Его
           внутренний дизайн остаётся полностью сайту, но grid/width/float
           самого корня не должны ломать сетку Shopping Sorter. */
        #products-sorted-popup .ss-site-card-clone {
            display: block !important;
            position: relative !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            float: none !important;
            clear: none !important;
            grid-column: auto !important;
            grid-row: auto !important;
            grid-area: auto !important;
            justify-self: stretch !important;
            align-self: stretch !important;
            box-sizing: border-box !important;
        }
        #products-sorted-popup .ss-site-card-clone > * { max-width: 100%; }

        #products-sorted-popup .ss-tile--search-custom {
            width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box;
            overflow: hidden;
            position: relative !important;
            display: flex !important;
            flex-direction: column !important;
            align-self: stretch !important;
            justify-self: stretch !important;
            grid-column: auto !important;
            grid-row: auto !important;
        }
        /* Сетка поиска расширения не должна зависеть от размеров карточки/стилей сайта. */
        #products-sorted-popup .products-grid:not(.saved-grid) {
            grid-auto-rows: max-content;
            align-items: start !important;
            grid-auto-flow: row;
        }
        #products-sorted-popup .products-grid:not(.saved-grid) > .ss-search-tile-wrap {
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            align-self: start !important;
            justify-self: stretch !important;
            box-sizing: border-box !important;
            position: relative !important;
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap {
            height: var(--tile-img-height, 160px);
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap a {
            width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        }
        #products-sorted-popup .ss-tile--search-custom .ss-tile__img-wrap img {
            width: 100%; height: 100%; object-fit: contain;
        }

        /* Custom-style cards are extension-owned.  Do not let broad site rules
           (button/div/a/img/font/color/box-sizing resets) leak into them. */
        #products-sorted-popup .ss-tile--search-custom {
            box-sizing: border-box !important;
            font-family: sans-serif !important;
            color: #333 !important;
            background: #fff !important;
        }
        #products-sorted-popup .ss-tile--search-custom *,
        #products-sorted-popup .ss-tile--search-custom *::before,
        #products-sorted-popup .ss-tile--search-custom *::after {
            box-sizing: border-box;
        }
        #products-sorted-popup .ss-tile--search-custom a {
            font-family: inherit !important;
        }
    `;
    //     style.textContent += `
    //     #products-sorted-popup ${SELECTORS.link} {
    //         pointer-events: none !important;
    //     }
    // `;
    document.head.appendChild(style);
    return style;
}
