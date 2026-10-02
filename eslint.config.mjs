import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'espree';
import globals from 'globals';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const contentScripts = [...new Set(manifest.content_scripts.flatMap(entry => entry.js || []))];

// Classic content scripts share top-level bindings. Derive only declarations,
// never arbitrary referenced names, so no-undef still catches misspellings.
function collectNames(pattern, names, access) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') names[pattern.name] = access;
    else if (pattern.type === 'RestElement') collectNames(pattern.argument,names,access);
    else if (pattern.type === 'AssignmentPattern') collectNames(pattern.left,names,access);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => collectNames(item,names,access));
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item =>
        collectNames(item.type === 'RestElement' ? item.argument : item.value,names,access));
}
const declarations = new Map(contentScripts.map(file => {
    let ast;
    try {
        ast = parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:'latest',sourceType:'script'});
    } catch (error) {
        error.message = `${file}:${error.lineNumber || 1}:${error.column || 1}: ${error.message}`;
        throw error;
    }
    const names = {};
    for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') {
            node.declarations.forEach(declaration => collectNames(declaration.id,names,node.kind === 'const' ? 'readonly' : 'writable'));
        } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
            collectNames(node.id,names,'writable');
        }
    }
    return [file,names];
}));

const rules = {
    'no-undef': ['error',{typeof:true}],
    // Callbacks/getters may safely read an outer binding declared later.
    // Direct reads before a declaration in the same scope (like orig) fail.
    'no-use-before-define': ['error',{functions:false,classes:true,variables:false}],
    'no-const-assign': 'error',
    'no-global-assign': 'error',
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-class-members': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-async-promise-executor': 'error',
    'valid-typeof': 'error'
};

export default [
    {ignores:['node_modules/**','.archive/**','Прочее/**','shopping-sorter (версии)/**']},
    {files:['**/*.{js,cjs,mjs}'],languageOptions:{ecmaVersion:'latest'},rules},
    ...contentScripts.map(file => ({
        files:[file],
        languageOptions:{
            sourceType:'script',
            globals:{
                ...globals.browser,chrome:'readonly',
                ...Object.assign({},...contentScripts.filter(other => other !== file).map(other => declarations.get(other)))
            }
        }
    })),
    {
        files:['popup.js','settings.js'],
        languageOptions:{sourceType:'script',globals:{...globals.browser,chrome:'readonly'}}
    },
    {
        files:['background.js'],
        languageOptions:{sourceType:'script',globals:{...globals.serviceworker,chrome:'readonly'}}
    },
    {
        files:['eslint.config.mjs','tests/**/*.cjs'],
        languageOptions:{globals:globals.node}
    }
];
