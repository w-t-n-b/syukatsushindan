# diagnosis-fingerprint.txt

`index.html` の診断ロジック（4軸スペクトラム・16タイプ判定）が変わっていないことを
機械的に保証するための基準データ。

- **採取元**: 送客ファネル（`docs/specs/agent-referral-funnel.md`）実装**前**の `index.html`
- **中身**: 擬似ランダムな20問の回答列 200件 × `getCode()` / `getSubCode()` / 4軸スコア
- **乱数**: 固定シード（20260829）の線形合同法。環境に依存せず毎回同じ列になる

`make test` はこのファイルと現在の `index.html` の挙動を突き合わせる。
1行でも違えば、診断ロジックに手が入ったということ。

## 更新してよいとき

診断ロジックを**意図的に**変えたときだけ。

```
node tools/test-diagnosis.mjs --update-golden
```

更新したら、何をなぜ変えたのかをコミットメッセージに必ず書くこと。
「テストが落ちたから golden を更新した」は禁止。実装側を直すこと。
