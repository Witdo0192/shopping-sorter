const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createEnvironment} = require('./helpers/content-environment.cjs');

function scheduleDiagnostics(env) {
    const existing = new Set(env.timers.keys());
    vm.runInContext('scheduleBreakCheck()', env.context);
    return [...env.timers.entries()].filter(([id]) => !existing.has(id)).map(([,fn]) => fn);
}

test('diagnostics publishes original config and optional fields without a TDZ error', () => {
    const env = createEnvironment();
    const tile = new env.FakeElement('article');
    tile.className = 'tile';
    const price = new env.FakeElement('span'); price.className = 'price';
    const title = new env.FakeElement('span'); title.className = 'title';
    const id = new env.FakeElement('span'); id.className = 'product-id';
    tile.append(price,title,id,new env.FakeElement('a'));
    env.document.body.append(tile);
    vm.runInContext(
        "extensionEnabled = true; detectTilesHeuristic = () => null; " +
        "SELECTORS = {tile:'.tile',price:'.price',title:'.title',link:'a'," +
        "_originalConfig:{tile:['.tile'],price:['.price'],title:['.title'],link:['a'],id:'.product-id',domains:['example.test']}};",
        env.context
    );
    const [check] = scheduleDiagnostics(env);
    assert.doesNotThrow(check);
    const result = env.window._tileCheckResult;
    assert.equal(result.found,1);
    assert.equal(result.selectorStatus.id,'ok');
    assert.equal(result.selectorStatus.price,'ok');
    assert.deepEqual(Array.from(result.selectors.tile),['.tile']);
    assert.equal(result.fullConfig.id,'.product-id');
});

test('all delayed diagnostics stop after the extension is disabled', () => {
    const env = createEnvironment();
    let calls = 0;
    env.context.detectTilesHeuristic = () => {calls++;return null;};
    env.context.collectTiles = () => {calls++;};
    env.context.updateLiveCounterBadge = () => {calls++;};
    vm.runInContext("extensionEnabled = true; SELECTOR_PROFILES = [{tile:'.tile',_foundCount:0}];",env.context);
    const callbacks = scheduleDiagnostics(env);
    // A late DOM render would otherwise trigger collection in the retry callbacks.
    const tile = new env.FakeElement('div'); tile.className = 'tile'; env.document.body.append(tile);
    vm.runInContext('extensionEnabled = false;',env.context);
    callbacks.forEach(fn => fn());
    assert.equal(callbacks.length,4);
    assert.equal(calls,0);
    assert.equal(env.window._tileCheckResult,undefined);
    assert.equal(vm.runInContext('SELECTOR_PROFILES[0]._foundCount',env.context),0);
});

async function loadConfig(env, sites) {
    env.window.location = {hostname:'example.test'};
    env.context.fetch = async url => ({json:async () => url.endsWith('sites.json') ? sites : env.context.testUnits});
    const loading = vm.runInContext('loadSelectors()',env.context);
    await new Promise(setImmediate);
    env.flushStorage();
    await loading;
}
const config = (tile,domains=['elsewhere.test']) => ({domains,cards:[{name:'Карточка',tile,price:'.price'}]});

test('unknown domain with no matching DOM is not assigned the first configured site', async () => {
    const env = createEnvironment();
    await loadConfig(env,{first:config('.absent')});
    assert.equal(vm.runInContext('SELECTORS._siteName',env.context),'example.test');
    assert.equal(vm.runInContext('SELECTOR_PROFILES.length',env.context),0);
    assert.equal(vm.runInContext('SELECTORS._broken',env.context),true);
});

test('DOM recognition skips empty profiles and selects an actual match', async () => {
    const env = createEnvironment();
    const tile = new env.FakeElement('div'); tile.className = 'present'; env.document.body.append(tile);
    await loadConfig(env,{first:config('.absent'),second:config('.present')});
    assert.equal(vm.runInContext('SELECTORS._siteName',env.context),'second');
    assert.equal(vm.runInContext('SELECTOR_PROFILES[0]._foundCount',env.context),1);
    assert.equal(vm.runInContext('siteKnownInDatabase',env.context),false);
});

test('a known domain keeps its configuration while its cards are still loading', async () => {
    const env = createEnvironment();
    await loadConfig(env,{known:config('.not-yet-rendered',['example.test'])});
    assert.equal(vm.runInContext('SELECTORS._siteName',env.context),'known');
    assert.equal(vm.runInContext('SELECTOR_PROFILES[0]._foundCount',env.context),0);
    assert.equal(vm.runInContext('siteKnownInDatabase',env.context),true);
});
