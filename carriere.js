/* La carrière — on entre à la RATP par le bas.

   Une partie est un service en trois actes, condensé des trois façons de jouer : la
   ronde interroge ce qu'on doit savoir de son poste, l'inspection demande de le situer
   sur le plan, le service fait rouler la rame le long de son périmètre. À la fin, une
   note — et selon elle, l'avancement.

   Le périmètre s'élargit station par station, ce qui se sent à chaque service ; couvrir
   sa ligne entière vaut une promotion et l'ouverture d'une ligne voisine. Seize lignes
   plus tard, on est chef du réseau. C'est le seul mode qui garde une mémoire d'une
   soirée à l'autre. */
(function () {

const Carriere = {
  actif: false,
  acte: 0,
  question: null,
  cible: null,
  reussies: 0,
  posees: 0,
  debut: 0,
};

const CLE = "metro-poste";
const TEMPS = 22;                // secondes par question

/* Les trois actes d'un service. Le troisième s'allonge avec le périmètre : on ne fait
   pas rouler une rame sur trois stations comme sur trente. */
const ACTES = [
  { cle: "ronde", titre: "La ronde", sous: "ce qu'un chef doit savoir de son poste", n: 3 },
  { cle: "inspection", titre: "L'inspection", sous: "situer son périmètre sur le plan", n: 3 },
  { cle: "service", titre: "Le service", sous: "la rame parcourt votre secteur", n: 6 },
];

let perimetre = new Set();       // stations dont on a la charge
let ligne = 0;                   // la ligne en cours d'apprentissage
let faites = [];                 // lignes entièrement couvertes

/* ---------- le poste ---------- */

function charge() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || "null");
    if (brut) {
      perimetre = new Set(brut.perimetre);
      ligne = brut.ligne;
      faites = brut.faites || [];
      return;
    }
  } catch { /* stockage indisponible */ }
  prendreService();
}

function enregistre() {
  try {
    localStorage.setItem(CLE, JSON.stringify(
      { perimetre: [...perimetre], ligne, faites }));
  } catch { /* ignoré */ }
}

/* Le premier poste : une station modeste, une seule ligne, en bout de Paris. On ne
   commence pas chef à Châtelet. */
function prendreService() {
  const modestes = fame.slice(-90).filter(i =>
    net.stations[i][3].length === 1 && paris && paris.stationDistrict[i]);
  const depart = modestes.length
    ? modestes[Math.floor(Math.random() * modestes.length)]
    : fame[fame.length - 1];
  perimetre = new Set([depart]);
  ligne = net.stations[depart][3][0];
  faites = [];
  enregistre();
}

/* Les grades. Ils ne se calculent pas, ils se lisent : le périmètre les dit. */
function grade() {
  const n = perimetre.size, L = faites.length;
  if (L >= net.lines.length) return { nom: "Chef du réseau", tete: "🏆" };
  if (L >= 3) return { nom: `Chef de ${L} lignes`, tete: "🎖️" };
  if (L >= 1) return { nom: L > 1 ? `Chef de ${L} lignes` : "Chef de ligne", tete: "🚇" };
  if (n >= 12) return { nom: "Chef de secteur", tete: "🧭" };
  if (n >= 4) return { nom: "Chef de gare", tete: "🎩" };
  return { nom: "Agent de quai", tete: "🧢" };
}

/* Les stations de la ligne en cours qui touchent le périmètre : la prochaine prise. */
function voisinage() {
  const stops = mainRun(ligne) ? mainRun(ligne)[3] : [];
  const out = [];
  for (let k = 0; k < stops.length; k++) {
    if (perimetre.has(stops[k])) continue;
    if ((k > 0 && perimetre.has(stops[k - 1])) ||
        (k < stops.length - 1 && perimetre.has(stops[k + 1]))) out.push(stops[k]);
  }
  return out;
}

/* L'avancement d'un service : la note décide du nombre de stations gagnées. Couvrir sa
   ligne fait passer chef de ligne et ouvre une ligne voisine, qu'il faudra apprendre à
   son tour — une ligne offerte ne se mériterait pas. */
function avance(note) {
  const gagne = note >= 90 ? 3 : note >= 70 ? 2 : note >= 40 ? 1 : 0;
  const prises = [];
  let promu = null;

  for (let n = 0; n < gagne; n++) {
    const proches = voisinage();
    if (!proches.length) break;
    const i = proches[Math.floor(Math.random() * proches.length)];
    perimetre.add(i);
    prises.push(i);
  }

  // la ligne est-elle couverte de bout en bout ?
  const stops = mainRun(ligne)[3];
  if (stops.every(i => perimetre.has(i)) && !faites.includes(ligne)) {
    faites.push(ligne);
    const suivante = ligneVoisine();
    if (suivante !== null) {
      promu = { ligne: faites[faites.length - 1], nouvelle: suivante };
      ligne = suivante;
    } else {
      promu = { ligne: faites[faites.length - 1], nouvelle: null };
    }
  }
  enregistre();
  return { prises, promu, gagne };
}

/* Une ligne qui croise le périmètre et qu'on n'a pas encore faite. */
function ligneVoisine() {
  const candidates = new Set();
  for (const i of perimetre) {
    for (const l of net.stations[i][3]) {
      if (l !== ligne && !faites.includes(l)) candidates.add(l);
    }
  }
  const liste = [...candidates].filter(l => byLine[l].length >= 5);
  if (!liste.length) {
    const reste = net.lines.map((_, l) => l).filter(l => !faites.includes(l));
    return reste.length ? reste[0] : null;
  }
  return liste[Math.floor(Math.random() * liste.length)];
}

/* ---------- l'affichage ---------- */

function entete() {
  const a = ACTES[Carriere.acte];
  hud.querySelector(".step").textContent =
    `${a.titre} · ${Math.min(Carriere.posees + 1, total())}/${total()} · ${
      grade().nom.toLowerCase()}`;
}

const total = () => ACTES.reduce((s, a) => s + tailleActe(a), 0);

/* Le service s'ajuste au périmètre : on ne fait pas rouler une rame sur trois stations
   comme sur trente. */
/* Un acte ne pose pas plus de questions qu'il n'a de matière : au premier service, le
   périmètre est d'une seule station et l'on tournerait trois fois autour du même quai.
   Le service, lui, peut toujours interroger la frontière — d'où sa marge. */
function tailleActe(a) {
  if (a.cle === "service") return Math.max(2, Math.min(a.n, perimetre.size + 1));
  return Math.min(a.n, Math.max(1, perimetre.size));
}

function cadre() {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const i of perimetre) {
    const [x, y] = net.stations[i][4];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const etendue = Math.max(maxX - minX, maxY - minY);
  const marge = Math.max(etendue * 0.3, 900 / M_PER_WORLD);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!Carriere.actif) return;
    topInset = Math.min(hud.offsetHeight + 26, innerHeight * 0.42);
    flyTo(frameTo({ minX: minX - marge, maxX: maxX + marge,
                    minY: minY - marge, maxY: maxY + marge }, 0.9, 0, fitScale * 10), 520);
  }));
}

/* ---------- les questions ---------- */

const dansPerimetre = () => [...perimetre];

/* Un service ne repose pas deux fois la même question : avec un périmètre d'une seule
   station, les trois questions d'un acte seraient identiques. */
function inedit(liste, clef) {
  const neufs = liste.filter(x => !Carriere.vus.has(clef(x)));
  const choix = (neufs.length ? neufs : liste)[
    Math.floor(Math.random() * (neufs.length ? neufs.length : liste.length))];
  Carriere.vus.add(clef(choix));
  return choix;
}

function poser() {
  const a = ACTES[Carriere.acte];
  Carriere.debut = performance.now();
  cadre();
  if (a.cle === "ronde") ronde();
  else if (a.cle === "inspection") inspection();
  else service();
  entete();                                        // après ask(), qui réécrit la ligne
}

/* Acte I — ce qu'un chef doit savoir : correspondances et arrondissements. */
function ronde() {
  const noeuds = dansPerimetre().filter(i => net.stations[i][3].length >= 2);
  const surArrondissement = !noeuds.length || Math.random() < 0.5;
  const cible = inedit(surArrondissement ? dansPerimetre() : noeuds, i => "r" + i);
  Carriere.cible = cible;

  if (!surArrondissement) {
    const vraies = net.stations[cible][3];
    const cle = l => [...l].sort((x, y) => x - y).join(",");
    const vus = new Set([cle(vraies)]);
    const leurres = [];
    for (const i of shuffle(net.stations.map((_, k) => k))) {
      if (net.stations[i][3].length !== vraies.length) continue;
      const k = cle(net.stations[i][3]);
      if (vus.has(k)) continue;
      vus.add(k);
      leurres.push(net.stations[i][3]);
      if (leurres.length === 2) break;
    }
    Carriere.question = { forme: "ronde" };
    ask(`<b>${net.stations[cible][0]}</b> ?`, false, "Quelles lignes desservent");
    return showChoices(shuffle([
      { html: vraies.map(pill).join(" "), right: true },
      ...leurres.map(l => ({ html: l.map(pill).join(" "), right: false })),
    ]), opt => (opt.right ? juste(700) : rate()));
  }

  const vrai = paris ? paris.stationDistrict[cible] : 0;
  const autres = shuffle([...Array(20).keys()].map(n => n + 1).filter(n => n !== vrai)).slice(0, 2);
  Carriere.question = { forme: "ronde" };
  ask(`<b>${net.stations[cible][0]}</b> ?`, false,
      vrai ? "Dans quel arrondissement se trouve" : "Où se trouve");
  showChoices(shuffle([
    { label: vrai ? ordinal(vrai) : "hors de Paris", right: true },
    ...autres.map(n => ({ label: ordinal(n), right: false })),
    ...(vrai ? [] : [{ label: ordinal(autres[0]), right: false }]),
  ].slice(0, 3)), opt => (opt.right ? juste(700) : rate()));
}

/* Acte II — le situer sur le plan, sans les noms. */
function inspection() {
  const cible = inedit(dansPerimetre(), i => "i" + i);
  Carriere.cible = cible;
  Carriere.question = { forme: "inspection" };
  ask(`<b>${net.stations[cible][0]}</b> sur le plan`, false, "Trouve");
  hideInputs();
}

Carriere.click = (px, py) => {
  const q = Carriere.question;
  if (!q || q.forme !== "inspection") return;
  const st = nearest(px, py);
  if (st < 0) return;
  if (st === Carriere.cible) return juste(900);
  say(`<em>${net.stations[st][0]}</em> · ce n'est pas là`, "far");
  rate();
};

/* Acte III — la rame parcourt le secteur : quelle station vient après ? */
function service() {
  const stops = mainRun(ligne)[3];
  // On part d'une station de son périmètre et l'on demande celle qui suit, même si elle
  // n'est pas encore à nous : un agent de quai doit savoir ce qui vient après son propre
  // quai, et c'est justement la station qu'il est sur le point d'obtenir.
  const trajets = [];
  for (let k = 0; k < stops.length; k++) {
    if (!perimetre.has(stops[k])) continue;
    if (k + 1 < stops.length) trajets.push([stops[k], stops[k + 1]]);
    if (k > 0) trajets.push([stops[k], stops[k - 1]]);
  }
  if (!trajets.length) return rate();
  const [de, vers] = inedit(trajets, t => "s" + t[0] + "-" + t[1]);
  Carriere.cible = vers;
  Carriere.question = { forme: "service", de };

  const ailleurs = byLine[ligne].filter(i => i !== vers && i !== de);
  const leurres = shuffle(ailleurs).slice(0, 2);
  ask(`${pill(ligne)} · quelle station suit <b>${net.stations[de][0]}</b> ?`, false, "");
  showChoices(shuffle([
    { label: net.stations[vers][0], right: true },
    ...leurres.map(i => ({ label: net.stations[i][0], right: false })),
  ]), opt => (opt.right ? juste(800) : rate()));
}

/* ---------- l'enchaînement ---------- */

function juste(base) {
  const passe = (performance.now() - Carriere.debut) / 1000 / TEMPS;
  const points = base ? award(Math.round(base + 400 * Math.max(0, 1 - passe)), true) : 0;
  Carriere.reussies++;
  Game.history.push({ kind: "carriere", name: net.stations[Carriere.cible][0], points });
  if (points) say(`<em>${points} pts</em> · ${net.stations[Carriere.cible][0]}`, "near");
  tally();
  suite();
}

function rate() {
  award(0, false);
  Game.history.push({ kind: "carriere", name: null, points: 0 });
  if (Carriere.cible !== null) {
    say(`<em>raté</em> · c'était ${net.stations[Carriere.cible][0]}`, "far");
  }
  tally();
  suite();
}

function suite() {
  Carriere.posees++;
  Carriere.question = null;
  Carriere.cible = null;
  hideInputs();

  // combien de questions dans l'acte courant, et où en est-on ?
  let seuil = 0;
  for (let a = 0; a <= Carriere.acte; a++) seuil += tailleActe(ACTES[a]);
  const finDacte = Carriere.posees >= seuil;

  setTimeout(() => {
    if (!Carriere.actif) return;
    if (Carriere.posees >= total()) return rapport();
    if (finDacte) {
      Carriere.acte++;
      const a = ACTES[Carriere.acte];
      say(`<em>${a.titre}</em> · ${a.sous}`, "");
      return setTimeout(() => { if (Carriere.actif) poser(); }, 1300);
    }
    poser();
  }, 1200);
}

/* ---------- le rapport de service ---------- */

function rapport() {
  const note = Math.round(Carriere.reussies / Math.max(1, Carriere.posees) * 100);
  const avant = grade().nom;
  const { prises, promu } = avance(note);
  Carriere.actif = false;
  Carriere.bilan = { note, prises, promu, avant, apres: grade().nom };
  finish();
}

/* ---------- le dessin ---------- */

/* Le réseau est éteint ; seul le périmètre est allumé. C'est ce contraste qui fait sentir
   l'avancement d'un service à l'autre. */
function troncon(ctx, l, a, b) {
  const voie = voies[l];
  if (!voie || !voie.total) return;
  const da = surTrace(l, a), db = surTrace(l, b);
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

Carriere.draw = function (ctx) {
  const q = Carriere.question;
  if (q) {
    const reste = TEMPS - (performance.now() - Carriere.debut) / 1000;
    timebar.firstElementChild.style.width = Math.max(0, reste / TEMPS * 100) + "%";
    timebar.classList.toggle("urgent", reste < 5);
    if (reste <= 0) { say("<em>temps écoulé</em>", "far"); return rate(); }
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, Math.min(6, 80 / mpp()));
  const faits = new Set();
  for (const p of net.patterns) {
    const stops = p[3];
    for (let k = 0; k < stops.length - 1; k++) {
      if (!perimetre.has(stops[k]) || !perimetre.has(stops[k + 1])) continue;
      const cle = `${p[0]}:${Math.min(stops[k], stops[k + 1])}`;
      if (faits.has(cle)) continue;
      faits.add(cle);
      ctx.strokeStyle = net.lines[p[0]][1];
      troncon(ctx, p[0], stops[k], stops[k + 1]);
    }
  }
  for (const i of perimetre) {
    const st = net.stations[i];
    ctx.beginPath();
    ctx.arc(sx(st[4][0]), sy(st[4][1]), 5.5, 0, 6.2832);
    ctx.fillStyle = net.lines[st[3][0]][1];
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = skin.halo;
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, Math.min(6, 80 / mpp()));
  }
  ctx.restore();

  // la station en jeu, sauf quand c'est elle qu'on cherche
  if (q && q.forme === "service") dot(ctx, q.de, "#8a8a8a", true);
  if (q && q.forme === "ronde" && Carriere.cible !== null) {
    dot(ctx, Carriere.cible, "#f59e0b", true);
  }
};

/* ---------- départ ---------- */

Carriere.start = function () {
  charge();
  Object.assign(Carriere, { actif: true, acte: 0, posees: 0, reussies: 0,
                            question: null, cible: null, vus: new Set() });
  Game.playing = true;
  Game.question = { kind: "carriere" };
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
    if (!Carriere.actif) return;
    hud.hidden = false;
    const a = ACTES[0];
    say(`<em>${a.titre}</em> · ${a.sous}`, "");
    setTimeout(() => { if (Carriere.actif) poser(); }, 1300);
  });
};

/* Lisible depuis le menu : où en est la carrière. */
Carriere.poste = () => {
  charge();
  const stops = mainRun(ligne) ? mainRun(ligne)[3] : [];
  return {
    grade: grade(),
    stations: perimetre.size,
    ligne,
    surLigne: stops.filter(i => perimetre.has(i)).length,
    totalLigne: stops.length,
    lignes: faites.length,
  };
};

window.Carriere = Carriere;

})();
