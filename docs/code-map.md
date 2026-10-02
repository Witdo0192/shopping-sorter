# Карта текущего кода

Описывает существующую структуру по чтению исходников 2026-10-02.
Обновляется вместе с переносами кода. Имена функций — ориентиры для поиска;
номера строк намеренно не фиксируем, поскольку они изменяются.
Три прохода разделения согласованы и выполнены. Ниже — фактическая структура,
включая оставшиеся общие зависимости. Большая панель вынесена, но её замыкание
ещё требует дальнейшего разделения.

## Точки входа и контексты

| Файл | Ответственность и запуск |
| --- | --- |
| `manifest.json` | Manifest V3, разрешения, подключение скриптов, popup и настроек |
| `background.js` | Service worker: сообщения, получение изображений, IndexedDB, очистка неиспользуемых изображений при установке и старте |
| `popup.html`, `popup.js` | Маленькое окно по значку расширения; обработчики регистрируются на DOMContentLoaded |
| `settings.html`, `settings.js` | Страница настроек; обработчики и вызов `init()` находятся в самом скрипте |
| `src/content/config/sites.js` | Нормализация стандартных и пользовательских профилей карточек |
| `src/content/config/units.js` | Нормализация единиц, точность, приоритеты и отображение категорий |
| `src/content/config/domains.js` | Нормализация и сравнение доменов |
| `src/content/images/similarity.js` | Признаки изображений, их кэш и группировка по сходству |
| `src/content/selectors/picker.js` | Подбор селекторов, подсветка, выбор элементов и сохранение конфигурации |
| `src/content/storage/saved-products.js` | Метаданные сохранённых товаров, обновления и миграция старых изображений |
| `src/content/products/fields.js` | Поля карточек, дополнительные атрибуты, ключи и проверка пригодности |
| `src/content/products/quantities.js` | Количества, цена за единицу, приоритеты и данные бейджей |
| `src/content/products/collection.js` | Сбор карточек, наблюдение изображений, кэш сохранённых ключей |
| `src/content/products/metrics.js` | Цены, рейтинг, отзывы, даты, разбор единиц и кэш метрик |
| `src/content/images/storage.js` | Получение изображений и сообщения к background |
| `src/content/ui/product-card.js` | Представление одной карточки и нормализованный HTML |
| `src/content/products/sorting.js` | Разбор @сортировка, получение значений полей и сравнение товаров |
| `src/content/ui/folder-dialog.js` | Получение папок и диалог выбора при сохранении |
| `src/content/ui/panel-styles.js` | Создание стилей панели и возврат узла для удаления при закрытии |
| `src/content/ui/products-panel.js` | Большая панель: композиция UI, события, фильтры и списки; остаётся около 6 000 строк |
| `search.js`, `content.js` | Поиск и оставшаяся логика страницы; загружаются после перечисленных файлов |
| `sites.json` | Стандартные домены, селекторы полей и профили карточек |
| `units.json` | Стандартные категории, единицы, множители, точность и приоритеты |
| `icons/` | Значки расширения |

Это разные контексты выполнения. Popup не вызывает функции content script
напрямую: отправляет сообщения активной вкладке. Settings и background также
не разделяют с content script обычные переменные.

## Основные потоки

1. `manifest.json` загружает выделенные файлы конфигураций, товаров, хранения и UI,
   затем `search.js` и `content.js` на подходящей странице.
2. `content.js` читает флаги из `chrome.storage.local`; при включённом расширении
   вызывает `init()` → `loadSelectors()` → `collectTiles()` и подключает наблюдение страницы.
3. `loadSelectors()` читает стандартные JSON и пользовательские `sites`/`units`.
   Сохранённая конфигурация имеет приоритет над стандартной.
4. Popup отправляет `sortProducts` → обработчик `chrome.runtime.onMessage` в
   `content.js` → `createSortedProductsPopup()` из `ui/products-panel.js`.
   Большая панель создаётся в DOM страницы.
5. Поиск и фильтры панели используют `parseSearchQuery()` и `matchesTileSearchTokens()`.
6. Метаданные товаров проходят через `getSavedTiles()` / `saveTiles()`;
   изображения — через сообщения к `background.js` и IndexedDB.
7. Подбор селекторов сохраняет `_selectorDiffPending` и отправляет `openSettings`.
   Настройки показывают `renderDiffModal()` и применяют выбранную конфигурацию.

## Где искать логику после переносов

| Задача | Где искать |
| --- | --- |
| Включение/выключение и очистка runtime | `setExtensionEnabled`, `removeExtensionRuntime`, `init`, обработчики `chrome.storage.onChanged` |
| Загрузка конфигураций | `loadSelectors` в `content.js`; нормализация и домены — в `src/content/config/` |
| Эвристики и диагностика селекторов | `detectTilesHeuristic`, `tryHeuristicSelectors`, `scheduleBreakCheck` |
| Счётчик и причины отклонения карточек | `updateLiveCounterBadge`, `getCurrentDomTileCount`, `renderRejectedPanel` |
| Сохранение, удаление, обновление и миграция | `storage/saved-products.js`: `getSavedTiles`, `saveTiles`, `addToSaved`, `removeFromSaved`, `flushSavedDataUpdates`, `migrateBase64FromHtml` |
| Извлечение полей и ключей | `products/fields.js`: `getTileTitle`, `getTileId`, `getTileKey`, `getTileUrl`, `getExtraTileAttributes` |
| Количества и цена за единицу | `products/quantities.js`: `getAllUnitResultsFromText`, `getUnitPriceOptions`, `getPreferredUnitPriceOption`, `getPricePerUnit` |
| Цены, рейтинг, отзывы, даты и разбор единиц | `products/metrics.js`: `getPrice`, `getRating`, `getReviewsCount`, `getDeliveryDate`, `parseUnit`, `getTileMetrics`, `getSortValue` |
| Сбор карточек страницы | `products/collection.js`: `collectTiles`, `watchTileImage`, `refreshSavedKeysCache` |
| Получение и сохранение изображений | `images/storage.js`: `imgToBase64`, `saveImageToBackground`, `loadImagesFromBackground` |
| Создание отдельных карточек | `ui/product-card.js`: `createCustomSearchTile`, `buildNormalizedTileHtml`, `applySavedDataToTileEl` |
| Визуальное сходство | `src/content/images/similarity.js`: `computePHash`, `computeColorHistogram`, `extractFeatures`, `groupTilesByVisualSimilarity` |
| Подбор селекторов | `src/content/selectors/picker.js`: функции `picker*`, `openSelectorPickerPanel` |
| Сортировка из поисковой строки | `products/sorting.js`: `parseSortRulesFromQuery`, `stripSortRulesFromQuery`, `getDslSortFieldValue`, `compareByDslSortRules` |
| Диалог папок | `ui/folder-dialog.js`: `getAllFoldersGlobal`, `showSaveFolderDialog` |
| Стили панели | `ui/panel-styles.js`: `createProductsPanelStyle` |
| Большая панель товаров | `ui/products-panel.js`: `createSortedProductsPopup` и её вложенные функции |

В `ui/products-panel.js` внутри `createSortedProductsPopup()` ищите `renderDeliveryCalendar` для календаря,
`renderSavedQueriesMenu` для запросов, `renderFolderRow` для папок,
`exportWithImages` для экспорта, `renderSavedTiles` для сохранённых,
`applyFilters` и `renderTiles` для фильтрации и отображения,
`closePopup` для закрытия. Поиск по изображению, автодополнение, синхронизация
полей фильтров и виртуализация также находятся в этой функции.

## Зависимости и состояние, важные перед переносом

Пути в таблице выше без `src/content/` относительны к этой папке.

- Пока используются обычные скрипты из массива `content_scripts[].js`, без
  imports/exports и сборки. Они разделяют область content scripts. Новые файлы
  содержат объявления функций и состояние; обращения к DOM и состоянию
  основного файла выполняются при вызове функций после загрузки скриптов.
  При добавлении файла явно подключайте его в manifest; один перенос в папку не загружает код.
- `sites.js` и `domains.js` не зависят от DOM или хранилища. В `units.js`
  нормализация чистая, но функции отображения и порядка читают `UNITS` из `content.js`.
- `similarity.js` владеет вычислениями и `_featureCache`, который пока читается
  панелью напрямую. `groupTilesByVisualSimilarity()` использует `getTileKey`
  из `content.js`; `getImgSrc` передаётся вызывающей стороной.
- Точка входа picker — `openSelectorPickerPanel(hooks)`: hooks передают текущую
  конфигурацию, уведомления, перезагрузку конфигурации и действия панели.
  Picker также использует `CURRENT_PAGE_LINK_SELECTOR`, нормализацию конфигураций
  и доменов, `extractConfiguredElementValue`, `getConfiguredFieldText`,
  `getAllUnitResultsFromText` и `fmtUnit`. Подсветка, режим выбора, DOM и их
  очистка перенесены вместе. Это отдельный файл функции продукта, пока не
  полностью изолированный модуль; не копируйте его без перечисленных зависимостей.
- `search.js` объявляет функции без imports/exports. `content.js` вызывает их
  через общую область content scripts. При этом `matchesTileSearchTokens()`
  из `search.js` вызывает функции выделенных файлов товаров: `getTileTitle`,
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
- `products/fields.js`, `quantities.js` и `metrics.js` связаны вызовами друг
  друга и текущей конфигурацией. Сбор использует их результаты и обновляет
  метаданные через `storage/saved-products.js`. `savedKeysCache` пока принадлежит
  файлу collection и используется также хранением.
- Вызовы начальной миграции `migrateBase64FromHtml()` и обновления кэша
  `refreshSavedKeysCache()` оставлены в `content.js`: подключение файла хранения
  или сбора само по себе не запускает эти действия раньше инициализации.
- `ui/product-card.js` отвечает за одну карточку, не за всю панель. Её поля
  берутся из файлов products, а изображения — через images/storage.
- `products/sorting.js` не читает состояние панели; получает товары и правила
  аргументами, а значения извлекает через функции products. Выбранный кнопками
  `currentMode`, фильтрация и управление отображением остаются внутри панели.
  Разбор DSL используется и поиском, и сохранёнными товарами, и синхронизацией UI.
- `createProductsPanelStyle()` подключает style к document.head и возвращает
  тот же узел. Панель удаляет его при закрытии; жизненный цикл сохранён.
- `content.js` теперь около 1 000 строк: runtime, загрузка конфигурации,
  эвристики, счётчик и сообщения. Панель остаётся большим отдельным участком,
  не считайте её внутреннюю архитектуру законченной из-за перемещения файла.

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
