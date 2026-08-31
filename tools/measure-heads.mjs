// measure-heads — キャラ画像の「頭頂の縦位置」を実測し、
//                  .tc / .cc の object-position を算出する。
//
// なぜ要るか:
//   .tc img / .cc img は object-fit:cover で、画像（縦長）を横長寄りの枠に嵌めている。
//   このとき縦方向が切り取られるので、object-position の Y をどこに置くかで
//   頭が枠外に出るかどうかが決まる。全16体で固定値（50% 6%）にしていたが、
//   頭頂の位置はキャラごとに 1.2%〜9.2% とばらついており、固定値では
//   どちらかの端が必ず破綻する（しゃがみ姿勢・小柄なキャラの頭が切れる）。
//
// 使い方:
//   make heads          … 実測してCSSを出力する（index.html は書き換えない）
//   画像を差し替えたら必ず再実行し、出力されたCSSブロックを index.html に反映すること。
//
// 計測方法（この手順を変えると値が変わるので、変えたらここに書き残すこと）:
//   1. 画像を <canvas> に等倍で描く
//   2. 四隅4点の平均を「背景色」とみなす（キャラ画像は不透過で背景が塗られている）
//   3. 2px刻みで走査し、背景との差（|dR|+|dG|+|dB|）が 60 を超えるピクセルを前景とする
//   4. 行ごとの前景ピクセル数が「最大値の 4%」を超える最初の行を頭頂とする
//      （4% の下限は、髪の毛先や薄い影を頭頂と誤検出しないためのもの）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { withPage } from './cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8797;
const CODES = ['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'];
const CODE_OF = { a1:'HALS',a2:'HALG',a3:'HAWS',a4:'HAWG',b1:'HBLS',b2:'HBLG',b3:'HBWS',b4:'HBWG',
                  c1:'DALS',c2:'DALG',c3:'DAWS',c4:'DAWG',d1:'DBLS',d2:'DBLG',d3:'DBWS',d4:'DBWG' };

// 頭の上に残す余白。枠の高さに対する割合。
// 4% だと 128px の枠で 5px にしかならず、髪の先端が枠線に接して「切れている」と
// 受け取られた（オーナー報告・DAWG）。数値上は入っていても、見た目には余白が要る。
// 10% なら同じ枠で約 13px 空き、どのキャラでも先端が枠に触れない。
const MARGIN = 0.10;
// 枠幅が変わると切り取り量（f）も変わる。ここに挙げた幅すべてで頭が入る値を採る。
const WIDTHS = [480, 390, 375, 360, 320];

const MIME = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.webp':'image/webp',
               '.jpg':'image/jpeg', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const URL = `http://127.0.0.1:${PORT}/index.html`;

// --- ブラウザ側で走らせる計測本体 -------------------------------------------
const MEASURE = `(async()=>{
  const CODES=${JSON.stringify(CODES)};
  const out={};
  const scan=async src=>{
    const im=new Image();
    await new Promise((ok,ng)=>{im.onload=ok;im.onerror=ng;im.src=src;});
    const W=im.naturalWidth,H=im.naturalHeight;
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const cx=cv.getContext('2d',{willReadFrequently:true});
    cx.drawImage(im,0,0);
    const px=cx.getImageData(0,0,W,H).data;
    const at=(x,y)=>{const i=(y*W+x)*4;return [px[i],px[i+1],px[i+2]];};
    const corners=[at(0,0),at(W-1,0),at(0,H-1),at(W-1,H-1)];
    const bg=[0,1,2].map(k=>Math.round(corners.reduce((a,c)=>a+c[k],0)/4));
    /* 頭頂の検出は「その行に絵があるか」の判定であって、「絵が太いか」ではない。
       前景ピクセル数の割合を閾値にすると、c4（DAWG）のような細く尖った髪の毛先を
       落として、髪が太くなる位置を頭頂と誤検出する（実測で 3.1% → 9.2% と 6ポイント
       ずれ、毛先が丸ごと切り取られていた）。
       そのため 1px 刻みで走査し、色差 30 以上の画素が 2 個以上ある最初の行を頭頂とする。
       圧縮ノイズの単発ヒットを拾わないよう、2 行以内に連続することを条件に加える。 */
    /* FG（色差）は背景のムラより大きく、絵より小さい値にする。素材には上端に
       わずかなグラデーションがあり（c4 で色差 34〜36）、30 だとそれを絵と誤認する。
       絵の画素は数百の色差を持つので 60 で十分に拾える。
       細い毛先を落とさないための工夫は「閾値を下げること」ではなく
       「行あたりの必要画素数を減らし、1px 刻みで走査すること」である。 */
    const FG=60, MINPX=2;
    const rows=[];
    for(let y=0;y<H;y++){
      let n=0;
      for(let x=0;x<W;x++){
        const p=at(x,y);
        if(Math.abs(p[0]-bg[0])+Math.abs(p[1]-bg[1])+Math.abs(p[2]-bg[2])>FG){ n++; if(n>=MINPX) break; }
      }
      rows.push([y,n]);
    }
    const hit=r=>r[1]>=MINPX;
    let first=null;
    for(let i=0;i<rows.length;i++){
      if(!hit(rows[i]))continue;
      let run=0; while(i+run<rows.length&&hit(rows[i+run]))run++;
      if(run>=2){ first=rows[i]; break; }
    }
    const last=[...rows].reverse().find(hit);
    return {w:W,h:H,
      head:first?+(first[0]/H*100).toFixed(1):null,
      foot:last?+(last[0]/H*100).toFixed(1):null,
      bg:'#'+bg.map(v=>v.toString(16).padStart(2,'0')).join('')};
  };
  for(const c of CODES){
    out[c]={big:await scan('images/chars/'+c+'.webp'),sm:await scan('images/chars/sm/'+c+'.webp')};
  }
  return JSON.stringify(out);
})()`;

const FRAMES = `(()=>{
  const r=s=>{const e=document.querySelector(s);if(!e)return null;
    const b=e.getBoundingClientRect();return {w:+b.width.toFixed(2),h:+b.height.toFixed(2)};};
  return JSON.stringify({vw:innerWidth,tc:r('#type-overview .tc img'),cc:r('.char-strip-track .cc img'),
                         res:r('.res-char'),tp:r('.tp-img'),sb:r('.sb-img')});
})()`;

let heads = null;
const frames = [];
for (const w of WIDTHS) {
  await withPage(URL, w, 900, async ({ evalJS }) => {
    if (!heads) heads = JSON.parse(await evalJS(MEASURE));
    frames.push(JSON.parse(await evalJS(FRAMES)));
  });
}
server.close();

// --- 出力 -------------------------------------------------------------------
console.log('\n=== 画像ごとの頭頂 / 足元（画像高さに対する%） ===');
console.log('code  type   size       頭頂   足元   背景     sm頭頂  sm差');
let smWarn = 0;
for (const c of CODES) {
  const b = heads[c].big, s = heads[c].sm;
  const d = Math.abs(b.head - s.head);
  if (d > 1.0) smWarn++;
  console.log(`${c}    ${CODE_OF[c]}  ${String(b.w + 'x' + b.h).padEnd(9)}  ${String(b.head).padStart(4)}%  ${String(b.foot).padStart(5)}%  ${b.bg}  ${String(s.head).padStart(5)}%  ${d > 1.0 ? '★' + d.toFixed(1) : d.toFixed(1)}`);
}
if (smWarn) {
  console.log(`\n★ sm/ 版と頭頂が1ポイント以上ずれている画像が ${smWarn} 件あります。`);
  console.log('  .cc（sm/ を使う）には sm/ 側の実測値を使うこと。');
} else {
  console.log('\n  sm/ 版は縮小のみで頭頂の位置は同じ（差はすべて1ポイント未満）。--head は共用してよい。');
}

console.log('\n=== 枠のサイズと可視率 f = 枠高 / (枠幅 × 画像比) ===');
console.log('  f が小さいほど縦を強く切り取る。f>=1 なら縦の切り取りは起きない（Y は無関係）。');
const ratio = heads.a1.big.h / heads.a1.big.w;
const fOf = (fr) => fr ? +(fr.h / (fr.w * ratio)).toFixed(3) : null;
const worst = { tc: 1, cc: 1 };
for (const fr of frames) {
  const line = ['tc', 'cc', 'res', 'tp', 'sb'].map(k => {
    const f = fOf(fr[k]);
    if (f === null) return `${k}:—`;
    if (k === 'tc' || k === 'cc') worst[k] = Math.min(worst[k], f);
    return `${k}:${fr[k].w}x${fr[k].h} f=${f}${f >= 1 ? '(切取なし)' : ''}`;
  }).join('  ');
  console.log(`  vw=${String(fr.vw).padStart(3)}  ${line}`);
}
console.log(`\n  採用する f（最小＝最も強く切り取る条件）: .tc=${worst.tc} / .cc=${worst.cc}`);
console.log('  ※ f が小さいほど必要な Y も小さくなる。最小の f で決めた Y は、');
console.log('    それより f が大きい（＝切り取りが弱い）幅でも頭が入る。だから最小を採る。');

// Y(%) = (head − 100·m·f) / (1 − f) を 0〜100 にクランプ
const yFor = (head, f) => Math.max(0, Math.min(100, +(((head - 100 * MARGIN * f) / (1 - f)).toFixed(1))));
const off = f => +(100 * MARGIN * f).toFixed(3);   // 分子の定数項
const den = f => +(1 - f).toFixed(3);              // 分母 (1 − f)
const fr390 = frames.find(f => f.vw === 390);

console.log(`\n=== index.html に貼るCSS（余白 m=${MARGIN}）===`);
console.log('/* --- キャラ画像の頭が切れないようにする（object-position の実測駆動）-------');
console.log('   .tc img / .cc img は縦長画像（800x1200）を横長寄りの枠に object-fit:cover で');
console.log('   嵌めるため、縦が切り取られる。切り取り位置を全16体で固定していたが、');
console.log(`   頭頂の位置は ${Math.min(...CODES.map(c => heads[c].big.head))}%〜${Math.max(...CODES.map(c => heads[c].big.head))}% とばらついており、固定値では両端のどちらかが必ず切れる。`);
console.log('');
console.log('   --head = その画像でキャラの頭頂が始まる縦位置（画像高さに対する%・単位なし）。');
console.log('   ★実測値。画像を差し替えたら `make heads` で取り直すこと。');
console.log('');
console.log('   Y = (--head − 100·m·f) / (1 − f)        m = 頭の上に残す余白率');
console.log(`     f = 枠高 / (枠幅 × ${ratio})  … 縦の可視率。f が小さいほど強く切り取る。`);
console.log(`     m = ${MARGIN}`);
console.log(`     .tc img … 枠幅は可変（vw=480 で ${frames[0].tc.w}px 〜 vw=320 で ${frames[frames.length - 1].tc.w}px）。`);
console.log(`               f は ${worst.tc}〜${Math.max(...frames.map(x => fOf(x.tc)))}。最も強く切り取る f=${worst.tc} で決める。`);
console.log('               （f が大きい幅では余白が増えるだけで、頭は必ず入る）');
console.log(`     .cc img … 枠 ${fr390.cc.w}x${fr390.cc.h} 固定。f=${worst.cc}`);
console.log('   .res-char / .tp-img / .sb-img は f>=1 で縦の切り取りが起きないため対象外。 */');
for (const c of CODES) {
  console.log(`.tc:has(img[src*="chars/${c}"]),.cc:has(img[src*="sm/${c}"]){--head:${heads[c].big.head};}`);
}
console.log(`.tc img{object-position:50% clamp(0%,calc((var(--head,6) * 1% - ${off(worst.tc)}%) / ${den(worst.tc)}),100%);}`);
console.log(`.cc img{object-position:50% clamp(0%,calc((var(--head,5) * 1% - ${off(worst.cc)}%) / ${den(worst.cc)}),100%);}`);

console.log('\n=== 算出される Y（目視確認用。CSSには書かない）===');
console.log('code  head    .tc の Y   .cc の Y');
for (const c of CODES) {
  console.log(`${c}    ${String(heads[c].big.head).padStart(4)}%  ${String(yFor(heads[c].big.head, worst.tc)).padStart(8)}%  ${String(yFor(heads[c].big.head, worst.cc)).padStart(7)}%`);
}
process.exit(0);
