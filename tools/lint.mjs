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
    '1ページ5問・ページ数は問数から算出（20問 → 4ページ）');
  check(/function pagePositions\(/.test(html) && /function firstIncompletePage\(/.test(html),
    'ページと出題位置の対応（pagePositions / firstIncompletePage）がある');

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
  const IMG_CODES = ['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'];
  const noHead = IMG_CODES.filter(c =>
    !new RegExp(`\\.tc:has\\(img\\[src\\*="chars/${c}"\\]\\),\\.cc:has\\(img\\[src\\*="sm/${c}"\\]\\)\\{--head:`).test(html));
  check(noHead.length === 0,
    `全16体に --head（頭頂位置の実測値）が定義されている${noHead.length ? ' → 欠落: ' + noHead.join(',') : ''}`);
  // 固定値に戻すと頭頂の低いキャラ（c4=9.2%）が切れる。--head 経由でしか指定させない。
  for (const [sel, re] of [['.tc img', /\.tc img\{object-position:50% clamp\(0%,calc\(\(var\(--head/],
                           ['.cc img', /\.cc img\{object-position:50% clamp\(0%,calc\(\(var\(--head/]]) {
    check(re.test(html), `${sel} の object-position は --head から算出している（固定値に戻していない）`);
  }
  check(/\.res-char\{[^}]*object-position:50% 50%/.test(html),
    '.res-char は 50% 50% のまま（f>=1 で縦の切り取りが起きないため対象外）');
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

// --- 回答UI：A / B が画面に出ていること（参考実装 quiz-vertical.js の構成）---
// 軸名を出さない（C-4）まま「Aに強く近い」と言うには、A と B が
// 何を指すのかが画面に出ている必要がある。ここが消えると目盛の文言が意味を失う。
console.log('[lint] 回答UI：A / B の明示');
{
  // 選択肢は枠付きボックス2つ横並びから、テキスト2行に変わった（仕様 §D-1）。
  // A / B の手がかりは「行頭の縦帯」「A. / B. の接頭辞」「選んだ側の .on」の3つ。
  const keys = [...html.matchAll(/<span class="opt-key">([AB])\.<\/span>/g)].map(m => m[1]);
  check(keys.join('') === 'AB', `選択肢に A. / B. の接頭辞がある: ${keys.join(',') || 'なし'}`);
  check((html.match(/class="opt-txt"/g) || []).length === 4,
    'LP用と本診断用の両テンプレートで、選択肢本文は .opt-txt に入る');
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
