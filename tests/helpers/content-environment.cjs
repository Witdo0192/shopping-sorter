const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.attributes = {};
        this.listeners = new Map();
        this.style = {setProperty(name,value) { this[name]=value; }, getPropertyValue(name) {return this[name] || '';}, removeProperty(name) {delete this[name];}};
        this.classList = {add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false};
        this.value = '';
        this.textContent = '';
        this.scrollHeight = 38;
        this.offsetHeight = 30;
        this.offsetWidth = 200;
    }
    appendChild(node) { node.remove(); this.children.push(node); node.parentNode=this; return node; }
    append(...nodes) { nodes.forEach(n=>this.appendChild(n)); }
    replaceChildren(...nodes) {this.innerHTML='';this.append(...nodes);}
    prepend(...nodes) { for(const node of nodes.reverse()){node.remove();this.children.unshift(node);node.parentNode=this;} }
    insertBefore(node,reference) {node.remove();const i=this.children.indexOf(reference);this.children.splice(i<0?this.children.length:i,0,node);node.parentNode=this;return node;}
    remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(n=>n!==this); this.parentNode=null; }
    attachShadow() { this.shadowRoot=new FakeElement('shadow'); return this.shadowRoot; }
    set innerHTML(value) { this._html=value; this.children.forEach(n=>n.parentNode=null); this.children=[]; }
    get innerHTML() { return this._html || ''; }
    setAttribute(k,v) {this.attributes[k]=v;}
    getAttribute(k) {return this.attributes[k] ?? null;}
    hasAttribute(k) {return k in this.attributes;}
    removeAttribute(k) {delete this.attributes[k];}
    addEventListener(type,fn) { if(!this.listeners.has(type))this.listeners.set(type,new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type,fn) {this.listeners.get(type)?.delete(fn);}
    dispatchEvent(event) { event.target ||= this; for(const fn of this.listeners.get(event.type)||[])fn(event); this['on'+event.type]?.(event); }
    click() {this.dispatchEvent({type:'click',target:this,stopPropagation(){},preventDefault(){}});}
    focus() {}
    setSelectionRange() {}
    cloneNode() {const clone=new FakeElement(this.tagName);Object.assign(clone,{textContent:this.textContent,dataset:{...this.dataset}});return clone;}
    getBoundingClientRect() {return {left:10,top:10,right:210,bottom:40,width:200,height:30};}
    contains(node) {return node===this || this.children.some(n=>n.contains(node));}
    matches(selector) {
        if(selector.startsWith('#'))return this.id===selector.slice(1);
        if(selector.startsWith('.'))return (this.className||'').split(/\s+/).includes(selector.slice(1));
        return this.tagName.toLowerCase()===selector;
    }
    querySelectorAll(selector) {
        return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector),...(n.shadowRoot?.querySelectorAll(selector)||[])]);
    }
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    closest(selector) {return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
}

function createEnvironment() {
    const document = new FakeElement('document');
    document.body=new FakeElement('body'); document.head=new FakeElement('head');
    document.append(document.head,document.body);
    document.createElement=tag=>new FakeElement(tag);
    document.createTextNode=text=>Object.assign(new FakeElement('text'),{textContent:text});
    document.createDocumentFragment=()=>new FakeElement('fragment');
    document.getElementById=id=>document.querySelector('#'+id);
    const window = new FakeElement('window');
    Object.assign(window,{innerWidth:1200,innerHeight:900,scrollY:0,scrollTo(){}});
    const pendingStorage = [];
    const data = {extensionEnabled:false,liveCounterEnabled:false,savedTiles:[],savedSearchQueries:[],searchCardStyle:'site'};
    const timers = new Map();
    let timerId=0;
    const setTimer=fn=>{timers.set(++timerId,fn);return timerId;};
    const context = vm.createContext({
        document,window,location:{hostname:'example.test',href:'https://example.test/',protocol:'https:'},
        console:{log(){},warn(){},error(){}},Element:FakeElement,Event:class{constructor(type){this.type=type;}},
        CSS:{escape:s=>s},getComputedStyle:()=>({fontSize:'14px'}),
        setTimeout:setTimer,setInterval:setTimer,clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),
        requestAnimationFrame:setTimer,cancelAnimationFrame:id=>timers.delete(id),requestIdleCallback:setTimer,
        ResizeObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}unobserve(){}},
        chrome:{
            storage:{local:{
                get(keys,cb){if(cb)pendingStorage.push(()=>cb(data)); else return Promise.resolve(data);},
                set(items,cb){Object.assign(data,items);cb?.();return Promise.resolve();},
                getBytesInUse:async()=>0,QUOTA_BYTES:10485760
            },onChanged:{addListener(){}}},
            runtime:{onMessage:{addListener(){}},getURL:p=>p,
                sendMessage(message,cb){cb?.({result:{}});return Promise.resolve({result:{}});}}
        }
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    for(const file of manifest.content_scripts[0].js) {
        vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    }
    const flushStorage=()=>{while(pendingStorage.length)pendingStorage.shift()();};
    flushStorage();
    context.testUnits = JSON.parse(fs.readFileSync(path.join(root,'units.json'),'utf8'));
    vm.runInContext('UNITS = normalizeUnitsConfig(testUnits); SELECTORS = {extras:[]};',context);
    return {context,document,window,pendingStorage,timers,flushStorage,data,FakeElement};
}
module.exports = {createEnvironment,FakeElement};
