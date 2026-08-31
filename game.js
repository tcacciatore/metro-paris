/* La chasse aux stations — deux façons de prouver qu'on connaît Paris :
   retrouver une station nommée, ou désigner plusieurs stations d'un arrondissement.
   S'appuie sur les données déjà chargées par app.js (réseau, arrondissements). */

/* Longueur de la manche. Elle dépend du mode : vingt questions sur tout le réseau, dix
   sur une ligne seule — d'où une variable et non une constante, fixée au choix du mode. */
let ROUNDS = 20;


/* Deux façons de jouer, et un seul réglage de difficulté : celle-ci ne se choisit plus,
   elle monte au fil de la manche. Les chiffres sont les mêmes des deux côtés — le mode
   ne dit pas si c'est dur, il dit sur quoi portent les questions. */
const REGLAGE = {
  temps: 0.8,                    // part du temps accordé par question
  visee: 0.65,                   // tolérance de visée sur la carte
  aides: null,                   // aucun coup de pouce
  depart: 0.3,                   // difficulté de la première question
  pente: 0.7,                    // et ce qu'elle gagne d'ici la dernière
};

const MODES = {
  /* Le classique : tout le réseau, toutes les formes de questions. */
  metro: { nom: "Métro", questions: 20, ...REGLAGE },

  /* On choisit sa ligne avant de commencer, et la manche entière s'y tient. Les formes
     retenues sont celles qui portaient déjà sur une ligne — situer une station, la
     reconnaître, dire ce qui suit, repérer l'intruse, citer les arrondissements
     traversés — mais la ligne ne change plus d'une question à l'autre. */
  ligne: {
    nom: "Lignes", questions: 10, ...REGLAGE,
    formes: ["spot", "name", "next", "odd", "wards"], choixLigne: true,
  },

  /* Le voyage n'est pas une manche mais une course : la rame enchaîne les stations et ne
     s'arrête qu'au bout de trois erreurs. Ni longueur ni chronomètre — c'est elle qui
     donne le tempo, et elle accélère. Servi par voyage.js. */
  voyage: { nom: "Voyage", questions: 0, ...REGLAGE, voyage: true },
};

const LIGNE_CHOISIE = "metro-ligne";
const MODE_CHOISI = "metro-mode";
const DEFAUT = "metro";
/* Tolérance de visée. Elle suit le zoom : viser à 15 pixels près doit valoir la même
   chose que l'on regarde tout le réseau ou un seul quartier. */
/* Coup de pouce sur « Trouve telle station » : passé ces fractions du temps accordé,
   la ligne s'allume, puis un cercle se resserre autour de la cible. Chaque palier coûte
   une part du score : attendre l'aide reste un choix, pas une aubaine. */
/* Part du score conservée après un, deux, puis trois coups de pouce. Les moments où ils
   arrivent, eux, dépendent du mode. */
const GARDE = [0.85, 0.72, 0.60];

const AIM_PX = 16;               // « pile dessus » sous ce rayon, en pixels
const AIM_MIN = 200;             // ...sans jamais descendre sous ce rayon, en mètres
const PICK_PX = 26;              // portée d'un clic pour désigner une station
const PICK_MIN = 300;
const LIMIT = { station: 15, district: 25, spot: 15, name: 30, wards: 35,
                hue: 15, theme: 35, next: 18, odd: 20, which: 15,
                outside: 20, far: 20, fake: 20, landmark: 18,
                corresp: 20, pasterminus: 22, lettre: 25, long: 28 };  // secondes, par type

/* Toutes les formes de questions. Elles ne sont pas classées : la difficulté d'une manche
   ne vient pas de l'ordre des types mais de ce qu'on tire à l'intérieur de chacun — plus
   la manche avance, plus la station, l'arrondissement ou le thème sont retors. L'ordre,
   lui, est entièrement rebattu à chaque partie. */
const KINDS = ["station", "which", "hue", "name", "odd", "outside", "spot", "landmark",
               "district", "far", "next", "fake", "theme", "wards",
               "corresp", "pasterminus", "lettre", "long"];

/* Formes assez accessibles pour ouvrir une manche. */
const OPENERS = ["station", "which", "hue"];

/* Formes admises en reprise quand la manche est plus longue que le catalogue : on évite
   celles dont le vivier est le plus étroit, pour ne pas radoter. */
const FILLERS = ["station", "spot", "which", "odd", "next", "outside", "far",
                 "landmark", "fake", "hue", "district", "corresp", "pasterminus"];

const NEEDS_LINE = new Set(["spot", "name", "wards", "next", "odd"]);

/* un record par mode : les deux ne se comparent pas */
/* Le record est propre au mode — et, en mode ligne, propre à la ligne : battre son
   score sur la 14 n'a rien à voir avec le battre sur la 7. */
const bestKey = () => `metro-chasse-record-${Game.mode}` +
  (MODES[Game.mode].choixLigne && ligneFixe !== null ? `-${ligneFixe}` : "");

/* Titres décernés en fin de manche, du meilleur au plus modeste. */
const GRADES = [
  { min: 0.92, cle: "titi",       tete: "🤌", title: "Titi parisien",
    note: "vous êtes né dans un couloir de correspondance" },
  { min: 0.80, cle: "poinconneur", tete: "😎", title: "Poinçonneur des Lilas",
    note: "des p'tits trous, toujours des p'tits trous" },
  { min: 0.66, cle: "habitue",    tete: "🙂", title: "Habitué du réseau",
    note: "vous savez dans quelle voiture monter" },
  { min: 0.50, cle: "usager",     tete: "😐", title: "Usager du quotidien",
    note: "votre ligne, et deux ou trois autres" },
  { min: 0.34, cle: "dimanche",   tete: "😅", title: "Passager du dimanche",
    note: "vous consultez le plan, mais discrètement" },
  { min: 0.18, cle: "egare",      tete: "😬", title: "Banlieusard égaré",
    note: "toujours du bon côté du quai, jamais du bon quai" },
  { min: 0,    cle: "touriste",   tete: "🧳", title: "Touriste",
    note: "le plan à l'envers, mais l'air ravi" },
];

/* La réaction de fin de partie, dans les codes du meme : une image barrée d'un texte en
   capitales. Par défaut une frimousse dessinée sur place ; si un fichier memes/<grade>.gif
   existe, il la remplace. Rien n'est embarqué : à chacun d'y mettre ce qu'il veut. */
const CRIS = {
  titi: "Ah ouais quand même",
  poinconneur: "T'as du niveau ça va",
  habitue: "Tranquille Émile",
  usager: "Merde c'est quelle station après ?",
  dimanche: "Maman attends !…",
  egare: "C'est par où la gare Saint-Lazare ?",
  touriste: "Excuse me, where is le métro",
};

/* Devinettes sur les noms eux-mêmes. Chaque thème se résout contre les vrais noms du
   réseau au chargement : aucune réponse n'est écrite à la main, donc aucune ne ment. */
const THEMES = [
  { ask: "dont le nom contient le mot « Gare »", need: 2, re: /\bgare\b/ },
  { ask: "dont le nom contient une couleur", need: 2, re: /\b(blanc(he)?|rouge|noire?|vert(e)?|bleue?|jaune)\b/ },
  { ask: "dont le nom commence par « Porte »", need: 3, re: /^porte\b/ },
  { ask: "dont le nom contient « Saint » ou « Sainte »", need: 3, re: /\bsainte?\b/ },
  { ask: "dont le nom commence par « Mairie »", need: 2, re: /^mairie\b/ },
  { ask: "dont le nom contient « Pont »", need: 2, re: /\bpont\b/ },
  { ask: "dont le nom contient « Château »", need: 2, re: /\bchateau\b/ },
  { ask: "qui portent un nom de chef d'État", need: 2,
    only: ["Franklin D. Roosevelt", "Charles de Gaulle - Étoile",
           "Bibliothèque François Mitterrand", "George V"] },
  { ask: "qui portent un nom d'écrivain", need: 2,
    only: ["Victor Hugo", "Alexandre Dumas", "Voltaire", "Anatole France",
           "Avenue Émile Zola", "Villejuif - Louis Aragon", "Goncourt",
           "Bobigny - Pantin - Raymond Queneau", "Edgar Quinet"] },
  { ask: "qui portent un nom de bataille ou de victoire", need: 2,
    only: ["Gare d'Austerlitz", "Iéna", "Wagram", "Réaumur - Sébastopol",
           "Stalingrad", "Alésia", "Solférino", "Campo-Formio", "Bir-Hakeim",
           "Crimée", "Alma - Marceau"] },
  { ask: "qui portent un nom de femme", need: 2,
    only: ["Louise Michel", "Pierre et Marie Curie", "Barbara",
           "Bagneux - Lucie Aubrac"] },
  { ask: "qui portent un nom d'artiste", need: 2,
    only: ["Serge Gainsbourg", "Barbara", "Bobigny - Pablo Picasso",
           "Michel-Ange - Auteuil", "Michel-Ange - Molitor"] },
];

const Game = {
  playing: false,
  question: null,
  score: 0,
  step: 0,
  history: [],
  mode: "metro",
  streak: 0,         // bonnes réponses d'affilée
  line: null,        // ligne sur laquelle porte la question en cours
  lastKind: null,
  plan: [],          // formes de questions de la manche, tirées au début
  blind: false,      // réseau dessiné en gris, pour les questions de couleur
};
window.Game = Game;

let fame = [];                   // stations classées de la plus courue à la plus discrète
let districts = [];              // arrondissements jouables, du plus large au plus étroit
let byDistrict = new Map();
let asked = new Set();
let askedDistricts = new Set();
let byLine = [];                 // stations de chaque ligne, dans l'ordre du parcours
let wardsOf = [];                // arrondissements traversés par chaque ligne
let askedHues = new Set();
let hueOrder = [];               // lignes classées de la teinte la plus isolée à la plus confuse
let outsiders = [];              // stations hors de Paris, des plus lointaines aux plus proches
let themes = [];
let askedThemes = new Set();
let estTerminus = new Set();     // stations en bout de ligne
let termini = [];                // les mêmes, des plus courues aux plus discrètes
let parInitiale = new Map();     // stations rangées par première lettre
let initiales = [];              // lettres jouables, des plus fournies aux plus avares
let seuils = [];                 // longueurs de nom jouables, de la plus permissive à la plus rude
let ligneFixe = null;            // ligne imposée à toute la manche, en mode ligne
let jouables = [];               // lignes proposées au choix : toutes sauf les bis
let started = 0;                 // horodatage du début de la question
let reveal = null;               // ce qui reste affiché après une réponse

const hud = document.getElementById("hud");
const over = document.getElementById("over");
const playBtn = document.getElementById("play");
const timebar = hud.querySelector(".clock");
const pips = hud.querySelector(".pips");
const fx = document.getElementById("fx");
const rush = document.getElementById("rush");
const edge = document.getElementById("edge");
const party = document.getElementById("party");
const recordLine = document.getElementById("record");
const boutsLine = document.getElementById("bouts");
const choices = hud.querySelector(".choices");
const reply = hud.querySelector(".reply");
const field = reply.querySelector("input");

/* Le même champ sert aux numéros d'arrondissement et aux noms de stations :
   il faut donc régler à chaque fois la longueur admise et le clavier mobile. */
function openField(hint = "n° d'arrondissement", digits = true) {
  reply.hidden = false;
  field.value = "";
  field.placeholder = hint;
  field.maxLength = digits ? 5 : 48;
  field.inputMode = digits ? "numeric" : "text";
  replay(reply);
  setTimeout(() => { if (!reply.hidden) field.focus(); }, 30);
}

function hideInputs() {
  choices.hidden = true;
  choices.innerHTML = "";
  reply.hidden = true;
  field.blur();
}

reply.addEventListener("submit", e => {
  e.preventDefault();
  const q = Game.question;
  if (!q || reveal) return;
  if (q.kind === "theme") return answerTheme(q);
  if (q.kind === "lettre" || q.kind === "long") return answerNom(q);
  if (q.kind !== "wards") return;
  const n = parseInt(field.value, 10);
  field.value = "";
  if (!n || n < 1 || n > 20) {
    say("<em>de 1 à 20</em>", "far");
    return;
  }
  if (q.found.includes(n)) {
    say(`<em>${ordinal(n)}</em> · déjà donné`, "");
    return;
  }
  if (q.list.includes(n)) {
    q.found.push(n);
    award(200, true);
    say(`<em>${ordinal(n)}</em> · ${q.found.length} sur ${q.need}`, "near");
  } else {
    q.misses++;
    say(`<em>${ordinal(n)}</em> · la ligne n'y passe pas`, "far");
  }
  tally();
  if (q.found.length >= q.need || q.misses >= 3) closeWards();
  else field.focus();                              // enchaîner sans refermer le clavier
});

/* Réponse à une devinette de nom. */
function answerTheme(q) {
  const text = field.value.trim();
  field.value = "";
  if (!text) return;
  const left = q.theme.hits.filter(i => !q.found.includes(i));
  const hit = match(text, left);
  if (hit >= 0) {
    q.found.push(hit);
    award(350, true);
    say(`<em>${net.stations[hit][0]}</em> · ${q.found.length} sur ${q.need}`, "near");
  } else {
    q.misses++;
    const known = match(text, net.stations.map((_, i) => i));
    say(known >= 0 && !q.theme.hits.includes(known)
        ? `<em>${net.stations[known][0]}</em> ne convient pas`
        : "<em>inconnue au bataillon</em>", "far");
  }
  tally();
  if (q.found.length >= q.need || q.misses >= 3) closeTheme();
  else field.focus();
}

/* Les deux formes où l'on écrit un nom libre : une initiale imposée, ou une longueur
   minimale. La règle change, la mécanique est la même — d'où une seule fonction, qui
   demande à la question ce qu'elle accepte et comment le dire. */
function answerNom(q) {
  const text = field.value.trim();
  field.value = "";
  if (!text) return;

  const i = match(text, net.stations.map((_, k) => k));
  if (i < 0) {
    q.misses++;
    say("<em>inconnue au bataillon</em>", "far");
  } else if (q.kind === "lettre" && plain(net.stations[i][0])[0] !== q.lettre) {
    q.misses++;
    say(`<em>${net.stations[i][0]}</em> ne commence pas par ${q.lettre.toUpperCase()}`, "far");
  } else if (q.kind === "long" && lettresDe(i) < q.need) {
    q.misses++;
    say(`<em>${net.stations[i][0]}</em> · ${lettresDe(i)} lettres, il en faut ${q.need}`, "far");
  } else {
    const seconds = (performance.now() - started) / 1000;
    const points = award(Math.round(600 +
                         300 * Math.max(0, 1 - seconds / limite(q.kind))), true);
    q.target = i;
    Game.history.push({ kind: q.kind, name: net.stations[i][0], points });
    say(`<em>${points} pts</em> · ${net.stations[i][0]}`, "near");
    tally();
    hideInputs();
    reveal = { won: true, until: performance.now() + 2400 };
    return;
  }
  tally();
  if (q.misses >= 3) {
    award(0, false);
    Game.history.push({ kind: q.kind, name: null, points: 0 });
    say(`<em>trois essais</em> · par exemple ${net.stations[q.target][0]}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else {
    field.focus();
  }
}

function closeTheme() {
  const q = Game.question;
  Game.history.push({ kind: "theme", name: q.theme.ask, hits: q.found.length,
                      need: q.need, points: q.found.length * 350 });
  hideInputs();
  reveal = { until: performance.now() + 2800 };
}

function closeWards() {
  const q = Game.question;
  Game.history.push({ kind: "wards", name: `ligne ${lineName(q.line)}`,
                      hits: q.found.length, need: q.need,
                      points: q.found.length * 200 });
  hideInputs();
  reveal = { until: performance.now() + 3000 };
}

/* Relance une animation CSS sur un élément déjà en place. */
function replay(el) {
  if (!el) return;
  el.classList.remove("swap");
  void el.offsetWidth;                             // force le navigateur à repartir de zéro
  el.classList.add("swap");
}

function showChoices(options, onPick) {
  choices.innerHTML = "";
  for (const opt of options) {
    const b = document.createElement("button");
    if (opt.html) b.innerHTML = opt.html; else b.textContent = opt.label;
    b.onclick = () => {
      [...choices.children].forEach(c => { c.disabled = true; });
      b.classList.add(opt.right ? "right" : "wrong");
      if (!opt.right) {
        const good = [...choices.children][options.findIndex(o => o.right)];
        if (good) good.classList.add("right");
      }
      onPick(opt);
    };
    choices.appendChild(b);
  }
  choices.hidden = false;
  replay(choices);
}

const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(p => p[1]);

/* ---------- préparation ---------- */

addEventListener("metro:ready", () => {
  // notoriété d'une station : le nombre de passages quotidiens, relevé par les
  // correspondances — un proxy honnête de « tout le monde connaît »
  const perPattern = new Array(net.patterns.length).fill(0);
  for (const tr of fleet) if (tr.today) perPattern[tr.pat]++;
  const traffic = new Array(net.stations.length).fill(0);
  net.patterns.forEach((p, k) => { for (const st of p[3]) traffic[st] += perPattern[k]; });

  fame = net.stations
    .map((s, i) => ({ i, weight: traffic[i] * (1 + 0.3 * (s[3].length - 1)) }))
    .sort((a, b) => b.weight - a.weight)
    .map(o => o.i);

  const where = paris ? paris.stationDistrict : [];
  where.forEach((n, i) => {
    if (!n) return;
    if (!byDistrict.has(n)) byDistrict.set(n, []);
    byDistrict.get(n).push(i);
  });
  districts = (paris ? paris.districts : [])
    .filter(d => (byDistrict.get(d.n) || []).length >= 5)
    .sort((a, b) => byDistrict.get(b.n).length - byDistrict.get(a.n).length);

  // stations et arrondissements de chaque ligne, pour les chapitres qui s'y consacrent
  byLine = net.lines.map(() => new Set());
  net.patterns.forEach(p => { for (const st of p[3]) byLine[p[0]].add(st); });
  byLine = byLine.map(set => [...set]);
  wardsOf = byLine.map(list => {
    const seen = new Set();
    for (const i of list) { const n = where[i]; if (n) seen.add(n); }
    return [...seen].sort((a, b) => a - b);
  });

  // une couleur bien à part se reconnaît d'emblée ; deux teintes voisines se confondent,
  // et c'est cet écart qui fait la difficulté de la question
  const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
  const gap = (a, b) => Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]));
  hueOrder = net.lines.map((l, i) => {
    let nearest = Infinity;
    net.lines.forEach((o, k) => {
      if (k === i || o[1] === l[1]) return;       // les bis partagent la teinte de leur aînée
      nearest = Math.min(nearest, gap(l[1], o[1]));
    });
    return { line: i, apart: nearest };
  }).sort((a, b) => b.apart - a.apart).map(o => o.line);

  // une station de banlieue lointaine se repère sans peine ; une station juste derrière
  // le périphérique se confond avec Paris — c'est ce qui fait la difficulté
  const inParis = net.stations.map((_, i) => i).filter(i => where[i]);
  outsiders = net.stations
    .map((_, i) => i)
    .filter(i => where.length && !where[i])
    .map(i => ({ i, d: Math.min(...inParis.map(k => apart(i, k))) }))
    .sort((a, b) => b.d - a.d)
    .map(o => o.i);

  // chaque thème est confronté aux noms réels ; ceux qui ne tiennent pas sont écartés
  themes = THEMES.map(t => {
    const hits = t.only
      ? t.only.map(n => net.stations.findIndex(s => plain(s[0]) === plain(n)))
              .filter(i => i >= 0)
      : net.stations.map((_, i) => i).filter(i => t.re.test(plain(net.stations[i][0])));
    return { ...t, hits };
  }).filter(t => t.hits.length > t.need);

  // les bouts de ligne, relevés sur le tracé le plus long de chaque ligne : les services
  // partiels s'arrêtent en route et donneraient de faux terminus
  const plusLong = new Map();
  for (const p of net.patterns) {
    const vu = plusLong.get(p[0]);
    if (!vu || p[3].length > vu.length) plusLong.set(p[0], p[3]);
  }
  estTerminus = new Set();
  for (const stops of plusLong.values()) {
    estTerminus.add(stops[0]);
    estTerminus.add(stops[stops.length - 1]);
  }
  termini = fame.filter(i => estTerminus.has(i));

  // les initiales, des plus fournies aux plus avares : commencer par R est une chose,
  // trouver une station en Y en est une autre
  parInitiale = new Map();
  net.stations.forEach((st, i) => {
    const c = plain(st[0])[0];
    if (!c || !/[a-z]/.test(c)) return;
    if (!parInitiale.has(c)) parInitiale.set(c, []);
    parInitiale.get(c).push(i);
  });
  initiales = [...parInitiale.entries()]
    .filter(([, liste]) => liste.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([c]) => c);

  // les seuils de longueur : on ne garde que ceux qui laissent de quoi répondre
  seuils = [];
  for (let n = 9; n <= 30; n++) {
    if (net.stations.filter((_, i) => lettresDe(i) >= n).length >= 3) seuils.push(n);
  }

  dresseLignes();
  playBtn.disabled = false;
  // les anciens modes — facile, normal, stations — retombent tous sur le classique, et
  // le meilleur score du normal le suit : il portait déjà sur les mêmes réglages
  try {
    const ancien = `metro-chasse-record-parisien`;
    if (localStorage.getItem(ancien) && !localStorage.getItem("metro-chasse-record-metro")) {
      localStorage.setItem("metro-chasse-record-metro", localStorage.getItem(ancien));
    }
  } catch { /* stockage indisponible */ }
  let garde = DEFAUT;
  try { garde = localStorage.getItem(MODE_CHOISI) || DEFAUT; } catch { /* ignoré */ }
  setMode(garde);
});

const choixLignes = document.getElementById("lignes");

/* Le damier des seize lignes, dressé une fois le réseau chargé. */
function dresseLignes() {
  // les bis sont écartées : quatre stations et un seul arrondissement ne font pas une manche
  jouables = net.lines.map((_, i) => i).filter(i => !/b$/i.test(net.lines[i][0]));
  choixLignes.innerHTML = jouables.map(i => {
    const l = net.lines[i], bouts = lineEnds(i);
    return `<button data-ligne="${i}" style="background:${l[1]};color:${l[2]}"
             title="${bouts.from} ↔ ${bouts.to}">${l[0]}</button>`;
  }).join("");
  choixLignes.querySelectorAll("button").forEach(b => {
    b.onclick = () => choisirLigne(+b.dataset.ligne);
  });
}

function choisirLigne(i) {
  ligneFixe = i;
  try { localStorage.setItem(LIGNE_CHOISIE, String(i)); } catch { /* ignoré */ }
  choixLignes.querySelectorAll("button").forEach(b =>
    b.classList.toggle("on", +b.dataset.ligne === i));
  showRecord();
}

/* Le record se tient à part, dans le coin de l'écran : il récompense, il n'instruit pas.
   Sous le damier, en revanche, les deux terminus disent quelle ligne on a retenue —
   « 7 » tout seul ne parle qu'à ceux qui la connaissent déjà. */
function showRecord() {
  let best = 0;
  try { best = +(localStorage.getItem(bestKey()) || 0); } catch { /* stockage indisponible */ }
  recordLine.textContent = best ? `🎉 ${best.toLocaleString("fr-FR")}` : "";
  recordLine.hidden = !best;

  const surLigne = MODES[Game.mode].choixLigne && ligneFixe !== null;
  if (surLigne) {
    const bouts = lineEnds(ligneFixe);
    boutsLine.textContent = `${bouts.from} ↔ ${bouts.to}`;
  }
  boutsLine.hidden = !surLigne;
}

/* Le mode se choisit avant la partie et se retient d'une visite à l'autre. */
function setMode(cle) {
  Game.mode = MODES[cle] ? cle : DEFAUT;
  ROUNDS = MODES[Game.mode].questions;
  document.querySelectorAll("#modes button").forEach(b =>
    b.classList.toggle("on", b.dataset.mode === Game.mode));
  try { localStorage.setItem(MODE_CHOISI, Game.mode); } catch { /* ignoré */ }

  const surLigne = !!MODES[Game.mode].choixLigne;
  choixLignes.hidden = !surLigne;
  if (surLigne) {
    if (ligneFixe === null) {
      let garde = 0;
      try { garde = +(localStorage.getItem(LIGNE_CHOISIE) || 0); } catch { /* ignoré */ }
      ligneFixe = jouables.includes(garde) ? garde : jouables[0];
    }
    choisirLigne(ligneFixe);                       // rétablit la pastille allumée
  } else {
    ligneFixe = null;
  }

  showRecord();
}

/* Pose une illustration dans un cadre. On cherche d'abord une vidéo : Safari sur iPhone
   refuse d'animer une image dont le décodage dépasse une douzaine de mégaoctets en
   mémoire — largeur × hauteur × nombre d'images — et se contente alors d'afficher la
   première. Une vidéo muette échappe à cette limite, et pèse dix à quarante fois moins.
   À défaut, on retombe sur le gif, puis sur la frimousse déjà en place. */
function illustre(cadre, nom, valide) {
  const film = document.createElement("video");
  film.muted = true;                               // sans quoi iOS refuse la lecture seule
  film.loop = true;
  film.autoplay = true;
  film.playsInline = true;
  film.className = "gif";

  const poser = element => {
    if (!valide()) return;                         // le contexte a changé entre-temps
    cadre.innerHTML = "";
    cadre.appendChild(element);
  };

  film.oncanplay = () => { poser(film); film.play().catch(() => {}); };
  film.onerror = () => {
    const gif = new Image();
    gif.className = "gif";
    gif.onload = () => poser(gif);
    gif.src = `memes/${nom}.gif`;
  };
  film.src = `memes/${nom}.mp4`;
}

/* L'illustration du mode choisi. */
document.querySelectorAll("#modes button").forEach(b => {
  b.onclick = () => setMode(b.dataset.mode);
});

/* Comparaison indulgente : accents, tirets, casse et ponctuation ne comptent pas. */
const plain = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Nombre de lettres d'un nom de station, espaces et traits d'union exclus : c'est ce
   qu'un joueur compte spontanément quand on lui demande un nom « d'au moins n lettres ». */
const lettresDe = i => plain(net.stations[i][0]).replace(/[^a-z0-9]/g, "").length;

function edits(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/* Morceaux d'un nom de station. On coupe sur les tirets encadrés d'espaces et les
   parenthèses, jamais sur les traits d'union internes : « Saint-Denis » reste entier,
   « Bagneux - Lucie Aubrac » donne ses deux moitiés. */
function pieces(name) {
  return [name, ...name.split(/ [-–] |[(),]/)]
    .map(plain)
    .filter(p => p.length > 2);
}

/* Station visée par une saisie, parmi une liste de candidates. On accepte le nom entier,
   l'un de ses morceaux, une saisie plus courte ou plus longue que le nom, et les fautes
   de frappe — répondre « Lucie Aubrac » pour « Bagneux - Lucie Aubrac » doit passer. */
function match(text, pool) {
  const q = plain(text);
  if (q.length < 3) return -1;
  let best = -1, bestScore = Infinity;
  for (const i of pool) {
    let score = Infinity;
    for (const part of pieces(net.stations[i][0])) {
      if (part === q) { score = 0; break; }
      const d = edits(q, part);
      if (d <= 2) score = Math.min(score, d);
      const contains = (part.includes(q) && q.length >= 4) ||
                       (q.includes(part) && part.length >= 4);
      if (contains) score = Math.min(score, 0.5 + Math.abs(part.length - q.length) * 0.05);
    }
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return bestScore <= 2.5 ? best : -1;
}

/* Un point tombe-t-il dans un anneau ? Lancer de rayon, en coordonnées écran. */
function within(rings, px, py) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i === 0 ? ring.length - 1 : i - 1], b = ring[i];
      const ay = sy(a[1]), by = sy(b[1]), ax = sx(a[0]), bx = sx(b[0]);
      if ((ay > py) !== (by > py) && px < ax + (bx - ax) * (py - ay) / (by - ay)) hit = !hit;
    }
  }
  return hit;
}

const ordinal = n => n === 1 ? "1er" : n + "e";
const lineName = i => net.lines[i][0].replace(/B$/, "bis");
const pill = i => `<span class="pill" style="background:${net.lines[i][1]};color:${net.lines[i][2]}">${net.lines[i][0]}</span>`;

/* Chaque catalogue est rangé du plus facile au plus difficile ; on y puise à hauteur de
   l'avancement dans la manche, dans une fenêtre glissante qui descend le classement. */
function window_(list, step, width = 0.45) {
  if (!list.length) return [];
  const m = MODES[Game.mode];
  const p = Math.min(1, m.depart + (step / Math.max(1, ROUNDS - 1)) * m.pente);
  const span = Math.max(1, Math.round(list.length * width));
  const from = Math.round((list.length - span) * p);
  return list.slice(from, from + span);
}

function graded(list, step, width = 0.45) {
  const slice = window_(list, step, width);
  return slice.length ? slice[Math.floor(Math.random() * slice.length)] : null;
}

/* Les stations les plus fréquentées d'abord, les plus discrètes pour finir. */
function pickStation(step) {
  return graded(fame.filter(i => !asked.has(i)), step, 0.3)
      ?? fame.find(i => !asked.has(i));
}

/* Viser le 3e est autrement plus exigeant que viser le 15e : les arrondissements sont
   classés par nombre de stations, donc en gros par surface. */
function pickDistrict(step) {
  return graded(districts.filter(d => !askedDistricts.has(d.n)), step)
      ?? districts[0];
}

/* Un thème à vingt-neuf réponses pardonne ; un thème à trois ne pardonne rien. */
function pickTheme(step) {
  const pool = themes.filter(t => !askedThemes.has(t.ask));
  return graded(pool.length ? pool : themes, step) ?? themes[0];
}

/* Une teinte franche pour commencer, une teinte qui prête à confusion pour finir. */
function pickHue(step) {
  const pool = hueOrder.filter(i => !askedHues.has(i));
  return graded(pool.length ? pool : hueOrder, step) ?? 0;
}

const swatch = i =>
  `<span class="swatch" style="background:${net.lines[i][1]}"></span>`;

/* Tire la manche : chaque forme de question au moins une fois, l'ordre suivant la
   difficulté, avec assez de jeu pour que deux parties ne se ressemblent pas. */
function buildRound() {
  // un mode peut avoir son propre catalogue, plus court que la manche : on le rebat
  // autant de fois qu'il faut, en veillant à ne pas répéter une forme d'un tour à l'autre
  let propres = MODES[Game.mode].formes;
  // une ligne courte n'a pas de quoi nourrir toutes les formes : 3bis ne traverse qu'un
  // arrondissement et compte quatre stations, de quoi situer et enchaîner, rien de plus
  if (propres && ligneFixe !== null && byLine[ligneFixe].length < 8) {
    propres = propres.filter(f => f !== "wards" && f !== "name");
  }
  if (propres) {
    const picks = [];
    while (picks.length < ROUNDS) {
      let lot = shuffle(propres);
      if (picks.length && lot[0] === picks[picks.length - 1] && lot.length > 1) {
        lot = [lot[1], lot[0], ...lot.slice(2)];
      }
      picks.push(...lot);
    }
    picks.length = ROUNDS;
    return picks;
  }

  // une forme accessible pour ouvrir, le reste dans un désordre complet ; comme il y a
  // plus de formes que de questions, chaque partie en laisse une ou deux de côté
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  const picks = [opener, ...shuffle(KINDS.filter(k => k !== opener))];
  // il y a un peu moins de formes que de questions : toutes passent, et les deux ou trois
  // dernières places sont reprises parmi celles dont le vivier est le plus large
  while (picks.length < ROUNDS) {
    picks.push(FILLERS[Math.floor(Math.random() * FILLERS.length)]);
  }
  picks.length = ROUNDS;
  return picks;
}

/* Distance approximative entre deux stations, en degrés pondérés — suffisant pour
   classer des voisines. */
function apart(a, b) {
  const p = net.stations[a], q = net.stations[b];
  return Math.hypot((p[1] - q[1]) * 1.5, p[2] - q[2]);
}

/* Carré de `km` kilomètres de côté autour d'une station, dont le centre est décalé au
   hasard : on se rapproche de la zone sans placer la réponse au milieu de l'écran. */
function around(i, km) {
  const st = net.stations[i];
  const half = km * 1000 / M_PER_WORLD / 2;
  const jx = (Math.random() - 0.5) * half;
  const jy = (Math.random() - 0.5) * half;
  return {
    minX: st[4][0] + jx - half, maxX: st[4][0] + jx + half,
    minY: st[4][1] + jy - half, maxY: st[4][1] + jy + half,
  };
}

/* Emprise d'un ensemble d'anneaux. */
function ringsBounds(rings) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/* Élargit une emprise et déplace un peu son centre : on se rapproche assez pour viser
   confortablement, sans que le cadrage ne pointe du doigt la zone cherchée. */
function loosely(box, factor, jitter = 0.5) {
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const w = (box.maxX - box.minX) * factor / 2;
  const h = (box.maxY - box.minY) * factor / 2;
  const dx = (Math.random() - 0.5) * w * jitter;
  const dy = (Math.random() - 0.5) * h * jitter;
  return { minX: cx + dx - w, maxX: cx + dx + w, minY: cy + dy - h, maxY: cy + dy + h };
}

/* Une vingtaine de lieux parisiens, par leurs coordonnées. La bonne réponse n'est jamais
   écrite : c'est la station la plus proche, calculée sur les données du réseau. */
const LANDMARKS = [
  ["la tour Eiffel", 48.8584, 2.2945],
  ["le Sacré-Cœur", 48.8867, 2.3431],
  ["Notre-Dame", 48.8530, 2.3499],
  ["l'Arc de Triomphe", 48.8738, 2.2950],
  ["le musée du Louvre", 48.8606, 2.3376],
  ["l'entrée du Père-Lachaise", 48.8615, 2.3880],
  ["le Moulin Rouge", 48.8842, 2.3323],
  ["le Panthéon", 48.8462, 2.3464],
  ["l'Opéra Garnier", 48.8720, 2.3316],
  ["les Catacombes", 48.8338, 2.3324],
  ["le Parc des Princes", 48.8414, 2.2530],
  ["le Stade de France", 48.9245, 2.3601],
  ["la Grande Arche", 48.8926, 2.2361],
  ["le zoo de Vincennes", 48.8322, 2.4136],
  ["le musée d'Orsay", 48.8600, 2.3266],
  ["le Centre Pompidou", 48.8607, 2.3522],
  ["le jardin du Luxembourg", 48.8462, 2.3372],
  ["la basilique de Saint-Denis", 48.9362, 2.3596],
  ["les Puces de Saint-Ouen", 48.9017, 2.3417],
  ["le parc de la Villette", 48.8938, 2.3900],
  ["Bercy Village", 48.8330, 2.3866],
  ["la tour Montparnasse", 48.8422, 2.3220],
  ["le Grand Palais", 48.8661, 2.3125],
  ["la Butte aux Cailles", 48.8272, 2.3494],
];

/* Le lieu et sa station partagent-ils un mot ? « l'Opéra Garnier » a pour réponse
   « Opéra » : la question se répond sans rien connaître du plan, elle ne vaut rien. Les
   mots courts sont ignorés, ce sont des articles. */
function seRepond(lieu, station) {
  const mots = t => plain(t).split(" ").filter(m => m.length > 3);
  const dits = new Set(mots(station));
  return mots(lieu).some(m => dits.has(m));
}

/* Stations les plus proches d'un point, de la plus proche à la plus lointaine. */
function nearestTo(lat, lon) {
  return net.stations
    .map((st, i) => ({ i, d: Math.hypot((st[1] - lat) * 1.5, st[2] - lon) }))
    .sort((a, b) => a.d - b.d);
}

/* Fabrique un nom de station qui sonne juste et n'existe pas : on recolle la tête d'un
   vrai nom à la queue d'un autre. */
/* Les noms génériques du réseau, dont on peut recoller les morceaux. */
const HEADS = /^(Porte|Mairie|Église|Pont|Place|Gare|Château|Rue|Avenue|Boulevard)\s+(de la|des|du|de|d')\s*/i;

/* On garde l'article du morceau repris — « du Nord » reste « du Nord » — et on élide
   devant une voyelle. Sans quoi l'imposteur se repérerait à sa faute de français plutôt
   qu'à sa géographie. */
function elide(mot, article, suite) {
  let art = article.toLowerCase();
  if (art === "de" || art === "d'") {
    art = /^[aeiouyâàéèêëîïôöûü]/i.test(suite) ? "d'" : "de";
  }
  const joint = art.endsWith("'") ? "" : " ";
  return `${mot} ${art}${joint}${suite}`.replace(/\s+/g, " ").trim();
}

/* Fabrique un nom de station qui sonne juste et n'existe pas : on recolle la tête d'un
   vrai nom à la queue d'un autre. */
function impostor() {
  const composes = [], generiques = [];
  for (const st of net.stations) {
    const m = st[0].match(HEADS);
    if (m) generiques.push({ mot: m[1], art: m[2], suite: st[0].slice(m[0].length) });
    const cut = st[0].split(" - ");
    if (cut.length === 2 && cut[0].length > 3 && cut[1].length > 3) {
      composes.push({ tete: cut[0], queue: cut[1] });
    }
  }
  const known = new Set(net.stations.map(st => plain(st[0])));

  for (let essai = 0; essai < 90; essai++) {
    let nom;
    if (Math.random() < 0.5 && generiques.length > 1) {
      const a = generiques[Math.floor(Math.random() * generiques.length)];
      const b = generiques[Math.floor(Math.random() * generiques.length)];
      if (a === b || !b.suite) continue;
      nom = elide(a.mot, b.art, b.suite);
    } else {
      const a = composes[Math.floor(Math.random() * composes.length)];
      const b = composes[Math.floor(Math.random() * composes.length)];
      if (!a || !b || a === b) continue;
      nom = `${a.tete} - ${b.queue}`;
    }
    if (!known.has(plain(nom)) && nom.length < 34) return nom;
  }
  return null;
}

/* Distance entre deux stations, en kilomètres : un degré de longitude vaut 73,2 km à la
   latitude de Paris, et `apart` compte justement en unités de longitude. */
const km = (a, b) => apart(a, b) * 73.2;

/* Le parcours le plus complet d'une ligne : celui qui dessert le plus d'arrêts. */
function mainRun(line) {
  let best = null;
  for (const p of net.patterns) {
    if (p[0] === line && (!best || p[3].length > best[3].length)) best = p;
  }
  return best;
}

/* Un tour de la question à choix : une station de la ligne, deux intruses de notoriété
   comparable pour que le tri ne se fasse pas au flair. */
function nextChoice() {
  const q = Game.question;
  const pool = byLine[q.line].filter(i => !q.seen.includes(i));
  if (!pool.length) return closeName();
  const right = pool[Math.floor(Math.random() * pool.length)];
  q.seen.push(right);

  const rank = fame.indexOf(right);
  const near = fame.slice(Math.max(0, rank - 60), rank + 60)
    .filter(i => !byLine[q.line].includes(i));
  const spare = net.stations.map((_, i) => i).filter(i => !byLine[q.line].includes(i));
  const others = shuffle(near.length >= 2 ? near : spare).slice(0, 2);

  showChoices(shuffle([
    { label: net.stations[right][0], right: true, station: right },
    ...others.map(i => ({ label: net.stations[i][0], right: false, station: i })),
  ]), opt => {
    if (opt.right) {
      q.found.push(opt.station);
      award(300, true);
      say(`<em>${net.stations[opt.station][0]}</em> · ${q.found.length} sur ${q.need}`, "near");
    } else {
      q.misses++;
      award(0, false);
      say(`<em>${net.stations[opt.station][0]}</em> n'est pas sur cette ligne`, "far");
    }
    tally();
    q.turn++;
    if (q.turn >= q.need) setTimeout(closeName, 900);
    else setTimeout(() => { if (Game.playing && Game.question === q) nextChoice(); }, 900);
  });
}

/* La couleur revient au moment de la correction : c'est là que ça s'apprend. */
function endHue() {
  Game.blind = false;
  bgDirty = true;
  reveal = { until: performance.now() + 2600 };
}

function closeName() {
  const q = Game.question;
  if (!q || reveal) return;
  Game.history.push({ kind: "name", name: `ligne ${lineName(q.line)}`,
                      hits: q.found.length, need: q.need, points: q.found.length * 300 });
  hideInputs();
  reveal = { until: performance.now() + 2000 };
}

/* Ligne support d'une question. Pour les arrondissements, le nombre d'arrondissements
   desservis fait la difficulté : deux à citer, ou dix. */
function pickLine(step, kind) {
  if (kind === "wards") {
    const ranked = net.lines.map((_, i) => i)
      .filter(i => wardsOf[i].length >= 2)
      .sort((a, b) => wardsOf[a].length - wardsOf[b].length);
    return graded(ranked, step, 0.4) ?? ranked[0] ?? 0;
  }
  const pool = net.lines.map((_, i) => i)
    .filter(i => byLine[i].length >= 15 && i !== Game.line);
  return pool[Math.floor(Math.random() * pool.length)] ?? 0;
}

function nextQuestion() {
  if (Game.step >= ROUNDS) return finish();

  let kind = Game.plan[Game.step] || "station";
  // le réseau ne reste jamais en noir au-delà d'une question de couleur
  if (Game.blind && kind !== "hue") { Game.blind = false; bgDirty = true; }
  if (kind === "district" && !districts.length) kind = "station";
  if (kind === "wards" && !districts.length) kind = "spot";
  if (kind === "theme" && !themes.length) kind = "station";

  // une question sur une ligne recadre la carte ; deux qui se suivent gardent la même,
  // sauf pour les arrondissements dont la ligne porte la difficulté
  if (NEEDS_LINE.has(kind)) {
    // en mode ligne, elle est choisie une fois pour toutes avant la partie
    const keep = ligneFixe !== null ||
                 (Game.line !== null && kind !== "wards" && NEEDS_LINE.has(Game.lastKind));
    if (!keep) {
      Game.line = pickLine(Game.step, kind);
      select(Game.line);
    }
  } else if (selected !== null) {                  // on se fie à l'état de la carte
    Game.line = null;
    select(null);
  } else if (helped) {                             // le coup de pouce avait rapproché la vue
    helped = false;
    flyTo(frameTo(bounds));
  }
  Game.lastKind = kind;

  if (kind === "landmark") {
    // on écarte les lieux dont la station la plus proche porte le même nom
    const tirage = shuffle([...LANDMARKS]);
    const retenu = tirage.find(([nom, la, lo]) =>
      !seRepond(nom, net.stations[nearestTo(la, lo)[0].i][0])) || tirage[0];
    const [lieu, lat, lon] = retenu;
    const proches = nearestTo(lat, lon);
    const bonne = proches[0].i;
    // les intruses viennent du voisinage : assez près pour hésiter, jamais les plus
    // proches, sinon la question deviendrait injuste
    const deux = shuffle(proches.slice(2, 8).map(o => o.i)).slice(0, 2);
    // la portée du cercle : exactement ce qui sépare le lieu de la bonne réponse, pour
    // qu'il la touche à la seconde où le temps s'épuise
    const [lx, ly] = merc(lat, lon);
    const monde = net.stations[bonne][4];
    const portee = Math.hypot(lx - monde[0], ly - monde[1]) * M_PER_WORLD;
    Game.question = { kind: "landmark", lieu, at: [lat, lon], target: bonne,
                      shown: [...deux, bonne], portee };
    ask(`Vous allez à <b>${lieu}</b> : quelle station est la plus proche ?`,
        false, "");
    // Le cadrage suit la portée : sans quoi un lieu collé à sa station donnerait un
    // cercle invisible, et un lieu isolé un cercle qui déborde de l'écran. Bornes hautes
    // et basses pour garder de quoi se repérer dans les deux cas.
    const cote = Math.min(1400, Math.max(450, portee * 3)) / M_PER_WORLD;
    flyTo(frameTo({ minX: lx - cote, maxX: lx + cote,
                    minY: ly - cote, maxY: ly + cote }, 0.9, 0, fitScale * 12), 700);
    showChoices(shuffle([
      { label: net.stations[bonne][0], right: true, station: bonne },
      ...deux.map(i => ({ label: net.stations[i][0], right: false, station: i })),
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("landmark"))), true);
        Game.history.push({ kind: "landmark", name: net.stations[bonne][0], points });
        say(`<em>${points} pts</em> · ${net.stations[bonne][0]}`, "near");
        Game.question.uClic = Math.min(1, elapsed(Game.question));
      } else {
        award(0, false);
        Game.history.push({ kind: "landmark", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> · c'était ` +
            `${net.stations[bonne][0]}`, "far");
        Game.question.uClic = Math.min(1, elapsed(Game.question));
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 2800 };
    });
  } else if (kind === "fake") {
    const faux = impostor();
    if (!faux) { Game.plan[Game.step] = "station"; return nextQuestion(); }
    // deux vraies stations de la même famille que l'imposteur, pour brouiller les pistes
    const tete = faux.split(/ - | /)[0];
    const cousines = net.stations.map((_, i) => i)
      .filter(i => net.stations[i][0].startsWith(tete));
    const deux = shuffle([...(cousines.length >= 2 ? cousines : fame.slice(0, 120))])
      .slice(0, 2);
    Game.question = { kind: "fake", faux, shown: deux };
    ask("l'imposteur : laquelle de ces stations n'existe pas ?", false, "Trouve");
    showChoices(shuffle([
      { label: faux, right: true },
      ...deux.map(i => ({ label: net.stations[i][0], right: false, station: i })),
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("fake"))), true);
        Game.history.push({ kind: "fake", name: faux, points });
        say(`<em>${points} pts</em> · ${faux} n'a jamais existé`, "near");
      } else {
        award(0, false);
        Game.history.push({ kind: "fake", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> existe bel et bien · ` +
            `l'imposteur était ${faux}`, "far");
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 2800 };
    });
  } else if (kind === "far") {
    // on tire beaucoup de triplets, puis on choisit selon l'écart entre la paire la plus
    // longue et sa suivante : net, la réponse saute aux yeux ; serré, il faut mesurer
    const pool = fame.slice(0, 220);
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const draws = [];
    for (let n = 0; n < 240; n++) {
      const pairs = [];
      for (let k = 0; k < 3; k++) {
        const a = pick();
        let b = pick();
        while (b === a) b = pick();
        pairs.push({ a, b, d: km(a, b) });
      }
      const sorted = [...pairs].sort((x, y) => y.d - x.d);
      if (sorted[0].d < 3) continue;               // trois paires minuscules : sans intérêt
      draws.push({ pairs, best: sorted[0], ratio: sorted[1].d / sorted[0].d });
    }
    draws.sort((x, y) => x.ratio - y.ratio);       // du plus tranché au plus serré
    const draw = graded(draws, Game.step, 0.4) ?? draws[0];

    Game.question = { kind: "far", pairs: draw.pairs, best: draw.best };
    ask("la paire de stations la plus éloignée", false, "Trouve");
    showChoices(shuffle(draw.pairs.map(p => ({
      label: `${net.stations[p.a][0]} ↔ ${net.stations[p.b][0]}`,
      right: p === draw.best, pair: p,
    }))), opt => {
      const seconds = (performance.now() - started) / 1000;
      const span = d => d.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " km";
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("far"))), true);
        Game.history.push({ kind: "far", name: span(draw.best.d), points });
        say(`<em>${points} pts</em> · ${span(draw.best.d)} à vol d'oiseau`, "near");
      } else {
        award(0, false);
        Game.history.push({ kind: "far", name: null, points: 0 });
        say(`<em>${span(opt.pair.d)}</em> · la plus longue faisait ${span(draw.best.d)}`, "far");
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 3000 };
    });
  } else if (kind === "outside") {
    const where = paris ? paris.stationDistrict : [];
    const target = graded(outsiders, Game.step, 0.4) ?? outsiders[0];
    // les deux stations parisiennes se rapprochent de la limite au fil de la manche
    const parisians = net.stations
      .map((_, i) => i)
      .filter(i => where[i])
      .map(i => ({ i, d: apart(i, target) }))
      .sort((a, b) => b.d - a.d)
      .map(o => o.i);
    const two = shuffle(window_(parisians, Game.step, 0.35)).slice(0, 2);
    Game.question = { kind: "outside", target, shown: [...two, target] };
    ask("laquelle n'est pas dans Paris ?", false, "Trouve");
    showChoices(shuffle([
      ...two.map(i => ({ label: net.stations[i][0], right: false, station: i })),
      { label: net.stations[target][0], right: true, station: target },
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("outside"))), true);
        Game.history.push({ kind: "outside", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]} est hors les murs`, "near");
      } else {
        award(0, false);
        Game.history.push({ kind: "outside", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> est bien dans Paris · ` +
            `c'était ${net.stations[target][0]}`, "far");
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 2800 };
    });
  } else if (kind === "which") {
    // une station desservie par une seule ligne : sinon plusieurs réponses vaudraient
    const solo = fame.filter(i => net.stations[i][3].length === 1 && !asked.has(i));
    const target = graded(solo, Game.step, 0.35) ?? solo[0];
    asked.add(target);
    const right = net.stations[target][3][0];
    // les lignes qui passent le plus près sont les plus trompeuses
    const near = net.lines
      .map((_, k) => k)
      .filter(k => k !== right)
      .map(k => ({ k, d: Math.min(...byLine[k].map(i => apart(i, target))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map(o => o.k);
    const wrong = shuffle(near).slice(0, 2);
    Game.question = { kind: "which", target, right };
    ask(`Pour aller à <b>${net.stations[target][0]}</b>, quelle ligne prendre ?`, false, "");
    showChoices(shuffle([
      { html: pill(right), right: true, line: right },
      ...wrong.map(k => ({ html: pill(k), right: false, line: k })),
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("which"))), true);
        Game.history.push({ kind: "which", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]} est sur la ligne ${lineName(right)}`, "near");
      } else {
        award(0, false);
        Game.history.push({ kind: "which", name: null, points: 0 });
        say(`<em>ligne ${lineName(opt.line)}</em> · c'était la ${lineName(right)}`, "far");
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 2600 };
    });
  } else if (kind === "next") {
    const run = mainRun(Game.line);
    const stops = run[3];
    // le point de départ est d'autant plus discret qu'on avance dans la manche
    const spots = stops.slice(0, -1)
      .map((_, i) => i)
      .sort((a, b) => fame.indexOf(stops[a]) - fame.indexOf(stops[b]));
    const at = graded(spots, Game.step, 0.5) ?? 0;
    const target = stops[at + 1];
    const toward = stops[stops.length - 1];

    // la station d'avant fait la meilleure intruse : elle punit qui se trompe de sens
    const decoys = [];
    if (at > 0) decoys.push(stops[at - 1]);
    const spare = stops.filter((v, i) => Math.abs(i - at) > 1 && v !== target);
    while (decoys.length < 2 && spare.length) {
      const other = spare.splice(Math.floor(Math.random() * spare.length), 1)[0];
      if (!decoys.includes(other)) decoys.push(other);
    }

    Game.question = { kind: "next", line: Game.line, from: stops[at], target, toward,
                      // la rame quitte la station de départ et roule vers la réponse :
                      // le temps qui passe devient une distance qui se réduit
                      trajet: trajetEntre(Game.line, stops[at], target) };
    ask(`la rame est direction <b>${net.stations[toward][0]}</b> · quelle station ` +
        `vient après <b>${net.stations[stops[at]][0]}</b> ?`, false, "");
    // on se rapproche du départ pour voir la rame avancer ; les noms restent masqués,
    // la carte ne donne donc pas la réponse
    if (Game.question.trajet) {
      const a = net.stations[stops[at]][4], b = net.stations[target][4];
      const demi = 2300 / M_PER_WORLD;    // ~4,6 km de côté : la rame avance visiblement
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      flyTo(frameTo({ minX: cx - demi, maxX: cx + demi,
                      minY: cy - demi, maxY: cy + demi }, 0.9, 0, fitScale * 9), 700);
    }
    showChoices(shuffle([
      { label: net.stations[target][0], right: true, station: target },
      ...decoys.map(i => ({ label: net.stations[i][0], right: false, station: i })),
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("next"))), true);
        Game.history.push({ kind: "next", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]}`, "near");
        Game.question.uClic = Math.min(1, elapsed(Game.question));
        reveal = { won: true, until: performance.now() + 2600 };
      } else {
        award(0, false);
        Game.history.push({ kind: "next", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> · c'était ` +
            `${net.stations[target][0]}`, "far");
        Game.question.uClic = Math.min(1, elapsed(Game.question));
        reveal = { won: false, until: performance.now() + 2800 };
      }
      tally();
      hideInputs();
    });
  } else if (kind === "odd") {
    const mine = byLine[Game.line];
    const two = shuffle([...mine]).slice(0, 2);
    // une intruse toute proche du tracé est autrement plus trompeuse qu'une lointaine
    const strangers = net.stations
      .map((_, i) => i)
      .filter(i => !mine.includes(i))
      .map(i => ({ i, d: Math.min(...mine.map(k => apart(i, k))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40)
      .reverse()                                   // des plus lointaines aux plus proches
      .map(o => o.i);
    const odd = graded(strangers, Game.step, 0.5) ?? strangers[0];
    Game.question = { kind: "odd", line: Game.line, odd, shown: [...two, odd] };
    ask(`l'intruse : laquelle n'est pas sur la ligne ${pill(Game.line)} ?`, false, "Trouve");
    showChoices(shuffle([
      ...two.map(i => ({ label: net.stations[i][0], right: false, station: i })),
      { label: net.stations[odd][0], right: true, station: odd },
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      if (opt.right) {
        const points = award(Math.round(700 +
                             250 * Math.max(0, 1 - seconds / limite("odd"))), true);
        Game.history.push({ kind: "odd", name: net.stations[opt.station][0], points });
        say(`<em>${points} pts</em> · ${net.stations[odd][0]} est ailleurs`, "near");
      } else {
        award(0, false);
        Game.history.push({ kind: "odd", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> est bien sur la ligne · ` +
            `l'intruse était ${net.stations[odd][0]}`, "far");
      }
      tally();
      hideInputs();
      reveal = { until: performance.now() + 2400 };
    });
  } else if (kind === "theme") {
    const t = pickTheme(Game.step);
    askedThemes.add(t.ask);
    Game.question = { kind: "theme", theme: t, need: t.need, found: [], misses: 0 };
    ask(`<b>${t.need}</b> stations ${t.ask}`, false, "Cite");
    openField("nom d'une station…", false);
  } else if (kind === "hue") {
    const li = pickHue(Game.step);
    askedHues.add(li);
    // les lignes bis reprennent la couleur de leur aînée : les deux réponses se valent
    const lines = net.lines.map((l, k) => l[1] === net.lines[li][1] ? k : -1)
                           .filter(k => k >= 0);
    Game.question = { kind: "hue", line: li, lines, tries: 0 };
    Game.blind = true;
    bgDirty = true;
    ask(`la ligne de cette couleur ${swatch(li)}`, false, "Touche");
  } else if (kind === "spot") {
    const pool = byLine[Game.line].filter(i => !asked.has(i));
    const i = (pool.length ? pool : byLine[Game.line])[
      Math.floor(Math.random() * (pool.length || byLine[Game.line].length))];
    asked.add(i);
    Game.question = { kind: "spot", target: i, line: Game.line };
    ask(`${pill(Game.line)} <b>${net.stations[i][0]}</b>`, false, "Situe");
  } else if (kind === "corresp") {
    // les stations à correspondance, des plus évidentes aux plus obscures
    const avec = fame.filter(i => net.stations[i][3].length >= 2);
    const libres = avec.filter(i => !asked.has(i));
    const target = graded(libres.length > 3 ? libres : avec, Game.step, 0.4) ?? avec[0];
    asked.add(target);
    const vraies = net.stations[target][3];
    const cle = l => [...l].sort((a, b) => a - b).join(",");
    // les leurres sont des jeux de lignes qui existent ailleurs sur le réseau, de même
    // taille : inventer des combinaisons impossibles rendrait la réponse trop lisible
    const vus = new Set([cle(vraies)]);
    const leurres = [];
    for (const i of shuffle(net.stations.map((_, k) => k))) {
      if (net.stations[i][3].length !== vraies.length) continue;
      const k = cle(net.stations[i][3]);
      if (vus.has(k)) continue;
      vus.add(k);
      leurres.push(net.stations[i][3]);
      if (leurres.length === 3) break;
    }
    Game.question = { kind: "corresp", target };
    ask(`<b>${net.stations[target][0]}</b> ?`, false, "Quelles lignes desservent");
    showChoices(shuffle([
      { html: vraies.map(pill).join(" "), right: true },
      ...leurres.map(l => ({ html: l.map(pill).join(" "), right: false })),
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      let juste = false;
      if (opt.right) {
        const points = award(Math.round(650 +
                             250 * Math.max(0, 1 - seconds / limite("corresp"))), true);
        Game.history.push({ kind: "corresp", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${vraies.length} lignes à ${
          net.stations[target][0]}`, "near");
        juste = true;
      } else {
        award(0, false);
        Game.history.push({ kind: "corresp", name: null, points: 0 });
        say(`<em>raté</em> · c'était ${vraies.map(l => lineName(l)).join(", ")}`, "far");
      }
      tally();
      hideInputs();
      reveal = { won: juste, until: performance.now() + 2600 };
    });

  } else if (kind === "pasterminus") {
    // trois vrais bouts de ligne, et un intrus d'autant plus discret que la manche avance
    const trois = shuffle(termini).slice(0, 3);
    const milieu = fame.filter(i => !estTerminus.has(i));
    const target = graded(milieu, Game.step, 0.4) ?? milieu[0];
    Game.question = { kind: "pasterminus", target };
    ask("laquelle n'est pas un terminus ?", false, "Parmi ces stations,");
    showChoices(shuffle([
      ...trois.map(i => ({ label: net.stations[i][0], right: false, station: i })),
      { label: net.stations[target][0], right: true, station: target },
    ]), opt => {
      const seconds = (performance.now() - started) / 1000;
      let juste = false;
      if (opt.right) {
        const points = award(Math.round(600 +
                             250 * Math.max(0, 1 - seconds / limite("pasterminus"))), true);
        Game.history.push({ kind: "pasterminus", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]} est en pleine ligne`, "near");
        juste = true;
      } else {
        award(0, false);
        Game.history.push({ kind: "pasterminus", name: null, points: 0 });
        say(`<em>${net.stations[opt.station][0]}</em> est bien un terminus · ` +
            `c'était ${net.stations[target][0]}`, "far");
      }
      tally();
      hideInputs();
      reveal = { won: juste, until: performance.now() + 2600 };
    });

  } else if (kind === "lettre") {
    const lettre = graded(initiales, Game.step, 0.5) ?? initiales[0];
    Game.question = { kind: "lettre", lettre, misses: 0,
                      target: parInitiale.get(lettre)[0] };
    ask(`une station commençant par <b>${lettre.toUpperCase()}</b>`, false, "Écris");
    openField("nom de station", false);

  } else if (kind === "long") {
    const need = graded(seuils, Game.step, 0.4) ?? seuils[0];
    const exemples = net.stations.map((_, k) => k).filter(k => lettresDe(k) >= need);
    Game.question = { kind: "long", need, misses: 0, target: exemples[0] };
    ask(`une station d'au moins <b>${need} lettres</b>`, false, "Donne");
    openField("nom de station", false);

  } else if (kind === "name") {
    const need = 3;
    Game.question = { kind: "name", line: Game.line, need, found: [], seen: [],
                      misses: 0, turn: 0 };
    ask(`les stations de la ligne ${pill(Game.line)}`, false, "Reconnais");
    nextChoice();
  } else if (kind === "wards") {
    const list = wardsOf[Game.line];
    // citer les dix arrondissements d'une ligne serait un pensum : la moitié suffit
    const need = Math.max(1, Math.floor(list.length / 2));
    Game.question = { kind: "wards", line: Game.line, list, need, found: [], misses: 0 };
    ask(`<b>${need}</b> arrondissement${need > 1 ? "s" : ""} où ${pill(Game.line)} s'arrête`,
        false, "Cite");
    openField();
  } else if (kind === "district") {
    const d = pickDistrict(Game.step);
    askedDistricts.add(d.n);
    const pool = byDistrict.get(d.n);
    Game.question = {
      kind: "district",
      district: d,
      need: Math.min(3, pool.length),
      pool,
      found: [],
      misses: 0,
    };
    ask(`3 stations dans le <b>${ordinal(d.n)}</b>`, true);
    // on se rapproche d'un quartier trois fois plus large que l'arrondissement, et
    // décentré : les stations deviennent de vraies cibles, la zone reste à deviner
    flyTo(frameTo(loosely(ringsBounds(d.rings), 3.2), 0.95, 0, fitScale * 6));
  } else {
    const i = pickStation(Game.step);
    asked.add(i);
    Game.question = { kind: "station", target: i, zone: around(i, 7) };
    ask(`<b>${net.stations[i][0]}</b>`);
  }
  started = performance.now();
  reveal = null;
  if (spotlight.length) { spotlight = []; bgDirty = true; }
  timebar.className = "clock";
  timebar.firstElementChild.style.width = "100%";
}

function ask(html, plural = false, verb = "Trouve") {
  hud.querySelector(".step").textContent = `question ${Game.step + 1} sur ${ROUNDS}`;
  // la hauteur du bandeau varie selon la question : le cadrage doit la suivre
  requestAnimationFrame(() => {
    topInset = Math.min(hud.offsetHeight + 26, innerHeight * 0.32);
  });
  hud.querySelector(".ask").innerHTML = verb + " " + html;
  hideInputs();
  replay(hud.querySelector(".quest"));
  const v = hud.querySelector(".verdict");
  v.hidden = true;
  v.className = "verdict";
}

function say(html, tone) {
  const v = hud.querySelector(".verdict");
  v.innerHTML = html;
  v.className = "verdict " + (tone || "");
  v.hidden = false;
}

/* Une manche se raconte en douze carrés : vert quand c'est acquis, orange à moitié,
   rouge sinon. De quoi copier son résultat sans rien révéler des réponses. */
function shareText(grade) {
  const grid = Game.history
    .map(h => (v => v > 0.75 ? "🟩" : v > 0.25 ? "🟨" : "🟥")(success(h)))
    .join("");
  const entete = MODES[Game.mode].choixLigne && ligneFixe !== null
    ? `ligne ${lineName(ligneFixe)}`
    : `mode ${MODES[Game.mode].nom.toLowerCase()}`;
  return `La chasse aux stations · ${entete}\n` +
         `${Game.score} pts · ${grade}\n${grid}\n` + location.href.split(/[?#]/)[0];
}

/* Confettis aux couleurs du réseau. */
function confetti() {
  for (let i = 0; i < 26; i++) {
    const el = document.createElement("i");
    el.style.left = Math.random() * 100 + "vw";
    el.style.background = net.lines[i % net.lines.length][1];
    el.style.animationDuration = (1.8 + Math.random() * 1.6) + "s";
    el.style.animationDelay = (Math.random() * 0.5) + "s";
    party.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
}

/* Part de réussite d'une question, de 0 à 1 : c'est elle qui décerne le titre,
   le score brut récompensant en plus la rapidité. */
function success(h) {
  if (h.hits !== undefined) return h.need ? h.hits / h.need : 0;
  if (h.missed) return 0;
  if (h.d !== undefined) return Math.min(1, Math.max(0, h.points / 1000));
  return h.points > 0 ? 1 : 0;
}

let shown = 0, rolling = null;
let helped = false;              // la vue a-t-elle été déplacée par un coup de pouce ?
let touched = false;
addEventListener("pointerdown", () => { touched = true; }, { once: true });

/* Une série de bonnes réponses fait grimper les points. */
const MULTIPLIERS = [1, 1, 1, 1.5, 1.5, 2, 2, 2, 3];
const multiplier = () => MULTIPLIERS[Math.min(Game.streak, MULTIPLIERS.length - 1)];

/* Les points s'envolent de l'endroit visé, le bord s'illumine, la carte tremble si l'on
   s'est trompé. C'est ce qui fait qu'une réponse se sent au lieu de s'afficher. */
function pop(text, x, y, ok) {
  const el = document.createElement("div");
  el.className = "float " + (ok ? "good" : "bad");
  el.textContent = text;
  el.style.left = (x ?? innerWidth / 2) + "px";
  el.style.top = (y ?? innerHeight * 0.32) + "px";
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1200);

  edge.className = ok ? "good" : "bad";
  setTimeout(() => { edge.className = ""; }, 260);

  if (!ok) {
    cv.classList.remove("shake");
    void cv.offsetWidth;
    cv.classList.add("shake");
  }
  // les navigateurs refusent la vibration tant que rien n'a été touché
  if (touched) { try { navigator.vibrate?.(ok ? 12 : [0, 40, 30, 40]); } catch { /* ignoré */ } }
}

/* Attribue des points en tenant compte de la série, et rend la main sur le total obtenu. */
function award(base, ok, x, y) {
  const mult = ok ? multiplier() : 1;
  const points = Math.max(0, Math.round(base * mult));
  Game.score += points;
  Game.streak = ok ? Game.streak + 1 : 0;
  // la note monte avec la série : on entend sa progression sans lire le compteur
  if (window.Son) (ok ? Son.juste(Game.streak - 1) : Son.rate());
  showStreak();
  pop((points ? "+" + points : "raté") + (mult > 1 ? `  ×${mult}` : ""), x, y, ok);
  return points;
}

function showStreak() {
  const el = hud.querySelector(".streak");
  if (Game.streak < 3) { el.hidden = true; return; }
  el.textContent = `série ${Game.streak} · ×${multiplier()}`;
  el.hidden = false;
  void el.offsetWidth;
}

/* Le total grimpe vers sa nouvelle valeur : un score qui saute se remarque moins. */
const tally = () => {
  const box = hud.querySelector(".score");
  if (rolling) cancelAnimationFrame(rolling);
  const from = shown, to = Game.score, t0 = performance.now();
  const step = now => {
    const u = Math.min(1, (now - t0) / 420);
    shown = Math.round(from + (to - from) * (1 - Math.pow(1 - u, 3)));
    box.textContent = `${shown.toLocaleString("fr-FR")} pts`;
    rolling = u < 1 ? requestAnimationFrame(step) : null;
  };
  rolling = requestAnimationFrame(step);
  drawPips();
};

/* Une pastille par question : verte si elle est acquise, orange à moitié, rouge sinon. */
function drawPips() {
  if (pips.children.length !== ROUNDS) {
    pips.innerHTML = "";
    for (let i = 0; i < ROUNDS; i++) pips.appendChild(document.createElement("i"));
  }
  [...pips.children].forEach((el, i) => {
    const h = Game.history[i];
    const cls = h ? (v => v > 0.75 ? "good" : v > 0.25 ? "half" : "bad")(success(h))
              : i === Game.step ? "now" : "";
    if (cls === el.dataset.state) return;
    el.dataset.state = cls;
    el.className = cls;
    if (h) { void el.offsetWidth; el.classList.add(cls, "pop"); }
  });
}

/* Distance au sol, en mètres, entre un point de l'écran et une station. */
function metersTo(px, py, stationIdx) {
  const st = net.stations[stationIdx];
  return Math.hypot(px - sx(st[4][0]), py - sy(st[4][1])) * mpp();
}

const aimRadius = () => MODES[Game.mode].visee * Math.max(AIM_MIN, AIM_PX * mpp());

/* Part du temps déjà consommée sur la question en cours. */
/* Temps accordé à une question, selon le mode. */
const limite = kind => LIMIT[kind] * MODES[Game.mode].temps;
const elapsed = q => (performance.now() - started) / 1000 / limite(q.kind);

/* Nombre de coups de pouce déjà donnés. */
function hints(q) {
  const aides = MODES[Game.mode].aides;
  if (!aides || q.kind !== "station" || reveal) return 0;   // plus aucun mode n'en donne
  const u = elapsed(q);
  return aides.filter(seuil => u >= seuil).length;
}
const pickRadius = () => Math.max(PICK_MIN, PICK_PX * mpp());

/* Station la plus proche d'un clic, toutes lignes confondues. */
function nearest(px, py, pool) {
  let best = -1, bestD = pickRadius();
  for (const i of (pool || net.stations.map((_, k) => k))) {
    const d = metersTo(px, py, i);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

Game.click = (px, py) => {
  if (window.Voyage && Voyage.actif) return;       // le voyage se joue aux boutons
  const q = Game.question;
  if (!q || reveal) return;
  if (performance.now() - started < 250) return;   // garde contre le double clic

  // seules quatre formes de questions se répondent en touchant la carte ; les autres
  // passent par des propositions ou par le champ de saisie
  if (q.kind === "station") {
    const d = metersTo(px, py, q.target);
    const off = Math.max(0, d - aimRadius());      // rien à perdre dans la zone de visée
    const seconds = (performance.now() - started) / 1000;
    const helped = hints(q);
    const keep = helped ? GARDE[helped - 1] : 1;
    const points = award(Math.round(1000 * Math.exp(-off / 1600) * keep) +
                   Math.round(250 * Math.max(0, 1 - seconds / limite("station"))),
                   off === 0, px, py);
    Game.history.push({ kind: "station", name: net.stations[q.target][0], d, points });
    const aide = helped ? " · avec un coup de pouce" : "";
    say(off === 0
        ? `<em>${points} pts</em> · dans la zone${aide}`
        : `<em>${points} pts</em> · à ${format(d)} de la cible${aide}`,
        off === 0 || off < 600 ? "near" : "far");
    reveal = { at: [px, py], won: off === 0, until: performance.now() + 2100 };
    tally();
    return;
  }

  if (q.kind === "spot") {
    const d = metersTo(px, py, q.target);
    const off = Math.max(0, d - aimRadius());
    const seconds = (performance.now() - started) / 1000;
    const points = award(Math.round(1000 * Math.exp(-off / 900)) +
                   Math.round(250 * Math.max(0, 1 - seconds / limite("spot"))),
                   off === 0, px, py);
    Game.history.push({ kind: "spot", name: net.stations[q.target][0], d, points });
    say(off === 0 ? `<em>${points} pts</em> · dans la zone`
                  : `<em>${points} pts</em> · à ${format(d)}`,
        off === 0 || off < 400 ? "near" : "far");
    reveal = { at: [px, py], won: off === 0, until: performance.now() + 2100 };
    tally();
    return;
  }

  if (q.kind === "hue") {
    const line = lineAt(px, py);
    const seconds = (performance.now() - started) / 1000;
    if (line >= 0 && q.lines.includes(line)) {
      const points = award(Math.round((q.tries ? 400 : 800) +
                           250 * Math.max(0, 1 - seconds / limite("hue"))), true, px, py);
      Game.history.push({ kind: "hue", name: `ligne ${lineName(line)}`, points });
      say(`<em>${points} pts</em> · c'est bien la ligne ${lineName(line)}`, "near");
      endHue();
    } else {
      q.tries++;
      const why = line >= 0
        ? `<em>ligne ${lineName(line)}</em> · ce n'est pas cette teinte`
        : "<em>à côté du tracé</em>";
      if (q.tries >= 2) {
        award(0, false, px, py);
        Game.history.push({ kind: "hue", name: null, points: 0 });
        say(`${why} · c'était la ligne ${lineName(q.line)}`, "far");
        endHue();
      } else {
        say(`${why} · un essai restant`, "far");
      }
    }
    tally();
    return;
  }

  if (q.kind !== "district") return;                // les autres ne se cliquent pas

  // question d'arrondissement : chaque clic doit désigner une station encore à trouver
  const wanted = q.pool.filter(i => !q.found.includes(i));
  const hit = nearest(px, py, wanted);
  if (hit >= 0) {
    q.found.push(hit);
    award(350, true, px, py);
    say(`<em>${net.stations[hit][0]}</em> · ${q.found.length} sur ${q.need}`, "near");
  } else {
    q.misses++;
    award(0, false, px, py);
    const left = 3 - q.misses;
    const stray = nearest(px, py);                 // désigner l'erreur aide à apprendre
    const why = stray >= 0 && !q.found.includes(stray)
      ? `<em>${net.stations[stray][0]}</em> n'est pas dans le ${ordinal(q.district.n)}`
      : "<em>raté</em>";
    say(`${why} · ${left > 0 ? left + " essai" + (left > 1 ? "s" : "") +
        " restant" + (left > 1 ? "s" : "") : "dernier"}`, "far");
  }
  tally();

  if (q.found.length >= q.need || q.misses >= 3) {
    Game.history.push({
      kind: "district",
      name: `${ordinal(q.district.n)} — ${q.district.name}`,
      hits: q.found.length,
      need: q.need,
      points: q.found.length * 350,
    });
    reveal = { until: performance.now() + 2400 };
  }
};

/* Décompte du temps accordé, et clôture d'office quand il est épuisé. */
function tick(q) {
  const limit = limite(q.kind);
  const left = limit - (performance.now() - started) / 1000;
  timebar.firstElementChild.style.width = Math.max(0, left / limit * 100) + "%";
  timebar.classList.toggle("urgent", left < 5);
  if (left > 0) {
    if (left < 5 && window.Son) {                  // un battement par seconde, sur la fin
      const reste = Math.ceil(left);
      if (q.tic !== reste) { q.tic = reste; Son.tic(); }
    }
    return;
  }

  timebar.className = "clock done";
  if (window.Son) Son.portes();
  if (q.kind === "far") {
    Game.history.push({ kind: "far", name: null, points: 0 });
    say(`<em>temps écoulé</em> · la plus longue faisait ` +
        `${q.best.d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`, "far");
    hideInputs();
    reveal = { until: performance.now() + 3000 };
  } else if (q.kind === "landmark") {
    Game.history.push({ kind: "landmark", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était ${net.stations[q.target][0]}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2800 };
  } else if (q.kind === "fake") {
    Game.history.push({ kind: "fake", name: null, points: 0 });
    say(`<em>temps écoulé</em> · l'imposteur était ${q.faux}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2800 };
  } else if (q.kind === "outside") {
    Game.history.push({ kind: "outside", name: null, points: 0 });
    say(`<em>temps écoulé</em> · ${net.stations[q.target][0]} est hors les murs`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2800 };
  } else if (q.kind === "which") {
    Game.history.push({ kind: "which", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était la ligne ${lineName(q.right)}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else if (q.kind === "next") {
    Game.history.push({ kind: "next", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était ${net.stations[q.target][0]}`, "far");
    hideInputs();
    reveal = { won: false, until: performance.now() + 2600 };
  } else if (q.kind === "odd") {
    Game.history.push({ kind: "odd", name: null, points: 0 });
    say(`<em>temps écoulé</em> · l'intruse était ${net.stations[q.odd][0]}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else if (q.kind === "theme") {
    const got = q.found.length;
    closeTheme();
    say(`<em>temps écoulé</em> · ${got} sur ${q.need}`, got ? "near" : "far");
  } else if (q.kind === "name") {
    closeName();
    say(`<em>temps écoulé</em> · ${q.found.length} sur ${q.need}`,
        q.found.length ? "near" : "far");
  } else if (q.kind === "hue") {
    Game.history.push({ kind: "hue", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était la ligne ${lineName(q.line)}`, "far");
    endHue();
  } else if (q.kind === "wards") {
    const got = q.found.length;
    closeWards();
    say(`<em>temps écoulé</em> · ${got} sur ${q.need}`, got ? "near" : "far");
  } else if (q.kind === "corresp") {
    Game.history.push({ kind: "corresp", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était ${
      net.stations[q.target][3].map(l => lineName(l)).join(", ")}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else if (q.kind === "pasterminus") {
    Game.history.push({ kind: "pasterminus", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était ${net.stations[q.target][0]}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else if (q.kind === "lettre" || q.kind === "long") {
    Game.history.push({ kind: q.kind, name: null, points: 0 });
    say(`<em>temps écoulé</em> · par exemple ${net.stations[q.target][0]}`, "far");
    hideInputs();
    reveal = { until: performance.now() + 2600 };
  } else if (q.kind === "spot") {
    Game.history.push({ kind: "spot", name: net.stations[q.target][0],
                        d: Infinity, points: 0, missed: true });
    say(`<em>temps écoulé</em> · c'était là`, "far");
    reveal = { at: null, until: performance.now() + 2200 };
  } else if (q.kind === "station") {
    const st = net.stations[q.target];
    Game.history.push({ kind: "station", name: st[0], d: Infinity, points: 0, missed: true });
    say(`<em>temps écoulé</em> · c'était là`, "far");
    reveal = { at: null, until: performance.now() + 2200 };
  } else {
    Game.history.push({
      kind: "district",
      name: `${ordinal(q.district.n)} — ${q.district.name}`,
      hits: q.found.length,
      need: q.need,
      points: q.found.length * 350,
    });
    say(`<em>temps écoulé</em> · ${q.found.length} sur ${q.need}`,
        q.found.length ? "near" : "far");
    reveal = { until: performance.now() + 2400 };
  }
}

const format = d => d < 1000 ? `${Math.round(d / 10) * 10} m`
                             : `${(d / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

/* ---------- rendu de la couche de jeu ---------- */

Game.draw = ctx => {
  if (window.Voyage && Voyage.actif) return Voyage.draw(ctx);
  const q = Game.question;
  if (!q) return;
  if (reveal && !reveal.born) reveal.born = performance.now();

  // coup de pouce : la ou les lignes de la station s'allument, puis un cercle se referme
  const help = hints(q);
  const lines = help ? net.stations[q.target][3] : [];
  if (String(lines) !== String(spotlight)) {
    spotlight = [...lines];
    bgDirty = true;
  }
  if (help > 1 && !q.zoomed) {                     // deuxième palier : on se rapproche
    q.zoomed = true;
    helped = true;
    flyTo(frameTo(q.zone, 0.92, 0, fitScale * 5), 900);
  }
  if (help > 2) {
    const dernier = MODES[Game.mode].aides[2];
    const u = Math.min(1, (elapsed(q) - dernier) / (1 - dernier));
    const r = (1500 - 900 * u) / mpp();            // de 1,5 km à 600 m
    const st = net.stations[q.target];
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(40,40,40,.35)";
    ctx.beginPath();
    ctx.arc(sx(st[4][0]), sy(st[4][1]), r, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
  }

  if (reveal && performance.now() > reveal.until) {
    Game.step++;
    return nextQuestion();
  }
  if (!reveal) tick(q);

  ctx.save();
  ctx.lineWidth = 2;

  if (q.kind === "district") {
    // la zone n'apparaît qu'une fois la question jouée
    if (reveal) {
      ctx.beginPath();
      for (const ring of q.district.rings) {
        ctx.moveTo(sx(ring[0][0]), sy(ring[0][1]));
        for (let i = 1; i < ring.length; i++) ctx.lineTo(sx(ring[i][0]), sy(ring[i][1]));
        ctx.closePath();
      }
      ctx.fillStyle = "rgba(26,127,55,.09)";
      ctx.fill();
      ctx.strokeStyle = "rgba(26,127,55,.55)";
      ctx.stroke();
      for (const i of q.pool) if (!q.found.includes(i)) dot(ctx, i, "#1a7f37", false);
    }
    for (const i of q.found) dot(ctx, i, "#1a7f37", true);
  } else if (q.kind === "hue") {
    if (reveal) {
      ctx.lineWidth = 5;
      for (const li of q.lines) {
        ctx.strokeStyle = net.lines[li][1];
        ctx.beginPath();
        net.patterns.forEach(p => {
          if (p[0] !== li) return;
          const pts = net.shapes[p[1]].world;
          ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
          for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
        });
        ctx.stroke();
      }
      ctx.lineWidth = 2;
    }
  } else if (q.kind === "wards") {
    if (!reveal) return ctx.restore();           // rien à montrer tant qu'on cherche
    for (const d of (paris ? paris.districts : [])) {
      const known = q.found.includes(d.n);
      // les autres arrondissements desservis auraient tout aussi bien fait l'affaire :
      // on les montre, sans les compter pour des erreurs
      const also = q.list.includes(d.n) && !known;
      if (!known && !also) continue;
      ctx.beginPath();
      for (const ring of d.rings) {
        ctx.moveTo(sx(ring[0][0]), sy(ring[0][1]));
        for (let i = 1; i < ring.length; i++) ctx.lineTo(sx(ring[i][0]), sy(ring[i][1]));
        ctx.closePath();
      }
      ctx.fillStyle = known ? "rgba(26,127,55,.16)" : "rgba(26,127,55,.05)";
      ctx.fill();
      ctx.strokeStyle = known ? "rgba(26,127,55,.65)" : "rgba(26,127,55,.28)";
      ctx.stroke();
    }
  } else if (q.kind === "far") {
    if (reveal) {
      for (const p of q.pairs) {
        const win = p === q.best;
        ctx.save();
        ctx.setLineDash(win ? [] : [5, 5]);
        ctx.lineWidth = win ? 3 : 1.5;
        ctx.strokeStyle = win ? "rgba(26,127,55,.75)" : "rgba(140,140,140,.55)";
        ctx.beginPath();
        ctx.moveTo(sx(net.stations[p.a][4][0]), sy(net.stations[p.a][4][1]));
        ctx.lineTo(sx(net.stations[p.b][4][0]), sy(net.stations[p.b][4][1]));
        ctx.stroke();
        ctx.restore();
      }
      dot(ctx, q.best.a, "#1a7f37", true, "left");
      dot(ctx, q.best.b, "#1a7f37", true);
    }
  } else if (q.kind === "landmark") {
    // Le lieu est posé d'emblée, et un cercle s'ouvre autour de lui à la vitesse du
    // chrono : la première station qu'il atteint est la réponse. Le temps cesse d'être
    // une barre pour devenir une distance qu'on voit se combler. Rien n'est donné pour
    // autant — les noms des stations restent masqués pendant la partie.
    const [x, y] = merc(q.at[0], q.at[1]);
    const px = sx(x), py = sy(y);

    if (q.portee) {
      const clic = q.uClic === undefined ? 0 : q.uClic;
      const u = reveal
        ? clic + (1 - clic) * Math.min(1, (performance.now() - (reveal.born || 0)) / 500)
        : Math.min(1, elapsed(q));
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, u * q.portee / mpp(), 0, 6.2832);
      ctx.fillStyle = "rgba(245,158,11,.08)";
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(245,158,11,${0.35 + 0.45 * u})`;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, 6.2832);
    ctx.fillStyle = "#f59e0b";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = skin.halo;
    ctx.stroke();
    ctx.font = "600 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = skin.halo;
    ctx.strokeText(q.lieu, px + 11, py);
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(q.lieu, px + 11, py);
    ctx.restore();

    if (reveal) {
      for (const i of q.shown) {
        dot(ctx, i, i === q.target ? "#1a7f37" : "#b3261e", true);
      }
    }
  } else if (q.kind === "fake") {
    if (reveal) for (const i of q.shown) dot(ctx, i, "#1a7f37", true);
  } else if (q.kind === "outside") {
    if (reveal) {
      for (const i of q.shown) {
        dot(ctx, i, i === q.target ? "#b3261e" : "#1a7f37", true);
      }
    }
  } else if (q.kind === "which") {
    if (reveal) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = net.lines[q.right][1];
      ctx.beginPath();
      net.patterns.forEach(p => {
        if (p[0] !== q.right) return;
        const pts = net.shapes[p[1]].world;
        ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
      });
      ctx.stroke();
      ctx.lineWidth = 2;
      dot(ctx, q.target, "#1a7f37", true);
    }
  } else if (q.kind === "next") {
    // le point de départ est nommé sur la carte : la réponse se donnant parmi trois
    // propositions, le situer n'apprend rien de plus qu'on ne sache déjà.
    // Attention au côté de l'étiquette : tant que la question est ouverte, la placer
    // selon la position de la réponse trahirait le sens de marche.
    const west = net.stations[q.from][2] < net.stations[q.target][2];
    dot(ctx, q.from, "#8a8a8a", true, reveal && west ? "left" : "right");
    if (reveal) {
      dot(ctx, q.target, reveal.won ? "#1a7f37" : "#b3261e", true, west ? "right" : "left");
    }
    rameEnRoute(ctx, q);
  } else if (q.kind === "odd") {
    if (reveal) {
      for (const i of q.shown) {
        dot(ctx, i, i === q.odd ? "#b3261e" : "#1a7f37", true);
      }
    }
  } else if (q.kind === "theme") {
    for (const i of q.found) dot(ctx, i, "#1a7f37", true);
    if (reveal) {
      for (const i of q.theme.hits) {
        if (!q.found.includes(i)) dot(ctx, i, "#b3261e", q.theme.hits.length <= 6);
      }
    }
  } else if (q.kind === "name") {
    if (reveal) for (const i of q.found) dot(ctx, i, "#1a7f37", true);
    else for (const i of q.found) dot(ctx, i, "#1a7f37", false);
  } else if (q.kind === "spot" && reveal) {
    const st = net.stations[q.target];
    aimZone(ctx, q.target, reveal.won);
    if (reveal.at) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#9a9a9a";
      ctx.beginPath();
      ctx.moveTo(reveal.at[0], reveal.at[1]);
      ctx.lineTo(sx(st[4][0]), sy(st[4][1]));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    dot(ctx, q.target, "#b3261e", true);
    epingle(ctx, q.target);
  } else if (reveal) {
    const st = net.stations[q.target];
    aimZone(ctx, q.target, reveal.won);
    if (reveal.at) {                              // trait entre le clic et la cible
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#9a9a9a";
      ctx.beginPath();
      ctx.moveTo(reveal.at[0], reveal.at[1]);
      ctx.lineTo(sx(st[4][0]), sy(st[4][1]));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9a9a9a";
      ctx.beginPath();
      ctx.arc(reveal.at[0], reveal.at[1], 4, 0, 6.2832);
      ctx.fill();
    }
    dot(ctx, q.target, reveal.won ? "#1a7f37" : "#b3261e", true);
    epingle(ctx, q.target);
  }
  ctx.restore();
};

/* Où se situe une station le long du tracé de sa ligne, en distance depuis le départ.
   Le sommet le plus proche suffit : les tracés comptent un point tous les quatre-vingts
   mètres environ, soit bien moins que l'écart entre deux stations. */
function surTrace(line, station) {
  const voie = voies[line];
  if (!voie || !voie.total) return null;
  const [x, y] = net.stations[station][4];
  let best = 0, bestD = Infinity;
  for (let k = 0; k < voie.pts.length; k++) {
    const d = Math.hypot(voie.pts[k][0] - x, voie.pts[k][1] - y);
    if (d < bestD) { bestD = d; best = k; }
  }
  return voie.cumul[best];
}

/* Le trajet d'une station à la suivante, si les deux se trouvent bien sur le tracé
   principal de la ligne — ce n'est pas le cas des branches desservies par un seul
   service, et la question se joue alors sans rame. */
function trajetEntre(line, a, b) {
  const da = surTrace(line, a), db = surTrace(line, b);
  if (da === null || db === null || da === db) return null;
  return { a: da, b: db };
}

/* La rame en marche : elle quitte la station nommée au début de la question et atteint
   la réponse quand le temps est écoulé. Répondre plus tôt la fait arriver aussitôt. */
function rameEnRoute(ctx, q) {
  const voie = voies[q.line];
  if (!voie || !q.trajet) return;

  const clic = q.uClic === undefined ? 0 : q.uClic;
  const u = reveal
    ? clic + (1 - clic) * Math.min(1, (performance.now() - (reveal.born || 0)) / 600)
    : Math.min(1, elapsed(q));
  const d = q.trajet.a + (q.trajet.b - q.trajet.a) * u;
  const pas = (q.trajet.b - q.trajet.a) * 0.06;
  const [x, y] = surVoie(voie, Math.max(0, Math.min(voie.total, d)));
  const [x2, y2] = surVoie(voie, Math.max(0, Math.min(voie.total, d + pas)));

  const px = sx(x), py = sy(y);
  const angle = Math.atan2(sy(y2) - py, sx(x2) - px);
  const couleur = net.lines[q.line][1];

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.shadowColor = couleur;
  ctx.shadowBlur = 14;
  ctx.fillStyle = couleur;
  ctx.beginPath();
  ctx.roundRect(-11, -4, 22, 8, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = skin.halo;
  ctx.stroke();
  // deux baies claires, pour qu'on lise une rame et non un jeton
  ctx.fillStyle = skin.halo;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(-6.5, -2, 5, 4);
  ctx.fillRect(0.5, -2, 5, 4);
  ctx.restore();
}

/* Le repère tombe du ciel sur la bonne réponse. Chute accélérée par la pesanteur,
   contact marqué par une onde, puis deux rebonds qui s'amortissent — l'ombre portée se
   resserre à mesure qu'il approche du sol, ce qui donne la hauteur au regard.

   Il est tracé au trait plutôt qu'écrit en emoji : selon la police disponible, 📍 tombe
   sur un glyphe monochrome qui prend la couleur du pinceau, et disparaissait alors sur
   la carte de nuit. Un dessin vectoriel a la même allure partout. */
const CHUTE = 460;                               // durée de la chute, en millisecondes
const REBOND = 300;
const HAUTEUR = 230;                             // d'où il tombe, en pixels
const AIGUILLE = 8;                              // rayon de la tête du repère

function epingle(ctx, i) {
  const st = net.stations[i];
  const x = sx(st[4][0]), y = sy(st[4][1]);
  const t = reveal && reveal.born ? performance.now() - reveal.born : CHUTE + REBOND;

  let haut = 0;
  if (t < CHUTE) {
    const u = t / CHUTE;
    haut = (1 - u * u) * HAUTEUR;                // la distance restante suit 1 - u²
  } else if (t < CHUTE + REBOND) {
    const u = (t - CHUTE) / REBOND;
    haut = Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u) * 26;
  }

  ctx.save();

  if (t >= CHUTE && t < CHUTE + 340) {           // l'onde de choc, au contact
    const u = (t - CHUTE) / 340;
    ctx.beginPath();
    ctx.arc(x, y, 6 + u * 28, 0, 6.2832);
    ctx.strokeStyle = `rgba(232,69,60,${0.5 * (1 - u)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // l'ombre portée se resserre et se fonce à mesure que le repère approche du sol
  const proche = 1 - Math.min(1, haut / HAUTEUR);
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 3 + 5 * proche, 1.5 + 2 * proche, 0, 0, 6.2832);
  ctx.fillStyle = `rgba(0,0,0,${0.05 + 0.18 * proche})`;
  ctx.fill();

  const pointe = y - haut;
  const centre = pointe - AIGUILLE * 2.5;
  const r = AIGUILLE;

  ctx.beginPath();
  ctx.moveTo(x - r, centre);
  ctx.arc(x, centre, r, Math.PI, 2 * Math.PI, false);   // le capuchon, moitié supérieure
  ctx.quadraticCurveTo(x + r * 0.92, centre + r * 0.95, x, pointe);
  ctx.quadraticCurveTo(x - r * 0.92, centre + r * 0.95, x - r, centre);
  ctx.closePath();
  ctx.fillStyle = "#e8453c";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,.92)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, centre, r * 0.36, 0, 6.2832);
  ctx.fillStyle = "#fff";
  ctx.fill();

  ctx.restore();
}

/* Zone dans laquelle une réponse vaut le score plein : on la montre à la correction,
   pour que le joueur voie de combien il s'en est fallu. */
function aimZone(ctx, i, won) {
  const st = net.stations[i];
  const r = aimRadius() / mpp();
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx(st[4][0]), sy(st[4][1]), r * bloom(), 0, 6.2832);
  ctx.fillStyle = won ? "rgba(26,127,55,.10)" : "rgba(179,38,30,.07)";
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = won ? "rgba(26,127,55,.55)" : "rgba(179,38,30,.4)";
  ctx.stroke();
  ctx.restore();
}

/* Part de l'éclosion d'une correction, de 0 à 1 : les pastilles grandissent en place. */
function bloom() {
  if (!reveal || !reveal.born) return 1;
  const u = Math.min(1, (performance.now() - reveal.born) / 300);
  return 0.45 + 0.55 * (1 - Math.pow(1 - u, 3));
}

/* Pastille de station, avec son nom quand il faut la nommer. `side` place l'étiquette
   à gauche du point, pour que deux stations voisines ne se marchent pas dessus. */
function dot(ctx, i, color, named, side = "right") {
  const st = net.stations[i];
  const x = sx(st[4][0]), y = sy(st[4][1]);
  ctx.beginPath();
  ctx.arc(x, y, (named ? 7 : 4.5) * bloom(), 0, 6.2832);
  ctx.fillStyle = skin.station;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = named ? 3 : 2;
  ctx.stroke();
  if (!named) return;
  ctx.font = "600 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = side === "left" ? "right" : "left";
  const tx = side === "left" ? x - 11 : x + 11;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = skin.halo;
  ctx.strokeText(st[0], tx, y);
  ctx.fillStyle = color;
  ctx.fillText(st[0], tx, y);
  ctx.textAlign = "left";
}

/* ---------- ouverture et clôture ---------- */

/* Une rame traverse l'écran à toute allure : le temps qu'elle passe, la carte bascule
   en nuit et la première question est déjà prête derrière elle. */
function trainIn(after) {
  if (window.Son) Son.rame();
  rush.hidden = false;
  const rame = rush.firstElementChild;
  rame.style.animation = "none";
  rush.style.animation = "none";
  void rame.offsetWidth;
  rame.style.animation = "";
  rush.style.animation = "";
  setTimeout(() => { rush.hidden = true; }, 1000);
  setTimeout(after, 520);                          // la question paraît quand elle est passée
}

function start() {
  // le voyage est un jeu à part entière : il a son propre départ
  if (MODES[Game.mode].voyage) return Voyage.start();
  document.body.classList.add("explored");
  wear("nuit");                                    // la partie se joue de nuit
  Game.playing = true;
  Game.score = 0;
  Game.streak = 0;
  shown = 0;
  Game.step = 0;
  Game.history = [];
  asked = new Set();
  askedDistricts = new Set();
  askedHues = new Set();
  askedThemes = new Set();
  reveal = null;
  Game.blind = false;
  Game.line = ligneFixe;                           // nulle hors du mode ligne
  Game.lastKind = null;
  Game.plan = buildRound();
  document.body.classList.add("playing");
  hud.hidden = false;
  over.hidden = true;
  if (ligneFixe !== null) select(ligneFixe);       // la carte s'ouvre sur la ligne
  else if (selected !== null) select(null);
  showStreak();
  tally();
  hud.hidden = true;
  trainIn(() => {
    if (!Game.playing) return;
    hud.hidden = false;
    nextQuestion();
    // on attend que le bandeau soit dessiné pour connaître sa hauteur, puis on cadre
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (bounds && selected === null) flyTo(frameTo(bounds), 400);
    }));
  });
  bgDirty = true;
}

function stop() {
  wear("jour");
  pips.hidden = false;
  showRecord();
  topInset = 0;
  if (bounds) flyTo(frameTo(bounds));              // la carte reprend sa vue d'ensemble
  if (spotlight.length) { spotlight = []; bgDirty = true; }
  Game.playing = false;
  Game.question = null;
  reveal = null;
  Game.blind = false;
  hideInputs();
  if (Game.line !== null) { Game.line = null; select(null); }
  document.body.classList.remove("playing");
  hud.hidden = true;
  bgDirty = true;
}

function finish() {
  const done = Game.history;
  const shots = done.filter(h => h.kind === "station" || h.kind === "spot");
  const aimed = shots.filter(h => !h.missed);
  const avg = aimed.length
    ? aimed.reduce((s, h) => s + h.d, 0) / aimed.length : null;
  const zones = done.filter(h => h.kind === "district");
  const links = done.filter(h =>
    ["next", "odd", "which", "outside", "far", "landmark", "fake",
     "corresp", "pasterminus", "lettre", "long"].includes(h.kind));
  const quizzes = done.filter(h => h.kind === "theme" || h.kind === "name" || h.kind === "wards");
  // le voyage se juge à sa plus longue suite sans faute, pas à un total
  const rames = done.filter(h => h.kind === "voyage");
  let serie = 0, courante = 0;
  for (const h of rames) {
    if (h.name) { courante++; if (courante > serie) serie = courante; } else courante = 0;
  }
  const spotted = zones.reduce((s, h) => s + h.hits, 0);
  const wanted = zones.reduce((s, h) => s + h.need, 0);

  let best = 0;
  try { best = +(localStorage.getItem(bestKey()) || 0); } catch { /* stockage indisponible */ }
  const record = Game.score > best;
  if (record) { try { localStorage.setItem(bestKey(), Game.score); } catch { /* ignoré */ } }

  const rate = done.length
    ? done.reduce((s, h) => s + success(h), 0) / done.length : 0;
  const grade = GRADES.find(g => rate >= g.min) || GRADES[GRADES.length - 1];
  if (window.Son) Son.fin(rate);

  stop();
  over.innerHTML = `
    <figure class="reaction" data-cle="${grade.cle}">
      <span class="tete">${grade.tete}</span>
      <figcaption class="${CRIS[grade.cle].length > 24 ? "longue" : ""}"
        >${CRIS[grade.cle]}</figcaption>
    </figure>
    <p class="grade">${grade.title}</p>
    <p class="note">${grade.note}</p>
    <h2>${Game.score.toLocaleString("fr-FR")}</h2>
    <p class="sub">${Math.round(rate * 100)} % de réussite · ${
      record ? "nouveau record" : `record : ${best ? best.toLocaleString("fr-FR") : "—"}`}</p>
    <dl>
      ${shots.length ? `<dt>stations visées</dt><dd>${shots.length}</dd>
      <dt>écart moyen</dt><dd>${avg !== null ? format(avg) : "—"}</dd>` : ""}
      ${zones.length ? `<dt>stations d'arrondissement</dt><dd>${spotted} / ${wanted}</dd>` : ""}
      ${rames.length ? `<dt>stations desservies</dt><dd>${rames.length}</dd>
        <dt>plus longue série</dt><dd>${serie}</dd>` : ""}
      ${links.length ? `<dt>questions de réseau</dt><dd>${
        links.filter(h => h.name).length} / ${links.length}</dd>` : ""}
      ${quizzes.length ? `<dt>devinettes de noms</dt><dd>${
        quizzes.reduce((s, h) => s + h.hits, 0)} / ${
        quizzes.reduce((s, h) => s + h.need, 0)}</dd>` : ""}
      ${aimed.length ? `<dt>meilleur coup</dt><dd>${
        aimed.reduce((a, b) => a.d < b.d ? a : b).name}</dd>` : ""}
    </dl>
    <p class="grid">${Game.history
      .map(h => (v => v > 0.75 ? "🟩" : v > 0.25 ? "🟨" : "🟥")(success(h))).join("")}</p>
    <div class="actions">
      <button class="again">Rejouer</button>
      <button class="back">La carte</button>
      <button class="share" title="Copier le résultat">⧉</button>
    </div>
    <div class="butin" hidden></div>`;
  over.hidden = false;
  // la réaction du grade, vidéo de préférence
  const vignette = over.querySelector(".reaction");
  const legende = vignette.querySelector("figcaption");
  illustre(vignette, grade.cle, () => true);
  const veille = new MutationObserver(() => {
    if (!vignette.contains(legende)) vignette.appendChild(legende);
  });
  veille.observe(vignette, { childList: true });
  setTimeout(() => veille.disconnect(), 4000);

  over.querySelector(".again").onclick = () => { over.hidden = true; start(); };
  over.querySelector(".back").onclick = () => { over.hidden = true; };
  const copie = over.querySelector(".share");
  copie.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareText(grade.title));
      copie.textContent = "✓";
      copie.classList.add("done");
    } catch {
      copie.textContent = "✕";                     // presse-papiers refusé par le navigateur
    }
    setTimeout(() => { copie.textContent = "⧉"; copie.classList.remove("done"); }, 1800);
  };
  if (record) confetti();

  // la partie rapporte une carte, d'autant plus rare que le score est élevé
  const gagnee = window.Cards && Cards.tirage(Game.score);
  if (gagnee >= 0) {
    const chromee = Cards.chrome(Game.score);
    const neuve = Cards.garder(gagnee, chromee);
    const butin = over.querySelector(".butin");
    butin.hidden = false;
    butin.innerHTML = `<p class="sortie${chromee ? " eclat" : ""}">${
      chromee ? "✦ Carte chromée ✦" : neuve ? "Nouvelle carte" : "Carte en double"
      } · collection ${Cards.total()} / ${net.stations.length}</p><div class="ecrin"></div>`;
    Cards.poser(butin.querySelector(".ecrin"), gagnee, chromee);
    if (window.Son) setTimeout(() => Son.carte(chromee), 700);   // après l'arpège de fin
    if (chromee) confetti();
  }
}

playBtn.disabled = true;
playBtn.onclick = start;
hud.querySelector(".quit").onclick = stop;
addEventListener("keydown", e => {
  if (e.key === "Escape" && Game.playing) stop();
});
