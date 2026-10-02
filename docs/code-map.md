# Карта текущего кода

Описывает существующую структуру по чтению исходников 2026-10-02.
Обновляется вместе с переносами кода. Имена функций — ориентиры для поиска;
номера строк намеренно не фиксируем, поскольку они изменяются.
Целевая архитектура пока не согласована.

## Точки входа и контексты

| Файл | Ответственность и запуск |
| --- | --- |
| `manifest.json` | Manifest V3, разрешения, подключение скриптов, popup и настроек |
| `background.js` | Service worker: сообщения, получение изображений, IndexedDB, очистка неиспользуемых изображений при установке и старте |
| `popup.html`, `popup.js` | Маленькое окно по значку расширения; обработчики регистрируются на DOMContentLoaded |
| `settings.html`, `settings.js` | Страница настроек; обработчики и вызов `init()` находятся в самом скрипте |
| `search.js`, `content.js` | Content scripts страницы магазина, загружаются в этом порядке |
| `sites.json` | Стандартные домены, селекторы полей и профили карточек |
| `units.json` | Стандартные категории, единицы, множители, точность и приоритеты |
| `icons/` | Значки расширения |

Это разные контексты выполнения. Popup не вызывает функции content script
напрямую: отправляет сообщения активной вкладке. Settings и background также
не разделяют с content script обычные переменные.

## Основные потоки

1. `manifest.json` загружает `search.js`, затем `content.js` на подходящей странице.
2. `content.js` читает флаги из `chrome.storage.local`; при включённом расширении
   вызывает `init()` → `loadSelectors()` → `collectTiles()` и подключает наблюдение страницы.
3. `loadSelectors()` читает стандартные JSON и пользовательские `sites`/`units`.
   Сохранённая конфигурация имеет приоритет над стандартной.
4. Popup отправляет `sortProducts` → обработчик `chrome.runtime.onMessage` в
   `content.js` → `createSortedProductsPopup()`. Большая панель создаётся в DOM страницы.
5. Поиск и фильтры панели используют `parseSearchQuery()` и `matchesTileSearchTokens()`.
6. Метаданные товаров проходят через `getSavedTiles()` / `saveTiles()`;
   изображения — через сообщения к `background.js` и IndexedDB.
7. Подбор селекторов сохраняет `_selectorDiffPending` и отправляет `openSettings`.
   Настройки показывают `renderDiffModal()` и применяют выбранную конфигурацию.

## Блоки content.js

| Задача | Где искать |
| --- | --- |
| Включение/выключение и очистка runtime | `setExtensionEnabled`, `removeExtensionRuntime`, `init`, обработчики `chrome.storage.onChanged` |
| Конфигурации сайтов и единиц | `loadSelectors`, `normalizeSelectorProfiles`, `normalizeUnitsConfig`, `hostnameMatchesDomain` |
| Эвристики и диагностика селекторов | `detectTilesHeuristic`, `tryHeuristicSelectors`, `scheduleBreakCheck` |
| Счётчик и причины отклонения карточек | `updateLiveCounterBadge`, `getCurrentDomTileCount`, `renderRejectedPanel` |
| Сохранение, удаление и обновление метаданных | `getSavedTiles`, `saveTiles`, `addToSaved`, `removeFromSaved`, `flushSavedDataUpdates` |
| Существующая миграция изображений из HTML | `migrateBase64FromHtml` |
| Извлечение данных товара | `getTileTitle`, `getTileId`, `getTileKey`, `getTileUrl`, `getPrice`, `getRating`, `getReviewsCount`, `getDeliveryDate`, `getExtraTileAttributes` |
| Единицы и цена за единицу | `getAllUnitResultsFromText`, `parseUnit`, `getUnitPriceOptions`, `getPreferredUnitPriceOption`, `getPricePerUnit` |
| Сбор и кэш данных страницы | `collectTiles`, `watchTileImage`, `getTileMetrics`, `invalidateTileMetricsCache` |
| Даты и значения сортировки | `parseDeliveryDate`, `parseStrictDate`, `getSortValue`, `getSortModeLabel` |
| Получение и сохранение изображений | `imgToBase64`, `saveImageToBackground`, `loadImagesFromBackground` |
| Создание карточек | `createCustomSearchTile`, `buildNormalizedTileHtml`, `applySavedDataToTileEl` |
| Визуальное сходство | `computePHash`, `computeColorHistogram`, `extractFeatures`, `groupTilesByVisualSimilarity` |
| Подбор селекторов | функции `picker*`, `openSelectorPickerPanel` |
| Большая панель товаров | `createSortedProductsPopup` и её вложенные функции |

Внутри `createSortedProductsPopup()` ищите `renderDeliveryCalendar` для календаря,
`renderSavedQueriesMenu` для запросов, `renderFolderRow` для папок,
`exportWithImages` для экспорта, `renderSavedTiles` для сохранённых,
`applyFilters` и `renderTiles` для фильтрации и отображения,
`closePopup` для закрытия. Поиск по изображению, автодополнение, синхронизация
полей фильтров и виртуализация также находятся в этой функции.

## Зависимости и состояние, важные перед переносом

- `search.js` объявляет функции без imports/exports. `content.js` вызывает их
  через общую область content scripts. При этом `matchesTileSearchTokens()`
  из `search.js` вызывает функции `content.js`: `getTileTitle`,
  `normalizePrimarySearchFieldName`, `getDeliveryDate`, `getSelectorProfileForTile`,
  `findAllWithinTileOrSelf`, `getExtraTileAttributes` и другие.
  Зависимость двусторонняя; это ещё не изолированный модуль поиска.
- `SELECTORS`, `SELECTOR_PROFILES`, `TILE_PROFILE_MAP` и `UNITS` описывают
  конфигурацию и сопоставление карточек; `seenTiles` хранит DOM-карточки страницы.
- `savedKeysCache` и очередь `pendingSavedDataUpdates` связывают сбор страницы
  с сохранёнными товарами. `unitPricePriority` используется и расчётами, и UI.
- Большая панель держит собственное состояние в замыкании, включая `currentTiles`,
  `currentSavedTiles`, выделение, фильтры и DOM-элементы. Эти переменные нельзя
  автоматически считать доступными функциям верхнего уровня.
- `window._ssClosePopup`, `window._ssRefreshSearch`, `window._invalidateGroupCache`
  и другие свойства `window` связывают части content script. Это связи внутри
  его контекста, а не общий API для popup, settings или скриптов магазина.
- Наблюдатели, таймеры, обработчики DOM, стили и блокировка прокрутки имеют
  жизненный цикл. При переносе UI изучайте создание и очистку вместе.

## Настройки и сообщения

В `settings.js`: `init` загружает конфигурации; `renderSiteList` / `makeSiteCard`
отвечают за сайты; `renderUnitsList` / `makeUnitCard` — за единицы;
`parseWithUnitsConfig` — за встроенный тестер единиц; `renderVirtualizationSetting`
— за порог виртуализации; `renderDiffModal` — за предложения подбора селекторов.
Импорт/экспорт и очистка данных подключены непосредственно к элементам по ID.
`localStorage` с ключом `shopping-sorter-site-view` хранит порядок просмотра сайтов.

Сообщения к content script: `sortProducts`, `openSelectorPicker`.
Сообщения к background: `openSettings`, `fetchImageAsBase64`, `setImage`,
`getImages`, `deleteImages`, `clearImages`, `pruneImages`, `getStorageSize`.
Перед изменением сообщения найдите отправителя и обработчик, включая формат ответа.

## Хранение и совместимость

- `chrome.storage.local`: `savedTiles`, `sites`, `units`, флаги и предпочтения UI;
  `ssBase64Migrated` — флаг существующей миграции; `_selectorDiffPending` — передача
  предложений настроек.
- IndexedDB: база `ShoppingSorterImages`, версия 1, store `images`, ключ записи `key`.
- Экспорт настроек: объект с `version`, `exported`, `sites`, `units`, `virtualizationThreshold`.
- Экспорт товаров: массив записей с доступным `imageDataUrl`; импорт требует `key`
  и `html`, отделяет изображение от метаданных и добавляет новые ключи.

Перенос кода должен сохранять эти контракты. Фактическое восстановление пока
не проверено; сценарии и ограничения находятся в [текущем состоянии](current-state.md).
