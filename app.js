(function () {
  const B = window.BIOTOPE, SPECIES = window.SPECIES, Model = window.Model;
  const ROWS = B.rows, COLS = B.cols, NC = ROWS * COLS;
  const PAST = 20, FUTURE = 7;           // jours d'historique et de prévision
  const WN = 7;                          // grille météo WN x WN (~15 km entre points)
  const CACHE_KEY = "champiAix.weather.v1";
  const MAX_AGE_H = 6;

  const $ = (id) => document.getElementById(id);
  const state = { sp: "all", day: 0, weather: null, cellW: null, scores: null, marker: null, sel: null };

  // ---------- biotope par maille ----------
  const bio = new Array(NC);
  (function prepBio() {
    const dy = B.dlat * 111320;
    for (let r = 0; r < ROWS; r++) {
      const lat = B.N - (r + 0.5) * B.dlat;
      const dx = B.dlon * 111320 * Math.cos(lat * Math.PI / 180);
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const z = (rr, cc) => B.elev[Math.min(ROWS - 1, Math.max(0, rr)) * COLS + Math.min(COLS - 1, Math.max(0, cc))];
        const gx = (z(r, c + 1) - z(r, c - 1)) / (2 * dx);
        const gy = (z(r - 1, c) - z(r + 1, c)) / (2 * dy); // > 0 : ça monte vers le nord
        const slope = Math.hypot(gx, gy);
        bio[i] = {
          conifer: B.conifer[i] / 100, broad: B.broad[i] / 100, mixed: B.mixed[i] / 100,
          unknown: B.unknown[i] / 100, meadow: B.meadow[i] / 100, scrub: (B.scrub ? B.scrub[i] : 0) / 100, elev: B.elev[i],
          slope, northness: slope > 1e-4 ? gy / slope * -1 : 0, gx, inside: B.inside[i] === 1,
          lat, lon: B.W + (c + 0.5) * B.dlon
        };
        bio[i].forest = bio[i].conifer + bio[i].broad + bio[i].mixed + bio[i].unknown;
      }
    }
  })();

  // ---------- météo ----------
  const wLats = [], wLons = [];
  for (let k = 0; k < WN; k++) {
    wLats.push(B.S + (B.N - B.S) * k / (WN - 1));
    wLons.push(B.W + (B.E - B.W) * k / (WN - 1));
  }

  async function fetchWeather() {
    const pts = [];
    for (const la of wLats) for (const lo of wLons) pts.push([la, lo]);
    const vars = "precipitation_sum,temperature_2m_mean,temperature_2m_min,relative_humidity_2m_mean,soil_moisture_0_to_7cm_mean";
    const out = [];
    for (let i = 0; i < pts.length; i += 25) {
      const ch = pts.slice(i, i + 25);
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + ch.map(p => p[0].toFixed(3)).join(",")
        + "&longitude=" + ch.map(p => p[1].toFixed(3)).join(",")
        + "&daily=" + vars + "&past_days=" + PAST + "&forecast_days=" + FUTURE + "&timezone=Europe%2FParis";
      let res = await fetch(url);
      for (let attempt = 0; res.status === 429 && attempt < 2; attempt++) {
        setStatus("Quota Open-Meteo atteint, nouvelle tentative dans une minute…", "load");
        await new Promise(r => setTimeout(r, 65e3));
        res = await fetch(url);
      }
      if (!res.ok) throw new Error("Open-Meteo a répondu " + res.status);
      const js = await res.json();
      (Array.isArray(js) ? js : [js]).forEach(p => out.push({
        elev: p.elevation, time: p.daily.time,
        rain: p.daily.precipitation_sum, tmean: p.daily.temperature_2m_mean, tmin: p.daily.temperature_2m_min,
        rh: p.daily.relative_humidity_2m_mean, soil: p.daily.soil_moisture_0_to_7cm_mean
      }));
    }
    return { fetchedAt: Date.now(), day: todayStr(), points: out };
  }

  function todayStr() {
    return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
  }

  function fill(a, def) { // bouche les trous éventuels
    let last = def;
    return a.map(v => (v == null || Number.isNaN(v)) ? last : (last = v));
  }

  // interpolation bilinéaire vers chaque maille + correction d'altitude de la température
  function buildCellWeather(wx) {
    const P = wx.points.map(p => ({
      elev: p.elev, rain: fill(p.rain, 0), tmean: fill(p.tmean, 12), tmin: fill(p.tmin, 8),
      rh: fill(p.rh, 65), soil: fill(p.soil, 0.15)
    }));
    const nd = wx.points[0].time.length;
    const cw = new Array(NC);
    for (let i = 0; i < NC; i++) {
      const b = bio[i];
      if (!b.inside || b.forest + b.meadow + b.scrub < 0.02) continue;
      const fy = (b.lat - B.S) / (B.N - B.S) * (WN - 1), fx = (b.lon - B.W) / (B.E - B.W) * (WN - 1);
      const y0 = Math.min(WN - 2, Math.floor(fy)), x0 = Math.min(WN - 2, Math.floor(fx));
      const ty = fy - y0, tx = fx - x0;
      const nb = [[y0, x0, (1 - ty) * (1 - tx)], [y0, x0 + 1, (1 - ty) * tx], [y0 + 1, x0, ty * (1 - tx)], [y0 + 1, x0 + 1, ty * tx]];
      const o = { rain: new Float32Array(nd), tmean: new Float32Array(nd), tmin: new Float32Array(nd), rh: new Float32Array(nd), soil: new Float32Array(nd) };
      let pe = 0;
      for (const [yy, xx, w] of nb) {
        const p = P[yy * WN + xx]; pe += p.elev * w;
        for (let d = 0; d < nd; d++) {
          o.rain[d] += p.rain[d] * w; o.tmean[d] += p.tmean[d] * w; o.tmin[d] += p.tmin[d] * w;
          o.rh[d] += p.rh[d] * w; o.soil[d] += p.soil[d] * w;
        }
      }
      const dT = -0.0065 * (b.elev - pe);
      for (let d = 0; d < nd; d++) { o.tmean[d] += dT; o.tmin[d] += dT; }
      cw[i] = o;
    }
    return cw;
  }

  // ---------- calcul des indices ----------
  function dayIndex(offset) { return state.todayIdx + offset; }
  function dayDate(offset) { const d = new Date(state.weather.points[0].time[dayIndex(offset)] + "T12:00:00"); return d; }

  function computeDay(offset) {
    const d = dayIndex(offset), date = dayDate(offset);
    const per = {};
    for (const sp of SPECIES) per[sp.id] = new Float32Array(NC);
    const all = new Float32Array(NC);
    for (let i = 0; i < NC; i++) {
      const w = state.cellW[i];
      if (!w) continue;
      let m = 0;
      for (const sp of SPECIES) {
        const s = Model.score(sp, bio[i], w, d, date).total;
        per[sp.id][i] = s; if (s > m) m = s;
      }
      all[i] = m;
    }
    per.all = all;
    return per;
  }

  const dayCache = new Map();
  function scoresFor(offset) {
    if (!dayCache.has(offset)) dayCache.set(offset, computeDay(offset));
    return dayCache.get(offset);
  }

  // ---------- couleurs ----------
  const STOPS = [[10, [241, 226, 140], 0], [22, [241, 226, 140], .6], [38, [236, 178, 52], .72], [55, [222, 106, 30], .8], [72, [180, 40, 24], .85], [88, [100, 16, 30], .9]];
  function ramp(s) {
    if (s <= STOPS[0][0]) return null;
    for (let k = 1; k < STOPS.length; k++) {
      if (s <= STOPS[k][0]) {
        const [a, ca, aa] = STOPS[k - 1], [b, cb, ab] = STOPS[k], t = (s - a) / (b - a);
        return [0, 1, 2].map(j => Math.round(ca[j] + (cb[j] - ca[j]) * t)).concat(aa + (ab - aa) * t);
      }
    }
    const l = STOPS[STOPS.length - 1]; return l[1].concat(l[2]);
  }
  const css = (s) => { const c = ramp(Math.max(s, 23)); return `rgb(${c[0]},${c[1]},${c[2]})`; };

  // ---------- carte ----------
  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(B.center, 10);
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, className: "muted", attribution: "© OpenTopoMap, © OpenStreetMap" });
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "muted", attribution: "© OpenStreetMap" });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "© Esri" });
  topo.addTo(map);
  const bounds = [[B.S, B.W], [B.N, B.E]];
  const overlay = L.imageOverlay("data:image/gif;base64,R0lGODlhAQABAAAAACw=", bounds, { opacity: 1, interactive: false }).addTo(map);
  const zone = L.circle(B.center, { radius: B.radiusKm * 1000, color: "#a3461f", weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
  map.fitBounds(zone.getBounds(), { padding: [8, 8] });
  L.circleMarker(B.center, { radius: 4, color: "#1d2620", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Aix-en-Provence").addTo(map);
  L.control.layers({ "Relief": topo, "Plan": osm, "Satellite": sat }, { "Indice de pousse": overlay }, { position: "topright" }).addTo(map);

  const Locate = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create("div", "leaflet-bar");
      b.innerHTML = '<a href="#" class="locate" title="Ma position" role="button" aria-label="Ma position">◎</a>';
      L.DomEvent.on(b, "click", (e) => { L.DomEvent.preventDefault(e); map.locate({ setView: true, maxZoom: 13 }); });
      return b;
    }
  });
  new Locate({ position: "topleft" }).addTo(map);
  let me = null;
  map.on("locationfound", (e) => { me && me.remove(); me = L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#2b6cb0", fillOpacity: 1 }).addTo(map); });
  map.on("locationerror", () => setStatus("Position indisponible dans ce navigateur", "err", true));

  const SCALE = 8;
  const small = document.createElement("canvas"); small.width = COLS; small.height = ROWS;
  const big = document.createElement("canvas"); big.width = COLS * SCALE; big.height = ROWS * SCALE;
  function drawOverlay(arr) {
    const sctx = small.getContext("2d"), img = sctx.createImageData(COLS, ROWS);
    for (let i = 0; i < NC; i++) {
      const c = ramp(arr[i]);
      if (!c) continue;
      img.data.set([c[0], c[1], c[2], Math.round(c[3] * 255)], i * 4);
    }
    sctx.putImageData(img, 0, 0);
    const g = big.getContext("2d");
    g.clearRect(0, 0, big.width, big.height);
    g.save();
    // découpe le cercle de 50 km (ellipse en coordonnées de grille)
    const cx = (B.center[1] - B.W) / B.dlon * SCALE, cy = (B.N - B.center[0]) / B.dlat * SCALE;
    const ry = B.radiusKm / 111.32 / B.dlat * SCALE, rx = B.radiusKm / (111.32 * Math.cos(B.center[0] * Math.PI / 180)) / B.dlon * SCALE;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(small, 0, 0, big.width, big.height);
    g.restore();
    overlay.setUrl(big.toDataURL());
  }

  // ---------- lieux ----------
  function km(a, b, c, d) {
    const R = 6371, p = Math.PI / 180;
    const h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function nearestPlace(lat, lon, minRank = 1) {
    let best = null, bd = 1e9;
    for (const p of B.places) {
      if (p[3] < minRank) continue;
      const d = km(lat, lon, p[1], p[2]);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { name: best[0], km: bd } : { name: "?", km: 0 };
  }
  function covertLabel(b) {
    const parts = [];
    if (b.conifer > 0.05) parts.push(["pins / résineux", b.conifer]);
    if (b.broad > 0.05) parts.push(["feuillus (chênes…)", b.broad]);
    if (b.mixed > 0.05) parts.push(["forêt mixte", b.mixed]);
    if (b.unknown > 0.05) parts.push(["bois (essence non précisée)", b.unknown]);
    if (b.meadow > 0.05) parts.push(["prairie", b.meadow]);
    if (b.scrub > 0.05) parts.push(["garrigue", b.scrub]);
    parts.sort((x, y) => y[1] - x[1]);
    return parts.length ? parts.map(p => `${p[0]} ${Math.round(p[1] * 100)} %`).join(", ") : "peu de couvert favorable";
  }
  function aspectLabel(b) {
    if (b.slope < 0.04) return "terrain plat";
    const ang = Math.atan2(-b.gx, b.northness * b.slope) * 180 / Math.PI; // direction de la pente descendante
    const dirs = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
    return "versant " + dirs[Math.round(((ang + 360) % 360) / 45) % 8] + (b.northness > 0.5 ? " (ubac, frais)" : b.northness < -0.5 ? " (adret, sec)" : "");
  }

  // ---------- interface ----------
  function setStatus(txt, kind, transient) {
    const prev = $("status").textContent;
    $("status").textContent = txt; $("dot").className = "dot" + (kind ? " " + kind : "");
    if (transient) setTimeout(() => { $("status").textContent = prev; $("dot").className = "dot"; }, 3500);
  }

  function renderSpecies() {
    const cur = scoresFor(state.day);
    const list = [{ id: "all", name: "Toutes" }].concat(SPECIES);
    $("species").innerHTML = list.map(s => {
      let mx = 0; const a = cur[s.id]; for (let i = 0; i < NC; i++) if (a[i] > mx) mx = a[i];
      return `<button type="button" class="chip" data-id="${s.id}" aria-pressed="${s.id === state.sp}">${s.name}<span class="n">${Math.round(mx)}</span></button>`;
    }).join("");
    const sp = SPECIES.find(s => s.id === state.sp);
    $("spnote").innerHTML = sp ? `<i>${sp.latin}</i>. ${sp.note}` : "Meilleur indice toutes espèces confondues. Le chiffre sur chaque espèce est son meilleur indice dans la zone ce jour-là.";
  }

  function renderDays() {
    const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
    let html = "";
    for (let o = 0; o < FUTURE; o++) {
      const a = scoresFor(o)[state.sp];
      let mx = 0; for (let i = 0; i < NC; i++) if (a[i] > mx) mx = a[i];
      const d = dayDate(o);
      const lab = o === 0 ? "auj." : fmt.format(d).replace(".", "");
      html += `<button type="button" class="day" data-o="${o}" aria-pressed="${o === state.day}" title="Meilleur indice : ${Math.round(mx)}">${lab}<b>${d.getDate()}</b><i style="background:${mx > 10 ? css(mx) : ""}"></i></button>`;
    }
    $("days").innerHTML = html;
  }

  function renderSpots() {
    const a = scoresFor(state.day)[state.sp];
    const idx = [];
    for (let i = 0; i < NC; i++) if (a[i] >= 20) idx.push(i);
    idx.sort((x, y) => a[y] - a[x]);
    const picked = [];
    for (const i of idx) {
      if (picked.length >= 8) break;
      if (picked.every(j => km(bio[i].lat, bio[i].lon, bio[j].lat, bio[j].lon) > 5)) picked.push(i);
    }
    if (!picked.length) {
      $("spots").innerHTML = `<li class="empty" style="cursor:default;display:block">Aucun coin favorable ce jour-là. Il faut en général 25 à 35 mm de pluie puis une à deux semaines d'attente.</li>`;
      return;
    }
    $("spots").innerHTML = picked.map(i => {
      const b = bio[i], p = nearestPlace(b.lat, b.lon);
      const best = state.sp === "all" ? SPECIES.reduce((m, s) => scoresFor(state.day)[s.id][i] > scoresFor(state.day)[m.id][i] ? s : m, SPECIES[0]).name : "";
      return `<li tabindex="0" data-i="${i}"><span class="score" style="background:${css(a[i])}">${Math.round(a[i])}</span>
        <span class="where"><b>près de ${p.name}</b><span>${best ? best + " · " : ""}${b.elev} m · ${covertLabel(b).split(",")[0]}</span></span>
        <span class="km">${Math.round(km(B.center[0], B.center[1], b.lat, b.lon))} km</span></li>`;
    }).join("");
  }

  function rainChart(w) {
    const n = w.rain.length, W = 320, H = 76, bw = W / n, max = Math.max(20, ...w.rain);
    let s = `<svg class="rain" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pluie journalière sur ${n} jours">`;
    const base = H - 14;
    for (let d = 0; d < n; d++) {
      const h = w.rain[d] / max * (base - 4), fut = d > state.todayIdx;
      s += `<rect x="${d * bw + 1}" y="${base - h}" width="${bw - 2}" height="${h}" fill="${fut ? "var(--muted)" : "var(--moss)"}" opacity="${fut ? .55 : 1}"></rect>`;
    }
    const tx = (state.todayIdx + 0.5) * bw;
    s += `<line x1="${tx}" x2="${tx}" y1="0" y2="${base}" stroke="var(--accent)" stroke-dasharray="2 2"></line>`;
    s += `<text x="2" y="${H - 2}" font-size="10" fill="var(--muted)">-${PAST} j</text><text x="${tx}" y="${H - 2}" font-size="10" fill="var(--accent)" text-anchor="middle">auj.</text><text x="${W - 2}" y="${H - 2}" font-size="10" fill="var(--muted)" text-anchor="end">+${FUTURE - 1} j</text>`;
    s += `<text x="${W - 2}" y="10" font-size="10" fill="var(--muted)" text-anchor="end">max ${Math.round(max)} mm</text></svg>`;
    return s;
  }

  function showDetail(i, latlng) {
    state.sel = i;
    const b = bio[i], w = state.cellW && state.cellW[i];
    const ll = latlng || L.latLng(b.lat, b.lon);
    state.marker && state.marker.remove();
    state.marker = L.marker(ll).addTo(map);
    const el = $("detail"); el.hidden = false;
    const p = nearestPlace(ll.lat, ll.lng), h = nearestPlace(ll.lat, ll.lng, 0);
    const where = h.name !== p.name && h.km < p.km ? `${h.name}, près de ${p.name}` : `près de ${p.name}`;
    const coords = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
    let body = `<h3>${where}</h3><div class="note" style="margin:0">${coords} · ${Math.round(km(B.center[0], B.center[1], ll.lat, ll.lng))} km d'Aix</div>`;
    if (!b.inside) { el.innerHTML = body + `<p class="note">Hors de la zone des 50 km.</p>`; return; }
    if (!w) {
      el.innerHTML = body + `<dl class="kv"><dt>Altitude</dt><dd>${b.elev} m</dd><dt>Couvert</dt><dd>${covertLabel(b)}</dd></dl><p class="note">Pas de forêt, garrigue ni prairie cartographiée ici : indice nul.</p>` + links(ll);
      return;
    }
    const d = dayIndex(state.day), date = dayDate(state.day);
    const rows = SPECIES.map(sp => ({ sp, r: Model.score(sp, b, w, d, date) })).sort((x, y) => y.r.total - x.r.total);
    const top = rows[0].r;
    let cum15 = 0; for (let k = Math.max(0, state.todayIdx - 14); k <= state.todayIdx; k++) cum15 += w.rain[k];
    let fut = 0; for (let k = state.todayIdx + 1; k < w.rain.length; k++) fut += w.rain[k];
    body += `<div class="bars">` + rows.map(({ sp, r }) => `<div class="bar"><span>${sp.name}</span><span class="t"><span style="width:${r.total}%;background:${css(r.total)}"></span></span><span class="v">${Math.round(r.total)}</span></div>`).join("") + `</div>`;
    body += `<h2 style="margin-top:12px">Pluie</h2>` + rainChart(w);
    body += `<dl class="kv">
      <dt>Pluie 15 derniers jours</dt><dd>${cum15.toFixed(0)} mm</dd>
      <dt>Pluie prévue 6 j</dt><dd>${fut.toFixed(0)} mm</dd>
      <dt>Humidité du sol</dt><dd>${(top.sm * 100).toFixed(0)} % vol. (${top.sm < 0.13 ? "sec" : top.sm < 0.22 ? "frais" : "humide"})</dd>
      <dt>Humidité de l'air</dt><dd>${top.rh.toFixed(0)} %</dd>
      <dt>Temp. moy. 7 j</dt><dd>${top.tm.toFixed(1)} °C (min ${top.tmin.toFixed(1)} °C)</dd>
      <dt>Altitude</dt><dd>${b.elev} m, ${aspectLabel(b)}</dd>
      <dt>Couvert</dt><dd>${covertLabel(b)}</dd></dl>`;
    el.innerHTML = body + links(ll);
  }
  function links(ll) {
    const c = `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;
    return `<div class="links"><a href="https://www.google.com/maps/dir/?api=1&destination=${c}" target="_blank" rel="noopener">Itinéraire</a>
      <a href="https://www.geoportail.gouv.fr/carte?c=${ll.lng.toFixed(5)},${ll.lat.toFixed(5)}&z=15&l0=GEOGRAPHICALGRIDSYSTEMS.MAPS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes" target="_blank" rel="noopener">Carte IGN</a>
      <button type="button" class="btn" id="copy">Copier les coordonnées</button></div>`;
  }

  function cellAt(lat, lon) {
    const r = Math.floor((B.N - lat) / B.dlat), c = Math.floor((lon - B.W) / B.dlon);
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return -1;
    return r * COLS + c;
  }

  function render() {
    drawOverlay(scoresFor(state.day)[state.sp]);
    renderSpecies(); renderDays(); renderSpots();
    if (state.sel != null) showDetail(state.sel, state.marker && state.marker.getLatLng());
  }

  $("species").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; state.sp = b.dataset.id; save(); render(); });
  $("days").addEventListener("click", (e) => { const b = e.target.closest(".day"); if (!b) return; state.day = +b.dataset.o; render(); });
  function spotGo(e) {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const i = +li.dataset.i; map.flyTo([bio[i].lat, bio[i].lon], 13); showDetail(i);
    if (window.innerWidth <= 760) $("detail").scrollIntoView({ behavior: "smooth" });
  }
  $("spots").addEventListener("click", spotGo);
  $("spots").addEventListener("keydown", (e) => { if (e.key === "Enter") spotGo(e); });
  $("detail").addEventListener("click", (e) => {
    if (e.target.id !== "copy" || !state.marker) return;
    const ll = state.marker.getLatLng(), t = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
    navigator.clipboard?.writeText(t).then(() => { e.target.textContent = "Copié"; }, () => { e.target.textContent = t; });
  });
  map.on("click", (e) => { if (!state.cellW) return; const i = cellAt(e.latlng.lat, e.latlng.lng); if (i >= 0) showDetail(i, e.latlng); });

  function save() { try { localStorage.setItem("champiAix.sp", state.sp); } catch (_) { } }
  try { const s = localStorage.getItem("champiAix.sp"); if (s && (s === "all" || SPECIES.some(x => x.id === s))) state.sp = s; } catch (_) { }

  function apply(wx) {
    state.weather = wx;
    state.todayIdx = Math.max(0, wx.points[0].time.indexOf(todayStr()));
    if (wx.points[0].time.indexOf(todayStr()) < 0) state.todayIdx = PAST;
    state.cellW = buildCellWeather(wx);
    dayCache.clear();
    render();
    const t = new Date(wx.fetchedAt);
    setStatus(`Météo du ${t.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
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
  // la carte se remet à jour seule si la page reste ouverte (changement de jour ou météo > 6 h)
  setInterval(() => load(false), 30 * 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
  load(false);
})();
