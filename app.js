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
let lastMouse = null;

const view = { x: 0, y: 0, scale: 1 };
let dpr = 1, bgDirty = true, fitScale = 1;
let simTime = 0, lastFrame = 0, lastScan = -1e9;
let shapeLine = [];        // ligne à laquelle appartient chaque tracé
let framed = false;        // le réseau a-t-il déjà été cadré ?
let bounds = null;
let selected = null;       // ligne isolée, ou null pour le réseau entier
let anim = null;           // transition de cadrage en cours
const stats = [];          // caractéristiques de chaque ligne, calculées une fois

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
  const w = cv.width / dpr, h = cv.height / dpr;
  if (!w || !h) return null;
  const scale = Math.min((w - Math.abs(shift)) / (box.maxX - box.minX),
                         h / (box.maxY - box.minY) , ceiling / margin) * margin;
  return {
    scale,
    x: (box.minX + box.maxX) / 2 - shift / 2 / scale,
    y: (box.minY + box.maxY) / 2,
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
    bgx.fillStyle = "#fbfbfb";
    bgx.fill();
    bgx.lineWidth = 1;
    bgx.strokeStyle = "#cfcfcf";
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
    const lit = i === hovered;
    // en question de couleur, le survol aide à viser sans désigner de réponse
    bgx.lineWidth = lit ? lw * (blind ? 1.4 : 2.6) : lw;
    bgx.strokeStyle = blind ? "#2f2f2f"
                    : lit ? l[1]                       // la ligne visée en couleur pleine
                    : selected === i ? pale(l[1], 0.72)
                    : hovered >= 0 ? pale(l[1], 0.24)  // les autres reculent
                    : l[3];
    bgx.stroke(paths[i]);
  };
  net.lines.forEach((_, i) => { if (visible.has(i) && i !== hovered) paint(i); });
  if (hovered >= 0 && visible.has(hovered)) paint(hovered);   // au-dessus des autres
  bgx.lineWidth = lw;

  if (blind) return;                              // question de couleur : tracés nus
  const hunt = window.Game && Game.playing;

  // les stations sont désormais ce que la carte donne à voir : elles restent visibles
  // à toutes les échelles, plus grosses là où plusieurs lignes se croisent
  const r = Math.max(2, lw * 0.5);
  bgx.fillStyle = "#fff";
  const labels = m < 8 && !hunt;
  if (labels) {
    bgx.font = "500 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    bgx.textBaseline = "middle";
  }
  for (const st of net.stations) {
    const shown = st[3].filter(l => visible.has(l));
    if (!shown.length) continue;
    const lit = hovered >= 0 && st[3].includes(hovered);
    // en partie, toutes les stations se valent : distinguer les nœuds désignerait
    // les correspondances à trouver
    const node = shown.length > 1 && !hunt;
    const x = sx(st[4][0]), y = sy(st[4][1]);
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
    bgx.lineWidth = lit ? 2 : node ? 1.4 : 1;
    bgx.strokeStyle = lit ? net.lines[hovered][1]
                    : node ? "rgba(40,40,40,.8)" : "rgba(90,90,90,.55)";
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

/* ---------- rames ---------- */

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
  refreshPanel();
}

function draw(t) {
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bg, 0, 0, w, h);

  if (window.Game && Game.playing) Game.draw(ctx);

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


/* ---------- fiche de ligne ---------- */

const panel = document.getElementById("panel");

const fmtKm = m => (m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " km";
const fmtMin = s => Math.round(s / 60) + " min";
const fmtGap = s => {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m} min${r ? " " + r + " s" : ""}` : `${r} s`;
};
const fmtHour = s =>
  `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;

/* Caractéristiques d'une ligne, déduites de son parcours le plus complet. */
function lineStats(i) {
  if (stats[i]) return stats[i];

  const pats = [];
  net.patterns.forEach((p, k) => { if (p[0] === i) pats.push(k); });
  let main = pats[0];
  for (const k of pats) {
    if (net.patterns[k][3].length > net.patterns[main][3].length) main = k;
  }
  const mp = net.patterns[main];
  const stops = mp[3], dist = mp[4];

  const served = new Set();
  for (const k of pats) for (const st of net.patterns[k][3]) served.add(st);

  // durée bout en bout : valeur médiane des courses qui suivent ce parcours
  const runs = fleet.filter(t => t.pat === main).map(t => t.prof[t.prof.length - 2]);
  runs.sort((a, b) => a - b);
  const ride = runs.length ? runs[runs.length >> 1] : 0;

  const daily = fleet.filter(t => t.line === i && t.today);
  const starts = daily.map(t => t.t0);
  const length = dist[dist.length - 1] - dist[0];

  return (stats[i] = {
    from: net.stations[stops[0]][0],
    to: net.stations[stops[stops.length - 1]][0],
    stations: served.size,
    length,
    ride,
    speed: ride ? length / 1000 / (ride / 3600) : 0,
    runs: daily.length,
    first: starts.length ? Math.min(...starts) : null,
    last: starts.length ? Math.max(...starts) : null,
    box: extent(i),
  });
}

/* Écart médian entre deux départs consécutifs, dans un sens, autour de l'instant t. */
function headway(i, t) {
  const win = 2700;
  const times = [];
  for (const tr of fleet) {
    if (tr.line === i && net.patterns[tr.pat][2] === 0 &&
        tr.t0 > t - win && tr.t0 < t + win) times.push(tr.t0);
  }
  if (times.length < 3) return null;
  times.sort((a, b) => a - b);
  const gaps = [];
  for (let k = 1; k < times.length; k++) gaps.push(times[k] - times[k - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

function showPanel(i) {
  const l = net.lines[i], st = lineStats(i);
  panel.innerHTML = `
    <div class="head">
      <span class="badge" style="background:${l[1]};color:${l[2]}">${l[0]}</span>
      <b>Ligne ${l[0]}</b>
      <button class="close" title="Voir tout le réseau">&times;</button>
    </div>
    <p class="ends"><span>${st.from}</span> ↔ <span>${st.to}</span></p>
    <dl>
      <dt>stations</dt><dd>${st.stations}</dd>
      <dt>longueur</dt><dd>${fmtKm(st.length)}</dd>
      <dt>bout en bout</dt><dd>${fmtMin(st.ride)}</dd>
      <dt>vitesse moyenne</dt><dd>${Math.round(st.speed)} km/h</dd>
      <div class="sep"></div>
      <div class="live" style="display:contents">
        <dt>en circulation</dt><dd data-live="trains">—</dd>
        <dt>un départ toutes les</dt><dd data-live="gap">—</dd>
      </div>
      <div class="sep"></div>
      <dt>service</dt><dd>${st.first !== null ? fmtHour(st.first) + " – " + fmtHour(st.last) : "—"}</dd>
      <dt>courses du jour</dt><dd>${st.runs}</dd>
    </dl>`;
  panel.querySelector(".close").onclick = () => select(null);
  panel.hidden = false;
  refreshPanel();
}

function refreshPanel() {
  if (selected === null || panel.hidden) return;
  const n = active.length;
  const gap = headway(selected, simTime);
  panel.querySelector('[data-live="trains"]').textContent =
    n ? `${n} rame${n > 1 ? "s" : ""}` : "aucune";
  panel.querySelector('[data-live="gap"]').textContent = gap ? fmtGap(gap) : "—";
}

/* Isole une ligne, ou revient au réseau entier.
   `quiet` cadre la ligne sans ouvrir sa fiche — ce dont le jeu a besoin. */
function select(i, quiet) {
  selected = i;
  visible = new Set(i === null ? net.lines.map((_, k) => k) : [i]);
  if (i === null) {
    panel.hidden = true;
    flyTo(frameTo(bounds));
  } else {
    if (!quiet) showPanel(i);
    const gap = quiet ? 0 : (innerWidth > 640 ? 290 : 0);   // place laissée à la fiche
    flyTo(frameTo(lineStats(i).box, quiet ? 0.78 : 0.82, gap, fitScale * 7));
  }
  bgDirty = true;
  scan(simTime);
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
    const s = net.stations[st];
    tip.innerHTML = `<b>${s[0]}</b> <span>${s[3].map(k => net.lines[k][0]).join(" · ")}</span>`;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
    tip.hidden = false;
    return;
  }
  if (hovered >= 0) {
    const l = net.lines[hovered];
    tip.innerHTML = `<b>Ligne ${l[0]}</b> <span>${lineStats(hovered).from} ↔ ${
      lineStats(hovered).to}</span>`;
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
