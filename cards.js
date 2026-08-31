/* Les cartes à collectionner. Chaque station du réseau en est une : ses caractéristiques
   ne sont pas inventées — correspondances, passages quotidiens, arrondissement — et sa
   rareté en découle. Les nœuds du réseau sont les légendaires. */

const RARETES = [
  { nom: "Commune",     cle: "commune",  eclat: "#8b93a7", chance: 58 },
  { nom: "Peu commune", cle: "peu",      eclat: "#3b82f6", chance: 25 },
  { nom: "Rare",        cle: "rare",     eclat: "#a855f7", chance: 12 },
  { nom: "Épique",      cle: "epique",   eclat: "#f59e0b", chance: 4 },
  { nom: "Légendaire",  cle: "legende",  eclat: "#ef4444", chance: 1 },
];

const COLLECTION = "metro-collection";
const CHROMEES = "metro-collection-chrome";
const EXPERTS = "metro-experts";

/* Comme les chromatiques de Pokémon : n'importe quelle station peut sortir en version
   chromée, quelle que soit sa rareté. C'est le hasard pur, un peu adouci par le score. */
const CHANCE_CHROME = 30;

let flux = [];                   // passages quotidiens par station
let rangs = [];                  // rareté de chaque station, de 0 à 4
let places = [];                 // place au classement de fréquentation
let avoir = new Set();           // cartes déjà obtenues
let brillantes = new Set();      // et celles qu'on a en version chromée
let experts = new Set();         // lignes maîtrisées : une carte dorée chacune

const Cards = { pret: false };
window.Cards = Cards;

addEventListener("metro:ready", () => {
  const parPattern = new Array(net.patterns.length).fill(0);
  for (const tr of fleet) if (tr.today) parPattern[tr.pat]++;
  flux = new Array(net.stations.length).fill(0);
  net.patterns.forEach((p, k) => { for (const st of p[3]) flux[st] += parPattern[k]; });

  // le classement de fréquentation : une donnée que la carte est seule à donner, et qui
  // se compare d'une carte à l'autre — « 3e station la plus desservie », ça parle
  places = new Array(net.stations.length);
  net.stations
    .map((_, i) => i)
    .sort((a, b) => flux[b] - flux[a])
    .forEach((i, k) => { places[i] = k + 1; });

  // le seuil qui sépare une station commune d'une station courue
  const seuil = [...flux].sort((a, b) => a - b)[Math.floor(flux.length * 0.6)];
  rangs = net.stations.map((st, i) => {
    const n = st[3].length;
    if (n >= 4) return 4;
    if (n === 3) return 3;
    if (n === 2) return 2;
    return flux[i] >= seuil ? 1 : 0;
  });

  try {
    avoir = new Set(JSON.parse(localStorage.getItem(COLLECTION) || "[]"));
    brillantes = new Set(JSON.parse(localStorage.getItem(CHROMEES) || "[]"));
    experts = new Set(JSON.parse(localStorage.getItem(EXPERTS) || "[]"));
  } catch { avoir = new Set(); brillantes = new Set(); experts = new Set(); }
  Cards.pret = true;
});

/* Tire une carte. Un bon score ouvre les raretés : à 20 000 points, une légendaire
   devient dix fois plus probable qu'à zéro. */
Cards.tirage = score => {
  if (!Cards.pret) return -1;
  const faveur = Math.min(1, score / 22000);
  const poids = RARETES.map((r, k) => r.chance * (1 + faveur * k * 2.2));
  const total = poids.reduce((a, b) => a + b, 0);
  let tirage = Math.random() * total, rang = 0;
  for (let k = 0; k < poids.length; k++) {
    if ((tirage -= poids[k]) <= 0) { rang = k; break; }
  }
  // on préfère une carte encore absente de la collection, à rareté égale
  for (let essai = rang; essai >= 0; essai--) {
    const pool = net.stations.map((_, i) => i).filter(i => rangs[i] === essai);
    if (!pool.length) continue;
    const neuves = pool.filter(i => !avoir.has(i));
    const choix = neuves.length ? neuves : pool;
    return choix[Math.floor(Math.random() * choix.length)];
  }
  return -1;
};

Cards.garder = (i, chromee) => {
  const neuve = chromee ? !brillantes.has(i) : !avoir.has(i);
  (chromee ? brillantes : avoir).add(i);
  try {
    localStorage.setItem(COLLECTION, JSON.stringify([...avoir]));
    localStorage.setItem(CHROMEES, JSON.stringify([...brillantes]));
  } catch { /* ignoré */ }
  return neuve;
};

/* Une carte sort-elle chromée ? Une fois sur trente environ, un peu plus souvent
   quand la partie a été bonne. */
Cards.chrome = score => Math.random() < 1 / (CHANCE_CHROME - Math.min(14, score / 1600));

/* La carte d'expert d'une ligne, décernée quand on l'a maîtrisée des deux côtés. */
Cards.expert = ligne => {
  const neuve = !experts.has(ligne);
  experts.add(ligne);
  try { localStorage.setItem(EXPERTS, JSON.stringify([...experts])); } catch { /* ignoré */ }
  return neuve;
};
Cards.estExpert = ligne => experts.has(ligne);
Cards.experts = () => experts.size;

Cards.possede = i => avoir.has(i);
Cards.brille = i => brillantes.has(i);
Cards.total = () => avoir.size;
Cards.totalChrome = () => brillantes.size;
Cards.rang = i => rangs[i];
Cards.flux = i => flux[i];
Cards.place = i => places[i];

/* ---------- dessin d'une carte ---------- */

const ordinal2 = n => n === 1 ? "1er" : n + "e";
/* « station » est féminin : la première station, pas le premier. */
const ordinale = n => n === 1 ? "1re" : n + "e";

/* L'illustration : les lignes qui desservent la station, et elles seules, tracées sur
   toute leur longueur. Un carré de quartier pris au hasard se ressemblait d'une carte à
   l'autre ; le parcours entier d'une ligne a une silhouette reconnaissable, et la place
   de la station dessus se lit d'un coup d'œil. */
function vignette(canvas, i) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 210, h = canvas.clientHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const st = net.stations[i];
  const siennes = st[3];

  // un seul tracé par forme, et seulement pour les lignes qui desservent la station
  const formes = [];
  const vues = new Set();
  for (const p of net.patterns) {
    if (!siennes.includes(p[0]) || vues.has(p[1])) continue;
    vues.add(p[1]);
    formes.push(p);
  }

  // le cadrage se prend sur ces tracés : chaque carte s'ajuste à ses propres lignes
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

  ctx.fillStyle = "#0e1016";
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  for (const p of formes) {
    const pts = net.shapes[p[1]].world;
    ctx.strokeStyle = net.lines[p[0]][1];
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
    for (let n = 1; n < pts.length; n++) ctx.lineTo(px(pts[n][0]), py(pts[n][1]));
    ctx.stroke();
  }

  // Les stations de ces mêmes lignes, en jalons. Ils se posent sur le tracé : trop gros,
  // ils le recouvrent entièrement et la carte n'est plus qu'un chapelet de points blancs.
  // Leur taille suit donc leur nombre, et ils laissent la couleur transparaître.
  const jalons = new Set();
  for (const p of net.patterns) {
    if (!siennes.includes(p[0])) continue;
    for (const s of p[3]) jalons.add(s);
  }
  const grain = jalons.size > 120 ? 1 : jalons.size > 60 ? 1.4 : 1.9;
  ctx.fillStyle = "rgba(255, 255, 255, .8)";
  for (const s of jalons) {
    if (s === i) continue;
    ctx.beginPath();
    ctx.arc(px(net.stations[s][4][0]), py(net.stations[s][4][1]), grain, 0, 6.2832);
    ctx.fill();
  }

  // la station de la carte, cerclée de la couleur de sa première ligne
  const x = px(st[4][0]), y = py(st[4][1]);
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, 6.2832);
  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, 6.2832);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = net.lines[siennes[0]][1];
  ctx.stroke();
}

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

  ctx.fillStyle = "#171207";                       // fond chaud, assorti à l'or
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

/* La carte d'expert : une par ligne, dorée, décernée quand on a réussi la révision sans
   faute et bouclé la ligne d'un bout à l'autre au voyage. Elle ne se tire pas au hasard,
   elle se gagne — d'où sa place à part dans la collection. */
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

/* Le corps de la carte. */
Cards.dessine = (i, chromee) => {
  const st = net.stations[i];
  const rang = rangs[i];
  const rarete = RARETES[rang];
  const arr = paris && paris.stationDistrict[i];
  const pastilles = st[3]
    .map(l => `<b style="background:${net.lines[l][1]};color:${net.lines[l][2]}">${net.lines[l][0]}</b>`)
    .join("");

  return `
    <article class="carte ${rarete.cle}${chromee ? " chrome" : ""}">
      ${chromee ? `<span class="etincelles">${
        [1, 2, 3, 4, 5, 6, 7].map(n => `<i class="e${n}">✦</i>`).join("")}</span>` : ""}
      <header>
        <span class="titre">${st[0]}</span>
        <span class="trafic">${flux[i].toLocaleString("fr-FR")} <i>rames/j</i></span>
      </header>
      <canvas class="vue"></canvas>
      <div class="lignes">${pastilles}
        <span class="lieu">${arr ? ordinal2(arr) + " arrondissement" : "hors les murs"}</span>
      </div>
      <dl class="pouvoirs">
        <div><dt>Correspondance ×${st[3].length}</dt>
          <dd>${st[3].length > 1 ? st[3].length + " lignes se croisent ici"
                                 : "desservie par une seule ligne"}</dd></div>
        <div><dt>Fréquentation</dt>
          <dd>${ordinale(places[i])} station la plus desservie du réseau</dd></div>
      </dl>
      <footer>
        <span class="rarete">${chromee ? "✦ Chromée · " : ""}${"◆".repeat(rang + 1)} ${rarete.nom}</span>
        <span class="numero">${String(i + 1).padStart(3, "0")} / ${net.stations.length}</span>
      </footer>
    </article>`;
};

/* Insère une carte dans un conteneur et dessine son illustration. */
Cards.poser = (hote, i, chromee) => {
  hote.innerHTML = Cards.dessine(i, chromee);
  const toile = hote.querySelector(".vue");
  if (toile) requestAnimationFrame(() => vignette(toile, i));
  return hote.firstElementChild;
};

/* ---------- l'album ---------- */

const albumVue = document.getElementById("album-vue");

/* La collection entière, dans l'ordre des numéros : ce qu'on a, et ce qui manque.
   Les cartes qu'on n'a pas gardent leur silhouette — on voit qu'il reste à trouver,
   sans savoir quoi. */
Cards.album = () => {
  if (!Cards.pret) return;
  const parRarete = RARETES.map((r, k) => {
    const total = rangs.filter(x => x === k).length;
    const eues = rangs.filter((x, i) => x === k && avoir.has(i)).length;
    return `${r.nom} ${eues}/${total}`;
  }).reverse().join(" · ");

  const jetons = net.stations.map((st, i) => {
    const brille = brillantes.has(i);
    const eue = avoir.has(i) || brille;
    const r = RARETES[rangs[i]];
    const lignes = eue
      ? st[3].map(l => `<b style="background:${net.lines[l][1]};color:${net.lines[l][2]}">${net.lines[l][0]}</b>`).join("")
      : "";
    // une case vide garde son numéro, comme dans un album : on voit ce qui manque
    return `<div class="jeton ${eue ? "eue " + r.cle : "absente"}${brille ? " brille" : ""}"
                 data-i="${i}" data-chrome="${brille ? 1 : 0}">
      <span class="nom">${eue ? st[0] : "n<sup>o</sup> " + String(i + 1).padStart(3, "0")}</span>
      <span class="bas">${lignes}<span class="quel">${
        brille ? "✦ chromée" : eue ? r.nom : "à trouver"}</span></span>
    </div>`;
  }).join("");

  // les cartes d'expert d'abord : elles ne se tirent pas, elles se gagnent, et la ligne
  // d'or en tête de collection donne un but à qui a déjà beaucoup de stations
  const lignesJouables = net.lines.map((_, i) => i).filter(i => !/b$/i.test(net.lines[i][0]));
  const sacres = lignesJouables.map(i => {
    const l = net.lines[i], eu = experts.has(i);
    return `<button class="sacre-jeton${eu ? " acquis" : ""}" data-ligne="${i}"
       title="${eu ? "Expert de la ligne " + l[0] : "Ligne " + l[0] + " · à maîtriser"}"
       ${eu ? "" : "disabled"}>${l[0]}</button>`;
  }).join("");

  albumVue.innerHTML = `
    <div class="entete">
      <h2>Collection</h2>
      <span class="compte">${avoir.size} / ${net.stations.length} · ${parRarete}${
        brillantes.size ? ` · ✦ ${brillantes.size} chromée${brillantes.size > 1 ? "s" : ""}` : ""}</span>
      <button class="fermer" title="Fermer">&times;</button>
    </div>
    <section class="sacres">
      <h3>Experts de ligne <span>${experts.size} / ${lignesJouables.length}</span></h3>
      <p class="regle">révision sans faute et ligne bouclée d'un terminus à l'autre</p>
      <div class="rangee">${sacres}</div>
    </section>
    <div class="grille">${jetons}</div>`;
  albumVue.hidden = false;

  albumVue.querySelector(".fermer").onclick = () => { albumVue.hidden = true; };
  albumVue.querySelector(".rangee").onclick = e => {
    const jeton = e.target.closest(".sacre-jeton.acquis");
    if (!jeton) return;
    const loupe = document.createElement("div");
    loupe.className = "loupe";
    document.body.appendChild(loupe);
    Cards.poserExpert(loupe, +jeton.dataset.ligne);
    loupe.onclick = () => loupe.remove();
  };
  albumVue.querySelector(".grille").onclick = e => {
    const jeton = e.target.closest(".jeton.eue");
    if (!jeton) return;
    // la loupe est attachée au corps de la page, pas à l'album : le backdrop-filter de
    // celui-ci fait de lui la référence des positions fixes, et la carte suivrait alors
    // le défilement au lieu de rester au centre de l'écran
    const loupe = document.createElement("div");
    loupe.className = "loupe";
    document.body.appendChild(loupe);
    Cards.poser(loupe, +jeton.dataset.i, jeton.dataset.chrome === "1");
    loupe.onclick = () => loupe.remove();
  };
};

document.getElementById("album").onclick = () => Cards.album();
addEventListener("keydown", e => {
  if (e.key === "Escape" && !albumVue.hidden) albumVue.hidden = true;
});
