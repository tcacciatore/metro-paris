/* Le voyage — la rame ne s'arrête jamais.

   Les autres modes posent vingt questions séparées par autant d'écrans. Celui-ci est
   une seule course : on monte quelque part, le train enchaîne les stations, et à chaque
   tronçon il faut nommer celle qui vient avant d'y arriver. Bonne réponse ou pas, la
   rame continue — c'est elle qui donne le tempo, pas un chronomètre. Elle accélère à
   mesure qu'on tient, et trois erreurs terminent le trajet.

   Le trajet se tient sur la ligne choisie avant la partie : au terminus, la rame fait
   demi-tour et repart dans l'autre sens. */
(function () {

const Voyage = {
  actif: false,
  ligne: 0,
  stops: [],                     // le parcours de la ligne suivie
  index: 0,                      // indice de la station qu'on vient de quitter
  sens: 1,
  trajet: null,                  // { a, b } distances le long du tracé
  depart: 0,                     // horodatage du départ du tronçon
  duree: 5,
  chaine: 0,                     // stations enchaînées sans faute
  vies: 3,
  parcouru: 0,                   // mètres avalés depuis le départ
  tronconM: 0,                   // longueur du tronçon en cours
  repondu: null,                 // "juste" | "rate", tant que le tronçon dure
  vus: [],                       // stations déjà desservies pendant le trajet
};

const VIES = 3;
const LENT = 9.5;                // secondes pour le premier tronçon
const VIF = 4.5;                 // et pour les plus rapides
const CADENCE = 0.15;            // ce qu'on gagne par station enchaînée

const duree = () => Math.max(VIF, LENT - Voyage.chaine * CADENCE);

/* ---------- le parcours ---------- */

/* Prend la ligne en main à une station donnée, dans un sens qui laisse de la route. */
function prendLigne(ligne, station) {
  const run = mainRun(ligne);
  if (!run) return false;
  const stops = run[3];
  const i = stops.indexOf(station);
  if (i < 0) return false;
  // on part du côté où il reste le plus de stations à parcourir
  Voyage.ligne = ligne;
  Voyage.stops = stops;
  Voyage.index = i;
  Voyage.sens = i < stops.length / 2 ? 1 : -1;
  return true;
}

/* Au bout de la ligne, demi-tour. L'indice est borné avant tout : une arrivée au terminus
   peut l'avoir poussé hors du parcours, et lire une station qui n'y est pas ferait
   dérailler tout le trajet. */
function change() {
  Voyage.index = Math.max(0, Math.min(Voyage.stops.length - 1, Voyage.index));
  Voyage.sens = -Voyage.sens;
}

/* ---------- un tronçon ---------- */

function troncon() {
  const dehors = i => i < 0 || i >= Voyage.stops.length;
  if (dehors(Voyage.index) || dehors(Voyage.index + Voyage.sens)) change();
  if (dehors(Voyage.index + Voyage.sens)) Voyage.sens = -Voyage.sens;

  const de = Voyage.stops[Voyage.index];
  const vers = Voyage.stops[Voyage.index + Voyage.sens];
  if (de === undefined || vers === undefined) return fin();

  Voyage.trajet = trajetEntre(Voyage.ligne, de, vers);
  Voyage.tronconM = Voyage.trajet
    ? Math.abs(Voyage.trajet.b - Voyage.trajet.a) * M_PER_WORLD : 0;
  Voyage.depart = performance.now();
  Voyage.duree = duree();
  Voyage.repondu = null;
  Voyage.vus.push(de);

  // seule la ligne parcourue est tracée : le reste du réseau n'a rien à faire là, et
  // la correspondance prise au terminus fait basculer l'affichage sur la nouvelle ligne
  if (selected !== Voyage.ligne) {
    selected = Voyage.ligne;
    visible = new Set([Voyage.ligne]);
    Game.line = Voyage.ligne;
    bgDirty = true;
  }

  const bout = Voyage.stops[Voyage.sens > 0 ? Voyage.stops.length - 1 : 0];
  ask(`${pill(Voyage.ligne)} vers <b>${net.stations[bout][0]}</b> · ` +
      `quelle station après <b>${net.stations[de][0]}</b> ?`, false, "");
  entete();

  // Les leurres sont pris au hasard sur la ligne, à l'écart du tronçon en cours : trois
  // stations qui se suivent donnaient un choix entre voisines, où l'on répond au hasard
  // sans rien connaître du parcours.
  const loin = Voyage.stops
    .map((v, i) => ({ v, i }))
    .filter(o => Math.abs(o.i - Voyage.index) > 2 && o.v !== vers && o.v !== de)
    .map(o => o.v);
  const leurres = shuffle(loin).slice(0, 2);
  while (leurres.length < 2) {                     // ligne très courte : on élargit
    const i = fame[Math.floor(Math.random() * 60)];
    if (i !== vers && i !== de && !leurres.includes(i)) leurres.push(i);
  }

  showChoices(shuffle([
    { label: net.stations[vers][0], right: true },
    ...leurres.map(i => ({ label: net.stations[i][0], right: false })),
  ]), opt => {
    if (Voyage.repondu) return;
    const avance = (performance.now() - Voyage.depart) / 1000 / Voyage.duree;
    if (opt.right) {
      Voyage.repondu = "juste";
      Voyage.chaine++;
      const points = award(Math.round(300 + 400 * Math.max(0, 1 - avance)), true);
      Game.history.push({ kind: "voyage", name: net.stations[vers][0], points });
      say(`<em>${points} pts</em> · ${net.stations[vers][0]}`, "near");
    } else {
      Voyage.repondu = "rate";
      Voyage.chaine = 0;
      Voyage.vies--;
      award(0, false);
      Game.history.push({ kind: "voyage", name: null, points: 0 });
      say(`<em>raté</em> · c'était ${net.stations[vers][0]}`, "far");
    }
    tally();
  });

  cadre(de, vers);
}

/* Le compteur du bandeau : stations enchaînées, distance avalée, vies restantes. La
   distance avance en continu, on ne réécrit donc la ligne que lorsqu'elle change. */
let dernierEntete = "";

function entete() {
  const metres = Voyage.parcouru + Voyage.tronconM *
    Math.min(1, (performance.now() - Voyage.depart) / 1000 / Voyage.duree);
  const texte = `${Voyage.chaine} enchaînée${Voyage.chaine > 1 ? "s" : ""} · ` +
    `${format(metres)} · ${"●".repeat(Voyage.vies)}${"○".repeat(VIES - Voyage.vies)}`;
  if (texte === dernierEntete) return;
  dernierEntete = texte;
  hud.querySelector(".step").textContent = texte;
}

/* Le plan se recentre sur le tronçon en cours : la rame reste sous les yeux sans que la
   carte défile en continu, ce qui obligerait à repeindre tout le réseau à chaque image.

   Le cadrage attend deux images : la question vient de changer, le bandeau n'a pas encore
   sa nouvelle hauteur, et cadrer trop tôt place la rame dessous. */
function cadre(de, vers) {
  const a = net.stations[de][4], b = net.stations[vers][4];
  const demi = 1700 / M_PER_WORLD;
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!Voyage.actif) return;
    topInset = Math.min(hud.offsetHeight + 26, innerHeight * 0.42);
    flyTo(frameTo({ minX: cx - demi, maxX: cx + demi,
                    minY: cy - demi, maxY: cy + demi }, 0.9, 0, fitScale * 10), 480);
  }));
}

/* L'arrivée : ce qui n'a pas été répondu compte comme une faute. */
function arrive() {
  Voyage.parcouru += Voyage.tronconM;              // le tronçon est bouclé
  Voyage.tronconM = 0;
  if (!Voyage.repondu) {
    Voyage.chaine = 0;
    Voyage.vies--;
    award(0, false);
    const vers = Voyage.stops[Voyage.index + Voyage.sens];
    Game.history.push({ kind: "voyage", name: null, points: 0 });
    say(`<em>trop tard</em> · c'était ${net.stations[vers][0]}`, "far");
    tally();
  }
  // on n'avance que sur une station qui existe : le terminus est traité au tronçon suivant
  const suivant = Voyage.index + Voyage.sens;
  if (suivant >= 0 && suivant < Voyage.stops.length) Voyage.index = suivant;
  hideInputs();
  if (Voyage.vies <= 0) return fin();
  troncon();
}

function fin() {
  Voyage.actif = false;
  finish();
}

/* ---------- déroulement ---------- */

Voyage.start = function () {
  // la ligne est celle choisie au menu ; on monte à une station au hasard sur son parcours
  const ligne = ligneFixe !== null ? ligneFixe : 0;
  const run = mainRun(ligne);
  if (!run) return;
  const depart = run[3][Math.floor(Math.random() * run[3].length)];

  // le tronçon et son horodatage sont remis à zéro : sans quoi le dessin, appelé dès la
  // première image, hériterait de ceux du trajet précédent et déclencherait une arrivée
  // avant même que la rame ne soit partie
  Object.assign(Voyage, { actif: true, chaine: 0, vies: VIES, vus: [], repondu: null,
                          trajet: null, depart: 0, parcouru: 0, tronconM: 0 });
  prendLigne(ligne, depart);

  Game.playing = true;
  Game.score = 0;
  Game.streak = 0;
  Game.step = 0;
  Game.history = [];
  Game.question = { kind: "voyage" };               // pour que la couche de jeu s'anime
  Game.blind = false;
  Game.line = ligne;
  document.body.classList.add("explored", "playing");
  wear("nuit");
  over.hidden = true;
  hud.hidden = true;
  pips.hidden = true;                              // pas de manche découpée à jalonner
  showStreak();
  tally();

  trainIn(() => {
    if (!Voyage.actif) return;
    hud.hidden = false;
    troncon();
  });
  bgDirty = true;
};

/* Appelée à chaque image tant que la partie dure : c'est elle qui fait avancer la rame
   et qui déclenche les arrivées. */
Voyage.draw = function (ctx) {
  if (!Voyage.depart) return;                      // le premier tronçon n'est pas parti
  const u = Math.min(1, (performance.now() - Voyage.depart) / 1000 / Voyage.duree);

  timebar.firstElementChild.style.width = (100 - u * 100) + "%";
  timebar.classList.toggle("urgent", u > 0.72 && !Voyage.repondu);
  entete();

  // Les deux bouts du tronçon : celle qu'on quitte porte son nom, celle où l'on va est
  // un point nu — c'est justement ce qu'il faut nommer. Elles sont dessinées avant la
  // rame, qui doit passer par-dessus en arrivant.
  const suivante = Voyage.stops[Voyage.index + Voyage.sens];
  if (suivante !== undefined) {
    const st = net.stations[suivante];
    const x = sx(st[4][0]), y = sy(st[4][1]);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 6.2832);
    ctx.fillStyle = skin.station;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#8a8a8a";
    ctx.stroke();
  }
  dot(ctx, Voyage.stops[Voyage.index], "#8a8a8a", true);

  const voie = voies[Voyage.ligne];
  if (voie && Voyage.trajet) {
    const d = Voyage.trajet.a + (Voyage.trajet.b - Voyage.trajet.a) * u;
    const pas = (Voyage.trajet.b - Voyage.trajet.a) * 0.06;
    const [x, y] = surVoie(voie, Math.max(0, Math.min(voie.total, d)));
    const [x2, y2] = surVoie(voie, Math.max(0, Math.min(voie.total, d + pas)));
    const px = sx(x), py = sy(y);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(sy(y2) - py, sx(x2) - px));
    ctx.shadowColor = net.lines[Voyage.ligne][1];
    ctx.shadowBlur = 16;
    ctx.fillStyle = net.lines[Voyage.ligne][1];
    ctx.beginPath();
    ctx.roundRect(-13, -4.5, 26, 9, 4.5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = skin.halo;
    ctx.stroke();
    ctx.fillStyle = skin.halo;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(-8, -2.2, 6, 4.4);
    ctx.fillRect(1, -2.2, 6, 4.4);
    ctx.restore();
  }

  if (u >= 1) arrive();
};

window.Voyage = Voyage;

})();
