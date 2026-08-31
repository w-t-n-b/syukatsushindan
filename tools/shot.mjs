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
  ['.hero','.hero-title','.hero-title em','.hero-sub','#lp-quiz-sec','#lp-quiz','#lq-list',
   '.lq-foot','.char-strip-outer','.btn-wrap','.steps','#type-section'].forEach(s=>{
    const el=q(s); if(el)o[s]=r(el);
  });
  const em=q('.hero-title em');
  if(em){o.emLines=Math.round(em.getBoundingClientRect().height/parseFloat(getComputedStyle(em).lineHeight));
         o.emFont=getComputedStyle(em).fontSize;}
  const sub=q('.hero-sub');
  if(sub)o.subLines=Math.round(sub.getBoundingClientRect().height/parseFloat(getComputedStyle(sub).lineHeight));
  // #lp-quiz はヒーローの外（3ステップの直後）に出したので、
  // ファーストビューではなく「そこへ到達するまでのスクロール量」を見る
  const lq=q('#lp-quiz');
  if(lq)o.lpQuizScrollToReach=Math.round(lq.getBoundingClientRect().top+scrollY);
  return JSON.stringify(o);
})()`;

// 1ページぶんの縦の内訳（5問を積んだときにどこが効いているか）
const PAGE = `(()=>{
  const H=el=>el?Math.round(el.getBoundingClientRect().height):0;
  const cards=[...document.querySelectorAll('#q-list .q-card')].map(H);
  return JSON.stringify({
    page:H(document.querySelector('.quiz-inner'))+H(document.querySelector('.prog-area')),
    progArea:H(document.querySelector('.prog-area')),
    cards, cardMax:Math.max(...cards), cardMin:Math.min(...cards),
    prog:document.getElementById('prog-text').textContent,
    remain:document.getElementById('q-remain').textContent,
    next:document.getElementById('q-next').textContent
  });
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
    console.log(`#lp-quiz（5問）の高さ: ${Math.round(await evalJS(`document.getElementById('lp-quiz').getBoundingClientRect().height`))}px`);
    // LPで5問答える → .lq-done が下に出る
    for(const pos of [0,1,2,3,4]){
      await evalJS(`pick(document.querySelector('#lq-list .sdw[data-pos="${pos}"][data-v="2"]'))`);
      await new Promise(r=>setTimeout(r,80));
    }
    console.log(`5問回答後の #lp-quiz: ${Math.round(await evalJS(`document.getElementById('lp-quiz').getBoundingClientRect().height`))}px`
      + ` / .lq-done 表示: ${await evalJS(`document.getElementById('lq-done').classList.contains('on')`)}`);
    console.log(`ページ全体の高さ: ${await evalJS('document.documentElement.scrollHeight')}px / 横スクロール: ${await evalJS('document.documentElement.scrollWidth>innerWidth')}`);
    await evalJS(`(()=>{const e=document.getElementById('lq-done');scrollTo(0,Math.max(0,e.getBoundingClientRect().top+scrollY-120));return 1;})()`);
    await new Promise(r=>setTimeout(r,600));
    await screenshot(`/tmp/shots/lp-${w}-done.png`);
    // 診断画面（2ページ目から始まる）
    await evalJS(`document.getElementById('lq-continue').click()`);
    await new Promise(r=>setTimeout(r,900));
    console.log(`診断画面: ${await evalJS(PAGE)}`);
    console.log(`横スクロール: ${await evalJS('document.documentElement.scrollWidth>innerWidth')}`);
    await screenshot(`/tmp/shots/quiz-${w}.png`);
    // 1ページの下端（「次へ」まで）も撮る
    // .q-nav は LP 側にもあるので、診断画面のほうを名指しで取る
    await evalJS(`scrollTo(0,document.querySelector('.quiz-inner .q-nav').getBoundingClientRect().bottom+scrollY-innerHeight+20)`);
    await new Promise(r=>setTimeout(r,600));
    await screenshot(`/tmp/shots/quiz-${w}-bottom.png`);
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
