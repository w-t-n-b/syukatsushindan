// typecheck — このスタック（型注釈のない Vanilla JS）で「型チェック」に相当するもの。
//
// TypeScript も Flow も入っていないので、代わりに
// 「参照が解決するか」を静的に確かめる。具体的には2つ:
//
//   1. インラインJSが構文として成立するか（node --check 相当）
//   2. HTML の on* 属性から呼ばれている関数が、実際に定義されているか
//
// 2 が本命。このサイトは操作のほぼ全てが onclick="fn()" で書かれており、
// 関数名を打ち間違えても・関数を消しても、押した瞬間まで誰も気づかない。
// 実際、ドロワーの16タイプボタンは「何も呼んでいない」状態で出荷されていた。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES = ['index.html', 'privacy.html'];

let ng = 0;
const ok = m => console.log(`  ok   ${m}`);
const bad = m => { ng++; console.log(`  NG   ${m}`); };

// ブラウザ側で最初から存在するもの。ここに無い名前が on* から呼ばれていたら未定義とみなす。
const BROWSER_GLOBALS = new Set([
  'window', 'document', 'location', 'navigator', 'localStorage', 'sessionStorage',
  'console', 'alert', 'confirm', 'prompt', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'fetch', 'open',
  'scrollTo', 'scrollBy', 'getComputedStyle', 'matchMedia', 'encodeURIComponent',
  'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'Math', 'JSON', 'Date',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Set', 'Map',
  'RegExp', 'Error', 'URLSearchParams', 'IntersectionObserver', 'gtag', 'dataLayer',
  'event', 'this', 'true', 'false', 'null', 'undefined', 'return', 'void', 'new', 'typeof',
]);

for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  console.log(`[typecheck] ${page}`);

  // ---- 1. 構文 ----
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (scripts.length === 0) {
    ok('インラインJSなし（構文チェック対象なし）');
  }
  scripts.forEach((src, i) => {
    try {
      new vm.Script(src, { filename: `${page}#script[${i}]` });
      ok(`インラインJS[${i}] の構文が正しい（${src.length} 文字）`);
    } catch (e) {
      bad(`インラインJS[${i}] に構文エラー: ${e.message}`);
    }
  });

  // ---- 2. on* 属性から呼ばれる名前が定義されているか ----
  const js = scripts.join('\n');

  // 定義されている名前を集める（function 宣言 / const / let / var）
  const defined = new Set();
  for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  // 一行に複数宣言（let a=0,b=0,...）も拾う
  for (const m of js.matchAll(/\b(?:const|let|var)\s+([^;\n=]+)=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) defined.add(n[1]);
    }
  }

  // on* 属性を集める（静的HTML と、JS のテンプレート文字列の両方）
  const handlers = [];
  for (const m of html.matchAll(/\bon(?:click|load|change|input|submit)\s*=\s*"([^"]*)"/g)) handlers.push(m[1]);
  for (const m of html.matchAll(/\bon(?:click|load|change|input|submit)\s*=\s*'([^']*)'/g)) handlers.push(m[1]);

  const missing = new Map();
  for (const h of handlers) {
    // `fn(` の形で呼ばれている識別子を抜く。メソッド呼び出し（x.fn(）は除外。
    for (const m of h.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (BROWSER_GLOBALS.has(name) || defined.has(name)) continue;
      if (!missing.has(name)) missing.set(name, h.slice(0, 60));
    }
  }
  if (missing.size === 0) {
    ok(`on* 属性から呼ばれる関数 ${new Set(handlers).size} 種すべてが定義済み`);
  } else {
    for (const [n, ctx] of missing) bad(`on* 属性が未定義の関数を呼んでいる: ${n}()  ← "${ctx}"`);
  }

  // ---- 3. 「押しても何も起きない」ボタンの検出 ----
  // closeDrawer() だけ / 空 のハンドラは、利用者から見ると故障に見える。
  const deadOnly = new Set(['closeDrawer', 'addRipple']);
  let dead = 0;
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    const attrs = m[1];
    const oc = attrs.match(/onclick\s*=\s*"([^"]*)"/);
    if (!oc) {
      // type=button でない submit ボタン等は対象外（そもそも form が無い）
      continue;
    }
    const calls = [...oc[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[2]);
    if (calls.length && calls.every(c => deadOnly.has(c))) {
      bad(`押しても何も起きないボタン: onclick="${oc[1]}"`);
      dead++;
    }
  }
  if (dead === 0) ok('「押しても何も起きないボタン」なし');
}

console.log(ng === 0 ? '\n[typecheck] PASS' : `\n[typecheck] FAIL: ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
