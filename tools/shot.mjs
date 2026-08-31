// 実機幅でのスクリーンショットと寸法計測（手動確認用の使い捨てスクリプト）
// macOS のヘッドレスChromeは --window-size を最小約500pxにクランプするため、
// cdp.mjs の Emulation.setDeviceMetricsOverride 経由でしか実機幅は再現できない。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { withPage } from './cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8793;
const MIME = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.webp':'image/webp',
               '.jpg':'image/jpeg', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'') || 'index.html';
  const file = path.join(ROOT, rel);
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const URL = `http://127.0.0.1:${PORT}/index.html`;
fs.mkdirSync('/tmp/shots',{recursive:true});

const MEASURE = `(()=>{
  const r=el=>{const b=el.getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height),top:Math.round(b.top+scrollY)};};
  const q=s=>document.querySelector(s);
  const o={vw:innerWidth,vh:innerHeight,
    docH:Math.round(document.documentElement.scrollHeight),
    hscroll:document.documentElement.scrollWidth>innerWidth,
    scrollW:document.documentElement.scrollWidth};
  ['.hero','.hero-title','.hero-title em','.hero-sub','#lp-quiz','#lq-card','.lq-foot','.char-strip-outer','.btn-wrap','.hero-stats'].forEach(s=>{
    const el=q(s); if(el)o[s]=r(el);
  });
  const em=q('.hero-title em');
  if(em){o.emLines=Math.round(em.getBoundingClientRect().height/parseFloat(getComputedStyle(em).lineHeight));
         o.emFont=getComputedStyle(em).fontSize;}
  const sub=q('.hero-sub');
  if(sub)o.subLines=Math.round(sub.getBoundingClientRect().height/parseFloat(getComputedStyle(sub).lineHeight));
  // ファーストビューに何が入るか
  const dots=q('#lq-spec-track');
  if(dots)o.dotsBottomVsFold=Math.round(dots.getBoundingClientRect().bottom-innerHeight);
  const card=q('#lq-card');
  if(card)o.cardTopVsFold=Math.round(card.getBoundingClientRect().top-innerHeight);
  return JSON.stringify(o);
})()`;

for(const [w,h] of [[390,844],[320,568]]){
  await withPage(URL, w, h, async ({evalJS, screenshot})=>{
    console.log(`\n===== ${w}x${h} : LP 初期表示 =====`);
    console.log(await evalJS(MEASURE));
    await screenshot(`/tmp/shots/lp-${w}-top.png`);
    // #lp-quiz までスクロール
    await evalJS(`(()=>{const e=document.getElementById('lp-quiz');scrollTo(0,Math.max(0,e.getBoundingClientRect().top+scrollY-80));return 1;})()`);
    await new Promise(r=>setTimeout(r,700));
    await screenshot(`/tmp/shots/lp-${w}-quiz.png`);
    // LPで5問答える → .lq-done
    const beforeH = await evalJS(`document.getElementById('lp-quiz').getBoundingClientRect().height`);
    for(let i=0;i<5;i++){
      await evalJS(`pick(document.querySelector('#lq-spec-track .sdw[data-v="2"]'))`);
      await new Promise(r=>setTimeout(r,650));
    }
    const afterH = await evalJS(`document.getElementById('lp-quiz').getBoundingClientRect().height`);
    console.log(`#lp-quiz の高さ: 回答前 ${Math.round(beforeH)}px → 5問後 ${Math.round(afterH)}px`);
    console.log(`ページ全体の高さ: ${await evalJS('document.documentElement.scrollHeight')}px / 横スクロール: ${await evalJS('document.documentElement.scrollWidth>innerWidth')}`);
    await screenshot(`/tmp/shots/lp-${w}-done.png`);
    // 質問画面
    await evalJS(`document.getElementById('lq-continue').click()`);
    await new Promise(r=>setTimeout(r,900));
    console.log(`質問画面 横スクロール: ${await evalJS('document.documentElement.scrollWidth>innerWidth')} / prog: ${await evalJS("document.getElementById('prog-text').textContent")}`);
    await screenshot(`/tmp/shots/quiz-${w}.png`);
  });
}

// タイプ紹介
await withPage(URL, 390, 844, async ({evalJS, screenshot})=>{
  await evalJS(`(()=>{const e=document.querySelector('#type-overview .tc[data-code="DAWS"]');e.click();return 1;})()`);
  await new Promise(r=>setTimeout(r,700));
  await evalJS(`(()=>{const e=document.querySelector('.type-peek');scrollTo(0,Math.max(0,e.getBoundingClientRect().top+scrollY-80));return 1;})()`);
  await new Promise(r=>setTimeout(r,600));
  console.log(`\n===== 390 : .type-peek =====`);
  console.log(await evalJS(`JSON.stringify({h:Math.round(document.querySelector('.type-peek').getBoundingClientRect().height),hscroll:document.documentElement.scrollWidth>innerWidth})`));
  await screenshot('/tmp/shots/peek-390.png');
});

server.close();
console.log('\n/tmp/shots に出力しました');
process.exit(0);
