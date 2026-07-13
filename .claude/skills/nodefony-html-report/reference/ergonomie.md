# Ergonomie, dataviz, accessibilité

> Ce qui sépare un rapport lu d'un rapport survolé. Sources : Tufte (data-ink), Few (_Common Pitfalls
> in Dashboard Design_), Cairo, FT _Visual Vocabulary_, IBM Carbon, Cleveland–McGill, WCAG 2.2.

## Les 10 règles d'ergonomie

1. **La conclusion d'abord** (pyramide inversée). Haut = verdict et chiffres-clés. Milieu = ce qui
   l'explique. Bas = détail et méthode. Test de recevabilité : _si le lecteur ne lit que le premier
   écran, a-t-il la réponse ?_
2. **Un titre est une conclusion, pas une étiquette.** « Évolution du p95 » ✗ → « Le p95 a doublé après
   la v3 » ✓. Vaut pour le rapport, chaque section, **et chaque graphe**. Si vous ne pouvez pas écrire
   la phrase affirmative, c'est que vous n'avez pas la question : ne dessinez pas le graphe.
3. **Une idée par section, un message par graphe.** Deux questions = deux graphes.
4. **La règle des dix secondes.** Si les deux questions principales n'ont pas de réponse en dix
   secondes, la page est trop chargée. Le chiffre le plus important : **en haut à gauche, en grand.**
5. **Data-ink ratio.** Supprimez tout ce qui n'est pas de la donnée : grilles épaisses, bordures, 3D,
   dégradés, couleurs décoratives. Axes et grille sont **récessifs** (gris clair, 1 px) — jamais plus
   contrastés que les données.
6. **Le gris est le contexte.** Toute série qui ne porte pas le message passe en gris. Une seule série
   colorée : celle dont on parle. C'est le levier de lisibilité numéro un, et il est gratuit.
7. **Un chiffre nu ne dit rien.** Toujours une référence : cible, période précédente, ligne de base.
   `410 ms` ✗ → `410 ms — +128 % vs v2 (cible : 250 ms)` ✓.
8. **La fausse précision est du bruit.** `2,4 M€`, pas `2 437 812,53 €`. Arrondissez jusqu'au seuil où
   la décision changerait.
9. **Typographie** : corps 16–18 px, interligne ~1,5, **mesure de 50 à 75 caractères** (`max-width:
66ch`). Les chiffres en `font-variant-numeric: tabular-nums` dans les tableaux, sinon les colonnes
   dansent d'une ligne à l'autre.
10. **Tableau ou graphe ?** Le graphe montre une **forme** (tendance, écart, distribution,
    corrélation). Le tableau donne des **valeurs** (à lire, comparer, citer). Corollaire net : _un
    graphe où vous étiquetez chaque point est un tableau déguisé — faites un tableau._

## Choisir le graphe par la QUESTION posée

| La question                    | À utiliser                                   | À éviter                       |
| ------------------------------ | -------------------------------------------- | ------------------------------ |
| Qui est le plus grand ?        | **Barres horizontales triées**               | Camembert, radar, 3D           |
| Quel classement ?              | Barres triées, slope chart (2 dates)         | Ordre alphabétique (= bruit)   |
| De quoi est-ce composé ?       | Barre empilée 100 % ; donut **si ≤ 5 parts** | Camembert au-delà de 5 parts   |
| Comment ça évolue ?            | Ligne (≤ 5 séries)                           | Aire empilée pour **comparer** |
| Quel lien entre X et Y ?       | Nuage de points + régression (+ R²)          | **Double axe Y**               |
| Quelle répartition ?           | Histogramme, boxplot                         | Barres de moyennes             |
| Écart à une cible ?            | Barres divergentes, waterfall                | Barres empilées                |
| Un seul chiffre est le message | Grand nombre + delta + sparkline             | Un graphe pour une valeur      |

**Hiérarchie perceptive (Cleveland–McGill)** : position > longueur > angle > aire > couleur. C'est la
justification formelle de « barres plutôt que camembert » : l'œil compare mal des angles. Au-delà de
6 séries, passez en _small multiples_ plutôt qu'en plat de spaghettis.

## Échelles

- **Barres, colonnes, aires : le zéro est obligatoire, sans exception.** Une barre encode une
  **longueur** : la tronquer ment. Dans `report.mjs`, ce n'est même pas une option.
- **Lignes et séries temporelles : la troncature est légitime** — une ligne encode une **pente**, et
  forcer le zéro sur une latence qui passe de 190 à 210 ms _cache_ l'information. Mais il faut
  **l'annoncer** (mention « échelle non-zéro »).
- **Échelle logarithmique** quand les ordres de grandeur diffèrent (1 µs vs 500 µs : en linéaire, la
  petite barre disparaît), ou quand le sujet est le _taux_ de croissance. Jamais sur des barres,
  jamais avec des zéros ou des négatifs.

## Le bêtisier (interdit par construction dans la bibliothèque)

- **Double axe Y** : les deux échelles sont arbitraires, donc l'auteur _fabrique_ la corrélation.
  Remplacez par deux graphes empilés partageant l'axe X, une base 100 indexée, ou tracez le ratio.
  → _Aucune API de double axe dans `report.mjs`._
- **Camembert à plus de 5 parts** · **3D** · **aire empilée pour comparer** (seule la série du bas a
  une ligne de base plate) · **bulles dimensionnées au rayon** (l'œil lit l'aire : `r = k·√valeur`) ·
  **barres non triées**.

## Couleur — la vérité contre-intuitive

**Une palette « sûre pour daltoniens » ne suffit pas.** Okabe-Ito est sûre en _teinte_, mais pas en
_luminance_ : deux séries voisines peuvent tomber à **1,02:1** de contraste entre elles. Et **aucune
palette de 8 couleurs ne peut garantir 3:1 entre séries adjacentes** — huit paliers espacés de 3:1
sortent du gamut. C'est mathématique, pas un défaut de goût.

**La conformité (WCAG 1.4.11) ne vient donc pas du choix des couleurs, mais de :**

1. **Le liseré de fond** entre deux aplats contigus (`stroke="var(--bg)"`) : l'œil sépare par le
   **bord**, pas par la teinte. C'est _la_ technique.
2. **La redondance** : forme de marqueur + style de trait + **étiquette directe**.
3. **L'ordre** : `report.mjs` sert les séries par contraste décroissant, pour que les premières
   passent le seuil.

**Le test le moins cher qui existe** : passez la page en `filter: grayscale(1)`. Si elle reste
lisible, elle l'est pour tout le monde — et elle s'imprimera correctement.

**Étiquetage direct plutôt que légende** : une légende force un aller-retour permanent entre l'œil et
la liste. Deux à quatre séries → étiquette au bout de la courbe.

## Accessibilité — l'obligatoire

### Un graphe SVG

```html
<svg role="img" aria-labelledby="c1-t c1-d">
  <title id="c1-t">Latence p95 par version</title>
  <desc id="c1-d">De la v1 à la v3, le p95 passe de 180 à 410 ms.</desc>
  …
</svg>
```

- **`role="img"` est obligatoire** : sans lui, les lecteurs d'écran _descendent_ dans le SVG et
  récitent tous les `<text>` en vrac — les libellés, les valeurs, les graduations, dans l'ordre du
  DOM. Inaudible. `role="img"` coupe la descente.
- `<title>` **et** `aria-labelledby` : le support de `<title>` seul est inconsistant.
- **La `<desc>` ne remplace pas les chiffres** (WCAG 1.1.1) : l'alternative réelle d'un graphe de
  données, c'est un **tableau**. Mettez-le dans un `details("Voir les données", table(...))` — il sert
  aussi les voyants qui veulent la valeur exacte.

### Le reste

- **Jamais l'information par la seule couleur** (1.4.1).
- **Cibles de clic ≥ 24 × 24 px** (WCAG 2.2, critère 2.5.8) : boutons de tri, onglets, `<summary>`.
- **Le glisser-déposer doit avoir un équivalent** sans glissement (2.5.7) — `sortableList` répond avec
  `Alt` + flèches.
- **Focus visible** (`:focus-visible`, jamais `outline: none`), contrastes AA (4,5:1 texte / 3:1
  objets graphiques), `<html lang>`, hiérarchie de titres sans saut.
- **`display: grid|flex|block` sur un `<table>` détruit ses rôles implicites.** Jamais.
- **APCA n'est pas normatif** (retiré du working draft WCAG 3) : WCAG 2 reste la référence de
  conformité.
