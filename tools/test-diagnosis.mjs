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

// 20問を実際に1問ずつ回答する。pick() の setTimeout はテスト側で手動で流す。
//
// ★ values は「Qs の添字」で並んでいる（values[k] を Qs[k] に与える）。
//    Q_ORDER 導入後は出題順と Qs の添字が一致しないため、出題位置 p では
//    values[Q_ORDER[p]] を答える。こうすると「設問と値の対応」が改修前と同一になり、
//    golden（20値の並び → コード・サブコード・4軸スコア）が1文字も変わらないことが
//    「出題順を変えても採点結果は不変」の証明になる。golden 側は一切書き換えない。
function answer(S, values) {
  S.startFresh('test');
  const order = S.__eval('Q_ORDER');
  for (let p = 0; p < order.length; p++) {
    const v = values[order[p]];
    const el = S.__sdws.find(d => Number(d.dataset.v) === v);
    S.pick(el);
    S.__timers.splice(0).forEach(fn => fn());
  }
  return { code: S.getCode(), sub: S.getSubCode(), scores: JSON.stringify(S.__eval('scores')) };
}

// LP埋め込み（#lq-spec-track）側で1問答える
function answerLp(S, v) {
  S.pick(S.__lpSdws.find(d => Number(d.dataset.v) === v));
  S.__timers.splice(0).forEach(fn => fn());
}
// DOMContentLoaded を流す（load() 直後は登録されただけで走っていない）
function boot(S) { S.__timers.splice(0).forEach(fn => fn()); }

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
  const vals = T.__lpSdws.map(d => Number(d.dataset.v));
  check(vals.join(',') === '3,2,1,-1,-2,-3', `目盛は6つで値は +3/+2/+1/-1/-2/-3: ${vals.join(',')}`);
  check(!vals.includes(0), '中央値（0）が存在しない＝「どちらでもない」を選べない');

  // 6つの値すべてを1問ずつ使い、加算結果が値そのものと一致するか
  for (const v of vals) {
    const U = load(TARGET, '');
    boot(U);
    answerLp(U, v);
    const ax = U.__eval('qAt(0).ax');
    check(U.__eval(`scores[${ax}]`) === v && U.__eval('ans[0]') === v,
      `${v >= 0 ? '+' : ''}${v} を選ぶと軸${ax}に ${v} が加算される（scores=${U.__eval(`scores[${ax}]`)}）`);
  }

  // 1問戻すと、6段階のどの値でも正しく打ち消される
  const B = load(TARGET, '');
  boot(B);
  answerLp(B, -3);
  B.goBack();
  check(B.__eval('JSON.stringify(scores)') === JSON.stringify({ 1: 0, 2: 0, 3: 0, 4: 0 }),
    `-3 を戻すとスコアが元に戻る: ${B.__eval('JSON.stringify(scores)')}`);
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

// ---- (6) LP埋め込み質問（設計A）----
console.log('[test] LP埋め込み質問（設計A）');
{
  const T = load(TARGET, '');
  boot(T);
  check(T.__eval('qTarget') === 'lp', '起動直後の描画先は LP（#lp-quiz）');
  check(T.__byId.get('lq-num').textContent === 'Q1', 'LPに1問目が描画されている');
  check(T.__byId.get('lq-text').textContent.length > 0, 'LPの質問文が入っている');

  // 出題位置 0..4 = Qs[0](軸1) / Qs[5](軸2) / Qs[10](軸3) / Qs[15](軸4) / Qs[1](軸1)
  [2, 1, 2, -1, 1].forEach(v => answerLp(T, v));

  check(T.__eval('curQ') === 5, `5問回答して curQ=5（${T.__eval('curQ')}）`);
  check(!T.__byId.get('screen-quiz').classList.contains('active'),
    '5問目の回答で #screen-quiz へ自動遷移しない（§A-5）');
  check(T.__byId.get('lq-done').classList.contains('on'), '.lq-done に差し替わる');
  const sc = T.__eval('JSON.stringify(scores)');
  check(sc === JSON.stringify({ 1: 3, 2: 1, 3: 2, 4: -1 }),
    `5問ぶんが4軸に正しく加算されている: ${sc}`);
  check(T.__byId.get('cta-hero').textContent === '残り15問を続ける →',
    `ヒーローCTAの文言が残数と一致: ${T.__byId.get('cta-hero').textContent}`);

  T.lqContinue();
  check(T.__byId.get('screen-quiz').classList.contains('active'), '#lq-continue で質問画面へ進む');
  check(T.__byId.get('prog-text').textContent === 'Q6 / 20',
    `質問画面は Q6 から始まる: ${T.__byId.get('prog-text').textContent}`);
  check(T.__eval('JSON.stringify(scores)') === sc, '続行してもスコアが保持されている');
  check(T.__eval('qTarget') === 'quiz', '描画先が quiz に切り替わる');
}

// LPで3問だけ答えてヒーローCTAを押しても回答が消えないこと（§A-5 の中核）
console.log('[test] 既存CTAの付け替え（continueOrStart）');
{
  const T = load(TARGET, '');
  boot(T);
  [2, 2, 2].forEach(v => answerLp(T, v));
  const before = T.__eval('JSON.stringify(scores)');
  T.continueOrStart('hero');
  check(T.__eval('curQ') === 3, `ヒーローCTAで curQ が 0 に戻らない（${T.__eval('curQ')}）`);
  check(T.__eval('JSON.stringify(scores)') === before, `回答が消えない: ${before}`);
  check(!T.__byId.get('screen-quiz').classList.contains('active'),
    'curQ < LP_Q_COUNT なので質問画面へは飛ばさない');
  check(T.__byId.get('lq-num').textContent === 'Q4', '#lp-quiz の4問目に戻る');
  check(T.__byId.get('cta-hero').textContent === '残り17問を続ける →',
    `CTA文言が実際の残数と一致: ${T.__byId.get('cta-hero').textContent}`);

  // 16タイプ節・ドロワーからも同じこと
  T.continueOrStart('grid');
  T.continueOrStart('drawer');
  check(T.__eval('curQ') === 3 && T.__eval('JSON.stringify(scores)') === before,
    '16タイプ節CTA / ドロワーCTA でも回答が保持される');

  // 5問を超えていれば質問画面へ
  T.__eval('curQ=8');
  T.continueOrStart('hero');
  check(T.__byId.get('screen-quiz').classList.contains('active') &&
    T.__byId.get('prog-text').textContent === 'Q9 / 20',
    `curQ >= LP_Q_COUNT なら質問画面の続きから: ${T.__byId.get('prog-text').textContent}`);

  // 1問も答えていない人は従来どおり（§A-5）
  const F = load(TARGET, '');
  boot(F);
  F.continueOrStart('hero');
  check(F.__byId.get('screen-quiz').classList.contains('active') && F.__eval('curQ') === 0,
    '未回答なら従来どおり質問画面を1問目から開く');
}

// ---- (7) 途中復帰と保存キー ----
console.log('[test] 途中復帰と保存キー（A-2 / A-6）');
{
  const T = load(TARGET, '');
  boot(T);
  answerLp(T, 2); answerLp(T, 2);
  const saved = T.__eval("localStorage.getItem('cq_p3')");
  check(typeof saved === 'string' && saved.length > 0, `保存キーは cq_p3（${saved}）`);
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
    'LPで2問だけの人を #screen-quiz に飛ばさない（§A-6）');
  check(R.__byId.get('screen-title').classList.contains('active'), 'LPのまま復帰する');
  check(R.__byId.get('lq-num').textContent === 'Q2',
    `#lp-quiz に復帰する（保存は加算前 curQ ＝既存仕様）: ${R.__byId.get('lq-num').textContent}`);

  // 5問を超えた保存は質問画面へ
  const R2 = load(TARGET, '');
  R2.__eval(`localStorage.setItem('cq_p3',JSON.stringify({curQ:8,scores:{1:2,2:0,3:0,4:0},ans:[],selectedIndustries:[]}))`);
  boot(R2);
  R2.continueDiag();
  check(R2.__byId.get('screen-quiz').classList.contains('active') &&
    R2.__byId.get('prog-text').textContent === 'Q9 / 20',
    `8問ぶん進んだ人は #screen-quiz の9問目に復帰する: ${R2.__byId.get('prog-text').textContent}`);

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

// ---- (8) 1問戻る（LP側）----
console.log('[test] LPの1問戻る（.lq-back）');
{
  const T = load(TARGET, '');
  boot(T);
  answerLp(T, 2); answerLp(T, 1);
  const mid = T.__eval('JSON.stringify(scores)');
  T.goBack();
  check(T.__eval('curQ') === 1, '1問戻って curQ=1');
  check(T.__eval('JSON.stringify(scores)') === JSON.stringify({ 1: 2, 2: 0, 3: 0, 4: 0 }),
    `戻した1問ぶんのスコアが取り消される（戻す前: ${mid} → 戻した後: ${T.__eval('JSON.stringify(scores)')}）`);
  check(T.__byId.get('lq-num').textContent === 'Q2', 'LPのカードが2問目に戻る');
}

console.log(ng === 0 ? '\n[test] PASS' : `\n[test] FAIL: ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
