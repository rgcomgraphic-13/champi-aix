"""Télécharge garrigue (scrub/heath) OSM autour d'Aix, par tuiles (re-lançable : reprend où il s'est arrêté)."""
import json, subprocess, time

S, W, N, E = 43.07, 4.81, 43.99, 6.08
NY, NX = 3, 4
U = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"


def ok(f):
    try:
        json.load(open(f))
        return True
    except Exception:
        return False


jobs = []
for i in range(NY):
    for j in range(NX):
        if False:
            continue
        for a in range(2):
            for b in range(2):
                jobs.append((f"scrub_{i}_{j}_{a}_{b}.json",
                             S + (N - S) * (i + a / 2) / NY, S + (N - S) * (i + (a + 1) / 2) / NY,
                             W + (E - W) * (j + b / 2) / NX, W + (E - W) * (j + (b + 1) / 2) / NX))

for out, s, n, w, e in jobs:
    if ok(out):
        continue
    bb = f"({s:.4f},{w:.4f},{n:.4f},{e:.4f})"
    q = f'''[out:json][timeout:300];(
way["natural"~"^(scrub|heath)$"]{bb};relation["natural"~"^(scrub|heath)$"]{bb};
);out tags geom qt;'''
    for attempt in range(6):
        subprocess.run(["curl", "-s", "-A", "champi-aix/1.0", "-X", "POST", "--data-urlencode", "data=" + q, U,
                        "-o", out, "--max-time", "400"])
        if ok(out):
            print(out, len(json.load(open(out))["elements"]), flush=True)
            break
        print(out, "retry", attempt, flush=True)
        time.sleep(15)
    else:
        print(out, "ECHEC", flush=True)
print("FIN", flush=True)
