const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');

test('saved-products.html loads the same scripts as the content script, then the page script', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    const html = fs.readFileSync(path.join(root,'saved-products.html'),'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(scripts,[...manifest.content_scripts[0].js,'saved-products-page.js']);
    for (const file of scripts) assert.ok(fs.existsSync(path.join(root,file)),file);
});

test('popup falls back to the extension page when the tab has no content script', () => {
    const popup = fs.readFileSync(path.join(root,'popup.js'),'utf8');
    assert.match(popup,/saved-products\.html/);
    assert.match(popup,/lastError\)\s*\{\s*openSavedProductsPage\(\)/);
});
