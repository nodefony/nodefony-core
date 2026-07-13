---
name: nodefony-html-report
description: Fabrique des rapports HTML autonomes (zéro dépendance, zéro CDN) destinés à des humains qui doivent DÉCIDER — audits, bancs de performance, revues, états des lieux, dashboards figés. Fournit une bibliothèque de rendu (`lib/report.mjs`) : graphes SVG (barres, courbes, nuage+régression, waterfall, heatmap, jauge, donut, sparkline), tableaux triables/filtrables, calculateurs interactifs, listes réordonnables par glisser-déposer, onglets, mode présentation, export CSV — et une impression PDF soignée (sauts de page maîtrisés, en-têtes de tableau répétés, hypothèses figées). À utiliser dès qu'un livrable doit être LU, MANIPULÉ ou IMPRIMÉ par une personne, plutôt que relu par un outil. Déclencheurs : "rapport HTML", "générer un rapport", "rapport imprimable", "rapport PDF", "dashboard statique", "restituer des mesures", "page de résultats", "graphe sans dépendance", "calculateur interactif", "deck de présentation", "export CSV".
---

# nodefony-html-report

> **Maintenance** : ce fichier décrit la vérité COURANTE. Éditer en place, jamais de journal daté
> (l'historique = `git log`). Une leçon durable se fond en RÈGLE ici ou dans `reference/`.

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

| Bloc                                                     | Fonction                                                  |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Document complet (CSS, thème, impression, tri)           | `doc({ title, subtitle, sections, footer })`              |
| Section (contrôle du saut de page)                       | `section(titre, corps, { break: "avoid\|before\|auto" })` |
| Chiffres-clés                                            | `cards([{ k, v, unit, sub }])`                            |
| Tableau (triable au clic, en-tête répété à l'impression) | `table(cols, rows, { sortable, id })`                     |
| Filtre plein-texte sur un tableau                        | `tableFilter(tableId)`                                    |
| Export CSV (RFC 4180, BOM UTF-8)                         | `csvExport(tableId, "fichier.csv")`                       |
| Barres comparatives (échelle log possible)               | `barChart(rows, { unit, logScale })`                      |
| Courbes                                                  | `lineChart(series)`                                       |
| Nuage de points + droite de régression                   | `scatterFit(series)`                                      |
| Waterfall (phases, pipeline)                             | `waterfall(bars)`                                         |
| Heatmap (matrice)                                        | `heatmap(rows, cols, values)`                             |
| Jauge (saturation, score)                                | `gauge(ratio, { label, warn, danger })`                   |
| Donut (répartition)                                      | `donut(parts)`                                            |
| Sparkline (tendance en ligne)                            | `sparkline(values)`                                       |
| **Calculateur interactif**                               | `calculator({ inputs, constants, compute })`              |
| **Liste réordonnable (glisser-déposer + clavier)**       | `sortableList(items)`                                     |
| Onglets (ARIA, dépliés à l'impression)                   | `tabs(items)`                                             |
| Bloc repliable natif                                     | `details(résumé, corps)`                                  |
| Mode présentation (plein écran, ←/→)                     | `deckControls()`                                          |
| Impression                                               | `printButton()`                                           |
| Avertissement / note                                     | `warn(html)` · `note(html)`                               |
| Formatage FR + palette                                   | `fmt.int/dec/pct/bytes/ms` · `COLORS` · `series(i)`       |

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

| Fichier                                                    | Contenu                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`reference/print-pdf.md`](reference/print-pdf.md)         | Impression : `@page`, sauts de page, en-têtes répétés, numéros de page, pièges par navigateur                    |
| [`reference/ergonomie.md`](reference/ergonomie.md)         | Ergonomie et dataviz : hiérarchie de l'information, choix du graphe, échelles, accessibilité, erreurs classiques |
| [`reference/interactivite.md`](reference/interactivite.md) | Glisser-déposer, onglets, filtres, export, deck, `<dialog>`, ce qui est réellement utilisable sans polyfill      |
| [`reference/html-vs-md.md`](reference/html-vs-md.md)       | Pourquoi HTML pour un humain, Markdown pour un outil — et ce que ça change quand c'est une IA qui génère         |

## Exemple vivant

`scripts/demo.mjs` (dans ce skill) génère un rapport qui utilise **tous** les composants — il sert de
vitrine et de test de non-régression visuel :

```bash
node .claude/skills/nodefony-html-report/scripts/demo.mjs tmp/demo.html && open tmp/demo.html
```

Consommateur réel : `.claude/skills/nodefony-load-test/scripts/capacity.mjs` (banc de capacité →
rapport de dimensionnement avec calculateur).
