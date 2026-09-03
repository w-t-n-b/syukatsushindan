// e2e — 実ブラウザ（ヘッドレス Chrome）での結合テスト。
//
// DOMスタブ（tools/dom-stub.mjs）では見えないものを見る:
//   ・HTMLとして本当にパースできるか（<script> 内の <!-- や </script> で壊れていないか）
//   ・CSSが実際に効いているか（診断中にフッターが消えるか 等）
//   ・20問を実際にクリックして 3.6 秒のローディングを経て結果が出るか
//   ・クリップボード・シェア・ref=share の分岐が実DOM上で動くか
//
// ドライバ本体は tools/e2e-driver.html。サイト直下に一時配置して実行し、必ず片付ける。
// （公開ディレクトリにテスト用HTMLを残さないため）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { requireChrome, EXTRA_FLAGS } from './chrome-path.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRIVER_SRC = path.join(ROOT, 'tools/e2e-driver.html');
const DRIVER_TMP = path.join(ROOT, '__e2e_tmp.html');
const CHROME = requireChrome('e2e');
const PORT = 8791;

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
               '.jpg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

// --- 静的サーバ（依存なし） ---
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function cleanup() { try { fs.unlinkSync(DRIVER_TMP); } catch {} }
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

fs.copyFileSync(DRIVER_SRC, DRIVER_TMP);

await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'e2eprof'));
const args = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${profile}`,
  // ドライバは iframe を最大 1440x1024 まで広げて実機幅を再現する（浮遊キャラの
  // コントラスト実測）。窓のほうが小さいと iframe がはみ出すので余裕を持たせる。
  '--window-size=1600,1100', '--virtual-time-budget=900000', '--dump-dom',
  ...EXTRA_FLAGS,          // CI で --no-sandbox 等が要る環境向け（CHROME_FLAGS）
  `http://127.0.0.1:${PORT}/${path.basename(DRIVER_TMP)}`,
];

// --dump-dom は DOM を吐いたあと自力で終了しないことがある（ページに無限アニメーションが
// あると顕著）。close を待つと必ずタイムアウトするので、DOM を受け取り切った時点で打ち切る。
const dom = await new Promise((resolve, reject) => {
  const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    p.kill();
    resolve(out);
  };
  p.stdout.on('data', d => {
    out += d;
    if (out.includes('</html>')) finish();   // 出力完了。Chrome の自然終了は待たない
  });
  p.on('close', finish);
  p.on('error', reject);
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    p.kill();
    reject(new Error('Chrome がタイムアウトしました'));
  }, 300000);
});

server.close();
cleanup();
// kill 直後は Chrome がまだプロファイルに書いていることがある。掃除の失敗で
// テスト結果を捨てないよう、数回だけ待って諦める（一時ディレクトリなので実害はない）。
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(profile, { recursive: true, force: true }); break; }
  catch { await new Promise(r => setTimeout(r, 200)); }
}

const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error('[e2e] ドライバの出力を取得できませんでした。ページが読み込めていない可能性があります。');
  console.error(dom.slice(0, 1500));
  process.exit(1);
}
const text = m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

console.log(text);

const lines = text.split('\n');
const okN = lines.filter(l => l.startsWith('OK')).length;
const ngN = lines.filter(l => l.startsWith('NG')).length;
const exc = lines.some(l => l.startsWith('EXCEPTION'));

console.log(`\n[e2e] OK ${okN} / NG ${ngN}${exc ? ' / 例外あり' : ''}`);
if (ngN > 0 || exc || okN === 0) {
  console.error('[e2e] FAIL');
  process.exit(1);
}
console.log('[e2e] PASS');
