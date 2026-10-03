// Modèle de pousse — même principe que les cartes de prévision mycologiques :
// pluie déclenchante (avec délai), humidité qui entretient, température, saison,
// et biotope (arbres hôtes, altitude, exposition). Tout est réglable ici.

// season : coefficient par mois (janv → déc), calé sur la Provence calcaire.
// host : affinité par type de couvert (fraction de la maille × affinité) ; scrub = garrigue.
// lag : fenêtre en jours entre la pluie et la sortie des champignons.
// rain : cumul (mm) dans cette fenêtre pour une poussée franche.
window.SPECIES = [
  {
    id: "sanguin", name: "Lactaire sanguin", latin: "Lactarius sanguifluus, L. deliciosus",
    host: { conifer: 1, mixed: 0.65, unknown: 0.6, broad: 0.05, meadow: 0, scrub: 0.45 },
    t: [3, 9, 17, 23], lag: [7, 16], rain: 30, alt: [0, 1300],
    season: [0.5, 0.2, 0.1, 0, 0, 0, 0, 0, 0.3, 0.9, 1, 0.8],
    note: "Sous les pins (pin d'Alep, pin sylvestre), souvent dans les aiguilles en lisière. L'espèce reine des massifs autour d'Aix."
  },
  {
    id: "cepe", name: "Cèpe", latin: "Boletus aereus, B. edulis, B. aestivalis",
    host: { broad: 1, mixed: 0.85, unknown: 0.7, conifer: 0.45, meadow: 0, scrub: 0.2 },
    t: [6, 13, 20, 26], lag: [6, 12], rain: 30, alt: [0, 1600],
    season: [0.05, 0, 0, 0, 0.2, 0.3, 0.1, 0.1, 0.6, 1, 0.8, 0.25],
    note: "Chênes verts, chênes pubescents, châtaigniers. Le cèpe bronzé (B. aereus) aime les chênaies chaudes."
  },
  {
    id: "petitgris", name: "Petit-gris", latin: "Tricholoma terreum",
    host: { conifer: 1, mixed: 0.6, unknown: 0.6, broad: 0.1, meadow: 0, scrub: 0.4 },
    t: [0, 6, 14, 20], lag: [8, 18], rain: 25, alt: [0, 1500],
    season: [0.6, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0.5, 1, 1],
    note: "En troupes sous les pins, tard en saison. Attention aux tricholomes toxiques ressemblants."
  },
  {
    id: "piedmouton", name: "Pied-de-mouton", latin: "Hydnum repandum",
    host: { mixed: 1, broad: 0.9, unknown: 0.7, conifer: 0.5, meadow: 0, scrub: 0.1 },
    t: [2, 8, 16, 22], lag: [8, 18], rain: 30, alt: [100, 1600],
    season: [0.3, 0.1, 0, 0, 0, 0, 0, 0.1, 0.4, 1, 1, 0.6],
    note: "Forêts fraîches, souvent en ronds. Plutôt en altitude et en ubac : Sainte-Baume, Concors."
  },
  {
    id: "trompette", name: "Trompette des morts", latin: "Craterellus cornucopioides",
    host: { broad: 1, mixed: 0.7, unknown: 0.5, conifer: 0.2, meadow: 0, scrub: 0.05 },
    t: [4, 10, 17, 23], lag: [8, 15], rain: 35, alt: [150, 1500],
    season: [0.1, 0, 0, 0, 0, 0, 0, 0.2, 0.6, 1, 0.8, 0.3],
    note: "Sous les feuillus dans les feuilles mortes, terrains frais et ombragés (hêtraie de la Sainte-Baume)."
  },
  {
    id: "girolle", name: "Girolle", latin: "Cantharellus cibarius",
    host: { mixed: 1, broad: 0.9, conifer: 0.7, unknown: 0.6, meadow: 0, scrub: 0.1 },
    t: [7, 13, 21, 27], lag: [5, 12], rain: 30, alt: [100, 1600], rarity: 0.65,
    season: [0, 0, 0, 0, 0.2, 0.6, 0.5, 0.4, 0.7, 0.9, 0.6, 0.1],
    note: "Préfère les sols décarbonatés ; plus rare sur le calcaire autour d'Aix, à chercher dans les zones siliceuses."
  },
  {
    id: "rose", name: "Rosé des prés", latin: "Agaricus campestris",
    host: { meadow: 1, unknown: 0.08, mixed: 0.05, broad: 0.05, conifer: 0.02, scrub: 0.1 },
    t: [6, 13, 21, 27], lag: [4, 10], rain: 20, alt: [0, 1500],
    season: [0, 0, 0.1, 0.3, 0.4, 0.2, 0.1, 0.3, 0.9, 1, 0.6, 0.1],
    note: "Prairies pâturées et pelouses non traitées. Ne pas confondre avec les amanites blanches mortelles."
  },
  {
    id: "coulemelle", name: "Coulemelle", latin: "Macrolepiota procera",
    host: { meadow: 0.8, broad: 0.5, mixed: 0.5, unknown: 0.45, conifer: 0.35, scrub: 0.3 },
    t: [6, 13, 21, 27], lag: [5, 12], rain: 25, alt: [0, 1500],
    season: [0, 0, 0, 0, 0.1, 0.3, 0.4, 0.6, 1, 1, 0.6, 0.1],
    note: "Lisières, clairières, bords de chemins. Ne ramasser que les grands sujets (> 10 cm) : petites lépiotes mortelles."
  },
  {
    id: "morille", name: "Morille", latin: "Morchella spp.",
    host: { broad: 0.9, mixed: 0.7, unknown: 0.5, conifer: 0.3, meadow: 0.1, scrub: 0.05 },
    t: [3, 8, 15, 21], lag: [7, 14], rain: 20, alt: [0, 1400],
    season: [0, 0.05, 0.6, 1, 0.6, 0.1, 0, 0, 0, 0, 0, 0],
    note: "Printemps : ripisylves, bords de la Durance, frênes et peupliers, zones brûlées l'année précédente."
  }
];

window.Model = (function () {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  function seasonAt(sp, date) {
    // interpolation entre les milieux de mois
    const m = date.getMonth(), d = date.getDate();
    const pos = m + (d - 15) / 30;
    const i0 = Math.floor(pos), f = pos - i0;
    const a = sp.season[(i0 + 12) % 12], b = sp.season[(i0 + 13) % 12];
    return a + (b - a) * f;
  }

  function tempFactor(sp, t) {
    const [lo, o1, o2, hi] = sp.t;
    if (t <= lo || t >= hi) return 0;
    if (t < o1) return (t - lo) / (o1 - lo);
    if (t > o2) return (hi - t) / (hi - o2);
    return 1;
  }

  // Pluie utile : poids 1 dans [lag0, lag1], 0,5 à ±2 jours des bords.
  function triggerRain(sp, rain, d) {
    let s = 0;
    for (let k = sp.lag[0] - 2; k <= sp.lag[1] + 2; k++) {
      const i = d - k;
      if (i < 0 || i >= rain.length) continue;
      const w = k < sp.lag[0] || k > sp.lag[1] ? 0.5 : 1;
      s += rain[i] * w;
    }
    return s;
  }

  function rainFactor(sp, mm) {
    const x = mm / sp.rain;
    return (x * x) / (x * x + 0.35);
  }

  function hostFactor(sp, bio) {
    const h = sp.host;
    const raw = (bio.conifer * (h.conifer || 0) + bio.broad * (h.broad || 0) + bio.mixed * (h.mixed || 0)
      + bio.unknown * (h.unknown || 0) + bio.meadow * (h.meadow || 0) + (bio.scrub || 0) * (h.scrub || 0));
    return (1 - Math.exp(-2.2 * raw)) / (1 - Math.exp(-2.2));
  }

  function altFactor(sp, z) {
    const [a, b] = sp.alt;
    if (z < a) return clamp(1 - (a - z) / 300);
    if (z > b) return clamp(1 - (z - b) / 300);
    return 1;
  }

  // Ubac (versant nord) plus frais et humide : bonus ; adret : malus.
  function aspectFactor(bio) {
    return 1 + 0.12 * bio.northness * clamp(bio.slope / 0.15);
  }

  // w : série météo locale {rain[], tmean[], tmin[], rh[], soil[]} ; d : index du jour visé.
  function score(sp, bio, w, d, date) {
    const season = seasonAt(sp, date);
    if (season <= 0) return { total: 0, season: 0 };
    const host = hostFactor(sp, bio);
    if (host < 0.02) return { total: 0, host };

    const trig = triggerRain(sp, w.rain, d);
    const R = rainFactor(sp, trig);

    let sm = 0, rh = 0, n = 0;
    for (let i = Math.max(0, d - 4); i <= d; i++) { sm += w.soil[i]; rh += w.rh[i]; n++; }
    sm /= n; rh /= n;
    const M = 0.6 * clamp((sm - 0.10) / 0.20) + 0.4 * clamp((rh - 50) / 35);

    let tm = 0, tmin = 99, nt = 0;
    for (let i = Math.max(0, d - 6); i <= d; i++) { tm += w.tmean[i]; nt++; }
    for (let i = Math.max(0, d - 3); i <= d; i++) tmin = Math.min(tmin, w.tmin[i]);
    tm /= nt;
    let T = tempFactor(sp, tm);
    if (tmin < -1) T *= 0.4; else if (tmin < 1) T *= 0.75;

    const A = altFactor(sp, bio.elev) * aspectFactor(bio);
    const total = clamp(R * (0.35 + 0.65 * M) * T * season * host * A * (sp.rarity || 1)) * 100;
    return { total, R, trig, M, sm, rh, T, tm, tmin, season, host, A };
  }

  return { score, seasonAt, hostFactor };
})();
