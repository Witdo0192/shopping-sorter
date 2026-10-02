const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createEnvironment} = require('./helpers/content-environment.cjs');

test('manifest scripts compose the empty panel and support reopening', async () => {
    const env=createEnvironment();
    assert.equal(vm.runInContext("createSortedProductsPopup()",env.context),0);
    env.flushStorage();
    await Promise.resolve();
    assert.ok(env.document.getElementById('products-sorted-popup'));
    assert.equal(typeof env.window._ssClosePopup,'function');
    env.window._ssClosePopup();
    assert.equal(env.document.getElementById('products-sorted-popup'),null);
    assert.equal(env.window._ssClosePopup,null);
    assert.equal(vm.runInContext("createSortedProductsPopup()",env.context),0);
    env.flushStorage();
    await Promise.resolve();
    env.window._ssClosePopup();
});

test('sort controls update the rendered product order through feature interfaces', () => {
    const env=createEnvironment();
    env.context.fixtures=[100,200].map((price,i)=>Object.assign(new env.FakeElement('div'),{price,textContent:'товар '+i,dataset:{testKey:'k'+i}}));
    vm.runInContext(
        "getPrice = tile => tile.price; getAllUnitResults = () => []; getPricePerUnit = () => null; " +
        "getPpgBadgeInfo = () => null; getTileKey = tile => tile.dataset.testKey; " +
        "getDeliveryDate = () => null; fixtures.forEach(tile => seenTiles.set(getTileKey(tile),tile));",
        env.context
    );
    vm.runInContext("createSortedProductsPopup()",env.context);
    env.flushStorage();
    const grid=env.document.querySelector('.products-grid');
    const ids=()=>grid.children.map(w=>w.dataset.tileKey);
    assert.deepEqual(ids(),['k0','k1']);
    const desc=env.document.getElementById('products-sorted-popup').querySelectorAll('button').find(b=>b.textContent==='💰 Цена ↓');
    desc.click();
    assert.deepEqual(ids(),['k1','k0']);
    env.window._ssClosePopup();
});

test('opening the panel again disposes external listeners of the previous instance', () => {
    const env=createEnvironment();
    vm.runInContext("createSortedProductsPopup()",env.context);
    env.flushStorage();
    const count=()=>[...env.document.listeners.values(),...env.window.listeners.values()].reduce((n,set)=>n+set.size,0);
    const first=count();
    vm.runInContext("createSortedProductsPopup()",env.context);
    env.flushStorage();
    assert.equal(count(),first);
    env.window._ssClosePopup();
    assert.equal(count(),0);
});

test('lifecycle disposes listeners registered after the component was closed', () => {
    const env=createEnvironment();
    const lifecycle=vm.runInContext('createUiLifecycle()',env.context);
    lifecycle.destroy();
    lifecycle.listen(env.document,'click',()=>{});
    assert.equal(env.document.listeners.get('click').size,0);
});

test('clearing search does not register selection handlers again', () => {
    const env=createEnvironment();
    vm.runInContext("createSortedProductsPopup()",env.context);
    env.flushStorage();
    const grid=env.document.querySelector('.products-grid');
    const before=grid.listeners.get('click')?.size;
    const popup=env.document.getElementById('products-sorted-popup');
    const clear=popup.querySelectorAll('button').find(b=>b.title==='Очистить фильтр');
    assert.ok(clear);
    clear.click();clear.click();
    assert.equal(grid.listeners.get('click')?.size,before);
    env.window._ssClosePopup();
});
