// Календарь владеет настройками, выбором дат, DOM и обработчиками. dependencies предоставляет актуальное состояние панели.
function createDeliveryCalendar(dependencies) {
    let deliveryCalendarAutoRefresh = true;
    let deliveryCalendarMode = 'both'; // legacy compatibility
    let deliveryCalendarAttributes = {price:true, perunit:true};
    let deliveryCalendarScope = 'filtered'; // 'filtered' | 'all'
    let deliveryCalendarExcludeZeroUnit = false;
    let deliveryCalendarSelectedDates = new Set();
    let deliveryCalendarAnchorKey = null;
    let deliveryCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let deliveryCalendarOpen = false;
    let deliveryCalendarRefreshTimer = null;
    let deliveryCalendarDirty = true;
    let deliveryCalendarButton = null;
    let deliveryCalendarPopover = null;
    let deliveryCalendarResizeObserver = null;
    let deliveryCalendarWindowHandler = null;
    let deliveryCalendarMenuClickHandler = null;
    let deliveryCalendarPositions = {
        grid:{left:null,top:null,width:null,height:null},
        horizontal:{left:null,top:null,width:null,height:null},
        vertical:{left:null,top:null,width:null,height:null}
    };
    let deliveryCalendarCellSizes = {grid:105,horizontal:105,vertical:105};
    let deliveryCalendarFontSizes = {grid:12,horizontal:12,vertical:12};
    function getCalendarFontSize(){ return Number(deliveryCalendarFontSizes[deliveryCalendarLayout]) || 12; }
    let deliveryCalendarLayout = 'grid';

    function getCalendarLayoutPosition(){
        if (!deliveryCalendarPositions[deliveryCalendarLayout]) deliveryCalendarPositions[deliveryCalendarLayout]={left:null,top:null,width:null,height:null};
        return deliveryCalendarPositions[deliveryCalendarLayout];
    }
    function getCalendarCellSize(){ return Number(deliveryCalendarCellSizes[deliveryCalendarLayout]) || 105; }
    let deliveryCalendarRibbonScroll = { left:0, top:0, layout:null };
    let deliveryCalendarContentScrollTop = 0;

    chrome.storage.local.get(['deliveryCalendarAutoRefresh', 'deliveryCalendarScope', 'deliveryCalendarMode', 'deliveryCalendarAttributes', 'deliveryCalendarExcludeZeroUnit', 'deliveryCalendarPositions', 'deliveryCalendarPosition', 'deliveryCalendarCellSizes', 'deliveryCalendarCellSize', 'deliveryCalendarFontSizes', 'deliveryCalendarFontSize', 'deliveryCalendarLayout'], d => {
        deliveryCalendarAutoRefresh = d.deliveryCalendarAutoRefresh !== false;
        deliveryCalendarMode = ['price','unit','both'].includes(d.deliveryCalendarMode) ? d.deliveryCalendarMode : 'both';
        if (d.deliveryCalendarAttributes && typeof d.deliveryCalendarAttributes === 'object') {
            deliveryCalendarAttributes = {...d.deliveryCalendarAttributes};
        } else {
            deliveryCalendarAttributes = {price: deliveryCalendarMode !== 'unit', perunit: deliveryCalendarMode !== 'price'};
        }
        if (!('price' in deliveryCalendarAttributes)) deliveryCalendarAttributes.price = true;
        if (!('perunit' in deliveryCalendarAttributes)) deliveryCalendarAttributes.perunit = true;
        deliveryCalendarScope = d.deliveryCalendarScope === 'all' ? 'all' : 'filtered';
        deliveryCalendarExcludeZeroUnit = d.deliveryCalendarExcludeZeroUnit === true;
        if (d.deliveryCalendarPositions && typeof d.deliveryCalendarPositions === 'object') deliveryCalendarPositions = {...deliveryCalendarPositions,...d.deliveryCalendarPositions};
        if (d.deliveryCalendarPosition && typeof d.deliveryCalendarPosition === 'object') deliveryCalendarPositions.grid = {...deliveryCalendarPositions.grid,...d.deliveryCalendarPosition};
        const legacyCell = ['compact','normal','large'].includes(d.deliveryCalendarCellSize) ? (d.deliveryCalendarCellSize === 'compact' ? 80 : d.deliveryCalendarCellSize === 'large' ? 140 : 105) : Number(d.deliveryCalendarCellSize);
        if (d.deliveryCalendarCellSizes && typeof d.deliveryCalendarCellSizes === 'object') deliveryCalendarCellSizes = {...deliveryCalendarCellSizes,...d.deliveryCalendarCellSizes};
        if (Number.isFinite(legacyCell)) deliveryCalendarCellSizes.grid = Math.min(180,Math.max(60,legacyCell));
        for (const k of ['grid','horizontal','vertical']) deliveryCalendarCellSizes[k] = Number.isFinite(Number(deliveryCalendarCellSizes[k])) ? Math.min(180,Math.max(60,Number(deliveryCalendarCellSizes[k]))) : 105;
        const hasPerLayoutFonts = d.deliveryCalendarFontSizes && typeof d.deliveryCalendarFontSizes === 'object';
        if (hasPerLayoutFonts) deliveryCalendarFontSizes = {...deliveryCalendarFontSizes,...d.deliveryCalendarFontSizes};
        const legacyFont = Number(d.deliveryCalendarFontSize);
        // Старый единый параметр используем только как миграцию, если новых
        // раздельных настроек ещё нет. Иначе он не должен затирать значения
        // для grid / horizontal / vertical при каждом запуске.
        if (!hasPerLayoutFonts && Number.isFinite(legacyFont)) deliveryCalendarFontSizes = {grid:legacyFont,horizontal:legacyFont,vertical:legacyFont};
        for (const k of ['grid','horizontal','vertical']) deliveryCalendarFontSizes[k] = Number.isFinite(Number(deliveryCalendarFontSizes[k])) ? Math.min(20,Math.max(8,Number(deliveryCalendarFontSizes[k]))) : 12;
        deliveryCalendarLayout = ['grid','horizontal','vertical'].includes(d.deliveryCalendarLayout) ? d.deliveryCalendarLayout : 'grid';
        // Восстанавливаем не только переменную, но и уже созданные элементы меню.
        if (typeof layoutSelect !== 'undefined' && layoutSelect) layoutSelect.value = deliveryCalendarLayout;
        if (typeof syncSizeControl === 'function') syncSizeControl();
        if (typeof syncFontControl === 'function') syncFontControl();
        updateDeliveryCalendarButton();
        if (deliveryCalendarOpen) renderDeliveryCalendar();
    });

    function getDeliveryCalendarTiles() {
        // В режиме «Фильтрованные» остальные даты не скрываем: они остаются
        // доступными для выбора и только визуально приглушаются.
        return [...seenTiles.values()].filter(tile => getDeliveryDate(tile) != null);
    }

    function getDeliveryCalendarFilteredKeys() {
        if (deliveryCalendarScope !== 'filtered' || !Array.isArray(dependencies.currentTiles)) return null;
        const keys = new Set();
        dependencies.currentTiles.forEach(tile => {
            const ts = getDeliveryDate(tile); if (ts == null) return;
            const d = new Date(ts); if (Number.isNaN(d.getTime())) return;
            keys.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        return keys;
    }

    // Важное отличие от filteredKeys: здесь специально исключаем @доставка/@дата
    // из текущего поискового запроса. Так можно определить, есть ли смысл выбирать
    // конкретную дату с учётом ВСЕХ остальных фильтров. Сам @доставка на этот статус
    // не влияет.
    function getDeliveryCalendarInfluenceKeys() {
        if (deliveryCalendarScope !== 'filtered') return null;
        const allTiles = [...seenTiles.values()];
        if (!dependencies.searchInput || !dependencies.searchInput.value.trim()) {
            return new Set(allTiles.map(tile => {
                const ts=getDeliveryDate(tile); if(ts==null) return null;
                const d=new Date(ts); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            }).filter(Boolean));
        }
        const withoutDelivery = stripSortRulesFromQuery(dependencies.searchInput.value)
            .replace(/!?\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu, ' ')
            .replace(/\s{2,}/g, ' ').trim();
        let matched = allTiles;
        if (withoutDelivery) {
            const tokens = parseSearchQuery(withoutDelivery);
            matched = allTiles.filter(tile => matchesTileSearchTokens(tile, tokens));
        }
        const keys = new Set();
        matched.forEach(tile => {
            const ts=getDeliveryDate(tile); if(ts==null) return;
            const d=new Date(ts); if(Number.isNaN(d.getTime())) return;
            keys.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        return keys;
    }

    // Возвращает функцию, которая проверяет, попадает ли дата в явно заданный
    // @доставка/@дата из текущего запроса. Нужна отдельно от currentTiles:
    // currentTiles уже отфильтрован по @доставка, а для отображения ячейки за
    // пределами диапазона нужно сохранить исходную информацию о дате.
    function getDeliveryCalendarQueryDateMatcher() {
        if (!dependencies.searchInput || !dependencies.searchInput.value.trim()) return null;
        const re=/@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const matches=[...dependencies.searchInput.value.matchAll(re)];
        if (!matches.length) return null;
        const ranges=[];
        for (const match of matches) {
            const open=match[0].indexOf('(');
            const close=match[0].lastIndexOf(')');
            if (open<0 || close<=open) continue;
            const parsed=tryParseDateFieldBody(match[0].slice(open+1,close));
            if (!parsed) continue;
            for (const r of parsed.ranges) ranges.push(r);
        }
        if (!ranges.length) return null;
        return ts => ranges.some(r => {
            const hit=ts>=r.minTs && ts<=r.maxTs;
            return r.exclude ? !hit : hit;
        });
    }

    function getDeliveryCalendarRemainingCounts() {
        const counts = new Map();
        const allTiles = [...seenTiles.values()];
        let matched = allTiles;
        if (dependencies.searchInput && dependencies.searchInput.value.trim()) {
            const withoutDelivery = stripSortRulesFromQuery(dependencies.searchInput.value)
                .replace(/!?\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu, ' ')
                .replace(/\s{2,}/g, ' ').trim();
            if (withoutDelivery) {
                const tokens = parseSearchQuery(withoutDelivery);
                matched = allTiles.filter(tile => matchesTileSearchTokens(tile, tokens));
            }
        }
        matched.forEach(tile => {
            const ts=getDeliveryDate(tile); if(ts==null) return;
            const d=new Date(ts); if(Number.isNaN(d.getTime())) return;
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            counts.set(key,(counts.get(key)||0)+1);
        });
        return counts;
    }

    function formatCalendarMoney(value, decimals = 2) {
        if (!Number.isFinite(value)) return '—';
        const digits = decimals > 0 ? Math.min(2, decimals) : 0;
        return `${value.toLocaleString('ru-RU', {minimumFractionDigits: digits, maximumFractionDigits: digits})} ${detectCurrency()}`;
    }

    function getCalendarNumericAttributes(tiles) {
        const defs = new Map();
        for (const tile of tiles) {
            const extra = getExtraTileAttributes(tile) || {};
            for (const [name, raw] of Object.entries(extra)) {
                const values = Array.isArray(raw) ? raw : [raw];
                const nums = [];
                for (const value of values) {
                    const m = String(value ?? '').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/);
                    if (m) { const n = Number(m[0]); if (Number.isFinite(n)) nums.push(n); }
                }
                if (nums.length) {
                    if (!defs.has(name)) defs.set(name, {name, values:[]});
                    defs.get(name).values.push(...nums);
                }
            }
        }
        return [...defs.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    }
    function getCalendarAttrValues(tile, name) {
        const raw = getExtraTileAttributes(tile)?.[name];
        const values = Array.isArray(raw) ? raw : [raw];
        return values.map(v=>String(v??'').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/))
            .filter(Boolean).map(m=>Number(m[0])).filter(Number.isFinite);
    }

    function buildDeliveryCalendarData(tiles) {
        const byDate = new Map();
        for (const tile of tiles) {
            const ts = getDeliveryDate(tile);
            if (ts == null) continue;
            const d = new Date(ts);
            if (Number.isNaN(d.getTime())) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            let item = byDate.get(key);
            if (!item) {
                item = { ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), prices: [], units: new Map(), attrs: new Map(), count: 0 };
                byDate.set(key, item);
            }
            item.count++;
            const price = getPrice(tile);
            if (price != null && price < 99999999 && Number.isFinite(price)) item.prices.push(price);
            for (const [attrName, attrValues] of Object.entries(getExtraTileAttributes(tile) || {})) {
                const nums = (Array.isArray(attrValues) ? attrValues : [attrValues]).flatMap(v => {
                    const m = String(v ?? '').replace(/,/g,'.').match(/-?\d+(?:\.\d+)?/);
                    return m && Number.isFinite(Number(m[0])) ? [Number(m[0])] : [];
                });
                if (nums.length) { if (!item.attrs.has(attrName)) item.attrs.set(attrName, []); item.attrs.get(attrName).push(...nums); }
            }
            const ppg = getPricePerUnit(tile);
            if (ppg && Number.isFinite(ppg.value) && !(deliveryCalendarExcludeZeroUnit && ppg.value <= 0)) {
                const unitKey = `${ppg.category}|${ppg.unit}`;
                if (!item.units.has(unitKey)) item.units.set(unitKey, { unit: ppg.unit, values: [], decimals: ppg.decimals ?? 2 });
                item.units.get(unitKey).values.push(ppg.value);
            }
        }
        return byDate;
    }

    function closeDeliveryCalendar() {
        deliveryCalendarOpen = false;
        deliveryCalendarPopover?.remove();
        deliveryCalendarPopover = null;
        deliveryCalendarResizeObserver?.disconnect();
        deliveryCalendarResizeObserver = null;
        if (deliveryCalendarWindowHandler) { window.removeEventListener('resize', deliveryCalendarWindowHandler); deliveryCalendarWindowHandler=null; }
        if (deliveryCalendarMenuClickHandler) { document.removeEventListener('click', deliveryCalendarMenuClickHandler); deliveryCalendarMenuClickHandler=null; }
        if (deliveryCalendarRefreshTimer) { clearTimeout(deliveryCalendarRefreshTimer); deliveryCalendarRefreshTimer=null; }
    }

    function scheduleDeliveryCalendarRefresh(immediate = false) {
        deliveryCalendarDirty = true;
        if (!deliveryCalendarOpen || !deliveryCalendarAutoRefresh) return;
        if (deliveryCalendarRefreshTimer) clearTimeout(deliveryCalendarRefreshTimer);
        deliveryCalendarRefreshTimer = setTimeout(() => {
            deliveryCalendarRefreshTimer = null;
            if (deliveryCalendarOpen) renderDeliveryCalendar();
        }, immediate ? 0 : 350);
    }

    function renderDeliveryCalendar() {
        if (!deliveryCalendarPopover) return;
        const tiles = getDeliveryCalendarTiles();
        const data = buildDeliveryCalendarData(tiles);
        const filteredKeys = getDeliveryCalendarFilteredKeys();
        // Рендер пересоздаёт DOM, поэтому запоминаем прокрутку текущей ленты.
        const previousGrid = deliveryCalendarPopover.querySelector('.ss-delivery-calendar-days');
        if (previousGrid) {
            deliveryCalendarRibbonScroll = { left: previousGrid.scrollLeft || 0, top: previousGrid.scrollTop || 0 };
        }
        deliveryCalendarDirty = false;
        // Сохраняем позицию прокрутки перед полной перерисовкой: выбор даты не должен возвращать ленту в начало.
        const oldGrid = deliveryCalendarPopover.querySelector('.ss-delivery-calendar-date-list');
        if (oldGrid) deliveryCalendarRibbonScroll = { left:oldGrid.scrollLeft, top:oldGrid.scrollTop, layout:deliveryCalendarLayout };
        deliveryCalendarContentScrollTop = deliveryCalendarPopover.scrollTop;
        deliveryCalendarPopover.innerHTML = '';
        applyDeliveryCalendarGeometry();

        const head = document.createElement('div');
        head.className = 'ss-delivery-calendar-drag';
        head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:grab;user-select:none;';
        const title = document.createElement('strong');
        title.textContent = '📅 Доставка и цены';
        title.style.cssText = 'font-size:13px;flex:1;';
        head.appendChild(title);

        const attrWrap=document.createElement('div');
        attrWrap.className='ss-delivery-calendar-attr-wrap';
        attrWrap.style.cssText='position:relative;min-width:0;';
        const attrBtn=document.createElement('button');
        attrBtn.type='button'; attrBtn.textContent='Атрибуты ▾';
        attrBtn.style.cssText='font-size:11px;padding:4px 7px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;';
        const attrMenu=document.createElement('div');
        attrMenu.className='ss-delivery-calendar-attr-menu';
        attrMenu.style.cssText='display:none;position:fixed;z-index:2147483647;width:210px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:7px;background:#fff;border:1px solid #ddd;border-radius:7px;box-shadow:0 5px 18px rgba(0,0,0,.18);box-sizing:border-box;';
        const attrDefs=[{key:'price',label:'💰 Цена'},{key:'perunit',label:'⚖️ Цена/ед.'},...getCalendarNumericAttributes(tiles).map(x=>({key:`extra:${x.name}`,label:x.name}))];
        attrDefs.forEach(def=>{
            const lab=document.createElement('label'); lab.style.cssText='display:flex;align-items:center;gap:6px;padding:4px 2px;font-size:11px;cursor:pointer;min-width:0;';
            const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=deliveryCalendarAttributes[def.key] !== false;
            cb.onchange=()=>{ deliveryCalendarAttributes[def.key]=cb.checked; chrome.storage.local.set({deliveryCalendarAttributes}); renderDeliveryCalendar(); const newMenu=deliveryCalendarPopover?.querySelector('.ss-delivery-calendar-attr-menu'); if(newMenu) newMenu.style.display='block'; };
            lab.append(cb,document.createTextNode(def.label)); attrMenu.appendChild(lab);
        });
        const positionAttrMenu=()=>{ const r=attrBtn.getBoundingClientRect(); const w=Math.min(210,Math.max(170,window.innerWidth-16)); let left=r.right-w; if(left<8) left=8; let top=r.bottom+4; const h=Math.min(320,Math.max(80,window.innerHeight-top-8)); if(top+h>window.innerHeight-8) top=Math.max(8,r.top-h-4); attrMenu.style.width=`${w}px`; attrMenu.style.maxHeight=`${h}px`; attrMenu.style.left=`${left}px`; attrMenu.style.top=`${top}px`; };
        attrBtn.onclick=ev=>{ev.stopPropagation(); const opening=attrMenu.style.display==='none'; if(opening) positionAttrMenu(); attrMenu.style.display=opening?'block':'none';};
        attrWrap.append(attrBtn,attrMenu);
        head.appendChild(attrWrap);
        const scope = document.createElement('select');
        scope.style.cssText = 'font-size:11px;padding:3px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;';
        [['filtered','Фильтрованные'],['all','Все карточки']].forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; scope.appendChild(o); });
        scope.value = deliveryCalendarScope;
        scope.title = deliveryCalendarScope === 'all'
            ? 'Считать все карточки текущего поиска, независимо от фильтров'
            : 'Считать только карточки, оставшиеся после текущих фильтров';
        scope.onchange = () => {
            deliveryCalendarScope = scope.value === 'all' ? 'all' : 'filtered';
            chrome.storage.local.set({deliveryCalendarScope});
            deliveryCalendarDirty = true;
            const tiles = getDeliveryCalendarTiles();
            const firstTs = tiles.map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b)[0];
            if (firstTs) { const d=new Date(firstTs); deliveryCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1); }
            updateDeliveryCalendarButton();
            renderDeliveryCalendar();
        };
        head.appendChild(scope);

        const auto = document.createElement('label');
        auto.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;color:#777;white-space:nowrap;';
        const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=deliveryCalendarAutoRefresh;
        cb.onchange = () => { deliveryCalendarAutoRefresh=cb.checked; chrome.storage.local.set({deliveryCalendarAutoRefresh}); };
        auto.append(cb, document.createTextNode('Авто'));
        head.appendChild(auto);

        const refresh = document.createElement('button');
        refresh.type='button'; refresh.textContent='🔄'; refresh.title='Пересчитать календарь сейчас';
        refresh.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;';
        refresh.onclick=()=>{ deliveryCalendarDirty=true; renderDeliveryCalendar(); };
        head.appendChild(refresh);

        const close = document.createElement('button');
        close.type='button'; close.textContent='✕'; close.title='Закрыть';
        close.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;';
        close.onclick=closeDeliveryCalendar;
        head.appendChild(close);
        if(deliveryCalendarLayout==='vertical') {
            head.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin:0 0 5px;flex:0 0 auto;cursor:grab;user-select:none;';
            title.style.cssText='font-size:12px;flex:1 1 100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
attrBtn.style.cssText='font-size:9px;padding:3px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;white-space:nowrap;';
            scope.style.cssText='font-size:9px;padding:3px 4px;border:1px solid #ddd;border-radius:5px;background:#fff;max-width:110px;';
            auto.style.cssText='display:flex;align-items:center;gap:2px;font-size:9px;color:#777;white-space:nowrap;';
            refresh.style.cssText='padding:2px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:11px;';
            close.style.cssText='padding:2px 5px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:11px;';
        }
        deliveryCalendarPopover.appendChild(head);

        if (!tiles.length || !data.size) {
            const empty=document.createElement('div');
            empty.textContent='В текущей выборке нет карточек с датой доставки.';
            empty.style.cssText='padding:18px 8px;color:#888;font-size:12px;text-align:center;';
            deliveryCalendarPopover.appendChild(empty);
            return;
        }

        const selectInfo=document.createElement('div');
        selectInfo.style.cssText='display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0 0 5px;padding:4px 5px;border-radius:6px;background:#f7f9fb;font-size:9px;color:#666;flex:0 0 auto;';
        const selText=document.createElement('span'); selText.textContent=deliveryCalendarSelectedDates.size ? `Выбрано дат: ${deliveryCalendarSelectedDates.size}` : 'Выберите даты'; selectInfo.appendChild(selText);
        const clearSel=document.createElement('button'); clearSel.type='button'; clearSel.textContent='Очистить'; clearSel.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:10px;'; clearSel.onclick=()=>{deliveryCalendarSelectedDates.clear();deliveryCalendarAnchorKey=null;removeCalendarDateFilter();renderDeliveryCalendar();}; selectInfo.appendChild(clearSel);
        const applySel=document.createElement('button'); applySel.type='button'; applySel.textContent='Применить фильтр'; applySel.style.cssText='padding:3px 7px;border:1px solid #90caf9;border-radius:5px;background:#eaf3ff;color:#1565c0;cursor:pointer;font-size:10px;'; applySel.disabled=!deliveryCalendarSelectedDates.size; applySel.onclick=()=>applyCalendarDateFilter([...deliveryCalendarSelectedDates]); selectInfo.appendChild(applySel);
        const zeroLabel=document.createElement('label'); zeroLabel.style.cssText='display:flex;align-items:center;gap:3px;margin-left:auto;'; const zeroCb=document.createElement('input'); zeroCb.type='checkbox'; zeroCb.checked=deliveryCalendarExcludeZeroUnit; zeroCb.onchange=()=>{deliveryCalendarExcludeZeroUnit=zeroCb.checked;chrome.storage.local.set({deliveryCalendarExcludeZeroUnit});renderDeliveryCalendar();}; zeroLabel.append(zeroCb,document.createTextNode('Не учитывать 0 ₽/ед.')); selectInfo.appendChild(zeroLabel);
        deliveryCalendarPopover.appendChild(selectInfo);

        // Непрерывная шкала дат: месяцы больше не являются вкладками.
        const dateEntries=[...data.entries()].sort((a,b)=>a[1].ts-b[1].ts);
        const firstDataTs=dateEntries.length ? dateEntries[0][1].ts : null;
        const lastDataTs=dateEntries.length ? dateEntries[dateEntries.length-1][1].ts : null;
        const firstMonth=firstDataTs!=null ? new Date(new Date(firstDataTs).getFullYear(),new Date(firstDataTs).getMonth(),1) : new Date(deliveryCalendarMonth);
        const lastMonth=lastDataTs!=null ? new Date(new Date(lastDataTs).getFullYear(),new Date(lastDataTs).getMonth(),1) : new Date(firstMonth);
        const monthList=[];
        for(let md=new Date(firstMonth); md<=lastMonth; md=new Date(md.getFullYear(),md.getMonth()+1,1)) monthList.push(new Date(md));
        if(!monthList.length) monthList.push(new Date(deliveryCalendarMonth));
        // Для лент диапазон прокрутки ограничиваем точными датами доставки всех карточек,
        // а не началом/концом календарных месяцев. В режиме «Фильтрованные» этот
        // диапазон намеренно остаётся тем же, поскольку data построена по всем tiles.
        const deliveryRangeStart = firstDataTs != null ? new Date(firstDataTs) : null;
        const deliveryRangeEnd = lastDataTs != null ? new Date(lastDataTs) : null;
        const deliveryStartDay = deliveryRangeStart ? deliveryRangeStart.getDate() : 1;
        const deliveryEndDay = deliveryRangeEnd ? deliveryRangeEnd.getDate() : 31;

        const nav=document.createElement('div');
        nav.className='ss-delivery-calendar-nav';
        nav.style.cssText='display:flex;align-items:center;gap:5px;margin:0 0 5px;min-height:24px;flex:0 0 auto;';
        const currentLabel=document.createElement('strong');
        currentLabel.textContent='';
        currentLabel.title='Текущий месяц по положению прокрутки';
        currentLabel.style.cssText='font-size:11px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-transform:capitalize;';
        const todayBtn=document.createElement('button');
        todayBtn.type='button'; todayBtn.textContent='Сегодня'; todayBtn.title='Прокрутить к сегодняшней дате';
        todayBtn.style.cssText='padding:3px 6px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:10px;white-space:nowrap;flex:0 0 auto;';
        nav.append(currentLabel,todayBtn);
        deliveryCalendarPopover.appendChild(nav);

        const ribbon=document.createElement('div');
        ribbon.className='ss-delivery-calendar-days ss-delivery-calendar-date-list';
        const sizeValue=getCalendarCellSize();
        const cellScale=Math.min(1.55,Math.max(0.72,sizeValue/105));
        const sc={
            font:Math.max(11,Math.round(12*cellScale*10)/10),
            price:Math.max(9,Math.round(9.5*cellScale*10)/10),
            unit:Math.max(8.5,Math.round(8.5*cellScale*10)/10),
            extra:Math.max(8.5,Math.round(8.5*cellScale*10)/10),
            count:Math.max(8,Math.round(7.5*cellScale*10)/10),
            width:Math.round(sizeValue),
            minHeight:Math.max(72,Math.round(sizeValue*0.82))
        };

        const influenceKeys=getDeliveryCalendarInfluenceKeys();
        const remainingCounts=getDeliveryCalendarRemainingCounts();

        const filteredData = deliveryCalendarScope==='filtered' && Array.isArray(dependencies.currentTiles)
            ? buildDeliveryCalendarData(dependencies.currentTiles) : null;
        const deliveryQueryMatcher = deliveryCalendarScope==='filtered'
            ? getDeliveryCalendarQueryDateMatcher() : null;
        // Все сводные показатели должны использовать тот же набор карточек,
        // что и содержимое ячеек в выбранном режиме. В режиме «Фильтрованные»
        // currentTiles уже содержит результат текущих фильтров (включая @доставка).
        const summaryData = filteredData || data;
        const summaryTiles = deliveryCalendarScope==='filtered' && Array.isArray(dependencies.currentTiles) ? dependencies.currentTiles : tiles;

        // Даты лучших вариантов для визуального выделения непосредственно в ячейках.
        // Набор строится из summaryData, поэтому в режиме «Фильтрованные» он
        // автоматически соответствует текущему набору карточек.
        const cheapDateKeys=new Set();
        const cheapUnitDateKeys=new Set();
        if(deliveryCalendarAttributes.price !== false){
            const priced=[...summaryData.values()].filter(x=>x.prices?.length);
            if(priced.length){
                const cheapest=priced.reduce((best,x)=>Math.min(best,Math.min(...x.prices)),Infinity);
                for(const [key,x] of summaryData.entries()) if(x.prices?.length && Math.min(...x.prices)===cheapest) cheapDateKeys.add(key);
            }
        }
        if(deliveryCalendarAttributes.perunit !== false){
            let bestValue=Infinity;
            const candidates=[];
            for(const [key,x] of summaryData.entries()) for(const u of x.units.values()) if(u.values?.length){
                const min=Math.min(...u.values);
                candidates.push({key,min});
                if(min<bestValue) bestValue=min;
            }
            candidates.filter(c=>c.min===bestValue).forEach(c=>cheapUnitDateKeys.add(c.key));
        }
        // В режиме «Фильтрованные» значения внутри диапазона @доставка считаем
        // по текущему результату поиска. Но ячейки ВНЕ диапазона @доставка не
        // должны терять информацию: для них показываем исходные данные даты.
        let totalMonthItems=data.size;
        const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

        function makeDateCell(key,item,y,m,day,ribbonCell=true){
            const selected=deliveryCalendarSelectedDates.has(key);
            const inFiltered=filteredKeys ? filteredKeys.has(key) : true;
            const hasInfluence=influenceKeys ? influenceKeys.has(key) : true;
            const noInfluence=deliveryCalendarScope==='filtered' && influenceKeys && item && !hasInfluence;
            const subdued=deliveryCalendarScope==='filtered' && filteredKeys && !inFiltered;
            const isCheapest=cheapDateKeys.has(key);
            const isCheapestUnit=cheapUnitDateKeys.has(key);
            const cell=document.createElement('div');
            const viewScale=ribbonCell?cellScale:1;
            const viewMinHeight=ribbonCell?sc.minHeight:68;
            const cellFont=Math.max(8,Math.min(20,getCalendarFontSize()));
            const cellBorder=noInfluence?'#d89b00':selected?'#1976d2':isCheapest&&isCheapestUnit?'#9b70c9':isCheapest?'#69a96f':isCheapestUnit?'#9a79c9':subdued?'#ddd':'#eee';
            const cellBackground=noInfluence?'#fff8df':selected?'#eaf3ff':isCheapest&&isCheapestUnit?'#f5eefb':isCheapest?'#eff9f0':isCheapestUnit?'#f6f0fb':subdued?'#fafafa':'#fff';
            cell.dataset.deliveryDateState=noInfluence?'no-influence':(subdued?'subdued':'active');
            cell.style.cssText=`position:relative;${ribbonCell?`width:${sc.width}px;min-width:${sc.width}px;flex:0 0 ${sc.width}px;`:''}min-height:${viewMinHeight}px;border:1px solid ${cellBorder};border-radius:7px;padding:${Math.max(5,Math.round(5*cellScale))}px;box-sizing:border-box;background:${cellBackground};opacity:${subdued&&!noInfluence?'0.55':'1'};overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start;`;
            if(noInfluence) cell.style.boxShadow='inset 3px 0 0 #e0a000';
            else if(isCheapest&&isCheapestUnit) cell.style.boxShadow='inset 3px 0 0 #7b4fa3';
            else if(isCheapest) cell.style.boxShadow='inset 3px 0 0 #4d9854';
            else if(isCheapestUnit) cell.style.boxShadow='inset 3px 0 0 #7b5aa6';
            const dayEl=document.createElement('div');dayEl.textContent=`${day} ${['пн','вт','ср','чт','пт','сб','вс'][(new Date(y,m,day).getDay()+6)%7]}`;dayEl.style.cssText=`font-size:${cellFont}px;font-weight:700;color:${subdued?'#999':'#555'};line-height:1.2;`;cell.appendChild(dayEl);
            if(noInfluence){const hint=document.createElement('span');hint.textContent='Не влияет';hint.style.cssText='position:absolute;right:4px;top:4px;font-size:8px;line-height:1;padding:2px 3px;border-radius:3px;background:#fff0b3;color:#9a6b00;font-weight:700;pointer-events:none;white-space:nowrap;';cell.appendChild(hint);}
            if(!noInfluence && (isCheapest || isCheapestUnit)){
                const badge=document.createElement('span');
                badge.textContent=isCheapest&&isCheapestUnit?'💸⚖️':isCheapest?'💸':'⚖️';
                badge.title=isCheapest&&isCheapestUnit?'Дешевле и дешевле за единицу':isCheapest?'Дешевле':'Дешевле за единицу';
                badge.style.cssText='position:absolute;right:4px;top:4px;font-size:10px;line-height:1;padding:2px 3px;border-radius:4px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);pointer-events:none;';
                cell.appendChild(badge);
            }
            if(item){
                // Если есть @доставка и дата ячейки вне его диапазона —
                // оставляем исходные значения. Внутри диапазона используем
                // пересчитанные по текущему фильтру данные.
                const cellTs=new Date(y,m,day).getTime();
                const useFilteredValues=!!filteredData && (!deliveryQueryMatcher || deliveryQueryMatcher(cellTs));
                const displayItem = useFilteredValues ? (filteredData.get(key) || null) : item;
                const prices=displayItem?.prices || [], showPrice=deliveryCalendarAttributes.price!==false, showUnit=deliveryCalendarAttributes.perunit!==false;
                if(showPrice&&prices.length){const min=Math.min(...prices),max=Math.max(...prices),val=document.createElement('div');val.textContent=`💰 ${min===max?formatCalendarMoney(min,2):`${formatCalendarMoney(min,2)}–${formatCalendarMoney(max,2)}`}`;val.style.cssText=`font-size:${cellFont}px;font-weight:700;line-height:1.2;margin-top:3px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);}
                if(showUnit&&displayItem?.units?.size)[...displayItem.units.values()].slice(0,2).forEach(u=>{const min=Math.min(...u.values),max=Math.max(...u.values),val=document.createElement('div'),minText=min.toLocaleString('ru-RU',{maximumFractionDigits:2}),maxText=max.toLocaleString('ru-RU',{maximumFractionDigits:2});val.textContent=`⚖️ ${min===max?minText:`${minText}–${maxText}`} ${detectCurrency()}/${u.unit}`;val.style.cssText=`font-size:${cellFont}px;font-weight:700;line-height:1.15;margin-top:2px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);});
                for(const [attrName,vals] of (displayItem?.attrs || new Map()).entries()){if(deliveryCalendarAttributes[`extra:${attrName}`]===false||!vals.length)continue;const min=Math.min(...vals),max=Math.max(...vals),val=document.createElement('div');val.textContent=`${attrName}: ${min===max?min.toLocaleString('ru-RU',{maximumFractionDigits:2}):`${min.toLocaleString('ru-RU',{maximumFractionDigits:2})}–${max.toLocaleString('ru-RU',{maximumFractionDigits:2})}`}`;val.style.cssText=`font-size:${cellFont}px;line-height:1.15;margin-top:2px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;`;cell.appendChild(val);}
                const count=document.createElement('div');const remaining=remainingCounts.get(key);count.textContent=`${item.count} карточек (${Number.isFinite(remaining)?remaining:0})`;count.style.cssText=`font-size:${cellFont}px;color:#999;margin-top:2px;line-height:1.1;`;cell.appendChild(count);
                const dateText=`${String(day).padStart(2,'0')}.${String(m+1).padStart(2,'0')}.${y}`;
                cell.title=`${dateText} · ${item.count} карточек · клик — выбрать дату, Shift — диапазон, Ctrl/Cmd — добавить/убрать${noInfluence?' · текущие остальные фильтры не оставляют карточек на эту дату':''}`;
                cell.style.cursor='pointer'; cell.dataset.deliveryDateKey=key; cell.addEventListener('click',ev=>toggleCalendarDate(key,dateText,ev));
            } else {
                cell.style.background='#fafafa';
                // Пустая дата всё равно является точкой прокрутки: кнопка «Сегодня»
                // должна работать даже если на сегодня нет карточки с доставкой.
                cell.dataset.deliveryDateKey=key;
            }
            return cell;
        }

        function updateCurrentMonthLabel(){
            const months=monthList;
            let active=null;
            if(deliveryCalendarLayout==='vertical'){
                const top=ribbon.scrollTop||0;
                const rows=ribbon.querySelectorAll('[data-vmonth]');
                let best=null;
                rows.forEach(n=>{const r=n.getBoundingClientRect(), rr=ribbon.getBoundingClientRect(); const dist=Math.abs(r.top-Math.max(rr.top, r.top)); if(r.bottom>=rr.top+20 && (!best||dist<best.dist)) best={node:n,dist};});
                if(best) active=best.node.dataset.vmonth;
                if(!active && months.length) active=`${months[0].getFullYear()}-${String(months[0].getMonth()+1).padStart(2,'0')}`;
            } else {
                const blocks=ribbon.querySelectorAll('[data-month-key]');
                const rr=ribbon.getBoundingClientRect();
                let best=null;
                blocks.forEach(b=>{const r=b.getBoundingClientRect(); const visible=deliveryCalendarLayout==='horizontal'?Math.max(0,Math.min(r.right,rr.right)-Math.max(r.left,rr.left)):Math.max(0,Math.min(r.bottom,rr.bottom)-Math.max(r.top,rr.top)); if(visible>0 && (!best||visible>best.visible)) best={key:b.dataset.monthKey,visible};});
                if(best) active=best.key;
            }
            if(!active){const d=deliveryCalendarMonth;active=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
            const [yy,mm]=active.split('-').map(Number);
            const md=new Date(yy,mm-1,1);
            currentLabel.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
            deliveryCalendarMonth=md;
        }

        if(deliveryCalendarLayout==='horizontal') {
            ribbon.style.cssText='display:flex;align-items:stretch;gap:6px;overflow-x:auto;overflow-y:hidden;flex:1 1 auto;min-height:0;padding:2px 2px 9px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            for(const md of monthList){
                const y=md.getFullYear(),m=md.getMonth();
                const monthWrap=document.createElement('div'); monthWrap.className='ss-delivery-calendar-month-block'; monthWrap.dataset.monthKey=`${y}-${String(m+1).padStart(2,'0')}`;
                monthWrap.style.cssText='display:flex;align-items:stretch;gap:5px;flex:0 0 auto;';
                const monthLabel=document.createElement('div'); monthLabel.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); monthLabel.style.cssText=`flex:0 0 auto;width:${Math.max(70,Math.round(sc.width*.62))}px;display:flex;align-items:center;justify-content:center;padding:4px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px;font-size:9px;font-weight:700;color:#667;writing-mode:vertical-rl;transform:rotate(180deg);box-sizing:border-box;`;
                const daysWrap=document.createElement('div'); daysWrap.style.cssText='display:flex;gap:4px;align-items:stretch;';
                const monthFirstDay=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;
                const monthLastDay=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();
                for(let day=monthFirstDay;day<=monthLastDay;day++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;daysWrap.appendChild(makeDateCell(key,data.get(key),y,m,day,true));}
                monthWrap.append(monthLabel,daysWrap); ribbon.appendChild(monthWrap);
            }
        } else if(deliveryCalendarLayout==='vertical') {
            ribbon.style.cssText='display:block;position:relative;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;height:auto;padding:2px 3px 6px 2px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            const entries=[];
            for(const md of monthList){const y=md.getFullYear(),m=md.getMonth();entries.push({type:'month',y,m,ts:md.getTime()});const monthFirstDay=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;const monthLastDay=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();for(let day=monthFirstDay;day<=monthLastDay;day++)entries.push({type:'date',y,m,day,key:`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`});}
            const monthH=24,rowH=sc.minHeight+5,offsets=new Array(entries.length+1);offsets[0]=0;
            for(let i=0;i<entries.length;i++)offsets[i+1]=offsets[i]+(entries[i].type==='month'?monthH:rowH);
            const canvas=document.createElement('div');canvas.style.cssText=`position:relative;width:100%;height:${offsets[entries.length]}px;`;ribbon.appendChild(canvas);
            const findIndex=scrollTop=>{let lo=0,hi=entries.length;while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid+1]<=scrollTop)lo=mid+1;else hi=mid;}return lo;};
            const renderVirtual=()=>{canvas.querySelectorAll('[data-vrow]').forEach(e=>e.remove());const top=ribbon.scrollTop||0,viewport=ribbon.clientHeight||400,from=Math.max(0,findIndex(Math.max(0,top-rowH*5))),to=Math.min(entries.length,findIndex(top+viewport+rowH*5)+1);for(let i=from;i<to;i++){const e=entries[i],node=document.createElement('div');node.dataset.vrow='1';node.style.cssText=`position:absolute;left:0;right:0;top:${offsets[i]}px;box-sizing:border-box;`;if(e.type==='month'){node.dataset.vmonth=`${e.y}-${String(e.m+1).padStart(2,'0')}`;node.textContent=new Date(e.y,e.m,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});node.style.cssText+=`height:${monthH}px;padding:3px 6px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px;font-size:10px;font-weight:700;color:#667;text-transform:capitalize;display:flex;align-items:center;`;}else{const cell=makeDateCell(e.key,data.get(e.key),e.y,e.m,e.day,false);cell.style.width='100%';cell.style.minWidth='0';cell.style.height=`${sc.minHeight}px`;node.appendChild(cell);}canvas.appendChild(node);}};
            let virtualRaf=0;ribbon.addEventListener('scroll',()=>{cancelAnimationFrame(virtualRaf);virtualRaf=requestAnimationFrame(()=>{renderVirtual();updateCurrentMonthLabel();});},{passive:true});renderVirtual();
        } else {
            // Стандартный календарь: полноценная сетка Пн–Вс для каждого месяца.
            // Ширина ячеек определяется шириной окна, высота — доступной высотой.
            ribbon.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 3px 8px;width:100%;box-sizing:border-box;overscroll-behavior:contain;scrollbar-gutter:stable;';
            for(const md of monthList){
                const y=md.getFullYear(),m=md.getMonth(),block=document.createElement('div');block.dataset.monthKey=`${y}-${String(m+1).padStart(2,'0')}`;block.style.cssText='flex:0 0 auto;';
                const ml=document.createElement('div');ml.textContent=md.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});ml.style.cssText='padding:3px 6px;background:#f5f7fa;border:1px solid #e4e8ec;border-radius:6px 6px 0 0;font-size:10px;font-weight:700;color:#667;text-transform:capitalize;';block.appendChild(ml);
                const week=document.createElement('div');week.style.cssText='display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;padding:3px 2px 0;';weekdays.forEach(w=>{const e=document.createElement('div');e.textContent=w;e.style.cssText='text-align:center;font-size:8px;font-weight:700;color:#999;line-height:14px;';week.appendChild(e);});block.appendChild(week);
                const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;padding:0 2px 3px;';
                const first=(new Date(y,m,1).getDay()+6)%7, days=new Date(y,m+1,0).getDate();
                for(let i=0;i<first;i++){const blank=document.createElement('div');blank.style.cssText='min-width:0;min-height:1px;';grid.appendChild(blank);}
                for(let day=1;day<=days;day++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const cell=makeDateCell(key,data.get(key),y,m,day,false);cell.style.width='100%';cell.style.minWidth='0';grid.appendChild(cell);}
                block.appendChild(grid);ribbon.appendChild(block);
            }
            ribbon.addEventListener('scroll',updateCurrentMonthLabel,{passive:true});
        }
        deliveryCalendarPopover.appendChild(ribbon);
        // В горизонтальной ленте обычное колесо мыши прокручивает по горизонтали.
        if(deliveryCalendarLayout==='horizontal') ribbon.addEventListener('wheel',ev=>{if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)){ev.preventDefault();ribbon.scrollLeft+=ev.deltaY;}},{passive:false});
        requestAnimationFrame(()=>{
            if(deliveryCalendarLayout==='horizontal' || deliveryCalendarLayout==='vertical'){
                ribbon.scrollLeft=deliveryCalendarRibbonScroll.left||0;
                ribbon.scrollTop=deliveryCalendarRibbonScroll.top||0;
            } else {
                ribbon.scrollTop=deliveryCalendarContentScrollTop||0;
            }
            updateCurrentMonthLabel();
        });
        todayBtn.onclick=()=>{
            const now=new Date();
            const todayTs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
            const clampTs=deliveryRangeStart&&deliveryRangeEnd ? Math.min(Math.max(todayTs,deliveryRangeStart.getTime()),deliveryRangeEnd.getTime()) : todayTs;
            const targetDate=new Date(clampTs);
            const key=`${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
            if(deliveryCalendarLayout==='horizontal'){
                const el=ribbon.querySelector(`[data-delivery-date-key="${key}"]`);
                if(el) ribbon.scrollTo({left:Math.max(0,el.offsetLeft-12),behavior:'smooth'});
            } else if(deliveryCalendarLayout==='vertical'){
                // В виртуальной ленте ячейка может отсутствовать в DOM. Вычисляем её
                // положение по той же геометрии, поэтому «Сегодня» работает и для
                // пустой даты, и при большом количестве месяцев.
                const monthH=24,rowH=sc.minHeight+5;
                let offset=0,found=false;
                for(const md of monthList){
                    const y=md.getFullYear(),m=md.getMonth();
                    offset+=monthH;
                    const first=(y===firstMonth.getFullYear()&&m===firstMonth.getMonth())?deliveryStartDay:1;
                    const last=(y===lastMonth.getFullYear()&&m===lastMonth.getMonth())?deliveryEndDay:new Date(y,m+1,0).getDate();
                    if(y===targetDate.getFullYear()&&m===targetDate.getMonth()){
                        offset+=(Math.max(0,targetDate.getDate()-first))*rowH; found=true; break;
                    }
                    offset+=(last-first+1)*rowH;
                }
                if(found) ribbon.scrollTo({top:Math.max(0,offset-(ribbon.clientHeight-rowH)/2),behavior:'smooth'});
            } else {
                const el=ribbon.querySelector(`[data-delivery-date-key="${key}"]`);
                if(el) el.scrollIntoView({block:'center',behavior:'smooth'});
            }
        };
        // Короткая подсказка для принятия решения: самая ранняя доставка
        // и самая низкая цена среди текущих карточек.
        const datedItems=[...summaryData.values()].sort((a,b)=>a.ts-b.ts);
        const decision=document.createElement('div');
        decision.style.cssText=`display:flex;flex-wrap:wrap;gap:2px 7px;margin-top:4px;padding:4px 6px;border-radius:6px;background:#f7f9fb;font-size:9px;color:#555;line-height:1.2;box-sizing:border-box;overflow:hidden;flex:0 0 auto;`;
        if(datedItems.length){
            const earliest=new Date(datedItems[0].ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
            const fastest=document.createElement('span'); fastest.className='ss-calendar-decision-fastest'; fastest.textContent=`⚡ Быстрее: ${earliest}`; fastest.style.cssText='padding:2px 5px;border-radius:4px;background:#eef7ff;color:#256a9b;font-weight:600;'; decision.appendChild(fastest);
        }
        const showPriceDecision = deliveryCalendarAttributes.price !== false;
        const showUnitDecision = deliveryCalendarAttributes.perunit !== false;
        if(showPriceDecision){
            const priced=[...summaryData.values()].filter(x=>x.prices.length);
            if(priced.length){
                const cheapest=priced.reduce((best,x)=>Math.min(best,Math.min(...x.prices)),Infinity);
                const cheapDate=priced.find(x=>Math.min(...x.prices)===cheapest);
                if(cheapDate){
                    const cheapLabel=new Date(cheapDate.ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
                    const cheap=document.createElement('span'); cheap.className='ss-calendar-decision-cheap'; cheap.textContent=`💸 Дешевле: ${cheapLabel} · ${formatCalendarMoney(cheapest,2)}`; cheap.style.cssText='padding:2px 5px;border-radius:4px;background:#eefaf0;color:#2e7d32;font-weight:600;'; decision.appendChild(cheap);
                }
            }
        }
        if(showUnitDecision){
            const unitCandidates=[];
            for(const x of summaryData.values()) for(const u of x.units.values()) if(u.values.length){
                unitCandidates.push({x,u,min:Math.min(...u.values)});
            }
            if(unitCandidates.length){
                const best=unitCandidates.reduce((a,b)=>b.min<a.min?b:a);
                const label=new Date(best.x.ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
                const cheap=document.createElement('span'); cheap.className='ss-calendar-decision-unit'; cheap.textContent=`⚖️ Дешевле/ед.: ${label} · ${best.min.toLocaleString('ru-RU',{maximumFractionDigits:2})} ${detectCurrency()}/${best.u.unit}`; cheap.style.cssText='padding:2px 5px;border-radius:4px;background:#f5efff;color:#6a45a0;font-weight:600;'; decision.appendChild(cheap);
            }
        }
        deliveryCalendarPopover.appendChild(decision);

        const statsValues=summaryTiles.map(getPrice).filter(v=>Number.isFinite(v)&&v<99999999&&v>=0).sort((a,b)=>a-b);
        const stats=document.createElement('div'); stats.style.cssText='margin-top:4px;padding:4px 6px;border:1px solid #e6e9ed;border-radius:6px;background:#fff;font-size:9px;color:#555;line-height:1.2;box-sizing:border-box;overflow:hidden;white-space:normal;flex:0 0 auto;';
        if(statsValues.length){
            const sum=statsValues.reduce((a,b)=>a+b,0), avg=sum/statsValues.length, mid=Math.floor(statsValues.length/2), med=statsValues.length%2?statsValues[mid]:(statsValues[mid-1]+statsValues[mid])/2;
            const freq=new Map(); statsValues.forEach(v=>freq.set(v,(freq.get(v)||0)+1)); const maxFreq=Math.max(...freq.values()); const modes=[...freq.entries()].filter(([,n])=>n===maxFreq).map(([v])=>v).sort((a,b)=>a-b);
            stats.innerHTML=`<b>Сводка цен:</b> Средняя ${formatCalendarMoney(avg,2)} · Медиана ${formatCalendarMoney(med,2)} · Мода ${modes.slice(0,3).map(v=>formatCalendarMoney(v,2)).join(', ')}${modes.length>3?'…':''}`; stats.title='Средняя — среднее арифметическое цен. Медиана — центральная цена в отсортированном списке. Мода — наиболее часто встречающаяся цена.';
        } else stats.textContent='Сводка цен: нет корректных цен.';
        deliveryCalendarPopover.appendChild(stats);

        const footer=document.createElement('div');
        footer.style.cssText='font-size:8.5px;color:#888;margin-top:3px;line-height:1.15;white-space:normal;overflow-wrap:anywhere;flex:0 0 auto;';
        const modeText=[deliveryCalendarAttributes.price!==false?'цена':'',deliveryCalendarAttributes.perunit!==false?'цена/ед.':'',...Object.keys(deliveryCalendarAttributes).filter(k=>k.startsWith('extra:')&&deliveryCalendarAttributes[k]).map(k=>k.slice(6))].filter(Boolean).join(', ') || 'ничего не выбрано';
        const scopeText=deliveryCalendarScope==='all'?'все карточки':'отфильтрованные';
        footer.textContent=`${summaryTiles.length} карточек с доставкой · ${totalMonthItems} дат · ${modeText} · ${scopeText}`;
        deliveryCalendarPopover.appendChild(footer);
    }

    function toggleCalendarDate(key, dateText, ev) {
        const keys=[...document.querySelectorAll('#ss-delivery-calendar [data-delivery-date-key]')].map(x=>x.dataset.deliveryDateKey);
        if (ev.shiftKey && deliveryCalendarAnchorKey) {
            const all=[...getDeliveryCalendarTiles()].map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b).map(ts=>{const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
            const a=all.indexOf(deliveryCalendarAnchorKey), b=all.indexOf(key);
            if(a>=0 && b>=0){ const lo=Math.min(a,b), hi=Math.max(a,b); for(let i=lo;i<=hi;i++) deliveryCalendarSelectedDates.add(all[i]); }
        } else if (ev.ctrlKey || ev.metaKey) {
            if(deliveryCalendarSelectedDates.has(key)) deliveryCalendarSelectedDates.delete(key); else deliveryCalendarSelectedDates.add(key);
            deliveryCalendarAnchorKey=key;
        } else {
            if(deliveryCalendarSelectedDates.size===1 && deliveryCalendarSelectedDates.has(key)) deliveryCalendarSelectedDates.delete(key);
            else { deliveryCalendarSelectedDates.clear(); deliveryCalendarSelectedDates.add(key); }
            deliveryCalendarAnchorKey=key;
        }
        renderDeliveryCalendar();
        if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) applyCalendarDateFilter([...deliveryCalendarSelectedDates]);
    }

    function removeCalendarDateFilter() {
        if (!dependencies.searchInput || dependencies.activeTab !== 'search') return;
        const dateRe=/\s*@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const next=dependencies.searchInput.value.replace(dateRe,' ').replace(/\s{2,}/g,' ').trim();
        if (next!==dependencies.searchInput.value.trim()) { dependencies.searchInput.value=next; dependencies.searchInput.dispatchEvent(new Event('input',{bubbles:true})); dependencies.scheduleApplyFilters(); }
    }

    function applyCalendarDateFilter(dateKeysOrTexts) {
        if (!dependencies.searchInput || dependencies.activeTab !== 'search') return;
        const arr=Array.isArray(dateKeysOrTexts)?dateKeysOrTexts:[dateKeysOrTexts];
        const dates=arr.map(v=>{
            if(/^\d{4}-\d{2}-\d{2}$/.test(String(v))){const [y,m,d]=String(v).split('-');return `${d}.${m}.${y}`;}
            return String(v);
        }).filter(Boolean);
        if(!dates.length) return;
        const ts=dates.map(x=>{const m=x.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);return m?new Date(Number(m[3].length===2?'20'+m[3]:m[3]),Number(m[2])-1,Number(m[1])).getTime():NaN;}).filter(Number.isFinite).sort((a,b)=>a-b);
        const ranges=[];
        for(const t of ts){ if(!ranges.length || t>ranges[ranges.length-1].max+86400000) ranges.push({min:t,max:t}); else ranges[ranges.length-1].max=t; }
        const fmt=t=>{const d=new Date(t);return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;};
        const clause=ranges.map(r=>r.min===r.max?fmt(r.min):`${fmt(r.min)}-${fmt(r.max)}`).join(' ');
        const dateClause=`@доставка(${clause})`;
        const current=dependencies.searchInput.value.trim();
        const dateRe=/@(?:доставка|дата)\((?:[^()]|\([^)]*\))*\)/giu;
        const next=dateRe.test(current)?current.replace(dateRe,dateClause):(current?`${current} ${dateClause}`:dateClause);
        dependencies.searchInput.value=next.trim();
        dependencies.searchInput.dispatchEvent(new Event('input',{bubbles:true}));
        dependencies.scheduleApplyFilters();
    }

    function clampDeliveryCalendarPosition() {
        if (!deliveryCalendarPopover) return;
        const rect=deliveryCalendarPopover.getBoundingClientRect();
        const margin=8, maxLeft=Math.max(margin, window.innerWidth-80), maxTop=Math.max(margin, window.innerHeight-50);
        const deliveryCalendarPosition=getCalendarLayoutPosition();
        let left=Number.isFinite(deliveryCalendarPosition.left) ? deliveryCalendarPosition.left : Math.max(margin,(window.innerWidth-rect.width)/2);
        let top=Number.isFinite(deliveryCalendarPosition.top) ? deliveryCalendarPosition.top : Math.max(margin,(window.innerHeight-rect.height)/2);
        left=Math.min(Math.max(margin,left),maxLeft); top=Math.min(Math.max(margin,top),maxTop);
        deliveryCalendarPosition.left=left; deliveryCalendarPosition.top=top;
        deliveryCalendarPopover.style.left=`${left}px`; deliveryCalendarPopover.style.top=`${top}px`;
    }
    function applyDeliveryCalendarGeometry(reset=false) {
        if (!deliveryCalendarPopover) return;
        const pos=getCalendarLayoutPosition();
        const cell=getCalendarCellSize();
        let minWidth=360, preferredWidth=520, preferredHeight=null;
        if(deliveryCalendarLayout==='vertical') { minWidth=205; preferredWidth=Math.max(220,Math.min(340,cell+34)); preferredHeight=Math.min(Math.max(420,window.innerHeight*0.72),Math.max(420,window.innerHeight-32)); }
        else if(deliveryCalendarLayout==='horizontal') { minWidth=360; preferredWidth=Math.min(window.innerWidth-16,Math.max(520,Math.min(980,cell*6))); preferredHeight=Math.min(window.innerHeight-16,Math.max(250,cell*2.15)); }
        else { minWidth=520; preferredWidth=Math.min(window.innerWidth-16,Math.max(520,window.innerWidth*0.72)); preferredHeight=Math.min(window.innerHeight-16,Math.max(360,window.innerHeight*0.72)); }
        if(reset || !Number.isFinite(pos.width)) deliveryCalendarPopover.style.width=`${Math.max(minWidth,preferredWidth)}px`;
        else deliveryCalendarPopover.style.width=`${Math.max(minWidth,Math.min(pos.width,Math.max(minWidth,window.innerWidth-16)))}px`;
        if(reset || !Number.isFinite(pos.height)) deliveryCalendarPopover.style.height=preferredHeight?`${Math.max(280,preferredHeight)}px`:'';
        else deliveryCalendarPopover.style.height=`${Math.max(280,Math.min(pos.height,window.innerHeight-16))}px`;
        deliveryCalendarPopover.style.maxWidth='calc(100vw - 16px)';
        deliveryCalendarPopover.style.resize=deliveryCalendarLayout==='vertical'?'vertical':deliveryCalendarLayout==='horizontal'?'horizontal':'both';
        clampDeliveryCalendarPosition();
    }
    function setupDeliveryCalendarDragResize() {
        if (!deliveryCalendarPopover) return;
        if (!deliveryCalendarPopover.dataset.dragBound) {
            deliveryCalendarPopover.dataset.dragBound='1';
            deliveryCalendarPopover.addEventListener('mousedown', ev=>{
                if (!ev.target.closest('.ss-delivery-calendar-drag') || ev.target.closest('button,select,input,label')) return;
                ev.preventDefault();
                const r=deliveryCalendarPopover.getBoundingClientRect(), sx=ev.clientX, sy=ev.clientY, ox=r.left, oy=r.top;
                const move=e=>{ const pos=getCalendarLayoutPosition(); pos.left=ox+(e.clientX-sx); pos.top=oy+(e.clientY-sy); clampDeliveryCalendarPosition(); };
                const up=()=>{ window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up); chrome.storage.local.set({deliveryCalendarPositions}); };
                window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
            });
        }
        deliveryCalendarResizeObserver?.disconnect();
        deliveryCalendarResizeObserver=new ResizeObserver(()=>{
            if (!deliveryCalendarPopover) return;
            const r=deliveryCalendarPopover.getBoundingClientRect();
            const pos=getCalendarLayoutPosition();
            if(deliveryCalendarLayout!=='vertical') pos.width=Math.round(r.width);
            if(deliveryCalendarLayout!=='horizontal') pos.height=Math.round(r.height);
            clampDeliveryCalendarPosition(); chrome.storage.local.set({deliveryCalendarPositions});
        });
        deliveryCalendarResizeObserver.observe(deliveryCalendarPopover);
    }
    function openDeliveryCalendar() {
        if (deliveryCalendarPopover) { closeDeliveryCalendar(); return; }
        deliveryCalendarOpen = true;
        if (deliveryCalendarDirty) {
            const tiles=getDeliveryCalendarTiles(); const firstTs=tiles.map(getDeliveryDate).filter(v=>v!=null).sort((a,b)=>a-b)[0];
            if (firstTs) { const d=new Date(firstTs); deliveryCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1); }
        }
        deliveryCalendarPopover=document.createElement('div');
        deliveryCalendarPopover.id='ss-delivery-calendar';
        deliveryCalendarPopover.style.cssText='position:fixed;z-index:2147483646;width:520px;min-width:240px;min-height:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);resize:both;overflow:hidden;background:#fff;color:#333;border:1px solid #d8d8d8;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:8px;font:12px/1.3 sans-serif;box-sizing:border-box;display:flex;flex-direction:column;min-height:280px;';
        // Лента не должна наследовать широкую сеточную геометрию.
        document.body.appendChild(deliveryCalendarPopover);
        applyDeliveryCalendarGeometry();
        renderDeliveryCalendar();
        setupDeliveryCalendarDragResize();
        deliveryCalendarWindowHandler=()=>{ clampDeliveryCalendarPosition(); chrome.storage.local.set({deliveryCalendarPositions}); };
        window.addEventListener('resize',deliveryCalendarWindowHandler);
        deliveryCalendarMenuClickHandler = ev => {
            const attrWrap = deliveryCalendarPopover?.querySelector('.ss-delivery-calendar-attr-wrap');
            const moreWrap = deliveryCalendarActionsWrap;
            if (attrWrap && !attrWrap.contains(ev.target)) {
                const menu=attrWrap.querySelector('.ss-delivery-calendar-attr-menu'); if(menu) menu.style.display='none';
            }
            if (moreWrap && !moreWrap.contains(ev.target)) {
                moreMenu.style.display='none';
            }
        };
        document.addEventListener('click', deliveryCalendarMenuClickHandler);
    }

    function updateDeliveryCalendarButton() {
        if (!deliveryCalendarButton) return;
        const count=getDeliveryCalendarTiles().length;
        deliveryCalendarActionsWrap.style.display=count?'inline-flex':'none';
        deliveryCalendarActionsWrap.style.display=count?'inline-flex':'none';
        deliveryCalendarButton.style.display=count?'inline-flex':'none';
        deliveryCalendarButton.title=count ? `📅 Календарь доставки · ${count} карточек · ${deliveryCalendarScope === 'all' ? 'все' : 'отфильтрованные'}` : 'Нет данных о доставке';
        deliveryCalendarButton.textContent=count ? `📅 ${count}` : '📅';
        if (deliveryCalendarOpen && deliveryCalendarAutoRefresh) scheduleDeliveryCalendarRefresh();
    }

    deliveryCalendarButton=document.createElement('button');
    deliveryCalendarButton.type='button';
    deliveryCalendarButton.textContent='📅';
    deliveryCalendarButton.style.cssText='display:none;align-items:center;gap:3px;padding:4px 7px;border:1px solid #ddd;border-right:0;border-radius:6px 0 0 6px;background:#fff;color:#666;cursor:pointer;font-size:11px;white-space:nowrap;';
    deliveryCalendarButton.addEventListener('click',openDeliveryCalendar);

    // Действия календаря находятся рядом с кнопкой 📅, а не внутри самого окна.
    const deliveryCalendarActionsWrap = document.createElement('div');
    deliveryCalendarActionsWrap.className = 'ss-delivery-calendar-actions-wrap';
    deliveryCalendarActionsWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:0;';
    const more = document.createElement('button');
    more.type='button'; more.textContent='⋮'; more.title='Дополнительные действия';
    more.style.cssText='padding:3px 7px;border:1px solid #ddd;border-radius:0 5px 5px 0;background:#fff;cursor:pointer;font-size:16px;line-height:18px;';
    const moreMenu = document.createElement('div');
    moreMenu.className='ss-delivery-calendar-more-menu';
    moreMenu.style.cssText='display:none;position:absolute;right:0;top:30px;z-index:2147483647;min-width:210px;padding:6px;background:#fff;border:1px solid #ddd;border-radius:7px;box-shadow:0 5px 18px rgba(0,0,0,.18);';
    const resetBtn=document.createElement('button');
    resetBtn.type='button'; resetBtn.textContent='↺ Вернуть и сбросить размер';
    resetBtn.style.cssText='width:100%;padding:6px 8px;border:0;background:#fff;text-align:left;cursor:pointer;font-size:11px;';
    resetBtn.onclick=()=>{deliveryCalendarPositions[deliveryCalendarLayout]={left:null,top:null,width:null,height:null};chrome.storage.local.set({deliveryCalendarPositions});applyDeliveryCalendarGeometry(true);moreMenu.style.display='none';};
    moreMenu.appendChild(resetBtn);
    // Внутренние действия меню не должны закрывать его. Закрытие происходит
    // только при клике вне меню или повторном клике по кнопке ⋮.
    ['pointerdown','mousedown','click','change','input'].forEach(type=>moreMenu.addEventListener(type, ev=>ev.stopPropagation()));

    const sizeLabel=document.createElement('label');
    sizeLabel.style.cssText='display:flex;flex-direction:column;gap:5px;padding:7px 8px;font-size:11px;border-top:1px solid #eee;margin-top:4px;';
    const sizeHead=document.createElement('div');
    sizeHead.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const sizeTitle=document.createElement('span'); sizeTitle.textContent='Размер ячеек';
    const sizeValue=document.createElement('span'); sizeValue.style.cssText='font-variant-numeric:tabular-nums;color:#666;min-width:42px;text-align:right;';
    const sizeRange=document.createElement('input');
    sizeRange.type='range'; sizeRange.min='60'; sizeRange.max='180'; sizeRange.step='5'; sizeRange.value=String(getCalendarCellSize());
    sizeRange.title='Размер ячеек дат';
    sizeRange.style.cssText='width:100%;height:18px;cursor:pointer;';
    const updateSizeValue=()=>{sizeValue.textContent=`${sizeRange.value}px`;};
    updateSizeValue();
    sizeRange.oninput=()=>{
        deliveryCalendarCellSizes[deliveryCalendarLayout]=Math.min(180,Math.max(60,Number(sizeRange.value)));
        updateSizeValue();
        chrome.storage.local.set({deliveryCalendarCellSizes});
        const wasOpen=moreMenu.style.display!=='none';
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    sizeHead.append(sizeTitle,sizeValue); sizeLabel.append(sizeHead,sizeRange); moreMenu.appendChild(sizeLabel);
    const syncSizeControl=()=>{ sizeLabel.style.display=deliveryCalendarLayout==='grid'?'none':'flex'; };
    syncSizeControl();

    const fontLabel=document.createElement('label');
    fontLabel.style.cssText='display:flex;flex-direction:column;gap:5px;padding:7px 8px;font-size:11px;border-top:1px solid #eee;';
    const fontHead=document.createElement('div'); fontHead.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const fontTitle=document.createElement('span'); fontTitle.textContent='Шрифт в ячейках';
    const fontValue=document.createElement('span'); fontValue.style.cssText='font-variant-numeric:tabular-nums;color:#666;min-width:38px;text-align:right;';
    const fontRange=document.createElement('input'); fontRange.type='range'; fontRange.min='8'; fontRange.max='20'; fontRange.step='1'; fontRange.value=String(getCalendarFontSize()); fontRange.style.cssText='width:100%;height:18px;cursor:pointer;';
    const updateFontValue=()=>{fontValue.textContent=`${fontRange.value}px`;}; updateFontValue();
    const syncFontControl=()=>{fontRange.value=String(getCalendarFontSize());updateFontValue();};
    fontRange.oninput=()=>{
        deliveryCalendarFontSizes[deliveryCalendarLayout]=Math.min(20,Math.max(8,Number(fontRange.value)));
        updateFontValue();
        chrome.storage.local.set({deliveryCalendarFontSizes});
        const wasOpen=moreMenu.style.display!=='none';
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    fontHead.append(fontTitle,fontValue); fontLabel.append(fontHead,fontRange); moreMenu.appendChild(fontLabel);

    const layoutLabel=document.createElement('label');
    layoutLabel.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;font-size:11px;';
    layoutLabel.append(document.createTextNode('Вид дат'));
    const layoutSelect=document.createElement('select');
    layoutSelect.style.cssText='font-size:11px;padding:3px 4px;border:1px solid #ddd;border-radius:5px;background:#fff;';
    [['grid','Календарь'],['horizontal','Горизонтальная лента'],['vertical','Вертикальная лента']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;layoutSelect.appendChild(o);});
    layoutSelect.value=deliveryCalendarLayout;
    layoutSelect.onchange=()=>{
        deliveryCalendarLayout=layoutSelect.value;
        syncSizeControl();
        syncFontControl();
        chrome.storage.local.set({deliveryCalendarLayout});
        const wasOpen=moreMenu.style.display!=='none';
        // Меню не закрываем: изменение настройки должно оставить меню открытым.
        renderDeliveryCalendar();
        moreMenu.style.display=wasOpen?'block':'none';
    };
    layoutLabel.appendChild(layoutSelect); moreMenu.appendChild(layoutLabel);

    more.onclick=ev=>{ev.stopPropagation();moreMenu.style.display=moreMenu.style.display==='none'?'block':'none';};
    deliveryCalendarActionsWrap.append(deliveryCalendarButton, more, moreMenu);

    return { closeDeliveryCalendar, deliveryCalendarActionsWrap, scheduleDeliveryCalendarRefresh, updateDeliveryCalendarButton };
}

