// Нормализация стандартных и пользовательских профилей сайтов.
// Не обращается к DOM и хранилищу.

function normalizeSelectorProfiles(config) {
    if (!config) return [];
    const raw = Array.isArray(config.cards) ? config.cards
        : (Array.isArray(config.profiles) ? config.profiles : null);
    if (raw?.length) {
        return raw.map((p, i) => ({
            name: p?.name || `Карточка ${i + 1}`,
            tile: p?.tile || '',
            price: p?.price ?? '',
            title: p?.title ?? '',
            link: p?.link ?? '',
            id: p?.id ?? '',
            idConfig: p?.idConfig || null,
            extras: Array.isArray(p?.extras) ? p.extras : [],
            reviews: p?.reviews ?? '',
            rating: p?.rating ?? '',
            delivery: p?.delivery ?? '',
            weight: p?.weight ?? '',
        })).filter(p => p.tile || p.name);
    }
    const extras = Array.isArray(config.tileExtra) ? config.tileExtra.filter(Boolean) : (config.tileExtra ? [config.tileExtra] : []);
    const legacy = { ...config };
    delete legacy.cards; delete legacy.profiles; delete legacy.tileExtra;
    const profiles = [];
    if (legacy.tile) profiles.push({
        name: legacy.name || 'Карточка 1',
        tile: Array.isArray(legacy.tile) ? legacy.tile[0] : legacy.tile,
        price: legacy.price ?? '',
        title: legacy.title ?? '',
        link: legacy.link ?? '',
        id: legacy.id ?? '',
        extras: Array.isArray(legacy.extras) ? legacy.extras : [],
        reviews: legacy.reviews ?? '',
        rating: legacy.rating ?? '',
        delivery: legacy.delivery ?? '',
        weight: legacy.weight ?? '',
    });
    extras.forEach(tile => profiles.push({
        name: `Карточка ${profiles.length + 1}`,
        tile, price:'', title:'', link:'', id:'', extras:[], reviews:'', rating:'', delivery:'', weight:''
    }));
    return profiles;
}
