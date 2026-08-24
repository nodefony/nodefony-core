---
name: nodefony-html-report
description: >
  Fabrique des rapports HTML autonomes (zéro CDN) pour des humains qui doivent DÉCIDER — audits,
  bancs de performance, revues, dashboards figés. Deux moteurs de figures : `lib/report.mjs`
  (tableaux triables et filtrables, calculateurs interactifs, onglets, export CSV, impression PDF
  soignée) et `lib/echarts.mjs`, qui rend CÔTÉ SERVEUR en SVG statique — sans un octet de
  JavaScript servi, en thème clair ET sombre — barres avec étendue, courbes à deux axes alignés,
  nuages, boîtes à moustaches, Sankey, radars, cartes de chaleur, arbres pondérés, entonnoirs,
  cascades, jauges, graphes de relations. `lib/schemas.mjs` dessine les organigrammes et diagrammes
  de séquence mermaid sans toucher à leur source. Déclencheurs : "rapport HTML", "rapport
  imprimable", "dashboard statique", "restituer des mesures", "quel graphe choisir", "diagramme de
  Sankey", "boîtes à moustaches", "deux axes", "échelle d'un graphe", "rendre un schéma mermaid",
  "calculateur interactif", "deck de présentation", "export CSV".
---

# nodefony-html-report

> **Maintenance** : ce fichier décrit la vérité COURANTE. Éditer en place, jamais de journal daté
> (l'historique = `git log`). Une leçon durable se fond en RÈGLE ici ou dans `references/`.

Fabrique des **rapports HTML autonomes**. Le livrable est un fichier `.html` unique — pas de CDN, pas
de `node_modules`, pas de serveur : il survit à un partage de fichiers, une pièce jointe, un artefact
de CI, une clé USB.

## Quand l'utiliser — et quand NE PAS

| Le livrable doit…                                               | Format   |
| --------------------------------------------------------------- | -------- |
| aider quelqu'un à **décider** (chiffres à manipuler, scénarios) | **HTML** |
| être **imprimé**, joint à un dossier, présenté en réunion       | **HTML** |
| montrer des **graphes**, une matrice, une timeline              | **HTML** |
| être **versionné** et relu en diff (`git log -p`)               | Markdown |
| être **réinjecté dans un LLM** comme contexte                   | Markdown |
| documenter le code pour les prochains développeurs              | Markdown |

> Le HTML gagne quand un **humain** est au bout ; le Markdown gagne quand un **outil** est au bout.
> Un rapport de mesures n'est pas de la documentation : il photographie un instant, il ne se maintient
> pas. Ne le commitez pas dans `docs/` — écrivez-le dans `tmp/` ou joignez-le à la sortie.

## Règle d'or

**Un rapport n'est pas une restitution, c'est une aide à la décision.** Avant d'écrire une ligne,
répondez : _quelle décision cette page doit-elle permettre de prendre ?_ Tout ce qui n'y contribue pas
est du remplissage — et le remplissage fait perdre le lecteur avant le chiffre qui compte.

## Processus (5 étapes)

1. **Nommer la décision.** « Combien de pods ? » « Faut-il migrer ? » « Où est la fuite ? ». Elle donne
   le titre et le sous-titre.
2. **Écrire la conclusion EN PREMIER** (BLUF). Les cartes de chiffres-clés en haut, la preuve dessous.
   Un lecteur pressé doit repartir avec la réponse après 10 secondes.
3. **Construire avec la bibliothèque** — `import { doc, section, cards, table, barChart… } from
".claude/skills/nodefony-html-report/lib/report.mjs"`. **Ne recopiez jamais ces fonctions** dans un
   script : importez-les (deux implémentations d'une même règle = dérive garantie).
4. **Passer la checklist qualité** (ci-dessous). Elle n'est pas décorative : c'est elle qui sépare une
   page HTML d'un rapport.
5. **Datter la provenance** en pied : commande exacte, date, version, environnement. Un rapport qu'on
   ne peut pas **rejouer** ne prouve rien.

## La bibliothèque — `lib/report.mjs`

Toutes les fonctions sont **pures** (elles rendent des `string` HTML) et **autonomes** (markup +
comportement + style).

<!-- prettier-ignore -->
| Bloc | Fonction |
| --- | --- |
| Document complet (CSS, thème, impression, tri) | `doc({ title, subtitle, sections, footer })` |
| Section (contrôle du saut de page) | `section(titre, corps, { break: "avoid\|before\|auto" })` |
| Chiffres-clés | `cards([{ k, v, unit, sub }])` |
| Tableau (triable au clic, en-tête répété à l'impression) | `table(cols, rows, { sortable, id })` |
| Filtre plein-texte sur un tableau | `tableFilter(tableId)` |
| Export CSV (RFC 4180, BOM UTF-8) | `csvExport(tableId, "fichier.csv")` |
| Barres comparatives (échelle log possible) | `barChart(rows, { unit, logScale })` |
| Courbes | `lineChart(series)` |
| Nuage de points + droite de régression | `scatterFit(series)` |
| Waterfall (phases, pipeline) | `waterfall(bars)` |
| Heatmap (matrice) | `heatmap(rows, cols, values)` |
| Jauge (saturation, score) | `gauge(ratio, { label, warn, danger })` |
| Donut (répartition) | `donut(parts)` |
| Sparkline (tendance en ligne) | `sparkline(values)` |
| **Calculateur interactif** | `calculator({ inputs, constants, compute })` |
| **Liste réordonnable (glisser-déposer + clavier)** | `sortableList(items)` |
| Onglets (ARIA, dépliés à l'impression) | `tabs(items)` |
| Bloc repliable natif | `details(résumé, corps)` |
| Mode présentation (plein écran, ←/→) | `deckControls()` |
| Impression | `printButton()` |
| Avertissement / note | `warn(html)` · `note(html)` |
| **Marque (logo en en-tête et en pied)** | `doc({ brand })` — défaut `NODEFONY_BRAND` |
| Formatage FR + palette | `fmt.int/dec/pct/bytes/ms` · `COLORS` · `series(i)` |

### Formes de données (cheat-sheet — évite de relire `lib/report.mjs`)

Vérifiées au source ; en cas de doute, le source fait foi.

- `cards([{ k, v, unit?, sub? }])` — `v` arrive déjà formaté (string/HTML).
- `table(cols, rows, { sortable?, id? })` — `cols: [{ label, align?: "right", strong?, dim? }]`,
  `rows: string[][]` (cellules HTML autorisées, échapper soi-même les données externes).
- `barChart([{ label, value, color?, note? }], { unit?, logScale?, fmt?, title?, desc? })` —
  barres toujours depuis zéro (pas d'option contraire).
- `lineChart([{ label, color, points: [{ x, y }] }], { xLabel?, yLabel? })` ·
  `scatterFit` = même forme + `fit(x)` par série.
- `waterfall([{ label, start, duration, color? }])` — durées rendues en `fmt.ms`.
- `heatmap(rows, cols, values, { cell?, color? })` · `donut([{ label, value, color? }])` ·
  `gauge(ratio, { label?, warn: 0.7, danger: 0.85 })` · `sparkline(number[])`.
- `calculator({ id, inputs: [{ id, label, value, min?, step?, type?: "checkbox" }], constants, compute })`
  — ⚠️ `compute` est une **STRING** de JS injectée telle quelle : `(v, K) => ({ html, alerts?: string[] })`
  (`v` = valeurs des champs par id, `K` = `constants`).
- `doc({ title, subtitle?, sections, footer?, data?, brand? })` — `data` = objet embarqué en JSON
  dans la page (c'est lui qui rend le rapport rejouable/ré-ingérable).
- `COLORS` : `accent/blue · vermillion/red · green · pink/magenta/purple · amber · skyblue ·
yellow · grey` — **pas de `muted`** (une clé absente rend `undefined` → barre invisible, sans
  erreur). `series(i)` = palette cyclique sûre.
- `fmt.int · dec(x, n) · pct(ratio) · bytes · ms` — rendent `—` sur `null`/`NaN`.

Squelette minimal :

```js
import { doc, section, cards, table, barChart, fmt } from "./lib/report.mjs";
import { writeFileSync } from "node:fs";

const html = doc({
  title: "Ce que la page doit faire décider",
  subtitle: "La conclusion, en une phrase.",
  sections: [
    section(
      "Chiffres-clés",
      cards([{ k: "Débit", v: fmt.int(9430), unit: "msg/s" }]),
    ),
    section(
      "Détail",
      table([{ label: "Route" }, { label: "p99", align: "right" }], rows, {
        sortable: true,
      }),
    ),
  ],
  footer: `Généré par <code>node banc.mjs</code> — ${new Date().toISOString().slice(0, 16)}`,
});
writeFileSync("tmp/rapport.html", html);
```

## Le moteur de graphes — `lib/echarts.mjs`

Les figures de `report.mjs` sont dessinées à la main : elles restent parfaites pour une barre ou une
courbe dans un banc. Dès qu'il faut un flux, une distribution, une hiérarchie ou un radar, c'est ce
moteur — **Apache ECharts (Apache-2.0) rendu CÔTÉ SERVEUR** : `renderToSVGString()` produit du SVG
que le lecteur reçoit tel quel. Aucun JavaScript n'est servi, la figure est nette à tout zoom et à
l'impression, rien ne se charge. En échange, **aucune interaction** : ce que le graphe doit dire, il
doit le dire sans qu'on le touche.

> `echarts` est une **devDependency du dépôt**. Aucun paquet publié ne l'importe : elle ne pèse rien
> pour qui installe Nodefony. Absente, le moteur dit quelle commande taper (`npm i -D echarts`) au
> lieu d'un « module introuvable ».

### Choisir la famille

<!-- prettier-ignore -->
| La question du lecteur | Famille |
| --- | --- |
| « lequel est le plus grand ? » | `bars({ series, horizontal, empile })` |
| « …et cette mesure est-elle fiable ? » | `barsEtendue({ data })` — médiane **+ min/max** |
| « comment est-ce distribué ? » | `boxplot({ data })` |
| « comment cela évolue-t-il ? » | `lines({ series, aire, log })` |
| « ces deux grandeurs bougent-elles ensemble ? » (unités différentes) | `lines()` + `droite: true` sur une série |
| « quel est le compromis entre deux dimensions ? » | `scatter({ points })` |
| « où part le flux ? » | `sankey({ noeuds, liens })` |
| « de quoi est-ce composé ? » | `pie({ parts, anneau })` · `treemap({ racine })` |
| « où en est-on par rapport au seuil ? » | `gauge({ valeur, min, max, zones })` |
| « qui dépend de qui ? » | `reseau({ noeuds, liens })` |
| « combien reste-t-il à chaque étape ? » | `funnel({ etapes })` |
| « d'où vient l'écart ? » | `cascade({ postes })` |
| « quel profil sur plusieurs critères ? » | `radar({ axes, series })` |
| « quelle intensité sur deux axes discrets ? » | `heatmap({ x, y, cellules })` |

Besoin d'un type non couvert (bougies, sunburst, calendrier, coordonnées parallèles) :
`rendre(option, { largeur, hauteur, theme, titre })` prend une option ECharts brute — thème et
accessibilité appliqués, mais **la mise en page est alors à ta charge**.

### 🔴 L'échelle est une décision, jamais un défaut

`echelle(valeurs, { compareDesLongueurs, placePourEtiquettes })` est appliqué par les familles, et
c'est lui qui décide :

- **des barres se comparent par leur LONGUEUR** → l'axe garde le zéro. Le couper transforme
  visuellement 3 % d'écart en doublement : ce n'est pas une préférence, c'est de la probité.
- **un nuage ou des boîtes se comparent par leur POSITION** → imposer le zéro les écrase dans un
  coin ; l'axe se recentre sur les données.
- des valeurs **entières** gardent des graduations entières ; une série **constante** reçoit une
  étendue lisible ; la place des étiquettes se réserve par `dataMax`, qui préserve les graduations
  rondes là où `max` les fige.

`hauteurPour(nbCategories)` dérive la hauteur du contenu : vingt catégories dans une hauteur fixe
donnent des barres de six pixels et des étiquettes qu'ECharts masque **en silence**.

### Le couple clair/sombre

Un SVG porte ses couleurs en dur : il ne peut pas suivre le thème du lecteur. D'où deux rendus et un
basculement en CSS pur.

```js
import { couple, bars, figure, STYLE_GRAPHES } from "./lib/echarts.mjs";

const svgs = couple(bars, {
  titre: "Débit",
  axeValeur: "req/s",
  series,
  horizontal: true,
});
const html = figure(svgs, {
  titre: "Débit par camp",
  desc: "médiane de 3 tirs",
});
// une seule fois dans la page :
doc({ title, sections, style: STYLE_GRAPHES });
```

### Migrer un rapport existant — un seul import

`lib/report-echarts.mjs` offre `barChart`, `lineChart`, `donut` et `gauge` avec **la signature de
`report.mjs`**. Migrer une page revient à changer la ligne d'import : les appels ne sont pas touchés,
donc aucune occasion d'intervertir deux séries — une erreur qu'aucun test ne rattraperait, puisque le
résultat reste une figure plausible.

## Les schémas mermaid — `lib/schemas.mjs`

Organigrammes et diagrammes de séquence, rendus à la charte **depuis leur source mermaid, qui ne
bouge pas** : la console d'administration, les agents et l'affichage de GitHub continuent de la lire.

```js
import { schema } from "./lib/schemas.mjs";
const svg = schema({
  source: blocMermaid,
  titre: "Pipeline de sécurité",
  theme: "clair",
});
```

`schema()` reconnaît le type et route vers `organigramme()` ou `sequence()` ; un type non couvert
rend la source encadrée plutôt qu'un dessin faux. Le placement en couches (`placerEnCouches`) est
calculé ici — rang par plus long chemin, croisements réduits au barycentre — et le tracé aussi : le
type `graph` d'ECharts relie les CENTRES des nœuds et fait pivoter les étiquettes le long du trait,
ce qui est juste pour un réseau et faux pour un organigramme.

> Un schéma **DÉFILE**, il ne se réduit pas : l'enveloppe utilise `.schema-zone` (dans
> `STYLE_GRAPHES`), sans quoi ses libellés deviennent illisibles dans une colonne étroite.

## Éprouver le moteur

```bash
node .claude/skills/nodefony-html-report/scripts/echarts.selftest.mjs   # 14 familles, échelles, deux axes
node .claude/skills/nodefony-html-report/scripts/formats.selftest.mjs   # nombres français ET tri des tableaux
```

Le second garde un défaut précis fermé : le point décimal anglais n'était resté dans `fmt.dec` que
parce que le tri relisait le texte affiché en effaçant tout sauf chiffres et points — « 4,66 » y
devenait 466, et la colonne se triait à l'envers sans un message. **Les deux ne se corrigent jamais
l'un sans l'autre** ; `nombreDepuisTexte` est l'unique implémentation, exportée pour les tests et
sérialisée dans le script envoyé au navigateur.

## La marque (logo)

Par défaut, tout rapport porte la marque **Nodefony** : logo + nom + accroche en en-tête, logo en
pied à côté de la provenance. C'est le premier et le dernier chose que voit quelqu'un qui rouvre un
PDF six mois plus tard — d'où le rappel en bas, collé à la commande et à la date.

- **Le logo est lu à sa source** (`NodefonyLogo.tsx`, le composant de Studio), jamais recopié : deux
  copies d'un même asset finissent toujours par diverger, et les rapports porteraient l'ancien logo
  pendant des mois sans que personne ne le remarque. Si la source devient introuvable, `brand.mjs`
  bascule sur un logo de secours **et l'annonce dans la console** — il ne rend jamais un rapport sans
  marque en silence.
- **C'est un data-URI**, donc le rapport reste autonome hors ligne (aucune requête réseau).
- **Il survit à l'impression** : `print-color-adjust: exact` empêche le navigateur de le vider de ses
  couleurs pour économiser l'encre. Un PDF sans en-tête ne dit pas d'où il vient.

Le skill étant **générique**, tout se surcharge :

```js
doc({ brand: { name: "Acme", logo: "data:image/…", tagline: "…" } }); // autre marque
doc({ brand: null }); // document neutre
```

## Checklist qualité (à passer AVANT de livrer)

- [ ] **Autonome** — aucun `http(s)://` dans le fichier (ni police, ni script, ni image). Vérifier :
      `grep -c "https\?://" rapport.html` doit ne matcher que des liens de texte, jamais un `src`/`href`
      de ressource.
- [ ] **Échappé** — toute donnée passe par `esc()`. Un rapport affiche des chaînes qu'il ne contrôle
      pas (noms de routes, messages d'erreur, entrées utilisateur) : sans échappement, c'est une XSS.
- [ ] **Imprimable** — ouvrir l'aperçu d'impression : aucun titre seul en bas de page, aucun graphe
      coupé en deux, en-têtes de tableau répétés, contrôles interactifs masqués, hypothèses du
      calculateur figées en texte.
- [ ] **Lisible dans les deux thèmes** — clair ET sombre (la bascule est dans l'en-tête).
- [ ] **Accessible** — navigable au clavier (onglets, tri, glisser-déposer ont tous un équivalent
      clavier), SVG avec `role="img"` + `aria-label`, focus visible, information jamais portée par la
      **seule** couleur.
- [ ] **Honnête** — une mesure douteuse est signalée comme telle (dispersion, R², « non exploitable »),
      pas maquillée. Un chiffre sans son incertitude est un piège.
- [ ] **Rejouable** — la commande exacte figure en pied de page.

## Anti-patterns

- **Faire cracher du HTML brut au modèle.** Le HTML se GÉNÈRE à partir de données, par un moteur de
  rendu. Un LLM qui écrit 800 lignes de balises à la main produit du code non déterministe, non
  rejouable, et impossible à re-modifier proprement.
- **Une lib de graphes.** Chart.js, D3, Recharts : une dépendance = un CDN (donc un rapport mort hors
  ligne) ou un bundle. Les graphes de `report.mjs` sont du SVG pur, ils s'impriment tels quels.
- **Le rapport-fleuve.** Si tout est important, rien ne l'est. Une section = une idée.
- **Le camembert à 8 parts.** Personne ne compare 8 angles. Barres.
- **L'axe tronqué.** Un axe Y qui ne part pas de zéro sur un graphe de barres ment, point.
- **Commiter le rapport dans `docs/`.** Ce n'est pas de la documentation : c'est une photo. `tmp/`.

## Index des références (charger à la demande)

| Fichier                                                                  | Contenu                                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`references/print-pdf.md`](references/print-pdf.md)                     | Impression : `@page`, sauts de page, en-têtes répétés, numéros de page, pièges par navigateur                    |
| [`references/ergonomie.md`](references/ergonomie.md)                     | Ergonomie et dataviz : hiérarchie de l'information, choix du graphe, échelles, accessibilité, erreurs classiques |
| [`references/html-vs-md.md`](references/html-vs-md.md)                   | Pourquoi HTML pour un humain, Markdown pour un outil — et ce que ça change quand c'est une IA qui génère         |
| [`references/echarts/grid.md`](references/echarts/grid.md)               | Doc officielle ECharts — mise en page d'une grille, `outerBounds*`, et pourquoi `containLabel` est déprécié      |
| [`references/echarts/axis-common.md`](references/echarts/axis-common.md) | Doc officielle — `scale`, `min`/`max`, `dataMin`/`dataMax`, `splitNumber`, `minInterval`, étiquettes             |
| [`references/echarts/y-axis.md`](references/echarts/y-axis.md)           | Doc officielle — `alignTicks`, `position`, `offset` : tout ce que demandent DEUX axes de valeurs                 |

## Exemple vivant

`scripts/demo.mjs` (dans ce skill) génère un rapport qui utilise **tous** les composants — il sert de
vitrine et de test de non-régression visuel :

```bash
node .claude/skills/nodefony-html-report/scripts/demo.mjs tmp/demo.html && open tmp/demo.html
```

Consommateurs réels :

- `.claude/skills/nodefony-load-test/scripts/capacity.mjs` — banc de capacité, rapport de
  dimensionnement avec calculateur ;
- `.claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs` et
  `perf-dossier-report.mjs` — **les deux pages publiées** sur GitHub Pages, rendues par le moteur
  ECharts et bâties par `scripts/build-perf-site.mjs` depuis `docs/performance/data/<version>.json`.
