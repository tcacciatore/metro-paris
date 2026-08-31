/* Le son du jeu. Tout est synthétisé à la volée : pas un fichier à charger, pas un octet
   de plus au chargement, et des sons qui suivent le jeu au lieu de se répéter à
   l'identique — le timbre d'une bonne réponse monte avec la série, si bien qu'on entend
   sa progression sans regarder le compteur.

   Le contexte audio ne s'ouvre qu'au premier geste du joueur : les navigateurs refusent
   d'émettre avant, et c'est une bonne règle. */
(function () {

const Son = { actif: true };
const CLE = "metro-son";

let audio = null;                // AudioContext, ouvert au premier son
let sortie = null;               // gain maître

/* Ouvre le contexte, ou le réveille s'il a été suspendu par le navigateur. */
function reveille() {
  if (!Son.actif) return null;
  if (audio) {
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  const Contexte = window.AudioContext || window.webkitAudioContext;
  if (!Contexte) return null;
  audio = new Contexte();
  sortie = audio.createGain();
  sortie.gain.value = 0.2;                         // le jeu se joue aussi en public
  sortie.connect(audio.destination);
  return audio;
}

/* Une note. L'enveloppe monte et redescend en exponentielle : une coupure franche
   s'entendrait comme un claquement. */
function note(freq, { debut = 0, duree = 0.18, forme = "triangle",
                      volume = 0.9, glisse = 0 } = {}) {
  if (!reveille()) return;
  const t = audio.currentTime + debut;
  const osc = audio.createOscillator();
  const enveloppe = audio.createGain();
  osc.type = forme;
  osc.frequency.setValueAtTime(freq, t);
  if (glisse) osc.frequency.exponentialRampToValueAtTime(freq * glisse, t + duree);
  enveloppe.gain.setValueAtTime(0.0001, t);
  enveloppe.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  osc.connect(enveloppe);
  enveloppe.connect(sortie);
  osc.start(t);
  osc.stop(t + duree + 0.03);
}

/* Un souffle : du bruit filtré dont la bande balaie le spectre. C'est ce qui fait
   entendre une masse qui passe plutôt qu'un bourdonnement. */
function souffle({ duree = 0.9, volume = 0.5, de = 300, vers = 1700 } = {}) {
  if (!reveille()) return;
  const t = audio.currentTime;
  const n = Math.floor(audio.sampleRate * duree);
  const tampon = audio.createBuffer(1, n, audio.sampleRate);
  const canal = tampon.getChannelData(0);
  for (let i = 0; i < n; i++) canal[i] = Math.random() * 2 - 1;

  const source = audio.createBufferSource();
  source.buffer = tampon;
  const filtre = audio.createBiquadFilter();
  filtre.type = "bandpass";
  filtre.Q.value = 1.2;
  filtre.frequency.setValueAtTime(de, t);
  filtre.frequency.exponentialRampToValueAtTime(vers, t + duree * 0.45);
  filtre.frequency.exponentialRampToValueAtTime(de * 0.8, t + duree);

  const enveloppe = audio.createGain();
  enveloppe.gain.setValueAtTime(0.0001, t);
  enveloppe.gain.exponentialRampToValueAtTime(volume, t + duree * 0.35);
  enveloppe.gain.exponentialRampToValueAtTime(0.0001, t + duree);

  source.connect(filtre);
  filtre.connect(enveloppe);
  enveloppe.connect(sortie);
  source.start(t);
  source.stop(t + duree);
}

/* Gamme pentatonique : n'importe quelle suite de ces degrés sonne juste, ce qui permet
   de faire monter la série sans jamais tomber sur une fausse note. */
const DEGRES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const hauteur = d => 261.63 * Math.pow(2, DEGRES[Math.min(d, DEGRES.length - 1)] / 12);

/* Bonne réponse : deux notes qui montent, d'autant plus haut que la série est longue. */
Son.juste = (serie = 0) => {
  const d = Math.min(serie, 7);
  note(hauteur(d), { duree: 0.09, volume: 0.7 });
  note(hauteur(d + 2), { debut: 0.075, duree: 0.2, volume: 0.8 });
};

/* Raté : deux notes basses qui retombent, sans agressivité. */
Son.rate = () => {
  note(196, { duree: 0.12, forme: "sawtooth", volume: 0.35 });
  note(146.8, { debut: 0.1, duree: 0.26, forme: "sawtooth", volume: 0.3 });
};

/* Le signal de fermeture des portes : deux tons qui alternent, comme sur le quai. */
Son.portes = () => {
  for (let k = 0; k < 4; k++) {
    note(k % 2 ? 660 : 880, { debut: k * 0.16, duree: 0.13, forme: "square", volume: 0.28 });
  }
};

/* La rame qui traverse l'écran au début de la partie. */
Son.rame = () => {
  souffle({ duree: 1.05, volume: 0.55, de: 260, vers: 1900 });
  note(58, { duree: 0.9, forme: "sawtooth", volume: 0.22, glisse: 1.6 });
};

/* Fin de manche : un arpège d'autant plus haut et fourni que le résultat est bon. */
Son.fin = (part = 0) => {
  const n = 3 + Math.round(part * 3);
  for (let k = 0; k < n; k++) {
    note(hauteur(Math.round(part * 3) + k), { debut: k * 0.11, duree: 0.3, volume: 0.6 });
  }
};

/* La carte gagnée : un scintillement. La chromée en reçoit un second, plus haut. */
Son.carte = (chromee = false) => {
  [0, 4, 7].forEach((d, k) =>
    note(hauteur(d + 5), { debut: 0.06 * k, duree: 0.5, forme: "sine", volume: 0.4 }));
  if (!chromee) return;
  [12, 16, 19, 24].forEach((d, k) =>
    note(hauteur(d - 5) * 2, { debut: 0.28 + 0.07 * k, duree: 0.6,
                               forme: "sine", volume: 0.3 }));
};

/* Les dernières secondes : un battement discret, une fois par seconde. */
Son.tic = () => note(1320, { duree: 0.04, forme: "square", volume: 0.12 });

/* ---------- le réglage ---------- */

const bouton = document.getElementById("son");

function affiche() {
  bouton.textContent = Son.actif ? "🔊" : "🔇";
  bouton.setAttribute("aria-label", Son.actif ? "Couper le son" : "Rétablir le son");
  bouton.classList.toggle("muet", !Son.actif);
}

try { Son.actif = localStorage.getItem(CLE) !== "0"; } catch { /* stockage indisponible */ }
affiche();

bouton.onclick = () => {
  Son.actif = !Son.actif;
  try { localStorage.setItem(CLE, Son.actif ? "1" : "0"); } catch { /* ignoré */ }
  affiche();
  if (Son.actif) Son.juste(2);                     // on entend tout de suite ce qu'on rallume
};

window.Son = Son;

})();
