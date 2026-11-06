const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createEnvironment} = require('./helpers/content-environment.cjs');

function prepare(prices) {
    const env = createEnvironment();
    env.context.fixtures = prices.map((price, i) => Object.assign(new env.FakeElement('div'), {price, textContent: 'товар ' + i, dataset: {testKey: 'k' + i}}));
    vm.runInContext(
        "getPrice = tile => tile.price; getAllUnitResults = () => []; getPricePerUnit = () => null; " +
        "getPpgBadgeInfo = () => null; getTileKey = tile => tile.dataset.testKey; getDeliveryDate = () => null; " +
        "fixtures.forEach(tile => { registerTileOrigin(getTileKey(tile)); seenTiles.set(getTileKey(tile), tile); });",
        env.context
    );
    return env;
}

test('номер присваивается один раз в порядке первого появления и не меняется', () => {
    const env = prepare([100, 200, 300]);
    const index = i => vm.runInContext(`getTileOriginIndex(fixtures[${i}])`, env.context);
    assert.deepEqual([0, 1, 2].map(index), [1, 2, 3]);
    vm.runInContext("registerTileOrigin('k0'); registerTileOrigin('новая');", env.context);
    assert.equal(index(0), 1);
    assert.equal(vm.runInContext("tileOriginIndex.get('новая')", env.context), 4);
    assert.equal(vm.runInContext("getTileOriginIndex(null)", env.context), null);
});

test('плашка скрыта по умолчанию, включается настройкой и хранит исходный номер после сортировки', () => {
    const env = prepare([100, 200]);
    vm.runInContext("createSortedProductsPopup()", env.context);
    env.flushStorage();
    const grid = env.document.querySelector('.products-grid');
    const badges = () => grid.children.map(w => {
        const b = w.querySelector('.ss-index-badge');
        return b && {text: b.textContent, display: b.style.display, bottom: b.style.bottom, left: b.style.left};
    });
    assert.deepEqual(badges().map(b => b.text), ['#1', '#2']);
    assert.ok(badges().every(b => b.display === 'none'));

    // Имитация DOM не поддерживает селектор-потомок из updateAllIndexBadges, поэтому применяем настройку к найденным плашкам.
    env.context.badgeEls = grid.querySelectorAll('.ss-index-badge');
    vm.runInContext("indexBadgeVisible = true; badgeEls.forEach(applyIndexBadgeSettings);", env.context);
    assert.ok(badges().every(b => b.display === 'block'));
    assert.deepEqual(badges()[0], {text: '#1', display: 'block', bottom: '6px', left: '6px'});

    // Сортировка меняет порядок на экране, но не номера: первой идёт карточка #2.
    env.document.getElementById('products-sorted-popup').querySelectorAll('button').find(b => b.textContent === '💰 Цена ↓').click();
    assert.deepEqual(grid.children.map(w => w.dataset.tileKey), ['k1', 'k0']);
    assert.deepEqual(badges().map(b => b.text), ['#2', '#1']);
    env.window._ssClosePopup();
});

test('карточка без номера не получает плашку', () => {
    const env = createEnvironment();
    assert.equal(vm.runInContext("createIndexBadge(null)", env.context), null);
    assert.equal(vm.runInContext("createIndexBadge(0)", env.context), null);
    assert.equal(vm.runInContext("createIndexBadge(7).textContent", env.context), '#7');
});
