# Impression & PDF — la mécanique

> Un rapport finit **toujours** en PDF : joint à un dossier, imprimé pour une réunion, archivé.
> Une page web qui s'imprime mal n'est pas un rapport, c'est un brouillon. Tout ce qui suit est
> déjà implémenté dans `lib/report.mjs` — cette référence explique **pourquoi**, pour que vous
> puissiez l'adapter sans casser l'impression.
>
> Specs bundlées offline : [`specs/w3c/css-page-3.txt`](specs/w3c/css-page-3.txt) (CSS Paged Media),
> [`specs/w3c/css-break-3.txt`](specs/w3c/css-break-3.txt) (CSS Fragmentation).

## Le modèle mental

À l'impression, le navigateur **fragmente** un flux continu en pages. Vous ne contrôlez pas où il
coupe — vous exprimez des **contraintes** : « pas ici », « nouvelle page avant ceci », « répète cet
en-tête ». Le moteur fait de son mieux. Une contrainte impossible (un tableau plus haut qu'une page,
un `break-inside: avoid` sur un bloc de 3 pages) est simplement **ignorée**, sans erreur.

## Les six règles qui font 90 % du résultat

### 1. Forcer le thème clair

Une page sombre imprimée, c'est une page noire. Redéfinissez les variables dans `@media print`,
y compris pour `[data-theme="dark"]` — sinon un lecteur en mode sombre imprime du noir :

```css
@media print {
  :root,
  :root[data-theme="dark"] {
    --bg: #fff;
    --fg: #000;
    --line: #ccc;
  }
}
```

### 2. Conserver les couleurs

Par défaut, les navigateurs **suppriment les à-plats** à l'impression (économie d'encre). Un graphe
en barres devient alors invisible :

```css
* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
```

`print-color-adjust` est standard ; le préfixe `-webkit-` reste nécessaire pour Safari.

### 3. Ne jamais couper ce qui fait sens ensemble

```css
.card,
.chart,
.calc,
.warn,
tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

Doubler avec l'ancienne propriété `page-break-inside` : Safari et les vieux moteurs ne connaissent
pas encore partout `break-inside`. Le coût est nul, l'oubli coûte une page cassée.

### 4. Jamais un titre seul en bas de page

```css
h1,
h2,
h3 {
  break-after: avoid;
  page-break-after: avoid;
}
p,
li {
  orphans: 3;
  widows: 3;
}
```

`orphans`/`widows` : nombre minimal de lignes laissées en bas / reportées en haut. Trois est un bon
défaut ; en dessous, la lecture est hachée.

### 5. Répéter l'en-tête d'un tableau qui court sur plusieurs pages

C'est **la** règle qu'on oublie, et celle qui rend un tableau long illisible en PDF :

```css
table {
  break-inside: auto;
} /* un tableau long DOIT pouvoir couper */
thead {
  display: table-header-group;
} /* … mais son en-tête se répète */
tfoot {
  display: table-footer-group;
}
tr {
  break-inside: avoid;
} /* … sans jamais couper une ligne en deux */
```

`display: table-header-group` sur `<thead>` est ce qui déclenche la répétition. Sans lui, les colonnes
des pages 2, 3, 4 n'ont plus d'intitulé.

### 5 bis. Ce que le CSS ne peut PAS faire : le hook `beforeprint`

**Un `<details>` fermé n'est pas imprimé.** Pas « mal imprimé » : **absent du PDF**, dans les trois
moteurs, et **aucun CSS portable n'y remédie**. Idem pour un onglet masqué (`hidden`) ou une section
cachée par le mode présentation. Sans JS, un rapport peut donc perdre silencieusement la moitié de son
contenu à l'impression — et personne ne s'en aperçoit avant que le PDF soit parti.

`report.mjs` embarque donc un hook (une dizaine de lignes) qui, **avant** l'impression, ouvre tous les
`<details>`, déplie les onglets, réaffiche les sections — puis **restaure l'état du lecteur** après.

Deux autres pièges de la même famille, traités dans le CSS d'impression :

- **une animation jamais jouée laisse un `opacity: 0`** → l'élément est _invisible_ sur le papier.
  D'où `* { animation: none !important; opacity: 1 !important }` en `@media print`.
- **`content-visibility: auto`** provoque des pages blanches et des sauts erratiques → neutralisé.
- **un `<dialog>` ou un `popover` ouvert** vit dans le _top layer_, dont le rendu à l'impression n'est
  pas spécifié (son `::backdrop` peut noircir le PDF). **Règle d'architecture : aucun contenu
  imprimable ne doit vivre uniquement dans un dialogue.**

### 6. Masquer l'interactif, figer les hypothèses

Les boutons, filtres et champs n'ont aucun sens sur papier — mais **leur résultat, si**. Un
calculateur imprimé sans ses entrées est inexploitable : on voit « 4 pods » sans savoir pour quelle
charge. D'où la classe `.print-only` qui matérialise les hypothèses en texte au moment d'imprimer :

```css
@media print {
  .no-print {
    display: none !important;
  }
  .print-only {
    display: block;
  }
}
```

Et côté JS, le calculateur écrit en continu un résumé de ses entrées dans un bloc `.print-only`.

## Sauts de page volontaires

```css
.page-break {
  break-before: page;
  page-break-before: always;
}
```

Utilisez-les avec parcimonie : une section = une page n'est _pas_ un bon défaut (vous obtenez un
document plein de blancs). Réservez le saut forcé aux **frontières logiques** : passage de la synthèse
au détail, début d'une annexe.

Dans `report.mjs` : `section(titre, corps, { break: "before" })`.

## Format, marges, et numéros de page

```css
@page {
  size: A4; /* ou `letter`, ou `210mm 297mm`, ou `landscape` */
  margin: 16mm 14mm;
}
```

Les **margin boxes** (`@page { @bottom-right { content: counter(page) " / " counter(pages) } }`) sont
**implémentées depuis Chrome 131** — mais **ni Firefox ni Safari** ne les connaissent.

Conséquence pratique :

- Sur **Chrome**, la numérotation « page X / Y » fonctionne, gratuitement, et dégrade en silence
  ailleurs. Vous pouvez donc la poser sans risque.
- Sur **Firefox**, un `position: fixed` avec `counter(page)` s'incrémente (Gecko le fait) — mais le
  **total (`counter(pages)`) est impossible**, et aucune API JS ne l'expose.
- Sur **Safari**, aucun numéro fiable.

Si la numérotation est **contractuelle** (rapport réglementaire, annexe juridique), il faut sortir du
navigateur : Paged.js (~100 Ko de JS), ou une génération PDF côté serveur (WeasyPrint, Prince). Sinon,
laissez l'en-tête/pied natif de la boîte de dialogue d'impression faire le travail.

## Ce qui marche vraiment, par navigateur

| Fonctionnalité                                     |  Chrome   |  Firefox  |     Safari      |
| -------------------------------------------------- | :-------: | :-------: | :-------------: |
| `break-inside: avoid`                              |    ✅     |    ✅     |       ✅        |
| `break-before/after: page`                         |    ✅     |    ✅     |       ✅        |
| **`break-before/after: avoid`**                    |    ✅     | **no-op** |    **no-op**    |
| `orphans` / `widows`                               |    ✅     |  **❌**   |       ✅        |
| **`thead` répété (`display: table-header-group`)** |    ✅     |    ✅     |     **❌**      |
| `print-color-adjust: exact`                        |    ✅     |    ✅     | ✅ (`-webkit-`) |
| `@page { size / margin }`                          |    ✅     |    ✅     |       ✅        |
| **`@page` margin boxes + `counter(page)`**         | ✅ (131+) |    ❌     |       ❌        |
| `@page { marks }` / `{ bleed }`                    |    ❌     |    ❌     |       ❌        |
| SVG inline imprimé                                 |    ✅     |    ✅     |       ✅        |

**Les trois pièges qui découlent de ce tableau :**

1. **`break-after: avoid` ne protège les titres que sur Chrome.** La seule protection _portable_ est
   d'envelopper le titre **et** son contenu dans un bloc `break-inside: avoid` — c'est exactement le
   rôle de `.sec.keep` dans `report.mjs`. Ne construisez rien sur `break-after`.
2. **Safari ne répète pas les en-têtes de tableau.** Le `display: table-header-group` reste juste (il
   sert Chrome et Firefox), mais si le rapport est destiné à des lecteurs Safari, **cassez les longs
   tableaux** en sections plutôt que de compter sur la répétition.
3. **Les numéros de page existent — sur Chrome seulement** (depuis la version 131) :
   `@page { @bottom-right { content: counter(page) " / " counter(pages) } }`. Firefox peut incrémenter
   un compteur via un `position: fixed`, mais **le total (`counter(pages)`) est impossible hors
   Chrome**, et aucune API JS ne l'expose. Si la numérotation est contractuelle, il faut un
   paginateur (Paged.js) ou une génération PDF côté serveur.

## Vérifier (obligatoire avant de livrer)

1. Ouvrir le rapport, `Cmd/Ctrl + P` → **aperçu**.
2. Contrôler, page par page : titre orphelin ? graphe coupé ? tableau sans en-tête ? bouton visible ?
   calculateur sans ses hypothèses ?
3. Tester en **thème sombre** (le lecteur peut être en sombre au moment d'imprimer).
4. Enregistrer en PDF et rouvrir le fichier : c'est ce que recevra le destinataire.

Un aperçu d'impression prend 30 secondes et sauve un livrable. C'est le meilleur ratio de toute cette
bibliothèque.

## Pièges

- **`position: fixed`** disparaît ou se répète bizarrement à l'impression. Ne l'utilisez pas dans un
  rapport.
- **`overflow: hidden/auto`** tronque à l'impression : un tableau dans un conteneur scrollable perd
  ses colonnes de droite. D'où `@media print { .scroll { overflow: visible } }`.
- **Les hauteurs en `vh`** n'ont pas de sens sur papier.
- **Les images en `background-image`** peuvent ne pas s'imprimer selon les réglages : préférez `<img>`
  ou du SVG inline.
- **Le mode présentation** (deck) masque les sections : prévoir qu'un `beforeprint` les réaffiche
  toutes (c'est ce que fait `report.mjs` pour les onglets).
