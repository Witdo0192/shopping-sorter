// Сводка дополнительных атрибутов.
// dependencies связывает эту часть с состоянием и действиями панели.
function createExtraAttributesSummary(dependencies) {
    const extraControls = document.createElement('div');
    extraControls.style.cssText='display:flex;flex-direction:column;gap:4px;padding:3px 7px;border:1px dashed #d8dee6;border-radius:7px;background:#fbfcfd;';
    const extraControlsTitle=document.createElement('div');
    extraControlsTitle.textContent='🏷️ Доп. атрибуты и величины';
    extraControlsTitle.style.cssText='font-size:11px;font-weight:700;color:#607D8B;cursor:pointer;user-select:none;min-height:18px;line-height:18px;';
    extraControls.appendChild(extraControlsTitle);
    const extraControlsBody=document.createElement('div');
    extraControlsBody.style.cssText='display:flex;flex-direction:column;gap:4px;';
    extraControls.appendChild(extraControlsBody);
    let extraControlsCollapsed=false;
    chrome.storage.local.get(['extraControlsCollapsed'], d => {
        setExtraControlsCollapsed(d.extraControlsCollapsed === true);
    });

    function setExtraControlsCollapsed(collapsed){
        extraControlsCollapsed=!!collapsed;
        extraControlsBody.hidden=extraControlsCollapsed;
        // Не полагаемся только на hidden: у body задан inline display:flex,
        // который в некоторых стилях страницы может переопределить [hidden].
        extraControlsBody.style.display=extraControlsCollapsed?'none':'flex';
        extraControls.style.padding=extraControlsCollapsed?'2px 7px':'3px 7px';
        extraControls.style.gap=extraControlsCollapsed?'0':'4px';
        extraControlsTitle.textContent=extraControlsCollapsed
            ? '🏷️ Доп. атрибуты и величины ▸'
            : '🏷️ Доп. атрибуты и величины ▾';
        chrome.storage.local.set({ extraControlsCollapsed });
    }
    extraControlsTitle.addEventListener('click',()=>setExtraControlsCollapsed(!extraControlsCollapsed));

    function refreshExtraControls(tiles=[...seenTiles.values()]) {
        extraControlsBody.innerHTML='';
        const total=tiles.length;
        if(!total){
            const empty=document.createElement('div');
            empty.textContent='Нет карточек для анализа';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        const defs=new Map();
        for(const tile of tiles){
            const profile=getSelectorProfileForTile(tile);
            for(const item of (profile?.extras || [])){
                const name=String(item?.name||'').trim();
                if(!name) continue;
                if(!defs.has(name)) defs.set(name,{name,kind:item?.kind==='quantity'?'quantity':'text',unit:String(item?.unit||'').trim()});
            }
        }

        if(!defs.size){
            const empty=document.createElement('div');
            empty.textContent='Дополнительные атрибуты не настроены';
            empty.style.cssText='font-size:10px;color:#999;padding:2px 0;';
            extraControlsBody.appendChild(empty);
            return;
        }

        for(const def of defs.values()){
            let found=0;
            const frequencies=new Map();
            for(const tile of tiles){
                const attrs=getExtraTileAttributes(tile);
                const raw=String(attrs[def.name]||'').trim();
                if(!raw) continue;
                found++;
                for(const value of raw.split(' | ').map(v=>v.trim()).filter(Boolean)){
                    frequencies.set(value,(frequencies.get(value)||0)+1);
                }
            }
            const absent=Math.max(0,total-found);
            const pct=Math.round(found/total*100);
            const topValues=[...frequencies.entries()]
                .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
                .slice(0,6);
            const distinct=frequencies.size;

            const row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;gap:7px;min-height:20px;font-size:10px;';

            const name=document.createElement('span');
            name.textContent=def.name+(def.unit?' ('+def.unit+')':'');
            name.style.cssText='min-width:110px;max-width:180px;font-weight:600;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            name.title=def.name+(def.unit?' ('+def.unit+')':'');

            const foundEl=document.createElement('span');
            foundEl.textContent=`✓ ${found}`;
            foundEl.style.cssText='color:#2e7d32;font-weight:600;white-space:nowrap;';
            foundEl.title=`Найден у ${found} из ${total} карточек`;

            const absentEl=document.createElement('span');
            absentEl.textContent=`✕ ${absent}`;
            absentEl.style.cssText='color:#c62828;font-weight:600;white-space:nowrap;';
            absentEl.title=`Не найден у ${absent} из ${total} карточек`;

            const percent=document.createElement('span');
            percent.textContent=`${pct}%`;
            percent.style.cssText='color:#777;min-width:32px;white-space:nowrap;';
            percent.title=`Заполненность: ${pct}%`;

            const valuesEl=document.createElement('span');
            const valueText=topValues.length
                ? topValues.map(([value,count])=>`${value} ×${count}`).join(' · ') + (distinct>topValues.length?` · +${distinct-topValues.length}`:'')
                : '—';
            valuesEl.textContent=valueText;
            valuesEl.style.cssText='color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:100px;';
            valuesEl.title=topValues.length
                ? `Уникальных значений: ${distinct}. Частые значения: ${topValues.map(([value,count])=>`${value} — ${count}`).join('; ')}${distinct>topValues.length?'; и другие':''}`
                : 'Значений не найдено';

            row.append(name,foundEl,absentEl,percent,valuesEl);
            extraControlsBody.appendChild(row);
        }
    }
    refreshExtraControls();

    return { extraControls, refreshExtraControls };
}
