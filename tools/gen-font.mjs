// 明朝のサブセットを焼く。
// ============================================================================
// なぜサブセットなのか
// ----------------------------------------------------------------------------
//   書体の規則（docs/design/mocks/type-rule.html）で、明朝を当てるのは
//   「指す言葉」＝16タイプのコードとタイプ名だけに絞った。
//   その結果、明朝が要る文字は**数え上げられる**（いま82文字）。
//   和文の全字種なら数百KB〜1.67MB だが、82文字なら約11KB で済む。
//
//   Google Fonts のリンクは使わない。Google の和文は頻度順のチャンクに
//   分かれており、82文字が散ると多数のチャンクを引く。自前で1つ焼けば
//   1リクエストで確定し、外部への通信も1つ減る。
//
// 使い方
// ----------------------------------------------------------------------------
//   1. 元フォントを用意する（OFL のものを使うこと）。既定の置き場所は
//      tools/font-src/ 。候補:
//        Shippori Mincho  … 横画がやや太く、画面での細り方が穏やか
//        Noto Serif JP    … 無難だが重い（サブセットするので最終サイズは同等）
//   2. pyftsubset が要る（fonttools）。venv を作って入れる:
//        python3 -m venv tools/.venv && tools/.venv/bin/pip install fonttools brotli
//   3. node tools/gen-font.mjs   （または make font）
//
//   出力: fonts/cq-mincho.woff2 （CSS の font-family:'CQMincho' が読む）
//
// ★タイプ名を変えたら焼き直すこと。忘れる。
//   tools/lint.mjs の「明朝サブセット」が、TD の名前に使われている文字が
//   全部フォントに入っているかを検査して、焼き忘れたままの公開を止める。
// ============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'tools', 'font-src');
const OUT_DIR = join(ROOT, 'fonts');
const OUT = join(OUT_DIR, 'cq-mincho.woff2');
const PYFT = join(ROOT, 'tools', '.venv', 'bin', 'pyftsubset');

/** index.html の TD から、明朝が要る文字を集める。
 *  ★ここが規則の実装である。明朝を当てる先を増やしたら、ここも増やす。 */
export function neededChars(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  const td = html.slice(html.indexOf('const TD='));
  const codes = [...td.matchAll(/\b([HD][AB][LW][SG]):\{name:"([^"]+)"/g)];
  if (codes.length !== 16) throw new Error(`TD から16タイプを読めなかった（${codes.length}件）`);
  const chars = new Set();
  for (const [, code, name] of codes) {
    for (const c of code) chars.add(c);
    for (const c of name) chars.add(c);
  }
  // ★ヒーローの組み文字（.tc）で明朝を使う助詞。
  //   書体規則（指す言葉は明朝）の例外である。ここでの明朝は「何を指すか」
  //   ではなく、重い塊に対する細い接続として字面の差を作るために使っている。
  //   ★入れ忘れるとこの2文字だけ端末標準の明朝へ落ち、書体が混ざる。
  //     しかも1文字ずつなので、混ざっていることに気づきにくい。
  for (const c of 'のを') chars.add(c);
  return { chars: [...chars].sort(), types: codes.map(([, c, n]) => ({ code: c, name: n })) };
}

function pickSource() {
  if (!existsSync(SRC_DIR)) return null;
  const f = readdirSync(SRC_DIR).filter(x => /\.(ttf|otf|ttc)$/i.test(x)).sort();
  return f.length ? join(SRC_DIR, f[0]) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chars, types } = neededChars();
  console.log(`[font] 明朝が要る文字: ${chars.length} 文字（16タイプ名 ＋ 16コード）`);
  console.log(`[font] ${chars.join('')}`);

  const src = pickSource();
  if (!src) {
    console.log(`\n[font] 元フォントが無いので焼けません。`);
    console.log(`       ${SRC_DIR}/ に OFL の明朝（.ttf / .otf）を1つ置いてください。`);
    console.log(`       候補: Shippori Mincho / Noto Serif JP（どちらも SIL OFL 1.1）`);
    console.log(`\n       いまは端末標準の明朝で表示されます（CSS のフォールバック）。`);
    console.log(`       Mac は Hiragino Mincho ProN、Windows は Yu Mincho になるため、`);
    console.log(`       ★環境によって見え方が変わります。`);
    process.exit(0);
  }
  if (!existsSync(PYFT)) {
    console.error(`\n[font] pyftsubset が無い: ${PYFT}`);
    console.error(`       python3 -m venv tools/.venv && tools/.venv/bin/pip install fonttools brotli`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(PYFT, [
    src, '--text=' + chars.join(''), '--flavor=woff2',
    '--layout-features=', '--no-hinting', '--desubroutinize',
    '--output-file=' + OUT,
  ], { stdio: 'inherit' });

  const size = statSync(OUT).size;
  console.log(`[font] ${src.replace(ROOT + '/', '')} → ${OUT.replace(ROOT + '/', '')}`);
  console.log(`[font] ${size} bytes = ${(size / 1024).toFixed(1)}KB`);
  // 焼いた内容の記録。lint がこれと TD を突き合わせる。
  writeFileSync(join(OUT_DIR, 'cq-mincho.chars.txt'), chars.join('') + '\n');
  console.log(`[font] 収録文字を fonts/cq-mincho.chars.txt に記録した`);
  console.log(`[font] 収録タイプ: ${types.map(t => t.code).join(' ')}`);
}
