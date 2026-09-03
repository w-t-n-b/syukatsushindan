// lint — このプロジェクトの「壊れてはいけない約束」を機械的に確かめる。
//
// 対象は単一HTMLの静的サイト（外部ライブラリなし・ビルドなし）。
// ESLint 等は依存を増やすため使わない。ここで見るのは、
// 過去に実際に壊れた／壊れると致命的になる箇所だけに絞っている。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let ng = 0;
const ok = m => console.log(`  ok   ${m}`);
const bad = m => { ng++; console.log(`  NG   ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const PAGES = ['index.html', 'privacy.html'];

console.log('[lint] 構成の制約');
for (const p of PAGES) {
  check(fs.existsSync(path.join(ROOT, p)), `${p} が存在する`);
}

const html = read('index.html');

// --- 単一HTML構成（外部JSライブラリを足していないこと） ---
{
  const ext = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  check(ext.length === 0, `外部JSの読み込みが0件（実際: ${ext.length}件${ext.length ? ' → ' + ext.join(', ') : ''}）`);

  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
  check(inline.length === 1, `インライン<script>は1つ（実際: ${inline.length}）`);

  const styles = html.match(/<style[^>]*>/g) || [];
  check(styles.length === 1, `インライン<style>は1つ（実際: ${styles.length}）`);

  const cssLinks = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/g)].map(m => m[1]);
  const nonFont = cssLinks.filter(u => !u.includes('fonts.googleapis.com'));
  check(nonFont.length === 0, `外部CSSはGoogle Fontsのみ（他: ${nonFont.length}件）`);
}

// --- レイアウト制約（スマホファースト） ---
console.log('[lint] レイアウト制約');
check(/\.wrap\{[^}]*max-width:480px/.test(html), '.wrap max-width:480px を維持');
check(/\.hdr\{[^}]*height:60px/.test(html), '.hdr height:60px を維持');

// --- 画像パスが実在すること ---
console.log('[lint] 画像');
{
  // JS のテンプレート文字列（images/chars/${codeImg(code)}.webp）は、
  // 16タイプぶんの実ファイル名に展開してから存在を確かめる。
  const IMG_NAMES = ['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'];
  const raw = new Set(
    [...html.matchAll(/(?:src=|url\()['"]?(images\/[^"')\s]+)/g)].map(m => m[1])
  );
  const resolved = new Set();
  for (const r of raw) {
    if (r.includes('${')) {
      // `images/chars/${codeImg(code` のように途中で切れているので、
      // ${...} 以降を捨てて16通り + 拡張子に組み立て直す
      const prefix = r.slice(0, r.indexOf('${'));
      for (const n of IMG_NAMES) resolved.add(`${prefix}${n}.webp`);
    } else {
      resolved.add(r);
    }
  }
  const missing = [...resolved].filter(r => !fs.existsSync(path.join(ROOT, r)));
  check(missing.length === 0,
    `参照している画像 ${resolved.size} 件がすべて存在する（テンプレート展開込み）${missing.length ? ' → 欠落: ' + missing.join(', ') : ''}`);

  const ogp = 'images/ogp/default.png';
  check(fs.existsSync(path.join(ROOT, ogp)), `${ogp} が存在する（og:image）`);
}

// --- 事実に反する表示を混入させない（docs/design/retro-restyle.md §10-1 / 仕様 L-6）---
// コメント内の言及は許す。「利用者の画面に出る文字列」だけを見たいので、
// <script> のコメントと HTML コメントを落としてから検索する。
console.log('[lint] 事実に反する表示の混入防止');
{
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const banned = [
    ['TYPE_PCT', '根拠のないタイプ別割合'],
    ['希少度', '事実と逆の希少度表示'],
    ['診断者数', '架空の診断者数'],
    ['しかいない', '根拠のない希少性の主張'],
    ['SPI', '他社検査名による裏付けの偽装'],
    ['12,847', '架空の診断者数'],
    ['最適な', '根拠のない個別最適化の主張'],
    ['あなた専用', '根拠のない個別最適化の主張'],
    ['内定率', '検証不能な成果の主張'],
    // 以下は docs/design/wording-audit.md §7。禁じていたのは「最適な」という
    // 文字列そのものだったため、「最適です」「に最適」のように活用を変えた同じ
    // 主張が TD[].why に戻っていた。活用形と記号まで含めて止める。
    ['最適', '比較対象を示さない最上級（「最適な」の活用形も含めて止める）'],
    ['◎', '根拠のない格付け記号（相性◎ / 相性も◎ / 〜が◎）'],
    ['ぴったり', '検証できない適合の断定'],
    ['真価を発揮', '他の場面が偽であることを含意する断定'],
    ['高く評価されます', '採用側の評価を約束する表現'],
    ['市場価値が急上昇', '労働市場についての検証不能な予測'],
    ['飛躍的に', '効果の大きさについての検証不能な予測'],
  ];
  for (const [w, why] of banned) {
    const n = stripped.split(w).length - 1;
    check(n === 0, `「${w}」が0件（${why}）${n ? ` → ${n}件` : ''}`);
  }
}

// --- 診断体験の改訂（docs/specs/diagnosis-experience-revamp.md）の削除条件 ---
// 「消したはずのものが残っていない」は目視では守れない。受け入れ基準の grep をそのまま置く。
console.log('[lint] 診断体験の改訂：消したものが戻っていないこと');
{
  // 設計B：強制二択モードの廃止
  // 仕様本文は grep "bin\|binary" が0件としているが、この2語は tabindex に
  // 部分一致する（C-7 と UI仕様 §5-3 が tabindex を要求している）。
  // 実効性のある受け入れ基準側のパターン（§受け入れ基準 設計B）を採用する。
  const binPat = /bin-banner|bin-tog|bin-icon|binaryMode|toggleBinary|binary-on|binary_mode|強制二択/gi;
  const binHits = html.match(binPat) || [];
  check(binHits.length === 0, `強制二択モードの残骸が0件${binHits.length ? ' → ' + [...new Set(binHits)].join(', ') : ''}`);

  // C-6：scores を捏造して結果全文を出す経路
  const jt = (html.match(/jumpToType/g) || []).length;
  check(jt === 0, `jumpToType が0件（未診断者に結果全文と送客ブロックを出す経路）${jt ? ` → ${jt}件` : ''}`);

  // A-3：2つあった進捗表示を .prog-seg に統合した
  // 「何を何に置き換えたか」はコメントに残す価値があるので、コメントは除いてから見る。
  const live = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const dp = (live.match(/dot-prog|ax-bars|\bax-bar\b/g) || []).length;
  check(dp === 0, `#dot-prog / .ax-bars が0件（.prog-seg に統合）${dp ? ` → ${dp}件` : ''}`);
  check(/class="prog-seg"/.test(html), '.prog-seg が存在する');
  check((html.match(/class="prog-seg"/g) || []).length === 2, '.prog-seg はLPと質問画面の2箇所（同一部品の使い回し）');

  // 5問ずつ：質問カードは buildCard() が組み立てる。静的な .q-card は持たない。
  // （LP と診断画面それぞれに空のリストが1つずつあるだけ）
  // 判定は「配信されるマークアップ」に対して行う。JS の中の組み立てテンプレートは対象外。
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const staticCards = (markup.match(/class="q-card/g) || []).length;
  check(staticCards === 0, `静的な .q-card が0件（5問ぶんは buildCard() が組む）${staticCards ? ` → ${staticCards}件` : ''}`);
  check(/id="lq-list"/.test(html) && /id="q-list"/.test(html),
    'LP（#lq-list）と診断画面（#q-list）に質問リストの器がある');
  check(/const PAGE_SIZE=5/.test(html) && /const PAGE_COUNT=Math\.ceil\(Qs\.length\/PAGE_SIZE\)/.test(html),
    '1ページ5問・ページ数は問数から算出（20問 → 5問×4群）');
  check(/function pagePositions\(/.test(html) && /function firstIncompletePage\(/.test(html),
    'ページと出題位置の対応（pagePositions / firstIncompletePage）がある');
  // Q1-5 は LP のみ（オーナー判断）。診断画面はページ1-3（Q6-20）の3ページ。
  // ここが 0 に戻ると、診断画面に Q1-5 が復活して「2つの入口」に逆戻りする。
  check(/const LP_PAGE=0;/.test(html) && /const QUIZ_FIRST_PAGE=1;/.test(html),
    'LP はページ0・診断画面はページ1から（Q1-5 は LP のみ）');
  check(/const QUIZ_PAGE_COUNT=PAGE_COUNT-QUIZ_FIRST_PAGE;/.test(html),
    '診断画面のページ数は PAGE_COUNT から算出（べた書きしない）');
  check(/curPage=Math\.max\(QUIZ_FIRST_PAGE,Math\.min\(PAGE_COUNT-1,p\)\)/.test(html),
    'goToQuizPage() は下限を QUIZ_FIRST_PAGE でクランプする（診断画面に Q1-5 を出さない）');
  check(/if\(curPage<=QUIZ_FIRST_PAGE\)return;/.test(html),
    'goBack() は診断画面の先頭ページで止まる（LP へは戻さない）');
  check(/bk\.style\.display=p>QUIZ_FIRST_PAGE\?'flex':'none'/.test(html),
    '「前のページに戻る」は診断画面の先頭ページでは出さない');
  // 入口4つ（16タイプ節・ドロワー・共有バナー・タイプ紹介）の分岐は1つに統一した。
  // ページ0が埋まっていない人を診断画面へ入れると、埋めようのない穴が残る。
  check(/function continueOrStart\(entry\)\{\s*if\(unansweredIn\(LP_PAGE\)>0\)\{goToLpQuiz\(\);return;\}/.test(html),
    'continueOrStart() は、ページ0に未回答があれば入口を問わず #lp-quiz へ送る');
  check(/if\(unansweredIn\(LP_PAGE\)>0\)goToLpQuiz\(\);/.test(html),
    '途中復帰も同じ条件で分岐する（回答総数ではなくページ0の充足で見る）');
  {
    // PAGE_MSGS は診断画面のページ数と同数。ずれると最後のページで
    // 「最後のページです」以外が出る。
    const pm = html.match(/const PAGE_MSGS=\[([\s\S]*?)\];/);
    const items = pm ? [...pm[1].matchAll(/"([^"]*)"/g)].map(m => m[1]) : [];
    check(items.length === 3,
      `PAGE_MSGS は診断画面の3ページぶん（${items.length}件）: ${items.join(' / ')}`);
    check(items[items.length - 1] === '最後のページです',
      `最終ページの文言は「最後のページです」（仕様 §B-5）: ${items[items.length - 1] || 'なし'}`);
    check(!items.some(s => /ページ目/.test(s)),
      'PAGE_MSGS に「◯ページ目」が残っていない（LP がページ0を持つので数え方が合わない）');
  }

  // C-7：回答ドットは <button> + role="radio"。組み立てているのは buildCard()。
  const sdwBuild = html.match(/class="sdw\$\{sel\?' sel':''\}"[\s\S]{0,240}?><span class="sd">/);
  check(!!sdwBuild, '.sdw は buildCard() が組み立てている');
  const sdwSrc = sdwBuild ? sdwBuild[0] : '';
  check(/<button type="button" class="sdw/.test(html), '.sdw は <button>');
  check(/role="radio"/.test(sdwSrc), '.sdw に role="radio"');
  check(/aria-checked="\$\{sel\?'true':'false'\}"/.test(sdwSrc), '.sdw に aria-checked が付く');
  check(/data-pos="\$\{pos\}"/.test(sdwSrc), '.sdw は出題位置（data-pos）を持つ＝どの設問の目盛か特定できる');
  check(/<div class="spec-track" role="radiogroup"/.test(html),
    '.spec-track は role="radiogroup"（5問ぶんが独立したグループになる）');

  // 6段階スケール：中央値（どちらでもない）を廃止し、必ずどちらかに倒す
  const scale = html.match(/const SCALE=\[([\s\S]*?)\];/);
  const vals = scale ? [...scale[1].matchAll(/\[(-?\d+),'/g)].map(m => Number(m[1])) : [];
  check(vals.join(',') === '3,2,1,-1,-2,-3', `回答値は +3/+2/+1/-1/-2/-3（実際: ${vals.join(',') || 'なし'}）`);
  check(!vals.includes(0), '中央値 0 が存在しない');
  const chudemo = (live0 => (live0.match(/どちらでもない/g) || []).length)(
    html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
  check(chudemo === 0, `画面に出る「どちらでもない」が0件（6段階化で廃止）${chudemo ? ` → ${chudemo}件` : ''}`);
  check(/const AX_MAX=15/.test(html), '棒グラフのスケールが ±15（1軸5問 × 最大±3）に追従している');
  check(/function axisIsPos\(/.test(html) && /function axisVotes\(/.test(html),
    '軸の合計が0のときのタイブレーカー（多数決）が実装されている');

  // C-4：測定軸の名前を回答前に見せない
  for (const [pat, what] of [[/id="q-axis"/, '#q-axis'], [/id="lq-axis"/, '#lq-axis'],
                             [/class="spec-labels"/, '.spec-labels'], [/class="sl-a"/, '.sl-a'],
                             [/class="q-ax"/, '.q-ax']]) {
    check(!pat.test(html), `${what} が0件（回答前に軸名を開示しない）`);
  }
  // 開示は結果側で担保する
  check(/判定理由/.test(html) && /診断スコア/.test(html),
    '軸の開示は結果画面（判定理由 / 診断スコア）に残っている');

  // C-5：紙吹雪とカウントアップの撤廃
  const fx = [['launchConfetti', '紙吹雪'], ['conf-wrap', '紙吹雪のDOM'],
              ['confA', '紙吹雪のアニメーション'], ['animateCount', 'カウントアップ']];
  const liveFx = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [w, why] of fx) {
    const n = (liveFx.match(new RegExp(w, 'g')) || []).length;
    check(n === 0, `${w}（${why}）が0件${n ? ` → ${n}件` : ''}`);
  }
  // .hero-stats（20 質問数 / 16 タイプ数 / 3分 所要時間）はカードごと削除した。
  // 「20問・約3分」は .hero-sub が文章で言っており、情報が重複していた。
  const hs = (liveFx.match(/hstat|hero-stats|stat-count/g) || []).length;
  check(hs === 0, `.hero-stats / .hstat / #stat-count が0件（3連カードを撤去）${hs ? ` → ${hs}件` : ''}`);
  check(/20問・約3分/.test(html), '「20問・約3分」は .hero-sub に残っている（情報自体は消えていない）');

  // キャラ画像の頭が切れないようにする object-position（tools/measure-heads.mjs の実測駆動）
  // .cc（キャラマーキー）は廃止したので、--head を持つのは .tc だけになった。
  const IMG_CODES = ['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'];
  const noHead = IMG_CODES.filter(c =>
    !new RegExp(`\\.tc:has\\(img\\[src\\*="chars/${c}"\\]\\)\\{--head:`).test(html));
  check(noHead.length === 0,
    `全16体に --head（頭頂位置の実測値）が定義されている${noHead.length ? ' → 欠落: ' + noHead.join(',') : ''}`);
  // 固定値に戻すと頭頂の低いキャラ（c4=9.2%）が切れる。--head 経由でしか指定させない。
  check(/\.tc img\{object-position:50% clamp\(0%,calc\(\(var\(--head/.test(html),
    '.tc img の object-position は --head から算出している（固定値に戻していない）');
  // .cc 側の算出式が残っていないこと。存在しないセレクタの計算式を残すと
  // 「マーキーを復活させれば使える」と誤読される（design §2-2 / W-3）。
  const ccHead = (html.match(/\.cc:has\(|\.cc img\{object-position/g) || []).length;
  check(ccHead === 0, `.cc 向けの --head / object-position が0件（帯の廃止に追従）${ccHead ? ` → ${ccHead}件` : ''}`);
  check(/\.res-char\{[^}]*object-position:50% 50%/.test(html),
    '.res-char は 50% 50% のまま（f>=1 で縦の切り取りが起きないため対象外）');
  /* HAWG(a4) / HALG(a2) の引き（オーナー指摘: HAWG が寄りすぎ）。
     可視域の最大横幅が 80.8 / 82.1 と突出しており、他の体（中央値 約59）と
     並ぶと枠を圧迫する。左右 padding で描画幅だけを縮める（c4 と同じ手法）。 */
  check(/\.tc:has\(img\[src\*="chars\/a4"\]\) img,\s*\.tc:has\(img\[src\*="chars\/a2"\]\) img\{[^}]*padding:0 14%/.test(html),
    'HAWG(a4) / HALG(a2) は左右 padding 14% で引いている（描画幅だけを縮める）');
  /* 320〜360px では引かない。素の可視率（f=0.632〜0.551）で既に上半身が収まり、
     引くと f' が 0.878 まで上がって a2/a4 だけ全身になる。 */
  check(/@media \(min-width:361px\)\{\s*\.tc:has\(img\[src\*="chars\/a4"\]\) img,/.test(html),
    'a4 / a2 の引きは 361px 以上でだけ効かせる（狭い端末では素の切り取りのほうが揃う）');
  /* a2 / a4 は --head が 1.4 / 2.4 と低く、clamp 式が負になって Y=0 に張り付く。
     Y=0＝画像の最上端から見せる＝頭上の余白の上限。ここに固定値を足すと頭が切れる。 */
  const a24pos = /\.tc:has\(img\[src\*="chars\/a[24]"\]\) img\{[^}]*object-position/.test(html);
  check(!a24pos, 'a2 / a4 に object-position を直接書いていない（--head 経由の Y=0 を上書きしない）');
  /* HAWS(a3) は対象外。可視域の最大横幅 58.3 が既に中央値で、引くと逆に最小になる。 */
  check(!/chars\/a3"\]\) img\{[^}]*padding/.test(html),
    'HAWS(a3) には引きを入れていない（可視域の横幅が既に中央値のため）');
  check(fs.existsSync(path.join(ROOT, 'tools/measure-heads.mjs')),
    '頭頂位置の再計測スクリプトがある（make heads。画像を差し替えたら実行する）');

  // A-5：既存CTAは startFresh() ではなく continueOrStart() を呼ぶ
  const rawStart = [...html.matchAll(/on\w+="[^"]*startFresh\(/g)].length;
  check(rawStart === 0, `on* から startFresh() を直接呼ぶ箇所が0件（回答が消える）${rawStart ? ` → ${rawStart}件` : ''}`);
  check((html.match(/continueOrStart\(/g) || []).length >= 5,
    'continueOrStart() の呼び出しがヒーロー/16タイプ節/ドロワー/共有バナー/タイプ紹介にある');
  check(!html.includes('まず診断だけ受けてみる'), '「まず診断だけ受けてみる」（主CTAと同一動作の偽の選択肢）が0件');

  // A-2 / 6段階化：保存キーは cq_p3。旧 cq_p（旧出題順）と cq_p2（旧5段階）は起動時に捨てる
  check(/const SAVE_KEY='cq_p3'/.test(html), '保存キーが cq_p3 に変わっている');
  check(/const LEGACY_SAVE_KEYS=\['cq_p','cq_p2'\]/.test(html),
    '旧キー cq_p / cq_p2 の両方を削除対象にしている');
  check(/function dropLegacyProgress\(\)/.test(html), '旧キーを削除する処理がある');

  // A-2：質問ごとの全面グラデーション（軸別インライン背景）を廃止した
  check(!/quiz-bg'\)\.style\.background/.test(html) && !/q-top'\)\.style\.background/.test(html),
    '#quiz-bg / #q-top へのインライン background 代入が0件（背景は問ごとに変化しない）');

  // 計測：新規イベントも GA_ID が空なら送信されない track() 経由であること
  for (const ev of ['lp_q_answer', 'lq_continue_click', 'type_peek']) {
    check(new RegExp(`track\\('${ev}'`).test(html), `${ev} は track() 経由で送る（GA_ID が空なら送信しない）`);
  }
}

// --- ヒーローの作り替え（docs/design/hero-floating-characters.md）---------
// マーキーと3ステップは「消した」ことが受け入れ基準そのものなので、
// 消えたままであることを名指しで押さえる。代わりに入った .hero-cast も同じ強さで見る。
console.log('[lint] ヒーロー：マーキー廃止 / 3ステップ削除 / 浮遊キャラ');
{
  const live = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // (1) キャラのスライドする帯（判断①）
  const marquee = live.match(/char-strip-outer|char-strip-track|csScroll|\bcc-code\b|\bcc-name\b|class="cc"/g) || [];
  check(marquee.length === 0,
    `キャラマーキーの残骸が0件（.char-strip-outer / .char-strip-track / @keyframes csScroll / .cc 系）${marquee.length ? ' → ' + [...new Set(marquee)].join(', ') : ''}`);
  // 16タイプ一覧（.tc）は残っている。帯だけを消したことを両側から確かめる。
  check(/\.tc:has\(img\[src\*="chars\/c4"\]\) img\{/.test(html),
    'DAWG(c4) の切り取り例外は .tc 側に残っている（帯と一緒に消していない）');
  check(/id="type-overview"/.test(html), '16タイプ一覧（#type-overview）は残っている');

  // (2) 「3ステップで完了」の節（判断⑨）
  const steps = live.match(/class="steps"|class="step"|\bstep-n\b|\bstep-lbl\b|\bstep-desc\b|3ステップで完了|How it works/g) || [];
  check(steps.length === 0,
    `「3ステップで完了」の残骸が0件（.steps / .step-n / .step-lbl / .step-desc / 見出し文言）${steps.length ? ' → ' + [...new Set(steps)].join(', ') : ''}`);
  // 消えたセレクタが --lat / --jp-disp のセレクタ列に取り残されていないこと
  const latSel = (html.match(/\.res-code,[^{]*\{\s*\n?\s*font-family:var\(--lat\)/) || [])[0] || '';
  check(!/\.step-n|\.cc-code/.test(latSel),
    `--lat のセレクタ列に .step-n / .cc-code が残っていない`);
  const dispSel = (html.match(/\.hero-title,\.res-type-name,[^{]*\{/) || [])[0] || '';
  check(!/\.step-n|\.cc-code|\.cc\b/.test(dispSel),
    '--jp-disp のセレクタ列に .step-n / .cc 系が残っていない');

  // (3) ヒーローの高さ（判断②）
  const heroRule = (html.match(/^\.hero\{[^}]*\}/m) || [])[0] || '';
  check(!/min-height/.test(heroRule),
    `.hero に min-height が無い（高さは中身の積算そのもの）: ${heroRule.slice(0, 60)}…`);
  // 28px は「本文と朱色のCTAを密着させない」ための間隔だった。CTA を削除した
  // （案C）ので離す相手が居なくなり、0 にして .hero の padding-bottom に任せる。
  // 28px は .cont-banner（再訪者にだけ出る）の上マージンへ移した。
  check(/\.hero-sub\{margin-bottom:0;\}/.test(html),
    '.hero-sub の下マージンが 0（CTA を削除したので離す相手が無い）');
  check(/\.cont-banner\{margin-top:28px;margin-bottom:0;\}/.test(html),
    '28px は .cont-banner の上マージンへ移した（再訪者の本文密着を防ぐ）');

  // (4) 浮遊キャラの層（判断③⑤⑦⑬）
  check(/\.hero-cast\{/.test(html) && /\.hc\{/.test(html) && /@keyframes hcFloat\{/.test(html),
    '.hero-cast / .hc / @keyframes hcFloat が定義されている');
  check(/\.hero-cast\{[^}]*pointer-events:none/.test(html),
    '.hero-cast は pointer-events:none（押せる見た目を持たせない）');
  check(/\.hero-cast\{[^}]*z-index:0/.test(html) && /\.hero-inner\{[^}]*z-index:1/.test(html),
    '.hero-cast は .hero-inner（z-index:1）より下の層');
  check(/@keyframes hcFloat\{0%,100%\{transform:translateY\(0\);\}/.test(html),
    'hcFloat の 0% と 100% がともに translateY(0)（動きを止めても設計位置で静止する）');
  check(/@media \(prefers-reduced-motion:reduce\)\{\.hc\{animation:none;\}\}/.test(html),
    'prefers-reduced-motion でゆらぎを止める指定が明示されている');
  check(!/max-height:560px/.test(html),
    '@media (max-height:560px) による浮遊レイヤーの除外は撤去されている（判断⑬）');
  check(!/--hc-[aytd]:[^;]*svh/.test(html) && /\.hc\{[^}]*height:210px/.test(html),
    '.hc の寸法は px（svh を使っていない。判断⑬）');
  check(/\.hero:has\(\.shared-banner\) \.hero-cast\{display:none;\}/.test(html),
    '共有リンク着地時（.shared-banner）は浮遊キャラを出さない');
  // α の上限。体ごと・画面幅ごとに違う。
  //
  // もとの「一律 .18 以下」は §7-1 の計算値で、次の2つの安全側の仮定から出ていた。
  // 実測するとどちらも成立していない。
  //   (a) 最悪画素は純白 … 実際の素材の最悪は a1 で rgb(209,159,49) 等
  //   (b) 行ボックス全幅が文字 … .hero-title em は display:block なので矩形は
  //       全幅だが、字面はその内側にしかない。幅600px以上では em の字面は 476px
  //       固定で中央に来るため、PC では両端の2体が字面に1画素も重ならない
  //
  // 字面の背後を実測した上限（--must 2行目が 3:1 を割る手前。320〜1920px を掃引）:
  //   <768px   hc-1 .345 / hc-4 .310
  //   ≧768px   hc-1・hc-4 は字面に重ならない → AA 上の上限は無い
  //            hc-2 .510 / hc-3 .345
  //
  // ここは静的な天井にすぎない。AA の判定そのものは e2e が毎回、実配信の webp を
  // canvas で合成して字面の背後を測る（tools/e2e-driver.html の inkRects / worstPixel）。
  // 天井を実測上限の 85% に置くのは、素材の差し替えや集中線の変更で即座に割れない
  // ようにするため（「上限ぴったりに置かない」という判断⑤の方針は引き継ぐ）。
  // 字面に重ならない体には AA 上の上限が無いので、就活サイトとしての信頼感の側から
  // .40 で止める。これは意匠の天井であって AA の天井ではない。
  const HC_LIMIT = { base: { 1: 0.345, 4: 0.310 },
                     wide: { 1: null, 4: null, 2: 0.510, 3: 0.345 } };
  const DESIGN_CEIL = 0.40;
  const hcStart = html.indexOf('.hc-1{');
  const wideStart = html.indexOf('@media (min-width:768px){', hcStart);
  const alphaOf = css => {
    const o = {};
    for (const m of css.matchAll(/\.hc-([1-4])\{[^}]*?--hc-a:\s*(\.?\d*\.?\d+)/g)) o[m[1]] = Number(m[2]);
    return o;
  };
  if (hcStart < 0 || wideStart < 0) {
    check(false, '.hc の α を読み取れない（.hc-1 か @media (min-width:768px) が見つからない）');
  } else {
    const scopes = {
      base: alphaOf(html.slice(hcStart, wideStart)),
      wide: alphaOf(html.slice(wideStart, html.indexOf('\n}', wideStart))),
    };
    const label = { base: '<768px', wide: '≧768px' };
    for (const scope of ['base', 'wide']) {
      for (const [n, a] of Object.entries(scopes[scope])) {
        const lim = HC_LIMIT[scope][n];
        const ceil = lim === null ? DESIGN_CEIL : +(lim * 0.85).toFixed(3);
        const why = lim === null
          ? `字面に重ならないので AA 上の上限なし。意匠の天井 ${DESIGN_CEIL}`
          : `実測上限 ${lim} の85% = ${ceil}`;
        check(a <= ceil, `.hc-${n}（${label[scope]}）の α ${a} が天井以下（${why}）`);
      }
    }
    check(scopes.base[1] !== undefined && scopes.base[4] !== undefined,
      'スマホで出る2体（hc-1 / hc-4）の α が明示されている: '
      + `${scopes.base[1]} / ${scopes.base[4]}`);
    check([1, 2, 3, 4].every(n => scopes.wide[n] !== undefined),
      `≧768px の4体すべてに α が指定されている: ${[1, 2, 3, 4].map(n => scopes.wide[n]).join(' / ')}`);
    // 奥行き。手前（1/4）が奥（2/3）より濃くなければ「奥に引っ込んで見える」が成立しない。
    check(Math.min(scopes.wide[1], scopes.wide[4]) > Math.max(scopes.wide[2], scopes.wide[3]),
      '≧768px で手前の2体が奥の2体より濃い（奥行きの順序が保たれている）');
  }
  // 768px 未満では奥の2体を出さない。PC で開いた窓を狭めても手前の2体と重ならない
  // ようにする（重なると実効αが 1-(1-a)(1-b) まで上がって AA を割る）。
  check(/\.hc-2,\.hc-3\{display:none;\}/.test(html)
        && /\.hc-2,\.hc-3\{display:block;/.test(html),
    '奥の2体は <768px で display:none、≧768px で display:block');
  // 〜360px で hc-1 を左へ逃がす指定。見出しの字面は幅の約80%を占めるので、
  // 端末が狭いほど図の内側まで文字が及ぶ。320px では a1 の白シャツ（画像 x38〜46）が
  // 2行目の字面に入り、α の上限が .345 → .270（300〜310px では .205）に落ちる。
  // これを消すと α .28 のまま 320px で AA を割る（e2e の 320x568 が落ちる）。
  check(/@media \(max-width:360px\)\{\.hc-1\{left:-36px;\}\}/.test(html),
    '〜360px で hc-1 を左へ 36px 逃がす（320px でも α の上限を .345 に保つ）');
  // ゆらぎの振幅。8px 以上にすると top:66px から頭が固定ヘッダー（60px）にもぐる。
  const amps = [...html.matchAll(/--hc-y:\s*-(\d+)px/g)].map(m => Number(m[1]));
  check(amps.length >= 2 && Math.max(...amps) <= 6,
    `ゆらぎの振幅が 6px 以下（ヘッダー下端 60px に頭を突っ込ませない）: ${amps.join(' / ')}px`);
  // キャストは4体固定・スマホは両端2体（判断③）
  check(/const CAST=\[\['a1',1\],\['b3',2\],\['c1',3\],\['d1',4\]\]/.test(html),
    'キャストは a1 / b3 / c1 / d1 の4体（.hero::after の4色バーと同じ並び）');
  check(/matchMedia\('\(min-width:768px\)'\)\.matches\?CAST:\[CAST\[0\],CAST\[3\]\]/.test(html),
    'スマホ（<768px）では両端の2体だけを挿入する');
  check(/box\.setAttribute\('aria-hidden','true'\)/.test(html) && /im\.alt='';/.test(html),
    '浮遊キャラは aria-hidden + alt="" の二重で読み上げから外す');
  check(/im\.loading='lazy'/.test(html) && /im\.decoding='async'/.test(html),
    '浮遊キャラは lazy / async（文字とCTAの描画を待たせない）');
  // src はテンプレート連結なので、上の「画像が実在する」検査では
  // ディレクトリ止まりでしか照合できない。4体を名指しで確かめる。
  {
    const cast = ['a1', 'b3', 'c1', 'd1'].map(c => `images/chars/sm/${c}.webp`);
    const gone = cast.filter(f => !fs.existsSync(path.join(ROOT, f)));
    check(gone.length === 0, `浮遊キャラ4体の素材が実在する${gone.length ? ' → 欠落: ' + gone.join(', ') : ''}`);
    if (gone.length === 0) {
      const size = f => fs.statSync(path.join(ROOT, f)).size;
      const sp = size(cast[0]) + size(cast[3]);      // スマホは両端の2体
      const pc = cast.reduce((s, f) => s + size(f), 0);
      // 帯の廃止で 16枚（sm/ 全部）の取得が消えた。装飾を足して通信量は減る側に居ること。
      check(pc <= 100 * 1024,
        `浮遊キャラの通信量が上限内（スマホ ${(sp / 1024).toFixed(1)}KB / PC ${(pc / 1024).toFixed(1)}KB ≦ 100KB）`);
    }
  }

  // (5) 装飾円とシルエット（判断⑧⑪）
  check(/\.hero \.hero-orb\{display:none;\}/.test(html),
    'ヒーローの装飾円 .o1/.o2/.o3 は出さない（DOM は残す）');
  check(/class="hero-orb o1"/.test(html), '装飾円の DOM は消していない（結果画面の .ro とは別物）');
  check(/\.hero-sil,\.result-sil,\.tc-sil\{display:none;\}/.test(html),
    '.hero-sil / .result-sil / .tc-sil は display:none のまま維持');

  // (6) 文言（判断⑫⑭ → wording-audit.md §2 案B → オーナー判断で §2-3 案Cへ）
  // ヒーローCTAは削除した。案Bは「行き先を1つ」にしたが、押す対象は
  // ボタンと質問カードの2つのままだった。案Cは押す対象そのものを1つにする。
  // 検査は消さずに「無いこと」の検査へ更新する（消すと黙って復活しても気づけない）。
  {
    const liveHero = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hero = (liveHero.match(/cta-hero/g) || []).length;
    check(hero === 0,
      `ヒーローCTA（#cta-hero）が0件 —— 入口は LP の質問カードだけ${hero ? ` → ${hero}件` : ''}`);
    const bw = (liveHero.match(/btn-wrap/g) || []).length;
    check(bw === 0, `.btn-wrap（ヒーローCTAの外枠）も残っていない${bw ? ` → ${bw}件` : ''}`);
    // ヒーローの中に押せるものが1つも無いこと。文字列ではなく構造で見る。
    // （「20問すべてに答えると」は .lq-next-lbl の条件文として正しく生きているので、
    //   文字列の全文検索では判定できない。範囲をヒーローに限る。）
    // 範囲の切り出しは生の html で行う（liveHero はコメントを落としてあるので目印が消える）
    const heroRaw = (html.match(/<div class="hero">[\s\S]*?<div id="lp-quiz-sec">/) || [])[0] || '';
    const heroMarkup = heroRaw.replace(/<!--[\s\S]*?-->/g, '');
    check(heroMarkup.length > 0, 'ヒーローのマークアップを切り出せた（検査範囲の確認）');
    const heroBtns = (heroMarkup.match(/<button/g) || []).length;
    check(heroBtns === 0, `ヒーローの中に <button> が0件（入口は LP の質問カードだけ）${heroBtns ? ` → ${heroBtns}件` : ''}`);
    for (const s of ['最初の質問へ', '20問すべてに答える →', '続きから答える']) {
      check(!liveHero.includes(s), `ヒーローCTAの旧文言「${s}」が残っていない`);
    }
  }
  check(/set\('cta-grid','診断をはじめる →'/.test(html),
    '16タイプ節のCTAは「診断をはじめる →」のまま（ヒーローの削除に巻き込まない）');
  const sub = (html.match(/<p class="hero-sub">([\s\S]*?)<\/p>/) || [])[1] || '';
  check(!!sub && !/本格/.test(sub),
    `.hero-sub から「本格」（検証できない自称）が落ちている: ${sub.replace(/<br>/g, ' / ')}`);
  check(/職種の例/.test(sub), '.hero-sub に「職種の例」が入っている（3ステップの3項目めの受け皿）');
  check(/探し方のヒント/.test(sub), '.hero-sub の「探し方のヒント」は残っている');
}

// --- 回答UI：A / B が画面に出ていること（参考実装 quiz-vertical.js の構成）---
// 軸名を出さない（C-4）まま「Aに強く近い」と言うには、A と B が
// 何を指すのかが画面に出ている必要がある。ここが消えると目盛の文言が意味を失う。
console.log('[lint] 回答UI：A / B の明示');
{
  // 選択肢は枠付きボックス2つ横並びから、テキスト2行に変わった（仕様 §D-1）。
  // A / B の手がかりは「行頭の縦帯」「A. / B. の接頭辞」「選んだ側の .on」の3つ。
  const keys = [...html.matchAll(/<span class="opt-key">([AB])\.<\/span>/g)].map(m => m[1]);
  check(keys.join('') === 'AB', `選択肢に A. / B. の接頭辞がある: ${keys.join(',') || 'なし'}`);
  check((html.match(/class="opt-txt"/g) || []).length === 2,
    '選択肢の本文は .opt-txt に入る（行に直接書くと接頭辞が消える）');
  check(/class="opt-line opt-a\$\{has&&a>0\?' on':''\}"/.test(html) &&
        /class="opt-line opt-b\$\{has&&a<0\?' on':''\}"/.test(html),
    '選んだ側の選択肢に .on が付く（どちらを選んだかが目盛以外でも読める）');
  check(/\.opt-a\.on\{/.test(html) && /\.opt-b\.on\{/.test(html), '.on の見た目が定義されている');
  check(/\.opt-a\{border-left-color/.test(html) && /\.opt-b\{border-left-color/.test(html),
    'A側 / B側の縦帯（色分け）が残っている');
  // コメント（何をやめたかの記録）は残す価値があるので、除いてから数える
  const liveUi = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const boxes = (liveUi.match(/class="choice-box|class="choice-row|\bcb-l\b|\bcb-r\b/g) || []).length;
  check(boxes === 0, `枠付きボックス（.choice-box / .cb-l / .cb-r）が0件${boxes ? ` → ${boxes}件` : ''}`);
  check(/\$\{esc\(q\.a\)\}/.test(html) && /\$\{esc\(q\.b\)\}/.test(html),
    'buildCard() は選択肢本文を esc() を通して .opt-txt に入れる');
  const ends = [...html.matchAll(/<span class="sh-([ab])">([AB])<\/span>/g)].map(m => m[2]);
  check(ends.join('') === 'AB', `目盛の両端に A / B のラベルがある: ${ends.join(',') || 'なし'}`);
  // 「左/右」に戻すと、画面に出ている A / B と読み上げが食い違う
  const lr = (html.match(/aria-label="[^"]*[左右]の選択肢[^"]*"/g) || []).length;
  check(lr === 0, `目盛の aria-label が「左/右」ではなく A / B${lr ? ` → ${lr}件` : ''}`);
  const scale2 = html.match(/const SCALE=\[([\s\S]*?)\];/);
  const labs = scale2 ? [...scale2[1].matchAll(/\[(-?\d+),'([^']+)'\]/g)] : [];
  check(labs.length === 6 && labs.every(([, v, l]) =>
    Number(v) > 0 ? (l.includes('A') && !l.includes('B')) : (l.includes('B') && !l.includes('A'))),
    'aria-label が符号どおり A側 / B側に対応している');
}

// --- レイアウト：セクションが下に空白を抱え込まないこと ---
// .wrap の padding-bottom:100px が LP の中間セクションにも効いていて、
// .steps の下端から .type-grid の上端まで 329px 空いていた（実測）。
console.log('[lint] 余白の作り方');
{
  const wrap = html.match(/^\.wrap\{([^}]*)\}/m);
  const pad = wrap && (wrap[1].match(/padding:([^;]*)/) || [])[1];
  // padding は「左右だけ」＝値2つまで。3つ目（下）を足すと LP の中間セクションが
  // 中身の下に空白を抱え、.steps → .type-grid の 329px が再発する。
  check(!!pad && pad.trim().split(/\s+/).length <= 2,
    `.wrap の padding は左右だけ（下方向を持たない）: padding:${pad || '（なし）'}`);
}

// --- サブタイプに説明があること（オーナー指摘「サブタイプってなんのことだ」）---
console.log('[lint] サブタイプの説明');
{
  const note = html.match(/<div class="sub-note">([^<]+)<\/div>/);
  check(!!note, 'サブタイプに .sub-note（説明文）がある');
  if (note) {
    check(note[1].length >= 30, `説明が1〜2文ある（${note[1].length}文字）`);
    check(/僅差/.test(note[1]), '「最も僅差だった軸を反転したもの」であることに触れている');
    check(!/必ず|断言|確実/.test(note[1]), '断定表現を含まない（分かるのは働き方の傾向まで）');
  }
  check(/\.sub-note\{/.test(html), '.sub-note のスタイルが定義されている');
}

// --- 自社で個人情報を取得しない設計（仕様 L-1 / 受け入れ基準）---
console.log('[lint] 個人情報を取得しない設計');
for (const p of PAGES) {
  const s = read(p);
  const forms = (s.match(/<form\b/g) || []).length;
  const inputs = (s.match(/<input\b/g) || []).length;
  check(forms === 0 && inputs === 0, `${p} に <form>/<input> が0件（form:${forms} input:${inputs}）`);
}

// --- 送客リンクの体裁（掲載が入った瞬間に効く。0件のいまも規約違反を作り込ませない）---
console.log('[lint] 送客リンクの体裁');
{
  const links = [...html.matchAll(/class="ab-link"[^>]*/g)].map(m => m[0]);
  // テンプレート文字列内の1件（生成元）を検査する
  check(links.length >= 1, `.ab-link の生成箇所がある（${links.length}件）`);
  for (const l of links) {
    check(/target="_blank"/.test(l), '.ab-link に target="_blank"');
    check(/rel="[^"]*sponsored[^"]*"/.test(l), '.ab-link の rel に sponsored（景表法ステマ規制 L-4）');
    check(/rel="[^"]*noopener[^"]*"/.test(l), '.ab-link の rel に noopener');
  }
  check(/class="ab-lbl">PR</.test(html), '送客ブロック冒頭に PR 表記がある');
  check(/if\(source!=='quiz'\)return ''/.test(html), '送客ブロックは未診断者に出さない防御がある');
}

// --- 環境依存の値が1箇所に集約されていること ---
console.log('[lint] 設定の集約');
{
  const base = html.match(/const SITE_BASE='([^']+)'/);
  check(!!base, 'SITE_BASE が定義されている');
  if (base) {
    check(base[1].endsWith('/'), `SITE_BASE は末尾スラッシュ付き（${base[1]}）`);
    const abs = [...html.matchAll(/https:\/\/w-t-n-b\.github\.io\/syukatsushindan\//g)].length;
    ok(`絶対URLの直書きは ${abs} 箇所（<head>のOGP群 + SITE_BASE。移行時はここだけ置換する）`);
  }
  const ga = html.match(/const GA_ID='([^']*)'/);
  check(!!ga, 'GA_ID が定義されている');
  check(/if\(!GA_ID\)return;/.test(html), 'GA_ID が空なら外部送信しない分岐がある');
  if (ga && ga[1] === '') {
    check(!/googletagmanager\.com[^']*'\s*\+?\s*$/.test(html) || true, 'GA_ID は未設定（外部送信なし）');
  }
}

// --- OGP ---
console.log('[lint] OGP');
for (const k of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) {
  check(html.includes(`"${k}"`), `<head> に ${k}`);
}
check(html.includes('summary_large_image'), 'twitter:card=summary_large_image');

// --- 公開前に埋める必要がある箇所（残っていても落とさないが、必ず数を出す）---
console.log('[lint] 公開前に人が埋める箇所');
{
  let visible = 0, comment = 0;
  for (const p of PAGES) {
    const s = read(p);
    visible += (s.match(/class="(?:todo|ftr-todo)"/g) || []).length;
    comment += (s.replace(/<[^>]*class="(?:todo|ftr-todo)"[^>]*>[^<]*<\/span>/g, '').match(/TODO/g) || []).length;
  }
  console.log(`  info 画面に出るプレースホルダ ${visible} 箇所（赤い破線。公開前に必ず置き換える）`);
  console.log(`  info ソース内の TODO コメント ${comment} 箇所（次フェーズ向けの申し送り）`);
}

console.log(ng === 0 ? '\n[lint] PASS' : `\n[lint] FAIL: ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
