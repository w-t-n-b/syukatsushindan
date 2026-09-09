# 紙細工キャラクター（16体）をサイトの素材に変換する。
# ============================================================================
# なぜ「そのまま縮小」では駄目か
# ----------------------------------------------------------------------------
#   素材は1体ずつ別々に生成されており、頭身が揃っていない。
#   実測（bbox を枠に収める従来の方法）:
#       実体の高さ … 90〜100%（ほぼ揃う）
#       頭の幅     … 2.07倍のばらつき
#   高さで揃えると、頭が小さく描かれた体（a1 オンオフのエース /
#   c4 のめり込みビルダー）だけ「小さい人」に見える。
#   逆に頭で揃えると、その2体が他より 1.5倍の背丈になって収まらない。
#
#   3案（A 背丈で揃える / B 中間 / C 頭で揃える）を並べて比べた。
#   ★オーナーの判断は A（背丈で揃える）。一覧では16枚が同じ高さに並ぶほうが
#     整列して見え、ヒーローの並びも自然になる。
#     頭の大きさは 2.13倍ばらつくが、絵柄の個性として許容する。
#   ★このばらつきは素材そのものの頭身差であり、変換では消せない。
#     完全に揃えるなら描き直しが要る。
#     方針を変えるときは下の NORMALIZE を触る（0=背丈 / 0.5=中間 / 1=頭）。
#
# 使い方: python3 tools/gen-chars.py <元画像のフォルダ>
#   出力: images/chars/*.webp（480x640）と images/chars/sm/*.webp（320x427）
# ============================================================================
from PIL import Image
import os, sys, statistics, math, unicodedata, json, hashlib

NAME2IMG = {
 "オンオフのエース":"a1","あったかリーダー":"a2","全力キャプテン":"a3","熱血プレイヤー":"a4",
 "ナチュラルケアリスト":"b1","ほっこりサポーター":"b2","黒子のプロデューサー":"b3","まっすぐガーディアン":"b4",
 "ひらめきクリエイター":"c1","じっくりクラフター":"c2","突き抜けパイオニア":"c3","のめり込みビルダー":"c4",
 "冷静なブレイン":"d1","きっちり参謀":"d2","鉄壁コントローラー":"d3","コツコツマイスター":"d4"}

WHITE = 242          # これ以上明るい画素を背景とみなして透過にする
FRAMES = [(480, 640, "images/chars"), (320, 427, "images/chars/sm")]   # 3:4

def load(path):
    im = Image.open(path).convert("RGBA")
    im.putdata([(r, g, b, 0) if (r > WHITE and g > WHITE and b > WHITE) else (r, g, b, a)
                for r, g, b, a in im.getdata()])
    return im.crop(im.getbbox())

def head_width(im):
    """各行の「最も長い連続した不透明の区間」を取り、上部30%の中央値を頭幅とする。
       髪は頭と地続きなので入る。離れて上がった腕は別の区間になるので入らない。"""
    W, H = im.size
    a = im.split()[3].load()
    runs = []
    for y in range(0, max(1, int(H * 0.30))):
        best = cur = 0
        for x in range(W):
            if a[x, y] > 128:
                cur += 1
                best = max(best, cur)
            else:
                cur = 0
        if best > 4:
            runs.append(best)
    return statistics.median(runs) if runs else 1

def main(*src_dirs):
    """★フォルダは複数渡せる。後のフォルダが前を上書きする（後勝ち）。
       一部だけ描き直した素材が届くのは今後も起きるので、
       「16体そろったフォルダ ＋ 差し替えぶんのフォルダ」で呼べるようにした。
       ★8体だけで走らせてはいけない。倍率は16体の中央値から決まるので、
         残り8体と大きさが揃わなくなる（下の len(figs)!=16 で止まる）。"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    picked = {}                       # key -> ファイルの絶対パス（後勝ち）
    for d in src_dirs:
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(".png"):
                continue
            key = NAME2IMG.get(unicodedata.normalize("NFC", os.path.splitext(fn)[0]))
            if not key:
                print(f"  対応するタイプが無い: {fn}")
                continue
            if key in picked:
                print(f"  差し替え {key}: {os.path.basename(os.path.dirname(picked[key]))} → {os.path.basename(d)}")
            picked[key] = os.path.join(d, fn)
    figs = {}
    for key, path in picked.items():
        im = load(path)
        figs[key] = (im, head_width(im))
    if len(figs) != 16:
        raise SystemExit(f"16体そろっていない（{len(figs)}体）")

    NORMALIZE = 0.0     # 0 = 背丈で揃える / 0.5 = 中間 / 1 = 頭で揃える
    metric = {k: (h ** NORMALIZE) * (im.size[1] ** (1 - NORMALIZE))
              for k, (im, h) in figs.items()}

    # ★ここから先は目で合わせる。
    #   外形（bbox）を揃えても見た目は揃わない。同じ外形でも、しゃがんだ体
    #   （c4 のめり込みビルダー）や跳んだ体（a4 熱血プレイヤー）は、立った体より
    #   身体そのものが小さく写る。これは素材の描かれ方の差であって、
    #   計算で求まる量ではない。だから1体ずつ手で当てる。
    #   ★数値を変えたら make chars を回し、ASSET_V を更新すること。
    #     1.0 が基準。大きくすると拡大、小さくすると縮小。
    #   ★a群・b群（赤・緑）は 2026-09-09 に全部 1.00 へ戻した。
    #     オーナーが素材そのものの等身を描き直したためである。
    #     旧版と新版の頭身（背丈 ÷ 頭幅）を実測すると、8体とも頭が大きくなっていた:
    #         a1 オンオフのエース   3.09 → 2.59
    #         a2 あったかリーダー   2.43 → 1.96
    #         b3 黒子のプロデューサー 1.59 → 1.54
    #     このファイルの冒頭に「頭が小さく描かれた体（a1 / c4）だけ小さい人に見える」
    #     と書いてあるが、その a1 が名指しで直っている。
    #   ★MANUAL は「旧版の絵に対して目で合わせた値」である。
    #     見た目がずれる原因そのものが直ったので、当てると二重に効く。
    #     実測（新素材で両方作って比べた）:
    #         据え置き … a群の背丈 451 / 523 / 433 / 541（見てわかるほど不揃い）
    #         1.00へ  … a群の背丈 451 / 451 / 451 / 451
    #     b群も 478/478/451/460 → 451×4 に揃った。
    #   ★c群・d群は素材が変わっていないので触らない。c4 の 1.42 は
    #     しゃがんだ姿勢を補うための値であり、等身の話とは別である。
    MANUAL = {
        "a1": 1.00, "a2": 1.00, "a3": 1.00, "a4": 1.00,
        "b1": 1.00, "b2": 1.00, "b3": 1.00, "b4": 1.00,
        "c1": 1.00, "c2": 1.00, "c3": 1.02, "c4": 1.42,
        "d1": 1.02, "d2": 1.02, "d3": 1.02, "d4": 1.10,
    }
    metric = {k: v / MANUAL.get(k, 1.0) for k, v in metric.items()}
    target = statistics.median(metric.values())
    # 揃えたあとの最大寸法を求め、そこから全体の倍率を決める（枠にちょうど収まるように）
    sized = {k: (im.size[0] * target / metric[k], im.size[1] * target / metric[k])
             for k, (im, _) in figs.items()}
    mw = max(v[0] for v in sized.values())
    mh = max(v[1] for v in sized.values())

    report = {}
    for W, H, out in FRAMES:
        os.makedirs(os.path.join(root, out), exist_ok=True)
        k0 = min(W / mw, H / mh)                     # 最大の体が枠に収まる倍率
        for key, (im, hd) in figs.items():
            s = (target / metric[key]) * k0
            r = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
            c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            c.paste(r, ((W - r.width) // 2, H - r.height), r)   # 下寄せ（立ち姿を揃える）
            c.save(os.path.join(root, out, key + ".webp"), "WEBP", quality=86, method=6)
            if out.endswith("sm"):
                report[key] = {"scale": round(s, 3), "head": round(hd * s, 1),
                               "h": round(im.size[1] * s, 1)}
    hs = [v["head"] for v in report.values()]
    ht = [v["h"] for v in report.values()]
    print(f"16体を変換した（{FRAMES[0][0]}x{FRAMES[0][1]} と {FRAMES[1][0]}x{FRAMES[1][1]}）")
    print(f"  正規化 NORMALIZE={NORMALIZE}（0=背丈 / 1=頭）")
    print(f"  背丈のばらつき : {max(ht)/min(ht):.2f}倍  ← 揃える対象")
    print(f"  頭幅のばらつき : {max(hs)/min(hs):.2f}倍  ← 素材の頭身差。記録のみ")
    # ★焼いた中身の指紋。index.html の ASSET_V と突き合わせる。
    #   ファイル名（a1.webp …）は変わらないので、中身だけ差し替えると
    #   ブラウザは古い画像を出し続ける。実際にそれで「サイズがばらついて見える」
    #   という報告が上がった（画面の実測は揃っていたのに、見えていたのは旧版）。
    h = hashlib.sha256()
    for key in sorted(figs):
        h.update(open(os.path.join(root, FRAMES[0][2], key + ".webp"), "rb").read())
    ver = h.hexdigest()[:8]
    report["_v"] = ver
    json.dump(report, open(os.path.join(root, "images/chars/scale.json"), "w"), indent=1)
    print(f"  指紋 {ver}  ★index.html の ASSET_V をこの値にすること（make check が突き合わせる）")

# 既定の素材。★後ろほど優先される（後勝ち）。
#   差し替えが届いたらここに1行足す。過去の履歴が残るので、
#   「いまの絵はどのフォルダの組み合わせか」が読めばわかる。
DEFAULT_SRC = [
    "/Users/keiya/Downloads/ChatGPT Image 2026年9月8日 20_10_48 (2)",  # 16体（初回）
    "/Users/keiya/Downloads/緑赤修正",                                  # a群・b群の等身を直したもの
]

if __name__ == "__main__":
    main(*(sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_SRC))
