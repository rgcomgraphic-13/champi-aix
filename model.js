// Modèle de pousse — même principe que les cartes de prévision mycologiques :
// pluie déclenchante (avec délai), humidité qui entretient, température, saison,
// et biotope (essence forestière, altitude, exposition). Tout est réglable ici.

// Types de couvert de la grille (codes écrits par data/build_fine.py).
window.COVER = [
  null, "Pinède (pin d'Alep, pin sylvestre…)", null, "Autres résineux (cèdre, sapin…)",
  "Chênaie (chêne pubescent)", "Chênaie verte (chêne vert)", "Hêtraie", "Châtaigneraie",
  "Feuillus divers", "Forêt mixte, surtout résineux", "Forêt mixte, surtout feuillus",
  "Lande, garrigue", "Prairie, pelouse", "Peupleraie", "Coupe ou zone brûlée", "Bois (essence non précisée)"
];

// host : affinité de l'espèce pour chaque type de couvert (clés = codes ci-dessus).
//   pin 1, conif 3, chene 4, cheneVert 5, hetre 6, chataignier 7, feuillus 8,
//   mixteC 9, mixteF 10, lande 11, prairie 12, peupleraie 13, coupe 14, bois 15
// open : multiplicateur en forêt ouverte (clairsemée) ; edge : multiplicateur en lisière (défaut 1,08).
// season : coefficient par mois (janv → déc), calé sur la Provence calcaire.
// t : [min, début optimum, fin optimum, max] en °C (moyenne sur 7 jours).
// lag : fenêtre en jours entre la pluie et la sortie ; rain : cumul (mm) pour une poussée franche.
const H = (o) => { const a = new Array(16).fill(0); for (const k in o) a[+k] = o[k]; return a; };
window.SPECIES = [
  {
    id: "sanguin", name: "Lactaire sanguin", latin: "Lactarius sanguifluus, L. deliciosus",
    host: H({ 1: 1, 3: 0.5, 4: 0.05, 5: 0.1, 8: 0.05, 9: 0.85, 10: 0.45, 11: 0.35, 14: 0.1, 15: 0.5 }), open: 0.9, edge: 1.15,
    t: [3, 9, 17, 23], lag: [7, 16], rain: 30, alt: [0, 1300],
    season: [0.5, 0.2, 0.1, 0, 0, 0, 0, 0, 0.3, 0.9, 1, 0.8],
    note: "Sous les pins (pin d'Alep, pin sylvestre), souvent dans les aiguilles en lisière. L'espèce reine des massifs autour d'Aix."
  },
  {
    id: "cepe", name: "Cèpe", latin: "Boletus aereus, B. edulis, B. aestivalis",
    host: H({ 1: 0.4, 3: 0.5, 4: 1, 5: 0.9, 6: 1, 7: 1, 8: 0.7, 9: 0.7, 10: 0.9, 11: 0.15, 14: 0.05, 15: 0.6 }), open: 0.85, edge: 1.1,
    t: [6, 13, 20, 26], lag: [6, 12], rain: 30, alt: [0, 1600],
    season: [0.05, 0, 0, 0, 0.2, 0.3, 0.1, 0.1, 0.6, 1, 0.8, 0.25],
    note: "Chênes verts, chênes pubescents, châtaigniers, hêtres. Le cèpe bronzé (B. aereus) aime les chênaies chaudes."
  },
  {
    id: "petitgris", name: "Petit-gris", latin: "Tricholoma terreum",
    host: H({ 1: 1, 3: 0.5, 4: 0.05, 5: 0.05, 8: 0.05, 9: 0.75, 10: 0.4, 11: 0.3, 14: 0.1, 15: 0.5 }), open: 0.9,
    t: [0, 6, 14, 20], lag: [8, 18], rain: 25, alt: [0, 1500],
    season: [0.6, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0.5, 1, 1],
    note: "En troupes sous les pins, tard en saison. Attention aux tricholomes toxiques ressemblants."
  },
  {
    id: "piedmouton", name: "Pied-de-mouton", latin: "Hydnum repandum",
    host: H({ 1: 0.5, 3: 0.9, 4: 0.9, 5: 0.6, 6: 1, 7: 0.9, 8: 0.7, 9: 0.9, 10: 1, 11: 0.05, 15: 0.6 }), open: 0.75,
    t: [2, 8, 16, 22], lag: [8, 18], rain: 30, alt: [100, 1600],
    season: [0.3, 0.1, 0, 0, 0, 0, 0, 0.1, 0.4, 1, 1, 0.6],
    note: "Forêts fraîches, souvent en ronds. Plutôt en altitude et en ubac : Sainte-Baume, Concors."
  },
  {
    id: "trompette", name: "Trompette des morts", latin: "Craterellus cornucopioides",
    host: H({ 1: 0.1, 3: 0.3, 4: 1, 5: 0.5, 6: 1, 7: 0.8, 8: 0.7, 9: 0.4, 10: 0.8, 15: 0.45 }), open: 0.7, edge: 1,
    t: [4, 10, 17, 23], lag: [8, 15], rain: 35, alt: [150, 1500],
    season: [0.1, 0, 0, 0, 0, 0, 0, 0.2, 0.6, 1, 0.8, 0.3],
    note: "Sous les feuillus dans les feuilles mortes, terrains frais et ombragés (hêtraie de la Sainte-Baume)."
  },
  {
    id: "girolle", name: "Girolle", latin: "Cantharellus cibarius",
    host: H({ 1: 0.6, 3: 0.6, 4: 0.9, 5: 0.6, 6: 1, 7: 1, 8: 0.6, 9: 0.8, 10: 1, 11: 0.05, 15: 0.5 }), open: 0.8,
    t: [7, 13, 21, 27], lag: [5, 12], rain: 30, alt: [100, 1600], rarity: 0.65,
    season: [0, 0, 0, 0, 0.2, 0.6, 0.5, 0.4, 0.7, 0.9, 0.6, 0.1],
    note: "Préfère les sols décarbonatés ; plus rare sur le calcaire autour d'Aix, à chercher dans les zones siliceuses."
  },
  {
    id: "rose", name: "Rosé des prés", latin: "Agaricus campestris",
    host: H({ 11: 0.15, 12: 1, 13: 0.1, 14: 0.2, 15: 0.05 }), open: 1, edge: 1,
    t: [6, 13, 21, 27], lag: [4, 10], rain: 20, alt: [0, 1500],
    season: [0, 0, 0.1, 0.3, 0.4, 0.2, 0.1, 0.3, 0.9, 1, 0.6, 0.1],
    note: "Prairies pâturées et pelouses non traitées. Ne pas confondre avec les amanites blanches mortelles."
  },
  {
    id: "coulemelle", name: "Coulemelle", latin: "Macrolepiota procera",
    host: H({ 1: 0.3, 3: 0.3, 4: 0.5, 5: 0.3, 6: 0.4, 7: 0.5, 8: 0.5, 9: 0.4, 10: 0.5, 11: 0.4, 12: 0.8, 13: 0.4, 14: 0.5, 15: 0.4 }), open: 1.3, edge: 1.2,
    t: [6, 13, 21, 27], lag: [5, 12], rain: 25, alt: [0, 1500],
    season: [0, 0, 0, 0, 0.1, 0.3, 0.4, 0.6, 1, 1, 0.6, 0.1],
    note: "Lisières, clairières, bords de chemins. Ne ramasser que les grands sujets (> 10 cm) : petites lépiotes mortelles."
  },
  {
    id: "morille", name: "Morille", latin: "Morchella spp.",
    host: H({ 1: 0.2, 3: 0.4, 4: 0.5, 5: 0.2, 6: 0.4, 7: 0.3, 8: 0.8, 9: 0.3, 10: 0.5, 11: 0.05, 12: 0.1, 13: 1, 14: 0.6, 15: 0.4 }), open: 1,
    t: [3, 8, 15, 21], lag: [7, 14], rain: 20, alt: [0, 1400],
    season: [0, 0.05, 0.6, 1, 0.6, 0.1, 0, 0, 0, 0, 0, 0],
    note: "Printemps : ripisylves, peupleraies, bords de la Durance, zones brûlées l'année précédente."
  }
];

window.Model = (function () {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  function seasonAt(sp, date) {
    const pos = date.getMonth() + (date.getDate() - 15) / 30;
    const i0 = Math.floor(pos), f = pos - i0;
    const a = sp.season[(i0 + 12) % 12], b = sp.season[(i0 + 13) % 12];
    return a + (b - a) * f;
  }

  function tempFactor(sp, tm, tmin) {
    const [lo, o1, o2, hi] = sp.t;
    let T = tm <= lo || tm >= hi ? 0 : tm < o1 ? (tm - lo) / (o1 - lo) : tm > o2 ? (hi - tm) / (hi - o2) : 1;
    if (tmin < -1) T *= 0.4; else if (tmin < 1) T *= 0.75;
    return T;
  }

  // Pluie utile : poids 1 dans [lag0, lag1], 0,5 à ±2 jours des bords.
  function triggerRain(sp, rain, d) {
    let s = 0;
    for (let k = sp.lag[0] - 2; k <= sp.lag[1] + 2; k++) {
      const i = d - k;
      if (i < 0 || i >= rain.length) continue;
      s += rain[i] * (k < sp.lag[0] || k > sp.lag[1] ? 0.5 : 1);
    }
    return s;
  }

  // Partie météo (pluie, humidité, saison) commune à toute une maille météo.
  // w : série locale {rain[], rh[], soil[]} ; d : index du jour visé.
  function weather(sp, w, d, date) {
    const trig = triggerRain(sp, w.rain, d), x = trig / sp.rain;
    const R = (x * x) / (x * x + 0.35);
    let sm = 0, rh = 0, n = 0;
    for (let i = Math.max(0, d - 4); i <= d; i++) { sm += w.soil[i]; rh += w.rh[i]; n++; }
    sm /= n; rh /= n;
    const M = 0.6 * clamp((sm - 0.10) / 0.20) + 0.4 * clamp((rh - 50) / 35);
    const season = seasonAt(sp, date);
    return { f: R * (0.35 + 0.65 * M) * season * (sp.rarity || 1), R, trig, M, sm, rh, season };
  }

  function altFactor(sp, z) {
    const [a, b] = sp.alt;
    return z < a ? clamp(1 - (a - z) / 300) : z > b ? clamp(1 - (z - b) / 300) : 1;
  }

  // Partie site : essence, forêt ouverte, lisière, altitude, exposition (ubac -1..+1 → ±12 %),
  // position topographique (0 crête, 1 pente, 2 creux, 3 combe : les creux gardent l'humidité).
  const TPI = [0.88, 1, 1.08, 1.15];
  function site(sp, cover, open, elev, ubac, tpi, edge) {
    let h = sp.host[cover];
    if (!h) return 0;
    if (open) h = Math.min(1, h * sp.open);
    if (edge) h = Math.min(1, h * (sp.edge || 1.08));
    return h * altFactor(sp, elev) * (1 + 0.12 * ubac) * TPI[tpi];
  }

  return { weather, tempFactor, site, seasonAt, TPI };
})();
