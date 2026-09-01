/* La conquête — le seul mode qui laisse quelque chose derrière lui.

   Le réseau commence gris. On part d'une station, et l'on ne peut attaquer que celles
   qui touchent son territoire : la carte se colore de proche en proche, séance après
   séance, et se retrouve intacte à la visite suivante.

   Ce qui en fait un jeu et non une corvée, ce sont trois décisions par tour : où frapper
   — une station à cinq lignes vaut six fois une station de bout de ligne, mais la
   question est autrement plus dure — et surtout continuer ou rentrer. Chaque conquête
   fait monter une prime qui multiplie tout le butin, mais on ne l'encaisse qu'en rentrant
   de son plein gré. Trois erreurs et la prime est perdue.

   Le risque ne porte jamais sur la carte : une station conquise l'est pour toujours. Une
   mauvaise soirée ne doit pas effacer trois semaines, sans quoi on ne revient plus. */
(function () {

const Conquete = {
  actif: false,
  jetons: 0,
  prime: 1,
  gains: 0,                      // butin brut, avant multiplication
  prises: [],                    // stations conquises pendant cette sortie
  fautes: 0,
  cible: null,                   // station visée, pendant qu'on répond
  question: null,
  debut: 0,
};

const CLE = "metro-conquete";
const JETONS = 3;
/* La prime accélère et ne plafonne jamais : c'est elle qui rend le dernier tour toujours
   plus tentant que le précédent. Une table figée s'épuisait au bout de huit prises, et
   la question « continuer ou rentrer ? » cessait alors de se poser. */
const prime = n => Math.round((1 + n * 0.4 + n * n * 0.02) * 10) / 10;
const TEMPS = { suivante: 20, trouve: 25 };

let pris = new Set();            // territoire acquis, définitivement
let travaux = {};                // station → jour où elle a été manquée

/* ---------- le territoire ---------- */

function charge() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || "{}");
    pris = new Set(brut.pris || []);
    travaux = brut.travaux || {};
  } catch { pris = new Set(); travaux = {}; }
}

function enregistre() {
  try {
    localStorage.setItem(CLE, JSON.stringify({ pris: [...pris], travaux }));
  } catch { /* stockage indisponible */ }
}

const aujourdhui = () => new Date().toDateString();

/* Les stations voisines d'une autre : celles qui la précèdent ou la suivent sur l'un des
   parcours qui la desservent. */
function voisines(i) {
  const out = new Set();
  for (const p of net.patterns) {
    const k = p[3].indexOf(i);
    if (k < 0) continue;
    if (k > 0) out.add(p[3][k - 1]);
    if (k < p[3].length - 1) out.add(p[3][k + 1]);
  }
  return out;
}

/* La frontière : tout ce qui touche le territoire sans lui appartenir, chantiers du jour
   exclus. C'est la seule chose que le jeu peut demander. */
function frontiere() {
  const jour = aujourdhui();
  const out = new Set();
  for (const i of pris) for (const v of voisines(i)) {
    if (!pris.has(v) && travaux[v] !== jour) out.add(v);
  }
  return [...out];
}

/* Ce que vaut une station : son nombre de lignes, essentiellement. Un nœud ouvre le
   réseau, un bout de ligne ne mène nulle part. */
const valeur = i => 300 + 600 * (net.stations[i][3].length - 1);

/* La première station. Ni un nœud majeur, qui offrirait tout le réseau d'entrée, ni un
   terminus perdu : une station à deux lignes dans Paris, tirée au sort. */
function premiere() {
  const bonnes = net.stations
    .map((_, i) => i)
    .filter(i => net.stations[i][3].length === 2 && paris && paris.stationDistrict[i]);
  const depart = bonnes.length
    ? bonnes[Math.floor(Math.random() * bonnes.length)]
    : fame[40];
  pris.add(depart);
  enregistre();
  return depart;
}

/* ---------- l'affichage ---------- */

function entete() {
  const reste = Conquete.jetons;
  hud.querySelector(".step").textContent =
    `${pris.size} / ${net.stations.length} · prime ×${
      Conquete.prime.toLocaleString("fr-FR")} · ` +
    `${"●".repeat(reste)}${"○".repeat(JETONS - reste)}`;
}

/* Cadre la vue sur le territoire et sa frontière. */
function cadre(front) {
  const tout = [...pris, ...front];
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const i of tout) {
    const [x, y] = net.stations[i][4];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // au premier soir le territoire tient en un point : sans plancher, la vue tomberait sur
  // un gros plan de trottoir où l'on ne reconnaît plus rien
  const etendue = Math.max(maxX - minX, maxY - minY);
  const marge = Math.max(etendue * 0.25, 1400 / M_PER_WORLD);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!Conquete.actif) return;
    topInset = Math.min(hud.offsetHeight + 26, innerHeight * 0.42);
    flyTo(frameTo({ minX: minX - marge, maxX: maxX + marge,
                    minY: minY - marge, maxY: maxY + marge }, 0.9, 0, fitScale * 9), 600);
  }));
}

/* ---------- le choix de la cible ---------- */

/* Le rang se lit sur la valeur, pas sur le rang dans la liste : au début de la conquête
   la frontière est si courte que les trois propositions se valent, et les annoncer
   « facile, moyen, difficile » serait mentir. */
const PALIERS = [[600, "facile", "#40c88c"], [1500, "moyen", "#f59e0b"],
                 [Infinity, "difficile", "#e2584d"]];
const rang = i => PALIERS.find(([max]) => valeur(i) <= max);

function propose() {
  const front = frontiere();
  if (!front.length) return rentrer(true);

  // trois cibles de valeurs contrastées : on doit pouvoir arbitrer, pas subir
  const triees = [...front].sort((a, b) => valeur(a) - valeur(b));
  const cibles = [];
  for (const part of [0, 0.5, 1]) {
    const i = triees[Math.round((triees.length - 1) * part)];
    if (!cibles.includes(i)) cibles.push(i);
  }
  while (cibles.length < Math.min(3, triees.length)) {
    const i = triees[Math.floor(Math.random() * triees.length)];
    if (!cibles.includes(i)) cibles.push(i);
  }

  Conquete.question = null;
  Conquete.propositions = cibles;                  // pour les repérer aussi sur le plan
  ask("ta prochaine station", false, "Choisis");
  entete();
  cadre(front);
  timebar.firstElementChild.style.width = "100%";
  timebar.classList.remove("urgent");

  choices.innerHTML = "";
  cibles.forEach((i, k) => {
    const b = document.createElement("button");
    const [, nom, teinte] = rang(i);
    b.className = "cible";
    b.style.setProperty("--rang", teinte);
    b.innerHTML = `<span class="quoi"><i class="puce"></i>
        ${net.stations[i][3].map(pill).join("")}
        <em>${nom}</em></span>
      <span class="gain">+${valeur(i).toLocaleString("fr-FR")}</span>`;
    b.onclick = () => attaque(i);
    choices.appendChild(b);
  });
  if (Conquete.gains) {
    const b = document.createElement("button");
    b.className = "rentrer";
    b.textContent = `Rentrer et encaisser ${
      Math.round(Conquete.gains * Conquete.prime).toLocaleString("fr-FR")} pts`;
    b.onclick = () => rentrer(false);
    choices.appendChild(b);
  }
  choices.hidden = false;
  replay(choices);
}

/* ---------- la question ---------- */

/* Depuis quelle station de mon territoire la cible est-elle atteignable, et vers quel
   terminus ? C'est ce qui permet de poser la question « et après ? ». */
function acces(cible) {
  for (const p of net.patterns) {
    const k = p[3].indexOf(cible);
    if (k < 0) continue;
    if (k > 0 && pris.has(p[3][k - 1])) {
      return { de: p[3][k - 1], ligne: p[0], vers: p[3][p[3].length - 1] };
    }
    if (k < p[3].length - 1 && pris.has(p[3][k + 1])) {
      return { de: p[3][k + 1], ligne: p[0], vers: p[3][0] };
    }
  }
  return null;
}

function attaque(cible) {
  Conquete.cible = cible;
  Conquete.debut = performance.now();
  const voie = acces(cible);
  const multi = net.stations[cible][3].length > 1;

  // une station banale se nomme, un nœud se situe : la seconde forme est plus dure et
  // c'est elle qui garde les gros gains hors de portée d'un coup de chance
  if (!multi && voie) {
    Conquete.question = { forme: "suivante", voie };
    ask(`${pill(voie.ligne)} vers <b>${net.stations[voie.vers][0]}</b> · quelle station ` +
        `suit <b>${net.stations[voie.de][0]}</b> ?`, false, "");

    const ailleurs = byLine[voie.ligne].filter(i => i !== cible && i !== voie.de);
    const leurres = shuffle(ailleurs).slice(0, 2);
    showChoices(shuffle([
      { label: net.stations[cible][0], right: true },
      ...leurres.map(i => ({ label: net.stations[i][0], right: false })),
    ]), opt => (opt.right ? gagne() : rate()));
  } else {
    Conquete.question = { forme: "trouve" };
    ask(`<b>${net.stations[cible][0]}</b> sur le plan`, false, "Trouve");
    hideInputs();
  }
  entete();
}

Conquete.click = (px, py) => {
  const q = Conquete.question;
  if (!q || q.forme !== "trouve") return;
  const st = nearest(px, py);
  if (st < 0) return;
  if (st === Conquete.cible) return gagne();
  say(`<em>${net.stations[st][0]}</em> · ce n'est pas là`, "far");
  rate();
};

function gagne() {
  const cible = Conquete.cible;
  pris.add(cible);
  Conquete.prises.push(cible);
  Conquete.gains += valeur(cible);
  Conquete.prime = prime(Conquete.prises.length);
  enregistre();
  say(`<em>${net.stations[cible][0]}</em> est à toi · prime ×${
    Conquete.prime.toLocaleString("fr-FR")}`, "near");
  if (window.Son) Son.juste(Conquete.prises.length - 1);
  bgDirty = true;
  Conquete.question = null;
  Conquete.cible = null;
  setTimeout(() => { if (Conquete.actif) propose(); }, 1100);
}

function rate() {
  const cible = Conquete.cible;
  travaux[cible] = aujourdhui();
  enregistre();
  Conquete.fautes++;
  Conquete.jetons--;
  if (window.Son) Son.rate();
  Conquete.question = null;
  Conquete.cible = null;
  entete();
  hideInputs();
  if (Conquete.jetons <= 0) {
    say(`<em>tu rentres bredouille</em> · ${
      Math.round(Conquete.gains * Conquete.prime).toLocaleString("fr-FR")} pts envolés`, "far");
    setTimeout(() => { if (Conquete.actif) rentrer(false, true); }, 1600);
  } else {
    say(`<em>${net.stations[cible][0]}</em> passe en travaux jusqu'à demain`, "far");
    setTimeout(() => { if (Conquete.actif) propose(); }, 1400);
  }
}

/* ---------- fin de sortie ---------- */

function rentrer(reseauFini, bredouille) {
  const butin = bredouille ? 0 : Math.round(Conquete.gains * Conquete.prime);
  Game.score = butin;
  // une entrée d'historique par tentative : c'est ce qui donne le taux et la série
  Game.history = [];
  for (const i of Conquete.prises) {
    Game.history.push({ kind: "conquete", name: net.stations[i][0], points: valeur(i) });
  }
  for (let n = 0; n < Conquete.fautes; n++) {
    Game.history.push({ kind: "conquete", name: null, points: 0 });
  }
  Conquete.actif = false;
  finish();
  if (reseauFini) say("<em>le réseau est à toi</em>", "near");
}

/* ---------- le dessin ---------- */

/* Le tronçon de tracé entre deux stations voisines, suivi sur la vraie géométrie de la
   ligne et non en ligne droite : c'est lui qui rallume la couleur là où l'on est passé.
   Le réseau restant, lui, est peint en gris par le fond. */
function troncon(ctx, ligne, a, b) {
  const voie = voies[ligne];
  if (!voie || !voie.total) return;
  const da = surTrace(ligne, a), db = surTrace(ligne, b);
  if (da === null || db === null) return;
  const [d1, d2] = da < db ? [da, db] : [db, da];

  const suite = [surVoie(voie, d1)];
  for (let k = 0; k < voie.pts.length; k++) {
    if (voie.cumul[k] > d1 && voie.cumul[k] < d2) suite.push(voie.pts[k]);
  }
  suite.push(surVoie(voie, d2));

  ctx.beginPath();
  ctx.moveTo(sx(suite[0][0]), sy(suite[0][1]));
  for (let k = 1; k < suite.length; k++) ctx.lineTo(sx(suite[k][0]), sy(suite[k][1]));
  ctx.stroke();
}

/* Tous les tronçons dont les deux extrémités sont à nous. */
function reseauAcquis(ctx) {
  const lw = Math.max(1.5, Math.min(6, 80 / mpp()));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lw;
  const faits = new Set();
  for (const p of net.patterns) {
    const stops = p[3];
    for (let k = 0; k < stops.length - 1; k++) {
      if (!pris.has(stops[k]) || !pris.has(stops[k + 1])) continue;
      const cle = `${p[0]}:${Math.min(stops[k], stops[k + 1])}:${Math.max(stops[k], stops[k + 1])}`;
      if (faits.has(cle)) continue;
      faits.add(cle);
      ctx.strokeStyle = net.lines[p[0]][1];
      troncon(ctx, p[0], stops[k], stops[k + 1]);
    }
  }
  ctx.restore();
}

Conquete.draw = function (ctx) {
  const q = Conquete.question;

  // le chrono ne court que pendant une question
  if (q) {
    const limite = TEMPS[q.forme];
    const reste = limite - (performance.now() - Conquete.debut) / 1000;
    timebar.firstElementChild.style.width = Math.max(0, reste / limite * 100) + "%";
    timebar.classList.toggle("urgent", reste < 5);
    if (reste <= 0) {
      say("<em>temps écoulé</em>", "far");
      return rate();
    }
  }

  const front = new Set(Conquete.actif ? frontiere() : []);
  const battement = 0.5 + 0.5 * Math.sin(performance.now() / 380);

  reseauAcquis(ctx);

  ctx.save();
  for (const i of pris) {
    const st = net.stations[i];
    const x = sx(st[4][0]), y = sy(st[4][1]);
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, 6.2832);
    ctx.fillStyle = net.lines[st[3][0]][1];
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = skin.halo;
    ctx.stroke();
  }
  // la frontière respire : c'est ce qu'on peut prendre ce soir
  ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.45 * battement})`;
  ctx.lineWidth = 1.5;
  for (const i of front) {
    const st = net.stations[i];
    ctx.beginPath();
    ctx.arc(sx(st[4][0]), sy(st[4][1]), 3 + 2 * battement, 0, 6.2832);
    ctx.stroke();
  }

  // les trois cibles proposées portent la teinte de leur rang : le choix se fait autant
  // sur le plan que dans la liste, sans quoi on achète à l'aveugle
  if (!q && Conquete.propositions) {
    for (const i of Conquete.propositions) {
      const st = net.stations[i];
      ctx.beginPath();
      ctx.arc(sx(st[4][0]), sy(st[4][1]), 9 + 2 * battement, 0, 6.2832);
      ctx.strokeStyle = rang(i)[2];
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  ctx.restore();

  // la station visée est montrée sauf quand c'est justement elle qu'on cherche
  if (Conquete.cible !== null && q && q.forme !== "trouve") {
    dot(ctx, Conquete.cible, "#f59e0b", false);
  }
  if (q && q.forme === "suivante") dot(ctx, q.voie.de, "#8a8a8a", true);
};

/* ---------- départ ---------- */

Conquete.start = function () {
  charge();
  if (!pris.size) premiere();

  Object.assign(Conquete, { actif: true, jetons: JETONS, prime: 1, gains: 0,
                            prises: [], fautes: 0, cible: null, question: null });
  Game.playing = true;
  Game.question = { kind: "conquete" };
  Game.blind = false;
  Game.line = null;
  Game.score = 0;
  Game.streak = 0;
  Game.history = [];
  document.body.classList.add("explored", "playing");
  wear("nuit");
  over.hidden = true;
  hud.hidden = true;
  pips.hidden = true;
  if (selected !== null) select(null);
  showStreak();
  tally();
  bgDirty = true;

  trainIn(() => {
    if (!Conquete.actif) return;
    hud.hidden = false;
    propose();
  });
};

/* Le territoire, lisible depuis le menu. */
Conquete.territoire = () => { charge(); return pris.size; };
Conquete.parLigne = () => {
  charge();
  return net.lines.map((_, l) => ({
    ligne: l,
    eues: byLine[l].filter(i => pris.has(i)).length,
    total: byLine[l].length,
  }));
};

window.Conquete = Conquete;

})();
