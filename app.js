(function () {
  const B = window.BIOTOPE, SPECIES = window.SPECIES, COVER = window.COVER, Model = window.Model;
  const ROWS = B.rows, COLS = B.cols, NC = ROWS * COLS;
  const DLAT = (B.N - B.S) / ROWS, DLON = (B.E - B.W) / COLS;
  const PAST = 20, FUTURE = 7;           // jours d'historique et de prévision
  const WN = 6;                          // points météo WN x WN (~10 km entre points)
  const MS = 32, MR = ROWS / MS, MC = COLS / MS; // mailles météo intermédiaires (~800 m)
  const CACHE_KEY = "champiAix.weather.v2";
  const MAX_AGE_H = 6;
  const LAPSE = 0.0065;

  const $ = (id) => document.getElementById(id);
  const state = { sp: "all", day: 0, weather: null, todayIdx: PAST, med: null, scores: null, pyr: null, sel: null };
  const cellM = Math.round(DLAT * 111320);

  // ---------- biotope fin (image RGB : R = couvert, G = altitude/5, B = exposition) ----------
  let RCH, GCH, BCH, EDGE, SITE, covered, coverPyr;
  const SITE_MAX = 1.4;
  function decodeBiotope() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas"); cv.width = COLS; cv.height = ROWS;
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, COLS, ROWS).data;
        RCH = new Uint8Array(NC); GCH = new Uint8Array(NC); BCH = new Uint8Array(NC);
        let n = 0;
        for (let i = 0, j = 0; i < NC; i++, j += 4) {
          RCH[i] = d[j]; GCH[i] = d[j + 1]; BCH[i] = d[j + 2];
          if ((d[j] & 128) && (d[j] & 15)) n++;
        }
        covered = new Int32Array(n);
        const cov = new Uint8Array(NC);
        for (let i = 0, k = 0; i < NC; i++) if ((RCH[i] & 128) && (RCH[i] & 15)) { covered[k++] = i; cov[i] = 1; }
        coverPyr = pyramid(cov);
        // lisière : case boisée avec une case non boisée à 50 m ou moins
        const forest = (i) => { const c = RCH[i] & 15; return c && c !== 11 && c !== 12 && c !== 14; };
        EDGE = new Uint8Array(NC);
        for (let k = 0; k < covered.length; k++) {
          const i = covered[k];
          if (!forest(i)) continue;
          const r = (i / COLS) | 0, c = i % COLS;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]]) {
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && cc >= 0 && rr < ROWS && cc < COLS && !forest(rr * COLS + cc)) { EDGE[i] = 1; break; }
          }
        }
        // facteur biotope de chaque case et espèce, indépendant de la météo : calculé une fois
        SITE = SPECIES.map(sp => {
          const a = new Uint8Array(covered.length);
          for (let k = 0; k < covered.length; k++) {
            const i = covered[k];
            a[k] = Math.min(255, Math.round(Model.site(sp, coverOf(i), isOpen(i), elevOf(i), ubacOf(i), tpiOf(i), EDGE[i]) / SITE_MAX * 255));
          }
          return a;
        });
        resolve();
      };
      img.onerror = () => reject(new Error("biotope illisible"));
      img.src = B.png;
    });
  }
  const coverOf = (i) => RCH[i] & 15;
  const isOpen = (i) => (RCH[i] >> 4) & 1;
  const elevOf = (i) => GCH[i] * 5;
  const ubacOf = (i) => (BCH[i] >> 4) / 7.5 - 1;
  const tpiOf = (i) => (RCH[i] >> 5) & 3;
  const cellLat = (r) => B.N - (r + 0.5) * DLAT;
  const cellLon = (c) => B.W + (c + 0.5) * DLON;
  const medOf = (i) => ((Math.floor(i / COLS) / MS) | 0) * MC + (((i % COLS) / MS) | 0);

  // pyramide de maxima pour l'affichage aux petits zooms
  function pyramid(base) {
    const out = [base];
    let n = ROWS, prev = base;
    for (let L = 1; L <= 7; L++) {
      const m = n >> 1, cur = new Uint8Array(m * m);
      for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
        const a = (2 * r) * n + 2 * c;
        cur[r * m + c] = Math.max(prev[a], prev[a + 1], prev[a + n], prev[a + n + 1]);
      }
      out.push(cur); prev = cur; n = m;
    }
    return out;
  }

  // ---------- météo ----------
  const wLats = [], wLons = [];
  for (let k = 0; k < WN; k++) {
    wLats.push(B.S + (B.N - B.S) * k / (WN - 1));
    wLons.push(B.W + (B.E - B.W) * k / (WN - 1));
  }
  function todayStr() { return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }); }

  async function fetchWeather() {
    const pts = [];
    for (const la of wLats) for (const lo of wLons) pts.push([la, lo]);
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + pts.map(p => p[0].toFixed(3)).join(",")
      + "&longitude=" + pts.map(p => p[1].toFixed(3)).join(",")
      + "&daily=precipitation_sum,temperature_2m_mean,temperature_2m_min,relative_humidity_2m_mean,soil_moisture_0_to_7cm_mean"
      + "&past_days=" + PAST + "&forecast_days=" + FUTURE + "&timezone=Europe%2FParis";
    let res = await fetch(url);
    for (let a = 0; res.status === 429 && a < 2; a++) {
      setStatus("Quota Open-Meteo atteint, nouvelle tentative dans une minute…", "load");
      await new Promise(r => setTimeout(r, 65e3));
      res = await fetch(url);
    }
    if (!res.ok) throw new Error("Open-Meteo a répondu " + res.status);
    const js = await res.json();
    return {
      fetchedAt: Date.now(), day: todayStr(), points: (Array.isArray(js) ? js : [js]).map(p => ({
        elev: p.elevation, time: p.daily.time, rain: p.daily.precipitation_sum, tmean: p.daily.temperature_2m_mean,
        tmin: p.daily.temperature_2m_min, rh: p.daily.relative_humidity_2m_mean, soil: p.daily.soil_moisture_0_to_7cm_mean
      }))
    };
  }
  function fill(a, def) { let last = def; return a.map(v => (v == null || Number.isNaN(v)) ? last : (last = v)); }

  // séries météo par maille intermédiaire ; températures ramenées au niveau de la mer
  function buildMed(wx) {
    const P = wx.points.map(p => ({
      rain: fill(p.rain, 0), rh: fill(p.rh, 65), soil: fill(p.soil, 0.15),
      t0: fill(p.tmean, 12).map(t => t + LAPSE * p.elev), n0: fill(p.tmin, 8).map(t => t + LAPSE * p.elev)
    }));
    const nd = wx.points[0].time.length, med = new Array(MR * MC);
    for (let mr = 0; mr < MR; mr++) for (let mc = 0; mc < MC; mc++) {
      const lat = B.N - (mr + 0.5) * MS * DLAT, lon = B.W + (mc + 0.5) * MS * DLON;
      const fy = (lat - B.S) / (B.N - B.S) * (WN - 1), fx = (lon - B.W) / (B.E - B.W) * (WN - 1);
      const y0 = Math.min(WN - 2, Math.floor(fy)), x0 = Math.min(WN - 2, Math.floor(fx)), ty = fy - y0, tx = fx - x0;
      const o = { rain: new Float32Array(nd), rh: new Float32Array(nd), soil: new Float32Array(nd), t0: new Float32Array(nd), n0: new Float32Array(nd) };
      for (const [yy, xx, w] of [[y0, x0, (1 - ty) * (1 - tx)], [y0, x0 + 1, (1 - ty) * tx], [y0 + 1, x0, ty * (1 - tx)], [y0 + 1, x0 + 1, ty * tx]]) {
        const p = P[yy * WN + xx];
        for (let d = 0; d < nd; d++) { o.rain[d] += p.rain[d] * w; o.rh[d] += p.rh[d] * w; o.soil[d] += p.soil[d] * w; o.t0[d] += p.t0[d] * w; o.n0[d] += p.n0[d] * w; }
      }
      med[mr * MC + mc] = o;
    }
    return med;
  }

  function dayDate(o) { return new Date(state.weather.points[0].time[state.todayIdx + o] + "T12:00:00"); }

  // facteurs météo par maille intermédiaire pour un jour donné
  const dayCache = new Map();
  function dayFactors(o) {
    if (dayCache.has(o)) return dayCache.get(o);
    const d = state.todayIdx + o, date = dayDate(o), n = MR * MC;
    const wf = SPECIES.map(() => new Float32Array(n)), tm = new Float32Array(n), tn = new Float32Array(n);
    for (let m = 0; m < n; m++) {
      const w = state.med[m];
      SPECIES.forEach((sp, k) => { wf[k][m] = Model.weather(sp, w, d, date).f; });
      let s = 0, c = 0, mn = 99;
      for (let i = Math.max(0, d - 6); i <= d; i++) { s += w.t0[i]; c++; }
      for (let i = Math.max(0, d - 3); i <= d; i++) mn = Math.min(mn, w.n0[i]);
      tm[m] = s / c; tn[m] = mn;
    }
    const f = { wf, tm, tn };
    dayCache.set(o, f);
    return f;
  }

  // interpolation bilinéaire entre les centres des 4 mailles météo voisines (évite les marches)
  const NB = { m: [0, 0, 0, 0], w: [0, 0, 0, 0] };
  function neighbours(i) {
    const fr = Math.min(MR - 1.0001, Math.max(0, ((i / COLS) | 0) / MS + 0.5 / MS - 0.5));
    const fc = Math.min(MC - 1.0001, Math.max(0, (i % COLS) / MS + 0.5 / MS - 0.5));
    const r0 = fr | 0, c0 = fc | 0, ty = fr - r0, tx = fc - c0, m = r0 * MC + c0;
    NB.m[0] = m; NB.m[1] = m + 1; NB.m[2] = m + MC; NB.m[3] = m + MC + 1;
    NB.w[0] = (1 - ty) * (1 - tx); NB.w[1] = (1 - ty) * tx; NB.w[2] = ty * (1 - tx); NB.w[3] = ty * tx;
    return NB;
  }
  const interp = (arr, nb) => arr[nb.m[0]] * nb.w[0] + arr[nb.m[1]] * nb.w[1] + arr[nb.m[2]] * nb.w[2] + arr[nb.m[3]] * nb.w[3];

  function cellScore(i, k, f) {
    const nb = neighbours(i), w = interp(f.wf[k], nb);
    if (w <= 0.0005) return 0;
    const sp = SPECIES[k], z = elevOf(i);
    const T = Model.tempFactor(sp, interp(f.tm, nb) - LAPSE * z, interp(f.tn, nb) - LAPSE * z);
    if (!T) return 0;
    return Math.min(1, w * T * Model.site(sp, coverOf(i), isOpen(i), z, ubacOf(i), tpiOf(i), EDGE[i])) * 100;
  }
  const spIdx = (id) => id === "all" ? SPECIES.map((_, k) => k) : [SPECIES.findIndex(s => s.id === id)];

  // indices maximums par espèce sur un échantillon de cases (chiffres des boutons), mis en cache
  const maxCache = new Map();
  function sampleMaxes(o, ks, step) {
    const key = o + ":" + ks.join(","), hit = maxCache.get(key);
    if (hit) return hit;
    const f = dayFactors(o), mx = new Float32Array(SPECIES.length);
    for (let j = 0; j < covered.length; j += step) {
      for (const k of ks) { const s = bestScore(j, [k], f); if (s > mx[k]) mx[k] = s; }
    }
    maxCache.set(key, mx);
    return mx;
  }
  function sampleMax(id, o, step = 6) {
    const ks = spIdx(id), mx = sampleMaxes(o, spIdx("all"), step);
    return Math.max(...ks.map(k => mx[k]));
  }

  // meilleur indice de la case covered[j] pour une liste d'espèces (version rapide, biotope précalculé)
  function bestScore(j, ks, f) {
    const i = covered[j];
    let nb = null, best = 0, tm, tn;
    for (const k of ks) {
      const st = SITE[k][j];
      if (!st) continue;
      if (!nb) {
        nb = neighbours(i);
        const z = elevOf(i);
        tm = interp(f.tm, nb) - LAPSE * z; tn = interp(f.tn, nb) - LAPSE * z;
      }
      const w = interp(f.wf[k], nb);
      if (w <= 0.0005) continue;
      const T = Model.tempFactor(SPECIES[k], tm, tn);
      if (!T) continue;
      const s = Math.min(1, w * T * st * (SITE_MAX / 255)) * 100;
      if (s > best) best = s;
    }
    return best;
  }

  function computeScores() {
    const f = dayFactors(state.day), ks = spIdx(state.sp), out = new Uint8Array(NC);
    for (let j = 0; j < covered.length; j++) out[covered[j]] = Math.round(bestScore(j, ks, f));
    state.scores = out;
    state.pyr = pyramid(out);
  }

  // ---------- couleurs ----------
  const DRAW_MIN = 25; // en dessous, la case n'est pas colorée (seulement quadrillée)
  const STOPS = [[25, [250, 190, 120], .45], [40, [246, 150, 70], .6], [55, [240, 100, 40], .72], [70, [228, 52, 24], .82], [88, [175, 18, 12], .9]];
  const COLORS = [], SOLID = [];
  for (let s = 0; s <= 100; s++) {
    let c = null;
    if (s >= STOPS[0][0]) {
      let k = 1; while (k < STOPS.length - 1 && s > STOPS[k][0]) k++;
      const [a, ca, aa] = STOPS[k - 1], [b, cb, ab] = STOPS[k], t = Math.min(1, Math.max(0, (s - a) / (b - a)));
      c = [0, 1, 2].map(j => Math.round(ca[j] + (cb[j] - ca[j]) * t)).concat(+(aa + (ab - aa) * t).toFixed(2));
    }
    COLORS.push(c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : null);
    SOLID.push(c ? `rgb(${c[0]},${c[1]},${c[2]})` : null);
  }
  const solid = (s) => SOLID[Math.max(20, Math.min(100, Math.round(s)))];

  // ---------- carte ----------
  const ign = (layer, fmt) => "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + layer
    + "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=" + fmt + "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  const bases = {
    "Plan OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© contributeurs OpenStreetMap" }),
    "Plan IGN": L.tileLayer(ign("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"), { maxZoom: 19, maxNativeZoom: 19, attribution: "© IGN" }),
    "Photo aérienne IGN": L.tileLayer(ign("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"), { maxZoom: 19, maxNativeZoom: 19, attribution: "© IGN" }),
    "Relief": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 19, maxNativeZoom: 17, attribution: "© OpenTopoMap, © OpenStreetMap" })
  };
  const map = L.map("map", { minZoom: 9, maxZoom: 19 });
  let baseName = "Plan OpenStreetMap";
  try { const b = localStorage.getItem("champiAix.base"); if (b && bases[b]) baseName = b; } catch (_) { }
  bases[baseName].addTo(map);
  map.on("baselayerchange", (e) => { try { localStorage.setItem("champiAix.base", e.name); } catch (_) { } });

  map.fitBounds(L.latLng(B.center).toBounds(B.radiusKm * 2000), { padding: [6, 6] });
  L.circle(B.center, { radius: B.radiusKm * 1000, color: "#b5341a", weight: 2, dashArray: "8 6", fill: false, interactive: false }).addTo(map);
  L.circleMarker(B.center, { radius: 4, color: "#1d2620", weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(map);

  // quadrillage dessiné sur des tuiles canvas, case par case
  const mercY = (lat, ws) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * ws;
  const unY = (y, ws) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / ws))) * 180 / Math.PI;
  const Grid = L.GridLayer.extend({
    createTile(coords) {
      const tile = document.createElement("canvas"), dpr = Math.min(2, window.devicePixelRatio || 1);
      tile.width = tile.height = 256 * dpr;
      if (!state.pyr) return tile;
      const g = tile.getContext("2d"); g.scale(dpr, dpr);
      const z = coords.z, ws = 256 * Math.pow(2, z), px0 = coords.x * 256, py0 = coords.y * 256;
      const cellPx = DLON / 360 * ws;
      let Lv = 0; while (Lv < 7 && cellPx * (1 << Lv) < 5) Lv++;
      const b = 1 << Lv, rowsL = ROWS >> Lv, colsL = COLS >> Lv, P = state.pyr[Lv], CP = coverPyr[Lv];
      const lonW = px0 / ws * 360 - 180, lonE = (px0 + 256) / ws * 360 - 180;
      const latN = unY(py0, ws), latS = unY(py0 + 256, ws);
      const c0 = Math.max(0, Math.floor((lonW - B.W) / DLON / b)), c1 = Math.min(colsL - 1, Math.floor((lonE - B.W) / DLON / b));
      const r0 = Math.max(0, Math.floor((B.N - latN) / DLAT / b)), r1 = Math.min(rowsL - 1, Math.floor((B.N - latS) / DLAT / b));
      if (c1 < c0 || r1 < r0) return tile;
      const xs = [], ys = [];
      for (let c = c0; c <= c1 + 1; c++) xs.push((B.W + c * b * DLON + 180) / 360 * ws - px0);
      for (let r = r0; r <= r1 + 1; r++) ys.push(mercY(B.N - r * b * DLAT, ws) - py0);
      const size = cellPx * b, edge = size >= 9, grid = size >= 11;
      g.lineWidth = 0.6;
      for (let r = r0; r <= r1; r++) {
        const y = ys[r - r0], h = ys[r - r0 + 1] - y;
        for (let c = c0; c <= c1; c++) {
          const k = r * colsL + c, s = P[k];
          const x = xs[c - c0], w = xs[c - c0 + 1] - x;
          if (s >= DRAW_MIN) {
            g.fillStyle = COLORS[s];
            g.fillRect(x, y, w, h);
            if (edge) { g.strokeStyle = "rgba(110,25,10,.35)"; g.strokeRect(x + .3, y + .3, w - .6, h - .6); }
          } else if (grid && CP[k]) {
            g.strokeStyle = "rgba(90,70,30,.13)"; g.strokeRect(x + .3, y + .3, w - .6, h - .6);
          }
        }
      }
      return tile;
    }
  });
  const overlay = new Grid({ tileSize: 256, zIndex: 5, opacity: 0.9, updateWhenZooming: false, maxZoom: 19 }).addTo(map);
  L.control.layers(bases, { "Indice de pousse": overlay }, { position: "topright" }).addTo(map);

  const Locate = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create("div", "leaflet-bar");
      b.innerHTML = '<a href="#" class="locate" title="Ma position" role="button" aria-label="Ma position">◎</a>';
      L.DomEvent.on(b, "click", (e) => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); map.locate({ setView: true, maxZoom: 16 }); });
      return b;
    }
  });
  new Locate({ position: "topleft" }).addTo(map);
  let me = null;
  map.on("locationfound", (e) => {
    me && me.remove();
    me = L.layerGroup([L.circle(e.latlng, { radius: e.accuracy, weight: 1, color: "#2b6cb0", fillOpacity: .08, interactive: false }),
    L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#2b6cb0", fillOpacity: 1 })]).addTo(map);
  });
  map.on("locationerror", () => setStatus("Position indisponible : autorisez la localisation dans le navigateur", "err", true));

  // ---------- lieux ----------
  function km(a, b, c, d) {
    const p = Math.PI / 180, h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function nearestPlace(lat, lon, minRank) {
    let best = null, bd = 1e9;
    for (const p of B.places) {
      if (p[3] < minRank) continue;
      const d = km(lat, lon, p[1], p[2]);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { name: best[0], km: bd } : { name: "?", km: 0 };
  }
  function placeLabel(lat, lon) {
    const v = nearestPlace(lat, lon, 1), h = nearestPlace(lat, lon, 0);
    return h.name !== v.name && h.km < v.km && h.km < 2 ? `${h.name}, ${v.name}` : `près de ${v.name}`;
  }
  const DIRS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
  function aspectLabel(i) {
    const sec = BCH[i] & 15, u = ubacOf(i);
    if (sec >= 8) return "terrain plat";
    return "versant " + DIRS[sec] + (u > 0.4 ? " (ubac, frais)" : u < -0.4 ? " (adret, sec)" : "");
  }
  const coverLabel = (i) => COVER[coverOf(i)] ? COVER[coverOf(i)] + (isOpen(i) ? ", clairsemée" : "") + (EDGE[i] ? ", en lisière" : "") : "Pas de forêt ni de prairie";
  const TPI_LABEL = ["crête ou bosse (plus sec)", "pente ou replat", "léger creux (plus frais)", "combe ou vallon (humide)"];

  // ---------- interface ----------
  function setStatus(txt, kind, transient) {
    const prev = $("status").textContent, pk = $("dot").className;
    $("status").textContent = txt; $("dot").className = "dot" + (kind ? " " + kind : "");
    if (transient) setTimeout(() => { $("status").textContent = prev; $("dot").className = pk; }, 4000);
  }

  function renderSpecies() {
    const list = [{ id: "all", name: "Toutes" }].concat(SPECIES);
    const mx = sampleMaxes(state.day, spIdx("all"), 6), val = (id) => Math.round(id === "all" ? Math.max(...mx) : mx[spIdx(id)[0]]);
    $("species").innerHTML = list.map(s => `<button type="button" class="chip" data-id="${s.id}" aria-pressed="${s.id === state.sp}">${s.name}<span class="n">${val(s.id)}</span></button>`).join("");
    const sp = SPECIES.find(s => s.id === state.sp);
    $("spnote").innerHTML = sp ? `<i>${sp.latin}</i>. ${sp.note}` : "Meilleur indice toutes espèces confondues. Le chiffre sur chaque espèce est son meilleur indice dans la zone ce jour-là.";
  }

  function renderDays() {
    const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
    let html = "";
    for (let o = 0; o < FUTURE; o++) {
      const mx = sampleMax(state.sp, o), d = dayDate(o);
      html += `<button type="button" class="day" data-o="${o}" aria-pressed="${o === state.day}" title="Meilleur indice : ${Math.round(mx)}">${o === 0 ? "auj." : fmt.format(d).replace(".", "")}<b>${d.getDate()}</b><i style="background:${mx >= 20 ? solid(mx) : ""}"></i></button>`;
    }
    $("days").innerHTML = html;
  }

  function renderSpots() {
    const a = state.scores, hist = new Uint32Array(101);
    for (let j = 0; j < covered.length; j++) hist[a[covered[j]]]++;
    let thr = 100, acc = 0;
    while (thr > 25 && acc + hist[thr] < 6000) { acc += hist[thr]; thr--; }
    const idx = [];
    for (let j = 0; j < covered.length; j++) { const i = covered[j]; if (a[i] >= Math.max(25, thr)) idx.push(i); }
    idx.sort((x, y) => a[y] - a[x]);
    const picked = [];
    for (const i of idx) {
      if (picked.length >= 10) break;
      const la = cellLat(Math.floor(i / COLS)), lo = cellLon(i % COLS);
      if (picked.every(p => km(la, lo, p.la, p.lo) > 1.5)) picked.push({ i, la, lo });
    }
    if (!picked.length) {
      $("spots").innerHTML = `<li class="empty">Aucun coin favorable ce jour-là. Il faut en général 25 à 35 mm de pluie puis une à deux semaines d'attente.</li>`;
      return;
    }
    const f = dayFactors(state.day);
    $("spots").innerHTML = picked.map(({ i, la, lo }) => {
      let best = "";
      if (state.sp === "all") { let m = -1; SPECIES.forEach((s, k) => { const v = cellScore(i, k, f); if (v > m) { m = v; best = s.name; } }); }
      return `<li tabindex="0" data-i="${i}"><span class="score" style="background:${solid(a[i])}">${a[i]}</span>
        <span class="where"><b>${placeLabel(la, lo)}</b><span>${best ? best + " · " : ""}${elevOf(i)} m · ${COVER[coverOf(i)]}</span></span>
        <span class="km">${km(B.center[0], B.center[1], la, lo).toFixed(0)} km</span></li>`;
    }).join("");
  }

  function rainChart(w) {
    const n = w.rain.length, Wd = 320, Hh = 76, bw = Wd / n, max = Math.max(20, ...w.rain), base = Hh - 14;
    let s = `<svg class="rain" viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Pluie journalière sur ${n} jours">`;
    for (let d = 0; d < n; d++) {
      const h = w.rain[d] / max * (base - 4), fut = d > state.todayIdx;
      s += `<rect x="${d * bw + 1}" y="${base - h}" width="${bw - 2}" height="${h}" fill="${fut ? "var(--muted)" : "var(--moss)"}" opacity="${fut ? .55 : 1}"></rect>`;
    }
    const tx = (state.todayIdx + 0.5) * bw;
    s += `<line x1="${tx}" x2="${tx}" y1="0" y2="${base}" stroke="var(--accent)" stroke-dasharray="2 2"></line>`;
    s += `<text x="2" y="${Hh - 2}" font-size="10" fill="var(--muted)">-${PAST} j</text><text x="${tx}" y="${Hh - 2}" font-size="10" fill="var(--accent)" text-anchor="middle">auj.</text><text x="${Wd - 2}" y="${Hh - 2}" font-size="10" fill="var(--muted)" text-anchor="end">+${FUTURE - 1} j</text>`;
    return s + `<text x="${Wd - 2}" y="10" font-size="10" fill="var(--muted)" text-anchor="end">max ${Math.round(max)} mm</text></svg>`;
  }

  let selLayer = null;
  function showDetail(i) {
    state.sel = i;
    const r = Math.floor(i / COLS), c = i % COLS, la = cellLat(r), lo = cellLon(c);
    selLayer && selLayer.remove();
    selLayer = L.layerGroup([
      L.rectangle([[B.N - (r + 1) * DLAT, B.W + c * DLON], [B.N - r * DLAT, B.W + (c + 1) * DLON]], { color: "#1a5fb4", weight: 2.5, fill: false, interactive: false }),
      L.circleMarker([la, lo], { radius: 3, color: "#1a5fb4", fillOpacity: 1, interactive: false })
    ]).addTo(map);
    const el = $("detail"); el.hidden = false;
    let body = `<h3>${placeLabel(la, lo)}</h3><div class="note" style="margin:0">${la.toFixed(5)}, ${lo.toFixed(5)} · case de ${cellM} m · ${km(B.center[0], B.center[1], la, lo).toFixed(1)} km d'Aix</div>`;
    if (!(RCH[i] & 128)) { el.innerHTML = body + `<p class="note">Hors de la zone des ${B.radiusKm} km.</p>`; return; }
    const kv = `<dt>Couvert</dt><dd>${coverLabel(i)}</dd><dt>Altitude</dt><dd>${elevOf(i)} m, ${aspectLabel(i)}</dd><dt>Relief</dt><dd>${TPI_LABEL[tpiOf(i)]}</dd>`;
    if (!coverOf(i)) { el.innerHTML = body + `<dl class="kv">${kv}</dl><p class="note">Indice nul : ni forêt, ni garrigue, ni prairie cartographiée sur cette case.</p>` + links(la, lo); return; }
    const f = dayFactors(state.day), m = medOf(i), w = state.med[m], d = state.todayIdx + state.day, z = elevOf(i);
    const rows = SPECIES.map((sp, k) => ({ sp, s: cellScore(i, k, f) })).sort((x, y) => y.s - x.s);
    let cum = 0; for (let k = Math.max(0, state.todayIdx - 14); k <= state.todayIdx; k++) cum += w.rain[k];
    let fut = 0; for (let k = state.todayIdx + 1; k < w.rain.length; k++) fut += w.rain[k];
    const wx = Model.weather(SPECIES[0], w, d, dayDate(state.day));
    body += `<div class="bars">` + rows.map(({ sp, s }) => `<div class="bar"><span>${sp.name}</span><span class="t"><span style="width:${s}%;background:${solid(s)}"></span></span><span class="v">${Math.round(s)}</span></div>`).join("") + `</div>`;
    body += `<h2 style="margin-top:12px">Pluie</h2>` + rainChart(w);
    body += `<dl class="kv">${kv}
      <dt>Pluie 15 derniers jours</dt><dd>${cum.toFixed(0)} mm</dd>
      <dt>Pluie prévue 6 j</dt><dd>${fut.toFixed(0)} mm</dd>
      <dt>Humidité du sol</dt><dd>${(wx.sm * 100).toFixed(0)} % vol. (${wx.sm < 0.13 ? "sec" : wx.sm < 0.22 ? "frais" : "humide"})</dd>
      <dt>Humidité de l'air</dt><dd>${wx.rh.toFixed(0)} %</dd>
      <dt>Temp. moy. 7 j</dt><dd>${(interp(f.tm, neighbours(i)) - LAPSE * z).toFixed(1)} °C (min ${(interp(f.tn, neighbours(i)) - LAPSE * z).toFixed(1)} °C)</dd></dl>`;
    el.innerHTML = body + links(la, lo);
  }
  function links(la, lo) {
    const c = `${la.toFixed(5)},${lo.toFixed(5)}`;
    return `<div class="links"><a href="https://www.google.com/maps/dir/?api=1&destination=${c}" target="_blank" rel="noopener">Itinéraire</a>
      <a href="https://www.geoportail.gouv.fr/carte?c=${lo.toFixed(5)},${la.toFixed(5)}&z=17&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&permalink=yes" target="_blank" rel="noopener">Géoportail</a>
      <button type="button" class="btn" id="copy">Copier les coordonnées</button></div>`;
  }

  function cellAt(lat, lon) {
    const r = Math.floor((B.N - lat) / DLAT), c = Math.floor((lon - B.W) / DLON);
    return r < 0 || c < 0 || r >= ROWS || c >= COLS ? -1 : r * COLS + c;
  }

  function render() {
    computeScores();
    overlay.redraw();
    renderSpecies(); renderDays(); renderSpots();
    if (state.sel != null) showDetail(state.sel);
  }
  const busy = (fn) => { setStatus("Calcul…", "load"); setTimeout(() => { fn(); setStatus(state.statusText); }, 20); };

  $("species").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; state.sp = b.dataset.id; save(); busy(render); });
  $("days").addEventListener("click", (e) => { const b = e.target.closest(".day"); if (!b) return; state.day = +b.dataset.o; busy(render); });
  function spotGo(e) {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const i = +li.dataset.i; map.flyTo([cellLat(Math.floor(i / COLS)), cellLon(i % COLS)], 17); showDetail(i);
    if (window.innerWidth <= 760) $("detail").scrollIntoView({ behavior: "smooth" });
  }
  $("spots").addEventListener("click", spotGo);
  $("spots").addEventListener("keydown", (e) => { if (e.key === "Enter") spotGo(e); });
  $("detail").addEventListener("click", (e) => {
    if (e.target.id !== "copy" || state.sel == null) return;
    const t = `${cellLat(Math.floor(state.sel / COLS)).toFixed(5)}, ${cellLon(state.sel % COLS).toFixed(5)}`;
    navigator.clipboard?.writeText(t).then(() => { e.target.textContent = "Copié"; }, () => { e.target.textContent = t; });
  });
  $("opacity").addEventListener("input", (e) => overlay.setOpacity(e.target.value / 100));
  map.on("click", (e) => { if (!state.scores) return; const i = cellAt(e.latlng.lat, e.latlng.lng); if (i >= 0) showDetail(i); });

  function save() { try { localStorage.setItem("champiAix.sp", state.sp); } catch (_) { } }
  try { const s = localStorage.getItem("champiAix.sp"); if (s && (s === "all" || SPECIES.some(x => x.id === s))) state.sp = s; } catch (_) { }

  function apply(wx) {
    state.weather = wx;
    const t = wx.points[0].time.indexOf(todayStr());
    state.todayIdx = t >= 0 ? t : PAST;
    state.med = buildMed(wx);
    dayCache.clear(); maxCache.clear();
    const at = new Date(wx.fetchedAt);
    state.statusText = `Météo du ${at.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    render();
    setStatus(state.statusText);
  }

  async function load(force) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (_) { }
    if (cached && (!cached.points || cached.points.length !== WN * WN)) cached = null;
    const fresh = cached && cached.day === todayStr() && Date.now() - cached.fetchedAt < MAX_AGE_H * 3600e3;
    if (cached && !state.weather) apply(cached);
    if (fresh && !force) return;
    setStatus("Mise à jour de la météo…", "load");
    try {
      const wx = await fetchWeather();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(wx)); } catch (_) { }
      apply(wx);
    } catch (err) {
      console.error(err);
      if (state.weather) setStatus("Hors ligne : dernière météo enregistrée affichée", "err");
      else setStatus(String(err.message).includes("429") ? "Quota Open-Meteo dépassé. Réessayez dans une heure." : "Impossible de joindre Open-Meteo. Vérifiez la connexion puis Actualiser.", "err");
    }
  }
  $("refresh").addEventListener("click", () => load(true));
  setInterval(() => load(false), 30 * 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.med) load(false); });

  setStatus("Préparation de la carte…", "load");
  decodeBiotope().then(() => load(false), (e) => setStatus("Erreur : " + e.message, "err"));
})();
