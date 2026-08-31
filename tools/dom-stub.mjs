// 診断ロジックの回帰検証ハーネス（index.html のインライン JS を最小DOMスタブ上で実行する）
//
// 1画面5問（quiz-five-per-page.md）にあたって、このスタブは作り直した。
// 旧版は「質問カードが1枚しかない」前提で、q-num / q-text / spec-track などの id を
// 固定で1つずつ持っていた。5問ずつになるとカードは JS が innerHTML で組み立てるので、
//   ・innerHTML に入った文字列を要素ツリーとして持てること
//   ・.sdw[data-pos="3"] のようなセレクタで引けること
// の2つが必要になる。そのため最小のHTMLパーサとセレクタエンジンを持たせてある。
// 「テストを緩める」方向ではなく、5問ずつの前提で同じことを検証できるようにするための変更。
import fs from 'node:fs';
import vm from 'node:vm';

class ClassList {
  constructor(el){ this.el = el; this.s = new Set(); }
  add(...c){ c.forEach(x=>x&&this.s.add(x)); }
  remove(...c){ c.forEach(x=>this.s.delete(x)); }
  contains(c){ return this.s.has(c); }
  toggle(c, f){ if(f===undefined) f = !this.s.has(c); f? this.s.add(c) : this.s.delete(c); return f; }
  get value(){ return [...this.s].join(' '); }
}

class El {
  constructor(tag='div', id=''){
    this.tagName = (tag||'div').toUpperCase();
    this.id = id;
    this.parent = null;
    this._nodes = [];            // 子ノード（El か文字列）
    this.attrs = Object.create(null);
    this.classList = new ClassList(this);
    this.style = new Proxy({ cssText:'' }, { set(t,k,v){ t[k]=v; return true; }, get(t,k){ return t[k]===undefined?'':t[k]; } });
    this.dataset = {};
    this._innerHTML = '';
    this.offsetWidth = 100; this.offsetHeight = 40;
  }
  get children(){ return this._nodes.filter(n => n instanceof El); }
  set innerHTML(v){ this._innerHTML = String(v); this._nodes = parseHTML(this._innerHTML, this); }
  get innerHTML(){ return this._innerHTML; }
  set textContent(v){ this._innerHTML = ''; this._nodes = [String(v)]; }
  get textContent(){ return this._nodes.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  set className(v){ this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className(){ return this.classList.value; }
  appendChild(c){ this._nodes.push(c); c.parent = this; return c; }
  removeChild(c){ this._nodes = this._nodes.filter(x => x !== c); }
  remove(){ if(this.parent) this.parent.removeChild(this); }
  contains(){ return false; }
  addEventListener(){}
  getBoundingClientRect(){ return {left:0,top:0,width:100,height:40}; }
  querySelector(sel){ return findAll(this.children, sel)[0] || null; }
  querySelectorAll(sel){ return findAll(this.children, sel); }
  focus(){}
  setAttribute(k,v){ this.attrs[k] = String(v); this[k] = v; }
  getAttribute(k){ return this.attrs[k] !== undefined ? this.attrs[k] : (this[k] !== undefined ? this[k] : null); }
  insertAdjacentHTML(pos, html){ this._adjacent = (this._adjacent||'') + html; }
  insertBefore(n, ref){ this._nodes.unshift(n); n.parent = this;
    this._adjacent = (this._adjacent||'') + '<div class="'+n.className+'">' + n.innerHTML + '</div>'; return n; }
  get firstChild(){ return this.children[0] || null; }
  scrollIntoView(){}
  get nextElementSibling(){ return new El(); }
}

/* ---- 最小のHTMLパーサ -----------------------------------------------------
   index.html が innerHTML に入れる範囲（div / span / button / ul / li / img）
   だけを相手にする。汎用パーサではない。 */
const VOID_TAGS = new Set(['img','br','hr','input','meta','link','source','path','circle','use']);
const camel = s => s.replace(/-([a-z])/g, (_,c) => c.toUpperCase());

function applyAttrs(el, src){
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while((m = re.exec(src))){
    const k = m[1];
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : (m[4] || '');
    el.attrs[k] = v;
    if(k === 'class') el.className = v;
    else if(k === 'id') el.id = v;
    else if(k.startsWith('data-')) el.dataset[camel(k.slice(5))] = v;
    else el[k] = v;
  }
}

function parseHTML(html, parent){
  const root = [];
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0, m;
  const push = n => stack[stack.length-1].push(n);
  while((m = re.exec(html))){
    if(m.index > last){ const t = html.slice(last, m.index); if(t) push(t); }
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if(m[0][1] === '/'){ if(stack.length > 1) stack.pop(); continue; }
    const el = new El(tag);
    applyAttrs(el, m[2] || '');
    push(el);
    if(!VOID_TAGS.has(tag) && m[3] !== '/') stack.push(el._nodes);
  }
  if(last < html.length){ const t = html.slice(last); if(t) push(t); }
  const link = (list, p) => list.forEach(n => { if(n instanceof El){ n.parent = p; link(n._nodes, n); } });
  link(root, parent);
  return root;
}

/* ---- 最小のセレクタエンジン ------------------------------------------------
   対応するのは index.html が実際に使う形だけ:
     .cls / #id / tag / [attr="v"] / それらの複合 / 子孫（空白）区切り */
function parseSel(sel){
  return String(sel).trim().split(/\s+(?![^\[]*\])/).map(part => {
    const o = { tag:null, id:null, cls:[], attrs:[] };
    const re = /([.#]?[\w-]+)|\[([\w-]+)(?:=\s*"?([^\]"]*)"?)?\]/g;
    let m;
    while((m = re.exec(part))){
      if(m[1]){
        if(m[1][0] === '.') o.cls.push(m[1].slice(1));
        else if(m[1][0] === '#') o.id = m[1].slice(1);
        else o.tag = m[1].toLowerCase();
      } else o.attrs.push([m[2], m[3]]);
    }
    return o;
  });
}

function matchOne(el, o){
  if(o.tag && el.tagName.toLowerCase() !== o.tag) return false;
  if(o.id && el.id !== o.id) return false;
  if(o.cls.some(c => !el.classList.contains(c))) return false;
  return o.attrs.every(([k,v]) => {
    const a = el.getAttribute(k);
    return v === undefined ? a != null : String(a) === v;
  });
}

function allEls(roots){
  const out = [];
  const walk = e => { out.push(e); e.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}

function findAll(roots, sel){
  const parts = parseSel(sel);
  const last = parts[parts.length-1];
  return allEls(roots).filter(el => {
    if(!matchOne(el, last)) return false;
    for(let i = parts.length-2; i >= 0; i--){
      let p = el.parent, found = false;
      while(p){ if(matchOne(p, parts[i])){ found = true; p = p.parent; break; } p = p.parent; }
      if(!found) return false;
    }
    return true;
  });
}

function build(){
  const byId = new Map();
  const mk = id => { const e = new El('div', id); byId.set(id, e); return e; };
  /* #q-axis / .sl-a / .sl-b（軸名の開示）と #conf-wrap（紙吹雪）は
     実ファイルから削除済みなので、スタブ側にも置かない。
     置いたままにすると「消したはずの id を参照している」コードを見逃す。
     1問ずつ時代の q-num / q-text / q-a / q-b / spec-track / q-card と
     その lq- 版も同じ理由で置かない。いまはカードごと JS が組み立てる。 */
  ['quiz-bg','prog-text','prog-msg','prog-seg','back-btn','q-list','q-next','q-remain',
   'cont-banner','cont-sub',
   'type-overview','screen-result','l-bar','hdr','drawer','ham',
   'screen-title','screen-quiz','screen-loading','char-strip-track','company-list','res-code-el',
   /* LP埋め込み質問。診断画面と同じ部品を lq- 接頭辞で持つ */
   'lp-quiz','lq-lbl','lq-list','lq-prog-seg','lq-done','lq-continue','lq-remain',
   'cta-hero','cta-grid','cta-drawer'
  ].forEach(mk);

  const screens = ['screen-title','screen-quiz','screen-loading','screen-result'].map(i=>byId.get(i));
  screens[0].classList.add('active');
  const heroInner = new El('div'); heroInner.classList.add('hero-inner');
  const footer = new El('footer'); footer.classList.add('ftr');

  // document 直下の探索対象。byId の各要素は独立した根として扱う。
  const roots = () => [...byId.values(), heroInner, footer];

  const document = {
    body: new El('body'),
    documentElement: new El('html'),
    getElementById: id => byId.get(id) || null,
    querySelector: sel => {
      if(sel === '.hero-inner' || sel === '#screen-title .hero-inner') return heroInner;
      if(sel === '.ftr') return footer;
      return findAll(roots(), sel)[0] || null;
    },
    querySelectorAll: sel => {
      if(sel === '.screen') return screens;
      return findAll(roots(), sel);
    },
    createElement: t => new El(t),
    addEventListener(){},
    fonts: { ready: Promise.resolve() }
  };
  return { document, byId, heroInner };
}

function load(htmlPath, search){
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if(!m) throw new Error('no inline script');
  const code = m[1];
  const { document, byId, heroInner } = build();
  const store = new Map();
  const timers = [];
  const sandbox = {
    document,
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Promise, Set, Map, RegExp, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
    URLSearchParams,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k,v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    location: { search: search||'', href: 'https://w-t-n-b.github.io/syukatsushindan/' + (search||''), reload(){}, replace(){} },
    navigator: { clipboard: { writeText: () => Promise.resolve() }, share: undefined },
    alert(){}, scrollY: 0, pageYOffset: 0,
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    scrollTo(){}, open(){}, requestAnimationFrame: fn => { timers.push(fn); return 0; },
    IntersectionObserver: function(){ this.observe=()=>{}; this.disconnect=()=>{}; },
    addEventListener(ev, fn){ if(ev==='DOMContentLoaded') timers.push(fn); },
    removeEventListener(){},
    __timers: timers, __byId: byId, __heroInner: heroInner
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: htmlPath });
  sandbox.__eval = expr => vm.runInContext(expr, sandbox);
  /* 出題位置 pos の目盛（.sdw）を面ごとに引くヘルパ。テスト側の定型を1箇所に集める。
       face … 'q'（診断画面）/ 'lq'（LP埋め込み）*/
  sandbox.__dot = (face, pos, v) =>
    document.querySelectorAll(`.sdw[data-pos="${pos}"]`)
      .find(b => b.dataset.face === face && Number(b.dataset.v) === v) || null;
  /* 面 face のページに出ている出題位置の一覧 */
  sandbox.__positions = face =>
    document.querySelectorAll(`#${face === 'lq' ? 'lq-list' : 'q-list'} .q-card`)
      .map(c => Number(c.dataset.pos));
  return sandbox;
}

export { load };
