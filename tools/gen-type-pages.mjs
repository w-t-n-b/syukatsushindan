// t/<CODE>.html 16枚を生成する。
//
//   make types
//
// これはシェアされたURLの着地先であり、og:image 16枚の置き場所である。
//
// なぜ中継ページ（r/<CODE>.html）ではないか
// -----------------------------------------------------------------------
// agent-referral-funnel.md は「即 location.replace する薄い中継」を予定して
// いたが、weighted-scoring-and-type-pages.md §D がそれを却下している。
// 中継は検索エンジンにとって中身がゼロで、OGP は中身のあるページからでも
// 同じように出せる。両方は作らない（重複コンテンツになる）。
//
// 何を載せないか（funnel §3 / §D の禁止事項）
// -----------------------------------------------------------------------
//   ・送客リンク（#agent-primary / .ab-link）を1つも置かない。
//     このページは「診断前」であり、診断前の送客は funnel §3 が排除した。
//   ・4軸スコアの棒グラフと、その内訳の説明。診断していない人のスコアは存在しない。
//   ・ニックネーム（diagnosis-experience-revamp.md D-2 ②）。
//
// 結果画面と同じ説明を載せる（2026-09-08・オーナー要望）
// -----------------------------------------------------------------------
//   結果画面が出す静的な説明のうち、ここに無かった3つを足した:
//     com  人との関わり方（結果画面の「コミュニケーション」）
//     sts  消耗しやすいところ
//     grw  伸ばすとしたら（結果画面の「成長のヒント」）
//   これで、タイプ固有の静的な文章はすべてこのページに載る。
//
//   ★載せないものと、その理由:
//     ・4軸スコアと「4つの軸で見ると」… 診断していない人のスコアは存在しない
//       （2026-09-08 以前は「判定理由」「サブタイプ」もここに並んでいた。
//        どちらも結果画面から削除済み。decisions/2026-09-08-result-panels-removed.md）
//     ・「あなたが働きやすい職場」（ENV）… スコアの強さで言い切り方を変える
//       仕組みなので、スコアの無いこのページでは16枚とも同じ言い方になる
//       （workplace-fit.md U-4 で「足さない」と決定済み）
//     ・「注意が必要なタイプ」（bad / bR）… パネル自体を置き続けるかが
//       未決のまま（wording-audit.md 未決3）。未決のものを16ページへ
//       増やさない。加えて good/bad の非対称が未解決
//       （weighted-scoring-and-type-pages.md 未決2）
//     ・「業界別の職種例」… ★結果画面からも削除された（2026-09-08）。
//       ここに載せなかった理由（CD は全タイプ共通でタイプ固有の情報が無い）が、
//       そのまま結果画面でも通ったということである。載せる先はもう無い
//
// 現時点で載せていないが、仕様にはあるもの
// -----------------------------------------------------------------------
//   ・就活あるある（§E の TD[].aru 48行）… まだ書かれていない
//   ・4軸解説 axes/*.html へのリンク    … まだ作られていない
//   どちらも後から足す。生成器はテンプレートを直して make types で足りる。
//
// 見出しから「の例」を外した理由（workplace-fit.md §5-3 / I-5）
// -----------------------------------------------------------------------
//   旧「力を発揮しやすい仕事の例」は、「〜しやすい」で既に断定を避けている
//   のに、名詞側にも「例」を足していた。ヘッジが二重になっている。
//   弱めるのは動詞側だけで行う。直下の .note「職種は例示です。〜」は残す
//   （断定していない文への注記であり、二重になっていない）。
//   ★この説明を HTML コメントで書くと16ページに出荷されてしまう。
//     生成器の判断は生成器側（ここ）に書くこと。
import fs from 'node:fs';
import path from 'node:path';
import { loadTypes, esc } from './type-data.mjs';

/* tools/lint.mjs もここから renderPage を読み、生成物が最新かを検査する
   （weighted-scoring-and-type-pages.md §生成の方針）。テンプレートを直して
   make types を忘れた状態を、機械が見つけられるようにするため。 */
export const OUT_DIR = 't';

let _byCode = null;

/* 相性の相手はカード1枚ぶんの情報しか出さない。診断していない人に
   「あなたと誰の相性が良いか」は言えないので、見出しも「相性がよい組み合わせ」
   （タイプ同士の話）にする。「あなたと相性がよい」にはしない。 */
const miniCard = code => {
  const o = _byCode[code];
  if (!o) return '';
  return `<a class="mini" href="${esc(o.code)}.html">`
       + `<img src="../images/chars/sm/${esc(o.img)}.webp" alt="" loading="lazy" width="56" height="84">`
       + `<span class="mini-t"><b style="color:${o.cat}">${esc(o.code)}</b>${esc(o.name)}</span></a>`;
};

const page = (t, SITE_BASE) => {
  const url = `${SITE_BASE}t/${t.code}.html`;
  /* og:title は受け手に向けて書く（funnel #19）。送り手のニックネームは入れない。
     「あなたは○○です」にしない — 受け手はまだ診断していない。 */
  const ogTitle = `「${t.name}」タイプって、どんな人？ — 就活キャリアタイプ診断`;
  const title   = `${t.name}（${t.code}） | 就活キャリアタイプ診断 16Types`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '就活キャリアタイプ診断', item: SITE_BASE },
      { '@type': 'ListItem', position: 2, name: `${t.name}（${t.code}）`, item: url },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<!-- このファイルは tools/gen-type-pages.mjs が生成している。直接編集しないこと。
     文言は index.html の TD["${t.code}"] にある。直したら make types で作り直す。 -->
<meta name="description" content="${esc(t.desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="就活キャリアタイプ診断">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(t.desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE_BASE)}images/ogp/${esc(t.code)}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${t.name}（${t.code}）— 就活キャリアタイプ診断`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(t.desc)}">
<meta name="twitter:image" content="${esc(SITE_BASE)}images/ogp/${esc(t.code)}.png">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@600;700&family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
:root{
  /* ★index.html の QUIET RESTYLE と同じ2色。色を変えるときは両方直すこと
     （lint「タイプページの配色」が食い違いを検出する）。 */
  --info:#124296;--act:#ba1e1e;--sumi:var(--info);--gun:var(--info);
  --paper:#ffffff;--paper2:#f2f2f3;--ink-field:#f2f2f3;--navy:#1b1b1f;
  --ink:#1b1b1f;--mid:#4c4f55;--light:#8e8e93;--border:#e3e3e6;--border2:#d6d6da;
  --must:var(--info);--verm:var(--info);
  --cat:var(--gun);--cat-ink:var(--gun);
  /* 書体の規則: 指す言葉（タイプコードとタイプ名）だけ明朝。あとはゴシック */
  --gothic:'Zen Kaku Gothic New','Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif;
  --mincho:'CQMincho','Hiragino Mincho ProN','Yu Mincho',YuMincho,'Noto Serif JP',serif;
  --jp-disp:var(--gothic);
  --lat:var(--gothic);
}
@font-face{font-family:'CQMincho';src:url('../fonts/cq-mincho.woff2') format('woff2');
  font-weight:400 700;font-display:swap;
  unicode-range:U+0041-005A,U+3041-309F,U+30A0-30FF,U+4E00-9FFF;}
html,body{background:var(--ink-field);color:var(--ink);
  font-family:var(--gothic);line-height:1.85;
  -webkit-text-size-adjust:100%;}
img{max-width:100%;display:block;}
a{color:var(--cat-ink);}
.wrap{max-width:480px;margin:0 auto;padding:0 16px;}
/* --- ヘッダ（index.html と同じ見え方にする） --- */
.hdr{position:sticky;top:0;z-index:40;background:var(--paper);
  border-bottom:1px solid var(--border);}
.hdr-in{max-width:480px;margin:0 auto;padding:13px 16px;display:flex;
  align-items:center;justify-content:space-between;gap:12px;}
.logo{font-family:var(--lat);font-weight:700;font-size:1.02rem;letter-spacing:2px;
  color:var(--navy);text-decoration:none;display:flex;align-items:center;gap:7px;}
.logo i{width:11px;height:11px;background:var(--verm);display:block;}
.logo span{color:#1a56db;}
.hdr-cta{font-size:.76rem;font-weight:700;color:var(--navy);text-decoration:none;
  border:1px solid var(--border);border-radius:4px;padding:6px 11px;
  background:var(--w,#fff);color:var(--mid);white-space:nowrap;}
/* --- ヒーロー（暗い面。index.html の .result-hero と同じ役割） --- */
.hero{background:var(--ink-field);padding:34px 0 30px;position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;inset:0;pointer-events:none;
  background-image:repeating-conic-gradient(from 0deg at 50% 34%,
    rgba(255,255,255,.055) 0deg 1.05deg,transparent 1.05deg 3.6deg);}
.hero::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;
  /* 4色の帯は QUIET RESTYLE でやめた。差し色を2色に絞ったので成立しない */
  background:var(--border);}
.hero .wrap{position:relative;z-index:1;text-align:center;}
.crumb{font-size:.72rem;color:#8792a8;margin-bottom:14px;}
.crumb a{color:#c3cbdd;}
/* ★文字色を --navy(#1b1b1f) から白へ（2026-09-12・オーナー指摘「見えづらい」）。
   実測 #1b1b1f on #124296 = 1.84:1。AA の 4.5:1 の半分も無い。16ページ全部。
   白にすると 9.35:1。地（--cat）は4系統とも濃いので、白なら全部 4.9:1 以上。
   薄い枠線も外す。塗りつぶしの札に薄いグレーの縁は、にじんで見える。 */
.pill{display:inline-block;font-family:var(--lat);font-size:.72rem;font-weight:700;
  letter-spacing:2px;color:#fff;background:var(--cat);
  border:0;border-radius:3px;padding:5px 12px;
  box-shadow:none;margin-bottom:12px;}
/* ★クリーム色の板をやめる（2026-09-12・オーナー指摘「透過されてない」）。
   絵そのものは透過を持っている（webp の VP8X に ALPH フラグあり）。
   透けていないように見えていたのは、この background:#f7f6f3 のせい。
   ★あわせて cover → contain。絵は 480x640(0.75)、枠は 220x330(0.667) で、
     cover だと**左右が切られていた**（板があったので気づけなかった）。
     板が無くなれば余白は地と同じなので、contain で切らずに置ける。 */
.face{width:186px;height:279px;margin:0 auto 16px;background:none;
  border:0;border-radius:0;box-shadow:none;}
.face img{width:100%;height:100%;object-fit:contain;object-position:50% 50%;}
.code{font-family:var(--mincho);font-weight:400;font-size:1.6rem;letter-spacing:.3em;
  color:var(--cat);line-height:1;}
h1{font-family:var(--mincho);font-weight:600;font-size:1.72rem;line-height:1.4;letter-spacing:.04em;
  color:var(--navy);margin:8px 0 10px;}
.tag{font-size:.94rem;color:var(--mid);font-weight:500;}
/* --- 本文（読む面） --- */
main{background:var(--paper2);padding:28px 0 40px;}
.card{background:var(--paper);border:1px solid var(--border);border-radius:10px;
  padding:18px 18px 20px;margin-bottom:14px;box-shadow:none;}
.card h2{font-family:var(--jp-disp);font-size:1.02rem;font-weight:900;color:var(--navy);
  margin-bottom:9px;padding-bottom:7px;border-bottom:2px solid var(--border);}
.card p{font-size:.9rem;color:var(--ink);}
.kw{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px;justify-content:center;}
.kw span{font-size:.78rem;font-weight:700;color:var(--navy);background:var(--paper);
  border:1px solid var(--border);border-radius:99px;padding:4px 12px;
  box-shadow:none;}
.jobs{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;}
.jobs span{font-size:.8rem;font-weight:700;color:#fff;background:var(--cat-ink);
  border-radius:4px;padding:4px 11px;}
/* 検索でこのページに入った人が、3枚の .mini 以外へ回遊できなかった。
   一覧は LP の #type-section にある（専用の一覧ページは作っていない）。
   主CTA（診断）と競合させないよう、下線付きのテキストリンクにする。
   index.html の .tp-more と同じ役目・同じ見え方。 */
.all-link{display:block;margin-top:14px;text-align:center;
  font-size:.76rem;font-weight:700;color:var(--cat-ink);
  text-decoration:underline;text-underline-offset:3px;}
.minis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px;}
.mini{display:flex;flex-direction:column;align-items:center;gap:6px;
  text-decoration:none;background:var(--paper);border:1px solid var(--border);
  border-radius:8px;padding:9px 5px;box-shadow:none;}
.mini img{width:56px;height:84px;object-fit:contain;}
/* line-break:strict は長音符（ー）と小書き仮名を行頭に置かせない。
   これが無いと「あったかリーダ／ー」のように ー だけが次行に落ちる
   （3列 390px で1列 約100px しかなく、10文字の名前は必ず2行になる）。 */
.mini-t{font-size:.68rem;font-weight:700;color:var(--ink);text-align:center;line-height:1.4;
  line-break:strict;word-break:normal;}
.mini-t{font-family:var(--mincho);}
.mini-t b{display:block;font-family:var(--mincho);font-size:.9rem;letter-spacing:.12em;font-weight:400;}
/* --- CTA --- */
.cta{display:block;text-align:center;text-decoration:none;
  font-family:var(--jp-disp);font-weight:900;font-size:1.06rem;color:#fff;
  background:var(--act);border:1px solid var(--act);border-radius:8px;
  padding:17px 16px;box-shadow:none;margin:22px 0 8px;}
.cta-note{text-align:center;font-size:.76rem;color:var(--mid);}
.note{font-size:.76rem;color:var(--mid);margin-top:10px;}
/* --- フッター --- */
.ftr{background:var(--ink-field);border-top:1px solid var(--border);
  padding:26px 0 30px;text-align:center;}
.ftr-logo{font-family:var(--lat);font-weight:700;letter-spacing:2px;color:var(--navy);
  margin-bottom:9px;}
.ftr p{font-size:.74rem;color:var(--mid);line-height:1.8;}
.ftr nav{margin:12px 0 10px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;}
.ftr nav a{font-size:.78rem;color:var(--gun);}
.ftr .cp{font-size:.72rem;color:var(--light);}
@media (min-width:768px){
  .wrap,.hdr-in{max-width:640px;}
  h1{font-size:2.05rem;}
  .face{width:220px;height:330px;}
}
</style>
</head>
<body>

<header class="hdr">
  <div class="hdr-in">
    <a class="logo" href="../index.html"><i></i>CAREER <span>TYPE</span></a>
    <a class="hdr-cta" href="../index.html?ref=type">診断する</a>
  </div>
</header>

<div class="hero">
  <div class="wrap">
    <nav class="crumb"><a href="../index.html">就活キャリアタイプ診断</a> ／ ${esc(t.code)}</nav>
    <div class="pill">${esc(t.code.slice(0, 2))}系 — ${esc(t.label)}</div>
    <div class="face"><img src="../images/chars/${esc(t.img)}.webp" alt="${esc(t.name)}のイメージイラスト" width="800" height="1200"></div>
    <div class="code">${esc(t.code)}</div>
    <h1>${esc(t.name)}</h1>
    <p class="tag">${esc(t.tag)}</p>
  </div>
</div>

<main>
  <div class="wrap">

    <div class="kw">${t.kw.map(k => `<span>${esc(k)}</span>`).join('')}</div>

    <section class="card">
      <h2>どんなタイプ？</h2>
      <p>${esc(t.per)}</p>
    </section>

    <section class="card">
      <h2>強み</h2>
      <p>${esc(t.str)}</p>
    </section>

    <section class="card">
      <h2>人との関わり方</h2>
      <p>${esc(t.com)}</p>
    </section>

    <section class="card">
      <h2>消耗しやすいところ</h2>
      <p>${esc(t.sts)}</p>
    </section>

    <section class="card">
      <h2>伸ばすとしたら</h2>
      <p>${esc(t.grw)}</p>
    </section>

    <section class="card">
      <h2>力を発揮しやすい仕事</h2>
      <div class="jobs">${t.jobs.map(j => `<span>${esc(j)}</span>`).join('')}</div>
      <p style="margin-top:11px;">${esc(t.why)}</p>
      <p class="note">職種は例示です。特定の企業の採用基準や、選考の結果とは関係ありません。</p>
    </section>

    <section class="card">
      <h2>相性がよい組み合わせ</h2>
      <div class="minis">${t.good.map(miniCard).join('')}</div>
      <p class="note">タイプ同士の傾向の話であり、特定の人との関係を判定するものではありません。</p>
      <a class="all-link" href="../index.html#type-section">16タイプをすべて見る →</a>
    </section>

    <a class="cta" href="../index.html?ref=type">20問で自分のタイプを調べる →</a>
    <p class="cta-note">20問・約3分</p>

  </div>
</main>

<footer class="ftr">
  <div class="wrap">
    <div class="ftr-logo">CareerType</div>
    <p>本診断は、20問の回答から働き方の傾向を4つの軸・16タイプに分類するものです。職業への適性や、選考の合否を判定するものではありません。</p>
    <nav>
      <a href="../index.html">診断トップ</a>
      <a href="../privacy.html">プライバシーポリシー</a>
      <a href="../privacy.html#operator">運営者情報</a>
    </nav>
    <div class="cp">© キャリアタイプ診断 運営事務局</div>
  </div>
</footer>

</body>
</html>
`;
};

/** 16枚ぶんの { code, file, html } を返す（ディスクには書かない）。 */
export async function renderAll() {
  const { types, SITE_BASE } = await loadTypes();
  _byCode = Object.fromEntries(types.map(t => [t.code, t]));
  return types.map(t => ({
    code: t.code,
    name: t.name,
    file: `${OUT_DIR}/${t.code}.html`,
    html: page(t, SITE_BASE),
  }));
}

/* 直接実行されたときだけ書き出す（lint から import されたときは書かない）。 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ROOT } = await loadTypes();
  const out = path.join(ROOT, OUT_DIR);
  fs.mkdirSync(out, { recursive: true });
  const pages = await renderAll();
  for (const p of pages) {
    const f = path.join(ROOT, p.file);
    fs.writeFileSync(f, p.html);
    console.log(`  ${p.file}`.padEnd(22) + `${(fs.statSync(f).size / 1024).toFixed(1)}KB  ${p.name}`);
  }
  console.log(`\n[gen-type-pages] ${pages.length}枚`);
}
