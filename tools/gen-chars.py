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

def ink_span(im):
    """インクの2%〜98%が入る縦の範囲を返す。＝「量として見える高さ」。
    ★これまで試して外した基準（すべて姿勢と髪に引きずられた）:
        外形の高さ … 髪の先が細く上へ伸びる体（c4）が「いちばん高い」と出る
        顎から足   … しゃがんだ体（c4）が「いちばん短い」と出る
        面積       … 髪の量が多い体が「大きい」と出る
      いずれも c4 のめり込みビルダーで破綻した。
    ★上下2%を切ると、細い突起はインク量が少ないので効かなくなる。
      残るのは「絵の塊がどこからどこまであるか」で、これが目に入る高さである。
    ★画面を撮って測る方法も試したが、背後に敷いた大きな系統名（.cat-ghost）を
      拾ってしまい、文字と重なる体だけ大きく測れた。**画面の測定は背景に汚される。**
      素材だけを見るこの方法なら、周りに何が置かれても影響を受けない。
    """
    W, H = im.size
    a = im.split()[3].load()
    rows = [sum(1 for x in range(0, W, 2) if a[x, y] > 128) for y in range(H)]
    tot = sum(rows)
    if not tot:
        return 1
    acc = 0
    top = bot = 0
    for y in range(H):
        acc += rows[y]
        if not top and acc >= tot * 0.02:
            top = y
        if acc <= tot * 0.98:
            bot = y
    return max(1, bot - top + 1)


def body_ratio(im):
    """顎から足までの高さ ÷ 全高 を返す（尺度に依らない値）。
    ★これが「その人がどれだけ大きく見えるか」を決める。
      全高で揃えても、髪が大きい体は胴体が小さくなり「小さい人」に見える。
      実測（全高を451で揃えた状態）: 胴体は 122〜208px = 1.70倍ばらついていた。
      緑の群（髪が大きい）が赤・黄より小さく見えるという指摘の正体がこれ。
    首の見つけ方: 肌色がいちばん広い行を顔とし、そこから下へ辿って
      幅が35%を切った最初の行を顎とする。顔は広く首は細いので切れる。
      ★「上から最初の肌の帯の終わり」では駄目だった。顔の下にある手や腕の肌が
        繋がって、腰や足まで下がる（16体中7体で外した）。"""
    m = im.resize((240, max(1, round(240 * im.size[1] / im.size[0]))), Image.LANCZOS)
    W, H = m.size
    px = m.load()
    any_ = [0] * H
    sk = [0] * H
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 16:
                any_[y] += 1
            if a > 128 and r > 200 and g > 170 and b > 130 and r > g > b and 30 < (r - b) < 115:
                sk[y] += 1
    top = next((y for y in range(H) if any_[y] > 0), 0)
    bot = next((y for y in range(H - 1, -1, -1) if any_[y] > 0), H - 1)
    fig = bot - top + 1
    lim = top + int(fig * 0.60)
    faceY = max(range(top, lim + 1), key=lambda y: sk[y])
    if sk[faceY] < 4:
        return None                       # 顔を見つけられない。手当てをやめる（1.0 扱い）
    chin = next((y for y in range(faceY, bot + 1) if sk[y] < sk[faceY] * 0.35), faceY)
    return (bot - chin) / fig


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

    NORMALIZE = 0.0     # （旧）0 = 背丈で揃える / 1 = 頭で揃える。いまは使わない

    # ★ここから先は目で合わせる。
    #   外形（bbox）を揃えても見た目は揃わない。同じ外形でも、しゃがんだ体
    #   （c4 のめり込みビルダー）や跳んだ体（a4 熱血プレイヤー）は、立った体より
    #   身体そのものが小さく写る。これは素材の描かれ方の差であって、
    #   計算で求まる量ではない。だから1体ずつ手で当てる。
    #   ★数値を変えたら make chars を回し、ASSET_V を更新すること。
    #     1.0 が基準。大きくすると拡大、小さくすると縮小。
    #   ★2026-09-09。手で当てるのをやめ、測って決めるようにした。
    #     胴体（顎から足）の比率から倍率を出す。根拠は下記。
    #     16体ぶん計算した値と、それまで目で合わせてあった値を突き合わせると
    #     **14体が誤差9%以内で一致した**:
    #         a4 熱血プレイヤー     目 1.20 / 計算 1.228
    #         c4 のめり込みビルダー 目 1.42 / 計算 1.336
    #         d4 コツコツマイスター 目 1.10 / 計算 1.063
    #     つまりオーナーが目で合わせていたのは「胴体の大きさ」だった。
    #     ずれた2体は、どちらも素材が変わったところである:
    #         a2 あったかリーダー   目 1.16 / 計算 0.982（描き直しで胴が伸びた）
    #         b3 黒子のプロデューサー 目 1.00 / 計算 1.126（髪が大きく胴が小さい）
    #     b3 が「緑の群だけ小さく見える」と指摘された当人である。
    #   ★半分だけ当てる（指数 0.5）。全部当てると跳んだ体（a4）や
    #     しゃがんだ体（c4）が枠からはみ出すほど大きくなる。
    #   ★手当てが要るときは MANUAL_EXTRA に書く。空でよい。
    #   （以下は 2026-09-09 以前の記録。目で当てていた頃の値と経緯）
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
    BODY_BLEND = 1.0          # 0 = 当てない（全高で揃える）/ 1 = 面積で完全に揃える
    # ★画面に描かれた「見た目の高さ」を測って当てた値（2026-09-10）。
    #   素材から計算する量（全高・顎から足・面積）は、どれも姿勢と髪に
    #   引きずられて c4 / a2 / a4 を正しく扱えなかった。
    #     c4 のめり込みビルダー … 全高では16体中いちばん高いのに、画面では最小。
    #                            髪の先が細く上へ伸びており、量として見えない。
    #     a2 / a4               … 同様に髪と姿勢で外形が膨らむ。
    #   ★測る対象を「素材の中の量」から「画面に出た高さ」に変えた。
    #     揃えたいのは画面の見え方なので、画面を測るのが最短である。
    #   測り方: 16体を実際に描画して撮影し、帯の地色と違う画素が
    #           一定数ある行の範囲を1体ずつ数える（tools の外・手作業）。
    #           細い突起を拾わないよう「その行に6画素以上」を条件にしている。
    # ★ページに描かれた高さを測って当てた値（2026-09-10）。
    #   素材側の指標（外形・胴体・面積・インク範囲）は、縮小してもすべて
    #   「16体は揃っている」と出る。PIL で表示寸法まで縮めても同じ。
    #   ところが Chrome が実際に縮小すると、**細い突起が消える**。
    #   その3体だけ画面で小さく見える（実測 a2 324 / a4 339 / c4 291 対 他451）。
    #   ★Chrome の縮小フィルタは PIL で再現できない。だから素材側では捕まえられない。
    #     揃えたいのは画面の見え方なので、ページを撮って測った値をここに書く。
    #   測り方: 背後の系統名を消して16体を撮影し、各札の枠の中で
    #           地色と60以上違う画素が4列以上ある行の範囲を数える。
    #           4列（＝幅の2%）未満は、目には量として入らない。
    MANUAL_EXTRA = {
        "a1":0.99, "a2":1.39, "a3":1.00, "a4":1.33,
        "b1":0.99, "b2":1.00, "b3":1.00, "b4":1.00,
        "c1":1.00, "c2":1.00, "c3":0.98, "c4":1.55,
        "d1":1.01, "d2":1.00, "d3":1.02, "d4":1.01,
    }

    # ★倍率は metric（＝揃えたい量）で決まる。s = target / metric。
    #   最初 metric に外形の高さを置いたまま MANUAL でインク範囲を掛けたが、
    #   それでは rendered span ∝ 1/高さ になって逆に効いた（実測 1.27倍のまま）。
    #   揃えたいのはインク範囲そのものなので、metric をインク範囲に差し替える。
    sp = {k: ink_span(im) for k, (im, _) in figs.items()}
    metric = {k: sp[k] for k in figs}
    MANUAL = {k: MANUAL_EXTRA.get(k, 1.0) for k in figs}
    print("  インクの range: " + " ".join(f"{k}{sp[k]}" for k in sorted(sp)))
    br = {k: body_ratio(im) for k, (im, _) in figs.items()}   # 記録用（scale.json）
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
                               "h": round(im.size[1] * s, 1),
                               # 胴体（顎から足）。見た目の大きさはこれで決まる。
                               "body": round(im.size[1] * s * (br[key] or 0), 1)}
    hs = [v["head"] for v in report.values()]
    ht = [v["h"] for v in report.values()]
    print(f"16体を変換した（{FRAMES[0][0]}x{FRAMES[0][1]} と {FRAMES[1][0]}x{FRAMES[1][1]}）")
    print(f"  正規化 NORMALIZE={NORMALIZE}（0=背丈 / 1=頭）")
    bd = [v["body"] for v in report.values()]
    print(f"  背丈のばらつき : {max(ht)/min(ht):.2f}倍  ← 枠に収めるための値")
    print(f"  胴体のばらつき : {max(bd)/min(bd):.2f}倍  ← ★見た目の大きさ。これを縮める")
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
