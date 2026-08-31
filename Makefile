# 就活キャリアタイプ診断 — 検証タスク
#
# このプロジェクトは「CSS/JSインラインの単一HTML」の静的サイトで、
# ビルド工程も外部ライブラリも持たない（それ自体が仕様上の制約）。
# そのため npm / パッケージマネージャは導入せず、Node と Chrome だけで検証する。
#
#   make check   … lint + typecheck + test + e2e（完了前に必ず通すもの）
#   make lint    … 構成・レイアウト・法務まわりの静的チェック
#   make type    … インラインJSの構文と、on* から呼ばれる関数の解決
#   make test    … 診断ロジックの回帰（16タイプ + golden 200パターン）
#   make e2e     … 実ブラウザでの結合テスト（20問通し × 16タイプ）
#   make serve   … 動作確認用のローカルサーバ
#   make shot    … 実機幅（390/320）のスクリーンショットと寸法計測 → /tmp/shots
#   make heads   … キャラ画像の頭頂位置を実測し、object-position 用のCSSを出力
#   make ogp     … og:image（1200x630）の再生成
#
# 必要なもの: node（18以上）/ Google Chrome / python3（serve のみ）

SHELL := /bin/bash
NODE  := node
CHROME := /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

.PHONY: check lint type typecheck test e2e serve shot heads ogp golden help

check: lint typecheck test e2e
	@echo ""
	@echo "======================================"
	@echo " すべての検証を通過しました"
	@echo "======================================"

lint:
	@echo "── lint ──────────────────────────────"
	@$(NODE) tools/lint.mjs

# gate は typecheck 名で呼ぶ。type は手打ち用の別名。
typecheck:
	@echo "── typecheck ─────────────────────────"
	@$(NODE) tools/typecheck.mjs

type: typecheck

test:
	@echo "── test（診断ロジックの回帰）──────────"
	@$(NODE) tools/test-diagnosis.mjs

e2e:
	@echo "── e2e（実ブラウザ）──────────────────"
	@$(NODE) tools/e2e.mjs

# 診断ロジックを意図的に変えたときだけ実行する。理由をコミットメッセージに書くこと。
golden:
	@$(NODE) tools/test-diagnosis.mjs --update-golden

serve:
	@echo "http://127.0.0.1:8765/ で配信します（Ctrl-C で停止）"
	@python3 -m http.server 8765

# 実機幅の見た目を確かめる。macOS のヘッドレスChromeは --window-size を
# 最小約500pxにクランプするので、必ず Emulation.setDeviceMetricsOverride を
# 使う tools/cdp.mjs 経由で撮る（--window-size だけでは320px幅を再現できない）。
shot:
	@echo "── shot（実機幅のスクリーンショットと寸法）──"
	@$(NODE) tools/shot.mjs

# キャラ画像を差し替えたら必ず実行する。頭頂の位置（--head）を実測し、
# .tc / .cc の object-position 用のCSSブロックを出力する。
# index.html は書き換えないので、出力を見て手で反映すること。
heads:
	@echo "── heads（キャラ画像の頭頂位置の実測）──"
	@$(NODE) tools/measure-heads.mjs

ogp:
	@"$(CHROME)" --headless=new --disable-gpu --hide-scrollbars \
	  --force-device-scale-factor=1 --allow-file-access-from-files \
	  --window-size=1200,630 --virtual-time-budget=4000 \
	  --screenshot=images/ogp/default.png images/ogp/_default.source.html
	@echo "images/ogp/default.png を再生成しました"

help:
	@grep -E '^#   make' Makefile | sed 's/^#   //'
