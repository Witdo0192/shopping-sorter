document.addEventListener('DOMContentLoaded', function () {
    const status = document.getElementById('status');
    document.getElementById('settings').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    document.getElementById('selectors').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tab = tabs[0];
            if (!tab?.id) return;
            chrome.tabs.sendMessage(tab.id, { action: 'openSelectorPicker' }, () => {
                if (chrome.runtime.lastError) {
                    status.textContent = '❌ Обновите страницу и попробуйте снова';
                } else {
                    window.close();
                }
            });
        });
    });

    // Переключатель самого расширения: в выключенном состоянии content script
    // прекращает наблюдать страницу и выполнять периодические пересборы.
    const extensionEnabledToggle = document.getElementById('extensionEnabledToggle');
    const extensionStatusLabel = document.getElementById('extensionStatusLabel');
    function updateExtensionLabel(enabled) {
        extensionStatusLabel.textContent = enabled ? 'Расширение включено' : 'Расширение выключено';
    }
    chrome.storage.local.get(['extensionEnabled'], d => {
        const enabled = d.extensionEnabled !== false;
        extensionEnabledToggle.checked = enabled;
        updateExtensionLabel(enabled);
    });
    extensionEnabledToggle.addEventListener('change', () => {
        const enabled = extensionEnabledToggle.checked;
        chrome.storage.local.set({ extensionEnabled: enabled });
        updateExtensionLabel(enabled);
    });

    // Чекбокс «Показывать счётчик найденных карточек на странице»
    const liveCounterToggle = document.getElementById('liveCounterToggle');
    chrome.storage.local.get(['liveCounterEnabled'], d => {
        liveCounterToggle.checked = !!d.liveCounterEnabled;
    });
    liveCounterToggle.addEventListener('change', () => {
        chrome.storage.local.set({ liveCounterEnabled: liveCounterToggle.checked });
    });

    function openPopup() {
        status.textContent = 'Открываем...';
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tab = tabs[0];
            chrome.tabs.sendMessage(tab.id, { action: 'sortProducts', mode: 'asc' }, function (response) {
                if (chrome.runtime.lastError) {
                    status.textContent = '❌ Ошибка: обновите страницу';
                    return;
                }
                if (response?.reason === 'disabled') {
                    status.textContent = '⏸️ Расширение выключено';
                } else if (response?.reason === 'unsupported') {
                    status.textContent = '⚠️ Сайт не поддерживается — доступны только сохранённые';
                } else if (response?.success) {
                    status.textContent = response.count > 0
                        ? `✅ Найдено: ${response.count} товаров`
                        : '✅ Готово';
                } else {
                    status.textContent = '⚠️ Товары не найдены — прокрутите страницу';
                }
            });
        });
    }

    document.getElementById('open').addEventListener('click', openPopup);
});