# Les sondes d'`inspect.mjs` — ce que chaque famille mesure, et quand elle se trompe

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans git.

`inspect.mjs` rend toujours un **socle**, et n'ajoute une **famille** de sondes que si on la
demande (`NF_BROWSER_FAMILIES=a11y,perf`, ou `toutes`). Un nom de famille inconnu est **refusé**
(code 64), jamais ignoré : une famille fautée en silence ferait croire qu'on a mesuré ce qu'on n'a
pas mesuré.

Chaque famille rend un **`verdict`** (`OK` / `ALERTE`) et des données bornées (comptes + 3
exemples, jamais l'inventaire). Le champ `verdict` de fin de sortie agrège les familles actives —
`OK` seulement si tout est OK. **Le code de retour reste 0** : le verdict est une donnée, pas une
panne de la sonde. Les codes non nuls disent autre chose — 64 : usage (famille inconnue,
identifiant sans chemin de connexion) ; 65 : le texte attendu n'est jamais apparu.

## Le socle — toujours rendu

<!-- prettier-ignore -->
| Champ | Ce que c'est |
| --- | --- |
| `url` | La page RÉELLEMENT ouverte — à comparer à celle demandée (redirection de connexion, 404 SPA). |
| `theme` / `lang` | `color-scheme` **calculé** (ce que le moteur applique) et attribut `lang` de la racine. |
| `titre` | `document.title`. |
| `scripts` | Les scripts RÉELLEMENT servis — pour vérifier qu'on observe bien le bundle qu'on vient de bâtir. |
| `sondes` | Les sondes de style (voir ci-dessous). |
| `violationsCSP` | Les violations de Content-Security-Policy vues PAR la page — le réseau montre l'absence, jamais la raison. |
| `erreursConsole` | Les `console.error` émis pendant la mesure. |
| `erreursNonCapturees` | Les exceptions non capturées (`pageerror`) — elles ne passent pas toutes par la console. |
| `capture` | Le PNG horodaté déposé dans le volume monté. |

Les erreurs de console et les violations CSP **ne pèsent pas** dans le verdict global : un parcours
de connexion produit des `401` légitimes, et les trancher ici les ferait passer pour des pannes.
C'est au lecteur de juger — la sonde fournit, elle ne condamne pas ce qu'elle ne peut pas qualifier.

## Les sondes de style (`sondes`) — le contraste CALCULÉ

Un sélecteur par élément (`NF_BROWSER_PROBES=libellé=sélecteur,…`) ; pour chacun : texte, couleur,
fond effectif, rapport de contraste, police, verdict WCAG, taille rendue.

- **Le fond effectif empile TOUTES les couches** jusqu'au premier ancêtre opaque, puis les compose.
  Deux erreurs à ne pas refaire : lire `backgroundColor` sur l'élément rend `rgba(0,0,0,0)` et un
  contraste faux ; s'arrêter à la première couche non transparente traite un voile à 13 % comme un
  aplat plein, c'est-à-dire comme une couleur que personne ne voit.
- **Les couleurs modernes ne comptent pas dans la même échelle.** `rgb(0, 87, 156)` est en 0–255,
  `color(srgb 0 0.34 0.61 / 0.13)` en 0–1. Les lire avec la même expression régulière rend un bleu
  presque noir — et fabrique des échecs qui noient les vrais.
- **Le verdict WCAG dépend de la POLICE** : 3:1 suffit à un texte « large » (≥ 24 px, ou 18,66 px
  en gras), 4,5:1 sinon. Un contraste rendu sans sa police ne conclut rien.
- **Quand elle se trompe** : un fond en dégradé ou une image de fond ne sont pas vus — la sonde lit
  des COULEURS, pas le pixel composité. Sur ces cas, juger sur la capture.

> Ces sondes visent **un** élément qu'on désigne. Pour balayer la page entière sans rien désigner,
> prendre la famille `axe` : elle voit ce à quoi on ne pensait pas.

## `axe` — l'audit WCAG par un moteur dont c'est le métier

Une centaine de règles jouées par `axe-core`, dont le contraste de **tout** le texte visible. C'est
le moteur qu'embarque Lighthouse pour son volet accessibilité.

<!-- prettier-ignore -->
| Champ | Ce qu'il dit |
| --- | --- |
| `manquements` | Les défauts AVÉRÉS, comptés par gravité (critique, sérieux, modéré, mineur) |
| `plusGraves` | Jusqu'à 8 règles, du plus grave au moins grave, avec **5 cibles** chacune et le `constat` calculé (contraste mesuré, rôle attendu) |
| `autresCibles` | Ce qui dépasse les 5 — annoncé, jamais tronqué en silence |
| `aVerifier` | Ce que le moteur REFUSE de trancher (fond en image…) — **pas** des défauts |
| `conformes` | Les règles passées, pour situer le reste |

- **`aVerifier` n'est pas un manquement** et ne déclenche pas l'alerte. Le confondre ferait crier la
  sonde sur des pages saines, et on cesserait de la lire.
- **Cinq cibles par règle, pas une.** Une même règle couvre des défauts à des endroits différents,
  qui ne se corrigent pas d'un seul geste ; n'en montrer qu'un fait croire le travail fini.
- **N'écris jamais ce calcul toi-même.** Mesuré en conditions réelles : une sonde maison a rendu
  **41 faux positifs** masquant **7 défauts réels**, dont celui qu'on cherchait — à cause de trois
  cas particuliers (échelle des couleurs modernes, alpha non composé, emoji peints par une police en
  couleurs) qu'on ne devine pas avant de les avoir vus.
- **Quand elle est indisponible** : `axe-core` vit dans les dépendances du projet. En conteneur, il
  faut le copier à part. La famille rend alors `verdict: "INDISPONIBLE"` et la commande à taper —
  jamais un `OK` qui n'a rien mesuré.

## `a11y` — ce qu'un lecteur d'écran ou un clavier rencontrent

| Champ                   | Question à laquelle il répond                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `langue`                | La racine annonce-t-elle sa langue (sans elle, la synthèse vocale lit avec le mauvais accent) ?                             |
| `titres`                | Un seul `h1` ? Des sauts de niveau (`h2→h4`) qui cassent la table des matières ?                                            |
| `imagesSansAlternative` | Des images sans attribut `alt` — muettes pour un lecteur d'écran.                                                           |
| `champsSansEtiquette`   | Des champs sans étiquette (label, `aria-label`, `aria-labelledby`, `title`).                                                |
| `controlesSansNom`      | Boutons et liens sans nom accessible — le bouton-icône muet, le cas réel.                                                   |
| `ciblesTropPetites`     | Cibles interactives < 24×24 px ; les liens DANS le texte sont exemptés, comme dans le critère.                              |
| `tabindexPositifs`      | Un `tabindex` positif impose un ordre de focus manuel qui diverge du DOM — l'anti-pattern du parcours clavier.              |
| `focusablesVisibles`    | L'ampleur du parcours clavier de la page.                                                                                   |
| `arbre`                 | L'arbre d'accessibilité (rôles + noms), tel que le calcule le navigateur — tronqué : il dit la STRUCTURE, pas l'inventaire. |

**Quand elle se trompe** : le nom accessible est calculé de façon SIMPLIFIÉE (l'algorithme complet
de la norme fait plus) — un composant qui pose son nom par un mécanisme exotique peut être compté
« sans nom » à tort ; vérifier dans `arbre`, qui lui applique le calcul complet du navigateur.
Et une sonde automatique ne couvre qu'une fraction de l'accessibilité : elle attrape le mesurable
(étiquettes, tailles, structure), jamais le sens — l'ordre logique d'un formulaire ou la pertinence
d'un `alt` restent un jugement humain.

## `rendu` — la page tient-elle dans son viewport, ses polices sont-elles là

- `debordementHorizontal` : la page dépasse-t-elle la largeur de la fenêtre (le défilement
  horizontal accidentel). C'est LUI qui porte le verdict.
- `elementsHorsViewport` : une **information**, pas un verdict — carrousels, tiroirs et textes
  destinés aux lecteurs d'écran sortent du viewport légitimement.
- `polices` : ce que `document.fonts` a RÉELLEMENT chargé (statut par famille + graisse). Une
  police en échec bascule le verdict — le texte s'affiche alors dans une police de repli, et toutes
  les mesures de taille en héritent.

**Quand elle se trompe** : la mesure attend `document.fonts.ready` au plus 2 s — une police servie
très lentement peut encore être `loading` au moment de la lecture, sans être en échec.

## `reseau` — requêtes, échecs, poids, temps

Compte par type, octets réellement transférés, échecs (statut ≥ 400 et requêtes avortées),
ressources **lourdes** (> `NF_BROWSER_SEUIL_LOURD`, défaut 512 000 octets) et **lentes**
(> `NF_BROWSER_SEUIL_LENT`, défaut 1 000 ms). Verdict : ALERTE dès un échec ou une ressource lourde.

**Quand elle se trompe** :

- En développement, un serveur d'assets qui livre les modules UN PAR UN rend des centaines de
  requêtes et des mégaoctets non minifiés : c'est le DÉCOR du mode dev, pas une régression. Les
  seuils jugent une application SERVIE — comparer dev et prod n'a pas de sens.
- Les tailles viennent du transfert réel quand le navigateur les donne, de `content-length` sinon ;
  `octetsInconnus` compte ce qui n'a pu être pesé — un total avec beaucoup d'inconnus minore.
- La collecte s'arrête à la mesure : ce que la page télécharge APRÈS (interaction, différé) n'est
  pas vu — c'est le travail de `watch.mjs`.

## `perf` — temps de rendu et stabilité visuelle

`ttfbMs`, `domContentLoadedMs`, `chargeCompleteMs`, `fcpMs`, `lcpMs`, `cls`, `tachesLongues` —
verdict sur les seuils « bons » des Web Vitals : LCP ≤ 2 500 ms, CLS ≤ 0,1.

**Quand elle se trompe** :

- **Une seule visite n'est pas une statistique.** Cache froid ou chaud, machine chargée, premier
  boot d'un serveur de dev : la même page varie du simple au double. Un verdict ALERTE isolé se
  vérifie en relançant ; une tendance se mesure en médiane de plusieurs passes.
- LCP et CLS sont observés PENDANT le chargement (observateurs injectés avant la navigation) : la
  sonde ne voit pas les décalages provoqués ENSUITE par une interaction.
- Le CLS d'une application en mode développement (styles injectés à la volée) est structurellement
  plus mauvais qu'en production.

## `stockage` — cookies et Web Storage

Attributs des cookies (`secure`, `httpOnly`, `sameSite`, expiration) et inventaire du
`localStorage`/`sessionStorage` (clés, octets, les 5 plus grosses). **Jamais les valeurs** : un
jeton de session imprimé dans une sortie de sonde finit dans un terminal, un log de CI, un rapport
— il a fuité. Verdict : ALERTE si un cookie sans `secure` circule sur une origine https.

**Quand elle se trompe** : les octets du Web Storage comptent en unités UTF-16 (×2) — c'est
l'empreinte mémoire, pas la taille « à l'écran » ; et un cookie `httpOnly: false` n'est pas signalé
comme alerte alors qu'il mérite un regard si sa valeur est sensible.

## `responsive` — la même page à plusieurs largeurs

Rejoue la mesure de débordement horizontal à chaque largeur de `NF_BROWSER_WIDTHS` (défaut
`360,768,1280`). Par largeur : dépassement en pixels, nombre d'éléments débordants, 3 exemples.

**Quand elle se trompe** : redimensionner un viewport n'est pas changer d'appareil — ni densité de
pixels, ni tactile, ni `user-agent`. Une media query sur `pointer` ou `hover` ne réagira pas. Et la
capture PNG est prise AVANT cette famille, à la largeur d'origine : les débordements constatés ici
ne s'y voient pas.

## Lire un verdict sans se faire piéger

1. **`ALERTE` n'est pas « cassé »** — c'est « mérite un regard ». Le détail dit lequel.
2. **`OK` n'est pas « accessible / rapide / propre »** — c'est « rien de mesurable à signaler dans
   cette famille, sur cette page, à cet instant ».
3. **Une mesure en mode développement juge le mode développement.** Poids, nombre de requêtes et
   CLS ne se comparent qu'à décor égal.
4. **Le verdict global agrège, il n'explique pas.** Toujours descendre dans la famille qui l'a fait
   basculer.
