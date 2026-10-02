// Кэш вариантов для автодополнения.
// dependencies связывает эту часть с состоянием и действиями панели.
function createAttributeSuggestions(dependencies) {
    const PRIMARY_ATTR_HINTS = [
        { name: 'название', kind: 'primary-text', staticHint: 'обычный текстовый поиск, например @название(корм*)' },
        { name: 'цена', kind: 'primary-number', vals: 'priceVals', unit: '₽' },
        { name: 'цена/ед.', kind: 'primary-number', vals: 'unitVals' },
        { name: 'рейтинг', kind: 'primary-number', vals: 'ratingVals' },
        { name: 'отзывы', kind: 'primary-number', vals: 'reviewsVals' },
        { name: 'доставка', kind: 'primary-date', vals: 'deliveryVals' },
    ];

    let attributeSuggestCache = [];

    function rebuildAttributeSuggestCache(tiles, primaryVals) {
        const entries = [];

        for (const def of PRIMARY_ATTR_HINTS) {
            if (def.kind === 'primary-number') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                const d = def.name === 'цена/ед.' ? getUnitPriceDecimalsForPriority() : (def.name === 'рейтинг' ? undefined : 0);
                const min = Math.min(...vals), max = Math.max(...vals);
                const fmt = v => d != null ? v.toFixed(d) : String(v);
                entries.push({ name: def.name, kind: def.kind, hint: `${fmt(min)} – ${fmt(max)}` });
            } else if (def.kind === 'primary-date') {
                const vals = primaryVals[def.vals] || [];
                if (!vals.length) { entries.push({ name: def.name, kind: def.kind, hint: null }); continue; }
                entries.push({ name: def.name, kind: def.kind, hint: `${formatDateToString(Math.min(...vals))} – ${formatDateToString(Math.max(...vals))}` });
            } else {
                entries.push({ name: def.name, kind: def.kind, hint: def.staticHint || null, static: true });
            }
        }

        // Настраиваемые (дополнительные) атрибуты — те же данные, что уже
        // используются панелью «Доп. атрибуты и величины» ниже.
        let extraDefs = [];
        try { extraDefs = getExtraDefinitions(tiles); } catch { extraDefs = []; }
        for (const def of extraDefs) {
            const name = def.name;
            if (!name) continue;
            let hint = null;
            if (def.kind === 'quantity') {
                const nums = def.values.map(parseExtraNumber).filter(v => v != null);
                if (nums.length) {
                    const min = Math.min(...nums), max = Math.max(...nums);
                    hint = `${min}${def.unit ? ' ' + def.unit : ''} – ${max}${def.unit ? ' ' + def.unit : ''}`;
                }
            } else {
                const freq = new Map();
                for (const raw of def.values) {
                    for (const v of String(raw).split(' | ').map(s => s.trim()).filter(Boolean)) {
                        freq.set(v, (freq.get(v) || 0) + 1);
                    }
                }
                const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
                if (top.length) hint = top.join(', ') + (freq.size > top.length ? ', …' : '');
            }
            entries.push({ name, kind: def.kind === 'quantity' ? 'extra-quantity' : 'extra-text', hint });
        }

        attributeSuggestCache = entries;
        dependencies.refreshAttributeAutocompleteUi();
    }

    // ── Кнопка «Сбросить всё» ──
    return { get attributeSuggestCache() { return attributeSuggestCache; }, rebuildAttributeSuggestCache };
}
