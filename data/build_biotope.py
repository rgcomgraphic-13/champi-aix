"""Construit la grille de biotope (forêts, prairies, altitude, villages) autour d'Aix.

À lancer une seule fois (le biotope ne change pas) :
    python3 fetch_osm.py && python3 build_biotope.py
Produit ../biotope.js chargé par index.html.
"""
import glob, json, math, os, subprocess, time
import numpy as np

AIX = (43.5297, 5.4474)
RADIUS_KM = 50
S, W, N, E = 43.08, 4.82, 43.98, 6.07
DLAT, DLON = 0.01, 0.0125          # ~1,1 km x 1,0 km
ROWS = round((N - S) / DLAT)       # 90
COLS = round((E - W) / DLON)       # 100
SUB = 4                            # sur-échantillonnage pour les fractions
H, WD = ROWS * SUB, COLS * SUB


def cell_center(r, c):
    return N - (r + 0.5) * DLAT, W + (c + 0.5) * DLON


def dist_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


# ---------- rasterisation des polygones (pair/impair, sans dépendance) ----------
def ring_parity(pts):
    """Masque booléen (H, WD) de l'intérieur d'un anneau fermé, règle pair/impair."""
    xy = np.array([((lon - W) / DLON * SUB, (N - lat) / DLAT * SUB) for lat, lon in pts])
    x0, y0 = xy[:-1, 0], xy[:-1, 1]
    x1, y1 = xy[1:, 0], xy[1:, 1]
    tog = np.zeros((H, WD + 1), dtype=np.int32)
    ymin, ymax = np.minimum(y0, y1), np.maximum(y0, y1)
    keep = (ymax > ymin) & (ymax >= 0) & (ymin <= H)
    for a, b, c, d, lo, hi in zip(x0[keep], y0[keep], x1[keep], y1[keep], ymin[keep], ymax[keep]):
        r0 = max(0, int(math.ceil(lo - 0.5)))
        r1 = min(H - 1, int(math.ceil(hi - 0.5)) - 1)
        if r1 < r0:
            continue
        rows = np.arange(r0, r1 + 1)
        yc = rows + 0.5
        xs = a + (yc - b) * (c - a) / (d - b)
        cols = np.clip(np.ceil(xs - 0.5).astype(int), 0, WD)
        np.add.at(tog, (rows, cols), 1)
    return (np.cumsum(tog, axis=1)[:, :WD] % 2).astype(bool)


def stitch(ways):
    """Assemble des morceaux de lignes en anneaux fermés."""
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


def category(tags):
    if tags.get("natural") in ("scrub", "heath"):
        return "scrub"
    if tags.get("landuse") in ("meadow", "grass") or tags.get("natural") == "grassland":
        return "meadow"
    lt = tags.get("leaf_type", "") or ""
    wood = tags.get("wood", "") or ""
    if lt == "needleleaved" or wood == "coniferous":
        return "conifer"
    if lt == "broadleaved" or wood == "deciduous":
        return "broad"
    if lt == "mixed" or wood == "mixed":
        return "mixed"
    return "unknown"


def build_masks():
    masks = {k: np.zeros((H, WD), dtype=bool) for k in ("conifer", "broad", "mixed", "unknown", "meadow", "scrub")}
    seen = set()
    n = 0
    for f in sorted(glob.glob(os.path.join(HERE, "tile_*.json")) + glob.glob(os.path.join(HERE, "scrub_*.json"))):
        for el in json.load(open(f))["elements"]:
            key = (el["type"], el["id"])
            if key in seen:
                continue
            seen.add(key)
            cat = category(el.get("tags", {}))
            if el["type"] == "way":
                g = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
                rings = [g] if len(g) >= 4 and g[0] == g[-1] else []
            else:
                parts = [[(p["lat"], p["lon"]) for p in m.get("geometry", []) or []]
                         for m in el.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "inner", "")]
                rings = stitch(parts)
            if not rings:
                continue
            m = np.zeros((H, WD), dtype=bool)
            for r in rings:
                m ^= ring_parity(r)
            masks[cat] |= m
            n += 1
    print("polygones rasterisés:", n)
    return masks


def frac(mask):
    return mask.reshape(ROWS, SUB, COLS, SUB).mean(axis=(1, 3))


# ---------- altitude (Open-Meteo, 100 points par appel) ----------
def fetch_elevation():
    """Altitude SRTM 30 m via OpenTopoData (100 points par appel, 1 appel/s). Reprend en cas de coupure."""
    cache = os.path.join(HERE, "elev.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    part = os.path.join(HERE, "elev_partial.json")
    out = json.load(open(part)) if os.path.exists(part) else []
    pts = [cell_center(r, c) for r in range(ROWS) for c in range(COLS)]
    for i in range(len(out), len(pts), 100):
        chunk = pts[i:i + 100]
        url = "https://api.opentopodata.org/v1/srtm30m?locations=" + "|".join(f"{p[0]:.4f},{p[1]:.4f}" for p in chunk)
        for attempt in range(6):
            r = subprocess.run(["curl", "-s", "--max-time", "60", url], capture_output=True, text=True)
            try:
                out += [x["elevation"] if x["elevation"] is not None else 0 for x in json.loads(r.stdout)["results"]]
                break
            except Exception:
                time.sleep(10)
        else:
            raise SystemExit("échec altitude " + r.stdout[:200])
        json.dump(out, open(part, "w"))
        time.sleep(1.2)
    json.dump(out, open(cache, "w"))
    return out


# ---------- villages pour nommer les coins ----------
def fetch_places():
    cache = os.path.join(HERE, "places.json")
    if not os.path.exists(cache):
        q = (f'[out:json][timeout:120];node["place"~"^(city|town|village|hamlet)$"]({S},{W},{N},{E});'
             'out qt;')
        for attempt in range(6):
            subprocess.run(["curl", "-s", "-A", "champi-aix/1.0", "-X", "POST", "--data-urlencode", "data=" + q,
                            "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "-o", cache, "--max-time", "200"])
            try:
                json.load(open(cache))
                break
            except Exception:
                time.sleep(15)
    d = json.load(open(cache))
    rank = {"city": 3, "town": 2, "village": 1, "hamlet": 0}
    pl = []
    for el in d["elements"]:
        t = el.get("tags", {})
        if "name" in t and dist_km(AIX, (el["lat"], el["lon"])) <= RADIUS_KM + 8:
            pl.append([t["name"], round(el["lat"], 4), round(el["lon"], 4), rank[t["place"]]])
    print("lieux:", len(pl))
    return pl


HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    masks = build_masks()
    forest_any = masks["conifer"] | masks["broad"] | masks["mixed"] | masks["unknown"]
    con = masks["conifer"] & ~masks["broad"]
    bro = masks["broad"] & ~masks["conifer"]
    mix = (masks["mixed"] | (masks["conifer"] & masks["broad"])) & ~con & ~bro
    unk = forest_any & ~con & ~bro & ~mix
    meadow = masks["meadow"] & ~forest_any
    scrub = masks["scrub"] & ~forest_any & ~masks["meadow"]
    elev = fetch_elevation()
    inside = []
    for r in range(ROWS):
        for c in range(COLS):
            inside.append(1 if dist_km(AIX, cell_center(r, c)) <= RADIUS_KM else 0)

    def q(a):
        return [int(round(v * 100)) for v in a.ravel()]

    data = {
        "S": S, "W": W, "N": N, "E": E, "dlat": DLAT, "dlon": DLON, "rows": ROWS, "cols": COLS,
        "center": AIX, "radiusKm": RADIUS_KM,
        "conifer": q(frac(con)), "broad": q(frac(bro)), "mixed": q(frac(mix)), "unknown": q(frac(unk)),
        "meadow": q(frac(meadow)), "scrub": q(frac(scrub)),
        "elev": [int(round(e)) for e in elev], "inside": inside, "places": fetch_places(),
        "built": time.strftime("%Y-%m-%d"),
    }
    with open(os.path.join(HERE, "..", "biotope.js"), "w") as f:
        f.write("// Généré par data/build_biotope.py — données © OpenStreetMap (ODbL), altitude SRTM via OpenTopoData\n")
        f.write("window.BIOTOPE=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")
    fa = frac(forest_any)
    print("couverture forestière moyenne (zone):", round(float((fa.ravel() * np.array(inside)).sum() / sum(inside)), 3))
