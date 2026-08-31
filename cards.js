/* Les cartes à collectionner. Chacune récompense un succès précis : une condition
   annoncée d'avance, que l'on remplit ou non. Rien n'est tiré au sort — la rareté d'une
   carte dit exactement la difficulté de ce qu'il a fallu faire pour l'obtenir.

   Les quatorze cartes d'expert, une par ligne, ferment la marche : elles demandent de
   maîtriser une ligne des deux côtés, révision et voyage. */

const RARETES = [
  { nom: "Commune",     cle: "commune",  eclat: "#8b93a7" },
  { nom: "Peu commune", cle: "peu",      eclat: "#3b82f6" },
  { nom: "Rare",        cle: "rare",     eclat: "#a855f7" },
  { nom: "Épique",      cle: "epique",   eclat: "#f59e0b" },
  { nom: "Légendaire",  cle: "legende",  eclat: "#ef4444" },
];

const OBTENUS = "metro-succes";
const PARTIES = "metro-parties";

/* Le catalogue. Chaque succès reçoit un bilan de fin de partie et dit s'il est rempli.
   L'ordre des rangs est aussi celui de la difficulté : on ne décroche pas « quarante
   d'affilée » avant « cinq d'affilée ». */
const SUCCES = [
  // ---- communes : les premiers pas -------------------------------------
  { cle: "premier", rang: 0, tete: "🎫", nom: "Premier voyage",
    defi: "terminer une partie", test: b => b.questions > 0 },
  { cle: "mille", rang: 0, tete: "🪙", nom: "Ticket composté",
    defi: "marquer 1 000 points en une partie", test: b => b.score >= 1000 },
  { cle: "trois", rang: 0, tete: "🔗", nom: "Trois d'affilée",
    defi: "enchaîner 3 bonnes réponses", test: b => b.serie >= 3 },
  { cle: "quai", rang: 0, tete: "🎯", nom: "Pile sur le quai",
    defi: "viser une station à moins de 200 mètres", test: b => b.meilleureVisee <= 200 },
  { cle: "moitie", rang: 0, tete: "📖", nom: "La moitié du chemin",
    defi: "réussir la moitié des questions d'une partie",
    test: b => b.questions >= 8 && b.taux >= 0.5 },

  // ---- peu communes ----------------------------------------------------
  { cle: "cinq", rang: 1, tete: "🔥", nom: "Cinq d'affilée",
    defi: "enchaîner 5 bonnes réponses", test: b => b.serie >= 5 },
  { cle: "cinqmille", rang: 1, tete: "💶", nom: "Carnet complet",
    defi: "marquer 5 000 points en une partie", test: b => b.score >= 5000 },
  { cle: "kilometre", rang: 1, tete: "🚇", nom: "Un kilomètre",
    defi: "parcourir 1 km en Voyage", test: b => b.distance >= 1000 },
  { cle: "dixstations", rang: 1, tete: "🚉", nom: "Dix arrêts",
    defi: "desservir 10 stations en un seul voyage", test: b => b.stations >= 10 },
  { cle: "habitue", rang: 1, tete: "🥖", nom: "Habitué du réseau",
    defi: "décrocher le grade d'habitué ou mieux",
    test: b => ["habitue", "poinconneur", "titi"].includes(b.grade) },

  // ---- rares -----------------------------------------------------------
  { cle: "dix", rang: 2, tete: "⚡", nom: "Dix d'affilée",
    defi: "enchaîner 10 bonnes réponses", test: b => b.serie >= 10 },
  { cle: "dixmille", rang: 2, tete: "💎", nom: "Dix mille",
    defi: "marquer 10 000 points en une partie", test: b => b.score >= 10000 },
  { cle: "cinqkm", rang: 2, tete: "🛤️", nom: "Cinq kilomètres",
    defi: "parcourir 5 km en Voyage", test: b => b.distance >= 5000 },
  { cle: "poinconneur", rang: 2, tete: "🎺", nom: "Poinçonneur",
    defi: "décrocher le grade de poinçonneur ou mieux",
    test: b => ["poinconneur", "titi"].includes(b.grade) },
  { cle: "precis", rang: 2, tete: "📍", nom: "Au mètre près",
    defi: "viser une station à moins de 50 mètres", test: b => b.meilleureVisee <= 50 },

  // ---- épiques ---------------------------------------------------------
  { cle: "sansfaute", rang: 3, tete: "✨", nom: "Sans une faute",
    defi: "réussir toutes les questions d'une Exploration",
    test: b => b.mode === "metro" && b.questions >= 20 && b.taux === 1 },
  { cle: "vingt", rang: 3, tete: "🌪️", nom: "Vingt d'affilée",
    defi: "enchaîner 20 bonnes réponses", test: b => b.serie >= 20 },
  { cle: "vingtmille", rang: 3, tete: "👑", nom: "Vingt mille",
    defi: "marquer 20 000 points en une partie", test: b => b.score >= 20000 },
  { cle: "dixkm", rang: 3, tete: "🧭", nom: "Dix kilomètres",
    defi: "parcourir 10 km en Voyage", test: b => b.distance >= 10000 },
  { cle: "titi", rang: 3, tete: "🤌", nom: "Titi parisien",
    defi: "décrocher le meilleur grade", test: b => b.grade === "titi" },

  // ---- légendaires -----------------------------------------------------
  { cle: "bouclee", rang: 4, tete: "🔁", nom: "Ligne bouclée",
    defi: "traverser une ligne d'un terminus à l'autre sans faute",
    test: b => b.bouclee },
  { cle: "quarante", rang: 4, tete: "☄️", nom: "Quarante d'affilée",
    defi: "enchaîner 40 bonnes réponses", test: b => b.serie >= 40 },
  { cle: "vingtkm", rang: 4, tete: "🌍", nom: "Vingt kilomètres",
    defi: "parcourir 20 km en un seul voyage", test: b => b.distance >= 20000 },
  { cle: "assidu", rang: 4, tete: "📅", nom: "Usager assidu",
    defi: "jouer cinquante parties", test: b => b.parties >= 50 },
  { cle: "reseau", rang: 4, tete: "🏆", nom: "Maître du réseau",
    defi: "maîtriser les quatorze lignes", test: b => b.maitrisees >= 14 },
];

const parCle = new Map(SUCCES.map(s => [s.cle, s]));

let obtenus = new Set();         // clés des succès décrochés
let experts = new Set();         // lignes maîtrisées : une carte dorée chacune
let parties = 0;

const Cards = { pret: false };
window.Cards = Cards;

addEventListener("metro:ready", () => {
  try {
    obtenus = new Set(JSON.parse(localStorage.getItem(OBTENUS) || "[]"));
    experts = new Set(JSON.parse(localStorage.getItem("metro-experts") || "[]"));
    parties = +(localStorage.getItem(PARTIES) || 0);
  } catch { obtenus = new Set(); experts = new Set(); parties = 0; }
  Cards.pret = true;
});

function enregistre() {
  try {
    localStorage.setItem(OBTENUS, JSON.stringify([...obtenus]));
    localStorage.setItem("metro-experts", JSON.stringify([...experts]));
    localStorage.setItem(PARTIES, String(parties));
  } catch { /* stockage indisponible */ }
}

/* Confronte le bilan d'une partie au catalogue et renvoie les succès qui viennent d'être
   décrochés, du plus commun au plus rare — c'est l'ordre dans lequel on les montrera. */
Cards.verifie = bilan => {
  if (!Cards.pret) return [];
  parties++;
  bilan.parties = parties;
  const neufs = SUCCES
    .filter(s => !obtenus.has(s.cle) && s.test(bilan))
    .map(s => s.cle);
  for (const cle of neufs) obtenus.add(cle);
  enregistre();
  return neufs;
};

Cards.expert = ligne => {
  const neuve = !experts.has(ligne);
  experts.add(ligne);
  enregistre();
  return neuve;
};

Cards.estExpert = ligne => experts.has(ligne);
Cards.experts = () => experts.size;
Cards.total = () => obtenus.size + experts.size;
/* Le catalogue entier : les succès, plus une carte d'expert par ligne jouable. */
Cards.catalogue = () =>
  SUCCES.length + net.lines.filter(l => !/b$/i.test(l[0])).length;
Cards.rang = cle => (parCle.get(cle) || {}).rang ?? 0;

/* ---------- dessin d'une carte ---------- */

/* L'illustration d'un succès : le réseau entier, tracé dans la teinte de la rareté. Une
   carte commune montre un réseau discret, une légendaire un réseau incandescent. */
function vignetteReseau(canvas, rang) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 210, h = canvas.clientHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of net.stations) {
    const [x, y] = s[4];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const k = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1)) * 0.88;
  const px = x => (x - (minX + maxX) / 2) * k + w / 2;
  const py = y => (y - (minY + maxY) / 2) * k + h / 2;

  ctx.fillStyle = "#0e1016";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = RARETES[rang].eclat;
  ctx.globalAlpha = 0.35 + rang * 0.14;
  const vues = new Set();
  for (const p of net.patterns) {
    if (vues.has(p[1])) continue;
    vues.add(p[1]);
    const pts = net.shapes[p[1]].world;
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
    for (let n = 1; n < pts.length; n++) ctx.lineTo(px(pts[n][0]), py(pts[n][1]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* Le nombre d'étincelles monte avec le rang : les deux premiers n'en ont aucune, c'est
   ce qui fait qu'une rare se remarque tout de suite dans la collection. */
const PAILLETTES = [0, 0, 4, 6, 8];

Cards.dessine = cle => {
  const s = parCle.get(cle);
  if (!s) return "";
  const rarete = RARETES[s.rang];
  const rangDansCatalogue = SUCCES.filter(o => o.rang === s.rang).length;
  const brille = s.rang >= 2;

  return `
    <article class="carte ${rarete.cle}${brille ? " brille" : ""}">
      ${brille ? '<span class="rayons"></span>' : ""}
      ${PAILLETTES[s.rang] ? `<span class="etincelles">${
        Array.from({ length: PAILLETTES[s.rang] }, (_, n) => `<i class="e${n + 1}">✦</i>`)
          .join("")}</span>` : ""}
      <header>
        <span class="titre">${s.nom}</span>
        <span class="trafic"><i>succès</i></span>
      </header>
      <div class="scene">
        <canvas class="vue" data-rang="${s.rang}"></canvas>
        <span class="embleme">${s.tete}</span>
      </div>
      <div class="lignes">
        <span class="lieu">${rarete.nom.toLowerCase()}</span>
      </div>
      <dl class="pouvoirs">
        <div><dt>Condition</dt><dd>${s.defi}</dd></div>
      </dl>
      <footer>
        <span class="rarete">${"◆".repeat(s.rang + 1)} ${rarete.nom}</span>
        <span class="numero">${rangDansCatalogue} de ce rang</span>
      </footer>
    </article>`;
};

Cards.poser = (hote, cle) => {
  hote.innerHTML = Cards.dessine(cle);
  const toile = hote.querySelector(".vue");
  if (toile) requestAnimationFrame(() => vignetteReseau(toile, +toile.dataset.rang));
  return hote.firstElementChild;
};

/* L'illustration d'une carte d'expert : la ligne entière, avec toutes ses stations. */
function vignetteLigne(canvas, ligne) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 210, h = canvas.clientHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const formes = [];
  const vues = new Set();
  for (const p of net.patterns) {
    if (p[0] !== ligne || vues.has(p[1])) continue;
    vues.add(p[1]);
    formes.push(p);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of formes) {
    for (const [x, y] of net.shapes[p[1]].world) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const k = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1)) * 0.86;
  const px = x => (x - (minX + maxX) / 2) * k + w / 2;
  const py = y => (y - (minY + maxY) / 2) * k + h / 2;

  ctx.fillStyle = "#171207";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = net.lines[ligne][1];
  for (const p of formes) {
    const pts = net.shapes[p[1]].world;
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
    for (let n = 1; n < pts.length; n++) ctx.lineTo(px(pts[n][0]), py(pts[n][1]));
    ctx.stroke();
  }

  const jalons = new Set();
  for (const p of net.patterns) {
    if (p[0] !== ligne) continue;
    for (const st of p[3]) jalons.add(st);
  }
  ctx.fillStyle = "#ffe6a8";
  for (const st of jalons) {
    ctx.beginPath();
    ctx.arc(px(net.stations[st][4][0]), py(net.stations[st][4][1]), 1.9, 0, 6.2832);
    ctx.fill();
  }
}

Cards.dessineExpert = ligne => {
  const l = net.lines[ligne];
  const stops = new Set();
  for (const p of net.patterns) if (p[0] === ligne) for (const st of p[3]) stops.add(st);
  const bouts = lineEnds(ligne);
  const wards = new Set();
  if (paris) for (const st of stops) { const n = paris.stationDistrict[st]; if (n) wards.add(n); }

  return `
    <article class="carte or">
      <span class="etincelles">${[1, 2, 3, 4, 5, 6, 7]
        .map(n => `<i class="e${n}">✦</i>`).join("")}</span>
      <header>
        <span class="titre">Expert de la ligne</span>
        <span class="trafic"><b class="pastille"
          style="background:${l[1]};color:${l[2]}">${l[0]}</b></span>
      </header>
      <canvas class="vue"></canvas>
      <div class="lignes">
        <span class="lieu">${bouts.from} ↔ ${bouts.to}</span>
      </div>
      <dl class="pouvoirs">
        <div><dt>Ligne parcourue</dt>
          <dd>${stops.size} stations d'un terminus à l'autre</dd></div>
        <div><dt>Sans une faute</dt>
          <dd>révision impeccable et ligne bouclée${
            wards.size ? ` · ${wards.size} arrondissements traversés` : ""}</dd></div>
      </dl>
      <footer>
        <span class="rarete">★ Expert</span>
        <span class="numero">ligne ${l[0]} / ${net.lines.length}</span>
      </footer>
    </article>`;
};

Cards.poserExpert = (hote, ligne) => {
  hote.innerHTML = Cards.dessineExpert(ligne);
  const toile = hote.querySelector(".vue");
  if (toile) requestAnimationFrame(() => vignetteLigne(toile, ligne));
  return hote.firstElementChild;
};

/* ---------- l'album ---------- */

const albumVue = document.getElementById("album-vue");

/* La collection est un tableau de chasse : les succès décrochés, et surtout ceux qui
   restent, avec leur condition en clair. On doit pouvoir y lire ce qu'il reste à faire. */
Cards.album = () => {
  if (!Cards.pret) return;

  const lignesJouables = net.lines.map((_, i) => i).filter(i => !/b$/i.test(net.lines[i][0]));
  const sacres = lignesJouables.map(i => {
    const l = net.lines[i], eu = experts.has(i);
    return `<button class="sacre-jeton${eu ? " acquis" : ""}" data-ligne="${i}"
       title="${eu ? "Expert de la ligne " + l[0] : "Ligne " + l[0] + " · à maîtriser"}"
       ${eu ? "" : "disabled"}>${l[0]}</button>`;
  }).join("");

  const rangs = RARETES.map((r, k) => {
    const lot = SUCCES.filter(s => s.rang === k);
    const eus = lot.filter(s => obtenus.has(s.cle)).length;
    const cartes = lot.map(s => {
      const eu = obtenus.has(s.cle);
      return `<div class="jeton ${eu ? "eue " + r.cle : "absente"}" data-cle="${s.cle}">
        <span class="nom">${eu ? s.nom : "?"}</span>
        <span class="bas"><span class="quel">${s.defi}</span></span>
      </div>`;
    }).join("");
    return `<section class="rang">
      <h3>${r.nom} <span>${eus} / ${lot.length}</span></h3>
      <div class="grille">${cartes}</div>
    </section>`;
  }).join("");

  albumVue.innerHTML = `
    <div class="entete">
      <h2>Succès</h2>
      <span class="compte">${obtenus.size} / ${SUCCES.length} · ✦ ${
        experts.size} ligne${experts.size > 1 ? "s" : ""} maîtrisée${
        experts.size > 1 ? "s" : ""}</span>
      <button class="fermer" title="Fermer">&times;</button>
    </div>
    <section class="sacres">
      <h3>Experts de ligne <span>${experts.size} / ${lignesJouables.length}</span></h3>
      <p class="regle">révision sans faute et ligne bouclée d'un terminus à l'autre</p>
      <div class="rangee">${sacres}</div>
    </section>
    ${rangs}`;
  albumVue.hidden = false;

  albumVue.querySelector(".fermer").onclick = () => { albumVue.hidden = true; };
  albumVue.querySelector(".rangee").onclick = e => {
    const jeton = e.target.closest(".sacre-jeton.acquis");
    if (!jeton) return;
    ouvre(loupe => Cards.poserExpert(loupe, +jeton.dataset.ligne));
  };
  albumVue.onclick = e => {
    const jeton = e.target.closest(".jeton.eue");
    if (!jeton) return;
    ouvre(loupe => Cards.poser(loupe, jeton.dataset.cle));
  };
};

/* La loupe est attachée au corps de la page, pas à l'album : le backdrop-filter de
   celui-ci fait de lui la référence des positions fixes, et la carte suivrait alors le
   défilement au lieu de rester au centre de l'écran. */
function ouvre(remplit) {
  const loupe = document.createElement("div");
  loupe.className = "loupe";
  document.body.appendChild(loupe);
  remplit(loupe);
  loupe.onclick = () => loupe.remove();
}

document.getElementById("album").onclick = () => Cards.album();
addEventListener("keydown", e => {
  if (e.key === "Escape" && !albumVue.hidden) albumVue.hidden = true;
});
