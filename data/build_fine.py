"""Construit la grille fine (≈ 25 m) du biotope : type de couvert, altitude, exposition.

Sources : BD Forêt V2 (IGN) en priorité, complétée par OpenStreetMap (forêts, garrigue, prairies),
relief Terrarium (~15 m). Produit ../biotope.js (métadonnées, villages, image encodée).
Image RGB : R = couvert (bits 0-3), forêt ouverte (bit 4), position topo (bits 5-6), dans la zone (bit 7) ;
G = altitude / 5 ; B = ubac (bits 4-7) et direction de la pente (bits 0-3).
    python3 fetch_fine.py && python3 build_fine.py
"""
import base64, glob, io, json, math, os, time
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
AIX = (43.5297, 5.4474)
RADIUS_KM = 25
S, W, N, E = 43.30, 5.13, 43.76, 5.77
ROWS, COLS = 2048, 2048   # ≈ 25 m x 25 m
DLAT, DLON = (N - S) / ROWS, (E - W) / COLS

# Classes de couvert (4 bits). Doit correspondre à COVER dans model.js.
PIN, AUTRE_CONIF, CHENE, CHENE_VERT, HETRE, CHATAIGNIER, FEUILLUS = 1, 3, 4, 5, 6, 7, 8
MIXTE_C, MIXTE_F, LANDE, PRAIRIE, PEUPLERAIE, SANS_COUVERT, BOIS_OSM = 9, 10, 11, 12, 13, 14, 15


# ---------- rasterisation pair/impair vectorisée, limitée à l'emprise du polygone ----------
def raster_rings(rings):
    """rings : liste d'anneaux [(lon, lat), ...]. Renvoie (r0, c0, masque) ou None."""
    xs = [(np.asarray(r)[:, 0] - W) / DLON for r in rings if len(r) >= 4]
    ys = [(N - np.asarray(r)[:, 1]) / DLAT for r in rings if len(r) >= 4]
    if not xs:
        return None
    allx, ally = np.concatenate(xs), np.concatenate(ys)
    c0, c1 = max(0, int(math.floor(allx.min()))), min(COLS, int(math.ceil(allx.max())) + 1)
    r0, r1 = max(0, int(math.floor(ally.min()))), min(ROWS, int(math.ceil(ally.max())) + 1)
    if c1 <= c0 or r1 <= r0:
        return None
    h, w = r1 - r0, c1 - c0
    tog = np.zeros((h, w + 1), dtype=np.int32)
    for x, y in zip(xs, ys):
        xa, ya, xb, yb = x[:-1], y[:-1] - r0, x[1:], y[1:] - r0
        lo, hi = np.minimum(ya, yb), np.maximum(ya, yb)
        rs = np.maximum(0, np.ceil(lo - 0.5)).astype(np.int64)
        re = np.minimum(h - 1, np.ceil(hi - 0.5).astype(np.int64) - 1)
        cnt = np.maximum(0, re - rs + 1)
        tot = int(cnt.sum())
        if tot == 0:
            continue
        ei = np.repeat(np.arange(len(cnt)), cnt)
        off = np.cumsum(cnt) - cnt
        rows = rs[ei] + (np.arange(tot) - off[ei])
        yc = rows + 0.5
        t = (yc - ya[ei]) / (yb[ei] - ya[ei])
        xc = xa[ei] + t * (xb[ei] - xa[ei]) - c0
        cols = np.clip(np.ceil(xc - 0.5).astype(np.int64), 0, w)
        np.add.at(tog, (rows, cols), 1)
    mask = (np.cumsum(tog, axis=1)[:, :w] % 2).astype(bool)
    return r0, c0, mask


def paint(cls, opn, rings, value, is_open=False):
    res = raster_rings(rings)
    if res is None:
        return
    r0, c0, m = res
    h, w = m.shape
    cls[r0:r0 + h, c0:c0 + w][m] = value
    opn[r0:r0 + h, c0:c0 + w][m] = is_open


# ---------- OpenStreetMap ----------
def stitch(ways):
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(cur) >= 4:
            if cur[0] != cur[-1]:
                cur.append(cur[0])
            rings.append(cur)
    return rings


def osm_class(t):
    if t.get("natural") in ("scrub", "heath"):
        return LANDE
    if t.get("landuse") in ("meadow", "grass") or t.get("natural") == "grassland":
        return PRAIRIE
    lt, wd = t.get("leaf_type", ""), t.get("wood", "")
    if lt == "needleleaved" or wd == "coniferous":
        return PIN
    if lt == "broadleaved" or wd == "deciduous":
        return FEUILLUS
    if lt == "mixed" or wd == "mixed":
        return MIXTE_F
    return BOIS_OSM


def paint_osm(cls, opn):
    seen, n = set(), 0
    files = sorted(glob.glob(os.path.join(HERE, "tile_*.json")) + glob.glob(os.path.join(HERE, "scrub_*.json")))
    # ordre : forêts, puis garrigue, puis prairies (la plus petite emprise gagne)
    items = []
    for f in files:
        for el in json.load(open(f))["elements"]:
            k = (el["type"], el["id"])
            if k in seen:
                continue
            seen.add(k)
            items.append(el)
    order = {BOIS_OSM: 0, PIN: 0, FEUILLUS: 0, MIXTE_F: 0, LANDE: 1, PRAIRIE: 2}
    items.sort(key=lambda el: order[osm_class(el.get("tags", {}))])
    for el in items:
        if el["type"] == "way":
            g = [(p["lon"], p["lat"]) for p in el.get("geometry", [])]
            rings = [g] if len(g) >= 4 and g[0] == g[-1] else []
        else:
            parts = [[(p["lon"], p["lat"]) for p in (m.get("geometry") or [])]
                     for m in el.get("members", []) if m.get("type") == "way"]
            rings = stitch(parts)
        if rings:
            paint(cls, opn, rings, osm_class(el.get("tags", {})))
            n += 1
    print("OSM :", n, "polygones", flush=True)


# ---------- BD Forêt ----------
def bd_class(code, ess):
    code, ess = code or "", ess or ""
    if code.startswith("LA6"):
        return PRAIRIE
    if code.startswith("LA"):
        return LANDE
    if code.startswith("FP"):
        return PEUPLERAIE
    if code in ("FF0", "FO0"):
        return SANS_COUVERT
    if code.startswith("FF32"):
        return MIXTE_C
    if code.startswith("FF31") or code.startswith("FO3") or ess == "Mixte":
        return MIXTE_F
    if "in" in ess and ("Pin" in ess or "pin" in ess):
        return PIN
    if code.startswith("FF2-90") or code.startswith("FF2-91") or any(
            k in ess for k in ("Sapin", "Épicéa", "Epicéa", "Douglas", "Mélèze", "Cèdre")):
        return AUTRE_CONIF
    if "Conif" in ess:
        return PIN  # en Provence, les résineux non précisés sont surtout des pins
    if "Chênes décidus" in ess:
        return CHENE
    if "sempervirent" in ess:
        return CHENE_VERT
    if "Hêtre" in ess:
        return HETRE
    if "Châtaignier" in ess:
        return CHATAIGNIER
    if code.startswith("FF") or code.startswith("FO"):
        return FEUILLUS
    return None


def paint_bdforet(cls, opn):
    n, labels = 0, {}
    for f in sorted(glob.glob(os.path.join(HERE, "bdforet", "page_*.json"))):
        for ft in json.load(open(f))["features"]:
            p, g = ft["properties"], ft.get("geometry")
            c = bd_class(p.get("code_tfv"), p.get("essence"))
            if c is None or not g:
                continue
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            rings = [r for poly in polys for r in poly]
            paint(cls, opn, rings, c, (p.get("code_tfv") or "").startswith("FO"))
            labels[c] = labels.get(c, 0) + 1
            n += 1
    print("BD Forêt :", n, "polygones", dict(sorted(labels.items())), flush=True)


# ---------- relief ----------
def elevation():
    z = 13
    tiles = glob.glob(os.path.join(HERE, "terrain", f"{z}_*.png"))
    xs = sorted({int(os.path.basename(t).split("_")[1]) for t in tiles})
    ys = sorted({int(os.path.basename(t).split("_")[2][:-4]) for t in tiles})
    mos = np.zeros(((ys[-1] - ys[0] + 1) * 256, (xs[-1] - xs[0] + 1) * 256), dtype=np.float32)
    for t in tiles:
        _, x, y = os.path.basename(t)[:-4].split("_")
        a = np.asarray(Image.open(t).convert("RGB"), dtype=np.float32)
        e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        oy, ox = (int(y) - ys[0]) * 256, (int(x) - xs[0]) * 256
        mos[oy:oy + 256, ox:ox + 256] = e
    n = 2 ** z * 256
    lat = N - (np.arange(ROWS) + 0.5) * DLAT
    lon = W + (np.arange(COLS) + 0.5) * DLON
    px = (lon + 180) / 360 * n - xs[0] * 256
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ys[0] * 256
    x0 = np.clip(np.floor(px - 0.5).astype(int), 0, mos.shape[1] - 2)
    y0 = np.clip(np.floor(py - 0.5).astype(int), 0, mos.shape[0] - 2)
    tx = np.clip(px - 0.5 - x0, 0, 1)[None, :]
    ty = np.clip(py - 0.5 - y0, 0, 1)[:, None]
    Y0, X0 = y0[:, None], x0[None, :]
    el = (mos[Y0, X0] * (1 - tx) * (1 - ty) + mos[Y0, X0 + 1] * tx * (1 - ty)
          + mos[Y0 + 1, X0] * (1 - tx) * ty + mos[Y0 + 1, X0 + 1] * tx * ty)
    return np.maximum(el, 0)


def aspect_code(el):
    # pente et exposition sur la grille lissée 3x3
    p = np.pad(el, 1, mode="edge")
    sm = sum(p[1 + dy:1 + dy + ROWS, 1 + dx:1 + dx + COLS] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    lat = N - (np.arange(ROWS) + 0.5) * DLAT
    dy = DLAT * 111320
    dx = (DLON * 111320 * np.cos(np.radians(lat)))[:, None]
    q = np.pad(sm, 1, mode="edge")
    gx = (q[1:-1, 2:] - q[1:-1, :-2]) / (2 * dx)
    gy = (q[:-2, 1:-1] - q[2:, 1:-1]) / (2 * dy)  # > 0 : ça monte vers le nord
    slope = np.hypot(gx, gy)
    north = np.where(slope > 1e-4, -gy / np.maximum(slope, 1e-9), 0)
    east = np.where(slope > 1e-4, -gx / np.maximum(slope, 1e-9), 0)
    v = north * np.clip(slope / 0.15, 0, 1)  # -1 adret raide … +1 ubac raide
    # B : 4 bits « ubac » (0..15) + 4 bits direction (0..7 sur 8 secteurs, 8 = plat)
    nb = np.round((v + 1) / 2 * 15).astype(np.uint8)
    sector = (np.round((np.degrees(np.arctan2(east, north)) % 360) / 45) % 8).astype(np.uint8)
    sector[slope < 0.04] = 8
    return (nb << 4) | sector


def tpi_code(el, rad=5):
    """Position topographique : altitude moins la moyenne à ~125 m. 0 crête, 1 pente/plat, 2 creux, 3 combe."""
    k = 2 * rad + 1
    p = np.pad(el.astype(np.float64), rad, mode="edge")
    cs = np.cumsum(np.cumsum(p, axis=0), axis=1)
    cs = np.pad(cs, ((1, 0), (1, 0)))
    mean = (cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]) / (k * k)
    t = el - mean
    code = np.ones(el.shape, dtype=np.uint8)
    code[t > 6] = 0
    code[t < -2] = 2
    code[t < -6] = 3
    return code


def inside_mask():
    lat = N - (np.arange(ROWS) + 0.5) * DLAT
    lon = W + (np.arange(COLS) + 0.5) * DLON
    la, lo = np.radians(lat)[:, None], np.radians(lon)[None, :]
    la0, lo0 = math.radians(AIX[0]), math.radians(AIX[1])
    h = np.sin((la - la0) / 2) ** 2 + math.cos(la0) * np.cos(la) * np.sin((lo - lo0) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(h)) <= RADIUS_KM


def places():
    d = json.load(open(os.path.join(HERE, "places.json")))
    rank = {"city": 3, "town": 2, "village": 1, "hamlet": 0}
    out = []
    for el in d["elements"]:
        t = el.get("tags", {})
        if "name" in t:
            out.append([t["name"], round(el["lat"], 4), round(el["lon"], 4), rank[t["place"]]])
    return out


if __name__ == "__main__":
    t0 = time.time()
    cls = np.zeros((ROWS, COLS), dtype=np.uint8)
    opn = np.zeros((ROWS, COLS), dtype=bool)
    paint_osm(cls, opn)
    paint_bdforet(cls, opn)
    el = elevation()
    ins = inside_mask()
    R = cls | (opn.astype(np.uint8) << 4) | (tpi_code(el) << 5) | (ins.astype(np.uint8) << 7)
    G = np.clip(np.round(el / 5), 0, 255).astype(np.uint8)
    B = aspect_code(el)
    buf = io.BytesIO()
    Image.fromarray(np.dstack([R, G, B])).save(buf, "PNG", optimize=True)
    png = buf.getvalue()
    meta = {"S": S, "W": W, "N": N, "E": E, "rows": ROWS, "cols": COLS, "center": AIX, "radiusKm": RADIUS_KM,
            "places": places(), "built": time.strftime("%Y-%m-%d")}
    with open(os.path.join(HERE, "..", "biotope.js"), "w") as f:
        f.write("// Généré par data/build_fine.py — BD Forêt V2 © IGN, © contributeurs OpenStreetMap (ODbL), relief Terrarium\n")
        f.write("window.BIOTOPE=" + json.dumps(meta, separators=(",", ":"), ensure_ascii=False) + ";\n")
        f.write('window.BIOTOPE.png="data:image/png;base64,' + base64.b64encode(png).decode() + '";\n')
    c = cls[ins]
    print("couvert dans la zone :", {int(k): round(float((c == k).mean()) * 100, 1) for k in np.unique(c)})
    print("PNG", round(len(png) / 1e6, 2), "Mo ; durée", round(time.time() - t0), "s")
