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

/* Comme les chromatiques de Pokémon : n'importe quelle station peut sortir en version
   chromée, quelle que soit sa rareté. C'est le hasard pur, un peu adouci par le score. */
const CHANCE_CHROME = 30;

let flux = [];                   // passages quotidiens par station
let rangs = [];                  // rareté de chaque station, de 0 à 4
let avoir = new Set();           // cartes déjà obtenues
let brillantes = new Set();      // et celles qu'on a en version chromée

const Cards = { pret: false };
window.Cards = Cards;

addEventListener("metro:ready", () => {
  const parPattern = new Array(net.patterns.length).fill(0);
  for (const tr of fleet) if (tr.today) parPattern[tr.pat]++;
  flux = new Array(net.stations.length).fill(0);
  net.patterns.forEach((p, k) => { for (const st of p[3]) flux[st] += parPattern[k]; });

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
  } catch { avoir = new Set(); brillantes = new Set(); }
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

Cards.possede = i => avoir.has(i);
Cards.brille = i => brillantes.has(i);
Cards.total = () => avoir.size;
Cards.totalChrome = () => brillantes.size;
Cards.rang = i => rangs[i];
Cards.flux = i => flux[i];

/* ---------- dessin d'une carte ---------- */

const ordinal2 = n => n === 1 ? "1er" : n + "e";

/* L'illustration : le réseau tel qu'il se présente autour de la station, dans un rayon
   d'environ un kilomètre. Chaque carte a donc son propre paysage. */
function vignette(canvas, i) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 210, h = canvas.clientHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const st = net.stations[i];
  const [cx, cy] = st[4];
  const rayon = 1400 / M_PER_WORLD;                // un peu plus d'un kilomètre
  const k = Math.min(w / (rayon * 2), h / (rayon * 2));
  const px = x => (x - cx) * k + w / 2;
  const py = y => (y - cy) * k + h / 2;

  ctx.fillStyle = "#0e1016";
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  const tracees = new Set();
  for (const p of net.patterns) {
    if (tracees.has(p[1])) continue;
    tracees.add(p[1]);
    const pts = net.shapes[p[1]].world;
    ctx.strokeStyle = net.lines[p[0]][1];
    ctx.beginPath();
    let dedans = false;
    for (let n = 0; n < pts.length; n++) {
      const x = px(pts[n][0]), y = py(pts[n][1]);
      if (x < -60 || y < -60 || x > w + 60 || y > h + 60) { dedans = false; continue; }
      if (!dedans) { ctx.moveTo(x, y); dedans = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  for (const autre of net.stations) {
    const x = px(autre[4][0]), y = py(autre[4][1]);
    if (x < 0 || y < 0 || x > w || y > h) continue;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, 6.2832);
    ctx.fillStyle = "#e9ecf4";
    ctx.fill();
  }

  // la station de la carte, au centre
  ctx.beginPath();
  ctx.arc(px(cx), py(cy), 7, 0, 6.2832);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = net.lines[st[3][0]][1];
  ctx.stroke();
}

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
      ${chromee ? '<span class="etincelles">✦<i>✦</i><b>✦</b></span>' : ""}
      <header>
        <span class="titre">${st[0]}</span>
        <span class="pv">${Math.round(flux[i] / 10)} <i>PV</i></span>
      </header>
      <canvas class="vue"></canvas>
      <div class="lignes">${pastilles}
        <span class="lieu">${arr ? ordinal2(arr) + " arrondissement" : "hors les murs"}</span>
      </div>
      <dl class="pouvoirs">
        <div><dt>Correspondance ×${st[3].length}</dt>
          <dd>${st[3].length > 1 ? st[3].length + " lignes se croisent ici"
                                 : "desservie par une seule ligne"}</dd></div>
        <div><dt>Passages</dt>
          <dd>${flux[i].toLocaleString("fr-FR")} rames par jour</dd></div>
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

  albumVue.innerHTML = `
    <div class="entete">
      <h2>Collection</h2>
      <span class="compte">${avoir.size} / ${net.stations.length} · ${parRarete}${
        brillantes.size ? ` · ✦ ${brillantes.size} chromée${brillantes.size > 1 ? "s" : ""}` : ""}</span>
      <button class="fermer" title="Fermer">&times;</button>
    </div>
    <div class="grille">${jetons}</div>`;
  albumVue.hidden = false;

  albumVue.querySelector(".fermer").onclick = () => { albumVue.hidden = true; };
  albumVue.querySelector(".grille").onclick = e => {
    const jeton = e.target.closest(".jeton.eue");
    if (!jeton) return;
    const loupe = document.createElement("div");
    loupe.className = "loupe";
    albumVue.appendChild(loupe);
    Cards.poser(loupe, +jeton.dataset.i, jeton.dataset.chrome === "1");
    loupe.onclick = () => loupe.remove();
  };
};

document.getElementById("album").onclick = () => Cards.album();
addEventListener("keydown", e => {
  if (e.key === "Escape" && !albumVue.hidden) albumVue.hidden = true;
});
