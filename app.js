/* Métro de Paris en mouvement — rendu canvas, sans dépendance.
   Les rames sont positionnées par interpolation entre deux arrêts,
   à partir des horaires GTFS d'Île-de-France Mobilités. */

const LAT0 = 48.86;                 // même référence que tools/build_data.py
const M_PER_WORLD = 40075017 * Math.cos(LAT0 * Math.PI / 180);
const DAY = 86400;

const cv = document.getElementById("map");
const ctx = cv.getContext("2d");
const bg = document.createElement("canvas");
const bgx = bg.getContext("2d");
const tip = document.getElementById("tooltip");

let net = null;            // réseau : lignes, tracés, stations, patterns
let paris = null;          // limites administratives de la ville
let fleet = [];            // toutes les courses du jour (et fin de service de la veille)
let active = [];           // courses en circulation à l'instant simulé
let running = 0;           // total sur le réseau, filtres compris
let visible = new Set();   // lignes affichées
let hovered = -1;          // ligne sous le curseur
let spotlight = [];        // lignes mises en avant par le jeu, en guise d'indice
let topInset = 0;          // hauteur occupée par le bandeau, à ne pas cadrer dessous
let lastMouse = null;

const view = { x: 0, y: 0, scale: 1 };
let dpr = 1, bgDirty = true, fitScale = 1;
let simTime = 0, lastFrame = 0, lastScan = -1e9;
let shapeLine = [];        // ligne à laquelle appartient chaque tracé
let framed = false;        // le réseau a-t-il déjà été cadré ?
let bounds = null;
const album = document.getElementById("album-vue");
let selected = null;       // ligne isolée, ou null pour le réseau entier
let anim = null;           // transition de cadrage en cours
const stats = [];          // caractéristiques de chaque ligne, calculées une fois

/* Deux habillages : la carte au repos est un plan de métro sur papier blanc ; dès qu'une
   manche commence, tout bascule en nuit et les seize couleurs du réseau éclatent. */
const SKINS = {
  jour: {
    ville: "#fbfbfb", bordVille: "#cfcfcf",
    station: "#fff", contour: "rgba(90,90,90,.55)", noeud: "rgba(40,40,40,.8)",
    texte: "#4a4a4a", halo: "rgba(255,255,255,.9)",
    muet: "#2f2f2f",                               // réseau des questions de couleur
    trace: l => pale(l, 0.82),
    efface: l => pale(l, 0.24),
  },
  nuit: {
    ville: "#191d26", bordVille: "#2f3542",
    station: "#e9ecf4", contour: "rgba(150,158,180,.65)", noeud: "rgba(255,255,255,.9)",
    texte: "#c9cedd", halo: "rgba(12,14,20,.85)",
    muet: "#8b93a7",
    trace: l => l,
    efface: l => shade(l, 0.42),
  },
};
let skin = SKINS.jour;

/* Assombrit une couleur vers le fond de nuit. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(c * k + 25 * (1 - k));
  return `rgb(${mix(n >> 16 & 255)},${mix(n >> 8 & 255)},${mix(n & 255)})`;
}

/* Teinte adoucie pour les tracés : les rames, en couleur pleine, s'en détachent. */
function pale(hex, k = 0.42) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(c + (255 - c) * (1 - k));
  return `rgb(${mix(n >> 16 & 255)},${mix(n >> 8 & 255)},${mix(n & 255)})`;
}

/* ---------- géométrie ---------- */

const merc = (lat, lon) => {
  const s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};

function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let res = 0, shift = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        res |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (which === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

/* ---------- chargement ---------- */

async function boot() {
  const now = new Date();
  const wd = (now.getDay() + 6) % 7;              // 0 = lundi
  const prev = (wd + 6) % 7;
  const [network, today, yesterday, outline] = await Promise.all([
    fetch("data/network.json").then(r => r.json()),
    fetch(`data/day-${wd}.json`).then(r => r.json()),
    fetch(`data/day-${prev}.json`).then(r => r.json()),
    fetch("data/paris.json").then(r => r.json()).catch(() => null),
  ]);

  net = network;
  net.shapes = net.shapes.map(enc => ({
    world: decodePolyline(enc).map(([la, lo]) => merc(la, lo)),
  }));
  net.stations.forEach(s => { s[4] = merc(s[1], s[2]); });
  if (outline) {
    const toWorld = r => decodePolyline(r).map(([la, lo]) => merc(la, lo));
    paris = {
      rings: outline.rings.map(toWorld),
      districts: (outline.districts || []).map(d => ({
        n: d.n, name: d.name, rings: d.rings.map(toWorld),
      })),
      stationDistrict: outline.stationDistrict || [],
    };
  }

  const load = (day, offset) => {
    for (const [pat, tim, t0] of day.trips) {
      const prof = day.timings[tim];
      const start = t0 + offset;
      const end = start + prof[prof.length - 1];
      if (end < 0) continue;                       // course de la veille déjà terminée
      fleet.push({ pat, prof, t0: start, end, line: net.patterns[pat][0], today: offset === 0 });
    }
  };
  load(yesterday, -DAY);
  load(today, 0);
  fleet.sort((a, b) => a.t0 - b.t0);

  net.lines.forEach((l, i) => { visible.add(i); l[3] = pale(l[1], 0.82); });
  shapeLine = new Array(net.shapes.length).fill(0);
  net.patterns.forEach(p => { shapeLine[p[1]] = p[0]; });
  traceVoies();
  fit();
  simTime = clock();
  document.getElementById("loader").classList.add("done");
  dispatchEvent(new Event("metro:ready"));
  requestAnimationFrame(frame);
}

const clock = () => {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
};

/* ---------- vue ---------- */

/* Cadre une emprise géographique, éventuellement décalée pour dégager le panneau. */
function frameTo(box, margin = 0.86, shift = 0, ceiling = Infinity) {
  const w = cv.width / dpr, h = cv.height / dpr - topInset;
  if (!w || h <= 0) return null;
  const scale = Math.min((w - Math.abs(shift)) / (box.maxX - box.minX),
                         h / (box.maxY - box.minY), ceiling / margin) * margin;
  return {
    scale,
    x: (box.minX + box.maxX) / 2 - shift / 2 / scale,
    // le bandeau mange le haut de l'écran : on centre sur ce qui reste
    y: (box.minY + box.maxY) / 2 - topInset / 2 / scale,
  };
}

function flyTo(target, dur = 520) {
  if (!target) return;
  anim = { from: { ...view }, to: target, start: performance.now(), dur };
}

/* Emprise des tracés d'une ligne, ou de tout le réseau si line vaut null. */
function extent(line) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  net.patterns.forEach(p => {
    if (line !== null && p[0] !== line) return;
    for (const [x, y] of net.shapes[p[1]].world) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  return { minX, minY, maxX, maxY };
}

function fit() {
  if (!bounds) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const sh of net.shapes) {
      for (const [x, y] of sh.world) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    bounds = { minX, minY, maxX, maxY };
  }
  resize(false);
  const w = cv.width / dpr, h = cv.height / dpr;
  if (!w || !h) return false;                     // canvas pas encore dimensionné
  view.scale = Math.min(w / (bounds.maxX - bounds.minX),
                        h / (bounds.maxY - bounds.minY)) * 0.86;
  view.x = (bounds.minX + bounds.maxX) / 2;
  view.y = (bounds.minY + bounds.maxY) / 2;
  fitScale = view.scale;
  framed = true;
  bgDirty = true;
  return true;
}

const sx = x => (x - view.x) * view.scale + cv.width / dpr / 2;
const sy = y => (y - view.y) * view.scale + cv.height / dpr / 2;
const mpp = () => M_PER_WORLD / view.scale;      // mètres par pixel

function resize(redraw = true) {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
  if (cv.width === w && cv.height === h) { if (redraw) bgDirty = true; return; }
  for (const c of [cv, bg]) { c.width = w; c.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bgx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (redraw) bgDirty = true;
}

/* ---------- fond : tracés et stations ---------- */

function drawBackground() {
  const w = cv.width / dpr, h = cv.height / dpr;
  bgx.clearRect(0, 0, w, h);

  const m = mpp();

  // limites de la ville, posées sous le réseau
  if (paris) {
    bgx.beginPath();
    for (const ring of paris.rings) {
      bgx.moveTo(sx(ring[0][0]), sy(ring[0][1]));
      for (let i = 1; i < ring.length; i++) bgx.lineTo(sx(ring[i][0]), sy(ring[i][1]));
      bgx.closePath();
    }
    bgx.fillStyle = skin.ville;
    bgx.fill();
    bgx.lineWidth = 1;
    bgx.strokeStyle = skin.bordVille;
    bgx.stroke();
  }

  const lw = Math.max(1.5, Math.min(6, 80 / m));
  bgx.lineCap = "round";
  bgx.lineJoin = "round";
  bgx.lineWidth = lw;

  // un seul tracé par ligne : les variantes qui se superposent ne s'assombrissent pas
  const paths = net.lines.map(() => new Path2D());
  for (const [line, shapeIdx] of net.patterns) {
    if (!visible.has(line)) continue;
    const pts = net.shapes[shapeIdx].world;
    const p = paths[line];
    p.moveTo(sx(pts[0][0]), sy(pts[0][1]));
    for (let i = 1; i < pts.length; i++) p.lineTo(sx(pts[i][0]), sy(pts[i][1]));
  }
  const blind = window.Game && Game.blind;
  const paint = i => {
    const l = net.lines[i];
    const lit = i === hovered || spotlight.includes(i);
    // en question de couleur, le survol aide à viser sans désigner de réponse
    bgx.lineWidth = lit ? lw * (blind ? 1.4 : 2.6) : lw;
    bgx.strokeStyle = blind ? skin.muet
                    : lit ? l[1]                       // la ligne visée en couleur pleine
                    : selected === i ? pale(l[1], 0.72)
                    : (hovered >= 0 || spotlight.length) ? skin.efface(l[1])
                    : skin.trace(l[1]);
    bgx.stroke(paths[i]);
  };
  const front = i => i === hovered || spotlight.includes(i);
  net.lines.forEach((_, i) => { if (visible.has(i) && !front(i)) paint(i); });
  net.lines.forEach((_, i) => { if (visible.has(i) && front(i)) paint(i); });
  bgx.lineWidth = lw;

  if (blind) return;                              // question de couleur : tracés nus
  // le voyage ne montre que la station en cours de parcours, la conquête ne montre que
  // son territoire : les deux dessinent leurs points eux-mêmes, par-dessus
  if (window.Voyage && Voyage.actif) return;
  if (window.Conquete && Conquete.actif) return;
  const hunt = window.Game && Game.playing;

  // les stations sont désormais ce que la carte donne à voir : elles restent visibles
  // à toutes les échelles, plus grosses là où plusieurs lignes se croisent
  const r = Math.max(2, lw * 0.5);
  bgx.fillStyle = skin.station;
  const labels = m < 8 && !hunt;
  if (labels) {
    bgx.font = "500 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    bgx.textBaseline = "middle";
  }
  for (const st of net.stations) {
    const shown = st[3].filter(l => visible.has(l));
    if (!shown.length) continue;
    const lit = (hovered >= 0 && st[3].includes(hovered)) ||
                st[3].some(l => spotlight.includes(l));
    // en partie, toutes les stations se valent : distinguer les nœuds désignerait
    // les correspondances à trouver
    const node = shown.length > 1 && !hunt;
    const x = sx(st[4][0]), y = sy(st[4][1]);
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
    bgx.lineWidth = lit ? 2 : node ? 1.4 : 1;
    // la ligne mise en avant peut venir du survol comme du jeu : on prend celle des deux
    // qui concerne cette station, jamais un index vide
    const par = hovered >= 0 && st[3].includes(hovered)
      ? hovered : st[3].find(l => spotlight.includes(l));
    bgx.strokeStyle = lit && par !== undefined ? net.lines[par][1]
                    : node ? skin.noeud : skin.contour;
    bgx.fillStyle = skin.station;
    bgx.beginPath();
    bgx.arc(x, y, lit ? Math.max(r * 1.9, 4.5) : node ? r * 1.35 : r, 0, 6.2832);
    bgx.fill();
    bgx.stroke();
    if (labels) {
      bgx.fillStyle = "#4a4a4a";
      bgx.lineWidth = 3;
      bgx.strokeStyle = "rgba(255,255,255,.9)";
      bgx.strokeText(st[0], x + r + 4, y);   // liseré blanc pour rester lisible sur un tracé
      bgx.fillText(st[0], x + r + 4, y);
      bgx.fillStyle = "#fff";
      bgx.lineWidth = 0.8;
      bgx.strokeStyle = "rgba(80,80,80,.35)";
    }
  }
}

/* Ligne dont le tracé passe le plus près d'un point de l'écran, à 22 pixels près. */
function lineAt(px, py) {
  let best = -1, bestD = 22;
  net.shapes.forEach((sh, k) => {
    if (!visible.has(shapeLine[k])) return;
    const pts = sh.world;
    for (let i = 1; i < pts.length; i++) {
      const ax = sx(pts[i - 1][0]), ay = sy(pts[i - 1][1]);
      const bx = sx(pts[i][0]), by = sy(pts[i][1]);
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < bestD) { bestD = d; best = shapeLine[k]; }
    }
  });
  return best;
}

/* Bascule l'habillage de la carte entre jour et nuit. */
function wear(name) {
  if (skin === SKINS[name]) return;
  skin = SKINS[name];
  // la classe va sur <html> : c'est lui qui peint le fond de la page
  document.documentElement.classList.toggle("nuit", name === "nuit");
  bgDirty = true;
}

/* ---------- rames d'ambiance ---------- */

/* Sur l'écran d'accueil, des rames parcourent chaque ligne. Elles ne suivent pas les
   horaires — ce serait invisible et, aux heures creuses, le réseau paraîtrait mort :
   elles tournent en boucle à vitesse fixe, dans les deux sens, pour que la carte ait
   l'air en service. Elles s'effacent dès qu'une partie commence. */
let voies = [];                  // tracé principal de chaque ligne et ses longueurs cumulées

const RAMES = 3;                 // par ligne et par sens
const TOUR = 26;                 // secondes pour parcourir une ligne de bout en bout

function traceVoies() {
  // le tracé le plus long de chaque ligne : les services partiels s'arrêtent en route
  const parLigne = new Map();
  for (const [line, shapeIdx] of net.patterns) {
    const pts = net.shapes[shapeIdx].world;
    const vu = parLigne.get(line);
    if (!vu || pts.length > vu.length) parLigne.set(line, pts);
  }
  voies = net.lines.map((_, i) => {
    const pts = parLigne.get(i) || [];
    const cumul = [0];
    for (let k = 1; k < pts.length; k++) {
      cumul.push(cumul[k - 1] +
        Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    return { pts, cumul, total: cumul[cumul.length - 1] || 0 };
  });
}

/* Point situé à la distance `d` du départ, par dichotomie sur les longueurs cumulées. */
function surVoie(voie, d) {
  let lo = 0, hi = voie.cumul.length - 1;
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1;
    if (voie.cumul[m] <= d) lo = m; else hi = m;
  }
  const seg = voie.cumul[hi] - voie.cumul[lo] || 1;
  const u = (d - voie.cumul[lo]) / seg;
  const a = voie.pts[lo], b = voie.pts[hi];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function drawRames(ctx, t) {
  const zoom = Math.min(1.6, view.scale / fitScale);
  const L = 9 + 8 * zoom;                          // longueur de la rame, en pixels
  const E = 3.4 + 2.4 * zoom;                      // et sa largeur
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = skin.halo;
  for (let i = 0; i < voies.length; i++) {
    const voie = voies[i];
    if (!voie.total || !visible.has(i)) continue;
    ctx.fillStyle = net.lines[i][1];
    for (let k = 0; k < RAMES * 2; k++) {
      const sens = k % 2 ? -1 : 1;
      // le décalage dépend aussi de la ligne : sans lui, toutes partiraient de front
      const phase = k / (RAMES * 2) + i * 0.137;
      let u = (t / TOUR * sens + phase) % 1;
      if (u < 0) u += 1;
      const d = u * voie.total;
      const [x, y] = surVoie(voie, d);
      // un second point juste devant donne le cap : la rame se couche sur sa voie
      const [x2, y2] = surVoie(voie, Math.min(voie.total, d + voie.total * 0.004));
      const px = sx(x), py = sy(y);
      const angle = Math.atan2(sy(y2) - py, sx(x2) - px);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.roundRect(-L / 2, -E / 2, L, E, E / 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function scan(t) {
  active = [];
  running = 0;
  for (const tr of fleet) {
    if (tr.t0 > t) break;                          // fleet est trié par départ
    if (tr.end < t) continue;
    running++;
    if (visible.has(tr.line)) active.push(tr);
  }
  lastScan = t;
}

function draw(t) {
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bg, 0, 0, w, h);

  if (window.Game && Game.playing) Game.draw(ctx);
  else drawRames(ctx, performance.now() / 1000);

  const hh = String(Math.floor(t / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
  document.getElementById("status").textContent =
    `${hh}:${mm} · ${net.stations.length} stations · ${net.lines.length} lignes`;
}

function frame(ts) {
  const dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.5) : 0;
  lastFrame = ts;

  simTime = clock();

  if (Math.abs(simTime - lastScan) > 0.6) scan(simTime);
  if (!framed && !fit()) { requestAnimationFrame(frame); return; }

  // La carte n'est plus jamais immobile : hors partie les rames circulent, pendant une
  // partie la couche de jeu s'anime. Reste un cas où repeindre ne sert à rien — quand la
  // collection recouvre l'écran et qu'il n'y a rien à voir derrière.
  const couvert = album && !album.hidden && !bgDirty && !anim;
  if (couvert) {
    clock2();                                      // l'en-tête suffit, une fois par seconde
    requestAnimationFrame(frame);
    return;
  }

  if (anim) {                                      // recadrage progressif
    const u = Math.min(1, (ts - anim.start) / anim.dur);
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    view.x = anim.from.x + (anim.to.x - anim.from.x) * e;
    view.y = anim.from.y + (anim.to.y - anim.from.y) * e;
    view.scale = Math.exp(Math.log(anim.from.scale) +
                          (Math.log(anim.to.scale) - Math.log(anim.from.scale)) * e);
    bgDirty = true;
    if (u >= 1) anim = null;
  }
  if (bgDirty) { drawBackground(); bgDirty = false; }
  draw(simTime);
  requestAnimationFrame(frame);
}


/* ---------- lignes ---------- */

/* Les deux terminus d'une ligne, retenus une fois pour toutes. */
const bouts = [];
function lineEnds(i) {
  if (bouts[i]) return bouts[i];
  let main = null;
  for (const p of net.patterns) {
    if (p[0] === i && (!main || p[3].length > main[3].length)) main = p;
  }
  const stops = main[3];
  return (bouts[i] = {
    from: net.stations[stops[0]][0],
    to: net.stations[stops[stops.length - 1]][0],
  });
}

/* Isole une ligne, ou revient au réseau entier. */
function select(i) {
  selected = i;
  visible = new Set(i === null ? net.lines.map((_, k) => k) : [i]);
  flyTo(i === null ? frameTo(bounds) : frameTo(extent(i), 0.78, 0, fitScale * 7));
  bgDirty = true;
  scan(simTime);
}

/* L'en-tête n'a besoin que d'une mise à jour par seconde. */
let lastLabel = -1;
function clock2() {
  const t = Math.floor(simTime / 60);
  if (t === lastLabel) return;
  lastLabel = t;
  const hh = String(Math.floor(simTime / 3600) % 24).padStart(2, "0");
  const mm = String(t % 60).padStart(2, "0");
  document.getElementById("status").textContent =
    `${hh}:${mm} · ${net.stations.length} stations · ${net.lines.length} lignes`;
}

/* ---------- interface ---------- */

/* déplacement, zoom, survol */
const pointers = new Map();
let gesture = null;   // état du geste à deux doigts

const centroid = () => {
  let x = 0, y = 0;
  for (const p of pointers.values()) { x += p.x; y += p.y; }
  return [x / pointers.size, y / pointers.size];
};
const spread = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

let tap = null;            // point de départ du geste, pour reconnaître un clic

const explored = () => document.body.classList.add("explored");

cv.addEventListener("pointerdown", e => {
  explored();
  anim = null;
  tap = { x: e.clientX, y: e.clientY, at: performance.now(),
          playing: !!(window.Game && Game.playing) };
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { cv.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
  gesture = pointers.size === 2
    ? { at: centroid(), gap: spread() }
    : { at: [e.clientX, e.clientY], gap: 0 };
  cv.classList.add("dragging");
});

cv.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId)) {
    hover(e.clientX, e.clientY);
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (hovered >= 0) { hovered = -1; bgDirty = true; }
  const at = centroid();

  if (pointers.size === 2) {                       // pincement : zoom autour du milieu
    const gap = spread();
    if (gesture.gap > 0 && gap > 0) zoomAt(at[0], at[1], gap / gesture.gap);
    gesture.gap = gap;
  }
  view.x -= (at[0] - gesture.at[0]) / view.scale;
  view.y -= (at[1] - gesture.at[1]) / view.scale;
  gesture.at = at;
  bgDirty = true;
  tip.hidden = true;
});

const release = e => {
  if (tap && pointers.size === 1) {
    const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
    const clicked = moved < 7 && performance.now() - tap.at < 700;
    // un appui commencé avant le début de la partie ne vaut pas réponse
    if (clicked && tap.playing && window.Game && Game.playing) {
      Game.click(e.clientX, e.clientY);
    } else if (clicked && !(window.Game && Game.playing)) {
      const line = lineAt(e.clientX, e.clientY);
      if (line >= 0 && line !== selected) select(line);
      else if (line < 0 && selected !== null) select(null);
    }
  }
  tap = null;
  pointers.delete(e.pointerId);
  gesture = pointers.size
    ? { at: centroid(), gap: pointers.size === 2 ? spread() : 0 }
    : null;
  if (!pointers.size) cv.classList.remove("dragging");
};
cv.addEventListener("pointerup", release);
cv.addEventListener("pointercancel", release);
cv.addEventListener("pointerleave", e => {
  if (pointers.has(e.pointerId)) return;
  tip.hidden = true;
  if (hovered >= 0) { hovered = -1; cv.style.cursor = ""; bgDirty = true; }
});

cv.addEventListener("wheel", e => {
  e.preventDefault();
  explored();
  anim = null;
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016)));
}, { passive: false });

cv.addEventListener("dblclick", e => zoomAt(e.clientX, e.clientY, 1.9));

function zoomAt(px, py, factor) {
  const k = Math.max(0.4, Math.min(16, view.scale * factor / fitScale)) * fitScale;
  const wx = (px - cv.width / dpr / 2) / view.scale + view.x;
  const wy = (py - cv.height / dpr / 2) / view.scale + view.y;
  const ratio = k / view.scale;
  view.x = wx - (wx - view.x) / ratio;
  view.y = wy - (wy - view.y) / ratio;
  view.scale = k;
  bgDirty = true;
}

/* Station la plus proche du curseur, à portée de clic. */
function stationAt(px, py) {
  let best = -1, bestD = 13;
  net.stations.forEach((st, i) => {
    if (!st[3].some(l => visible.has(l))) return;
    const d = Math.hypot(px - sx(st[4][0]), py - sy(st[4][1]));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function hover(px, py) {
  // le survol d'un tracé l'épaissit et fait ressortir ses stations, pour viser plus juste
  const playing = window.Game && Game.playing;
  const track = !playing || (Game.question && Game.question.kind === "hue");
  const line = track ? lineAt(px, py) : -1;
  if (line !== hovered) {
    hovered = line;
    cv.style.cursor = line >= 0 ? "pointer" : "";
    bgDirty = true;
  }
  if (playing) { tip.hidden = true; return; }
  lastMouse = [px, py];
  const st = stationAt(px, py);
  if (st >= 0) {                           // le nom de la station passe avant sa ligne
    // le nom seul : les numéros de lignes allongeaient l'étiquette au point de recouvrir
    // la carte autour du curseur
    tip.innerHTML = `<b>${net.stations[st][0]}</b>`;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
    tip.hidden = false;
    return;
  }
  if (hovered >= 0) {
    const l = net.lines[hovered];
    const ends = lineEnds(hovered);
    tip.innerHTML = `<b>Ligne ${l[0]}</b> <span>${ends.from} ↔ ${ends.to}</span>`;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
    tip.hidden = false;
    return;
  }
  tip.hidden = true;
}

window.addEventListener("resize", () => resize());
new ResizeObserver(() => {
  if (net) resize();
}).observe(document.documentElement);
window.addEventListener("keydown", e => {
  if (e.key === "f") { anim = null; framed = false; fit(); }
  if (e.key === "Escape" && selected !== null) select(null);
});

boot().catch(err => {
  document.getElementById("loader").textContent =
    "Impossible de charger les données. Le site doit être servi en HTTP (voir le README).";
  console.error(err);
});
