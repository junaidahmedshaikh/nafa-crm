"""
Template comparison workflow (QA tooling; needs `pip install pymupdf pillow`).

    python scripts/compare_pdfs.py template/NAFA_Quotation_Template.pdf generated/reference-quotation.pdf out/quotation

For the first page of each PDF it
  1. renders both to PNG at the same DPI,
  2. writes a side-by-side image (reference | generated) and a red/cyan overlay,
  3. matches text spans by content and prints the x/y offset of each (in PDF points), plus
     spans that exist in only one document.
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
import pymupdf
from PIL import Image, ImageChops

DPI = 150


def spans(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                t = s["text"].strip()
                if t:
                    out.append((t, s["bbox"], s["size"], s["font"]))
    return out


def main(ref_path, gen_path, out_prefix):
    os.makedirs(os.path.dirname(out_prefix) or ".", exist_ok=True)
    ref, gen = pymupdf.open(ref_path), pymupdf.open(gen_path)
    print(f"pages: reference={len(ref)} generated={len(gen)}")
    rp, gp = ref[0], gen[0]
    print(f"page size: reference={rp.rect.width:.1f}x{rp.rect.height:.1f} generated={gp.rect.width:.1f}x{gp.rect.height:.1f}")
    ri, gi = f"{out_prefix}_ref.png", f"{out_prefix}_gen.png"
    rp.get_pixmap(dpi=DPI).save(ri)
    gp.get_pixmap(dpi=DPI).save(gi)
    a, b = Image.open(ri).convert("RGB"), Image.open(gi).convert("RGB")
    side = Image.new("RGB", (a.width + b.width + 20, max(a.height, b.height)), "#888")
    side.paste(a, (0, 0)); side.paste(b, (a.width + 20, 0))
    side.save(f"{out_prefix}_side.png")
    # overlay: reference ink in red, generated ink in cyan, agreement in black
    ga, gb = a.convert("L"), b.convert("L")
    if ga.size != gb.size:
        gb = gb.resize(ga.size)
    inv = lambda im: ImageChops.invert(im).point(lambda v: 255 if v > 40 else 0)
    ra, rb = inv(ga), inv(gb)
    overlay = Image.merge("RGB", (ImageChops.invert(rb), ImageChops.invert(ra), ImageChops.invert(ra)))
    # red = only in reference, cyan = only in generated
    ov = Image.new("RGB", ga.size, "white")
    px, pa, pb = ov.load(), ra.load(), rb.load()
    for y in range(ga.size[1]):
        for x in range(ga.size[0]):
            r, g = pa[x, y], pb[x, y]
            if r and g: px[x, y] = (0, 0, 0)
            elif r: px[x, y] = (230, 30, 30)
            elif g: px[x, y] = (30, 170, 230)
    ov.save(f"{out_prefix}_overlay.png")

    rs, gs = spans(rp), spans(gp)
    used = set()
    print(f"\n{'text':44} {'dx':>6} {'dy':>6} {'dsize':>6} {'dwidth':>7}  (pt; generated minus reference)")
    worst = 0.0
    for t, bb, size, font in rs:
        cand = [(i, g) for i, g in enumerate(gs) if g[0] == t and i not in used]
        if not cand:
            continue
        i, g = min(cand, key=lambda c: abs(c[1][1][1] - bb[1]) + abs(c[1][1][0] - bb[0]))
        used.add(i)
        dx, dy = g[1][0] - bb[0], g[1][1] - bb[1]
        worst = max(worst, abs(dx), abs(dy))
        flag = "  <<" if max(abs(dx), abs(dy)) > 2.0 else ""
        dw = (g[1][2] - g[1][0]) - (bb[2] - bb[0])
        print(f"{t[:44]:44} {dx:6.1f} {dy:6.1f} {g[2] - size:6.1f} {dw:7.1f}{flag}")
    print(f"\nlargest matched offset: {worst:.1f} pt")
    miss_r = [t for t, *_ in rs if not any(g[0] == t for g in gs)]
    miss_g = [g[0] for i, g in enumerate(gs) if i not in used]
    print("\nreference text not found in generated:", miss_r)
    print("generated text not in reference:", miss_g)


if __name__ == "__main__":
    main(*sys.argv[1:4])
