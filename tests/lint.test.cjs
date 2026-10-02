const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {ESLint} = require('eslint');
const root = path.resolve(__dirname,'..');
const eslint = new ESLint({cwd:root});

async function messages(source,filePath='src/content/selectors/heuristics.js') {
    const [result] = await eslint.lintText(source,{filePath});
    return result.messages;
}

test('lint rejects the original read of orig before its declaration', async () => {
    const errors = await messages("function check() { const value = orig.id; const orig = {}; return value; }");
    assert.ok(errors.some(error => error.ruleId === 'no-use-before-define'));
});

test('lint permits an outer variable read later by a callback', async () => {
    const errors = await messages("const readLater = () => value; const value = 1; readLater();");
    assert.deepEqual(errors,[]);
});

test('lint accepts a declared content helper and rejects a misspelled one', async () => {
    assert.deepEqual(await messages("getTileTitle({});"),[]);
    const errors = await messages("getTileTitlle({});");
    assert.ok(errors.some(error => error.ruleId === 'no-undef'));
});

test('content helpers are not exposed to the popup lint context', async () => {
    const errors = await messages("getTileTitle({});",'popup.js');
    assert.ok(errors.some(error => error.ruleId === 'no-undef'));
});

test('shared const bindings cannot be reassigned from another script', async () => {
    const errors = await messages("_featureCache = new Map();");
    assert.ok(errors.some(error => error.ruleId === 'no-global-assign'));
});
