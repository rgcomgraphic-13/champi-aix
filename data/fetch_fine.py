"""Télécharge les données fines : BD Forêt V2 (IGN, WFS Géoplateforme) et relief (tuiles Terrarium, zoom 13).

Re-lançable : reprend où il s'est arrêté.
    python3 fetch_fine.py
"""
import json, math, os, subprocess, sys, time

S, W, N, E = 43.29, 5.12, 43.77, 5.78
HERE = os.path.dirname(os.path.abspath(__file__))


def curl(url, out, tries=6):
    for attempt in range(tries):
        r = subprocess.run(["curl", "-s", "-f", "-A", "champi-aix/1.0", "--max-time", "300", url, "-o", out])
        if r.returncode == 0 and os.path.getsize(out) > 0:
            return True
        time.sleep(10 * (attempt + 1))
    return False


def ok_json(f):
    try:
        json.load(open(f))
        return True
    except Exception:
        return False


def bdforet():
    d = os.path.join(HERE, "bdforet")
    os.makedirs(d, exist_ok=True)
    page, start = 5000, 0
    while True:
        out = os.path.join(d, f"page_{start:06d}.json")
        if not ok_json(out):
            url = ("https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
                   "&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale&OUTPUTFORMAT=application/json"
                   "&SRSNAME=EPSG:4326&PROPERTYNAME=code_tfv,tfv,essence,geom&SORTBY=id"
                   f"&COUNT={page}&STARTINDEX={start}"
                   f"&BBOX={S},{W},{N},{E},urn:ogc:def:crs:EPSG::4326")
            if not curl(url, out) or not ok_json(out):
                sys.exit("échec BD Forêt " + out)
        n = len(json.load(open(out))["features"])
        print("BD Forêt", start, n, flush=True)
        if n < page:
            break
        start += page


def deg2tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def terrain(z=13):
    d = os.path.join(HERE, "terrain")
    os.makedirs(d, exist_ok=True)
    x0, y0 = deg2tile(N, W, z)
    x1, y1 = deg2tile(S, E, z)
    total = (x1 - x0 + 1) * (y1 - y0 + 1)
    k = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            out = os.path.join(d, f"{z}_{x}_{y}.png")
            k += 1
            if os.path.exists(out) and os.path.getsize(out) > 100:
                continue
            if not curl(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", out):
                sys.exit("échec relief " + out)
        print("relief", k, "/", total, flush=True)


if __name__ == "__main__":
    terrain()
    bdforet()
    print("FIN", flush=True)
