// Фильтрация и сортировка текущих данных. UI-состояние передаётся явно через dependencies.
// Геттеры читают текущее состояние; сеттеры сохраняют изменения в панели.
function createProductFilters(dependencies) {
    function getCounterSortMode(searchQuery) {
        const rules = parseSortRulesFromQuery(searchQuery);
        const first = rules[0];
        if (!first) return dependencies.currentMode;
        const n = normalizeSortFieldName(first.field);
        const dir = first.direction || 'asc';
        if (['цена/ед.','цена/ед','цена за ед.','цена за единицу','price/unit'].includes(n)) {
            return dir === 'desc' ? 'per-gram-desc' : 'per-gram-asc';
        }
        return dependencies.currentMode;
    }

    // Правила сортировки: src/content/products/sorting.js

    function getFilteredAndSorted(searchQuery, sourceTiles = null) {
        let tiles = sourceTiles ? [...sourceTiles] : [...seenTiles.values()];

        const sortRules = parseSortRulesFromQuery(searchQuery);
        const filterQuery = stripSortRulesFromQuery(searchQuery);
        if (filterQuery) {
            const tokens = parseSearchQuery(filterQuery);
            tiles = tiles.filter(tile => matchesTileSearchTokens(tile, tokens));
        }

        tiles = tiles.filter(tile => {
            if (getPrice(tile) === 99999999) return dependencies.typeFilter.noPrice ?? true;
            const results = getAllUnitResults(tile);
            if (!results.length) return dependencies.typeFilter.none;
            const categories = new Set(results.map(r=>r.category).filter(Boolean));
            // Карточка с несколькими величинами принадлежит сразу нескольким
            // категориям: «85 г × 30 шт» одновременно видна в «По весу» и «Штучные».
            return [...categories].some(category => dependencies.typeFilter[category] ?? true);
        });

        tiles.sort((a, b) => {
            if (sortRules.length) return compareByDslSortRules(a, b, sortRules);
            const isPerUnit = dependencies.currentMode.includes('per-gram');
            const isReviews = dependencies.currentMode.startsWith('reviews');
            const isRating = dependencies.currentMode.startsWith('rating');
            const isDelivery = dependencies.currentMode.startsWith('delivery');
            const desc = dependencies.currentMode.includes('desc');

            if (isPerUnit) {
                // Сортировка использует ровно тот же канонический расчёт,
                // что и фильтр/бейдж: ₽/кг, ₽/л, ₽/шт или ₽/м.
                const ppgA = getPricePerUnit(a);
                const ppgB = getPricePerUnit(b);
                const hasA = !!ppgA;
                const hasB = !!ppgB;

                // Товары без величины — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;

                // Оба без величины — сортируем по цене с учётом направления
                if (!hasA && !hasB) {
                    const diff = getPrice(a) - getPrice(b);
                    return desc ? -diff : diff;
                }

                const diff = ppgA.value - ppgB.value;
                if (diff !== 0) return desc ? -diff : diff;
            }

            if (isReviews || isRating || isDelivery) {
                const getVal = isReviews ? getReviewsCount : isRating ? getRating : getDeliveryDate;
                const valA = getVal(a);
                const valB = getVal(b);
                const hasA = valA !== null;
                const hasB = valB !== null;

                // Товары без данных (нет селектора/не распарсилось) — в конец
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;
                if (!hasA && !hasB) return 0;

                const diff = valA - valB;
                return desc ? -diff : diff;
            }

            const valA = getSortValue(a, dependencies.currentMode);
            const valB = getSortValue(b, dependencies.currentMode);
            return desc ? valB - valA : valA - valB;
        });

        // Фильтр по полной цене
        const minVal = parseFloat(dependencies.priceMin.value);
        const maxVal = parseFloat(dependencies.priceMax.value);
        if (!isNaN(minVal) || !isNaN(maxVal)) {
            tiles = tiles.filter(tile => {
                const val = getPrice(tile);
                if (val >= 99999999) return true; // без цены — пропускаем
                if (!isNaN(minVal) && val < minVal) return false;
                if (!isNaN(maxVal) && val > maxVal) return false;
                return true;
            });
        }

        // Фильтр по цене/единице (независимый)
        const minUnit = parseFloat(dependencies.priceUnitMin.value);
        const maxUnit = parseFloat(dependencies.priceUnitMax.value);
        if (!isNaN(minUnit) || !isNaN(maxUnit)) {
            tiles = tiles.filter(tile => {
                const ppg = getPricePerUnit(tile);
                if (!ppg) return true; // без величины — пропускаем
                const val = ppg.value;
                if (!isNaN(minUnit) && val < minUnit) return false;
                if (!isNaN(maxUnit) && val > maxUnit) return false;
                return true;
            });
        }

        // Фильтр по рейтингу (независимый)
        const minRating = parseFloat(dependencies.ratingMin.value);
        const maxRating = parseFloat(dependencies.ratingMax.value);
        if (!isNaN(minRating) || !isNaN(maxRating)) {
            tiles = tiles.filter(tile => {
                const val = getRating(tile);
                if (val === null) return true; // без рейтинга — пропускаем
                if (!isNaN(minRating) && val < minRating) return false;
                if (!isNaN(maxRating) && val > maxRating) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minReviews = parseFloat(dependencies.reviewsMin.value);
        const maxReviews = parseFloat(dependencies.reviewsMax.value);
        if (!isNaN(minReviews) || !isNaN(maxReviews)) {
            tiles = tiles.filter(tile => {
                const val = getReviewsCount(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minReviews) && val < minReviews) return false;
                if (!isNaN(maxReviews) && val > maxReviews) return false;
                return true;
            });
        }

        // Фильтр по количеству отзывов (независимый)
        const minDelivery = dependencies.deliveryMin.value ? parseStrictDate(dependencies.deliveryMin.value, 'start') : NaN;
        const maxDelivery = dependencies.deliveryMax.value ? parseStrictDate(dependencies.deliveryMax.value, 'end') : NaN;
        if (!isNaN(minDelivery) || !isNaN(maxDelivery)) {
            tiles = tiles.filter(tile => {
                const val = getDeliveryDate(tile);
                if (val === null) return true; // без данных — пропускаем
                if (!isNaN(minDelivery) && val < minDelivery) return false;
                if (!isNaN(maxDelivery) && val > maxDelivery) return false;
                return true;
            });
        }

        return tiles;
    }

    return { getCounterSortMode, getFilteredAndSorted };
}
