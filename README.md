# Métro de Paris

Une carte blanche de Paris, ses seize lignes de métro et ses 321 stations — et un jeu qui
demande de savoir où elles sont. Aucune dépendance : un canvas, trois fichiers, des données
ouvertes d'Île-de-France Mobilités.

## Lancer le site

```bash
python3 -m http.server 8321
```

Puis ouvrir <http://localhost:8321>. Un serveur est nécessaire : les données sont chargées
par `fetch`, que le protocole `file://` refuse.

## Ce que montre la carte

- Les **limites administratives de Paris**, bois de Boulogne et de Vincennes compris.
- Les **16 lignes** (1 à 14, 3bis, 7bis) avec leurs tracés et couleurs officiels.
- Les **321 stations**, en pastilles blanches ; celles où plusieurs lignes se croisent sont
  plus grandes et cerclées de noir, selon la convention des plans de métro.
- Survoler un tracé le fait passer en couleur pleine et l'épaissit tandis que le reste du
  réseau s'estompe ; ses stations deviennent de larges pastilles cerclées de sa couleur.
  Survoler une station donne son nom et ses lignes.
- Un clic sur un tracé isole la ligne et ouvre sa fiche : stations, longueur, temps de
  parcours, vitesse commerciale, rames en circulation, intervalle entre deux départs à
  l'heure qu'il est, amplitude de service, courses du jour. Un clic à côté revient au
  réseau entier.
- Molette ou pincement à deux doigts pour zoomer, glisser pour déplacer, double-clic pour
  zoomer d'un cran, `f` pour recadrer.

## La chasse aux stations

Le bouton **Jouer** lance une manche de douze questions, noms de stations masqués. Il y a
douze formes de questions : une manche les pose donc toutes, une fois chacune, dans un
ordre entièrement rebattu à chaque partie.

| Question | Ce qu'elle demande | Comment on répond |
|---|---|---|
| *Trouve Corvisart* | situer une station sur le réseau entier | clic sur la carte |
| *Trouve 3 stations dans le 11e* | savoir où commence et finit un arrondissement | clic sur la carte |
| *Touche la ligne de cette couleur* | reconnaître une teinte — le réseau est en noir | clic sur un tracé |
| *Situe Dupleix* | placer une station, la ligne seule étant affichée | clic sur la carte |
| *Reconnais les stations de la ligne 13* | trier le vrai du faux | trois propositions |
| *Cite 3 arrondissements où la 6 s'arrête* | connaître le tracé administratif | saisie du numéro |
| *Cite 2 stations qui portent un nom d'écrivain* | jouer avec les noms eux-mêmes | saisie du nom |
| *Touche la station qui suit Bastille vers La Défense* | connaître l'ordre des stations, pas seulement leur position | clic sur la carte |
| *Laquelle n'est pas sur la ligne 3 ?* | reconnaître une intruse, choisie parmi les voisines du tracé | trois propositions |
| *Pour aller à Alésia, quelle ligne prendre ?* | rattacher une station à sa ligne | trois pastilles de ligne |
| *Laquelle n'est pas dans Paris ?* | savoir où s'arrête la ville | trois propositions |
| *Trouve la paire de stations la plus éloignée* | jauger des distances à vue | trois paires |

Les questions portant sur une ligne recadrent la carte sur elle, sans les noms, avant de
revenir au réseau entier. Pendant une partie, **toutes les stations sont dessinées à
l'identique** : la carte au repos grossit les correspondances, ce qui donnerait trop
d'indices en jeu.

**L'ordre est tiré au sort, la difficulté monte quand même.** Les formes de questions ne
sont pas classées : seule la première est choisie parmi les plus accessibles, pour ouvrir
en douceur, et le reste est mélangé. La progression ne vient donc
pas de l'ordre des types, mais de ce qu'on tire **à l'intérieur** de chacun : une fenêtre
glissante descend un classement de difficulté au fil des questions.

| Ce qui est tiré | Classé par |
|---|---|
| stations | passages quotidiens — les plus fréquentées d'abord |
| arrondissements | nombre de stations, donc à peu près la surface |
| couleurs | écart chromatique avec les autres lignes du réseau |
| thèmes de noms | nombre de réponses possibles |
| lignes (arrondissements) | nombre d'arrondissements à citer |
| intruses | proximité au tracé — une station voisine trompe bien mieux qu'une lointaine |
| lignes proposées | proximité à la station demandée, pour que le choix ne soit pas évident |
| stations de banlieue | éloignement de Paris — l'aéroport d'Orly d'abord, Mairie de Montrouge pour finir |
| paires de stations | écart entre la plus longue et sa suivante : 60 % en début de manche, 94 % à la fin |

Aucun de ces classements ne relève de l'opinion : ils sortent tous des données.

On n'en demande jamais trop : sur une ligne qui dessert sept arrondissements, trois
suffisent, et les autres sont montrés à la correction sans compter pour des fautes.

La visée est indulgente : jusqu'à seize pixels de la cible, le score reste plein, et la
tolérance suit le zoom pour qu'une réponse demande le même effort de près comme de loin.
À la correction, **la zone de tolérance s'affiche** autour de la station : on voit de
combien il s'en est fallu. Chaque question est chronométrée, la barre du bandeau s'y vide,
et une rangée de pastilles récapitule la manche question par question.

Le passage d'une question à l'autre est animé : le bandeau rejoue son entrée, le total
grimpe vers sa nouvelle valeur plutôt que d'y sauter, la pastille de progression se gonfle
en se colorant, et les repères de la correction éclosent sur la carte.

En fin de manche, un titre est décerné selon la part de bonnes réponses — de **Titi
parisien** à **Touriste**, en passant par le Poinçonneur des Lilas. Le score, lui, tient
compte en plus de la rapidité. Le record tient dans le stockage local du navigateur.

Les devinettes de noms ne sont jamais écrites à la main : chaque thème est confronté aux
noms réels du réseau au chargement, et les thèmes qui manquent de réponses sont écartés.
Une réponse est acceptée aux accents, tirets et fautes de frappe près.

## D'où viennent les données

Tout vient du **GTFS d'Île-de-France Mobilités** : les tracés, les stations, et les
horaires de chaque course à chaque quai, à la seconde près. Ces horaires ne servent plus à
animer la carte, mais ils portent encore deux choses :

- **la fiche de chaque ligne** — nombre de rames en circulation à l'instant présent,
  intervalle médian entre deux départs à cette heure, amplitude de service, temps de
  parcours bout en bout, vitesse commerciale ;
- **la difficulté du jeu** — la notoriété d'une station est mesurée par le nombre de
  passages quotidiens qu'elle voit, correspondances comprises. C'est un fait, pas un avis.

Il n'existe pas de flux ouvert donnant la position GPS des rames de métro : Île-de-France
Mobilités publie des heures de passage par station (SIRI Lite `stop-monitoring`,
`estimated-timetable`), pas de `VehiclePositions`. Une carte animée en temps réel
supposerait donc d'interpoler les positions entre deux arrêts à partir de ces horaires
estimés, via un service qui interroge la plateforme [PRIM](https://prim.iledefrance-mobilites.fr/)
et met en cache — la clé API ne peut pas vivre dans le navigateur.

## Régénérer les données

```bash
curl -o IDFM-gtfs.zip https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip
python3 tools/build_data.py IDFM-gtfs.zip
python3 tools/fetch_paris.py
```

Le GTFS complet fait environ 135 Mo (dont un `stop_times.txt` de près d'un gigaoctet) et
couvre tout le réseau francilien. Le premier script en extrait le métro, le second ajoute
les limites de la ville et rattache chaque station à son arrondissement. Ils produisent
dans `data/` :

| Fichier | Contenu | Taille |
|---|---|---|
| `network.json` | lignes, tracés encodés en polyligne, 321 stations, 122 patterns | 112 Ko |
| `day-0.json` … `day-6.json` | courses d'un jour de semaine (0 = lundi) | 130 à 220 Ko |
| `paris.json` | contour de la commune, 20 arrondissements, rattachement des stations | 17 Ko |

Le navigateur charge le jour courant **et** la veille, pour que les courses qui se
terminent après minuit soient comptées.

La compacité vient de deux mutualisations : les *patterns* (un tracé et une séquence
d'arrêts, partagés par des milliers de courses) et les *profils horaires* (les 11 000
courses d'un jour ouvré se ramènent à 296 profils de temps de parcours distincts). Une
course ne pèse alors que trois entiers : pattern, profil, heure de départ.

Le jeu de données GTFS couvre environ un mois. Passé cette période, il faut le régénérer.

## Publier

Le site est entièrement statique : aucun serveur, aucune base, aucune clé. N'importe quel
hébergement de fichiers convient, et l'offre gratuite de tous suffit largement — une visite
télécharge 660 Ko, soit **196 Ko une fois compressés**, et le dépôt entier pèse 1,6 Mo.

Le plus direct, sans rien installer :

```bash
npx wrangler pages deploy . --project-name=metro-paris
```

Sur GitHub Pages, deux actions sont déjà écrites :

| Fichier | Rôle |
|---|---|
| `.github/workflows/deploy.yml` | publie le dépôt tel quel à chaque poussée sur `main` |
| `.github/workflows/donnees.yml` | le 1er et le 15 de chaque mois, retélécharge le GTFS, régénère `data/` et pousse si quelque chose a changé |

La seconde règle le seul vrai problème d'un tel site : **le GTFS ne couvre qu'un mois
glissant**. Passé sa période de validité, la carte et le jeu continuent de fonctionner, mais
les fiches de ligne donnent des horaires périmés. Le rafraîchissement automatique referme
la question, sans intervention et sans coût.

## Fichiers

| | |
|---|---|
| `index.html` | structure de la page |
| `style.css` | mise en forme |
| `app.js` | projection, décodage des tracés, rendu de la carte, interactions, fiches de ligne |
| `game.js` | la chasse aux stations : questions, notation, titres |
| `tools/build_data.py` | extraction du GTFS vers `data/` |
| `tools/fetch_paris.py` | limites de la ville, arrondissements, rattachement des stations |

## Données

Horaires et tracés : Île-de-France Mobilités, données ouvertes, via
[prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr/).

Limites de Paris : API Découpage administratif (Etalab), commune 75056, via
[geo.api.gouv.fr](https://geo.api.gouv.fr/).

Arrondissements : [Paris Open Data](https://opendata.paris.fr/).
