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
  // ★キャッシュ破りを入れたので、画像URLは cv('images/chars/…') の形でも書かれる。
  //   src="images/…" だけを拾っていると、キャラ画像16体×2種が検査から丸ごと
  //   抜け落ちる（実際に 33件 → 17件 に減った）。両方の書き方を拾う。
  const raw = new Set(
    [...html.matchAll(/(?:src=|url\()['"]?(images\/[^"')\s]+)/g)].map(m => m[1])
      .concat([...html.matchAll(/cv\(\s*'(images\/[^']*)'\s*\+\s*([A-Za-z(). ]+)\s*\+\s*'([^']*)'/g)]
        .map(m => m[1] + '${x}' + m[3]))
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
  // ★?v=（キャッシュ破り）はファイル名の一部ではないので、存在確認の前に落とす。
  const missing = [...resolved]
    .map(r => r.split('?')[0])
    .filter(r => !fs.existsSync(path.join(ROOT, r)));
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
    // 以下は docs/specs/workplace-fit.md §2-2。
    // このプロダクトの思想は「就活生が比較できない職場環境の好みに言葉を
    // 与えること」だが、その思想を語るための語彙（風土・体育会系・ノルマ）は
    // 設計者の言葉であって、画面に出す言葉ではない。オーナー判断。
    //   ・「風土」「社風」「カルチャー」は採用側の言葉で、主語が会社になる
    //   ・「体育会系」「ノルマ」は会社についての評価語
    //   ・この診断は会社を1社も知らない。知っているのは答えた本人だけ
    // 画面に出せるのは「あなたは〜な環境で力が出やすい」までで、
    // 「〜な会社が合う」は出せない（同 §2-3）。
    // ★「文化」単体は禁じない。DAWG.sts「技術を軽視する文化」のように
    //   本人が消耗する場面を指す用法は正しい。禁じるのは会社を分類する用法。
    ['風土', '内部語彙。採用側の言葉であり主語が会社になる'],
    ['社風', '同上'],
    ['企業文化', '同上'],
    ['カルチャー', '同上'],
    ['体育会系', '会社についての評価語'],
    ['ノルマ', '会社についての評価語（否定的な含意が強い）'],
    ['合う会社', '会社について断定している（1社も知らない）'],
    ['合う企業', '同上'],
    ['向いている会社', '同上'],
  ];
  for (const [w, why] of banned) {
    const n = stripped.split(w).length - 1;
    check(n === 0, `「${w}」が0件（${why}）${n ? ` → ${n}件` : ''}`);
  }

  // t/*.html 16枚にも同じ線を引く（workplace-fit.md §9 A-2）。
  // 生成物なので、テンプレートに1行足すと16枚に同時に載る。
  {
    const thesis = ['風土', '社風', '企業文化', 'カルチャー', '体育会系', 'ノルマ', '合う会社', '合う企業', '向いている会社'];
    const hits = [];
    for (const f of fs.readdirSync(path.join(ROOT, 't')).filter(f => f.endsWith('.html'))) {
      const s = read(`t/${f}`);
      const w = thesis.filter(t => s.includes(t));
      if (w.length) hits.push(`t/${f}(${w.join('/')})`);
    }
    check(hits.length === 0, `t/*.html にも思想語彙が0件${hits.length ? ` → ${hits.join(', ')}` : ''}`);
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
  // 2026-09-08: 「判定理由」の箱をやめ、その文を「性格タイプ詳細」の中の
  // .d-lbl la「4つの軸で見ると」へ移した。開示をやめたわけではないので、
  // 移動先と「診断スコア」の両方が残っていることを見る。
  check(/4つの軸で見ると/.test(html) && /診断スコア/.test(html),
    '軸の開示は結果画面（4つの軸で見ると / 診断スコア）に残っている');

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
  // 「3ステップで完了」を削ったとき、その3項目（20問・約3分／タイプ判定／
  // 3つめ）の受け皿を .hero-sub にした。受け皿である要件は変わらないが、
  // 3つめは「職種の例」から「働きやすい職場」に変わった
  // （workplace-fit.md U-2。入口の約束を結果画面の主役と揃えるため）。
  check(/働きやすい職場/.test(sub), '.hero-sub が職場を約束している（3ステップの3項目めの受け皿）');
  check(/見分け方/.test(sub), '.hero-sub に「その先で何が手に入るか」がある');
  // 旧文言に戻っていないこと。「向いている」で断定しつつ名詞に「例」を足すのは
  // ヘッジの二重（workplace-fit.md §5-3）。
  check(!/職種の例/.test(sub), '.hero-sub に「職種の例」が戻っていない（ヘッジの二重）');
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

// --- 落としたUIが戻ってこないこと（2026-09-08・オーナー判断）--------------
// 「判定理由」「サブタイプ」「業界別の職種例」の3つを結果画面から外した。
// どれも一度は説明文や注記を足して直そうとした経緯があり、放っておくと
// 「説明を足せば戻せる」と読める。戻すのは判断のやり直しであって修理ではない。
console.log('[lint] 落とした結果パネル');
{
  // 自分のコメントで落ちないよう、コメントを除いた本文で見る
  const live = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [pat, what, why] of [
    [/判定理由/,      '判定理由',       '判定・審査の語で結果を突きつける形をやめた。文は「4つの軸で見ると」へ移した'],
    [/reason-box/,   '.reason-box',    '同上'],
    [/class="rbt/,   '.rbt（軸名＋%の札）', 'すぐ上の「診断スコア」と同じ4軸・同じ%の二重掲載だった'],
    [/サブタイプ/,     'サブタイプ',      '結果を1つに絞る設計と「2番目に近いタイプ」の併記が噛み合っていなかった'],
    [/subtype-card/, '.subtype-card',  '同上'],
    [/業界別の職種例/,  '業界別の職種例',   '全16タイプで中身が同じで、タイプ固有の情報が無かった'],
    [/buildCoHTML/,  'buildCoHTML()',  '同上'],
    [/class="co-item/, '.co-item',     '同上'],
    [/class="ind-sm/, '.ind-sm（業界チップ）', '同上。属性入力の業界チップは .pf-chip で別物'],
  ]) {
    check(!pat.test(live), `${what} が0件（${why}）`);
  }
  // 画面から企業名・業態の一般名称が消えたことの担保。
  // legal-self-assessment.md §1-1 の前提（実在の企業名を使用していない）を
  // さらに一段強くしている＝「業態の一般名称すら出さない」。
  for (const w of ['メガバンク', '総合商社', '総合広告代理店', '戦略系コンサルティングファーム']) {
    check(!live.includes(w), `「${w}」が0件（会社・業態の名称を画面に出さない）`);
  }
  // 一方で、属性入力が使う業界名は残っていること（消しすぎの検出）
  check(/const IND_NAMES=\[/.test(html), 'IND_NAMES（属性入力の業界名）が残っている');
  check(/PF_IND=IND_NAMES\.map/.test(html), '業界チップは IND_NAMES から作られている');
  // getSubCode() は消さない。golden の指紋が { code, sub, scores } を記録している。
  check(/function getSubCode\(\)/.test(html),
    'getSubCode() は残っている（表示はしないが golden の指紋が参照している）');
  check(!/getSubCode\(\)[;,]?\s*$/m.test(html.split('function getSubCode()')[0]),
    '結果画面は getSubCode() を呼んでいない');
}

// --- 連絡先を取得しない設計 -----------------------------------------------
// 旧「<form>/<input> が0件」から書き換えた。属性入力（#screen-profile）が
// 入ったため0件では守れない。仕様 diagnosis-experience-revamp.md §D-4 が
// 「funnel の受け入れ基準『フォーム要素0件』は D-4 により更新される」と
// 予告している変更である。
//
// ★守る線は「連絡先を取らない」に移った。ここが崩れると
//   privacy.html 2.「氏名・メールアドレス・電話番号・住所・学校名・学部名を
//   一切取得しません」が虚偽記載になる。
console.log('[lint] 連絡先を取得しない設計');
for (const p of PAGES) {
  const raw = read(p);
  const s = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // <form> は使わない。送信先が無く、Enter の誤送信とブラウザの自動入力
  // （住所・氏名・メール）を誘発する理由がない（§D-4）。
  const forms = (s.match(/<form\b/g) || []).length;
  check(forms === 0, `${p} に <form> が0件（実際: ${forms}）`);

  // <input> は種類で見る。連絡先を受け取る型が1つでもあれば落とす。
  const inputs = [...s.matchAll(/<input\b[^>]*>/g)].map(m => m[0]);
  const bad = inputs.filter(t => /type=["'](email|tel|password|url)["']/.test(t)
                             || /\bname=["'][^"']*(mail|tel|phone|addr|name)/i.test(t)
                             || /autocomplete=["'][^"']*(email|tel|name|address)/i.test(t));
  check(bad.length === 0, `${p} に連絡先を受け取る <input> が無い（<input> 全体: ${inputs.length}件）${bad.length ? ` → ${bad.join(' / ')}` : ''}`);

  // 画面に連絡先の入力を求める語が出ていないこと。
  // ★「会員登録」単体は入れない。privacy.html の「会員登録の仕組みはなく」という
  //   否定文まで拾ってしまう。求めている形の語だけを見る。
  const askWords = ['メールアドレスを入力', '電話番号を入力', 'お名前を入力',
                    '会員登録する', '登録してください', 'ご登録ください'];
  const hit = askWords.filter(w => s.includes(w));
  check(hit.length === 0, `${p} が連絡先の入力を求めていない${hit.length ? ` → ${hit.join(', ')}` : ''}`);
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
  // 空に戻せば外部送信が完全に止まる、という逃げ道は残し続ける。
  check(/if\(!GA_ID\)return;/.test(html), 'GA_ID が空なら外部送信しない分岐がある');

  // ★測定IDと privacy.html の記載は同時に動かす（§D-7 D-L5「片方だけ先に出さない」）。
  //   投入済みなのにポリシーが「導入していません」のままだと虚偽記載になる。
  const pv = read('privacy.html');
  const on = !!(ga && ga[1]);
  check(on === /Google アナリティクス 4<\/strong> を利用しています/.test(pv),
    on ? 'GA_ID を入れたので privacy.html も「利用しています」になっている'
       : 'GA_ID が空なので privacy.html も「導入していません」のまま');
  if (on) {
    check(pv.includes(ga[1]) || /Google アナリティクス 4/.test(pv), `privacy.html が GA4 の利用を公表している`);
    check(/オプトアウト/.test(pv), `privacy.html に停止方法（オプトアウト）が書いてある`);
    check(/policies\.google\.com/.test(pv), `privacy.html に Google のプライバシーポリシーへのリンクがある`);
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
  // 残っているプレースホルダは連絡先メールアドレスの2箇所（privacy.html の
  // <dt>連絡先</dt> と 8.お問い合わせ）だけであること。実在しない値を書くと
  // 開示請求の受け皿が消えるので、埋まるまでここが減らないのは正しい。
  // これ以上増えたら、公開済みの面に新しい未記入が出たということ。
  check(visible <= 2, `画面に出るプレースホルダが2箇所以内（実際: ${visible}）`);
}

// --- タイプページと og:image（16枚）---------------------------------------
// シェアされたURLの着地先であり、「誰の結果か」を伝える唯一の面。
// 生成物なので、テンプレートを直して生成し忘れた状態を機械で見つける
// （weighted-scoring-and-type-pages.md §生成の方針）。
console.log('[lint] タイプページと og:image');
{
  const { renderAll } = await import('./gen-type-pages.mjs');
  const pages = await renderAll();
  check(pages.length === 16, `t/*.html が16枚（実際: ${pages.length}）`);

  let stale = [], missing = [];
  for (const p of pages) {
    const abs = path.join(ROOT, p.file);
    if (!fs.existsSync(abs)) { missing.push(p.file); continue; }
    if (fs.readFileSync(abs, 'utf8') !== p.html) stale.push(p.file);
  }
  check(missing.length === 0, `t/*.html が全部ある${missing.length ? ` → 無い: ${missing.join(', ')}` : ''}`);
  check(stale.length === 0,
        `t/*.html が最新（make types を忘れていない）${stale.length ? ` → 古い: ${stale.join(', ')}` : ''}`);

  // og:image 16枚。PNG は Chrome のバージョンでバイト単位では再現しないので、
  // 中身の一致ではなく「在る・1200x630・16枚とも違う絵」を守る。
  const png = f => {
    const b = fs.readFileSync(f);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), key: b.length + ':' + b.subarray(0, 4096).toString('base64') };
  };
  const seen = new Map();
  let badSize = [], dup = [], noimg = [];
  for (const p of pages) {
    const f = path.join(ROOT, 'images/ogp', `${p.code}.png`);
    if (!fs.existsSync(f)) { noimg.push(p.code); continue; }
    const s = png(f);
    if (s.w !== 1200 || s.h !== 630) badSize.push(`${p.code}(${s.w}x${s.h})`);
    if (seen.has(s.key)) dup.push(`${p.code}=${seen.get(s.key)}`);
    seen.set(s.key, p.code);
  }
  check(noimg.length === 0, `og:image が16枚ある${noimg.length ? ` → 無い: ${noimg.join(', ')}` : ''}`);
  check(badSize.length === 0, `og:image が全部 1200x630${badSize.length ? ` → 違う: ${badSize.join(', ')}` : ''}`);
  // ここが本題。16人が同じ1枚を配っていたのが D-1 の出発点だった。
  check(dup.length === 0, `og:image 16枚がすべて別の絵${dup.length ? ` → 同一: ${dup.join(', ')}` : ''}`);

  // 診断前のページなので、送客リンクを置いてはならない（funnel §3）。
  const withAgent = pages.filter(p => /ab-link|agent-primary|agent-secondary|agent-block/.test(p.html));
  check(withAgent.length === 0,
        `t/*.html に送客リンクが無い（診断前の送客は排除）${withAgent.length ? ` → ${withAgent.map(p => p.code).join(', ')}` : ''}`);

  // CTA に ?type= を付けてはならない。?type=X（ref なし）で来ると結果画面が
  // 即表示されるため、未診断者に他人の結果を出す経路を新設してしまう。
  const withType = pages.filter(p => /index\.html\?[^"']*\btype=/.test(p.html));
  check(withType.length === 0,
        `t/*.html の導線に ?type= が無い（未診断者に他人の結果を出さない）${withType.length ? ` → ${withType.map(p => p.code).join(', ')}` : ''}`);

  // 16枚それぞれが自分の og:image を指していること（テンプレの取り違え検出）
  const wrongOg = pages.filter(p => !p.html.includes(`images/ogp/${p.code}.png`));
  check(wrongOg.length === 0, `各ページが自分の og:image を指す${wrongOg.length ? ` → ${wrongOg.map(p => p.code).join(', ')}` : ''}`);

  // ★結果画面が出す「タイプ固有の静的な説明」が、詳細ページにも全部あること。
  //   片方だけ足すと、同じタイプの説明が2箇所で食い違う。
  //   スコアに依存するもの（4軸・判定理由・サブタイプ・ENV）は対象外
  //   ——診断していない人のスコアは存在しないため。
  {
    const need = [['per', 'どんなタイプ？'], ['str', '強み'], ['com', '人との関わり方'],
                  ['sts', '消耗しやすいところ'], ['grw', '伸ばすとしたら'],
                  ['jobs', '力を発揮しやすい仕事'], ['good', '相性がよい組み合わせ']];
    const miss = [];
    for (const p2 of pages) for (const [, h] of need) if (!p2.html.includes(`<h2>${h}</h2>`)) miss.push(`${p2.code}:${h}`);
    check(miss.length === 0, `t/*.html に結果画面と同じ説明が全部ある（${need.length}項目×16枚）${miss.length ? ` → 欠け: ${miss.slice(0, 4).join(', ')}` : ''}`);

    // 未決のまま16ページへ増やさないもの（wording-audit 未決3 / weighted 未決2）。
    const bad = pages.filter(p2 => p2.html.includes('注意が必要なタイプ'));
    check(bad.length === 0, `t/*.html に「注意が必要なタイプ」を載せていない（パネル自体が未決）`);
  }

  // 一覧から詳細ページへ辿れること。以前は内部リンクが0本で、
  // 16枚は sitemap からしか発見できなかった。
  check(/class="tp-more" href="t\/\$\{esc\(code\)\}\.html"/.test(html),
        `16タイプ一覧の紹介パネルから t/<CODE>.html へのリンクがある`);

  // 結果画面の相性パネルから、相手のタイプページへ辿れること。
  // コードと名前とキャラだけが出ていて、読みに行く先が無かった。
  check(/class="tp-more" href="t\/\$\{esc\(c\)\}\.html"/.test(html),
        `相性パネルの各タイプから t/<CODE>.html へのリンクがある`);
  // ★自分のタイプページへは張らない（結果画面のほうが情報が多く、押すと減る）
  check(!/href="t\/\$\{esc\(code\)\}\.html"[^`]*もっと|自分のタイプのページ/.test(html),
        `結果画面から自分のタイプページへは張っていない`);

  // t/*.html から一覧へ戻れること。検索で入った人が3枚の .mini 以外へ回遊できなかった。
  {
    const noAll = pages.filter(p2 => !/class="all-link" href="\.\.\/index\.html#type-section"/.test(p2.html));
    check(noAll.length === 0,
      `t/*.html 16枚すべてに一覧（#type-section）への導線がある（欠け: ${noAll.map(x=>x.code).join(',')||'なし'}）`);
  }
  check(/id="type-section"/.test(html), 't/*.html が指す #type-section が index.html に存在する');

  // shareUrl() が t/ を指していること（?type=&ref=share のままだと16枚が使われない）
  check(/function shareUrl\(code\)\{return SITE_BASE\+'t\/'/.test(html),
        `shareUrl() が t/<CODE>.html を返す（16枚の og:image が使われる経路）`);
}

// --- 4つの軸の説明（LP）-----------------------------------------------------
// ★C-4「質問中に何の軸を測っているかを開示しない」との関係をここで固定する。
//   C-4 の理由は社会的望ましさバイアス。就活生は「主体性がある方が良い」という
//   規範を内面化しているので、「攻め ⇄ 支え」を回答前に見せると答えが引っ張られる。
//   よってこの節は (1) Q1-5 より後ろに置き、(2) 軸名そのものを出さない。
//   見出しは ENV と同じ職場の言葉（人と関わる量 / 評価のされ方 …）にする。
console.log('[lint] 4つの軸の説明');
{
  check(/id="axis-section"/.test(html), 'LP に軸の説明の節がある');
  const iQuiz = html.indexOf('id="lp-quiz-sec"');
  const iAxis = html.indexOf('id="axis-section"');
  const iTypes = html.indexOf('id="type-section"');
  check(iQuiz > 0 && iAxis > iQuiz,
    '軸の説明は Q1-5 より後ろにある（前に置くと答えが引っ張られる。C-4）');
  check(iAxis > 0 && iTypes > iAxis, '軸の説明は16タイプ一覧より前にある');

  const seg = html.slice(iAxis, iTypes);
  // ★2026-09-08: 軸名を出す形に変えた（オーナー指示。夜キャラ診断の節を参照）。
  //   「軸名を出さない」検査はここで役目を終える。ただし C-4 の理由
  //   （社会的望ましさバイアス）は消えていない。名指しされていたのが
  //   まさに「攻め / 支え」「自走型 / 育成型」である。
  //   ★代わりに守るのは「4つとも、優劣ではないと言葉で打ち消していること」。
  //     参照元（沼/塩・S/M）は就活の規範と無関係なので裸で出せるが、
  //     こちらは「攻めの方が評価される」と読まれうる。
  for (const w of ['対人', '対課題', '攻め', '支え', '自走', '育成']) {
    check(seg.includes(w), `軸「${w}」を出している`);
  }
  // ENV と同じ職場の言葉も併記されていること（軸名だけだと何の話か分からない）
  for (const w of ['人と関わる量', '評価のされ方', '仕事にかける時間', '任され方']) {
    check(seg.includes(w), `「${w}」を併記している（ENV と同じ語）`);
  }
  const cards = seg.split('class="ax-card"').slice(1);
  check(cards.length === 4, `軸のカードが4枚ある（${cards.length}枚）`);
  const NEGATE = /優れているという話ではなく|どちらが欠けても|熱意の量の話ではない|能力の高低ではない/;
  const missing = cards.filter(c => !NEGATE.test(c));
  check(missing.length === 0,
    `4枚とも優劣を打ち消す1文がある（欠け: ${missing.length}枚）`);
}

// --- 外部へ通信する先が、privacy.html に全部書いてあること -------------------
// ★実際に漏れた。Google Fonts を読んでいるのに §7 は GA4 しか挙げておらず、
//   「下記の情報が Google LLC へ送信されます」が GA4 だけを指す書き方になっていた。
//   電気通信事業法の外部送信規律が求めるのは通知または公表なので、
//   通信先が増えたらポリシーも増やす必要がある。
//   ★index.html に外部ドメインを足したら、ここが落ちる。落ちたら
//     privacy.html §7 に「送信先 / 送信される情報 / 利用目的 / 停止方法 /
//     提供事業者のポリシー」の5行を足すこと。
console.log('[lint] 外部への通信先とポリシーの一致');
{
  const priv = read('privacy.html');
  const hosts = new Set();
  for (const f of ['index.html', 'privacy.html']) {
    const src = read(f);
    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  }
  // 自サイト・リンク先として案内しているだけの参照先は通信を起こさないので除く
  const SELF = /(^|\.)w-t-n-b\.github\.io$/;
  const LINK_ONLY = new Set([
    'policies.google.com', 'business.safety.google', 'tools.google.com',
    'developers.google.com', 'www.ppc.go.jp', 'twitter.com', 'x.com',
    'social-plugins.line.me', 'line.me', 'schema.org', 'www.w3.org',
    // ★AGENTS[].url は「押したら移動する先」であって、ページを開いただけでは
    //   通信しない。外部送信の記載が要るのは読み込みを起こす先だけ。
    //   遷移先の扱いは privacy.html §8（外部サイトへのリンク）が受け持つ。
    'example.com',
  ]);
  const loading = [...hosts].filter(h => !SELF.test(h) && !LINK_ONLY.has(h));
  // 読み込みを起こすホストは、privacy.html 本文で名指しされているか
  const NAMED = { 'fonts.googleapis.com': 'Google Fonts', 'fonts.gstatic.com': 'Google Fonts',
                  'www.googletagmanager.com': 'Google アナリティクス' };
  const undocumented = loading.filter(h => {
    const label = NAMED[h];
    return !label || !priv.includes(label);
  });
  check(undocumented.length === 0,
    `外部へ読み込む先がすべて privacy.html に書いてある（未記載: ${undocumented.join(', ') || 'なし'}）`);
  console.log(`  --   読み込む先: ${loading.sort().join(', ') || 'なし'}`);

  // GA4 と Google Fonts は、表として5項目そろっているか
  for (const label of ['Google アナリティクス', 'Google Fonts']) {
    if (!priv.includes(label)) continue;
    const i = priv.indexOf(label);
    const seg = priv.slice(i, i + 2600);
    const ok = ['送信先', '送信される情報', '利用目的', '停止方法', '提供事業者のポリシー']
      .every(k => seg.includes(k));
    check(ok, `${label} の外部送信が5項目そろって書かれている`);
  }
}

// --- キャラクターの大きさが揃っていること -----------------------------------
// 素材は1体ずつ別々に生成されており、頭身が揃っていない。
// 実測（bbox を枠に収める従来の方法）で、実体の高さは 90〜100% とほぼ揃うのに
// 頭の幅が 2.07倍ばらついていた。高さで揃えると、頭が小さく描かれた体だけ
// 「小さい人」に見える（オーナー指摘「サイズがばらついてる」）。
// tools/gen-chars.py が sqrt(頭幅 × 実体高) を揃えて焼き、その結果を
// images/chars/scale.json に残す。ここではその記録を検査する。
// ★素材を差し替えたら gen-chars.py を回し直すこと。回さないとここで落ちる。
console.log('[lint] キャラクターの大きさ');
{
  const f = path.join(ROOT, 'images/chars/scale.json');
  if (!fs.existsSync(f)) {
    console.log('  --   images/chars/scale.json が無い（旧素材のまま。差し替えたら make chars）');
  } else {
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    const codes = Object.keys(rec).filter(k => k !== '_v');
    check(codes.length === 16, `16体ぶんの記録がある（${codes.length}体）`);
    const spread = k => {
      const v = codes.map(c => rec[c][k]);
      return Math.max(...v) / Math.min(...v);
    };
    const hs = spread('head'), ht = spread('h');
    // ★揃えるのは背丈（オーナー判断 A）。一覧では16枚が同じ高さに並ぶほうが
    //   整列して見え、ヒーローの並びも自然になる。
    // ★外形（bbox）を揃えても見た目は揃わない。同じ外形でも、しゃがんだ体や
    //   跳んだ体は、立った体より身体そのものが小さく写る。素材の描かれ方の差で
    //   あって計算で求まる量ではないため、gen-chars.py の MANUAL で1体ずつ
    //   目で当てている。よって背丈は「揃う」のではなく意図的にばらつく。
    //   ここで見るのは、その手当てが常識的な範囲に収まっていること。
    /* ★2026-09-10。揃える対象を「画面に描かれた見た目の高さ」へ移した。
       素材の中の量（外形の高さ・顎から足・面積）は、どれも姿勢と髪に
       引きずられて c4 / a2 / a4 を正しく扱えなかった。
       いまはそれらが**意図的に不揃い**になる。ここでは記録だけ残し、
       揃っているかどうかは e2e が画面を測って見る
       （「16体の見た目の高さが揃っている」）。 */
    console.log(`  --   外形の高さは ${ht.toFixed(2)}倍ばらつく`
      + `（揃える対象ではない。見た目の高さは e2e が見る）`);
    // ★見た目の大きさを決めるのは全高ではなく胴体（顎から足）である。
    //   全高を451で完全に揃えた状態で並べたら「緑の群だけ小さい」と指摘が出た。
    //   実測すると胴体は 122〜208px＝1.70倍ばらついていた。髪が大きい体
    //   （b3 黒子のプロデューサー）は、同じ全高でも胴体が小さくなるためである。
    //   gen-chars.py が胴体を測って倍率を決めるようにしたので、ここで見張る。
    const bd = Object.values(rec).filter(v => v && v.body).map(v => v.body);
    if (bd.length) {
      console.log(`  --   胴体（顎から足）は ${(Math.max(...bd)/Math.min(...bd)).toFixed(2)}倍ばらつく`
        + `（揃える対象ではない。しゃがんだ体は同じ体でも短くなる）`);
    } else {
      check(false, 'scale.json に胴体（body）が記録されている（make chars を回し直すこと）');
    }
    // ★焼き直したのに ASSET_V を上げ忘れると、戻ってきた人には古い絵が出続ける。
    //   ファイル名が変わらないのでブラウザは差し替えに気づけない。
    //   実際にそれで「サイズがばらついて見える」という報告が上がった
    //   （画面の実測は揃っていたのに、見えていたのはキャッシュの旧版だった）。
    const av = (html.match(/const ASSET_V='([0-9a-f]+)'/) || [])[1];
    check(!!av, 'index.html に ASSET_V がある');
    check(av === rec._v,
      `ASSET_V が焼いた中身と一致する（index.html ${av} / scale.json ${rec._v}）`);
    check(/const cv=u=>u\+'\?v='\+ASSET_V/.test(html), '画像URLに ?v= を付ける関数がある');
    const bare = (html.match(/src="images\/chars\/[^"?]*\.webp"/g) || []);
    check(bare.length === 0,
      `?v= の付いていないキャラ画像が無い（${bare.join(', ') || 'なし'}）`);
    // ★?v= が「付いている」だけでは足りない。値が ASSET_V と一致していないと、
    //   その1枚だけキャッシュが破れず古い絵が出続ける。
    //   実際 .hero-sil が ?v=b01c3987 のまま取り残されていた（ASSET_V は c231e7c6）。
    //   cv() を通せない静的な src（HTMLに直書きの img）が該当する。
    const stale = [...html.matchAll(/images\/chars\/[^"']*\.webp\?v=([0-9a-f]+)/g)]
      .map(m => m[1]).filter(v => v !== av);
    check(stale.length === 0,
      `直書きの ?v= が ASSET_V と一致する（ずれ: ${[...new Set(stale)].join(', ') || 'なし'}）`);
    // ★頭の大きさは揃わない。素材そのものの頭身差であり、変換では消せない。
    //   ここで落としても直しようがないので、記録として出すだけにする。
    //   絵柄の個性として許容すると決めた（3案 A/B/C を比較したうえでの判断）。
    console.log(`  --   頭の大きさは ${hs.toFixed(2)}倍ばらつく`
      + '（素材の頭身差。背丈を揃える方を選んだ結果であり、不具合ではない）');
  }
}

// --- 2色の意味（青＝分かったこと / 赤＝押す場所）---------------------------
// オーナー判断「色は青系と赤系で、それぞれに意味を持たせて配色したい」。
// 意味を持たせた以上、置き場所が広がると意味が消える。ソース側で守る。
console.log('[lint] 2色の意味');
{
  const m = html.match(/--info:(#[0-9a-f]{6});[\s\S]{0,80}?--act:(#[0-9a-f]{6});/i);
  check(!!m, '--info（青）と --act（赤）が 1 箇所で定義されている');
  if (m) {
    const [, info, act] = m;
    const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const [ir, ig, ib] = hex(info), [ar, ag, ab] = hex(act);
    check(ib > ir + 30, `--info は青系（B が R より大きい）: ${info}`);
    check(ar > ag + 30 && ar > ab + 30, `--act は赤系（R が G/B より大きい）: ${act}`);

    const lum = h => { const c = hex(h).map(v => v / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    check(ratio(info, '#ffffff') >= 4.5, `青は白地で文字にできる: ${ratio(info, '#ffffff').toFixed(2)}:1`);
    check(ratio('#ffffff', act) >= 4.5, `赤は白抜き文字を載せられる: ${ratio('#ffffff', act).toFixed(2)}:1`);
    // ★2色の明度が近いと、色覚特性のある人には見分けがつかない。
    //   ただし赤は必ず「塗られたボタン」、青は「文字と細い塗り」で、
    //   形が違うので色だけに依存していない（WCAG 1.4.1）。数値は記録に残す。
    console.log(`  --   青と赤の明度比 ${ratio(info, act).toFixed(2)}:1`
      + `（形でも区別している。色だけに頼っていない）`);
  }

  // 新しい層（QUIET RESTYLE 以降）が色を1つも足していないこと。
  // ★基層と RETRO 側には旧アクセントの値が残っている。これは消さない——
  //   「QUIET RESTYLE を削除すればレトロの見た目に戻る」ためには、
  //   下の層が無傷で残っている必要があるからである。
  //   旧アクセントは QUIET の :root が var(--info) / var(--act) で潰しており、
  //   実際に描画されていないことは e2e「2色の意味」が実画面で数えて確かめる。
  //   ここで見るのは「新しい層が色を持ち込んでいないか」だけ。
  const quiet = html.slice(html.indexOf('QUIET RESTYLE'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const dead of ['#c8412e', '#cf9a24', '#7c3aed', '#16a34a', '#dc2626',
                      '#ea580c', '#0891b2', '#d97706', '#123c9b', '#1d6b4c']) {
    check(!quiet.includes(dead), `QUIET RESTYLE が旧アクセント ${dead} を持ち込んでいない`);
  }
  // 新しい層に現れてよい色は、2色とその hover、無彩色だけ
  const hexes = [...new Set((quiet.match(/#[0-9a-f]{6}/gi) || []).map(x => x.toLowerCase()))];
  const isGray = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) <= 14; };
  // 許可するのは 2色（--info / --act）と、その hover、A側の薄い地、
  // 白、そして他社ブランド色だけ。
  // ★LINE は #06C755 ではなく #0B8043（濃い側）。面を塗るのをやめた結果、
  //   ブランド色が文字になり、#06C755 では白地で 2.26:1 しか無かったため。
  //   ブランドの識別は保ちつつ AA（5.02:1）を満たす値に落としてある。
  const allow = new Set([m ? m[1].toLowerCase() : '', m ? m[2].toLowerCase() : '',
                         '#8c3527', '#eceee9', '#0b8043', '#ffffff',
                         // ★系統の色。これは「差し色」ではない。
                         //   差し色の規則は「指す言葉」と「押す場所」の色の話であり、
                         //   面の地色と帯はその外にある。文字にもボタンにも使わない
                         //   （e2e が実画面で確かめる）。
                         //   値はキャラクターの絵から採ったもの。
                         // ★帯は消したので、系統4色そのものは QUIET RESTYLE に出てこない。
                         //   残るのは16タイプ一覧の地色（4色を白へ寄せた値）だけ。
                         '#f8ecec', '#ecf0ec', '#eaeef7', '#fbf6e8',   // 系統の地色
                         '#9a1717']);                                  // 押す場所の hover
  const extra = hexes.filter(h => !isGray(h) && !allow.has(h));
  check(extra.length === 0,
    `QUIET RESTYLE に3色目が無い（2色＋hover＋無彩色＋LINE緑＋系統の地色のみ）: ${extra.join(', ') || 'なし'}`);

  // 系統の地色は「面」であって「差し色」ではない。その一線を数値で引く。
  // 白との差が小さいうちは面のままだが、濃くすると意味を持ち始めてしまう。
  for (const band of ['#f8ecec', '#ecf0ec', '#eaeef7', '#fbf6e8']) {
    if (!quiet.includes(band)) continue;
    const c = [1, 3, 5].map(i => parseInt(band.substr(i, 2), 16));
    check(Math.max(...c) - Math.min(...c) <= 22,
      `系統の地色 ${band} は十分に淡い（RGBの開き ${Math.max(...c) - Math.min(...c)} ≦ 22）`);
    check(Math.min(...c) >= 225,
      `系統の地色 ${band} は白に十分近い（最小成分 ${Math.min(...c)} ≧ 225）`);
  }
  // 赤をエラー・警告に使わない。この配色では赤＝前進である
  check(!/注意が必要[^<]*<\/div>[\s\S]{0,120}var\(--act\)/.test(quiet),
    '「注意が必要なタイプ」に赤を当てていない（赤＝危険ではなく前進）');

  // タイプページ側にも同じ2色があり、値が一致すること
  const tp = read('tools/gen-type-pages.mjs');
  const m2 = tp.match(/--info:(#[0-9a-f]{6});--act:(#[0-9a-f]{6});/i);
  check(!!m2, 'tools/gen-type-pages.mjs にも --info / --act がある');
  if (m && m2) {
    check(m[1].toLowerCase() === m2[1].toLowerCase() && m[2].toLowerCase() === m2[2].toLowerCase(),
      `index.html とタイプページで2色が一致（${m[1]}/${m[2]} vs ${m2[1]}/${m2[2]}）`);
  }
}

// --- 明朝サブセット（焼き忘れを止める）-------------------------------------
// 書体の規則で明朝を当てるのは「指す言葉」＝16タイプのコードと名前だけ。
// だから必要な文字は数え上げられ、82文字を焼けば約11KB で済む。
// ★タイプ名を1文字でも変えたら焼き直しが要る。これは必ず忘れるので検査する。
console.log('[lint] 明朝サブセット');
{
  const { neededChars } = await import('./gen-font.mjs');
  const { chars } = neededChars(html);
  check(chars.length > 0 && chars.length < 200,
    `明朝が要る文字は数え上げられる範囲（${chars.length}文字）`);
  check(/@font-face\{[^}]*'CQMincho'/.test(html.replace(/\s+/g, m => m.includes('\n') ? '' : m)) ||
        /font-family:'CQMincho'/.test(html),
    '@font-face で CQMincho を宣言している');
  check(/--mincho:'CQMincho'/.test(html),
    '--mincho の先頭が CQMincho（焼いたものを最優先で使う）');
  check(/'Hiragino Mincho ProN'/.test(html),
    '端末標準の明朝へのフォールバックがある（焼く前でも表示は成立する）');

  const baked = path.join(ROOT, 'fonts/cq-mincho.chars.txt');
  if (fs.existsSync(baked)) {
    const have = new Set([...fs.readFileSync(baked, 'utf8').trim()]);
    const missing = chars.filter(c => !have.has(c));
    check(missing.length === 0,
      `焼いたサブセットが現在のタイプ名を全部含む（不足: ${missing.join('') || 'なし'}）`);
    check(fs.existsSync(path.join(ROOT,'fonts/cq-mincho.woff2')), 'fonts/cq-mincho.woff2 が存在する');
    if (fs.existsSync(path.join(ROOT,'fonts/cq-mincho.woff2'))) {
      const kb = fs.statSync(path.join(ROOT,'fonts/cq-mincho.woff2')).size / 1024;
      check(kb < 60, `サブセットが十分小さい（${kb.toFixed(1)}KB < 60KB）`);
    }
  } else {
    // まだ焼いていない状態は「未完了」であって「壊れている」ではない。
    // 端末標準の明朝に落ちるので表示は成立する。落とさずに知らせるだけにする。
    console.log('  --   fonts/cq-mincho.woff2 は未生成。端末標準の明朝で表示される');
    console.log('       （Mac と Windows で見え方が変わる。make font で焼くこと）');
  }
}

// --- 絵文字を1つも置かない -------------------------------------------------
// 絵文字はOSが描くので、iOS・Android・Windows で形も色も光沢も変わる。
// このサイトは紺・クリーム・赤・からしの平面で組んであり、光沢のある
// 立体アイコンが載ると別のデザインシステムを貼ったように見える。
// オーナー判断（index.html 末尾の EMOJI ブロックに全文）。
//
// 判定は Emoji_Presentation（既定で絵文字として描かれる字）と、
// 異体字セレクタ U+FE0F（テキスト既定の字を絵文字にする指定）の2つ。
// この2つなら → ← ▼ ▶ ★ ✓ ✕ ⇔ ↗ © 𝕏 は掛からない。単色の文字として
// 描かれ、フラットな見た目に馴染むので、これらは意図的に残している。
console.log('[lint] 絵文字');
{
  const EMOJI = /\p{Emoji_Presentation}|️/gu;
  const targets = [...PAGES, ...fs.readdirSync(path.join(ROOT, 't')).filter(f => f.endsWith('.html')).map(f => `t/${f}`)];
  const hits = [];
  for (const f of targets) {
    const m = read(f).match(EMOJI);
    if (m) hits.push(`${f}(${[...new Set(m)].join('')})`);
  }
  check(hits.length === 0, `公開ページに絵文字が0件（${targets.length}ファイル）${hits.length ? ` → ${hits.join(', ')}` : ''}`);

  // 中身が空の .d-icon（絵文字を消したときに箱だけ残った状態）を拒む。
  // .d-icon は「HA系」のように中身が意味を持つときだけ置く箱である。
  const emptyBox = [...read('index.html').matchAll(/<div class="d-icon"[^>]*>\s*<\/div>/g)];
  check(emptyBox.length === 0, `中身の無い .d-icon が無い（箱だけ残っていない）`);
}

// --- あなたが働きやすい職場（docs/specs/workplace-fit.md）------------------
console.log('[lint] あなたが働きやすい職場');
{
  // ヘッジの二重（§5-3）。「向いている」「〜しやすい」で既に断定を避けている
  // 文に、さらに名詞側の「例」を足さない。弱めるのは動詞側だけで行う。
  // ★「職種は例示です」型の注記は対象外。断定していない文への注記であり、
  //   二重になっていない。ここが見ているのは「〜しやすい◯◯の例」の形だけ。
  // ★コメントは除いて見る。旧文言を「なぜ変えたか」の記録として残す必要が
  //   あり、それは画面に出ない（banned 検査と同じ方針）。
  const noComment = s => s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const dbl = [];
  for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 't')).filter(f => f.endsWith('.html')).map(f => `t/${f}`)]) {
    const m = noComment(read(f)).match(/(?:向いている|しやすい)[^。<>「」]{0,12}の例/g);
    if (m) dbl.push(`${f}(${[...new Set(m)].join('/')})`);
  }
  check(dbl.length === 0, `ヘッジの二重（「〜しやすい◯◯の例」）が0件${dbl.length ? ` → ${dbl.join(', ')}` : ''}`);

  // 新セクションが在ること。見出しはオーナー決定（U-1）。
  check(html.includes('<div class="r-pt">あなたが働きやすい職場</div>'),
        `結果画面に「あなたが働きやすい職場」がある`);

  // 送客ブロックより前に出ていること（§7-2。価値提供の直後に送客を置く）。
  const iEnv = html.indexOf('あなたが働きやすい職場</div>');
  const iAg = html.indexOf("buildAgentBlock('primary'");
  check(iEnv > 0 && iAg > 0 && iEnv < iAg, `「あなたが働きやすい職場」が送客ブロックより前にある`);

  // ENV の文に % を入れない（§6-2）。軸の百分率は本人側の目盛りであり、
  // 会社側に対応する数字が無いのに突き合わせを示唆してしまう。
  const envBlock = noComment(html.slice(html.indexOf('const ENV=['), html.indexOf('function buildEnvHTML')));
  check(!/[%％]/.test(envBlock), `ENV の文に % が入っていない（突き合わせを示唆しない）`);

  // 優先順位（買い物リスト）に戻っていないこと（§6-4）。
  const rank = ['譲れない', 'ゆずれない', 'こだわらなくて'].filter(w => envBlock.includes(w));
  check(rank.length === 0, `ENV に優先順位の語が無い${rank.length ? ` → ${rank.join('/')}` : ''}`);

  // sts は1箇所だけ（P-6 同じことを2回言わない）。新セクションへ移した。
  const stsN = (html.match(/\$\{t\.sts\}/g) || []).length;
  check(stsN === 1, `t.sts の出力が1箇所（実際: ${stsN}）`);

  // 入口の約束が結果画面の主役と揃っていること（U-2）。
  check(html.includes('あなたが働きやすい職場と、その見分け方まで。'),
        `.hero-sub が職場を約束している（職種ではない）`);
}

// --- 撤回した主張が戻っていないこと ---------------------------------------
// .hero-trust「登録不要 ｜ メールアドレス不要 ｜ 無料」は 2026-09-08 の
// オーナー判断で削除した。今後 登録や個人情報の取得を行う可能性があり、
// 書いてあるとその時点で撤回することになるため、先に約束しない。
// design/conversion-structure-and-pc-grid.md S-6 が置いた1行なので、
// 記録しておかないと次に読む人が仕様どおりに戻してしまう。
console.log('[lint] 撤回した主張');
{
  for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 't')).filter(x => x.endsWith('.html')).map(x => `t/${x}`)]) {
    const body = read(f).replace(/<!--[\s\S]*?-->/g, '');
    check(!body.includes('登録不要'), `${f} に「登録不要」が戻っていない`);
    check(!body.includes('メールアドレス不要'), `${f} に「メールアドレス不要」が戻っていない`);
  }
  check(!read('index.html').includes('class="hero-trust"'), `.hero-trust が復活していない`);
}

// --- 属性入力（#screen-profile）-------------------------------------------
// docs/specs/diagnosis-experience-revamp.md §D と、その【部分撤回 2026-09-08】。
// 必須は「立場」と「卒業年度」の2つだけ。性別・業界・職種は任意。
console.log('[lint] 属性入力');
{
  const pf = html.slice(html.indexOf('<div id="screen-profile"'), html.indexOf('<!-- LOADING -->'));
  check(pf.length > 0, `#screen-profile がある`);

  // ★性別を送客に一切使わない。守れないなら取らない、が取得の条件だった（D-L3）。
  //   実装で担保していることを、実装のソースで見る。
  const oa = html.slice(html.indexOf('function orderedAgents'), html.indexOf('function agentUrl'));
  const au = html.slice(html.indexOf('function agentUrl'), html.indexOf('function onAgentClick'));
  check(!/profile|\bsex\b/.test(oa), `orderedAgents() が profile / sex を参照していない`);
  check(!/profile|\bsex\b/.test(au), `agentUrl() が profile / sex を参照していない`);

  // 連絡先・学歴を聞かない。privacy.html 2. がそう書いている。
  const banned = ['メールアドレスを', '電話番号を', '大学名', '学部'];
  const hit = banned.filter(w => pf.includes(w) && !pf.includes(w + 'はうかがいません'));
  check(hit.length === 0, `属性入力が連絡先・学歴を聞いていない${hit.length ? ` → ${hit.join(', ')}` : ''}`);

  // 年度をハードコードしない。固定にすると毎年陳腐化する（未決6 はこれで解消）。
  check(!/\b2[0-9]卒/.test(pf), `年度を HTML に書き込んでいない（現在日から生成する）`);
  check(/function gradBaseYear/.test(html), `年度の基準年を出す関数がある`);

  // ポリシーと実装が食い違わないこと。片方だけ動かすと虚偽記載になる。
  const pv = read('privacy.html');
  for (const w of ['立場', '卒業年度', '性別', '業界', '職種']) {
    check(pv.includes(w), `privacy.html が「${w}」の取得を書いている`);
  }
  check(/端末内（ブラウザの localStorage）にのみ保存/.test(pv),
        `privacy.html が「端末内にのみ保存」と書いている（サーバー保存を足すときは同時に直す）`);
  check(/提供することはありません/.test(pv), `privacy.html が提携先へ提供しないと書いている`);
}

// --- sitemap.xml / robots.txt -------------------------------------------
// 索引対象が1ページから18ページに増えたため、存在を検索エンジンに知らせる
// 手段が要る。t/*.html は index.html から <a> で辿れない（結果画面のシェア
// からしか到達しない）ので、いまは sitemap が唯一の発見経路になっている。
// 生成物なので、タイプを増減して作り直し忘れた状態を機械で見つける。
console.log('[lint] sitemap.xml と robots.txt');
{
  const { renderAll: renderSitemap, DISALLOW } = await import('./gen-sitemap.mjs');
  const { files, urls, SITE_BASE } = await renderSitemap();

  let missing = [], stale = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f.file))) { missing.push(f.file); continue; }
    if (read(f.file) !== f.text) stale.push(f.file);
  }
  check(missing.length === 0, `sitemap.xml と robots.txt がある${missing.length ? ` → 無い: ${missing.join(', ')}` : ''}`);
  check(stale.length === 0,
        `sitemap/robots が最新（make sitemap を忘れていない）${stale.length ? ` → 古い: ${stale.join(', ')}` : ''}`);

  // sitemap のURL → リポジトリ内のファイル。'' は index.html を指す。
  const toFile = u => {
    if (!u.startsWith(SITE_BASE)) return null;
    const rel = u.slice(SITE_BASE.length);
    return rel === '' ? 'index.html' : rel;
  };

  // 仕様上 <loc> は絶対URL。SITE_BASE の外や相対が混ざると sitemap ごと無効になる。
  const foreign = urls.filter(u => toFile(u) === null);
  check(foreign.length === 0, `<loc> が全部 SITE_BASE 配下の絶対URL${foreign.length ? ` → ${foreign.join(', ')}` : ''}`);

  // 404 を送りつけていないこと（sitemap 内の 404 はサイトの評価を下げる）。
  const dead = urls.map(toFile).filter(f => f && !fs.existsSync(path.join(ROOT, f)));
  check(dead.length === 0, `sitemap の全URLが実ファイルに対応する${dead.length ? ` → 無い: ${dead.join(', ')}` : ''}`);

  check(new Set(urls).size === urls.length, `sitemap にURLの重複が無い（${urls.length}件）`);

  // 載せ忘れの検出。現役の公開ページ = PAGES + t/*.html。
  const live = [...PAGES, ...fs.readdirSync(path.join(ROOT, 't')).filter(f => f.endsWith('.html')).map(f => `t/${f}`)];
  const listed = new Set(urls.map(toFile));
  const unlisted = live.filter(f => !listed.has(f));
  check(unlisted.length === 0, `現役の公開ページが全部 sitemap にある${unlisted.length ? ` → 抜け: ${unlisted.join(', ')}` : ''}`);

  // 現役でないページを索引に送らないこと。
  check(!listed.has('characters.html'), `sitemap に characters.html が入っていない（noindex の旧ページ）`);

  const robots = read('robots.txt');

  // ここが肝。characters.html を Disallow するとクロールが止まり、
  // ページ内の noindex が読まれず「URLだけ検索結果に残る」状態になる。
  check(!/^Disallow:.*characters\.html/mi.test(robots),
        `robots.txt が characters.html を遮断していない（noindex を読ませるため）`);

  // 遮断したパスを sitemap で送るのは自己矛盾。
  const contradict = urls.filter(u => {
    const rel = toFile(u);
    return rel && DISALLOW.some(d => `/${rel}`.startsWith(d));
  });
  check(contradict.length === 0, `sitemap と robots.txt が矛盾しない${contradict.length ? ` → ${contradict.join(', ')}` : ''}`);

  check(robots.includes(`Sitemap: ${SITE_BASE}sitemap.xml`),
        `robots.txt の Sitemap 行が SITE_BASE と一致する`);

  // 画像が遮断されると SNS カードも Google 画像検索も出なくなる。
  check(!/^Disallow:\s*\/images\//mi.test(robots),
        `robots.txt が /images/ を遮断していない（og:image のため）`);
}

// --- 公開ディレクトリに置いてあるが、現役ではないページ ---
// characters.html は index.html からも privacy.html からも参照されていない旧版。
// オーナー判断で削除せず残しているが、検索から着地されると診断へ進めないまま
// 終わる（プライバシーポリシーへのリンクも無い）。索引だけは止め続ける。
console.log('[lint] 現役でない公開ページ');
{
  const orphan = 'characters.html';
  if (fs.existsSync(path.join(ROOT, orphan))) {
    const s = read(orphan);
    check(/<meta\s+name=["']robots["'][^>]*noindex/i.test(s),
          `${orphan} に noindex がある（現役に戻すときは外し、PAGES に足すこと）`);
    // 現行の一覧は index.html の #type-section。二重管理に戻っていないこと。
    // コメントでの言及は「参照」ではない（末尾の EMOJI ブロックが申し送りとして
    // この名前を書いている）。コメントを除いたうえで探す。
    const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check(!code.includes(orphan),
          `index.html が ${orphan} を参照していない（参照するなら noindex を外し PAGES に足す）`);
  }
}

console.log(ng === 0 ? '\n[lint] PASS' : `\n[lint] FAIL: ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
