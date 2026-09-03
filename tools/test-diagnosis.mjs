// test — 診断ロジックの回帰テスト。
//
// このサイトで壊してはいけないものは1つだけ:「20問の回答から出るタイプが変わらないこと」。
// index.html のインラインJSを最小DOMスタブ上で実際に動かし、
//   (1) 16タイプすべてが狙いどおり出るか
//   (2) 擬似ランダム200パターンの判定が golden と1文字も違わないか
//   (3) URL入口（?type= / ref=share）の分岐が仕様どおりか
// を確かめる。golden は「送客ファネル実装前の index.html」から採取したもので、
// これが一致する限り、診断ロジックには一切手が入っていないと言い切れる。
//
// golden の更新は「診断ロジックを意図的に変えたとき」だけ。
//   node tools/test-diagnosis.mjs --update-golden
// を実行し、差分の理由をコミットメッセージに書くこと。
import fs from 'node:fs';
import path from 'node:path';
import { load } from './dom-stub.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'index.html');
const GOLDEN = path.join(ROOT, 'tools/golden/diagnosis-fingerprint.txt');
const UPDATE = process.argv.includes('--update-golden');

const CODES = ['HALS','HALG','HAWS','HAWG','HBLS','HBLG','HBWS','HBWG',
               'DALS','DALG','DAWS','DAWG','DBLS','DBLG','DBWS','DBWG'];

let ng = 0;
const ok = m => console.log(`  ok   ${m}`);
const bad = m => { ng++; console.log(`  NG   ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

// 20問を実際に回答する。1画面5問・全4ページなので、5問答えては nextPage() で送る。
//
// ★ values は「Qs の添字」で並んでいる（values[k] を Qs[k] に与える）。
//    Q_ORDER により出題順と Qs の添字は一致しないため、出題位置 p では
//    values[Q_ORDER[p]] を答える。こうすると「設問と値の対応」が改修前と同一になり、
//    golden（20値の並び → コード・サブコード・4軸スコア）が1文字も変わらないことが
//    「見せ方を変えても採点は不変」の証明になる。golden 側は一切書き換えない。
function answer(S, values) {
  S.startFresh('test');
  const order = S.__eval('Q_ORDER');
  const pages = S.__eval('PAGE_COUNT'), size = S.__eval('PAGE_SIZE');
  for (let p = 0; p < pages; p++) {
    for (const pos of S.__eval(`pagePositions(${p})`)) {
      S.pick(S.__dot('q', pos, values[order[pos]]));
    }
    if (p < pages - 1) S.nextPage();          // 最終ページの「次へ」はローディングに入るので押さない
  }
  return { code: S.getCode(), sub: S.getSubCode(), scores: JSON.stringify(S.__eval('scores')) };
}

// LP埋め込み（#lq-list）側で、出題位置 pos に値 v を入れる
function answerLp(S, pos, v) { S.pick(S.__dot('lq', pos, v)); }
// 診断画面（#q-list）側で、いま出ているページの出題位置 pos に値 v を入れる
function answerQuiz(S, pos, v) { S.pick(S.__dot('q', pos, v)); }
// DOMContentLoaded を流す（load() 直後は登録されただけで走っていない）
function boot(S) { S.__timers.splice(0).forEach(fn => fn()); }
// 面 face に出ているカードの Q番号（.q-badge の文字列）
function badges(S, face) {
  return S.document.querySelectorAll(`#${face === 'lq' ? 'lq-list' : 'q-list'} .q-badge`)
    .map(b => b.textContent).join(',');
}

// 軸1〜4に5問ずつ。狙ったコードになる極端な回答列を作る。
// 6段階スケールの端は ±3（±2 ではない）。
function extremeFor(code) {
  const sign = [code[0] === 'H' ? 1 : -1, code[1] === 'A' ? 1 : -1,
                code[2] === 'L' ? 1 : -1, code[3] === 'S' ? 1 : -1];
  const out = [];
  for (let ax = 0; ax < 4; ax++) for (let i = 0; i < 5; i++) out.push(sign[ax] * 3);
  return out;
}

// 「軸の合計がちょうど0になる」回答列を Qs の添字基準で作る。
// vals[ax] は 5問ぶんの配列。合計0・符号は必ず 3対2 以上に割れる。
function byAxis(perAxis) {
  const out = [];
  for (let ax = 1; ax <= 4; ax++) out.push(...perAxis[ax]);
  return out;   // Qs は軸ごとに5問ずつのブロック配置なのでこの順で対応する
}

const S = load(TARGET, '');

// ---- (0) 出題順 Q_ORDER が採点に影響しないことの前提を先に確かめる ----
// golden 突合（(2)）が「採点が変わっていない」の本証明だが、その前に
// Q_ORDER 自体が「全20問を1回ずつ・4軸を均等に・1問ごとに回す」ことを固定する。
console.log('[test] 出題順 Q_ORDER（A-2）');
{
  const order = S.__eval('Q_ORDER');
  const qs = S.__eval('Qs.map(q=>q.ax)');
  const lp = S.__eval('LP_Q_COUNT');
  check(order.length === qs.length, `Q_ORDER の長さが Qs と同じ（${order.length}）`);
  check(new Set(order).size === qs.length && order.every(i => i >= 0 && i < qs.length),
    '全20問を過不足なく1回ずつ使う（重複・欠落なし）');
  const axSeq = order.map(i => qs[i]);
  check(axSeq.every((ax, p) => ax === (p % 4) + 1),
    `軸を 1→2→3→4 で回している: ${axSeq.join('')}`);
  const cnt = [0, 0, 0, 0, 0];
  axSeq.forEach(ax => cnt[ax]++);
  check(cnt[1] === 5 && cnt[2] === 5 && cnt[3] === 5 && cnt[4] === 5,
    `各軸ちょうど5問ずつ（軸1..4 = ${cnt.slice(1).join('/')}）`);
  check(lp === 5, `LP_Q_COUNT = ${lp}`);
  check(axSeq.slice(0, lp).join(',') === '1,2,3,4,1',
    'LPに出る5問の軸が順に 1,2,3,4,1（4軸すべてに触れ、5問目で2周目に入る）');
}

// ---- (0b) 6段階スケール ----
// 「どちらでもない」を廃止し、必ずどちらかに倒す。中央値が無いことと、
// 6つの値がそれぞれ正しい重みで加算されることを、採点の入口で押さえる。
console.log('[test] 6段階スケール（+3/+2/+1/-1/-2/-3）');
{
  const T = load(TARGET, '');
  boot(T);
  const vals = T.document.querySelectorAll('#lq-list .q-card[data-pos="0"] .sdw')
    .map(d => Number(d.dataset.v));
  check(vals.join(',') === '3,2,1,-1,-2,-3', `目盛は6つで値は +3/+2/+1/-1/-2/-3: ${vals.join(',')}`);
  check(!vals.includes(0), '中央値（0）が存在しない＝「どちらでもない」を選べない');

  // 6つの値すべてを1問ずつ使い、加算結果が値そのものと一致するか
  for (const v of vals) {
    const U = load(TARGET, '');
    boot(U);
    answerLp(U, 0, v);
    const ax = U.__eval('qAt(0).ax');
    check(U.__eval(`scores[${ax}]`) === v && U.__eval('ans[0]') === v,
      `${v >= 0 ? '+' : ''}${v} を選ぶと軸${ax}に ${v} が加算される（scores=${U.__eval(`scores[${ax}]`)}）`);
  }
}

// ---- (0c) 二重加算をしないこと（仕様 §B-3）----
// 5問を同時に出す以上、同じ設問を選び直せる。旧実装の `scores[ax]+=v` は
// 2回選ぶと2回足された。scores は ans[] から毎回作り直すので、
// 何度選び直しても最後の1回ぶんしか入らない。
console.log('[test] 選び直しても二重加算しない（§B-3）');
{
  // LP側で同じ設問を選び直す
  const T = load(TARGET, '');
  boot(T);
  const ax = T.__eval('qAt(0).ax');
  [3, 2, 1, -1, -2, -3, 2].forEach(v => answerLp(T, 0, v));
  check(T.__eval(`scores[${ax}]`) === 2 && T.__eval('ans[0]') === 2,
    `LPで7回選び直しても最後の +2 だけが入る（scores[${ax}]=${T.__eval(`scores[${ax}]`)}）`);
  check(T.__eval('curQ') === 1, `回答済みの問数は1のまま（${T.__eval('curQ')}）`);

  // 診断画面側で同じ設問を選び直す
  const U = load(TARGET, '');
  boot(U);
  U.startFresh('test');
  const ax2 = U.__eval('qAt(2).ax');
  [-3, 3, -1].forEach(v => answerQuiz(U, 2, v));
  check(U.__eval(`scores[${ax2}]`) === -1 && U.__eval('ans[2]') === -1,
    `診断画面で3回選び直しても最後の -1 だけが入る（scores[${ax2}]=${U.__eval(`scores[${ax2}]`)}）`);

  // 選び直しを挟んでも、最終的な20問の判定は選び直し後の値だけで決まる
  const V = load(TARGET, '');
  boot(V);
  const straight = answer(V, extremeFor('HALS'));
  const W = load(TARGET, '');
  boot(W);
  W.startFresh('test');
  const order = W.__eval('Q_ORDER'), want = extremeFor('HALS');
  for (let p = 0; p < W.__eval('PAGE_COUNT'); p++) {
    for (const pos of W.__eval(`pagePositions(${p})`)) {
      answerQuiz(W, pos, -want[order[pos]]);          // いったん逆を選び
      answerQuiz(W, pos, want[order[pos]]);           // 選び直す
    }
    if (p < 3) W.nextPage();
  }
  check(W.getCode() === straight.code &&
        JSON.stringify(W.__eval('scores')) === straight.scores,
    `全20問を一度逆に選んでから選び直しても結果が同じ（${W.getCode()} / ${JSON.stringify(W.__eval('scores'))}）`);
}

// ---- (1) 16タイプ ----
console.log('[test] 16タイプの判定と結果画面の生成');
const reached = new Set();
for (const want of CODES) {
  const r = answer(S, extremeFor(want));
  S.showResult(true, 'quiz');
  const html = S.__byId.get('screen-result').innerHTML;
  reached.add(r.code);
  check(r.code === want && html.length > 5000,
    `${want}: getCode()=${r.code} sub=${r.sub} 結果HTML=${html.length}文字`);
}
check(reached.size === 16 && CODES.every(c => reached.has(c)),
  `16タイプすべてが到達可能（到達 ${reached.size}/16）`);

// ---- (1b) タイブレーカー：軸の合計が0のとき多数決で決める ----
// 6段階でも合計0は普通に起こる（例: +1+1+1-1-2 = 0）。
// 1軸5問・中央値なしなので符号は必ず 3対2 以上に割れ、引き分けは原理的に無い。
console.log('[test] タイブレーカー（軸の合計が0のとき）');
{
  const ZERO_A = [1, 1, 1, -1, -2];    // 合計0 / A側3・B側2 → A側に倒れる
  const ZERO_B = [-1, -1, -1, 1, 2];   // 合計0 / A側2・B側3 → B側に倒れる
  const PLUS   = [3, 3, 3, 3, 3];      // 合計+15（対照用）

  const cases = [
    [{ 1: ZERO_A, 2: ZERO_A, 3: ZERO_A, 4: ZERO_A }, 'HALS', '4軸すべて合計0・A側が多数 → HALS'],
    [{ 1: ZERO_B, 2: ZERO_B, 3: ZERO_B, 4: ZERO_B }, 'DBWG', '4軸すべて合計0・B側が多数 → DBWG'],
    [{ 1: ZERO_B, 2: ZERO_A, 3: ZERO_B, 4: ZERO_A }, 'DAWS', '軸ごとに多数派が違っても軸単位で決まる'],
    [{ 1: ZERO_B, 2: PLUS,   3: ZERO_A, 4: PLUS   }, 'DALS', '合計が0でない軸は従来どおり合計で決まる'],
  ];
  for (const [perAxis, want, label] of cases) {
    const vals = byAxis(perAxis);
    const r = answer(S, vals);
    const sc = JSON.parse(r.scores);
    const zeroAxes = [1, 2, 3, 4].filter(ax => sc[ax] === 0);
    check(r.code === want,
      `${label}: scores=${r.scores} 合計0の軸=[${zeroAxes.join(',')}] → ${r.code}`);
  }

  // 引き分けが原理的に起こらないこと（5は奇数）を、5問ぶんの全 6^5 通りで確かめる。
  // ここが割れなくなる＝設問数を偶数に変えた、ということ。
  const VALS6 = [3, 2, 1, -1, -2, -3];
  let combos = 0, zeroSum = 0, tied = 0;
  const walk = (acc) => {
    if (acc.length === 5) {
      combos++;
      const sum = acc.reduce((a, b) => a + b, 0);
      const votes = acc.reduce((a, b) => a + (b > 0 ? 1 : -1), 0);
      if (sum === 0) zeroSum++;
      if (votes === 0) tied++;
      return;
    }
    for (const v of VALS6) walk(acc.concat(v));
  };
  walk([]);
  check(combos === 6 ** 5 && tied === 0,
    `1軸5問の全${combos}通りで多数決の引き分けが0件（合計0になるのは ${zeroSum} 通り＝${(zeroSum / combos * 100).toFixed(1)}%）`);
}

// ---- (2) 擬似ランダム200パターンの指紋 ----
console.log('[test] 擬似ランダム200パターンの回帰（golden 突合）');
let seed = 20260829;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const VALS = [3, 2, 1, -1, -2, -3];
const lines = [];
for (let n = 0; n < 200; n++) {
  const vals = Array.from({ length: 20 }, () => VALS[Math.floor(rnd() * VALS.length)]);
  const r = answer(S, vals);
  lines.push(`${vals.join(',')}|${r.code}|${r.sub}|${r.scores}`);
}
const fingerprint = lines.join('\n') + '\n';

if (UPDATE) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, fingerprint);
  console.log(`  info golden を更新しました: ${path.relative(ROOT, GOLDEN)}`);
} else if (!fs.existsSync(GOLDEN)) {
  bad(`golden がありません。初回は --update-golden で採取してください: ${path.relative(ROOT, GOLDEN)}`);
} else {
  const golden = fs.readFileSync(GOLDEN, 'utf8');
  if (golden === fingerprint) {
    ok('200パターンすべてが golden と完全一致（コード・サブコード・4軸スコア）');
  } else {
    const g = golden.split('\n'), c = fingerprint.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(g.length, c.length) && diff.length < 5; i++) {
      if (g[i] !== c[i]) diff.push(`    行${i + 1}\n      golden: ${g[i]}\n      現在  : ${c[i]}`);
    }
    bad(`200パターンの判定が golden と一致しません（診断ロジックが変わっています）:\n${diff.join('\n')}`);
  }
}

// ---- (3) URL入口の分岐 ----
console.log('[test] URL入口の分岐');
const cases = [
  ['?type=HALS',            { result: true,  banner: false }, '?type= は従来どおり結果を表示する（既存動作の非破壊）'],
  ['?type=hals',            { result: true,  banner: false }, '?type= は小文字でも動く'],
  ['?type=XXXX',            { result: false, banner: false }, '不正な ?type= では結果を出さない'],
  ['?type=HALS&ref=share',  { result: false, banner: true  }, 'ref=share は結果を出さず .shared-banner を出す（§A-6）'],
  ['?ref=share',            { result: false, banner: false }, 'type なしの ref=share は何もしない'],
  ['',                      { result: false, banner: false }, 'クエリなしは LP のまま'],
];
for (const [q, want, label] of cases) {
  const T = load(TARGET, q);
  const hasResult = T.__byId.get('screen-result').innerHTML.trim().length > 0;
  const hasBanner = (T.__heroInner._adjacent || '').includes('shared-banner');
  check(hasResult === want.result && hasBanner === want.banner,
    `${label}（結果DOM:${hasResult} バナー:${hasBanner}）`);
}

// ---- (4) 送客ブロックは未診断者に出さない ----
console.log('[test] 送客ブロックの出し分け');
{
  const T = load(TARGET, '');
  check(T.__eval('AGENTS').length === 0, '出荷時の AGENTS は0件');
  T.__eval("AGENTS.push({id:'t',name:'テスト',url:'https://example.com',forWhom:'x',meta:'電話なし',company:'テスト社',license:''})");

  answer(T, extremeFor('HALS'));
  T.showResult(true, 'quiz');
  check(T.__byId.get('screen-result').innerHTML.includes('agent-primary'),
    '20問回答後（source=quiz）は #agent-primary が出る');

  T.showResult(true, 'grid');
  check(!T.__byId.get('screen-result').innerHTML.includes('agent-primary'),
    'source=quiz 以外（未診断者）は出さない');

  T.showResult(true, 'shared');
  check(!T.__byId.get('screen-result').innerHTML.includes('agent-primary'),
    '?type= 来訪（source=shared・未診断者）は出さない');

  T.__eval('AGENTS.length=0');
  T.showResult(true, 'quiz');
  check(!T.__byId.get('screen-result').innerHTML.includes('agent-'),
    '掲載0件なら枠ごと描画しない');
}

// ---- (5) シェアURL ----
console.log('[test] シェアURL');
{
  const T = load(TARGET, '?type=DBWG');
  check(T.shareUrl('HALS') === 'https://w-t-n-b.github.io/syukatsushindan/?type=HALS&ref=share',
    `shareUrl('HALS') = ${T.shareUrl('HALS')}`);
  check(T.topUrl() === 'https://w-t-n-b.github.io/syukatsushindan/',
    `topUrl() = ${T.topUrl()}（?type= を含まない）`);
  let opened = '';
  T.open = u => { opened = u; };
  answer(T, extremeFor('HALS'));
  T.shareX();
  check(decodeURIComponent(opened).includes(T.shareUrl('HALS')), 'shareX のURLにサイトURLが含まれる');
  check(!decodeURIComponent(opened).includes('希少'), 'shareX に根拠のない統計が含まれない');
  T.shareLINE();
  check(decodeURIComponent(opened).includes(T.shareUrl('HALS')), 'shareLINE の本文にサイトURLが含まれる');
}

// ---- (6) 1画面5問・全4ページ（仕様 §A-1 / §B）----
console.log('[test] 1画面5問・全4ページ');
{
  const T = load(TARGET, '');
  boot(T);
  T.startFresh('test');
  check(T.__eval('PAGE_SIZE') === 5 && T.__eval('PAGE_COUNT') === 4,
    `20問 = 5問 × 4ページ（PAGE_SIZE=${T.__eval('PAGE_SIZE')} PAGE_COUNT=${T.__eval('PAGE_COUNT')}）`);
  check(T.__positions('q').join(',') === '0,1,2,3,4', `1ページ目に出るのは出題位置 0-4: ${T.__positions('q').join(',')}`);
  check(badges(T, 'q') === 'Q1,Q2,Q3,Q4,Q5', `1ページ目は Q1〜Q5: ${badges(T, 'q')}`);
  check(T.document.querySelectorAll('#q-list .q-card').length === 5, 'カードは5枚');
  check(T.document.querySelectorAll('#q-list .spec-track').length === 5,
    '5問ぶんのラジオグループが独立して並ぶ');
  check(T.__byId.get('prog-text').textContent === 'Q1-5 / 全20問',
    `進捗はページ単位: ${T.__byId.get('prog-text').textContent}`);
  check(T.__byId.get('back-btn').style.display === 'none', '1ページ目では「前のページに戻る」を出さない（§B-4）');
  check(T.__byId.get('q-next').textContent === '次へ →', `最終ページ以外は「次へ」: ${T.__byId.get('q-next').textContent}`);
  check(T.__byId.get('q-remain').textContent === 'あと5問', `残数を常時出す: ${T.__byId.get('q-remain').textContent}`);

  // 未回答があるうちは進めない（§B-2）
  [0, 1, 2].forEach(pos => answerQuiz(T, pos, 2));
  check(T.__byId.get('q-remain').textContent === 'あと2問', `残数が減る: ${T.__byId.get('q-remain').textContent}`);
  T.nextPage();
  check(T.__eval('curPage') === 0, '未回答が2問あるうちは次のページへ進まない');
  check(T.__byId.get('q-remain').classList.contains('warn'), '残数が警告状態になる');
  check(/未回答が2問/.test(T.__byId.get('q-remain').textContent),
    `何問残っているかを画面に出す: ${T.__byId.get('q-remain').textContent}`);
  check(T.__byId.get('q-next').getAttribute('disabled') == null,
    '「次へ」は disabled にしない（押せないボタンは理由を説明できない）');

  // 5問そろえば進める
  [3, 4].forEach(pos => answerQuiz(T, pos, 2));
  check(T.__byId.get('q-remain').textContent === '5問すべて回答済み',
    `そろったことを出す: ${T.__byId.get('q-remain').textContent}`);
  T.nextPage();
  check(T.__eval('curPage') === 1, '5問そろえば次のページへ進む');
  check(T.__positions('q').join(',') === '5,6,7,8,9', `2ページ目は出題位置 5-9: ${T.__positions('q').join(',')}`);
  check(T.__byId.get('prog-text').textContent === 'Q6-10 / 全20問',
    `進捗表示が追従する: ${T.__byId.get('prog-text').textContent}`);
  check(T.__byId.get('back-btn').style.display === 'flex', '2ページ目からは「前のページに戻る」が出る');

  // ページを戻っても回答は消えない（§B-4）
  const before = T.__eval('JSON.stringify(scores)');
  T.goBack();
  check(T.__eval('curPage') === 0, '1ページ戻る');
  check(T.__eval('JSON.stringify(scores)') === before,
    `戻っても回答が消えない: ${T.__eval('JSON.stringify(scores)')}`);
  check(T.document.querySelectorAll('#q-list .sdw.sel').length === 5,
    '戻ったページの5問が選択済みの状態で表示される');
  check(T.__byId.get('q-remain').textContent === '5問すべて回答済み', '戻ったページの残数表示も正しい');

  // 最終ページの「次へ」は結果へ進む
  const L = load(TARGET, '');
  boot(L);
  L.startFresh('test');
  for (let p = 0; p < 4; p++) {
    L.__eval(`pagePositions(${p})`).forEach(pos => answerQuiz(L, pos, 3));
    if (p < 3) L.nextPage();
  }
  check(L.__byId.get('q-next').textContent === '結果を見る →',
    `最終ページのボタンは「結果を見る」: ${L.__byId.get('q-next').textContent}`);
  L.nextPage();
  L.__timers.splice(0).forEach(fn => fn());
  check(L.__byId.get('screen-result').classList.contains('active'), '最終ページの「次へ」で結果へ進む');
}

// ---- (6b) 進捗の4群＝4ページ（§B-5）----
console.log('[test] 進捗の4群がページと一致する');
{
  const T = load(TARGET, '');
  boot(T);
  T.startFresh('test');
  const seg = T.__byId.get('prog-seg');
  check(seg.querySelectorAll('.ps-group').length === 4 && seg.querySelectorAll('.ps-cell').length === 20,
    '4群 × 5セル');
  check(seg.querySelectorAll('.ps-cell.cur').length === 0,
    'セル単位の現在地表示は無い（5問同時表示に「現在の1問」は存在しない）');
  check(seg.querySelectorAll('.ps-group.cur').length === 1 &&
        seg.children[0].classList.contains('cur'),
    '現在地は群（＝ページ）で示す。1ページ目なら1群目');
  // 歯抜けに答えても、塗られるのは答えた位置だけ
  [1, 3].forEach(pos => answerQuiz(T, pos, 2));
  const cells = T.__byId.get('prog-seg').querySelectorAll('.ps-cell');
  const done = cells.map((c, i) => c.classList.contains('done') ? i : -1).filter(i => i >= 0);
  check(done.join(',') === '1,3', `塗りは回答した出題位置と一致する（歯抜けでも正しい）: ${done.join(',')}`);
  // 2ページ目へ行くと現在地の群が移る
  [0, 2, 4].forEach(pos => answerQuiz(T, pos, 2));
  T.nextPage();
  check(T.__byId.get('prog-seg').children[1].classList.contains('cur'), '2ページ目では2群目が現在地');
}

// ---- (6c) Q1-5 は2つの入口を持ち、相互に反映される（§A-2 / §A-3）----
console.log('[test] LP埋め込みと診断画面1ページ目の相互反映');
{
  const T = load(TARGET, '');
  boot(T);
  check(T.__positions('lq').join(',') === '0,1,2,3,4', `LPにも出題位置 0-4 が並ぶ: ${T.__positions('lq').join(',')}`);
  check(badges(T, 'lq') === 'Q1,Q2,Q3,Q4,Q5', `LPは Q1〜Q5: ${badges(T, 'lq')}`);
  check(T.document.querySelectorAll('#lq-list .q-card').length === 5, 'LPのカードも5枚');
  check(T.__byId.get('lq-remain').textContent === 'あと5問', 'LPにも残数が出る');

  // LPで答える → 診断画面1ページ目にも反映される
  answerLp(T, 0, 3);
  answerLp(T, 2, -2);
  check(T.__dot('q', 0, 3).classList.contains('sel') && T.__dot('q', 2, -2).classList.contains('sel'),
    'LPで答えた値が診断画面1ページ目の目盛にも入っている');
  check(T.__dot('q', 0, 3).getAttribute('aria-checked') === 'true',
    '反映は aria-checked にも及ぶ（読み上げでも選択済みと分かる）');

  // 診断画面で選び直す → LPにも反映される
  answerQuiz(T, 0, -1);
  check(T.__dot('lq', 0, -1).classList.contains('sel') && !T.__dot('lq', 0, 3).classList.contains('sel'),
    '診断画面で選び直すとLP側の目盛も入れ替わる');
  check(T.__eval('ans[0]') === -1 && T.__eval('curQ') === 2,
    `二重加算されない（ans[0]=${T.__eval('ans[0]')} 回答数=${T.__eval('curQ')}）`);

  // 選んだ側の選択肢が視覚的に分かる（§D-2）
  const card = T.document.querySelector('#lq-list .q-card[data-pos="2"]');
  check(card.querySelector('.opt-b').classList.contains('on') &&
        !card.querySelector('.opt-a').classList.contains('on'),
    'B側を選んだのでB行が強調され、A行は強調されない');
}

// ---- (6d) LPで5問答えたあと（§A-2 の遷移表 / §C-3）----
console.log('[test] LPで5問答えたあとの接続');
{
  const T = load(TARGET, '');
  boot(T);
  // 出題位置 0..4 = Qs[0](軸1) / Qs[5](軸2) / Qs[10](軸3) / Qs[15](軸4) / Qs[1](軸1)
  [2, 1, 2, -1, 1].forEach((v, pos) => answerLp(T, pos, v));

  check(T.__eval('curQ') === 5, `5問回答して回答数=5（${T.__eval('curQ')}）`);
  check(!T.__byId.get('screen-quiz').classList.contains('active'),
    '5問目の回答で #screen-quiz へ自動遷移しない（§B-1）');
  check(T.__byId.get('lq-done').classList.contains('on'), '.lq-done が出る');
  check(T.document.querySelectorAll('#lq-list .q-card').length === 5,
    '.lq-done を出しても5問のカードは消えない（選び直せる。§C-3）');
  const sc = T.__eval('JSON.stringify(scores)');
  check(sc === JSON.stringify({ 1: 3, 2: 1, 3: 2, 4: -1 }),
    `5問ぶんが4軸に正しく加算されている: ${sc}`);
  check(T.__byId.get('cta-hero').textContent === '残り15問を続ける →',
    `ヒーローCTAの文言が残数と一致: ${T.__byId.get('cta-hero').textContent}`);

  T.lqContinue();
  check(T.__byId.get('screen-quiz').classList.contains('active'), '#lq-continue で診断画面へ進む');
  check(T.__eval('curPage') === 1 && T.__byId.get('prog-text').textContent === 'Q6-10 / 全20問',
    `診断画面は2ページ目から始まる: ${T.__byId.get('prog-text').textContent}`);
  check(T.__eval('JSON.stringify(scores)') === sc, '続行してもスコアが保持されている');

  // LPが埋まっていなければ進めない
  const U = load(TARGET, '');
  boot(U);
  [0, 1].forEach(pos => answerLp(U, pos, 2));
  U.lqContinue();
  check(!U.__byId.get('screen-quiz').classList.contains('active'),
    'LPに未回答があるうちは「残り15問を続ける」で進まない（§B-2）');
  check(U.__byId.get('lq-remain').classList.contains('warn'), 'LP側も残数が警告状態になる');
}

// 既存CTAの行き先（§A-2 の遷移表）
console.log('[test] 既存CTAの付け替え（continueOrStart）');
{
  const T = load(TARGET, '');
  boot(T);
  [0, 1, 2].forEach(pos => answerLp(T, pos, 2));
  const before = T.__eval('JSON.stringify(scores)');
  T.continueOrStart('hero');
  check(T.__eval('curQ') === 3, `ヒーローCTAで回答数が 0 に戻らない（${T.__eval('curQ')}）`);
  check(T.__eval('JSON.stringify(scores)') === before, `回答が消えない: ${before}`);
  // wording-audit.md §2 案B：ヒーローCTAは5問そろうまで #lp-quiz へ送る。
  // 押した先に、直下に見えているのと同じ Q1-5 を全画面で出し直さない。
  check(!T.__byId.get('screen-quiz').classList.contains('active') &&
        T.__byId.get('screen-title').classList.contains('active'),
    'LPで1〜4問の人は画面遷移させず #lp-quiz へ戻す（同じ Q1-5 を出し直さない）');
  check(T.document.querySelectorAll('#lq-list .sdw.sel').length === 3,
    'その3問が選択済みの状態でLPに残っている');
  check(T.__byId.get('cta-hero').textContent === '続きから答える ↓',
    `CTA文言が呼び先（同じページの #lp-quiz）と一致: ${T.__byId.get('cta-hero').textContent}`);

  // 16タイプ節・ドロワーからも同じこと
  T.continueOrStart('grid');
  T.continueOrStart('drawer');
  check(T.__eval('curQ') === 3 && T.__eval('JSON.stringify(scores)') === before,
    '16タイプ節CTA / ドロワーCTA でも回答が保持される');

  // 1ページ目が埋まっていれば2ページ目へ
  const P = load(TARGET, '');
  boot(P);
  [0, 1, 2, 3, 4].forEach(pos => answerLp(P, pos, 2));
  P.continueOrStart('hero');
  check(P.__eval('curPage') === 1,
    'LPで5問すべて答えた人がCTAを押すと2ページ目（1ページ目は完了しているため）');

  // 1問も答えていない人は、ヒーローCTAでは #lp-quiz（最初の質問）へ。
  // 16タイプ節・ドロワーからは従来どおり診断画面を1ページ目から開く。
  const F = load(TARGET, '');
  boot(F);
  F.continueOrStart('hero');
  check(!F.__byId.get('screen-quiz').classList.contains('active') && F.__eval('curQ') === 0,
    '未回答のヒーローCTAは #lp-quiz へ送る（§2 案B）');
  check(F.__byId.get('cta-hero').textContent === '最初の質問へ ↓',
    `未回答時のヒーローCTAの文言: ${F.__byId.get('cta-hero').textContent}`);
  F.continueOrStart('grid');
  check(F.__byId.get('screen-quiz').classList.contains('active') &&
        F.__eval('curQ') === 0 && F.__eval('curPage') === 0,
    '16タイプ節のCTAは未回答なら診断画面を1ページ目から開く（変えていない）');

  // 共有リンクで来た人は #lp-quiz へ（現状維持）
  const S2 = load(TARGET, '');
  boot(S2);
  S2.continueOrStart('shared');
  check(!S2.__byId.get('screen-quiz').classList.contains('active'),
    '共有リンクで来た人は診断画面に飛ばさず #lp-quiz へ送る');
}

// ---- (7) 途中復帰と保存キー（§E）----
console.log('[test] 途中復帰と保存キー（§E）');
{
  const T = load(TARGET, '');
  boot(T);
  answerLp(T, 0, 2); answerLp(T, 1, 2);
  const saved = T.__eval("localStorage.getItem('cq_p3')");
  check(typeof saved === 'string' && saved.length > 0, `保存キーは cq_p3 のまま（${saved}）`);
  check(T.__eval("localStorage.getItem('cq_p')") === null &&
        T.__eval("localStorage.getItem('cq_p2')") === null,
    '旧キー cq_p / cq_p2 には書き込まない');

  // 別セッションとして開き直し、保存内容だけを引き継ぐ
  const R = load(TARGET, '');
  R.__eval(`localStorage.setItem('cq_p3',${JSON.stringify(saved)})`);
  boot(R);
  check(R.__byId.get('cont-banner').style.display === 'flex', '再訪で .cont-banner が出る');
  R.continueDiag();
  check(!R.__byId.get('screen-quiz').classList.contains('active'),
    '回答が5問未満の人を診断画面に飛ばさない（§E-2）');
  check(R.__byId.get('screen-title').classList.contains('active'), 'LPのまま復帰する');
  check(R.__eval('curQ') === 2 && R.__eval('JSON.stringify(scores)') === T.__eval('JSON.stringify(scores)'),
    `回答数とスコアが保存時と一致する: ${R.__eval('JSON.stringify(scores)')}`);
  check(R.document.querySelectorAll('#lq-list .sdw.sel').length === 2,
    'LPの2問が選択済みの状態で復帰する');

  // 8問ぶん進んだ人は2ページ目（最初の未完了ページ）へ
  const R2 = load(TARGET, '');
  const ans8 = [2,2,2,2,2,2,2,2];
  R2.__eval(`localStorage.setItem('cq_p3',JSON.stringify({curQ:8,scores:{1:0,2:0,3:0,4:0},ans:${JSON.stringify(ans8)},selectedIndustries:[]}))`);
  boot(R2);
  R2.continueDiag();
  check(R2.__byId.get('screen-quiz').classList.contains('active') &&
    R2.__eval('curPage') === 1 &&
    R2.__byId.get('prog-text').textContent === 'Q6-10 / 全20問',
    `8問ぶん進んだ人は2ページ目に復帰する: ${R2.__byId.get('prog-text').textContent}`);
  check(R2.__eval('curQ') === 8, `回答数が復元される（${R2.__eval('curQ')}）`);

  // 1問ずつ時代に保存された cq_p3（連続した ans・scores 同梱）もそのまま復元できる（§E-1）
  const OLD = load(TARGET, '');
  const oldAns = [3,-2,1,-1,2,3,-3];
  OLD.__eval(`localStorage.setItem('cq_p3',JSON.stringify({curQ:7,scores:{1:99,2:99,3:99,4:99},ans:${JSON.stringify(oldAns)},selectedIndustries:[]}))`);
  boot(OLD);
  OLD.continueDiag();
  const want = { 1: 0, 2: 0, 3: 0, 4: 0 };
  oldAns.forEach((v, i) => { want[OLD.__eval(`qAt(${i}).ax`)] += v; });
  check(OLD.__eval('curQ') === 7 && OLD.__eval('JSON.stringify(scores)') === JSON.stringify(want),
    `旧データは ans[] から組み立て直される（保存された壊れた scores を採用しない）: ${OLD.__eval('JSON.stringify(scores)')}`);
  check(OLD.__eval('curPage') === 1, '7問答えた人は2ページ目（最初の未完了ページ）へ');

  // 旧キーは黙って捨てる。
  //   cq_p  … 旧出題順の ans（復元すると別の設問の回答になる）
  //   cq_p2 … 5段階（±2）で採点した ans / scores（6段階とは重みが違う）
  for (const [key, why] of [['cq_p', '旧出題順'], ['cq_p2', '旧5段階スケール']]) {
    const L = load(TARGET, '');
    L.__eval(`localStorage.setItem('${key}',JSON.stringify({curQ:7,scores:{1:5,2:5,3:5,4:5},ans:[2,2,2,2,2,2,2],selectedIndustries:[]}))`);
    boot(L);
    check(L.__eval(`localStorage.getItem('${key}')`) === null,
      `旧キー ${key}（${why}）は起動時に削除される`);
    check(L.__byId.get('cont-banner').style.display !== 'flex',
      `${key} のデータでは .cont-banner を出さない`);
    check(L.__eval('curQ') === 0 && L.__eval('JSON.stringify(scores)') === JSON.stringify({ 1: 0, 2: 0, 3: 0, 4: 0 }),
      `${key} のデータがあっても診断は1問目・スコア0から始まる`);
  }
}

// ---- (8) 「戻る」は1ページ戻る。LPの1問戻る（.lq-back）は廃止（§B-4）----
console.log('[test] 戻るの意味（1問 → 1ページ）');
{
  const T = load(TARGET, '');
  boot(T);
  check(T.__byId.get('lq-back') == null, 'LPの「1つ前の質問に戻る」は存在しない（5問同時表示なので選び直しで足りる）');

  T.startFresh('test');
  T.goBack();
  check(T.__eval('curPage') === 0, '1ページ目で goBack() を呼んでも何も起きない');

  // 3ページ目まで進んでから2回戻る
  for (let p = 0; p < 3; p++) {
    T.__eval(`pagePositions(${p})`).forEach(pos => answerQuiz(T, pos, p + 1));
    T.nextPage();
  }
  check(T.__eval('curPage') === 3, '3回進んで4ページ目');
  const before = T.__eval('JSON.stringify(scores)');
  T.goBack(); T.goBack();
  check(T.__eval('curPage') === 1, `2回戻って2ページ目（${T.__eval('curPage')}）`);
  check(T.__eval('JSON.stringify(scores)') === before,
    `ページを戻っても回答は取り消されない: ${T.__eval('JSON.stringify(scores)')}`);
  check(T.__positions('q').join(',') === '5,6,7,8,9', '2ページ目の出題位置に戻っている');
  check(T.document.querySelectorAll('#q-list .sdw.sel').length === 5, '5問とも選択済みのまま');
}

console.log(ng === 0 ? '\n[test] PASS' : `\n[test] FAIL: ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
