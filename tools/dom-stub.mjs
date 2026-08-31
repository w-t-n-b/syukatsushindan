// 診断ロジックの回帰検証ハーネス（index.html のインライン JS を最小DOMスタブ上で実行する）
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
    this.children = [];
    this.classList = new ClassList(this);
    this.style = new Proxy({ cssText:'' }, { set(t,k,v){ t[k]=v; return true; }, get(t,k){ return t[k]===undefined?'':t[k]; } });
    this.dataset = {};
    this.textContent = '';
    this._innerHTML = '';
    this.offsetWidth = 100; this.offsetHeight = 40;
  }
  set innerHTML(v){ this._innerHTML = String(v); }
  get innerHTML(){ return this._innerHTML; }
  set className(v){ this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className(){ return this.classList.value; }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children = this.children.filter(x=>x!==c); }
  remove(){}
  contains(){ return false; }
  addEventListener(){}
  getBoundingClientRect(){ return {left:0,top:0,width:100,height:40}; }
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  focus(){}
  setAttribute(k,v){ this[k]=v; }
  getAttribute(k){ return this[k]; }
  insertAdjacentHTML(pos, html){ this._adjacent = (this._adjacent||'') + html; }
  insertBefore(n, ref){ this.children.unshift(n); this._adjacent = (this._adjacent||'') + '<div class="'+n.className+'">' + n.innerHTML + '</div>'; return n; }
  get firstChild(){ return this.children[0] || null; }
  scrollIntoView(){}
  get nextElementSibling(){ return new El(); }
}

function build(){
  const byId = new Map();
  const mk = id => { const e = new El('div', id); byId.set(id, e); return e; };
  ['quiz-bg','q-top','prog-text','prog-msg','prog-seg','q-num','q-axis','q-text','q-a','q-b',
   'sl-a','sl-b','back-btn','spec-track','q-card','stat-count','cont-banner','cont-sub',
   'type-overview','screen-result','conf-wrap','l-bar','hdr','drawer','ham',
   'screen-title','screen-quiz','screen-loading','char-strip-track','company-list','res-code-el',
   /* LP埋め込み質問（設計A）。質問画面と同じ部品を lq- 接頭辞で持つ */
   'lp-quiz','lq-lbl','lq-card','lq-num','lq-axis','lq-text','lq-a','lq-b','lq-sl-a','lq-sl-b',
   'lq-spec-track','lq-prog-seg','lq-done','lq-back','lq-continue',
   'cta-hero','cta-grid','cta-drawer'
  ].forEach(mk);

  const screens = ['screen-title','screen-quiz','screen-loading','screen-result'].map(i=>byId.get(i));
  screens[0].classList.add('active');
  const mkSdws = () => [2,1,0,-1,-2].map(v=>{ const e=new El('button'); e.dataset.v=String(v); return e; });
  const sdws = mkSdws();          // #spec-track（質問画面）
  const lpSdws = mkSdws();        // #lq-spec-track（LP埋め込み）
  // renderQ()/pick() は track.querySelectorAll('.sdw') で自分の5個だけを触る
  byId.get('spec-track').querySelectorAll = sel => (sel === '.sdw' ? sdws : []);
  byId.get('lq-spec-track').querySelectorAll = sel => (sel === '.sdw' ? lpSdws : []);
  const heroInner = new El('div'); heroInner.classList.add('hero-inner');

  const document = {
    body: new El('body'),
    documentElement: new El('html'),
    getElementById: id => byId.get(id) || null,
    querySelector: sel => {
      if(sel === '.hero-inner' || sel === '#screen-title .hero-inner') return heroInner;
      if(sel === '.shared-banner') return heroInner.children.find(c=>c.classList.contains('shared-banner')) || null;
      if(sel === '.ftr') return new El('footer');
      const m = /^#(.+)$/.exec(sel); if(m) return byId.get(m[1]) || null;
      return null;
    },
    querySelectorAll: sel => {
      if(sel === '.screen') return screens;
      if(sel === '.sdw') return sdws.concat(lpSdws);
      return [];
    },
    createElement: t => new El(t),
    addEventListener(){},
    fonts: { ready: Promise.resolve() }
  };
  return { document, byId, sdws, lpSdws, heroInner };
}

function load(htmlPath, search){
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if(!m) throw new Error('no inline script');
  const code = m[1];
  const { document, byId, sdws, lpSdws, heroInner } = build();
  const store = new Map();
  const timers = [];
  const sandbox = {
    document,
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Promise, Set, Map, RegExp, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
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
    __timers: timers, __byId: byId, __sdws: sdws, __lpSdws: lpSdws, __heroInner: heroInner
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: htmlPath });
  sandbox.__eval = expr => vm.runInContext(expr, sandbox);
  return sandbox;
}

export { load };
