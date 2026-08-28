/* La chasse aux stations — deux façons de prouver qu'on connaît Paris :
   retrouver une station nommée, ou désigner plusieurs stations d'un arrondissement.
   S'appuie sur les données déjà chargées par app.js (réseau, arrondissements). */

/* Autant de questions que de formes : une manche les pose toutes, une fois chacune. */
const ROUNDS = 12;
/* Tolérance de visée. Elle suit le zoom : viser à 15 pixels près doit valoir la même
   chose que l'on regarde tout le réseau ou un seul quartier. */
const AIM_PX = 16;               // « pile dessus » sous ce rayon, en pixels
const AIM_MIN = 200;             // ...sans jamais descendre sous ce rayon, en mètres
const PICK_PX = 26;              // portée d'un clic pour désigner une station
const PICK_MIN = 300;
const LIMIT = { station: 15, district: 25, spot: 15, name: 30, wards: 35,
                hue: 15, theme: 35, next: 18, odd: 20, which: 15,
                outside: 20, far: 20 };                               // secondes, par type

/* Les douze formes de questions. Elles ne sont pas classées : la difficulté d'une manche
   ne vient pas de l'ordre des types mais de ce qu'on tire à l'intérieur de chacun — plus
   la manche avance, plus la station, l'arrondissement ou le thème sont retors. L'ordre,
   lui, est entièrement rebattu à chaque partie. */
const KINDS = ["station", "which", "hue", "name", "odd", "outside", "spot",
               "district", "far", "next", "theme", "wards"];   // ROUNDS en dépend

/* Formes assez accessibles pour ouvrir une manche. */
const OPENERS = ["station", "which", "hue"];

/* Questions supplémentaires si le catalogue devenait plus court qu'une manche. */
const FILLERS = ["station", "spot", "hue", "odd"];

const NEEDS_LINE = new Set(["spot", "name", "wards", "next", "odd"]);

const BEST_KEY = "metro-chasse-record-12";

/* Titres décernés en fin de manche, du meilleur au plus modeste. */
const GRADES = [
  { min: 0.92, title: "Titi parisien", note: "vous êtes né dans un couloir de correspondance" },
  { min: 0.80, title: "Poinçonneur des Lilas", note: "des p'tits trous, toujours des p'tits trous" },
  { min: 0.66, title: "Habitué du réseau", note: "vous savez dans quelle voiture monter" },
  { min: 0.50, title: "Usager du quotidien", note: "votre ligne, et deux ou trois autres" },
  { min: 0.34, title: "Passager du dimanche", note: "vous consultez le plan, mais discrètement" },
  { min: 0.18, title: "Banlieusard égaré", note: "toujours du bon côté du quai, jamais du bon quai" },
  { min: 0,    title: "Touriste", note: "le plan à l'envers, mais l'air ravi" },
];

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
  { ask: "qui portent un nom de président", need: 2,
    only: ["Franklin D. Roosevelt", "Charles de Gaulle - Étoile",
           "Bibliothèque François Mitterrand"] },
  { ask: "qui portent un nom d'écrivain", need: 2,
    only: ["Victor Hugo", "Alexandre Dumas", "Voltaire", "Anatole France",
           "Avenue Émile Zola"] },
  { ask: "qui portent un nom de bataille ou de victoire", need: 2,
    only: ["Gare d'Austerlitz", "Iéna", "Wagram", "Réaumur - Sébastopol",
           "Stalingrad", "Alésia", "Solférino", "Campo-Formio"] },
  { ask: "qui portent un nom de femme", need: 2,
    only: ["Louise Michel", "Pierre et Marie Curie", "Barbara"] },
];

const Game = {
  playing: false,
  question: null,
  score: 0,
  step: 0,
  history: [],
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
let started = 0;                 // horodatage du début de la question
let reveal = null;               // ce qui reste affiché après une réponse

const hud = document.getElementById("hud");
const over = document.getElementById("over");
const playBtn = document.getElementById("play");
const timebar = hud.querySelector(".clock");
const pips = hud.querySelector(".pips");
const recordLine = document.getElementById("record");
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
  setTimeout(() => field.focus(), 30);
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
    Game.score += 200;
    say(`<em>${ordinal(n)}</em> · ${q.found.length} sur ${q.need}`, "near");
  } else {
    q.misses++;
    say(`<em>${ordinal(n)}</em> · la ligne n'y passe pas`, "far");
  }
  tally();
  if (q.found.length >= q.need || q.misses >= 3) closeWards();
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
    Game.score += 350;
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

  playBtn.disabled = false;
  showRecord();
});

function showRecord() {
  let best = 0;
  try { best = +(localStorage.getItem(BEST_KEY) || 0); } catch { /* stockage indisponible */ }
  recordLine.textContent = best ? `record ${best.toLocaleString("fr-FR")}` : "10 questions";
}

/* Comparaison indulgente : accents, tirets, casse et ponctuation ne comptent pas. */
const plain = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

/* Station visée par une saisie, parmi une liste de candidates. */
function match(text, pool) {
  const q = plain(text);
  if (q.length < 3) return -1;
  let best = -1, bestScore = Infinity;
  for (const i of pool) {
    const name = plain(net.stations[i][0]);
    if (name === q) return i;
    const d = edits(q, name);
    const inside = name.includes(q) && q.length >= 4;
    const score = inside ? Math.abs(name.length - q.length) * 0.1 : d;
    if ((inside || d <= 2) && score < bestScore) { bestScore = score; best = i; }
  }
  return best;
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
  const p = step / Math.max(1, ROUNDS - 1);
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
  // une forme accessible pour ouvrir, le reste dans un désordre complet ; comme il y a
  // plus de formes que de questions, chaque partie en laisse une ou deux de côté
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  const picks = [opener, ...shuffle(KINDS.filter(k => k !== opener))];
  // KINDS et ROUNDS ont la même taille : toutes les formes passent, aucune ne se répète
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
      Game.score += 300;
      say(`<em>${net.stations[opt.station][0]}</em> · ${q.found.length} sur ${q.need}`, "near");
    } else {
      q.misses++;
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
    const keep = Game.line !== null && kind !== "wards" && NEEDS_LINE.has(Game.lastKind);
    if (!keep) {
      Game.line = pickLine(Game.step, kind);
      select(Game.line, true);
    }
  } else if (Game.line !== null) {
    Game.line = null;
    select(null, true);
  }
  Game.lastKind = kind;

  if (kind === "far") {
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
        const points = Math.round(700 + 250 * Math.max(0, 1 - seconds / LIMIT.far));
        Game.score += points;
        Game.history.push({ kind: "far", name: span(draw.best.d), points });
        say(`<em>${points} pts</em> · ${span(draw.best.d)} à vol d'oiseau`, "near");
      } else {
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
        const points = Math.round(700 + 250 * Math.max(0, 1 - seconds / LIMIT.outside));
        Game.score += points;
        Game.history.push({ kind: "outside", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]} est hors les murs`, "near");
      } else {
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
        const points = Math.round(700 + 250 * Math.max(0, 1 - seconds / LIMIT.which));
        Game.score += points;
        Game.history.push({ kind: "which", name: net.stations[target][0], points });
        say(`<em>${points} pts</em> · ${net.stations[target][0]} est sur la ligne ${lineName(right)}`, "near");
      } else {
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
    Game.question = {
      kind: "next", line: Game.line, from: stops[at], target: stops[at + 1],
      toward: stops[stops.length - 1], tries: 0,
    };
    ask(`la station qui suit <b>${net.stations[stops[at]][0]}</b> vers ` +
        `<b>${net.stations[stops[stops.length - 1]][0]}</b>`, false, "Touche");
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
        const points = Math.round(700 + 250 * Math.max(0, 1 - seconds / LIMIT.odd));
        Game.score += points;
        Game.history.push({ kind: "odd", name: net.stations[opt.station][0], points });
        say(`<em>${points} pts</em> · ${net.stations[odd][0]} est ailleurs`, "near");
      } else {
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
  } else {
    const i = pickStation(Game.step);
    asked.add(i);
    Game.question = { kind: "station", target: i };
    ask(`<b>${net.stations[i][0]}</b>`);
  }
  started = performance.now();
  reveal = null;
  timebar.className = "clock";
  timebar.firstElementChild.style.width = "100%";
}

function ask(html, plural = false, verb = "Trouve") {
  hud.querySelector(".step").textContent = `question ${Game.step + 1} sur ${ROUNDS}`;
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

/* Part de réussite d'une question, de 0 à 1 : c'est elle qui décerne le titre,
   le score brut récompensant en plus la rapidité. */
function success(h) {
  if (h.hits !== undefined) return h.need ? h.hits / h.need : 0;
  if (h.missed) return 0;
  if (h.d !== undefined) return Math.min(1, Math.max(0, h.points / 1000));
  return h.points > 0 ? 1 : 0;
}

let shown = 0, rolling = null;

/* Le total grimpe vers sa nouvelle valeur : un score qui saute se remarque moins. */
const tally = () => {
  const box = hud.querySelector(".score");
  if (rolling) cancelAnimationFrame(rolling);
  const from = shown, to = Game.score, t0 = performance.now();
  const step = now => {
    const u = Math.min(1, (now - t0) / 420);
    shown = Math.round(from + (to - from) * (1 - Math.pow(1 - u, 3)));
    box.textContent = `${shown} pts`;
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

const aimRadius = () => Math.max(AIM_MIN, AIM_PX * mpp());
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
  const q = Game.question;
  if (!q || reveal) return;
  if (performance.now() - started < 250) return;   // garde contre le double clic

  if (q.kind === "station") {
    const d = metersTo(px, py, q.target);
    const slack = aimRadius();
    const off = Math.max(0, d - slack);            // rien à perdre dans la zone de visée
    const seconds = (performance.now() - started) / 1000;
    const points = Math.round(1000 * Math.exp(-off / 1600)) +
                   Math.round(250 * Math.max(0, 1 - seconds / LIMIT.station));
    Game.score += points;
    Game.history.push({ kind: "station", name: net.stations[q.target][0], d, points });
    say(off === 0
        ? `<em>${points} pts</em> · dans la zone`
        : `<em>${points} pts</em> · à ${format(d)} de la cible`,
        off === 0 || off < 600 ? "near" : "far");
    reveal = { at: [px, py], won: off === 0, until: performance.now() + 2100 };
    tally();
    return;
  }

  if (q.kind === "far") {
    Game.history.push({ kind: "far", name: null, points: 0 });
    say(`<em>temps écoulé</em> · la plus longue faisait ` +
        `${q.best.d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`, "far");
    hideInputs();
    reveal = { until: performance.now() + 3000 };
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
  } else if (q.kind === "hue") {
    const line = lineAt(px, py);
    const seconds = (performance.now() - started) / 1000;
    if (line >= 0 && q.lines.includes(line)) {
      const points = Math.round((q.tries ? 400 : 800) +
                                250 * Math.max(0, 1 - seconds / LIMIT.hue));
      Game.score += points;
      Game.history.push({ kind: "hue", name: `ligne ${lineName(line)}`, points });
      say(`<em>${points} pts</em> · c'est bien la ligne ${lineName(line)}`, "near");
      endHue();
    } else {
      q.tries++;
      const why = line >= 0
        ? `<em>ligne ${lineName(line)}</em> · ce n'est pas cette teinte`
        : "<em>à côté du tracé</em>";
      if (q.tries >= 2) {
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

  if (q.kind === "far") {
    Game.history.push({ kind: "far", name: null, points: 0 });
    say(`<em>temps écoulé</em> · la plus longue faisait ` +
        `${q.best.d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`, "far");
    hideInputs();
    reveal = { until: performance.now() + 3000 };
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
    const hit = nearest(px, py, byLine[q.line]);
    const seconds = (performance.now() - started) / 1000;
    if (hit === q.target) {
      const points = Math.round((q.tries ? 400 : 800) +
                                250 * Math.max(0, 1 - seconds / LIMIT.next));
      Game.score += points;
      Game.history.push({ kind: "next", name: net.stations[hit][0], points });
      say(`<em>${points} pts</em> · ${net.stations[hit][0]}`, "near");
      reveal = { won: true, until: performance.now() + 2400 };
    } else {
      q.tries++;
      const why = hit >= 0 ? `<em>${net.stations[hit][0]}</em> · ce n'est pas elle`
                           : "<em>aucune station par ici</em>";
      if (q.tries >= 2) {
        Game.history.push({ kind: "next", name: null, points: 0 });
        say(`${why} · c'était ${net.stations[q.target][0]}`, "far");
        reveal = { won: false, until: performance.now() + 2600 };
      } else {
        say(`${why} · un essai restant`, "far");
      }
    }
    tally();
    return;
  }

  if (q.kind === "spot") {
    const d = metersTo(px, py, q.target);
    const off = Math.max(0, d - aimRadius());
    const seconds = (performance.now() - started) / 1000;
    const points = Math.round(1000 * Math.exp(-off / 900)) +
                   Math.round(250 * Math.max(0, 1 - seconds / LIMIT.spot));
    Game.score += points;
    Game.history.push({ kind: "spot", name: net.stations[q.target][0], d, points });
    say(off === 0 ? `<em>${points} pts</em> · dans la zone`
                  : `<em>${points} pts</em> · à ${format(d)}`,
        off === 0 || off < 400 ? "near" : "far");
    reveal = { at: [px, py], won: off === 0, until: performance.now() + 2100 };
    tally();
    return;
  }

  // question d'arrondissement : chaque clic doit désigner une station encore à trouver
  const wanted = q.pool.filter(i => !q.found.includes(i));
  const hit = nearest(px, py, wanted);
  if (hit >= 0) {
    q.found.push(hit);
    Game.score += 350;
    say(`<em>${net.stations[hit][0]}</em> · ${q.found.length} sur ${q.need}`, "near");
  } else {
    q.misses++;
    const left = 3 - q.misses;
    const stray = nearest(px, py);                 // désigner l'erreur aide à apprendre
    const why = stray >= 0 && !q.found.includes(stray)
      ? `<em>${net.stations[stray][0]}</em> n'est pas dans le ${ordinal(q.district.n)}`
      : "<em>raté</em>";
    say(`${why} · ${left > 0 ? left + " essai" + (left > 1 ? "s" : "") + " restant" + (left > 1 ? "s" : "") : "dernier"}`, "far");
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
  const limit = LIMIT[q.kind];
  const left = limit - (performance.now() - started) / 1000;
  timebar.firstElementChild.style.width = Math.max(0, left / limit * 100) + "%";
  timebar.classList.toggle("urgent", left < 5);
  if (left > 0) return;

  timebar.className = "clock done";
  if (q.kind === "far") {
    Game.history.push({ kind: "far", name: null, points: 0 });
    say(`<em>temps écoulé</em> · la plus longue faisait ` +
        `${q.best.d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`, "far");
    hideInputs();
    reveal = { until: performance.now() + 3000 };
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
  } else if (q.kind === "hue") {
    Game.history.push({ kind: "hue", name: null, points: 0 });
    say(`<em>temps écoulé</em> · c'était la ligne ${lineName(q.line)}`, "far");
    endHue();
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
    // rien avant la correction : situer soi-même le point de départ fait partie de la
    // question, le montrer reviendrait à ne demander que le sens de marche
    if (reveal) {
      // la station de départ s'annonce du côté opposé à celle qu'il fallait trouver
      const west = net.stations[q.from][2] < net.stations[q.target][2];
      dot(ctx, q.from, "#8a8a8a", true, west ? "left" : "right");
      dot(ctx, q.target, reveal.won ? "#1a7f37" : "#b3261e", true, west ? "right" : "left");
    }
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
    closeName();
    say(`<em>temps écoulé</em> · ${q.found.length} sur ${q.need}`,
        q.found.length ? "near" : "far");
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
    const got = q.found.length;
    closeWards();
    say(`<em>temps écoulé</em> · ${got} sur ${q.need}`, got ? "near" : "far");
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
  const q = Game.question;
  if (!q) return;
  if (reveal && !reveal.born) reveal.born = performance.now();

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
    // rien avant la correction : situer soi-même le point de départ fait partie de la
    // question, le montrer reviendrait à ne demander que le sens de marche
    if (reveal) {
      // la station de départ s'annonce du côté opposé à celle qu'il fallait trouver
      const west = net.stations[q.from][2] < net.stations[q.target][2];
      dot(ctx, q.from, "#8a8a8a", true, west ? "left" : "right");
      dot(ctx, q.target, reveal.won ? "#1a7f37" : "#b3261e", true, west ? "right" : "left");
    }
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
    dot(ctx, q.target, "#b3261e", true);
  }
  ctx.restore();
};

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
  ctx.fillStyle = "#fff";
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
  ctx.strokeStyle = "rgba(255,255,255,.92)";
  ctx.strokeText(st[0], tx, y);
  ctx.fillStyle = color;
  ctx.fillText(st[0], tx, y);
  ctx.textAlign = "left";
}

/* ---------- ouverture et clôture ---------- */

function start() {
  document.body.classList.add("explored");
  Game.playing = true;
  Game.score = 0;
  shown = 0;
  Game.step = 0;
  Game.history = [];
  asked = new Set();
  askedDistricts = new Set();
  askedHues = new Set();
  askedThemes = new Set();
  reveal = null;
  Game.blind = false;
  Game.line = null;
  Game.lastKind = null;
  Game.plan = buildRound();
  document.body.classList.add("playing");
  hud.hidden = false;
  over.hidden = true;
  if (selected !== null) select(null);
  tally();
  nextQuestion();
  bgDirty = true;
}

function stop() {
  showRecord();
  Game.playing = false;
  Game.question = null;
  reveal = null;
  Game.blind = false;
  hideInputs();
  if (Game.line !== null) { Game.line = null; select(null, true); }
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
  const links = done.filter(h => ["next", "odd", "which", "outside", "far"].includes(h.kind));
  const quizzes = done.filter(h => h.kind === "theme" || h.kind === "name" || h.kind === "wards");
  const spotted = zones.reduce((s, h) => s + h.hits, 0);
  const wanted = zones.reduce((s, h) => s + h.need, 0);

  let best = 0;
  try { best = +(localStorage.getItem(BEST_KEY) || 0); } catch { /* stockage indisponible */ }
  const record = Game.score > best;
  if (record) { try { localStorage.setItem(BEST_KEY, Game.score); } catch { /* ignoré */ } }

  const rate = done.length
    ? done.reduce((s, h) => s + success(h), 0) / done.length : 0;
  const grade = GRADES.find(g => rate >= g.min) || GRADES[GRADES.length - 1];

  stop();
  over.innerHTML = `
    <p class="grade">${grade.title}</p>
    <p class="note">${grade.note}</p>
    <h2>${Game.score}</h2>
    <p class="sub">${Math.round(rate * 100)} % de réussite · ${
      record ? "nouveau record" : `record : ${best || "—"}`}</p>
    <dl>
      <dt>stations visées</dt><dd>${shots.length}</dd>
      <dt>écart moyen</dt><dd>${avg !== null ? format(avg) : "—"}</dd>
      ${zones.length ? `<dt>stations d'arrondissement</dt><dd>${spotted} / ${wanted}</dd>` : ""}
      ${links.length ? `<dt>questions de réseau</dt><dd>${
        links.filter(h => h.name).length} / ${links.length}</dd>` : ""}
      ${quizzes.length ? `<dt>devinettes de noms</dt><dd>${
        quizzes.reduce((s, h) => s + h.hits, 0)} / ${
        quizzes.reduce((s, h) => s + h.need, 0)}</dd>` : ""}
      <dt>meilleur coup</dt><dd>${aimed.length
        ? aimed.reduce((a, b) => a.d < b.d ? a : b).name : "—"}</dd>
    </dl>
    <div class="actions">
      <button class="again">Rejouer</button>
      <button class="back">La carte</button>
    </div>`;
  over.hidden = false;
  over.querySelector(".again").onclick = () => { over.hidden = true; start(); };
  over.querySelector(".back").onclick = () => { over.hidden = true; };
}

playBtn.disabled = true;
playBtn.onclick = start;
hud.querySelector(".quit").onclick = stop;
addEventListener("keydown", e => {
  if (e.key === "Escape" && Game.playing) stop();
});
