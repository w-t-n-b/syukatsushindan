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
  check(html.includes('どちらでもない'), '.spec-hint の「どちらでもない」は残っている（5段階の中央の説明）');

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

  // C-7：回答ドットは <button> + role="radio"
  const sdwTags = [...html.matchAll(/<(\w+)[^>]*class="sdw"[^>]*>/g)].map(m => m[1]);
  check(sdwTags.length === 10, `.sdw は10個（LP5 + 質問画面5）: ${sdwTags.length}`);
  check(sdwTags.every(t => t === 'button'), `.sdw はすべて <button>（${[...new Set(sdwTags)].join(',')}）`);
  check((html.match(/class="sdw"[^>]*role="radio"/g) || []).length === 10, '.sdw すべてに role="radio"');
  check((html.match(/class="spec-track"[^>]*role="radiogroup"/g) || []).length === 2,
    '.spec-track は role="radiogroup"');

  // A-5：既存CTAは startFresh() ではなく continueOrStart() を呼ぶ
  const rawStart = [...html.matchAll(/on\w+="[^"]*startFresh\(/g)].length;
  check(rawStart === 0, `on* から startFresh() を直接呼ぶ箇所が0件（回答が消える）${rawStart ? ` → ${rawStart}件` : ''}`);
  check((html.match(/continueOrStart\(/g) || []).length >= 5,
    'continueOrStart() の呼び出しがヒーロー/16タイプ節/ドロワー/共有バナー/タイプ紹介にある');
  check(!html.includes('まず診断だけ受けてみる'), '「まず診断だけ受けてみる」（主CTAと同一動作の偽の選択肢）が0件');

  // A-2：保存キーは cq_p2。旧 cq_p は起動時に捨てる
  check(/const SAVE_KEY='cq_p2'/.test(html), '保存キーが cq_p2 に変わっている');
  check(/function dropLegacyProgress\(\)/.test(html), '旧キー cq_p を削除する処理がある');

  // A-2：質問ごとの全面グラデーション（軸別インライン背景）を廃止した
  check(!/quiz-bg'\)\.style\.background/.test(html) && !/q-top'\)\.style\.background/.test(html),
    '#quiz-bg / #q-top へのインライン background 代入が0件（背景は問ごとに変化しない）');

  // 計測：新規イベントも GA_ID が空なら送信されない track() 経由であること
  for (const ev of ['lp_q_answer', 'lq_continue_click', 'type_peek']) {
    check(new RegExp(`track\\('${ev}'`).test(html), `${ev} は track() 経由で送る（GA_ID が空なら送信しない）`);
  }
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
