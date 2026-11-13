// Страница «Сохранённые товары»: сама открывает обычную панель расширения
// поверх пустой страницы — отдельного нажатия «Открыть товары» не требуется.
// Скрипты панели подключены в saved-products.html перед этим файлом.
(function () {
    // content.js загружает настройки сайтов и единицы асинхронно, и до их
    // готовности создание панели может падать. Поэтому пробуем повторно,
    // пока панель не появится (до ~10 секунд).
    const RETRY_MS = 150;
    const MAX_ATTEMPTS = 70;
    let attempts = 0;

    function watchClosed() {
        // Когда панель закрыта (кнопка или Esc), закрываем и саму вкладку.
        const timer = setInterval(() => {
            if (globalThis._ssClosePopup) return;
            clearInterval(timer);
            window.close();
        }, 300);
    }

    function tryOpen() {
        attempts++;
        try {
            globalThis.createSortedProductsPopup('asc');
            if (document.getElementById('products-sorted-popup')) {
                watchClosed();
                return;
            }
        } catch (error) {
            if (attempts >= MAX_ATTEMPTS) console.error('Не удалось открыть панель сохранённых товаров:', error);
        }
        if (attempts < MAX_ATTEMPTS) setTimeout(tryOpen, RETRY_MS);
    }

    if (document.readyState === 'complete') tryOpen();
    else window.addEventListener('load', tryOpen);
})();
