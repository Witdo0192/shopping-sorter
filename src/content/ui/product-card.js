// Представление отдельной карточки: изображение, поля, масштаб и сохранённый HTML.
// Зависит от полей, метрик, количеств и функций хранения изображений.

// Масштаб шрифта и высота текстового блока карточки «Сохранённые» в зависимости
// от ползунка размера карточек (120–320px). Без этого при увеличении карточек
// текст оставался мелким, а фиксированный бюджет высоты (раньше — константа)
// не вмещал новые строки рейтинга/доставки, и карточки наезжали друг на друга.
function getSavedTileFontScale(cardScale) {
    const factor = cardScale / 180;
    return Math.min(1.35, Math.max(0.85, factor));
}
function getSavedTileBodyHeight(cardScale) {
    return Math.round(150 * getSavedTileFontScale(cardScale));
}

// Выбирает именно основную фотографию товара, а не маленькую иконку/бейдж.
// На некоторых сайтах первая <img> внутри карточки — это SVG-иконка акции,
// поэтому простой querySelector('img') давал неправильную картинку в «Своём» стиле.
function getBestProductImage(tile) {
    if (!tile) return null;

    const candidates = [...tile.querySelectorAll('img[src], img[data-src], img[data-url]')];
    if (!candidates.length) return null;

    const title = (getTileTitle(tile) || '').toLowerCase();
    const scored = candidates.map((img, index) => {
        const src = img.currentSrc || img.src || img.dataset?.src || img.dataset?.url || '';
        const srcLower = String(src).toLowerCase();
        const rect = img.getBoundingClientRect?.() || { width: 0, height: 0 };
        const naturalArea = (img.naturalWidth || 0) * (img.naturalHeight || 0);
        const renderedArea = Math.max(0, rect.width * rect.height);
        let score = 0;

        // Основное изображение обычно заметно крупнее иконок.
        score += Math.log10(1 + Math.max(naturalArea, renderedArea * 100)) * 100;
        if (naturalArea >= 120 * 120) score += 120;
        if (renderedArea >= 120 * 80) score += 120;

        // SVG/служебные картинки почти всегда являются иконками, а не фото товара.
        if (/\.svg(?:[?#]|$)/i.test(srcLower) || srcLower.startsWith('data:image/svg')) score -= 500;

        const inButton = !!img.closest('button, [role="button"]');
        if (inButton) score -= 350;

        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const imgTitle = (img.getAttribute('title') || '').toLowerCase();
        if (title && (alt.includes(title) || title.includes(alt) && alt.length > 8)) score += 160;
        if (alt.length > 8) score += 15;
        if (imgTitle.length > 8) score += 10;

        // Небольшие изображения, которые явно являются иконками, понижаем.
        if (Math.max(rect.width, rect.height) < 70 && naturalArea < 70 * 70) score -= 180;

        return { img, score, index };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored[0]?.img || null;
}

// Текст для строки «⭐ рейтинг · 💬 отзывы» — возвращает '' если данных нет
function formatRatingReviewsDisplay(rating, reviews) {
    const parts = [];
    if (rating != null && !Number.isNaN(rating)) parts.push(`⭐ ${rating.toLocaleString('ru-RU')}`);
    if (reviews != null && !Number.isNaN(reviews)) parts.push(`💬 ${reviews.toLocaleString('ru-RU')}`);
    return parts.join(' · ');
}

// Текст для строки «🚚 дата доставки» — возвращает '' если данных нет
function formatDeliveryDisplay(deliveryTs) {
    if (deliveryTs == null || Number.isNaN(deliveryTs)) return '';
    const d = new Date(deliveryTs);
    if (Number.isNaN(d.getTime())) return '';
    return `🚚 ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

// Проставляет/обновляет data-атрибуты и видимые строки цены/рейтинга/отзывов/доставки
// на уже построенном элементе .ss-tile (используется и для live-DOM, и для патча html)
function applySavedDataToTileEl(tileEl, data, currency) {
    if (data.price != null && data.price < 99999999) {
        tileEl.dataset.ssPrice = String(data.price);
        const priceEl = tileEl.querySelector('.ss-tile__price');
        if (priceEl) priceEl.textContent = `${data.price.toLocaleString('ru-RU')} ${currency}`;
    }

    tileEl.dataset.ssRating = data.rating != null ? String(data.rating) : '';
    tileEl.dataset.ssReviews = data.reviews != null ? String(data.reviews) : '';
    tileEl.dataset.ssDelivery = data.delivery != null ? String(data.delivery) : '';

    const ratingText = formatRatingReviewsDisplay(data.rating, data.reviews);
    let ratingEl = tileEl.querySelector('.ss-tile__rating');
    if (ratingText) {
        if (!ratingEl) {
            ratingEl = document.createElement('div');
            ratingEl.className = 'ss-tile__rating';
            (tileEl.querySelector('.ss-tile__price') || tileEl.querySelector('.ss-tile__title'))
                ?.insertAdjacentElement('afterend', ratingEl);
        }
        ratingEl.textContent = ratingText;
    } else {
        ratingEl?.remove();
    }

    const deliveryText = formatDeliveryDisplay(data.delivery);
    let deliveryEl = tileEl.querySelector('.ss-tile__delivery');
    if (deliveryText) {
        if (!deliveryEl) {
            deliveryEl = document.createElement('div');
            deliveryEl.className = 'ss-tile__delivery';
            (tileEl.querySelector('.ss-tile__rating') || tileEl.querySelector('.ss-tile__price'))
                ?.insertAdjacentElement('afterend', deliveryEl);
        }
        deliveryEl.textContent = deliveryText;
    } else {
        deliveryEl?.remove();
    }
}


// Стандартная (своя) карточка расширения для вкладки «Поиск».
// Использует тот же стиль, что и вкладка «Сохранённые», но данные берёт
// напрямую из живой карточки сайта — без сохранения товара.
function createCustomSearchTile(tile, cardScale = 180) {
    const key = getTileKey(tile) || '';
    const title = getTileTitle(tile) || '—';
    const price = getPrice(tile);
    const rating = getRating(tile);
    const reviews = getReviewsCount(tile);
    const delivery = getDeliveryDate(tile);
    const currency = detectCurrency();

    const url = getTileUrl(tile);

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const imgEl = getBestProductImage(tile);
    const imgSrc = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
    const priceDisplay = price < 99999999 ? `${price.toLocaleString('ru-RU')} ${currency}` : '—';
    const ratingText = formatRatingReviewsDisplay(rating, reviews);
    const deliveryText = formatDeliveryDisplay(delivery);

    const root = document.createElement('div');
    root.className = 'ss-tile ss-tile--search-custom';
    root.dataset.ssKey = key;
    root.dataset.ssTitle = title;
    root.dataset.ssPrice = String(price);
    root.dataset.ssRating = rating != null ? String(rating) : '';
    root.dataset.ssReviews = reviews != null ? String(reviews) : '';
    root.dataset.ssDelivery = delivery != null ? String(delivery) : '';
    root.dataset.ssSite = window.location.hostname;
    root.dataset.ssUrl = url;
    // Высота картинки масштабируется вместе с шириной карточки.
    root.style.setProperty('--tile-img-height', Math.round(cardScale * 0.9) + 'px');
    root.style.setProperty('--tile-font-scale', getSavedTileFontScale(cardScale));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'ss-tile__img-wrap';
    if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = title;
        img.loading = 'lazy';
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'display:block; width:100%; height:100%;';
            a.addEventListener('click', e => e.stopPropagation());
            a.appendChild(img);
            imgWrap.appendChild(a);
        } else {
            imgWrap.appendChild(img);
        }
    } else {
        const noImg = document.createElement('div');
        noImg.className = 'ss-tile__no-img';
        noImg.textContent = '📦';
        imgWrap.appendChild(noImg);
    }
    root.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'ss-tile__body';

    const titleEl = document.createElement('div');
    titleEl.className = 'ss-tile__title';
    if (url) {
        const titleLink = document.createElement('a');
        titleLink.href = url;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.textContent = title;
        titleLink.style.cssText = 'color:inherit; text-decoration:none;';
        titleLink.addEventListener('click', e => e.stopPropagation());
        titleEl.appendChild(titleLink);
    } else {
        titleEl.textContent = title;
    }
    body.appendChild(titleEl);

    const priceEl = document.createElement('div');
    priceEl.className = 'ss-tile__price';
    priceEl.textContent = priceDisplay;
    body.appendChild(priceEl);

    if (ratingText) {
        const el = document.createElement('div');
        el.className = 'ss-tile__rating';
        el.textContent = ratingText;
        body.appendChild(el);
    }
    if (deliveryText) {
        const el = document.createElement('div');
        el.className = 'ss-tile__delivery';
        el.textContent = deliveryText;
        body.appendChild(el);
    }

    const siteEl = document.createElement('div');
    siteEl.className = 'ss-tile__site';
    siteEl.textContent = window.location.hostname;
    body.appendChild(siteEl);

    root.appendChild(body);
    return root;
}

async function buildNormalizedTileHtml(tile) {
    const key = getTileKey(tile);
    const title = getTileTitle(tile);
    const price = getPrice(tile);
    const rating = getRating(tile);
    const reviews = getReviewsCount(tile);
    const delivery = getDeliveryDate(tile);
    const currency = detectCurrency();

    // ищем картинку и сохраняем в background IndexedDB асинхронно
    const imgEl = getBestProductImage(tile);
    const imgSrc = imgEl?.currentSrc || imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.url || '';
    if (imgSrc && key) saveImageToBackground(key, imgSrc);

    // абсолютный URL
    const url = getTileUrl(tile);

    const site = window.location.hostname;
    const priceDisplay = price < 99999999 ? `${price.toLocaleString('ru-RU')} ${currency}` : '—';
    const ratingText = formatRatingReviewsDisplay(rating, reviews);
    const deliveryText = formatDeliveryDisplay(delivery);

    // html не содержит base64 — картинка подгружается при рендере из IndexedDB
    const html = `<div class="ss-tile"
        data-ss-key="${(key || '').replace(/"/g, '&quot;')}"
        data-ss-title="${(title || '').replace(/"/g, '&quot;')}"
        data-ss-price="${price}"
        data-ss-rating="${rating ?? ''}"
        data-ss-reviews="${reviews ?? ''}"
        data-ss-delivery="${delivery ?? ''}"
        data-ss-site="${site}"
        data-ss-url="${url.replace(/"/g, '&quot;')}">
        <div class="ss-tile__img-wrap ss-tile__img-loading">
            <div class="ss-tile__no-img">📦</div>
        </div>
        <div class="ss-tile__body">
            <div class="ss-tile__title">${url ? `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onclick="event.stopPropagation()">${(title || '—').replace(/</g, '&lt;')}</a>` : (title || '—').replace(/</g, '&lt;')}</div>
            <div class="ss-tile__price">${priceDisplay}</div>
            ${ratingText ? `<div class="ss-tile__rating">${ratingText}</div>` : ''}
            ${deliveryText ? `<div class="ss-tile__delivery">${deliveryText}</div>` : ''}
            <div class="ss-tile__site">${site}</div>
        </div>
    </div>`;
    return html;
}
