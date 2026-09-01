// Chrome の実行ファイルを1か所で解決する。
//
// 開発は macOS、CI は Linux なので、パスを各ツールに直書きすると片方でしか動かない。
// 優先順位は「環境変数 → 実在する既知のパス」。見つからなければ null を返し、
// 呼び出し側が明示的に落とす（検証を飛ばして「問題なし」にはしないため）。
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,                                   // CI / 任意の環境で明示する
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

export function requireChrome(who) {
  const p = findChrome();
  if (p) return p;
  console.error(`[${who}] Chrome が見つかりません。探した場所:
${CANDIDATES.map(c => '  ' + c).join('\n')}
実ブラウザでの検証を飛ばして「問題なし」とはしません。
CHROME_PATH=/path/to/chrome を指定するか、Chrome を導入してから実行してください。`);
  process.exit(1);
}

// CI（root 実行やサンドボックス不可の環境）向けの追加フラグ。
// 既定では何も足さない。必要な環境だけ CHROME_FLAGS で渡す。
export const EXTRA_FLAGS = (process.env.CHROME_FLAGS || '').split(' ').filter(Boolean);
