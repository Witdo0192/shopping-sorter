const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
    const tiles = [
        {id:'cheap', title:'корм', price:100, unit:50, categories:['weight', 'piece'], rating:4, reviews:20, delivery:1000},
        {id:'expensive', title:'корм', price:200, unit:20, categories:['piece'], rating:5, reviews:10, delivery:2000},
        {id:'unknown', title:'игрушка', price:99999999, categories:[], rating:null, reviews:null, delivery:null}
    ];
    const inputs = {};
    for (const key of ['priceMin','priceMax','priceUnitMin','priceUnitMax','ratingMin','ratingMax','reviewsMin','reviewsMax','deliveryMin','deliveryMax']) inputs[key] = {value:''};
    const dependencies = {currentMode:'asc', typeFilter:{weight:true,piece:true,none:true,noPrice:true}, ...inputs};
    const context = vm.createContext({
        seenTiles:new Map(tiles.map(t=>[t.id,t])),
        getPrice:t=>t.price, getPricePerUnit:t=>t.unit == null ? null : {value:t.unit},
        getRating:t=>t.rating, getReviewsCount:t=>t.reviews, getDeliveryDate:t=>t.delivery,
        getAllUnitResults:t=>t.categories.map(category=>({category})),
        getSortValue:t=>t.price, parseStrictDate:Number,
        parseSearchQuery:q=>q, matchesTileSearchTokens:(t,q)=>t.title.includes(q)
    });
    for (const file of ['src/content/products/sorting.js','src/content/products/filtering.js']) {
        vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    }
    context.dependencies = dependencies;
    const filters = vm.runInContext('createProductFilters(dependencies)',context);
    return {tiles, dependencies, filters, ids:q=>Array.from(filters.getFilteredAndSorted(q || ''),t=>t.id)};
}

test('filter reads changed mode and fields on subsequent calls', () => {
    const {dependencies:d,ids} = fixture();
    assert.deepEqual(ids(),['cheap','expensive','unknown']);
    d.currentMode='desc';
    assert.deepEqual(ids(),['unknown','expensive','cheap']);
    d.priceMin.value='150';
    assert.deepEqual(ids(),['unknown','expensive']);
});

test('DSL sort takes precedence and puts missing values last', () => {
    const {dependencies:d,ids} = fixture();
    d.currentMode='desc';
    assert.deepEqual(ids('@сортировка(цена, asc)'),['cheap','expensive','unknown']);
    assert.deepEqual(ids('@сортировка(рейтинг)'),['expensive','cheap','unknown']);
});

test('text query and numeric ranges compose', () => {
    const {dependencies:d,ids} = fixture();
    d.ratingMin.value='4.5';
    d.priceUnitMax.value='25';
    assert.deepEqual(ids('корм'),['expensive']);
    d.reviewsMin.value='15';
    assert.deepEqual(ids('корм'),[]);
});

test('a product may belong to several unit categories', () => {
    const {dependencies:d,ids} = fixture();
    d.typeFilter={weight:true,piece:false,none:false,noPrice:false};
    assert.deepEqual(ids(),['cheap']);
});

test('an explicit source is filtered without changing the collected products', () => {
    const {tiles,filters,ids} = fixture();
    assert.deepEqual(Array.from(filters.getFilteredAndSorted('',[tiles[1]]),t=>t.id),['expensive']);
    assert.deepEqual(ids(),['cheap','expensive','unknown']);
    assert.deepEqual(tiles.map(t=>t.id),['cheap','expensive','unknown']);
});

test('delivery and reviews keep missing data as before', () => {
    const {dependencies:d,ids} = fixture();
    d.currentMode='delivery-desc';
    assert.deepEqual(ids(),['expensive','cheap','unknown']);
    d.deliveryMax.value='1500';
    assert.deepEqual(ids(),['cheap','unknown']);
    d.currentMode='reviews-desc';
    assert.deepEqual(ids(),['cheap','unknown']);
});
