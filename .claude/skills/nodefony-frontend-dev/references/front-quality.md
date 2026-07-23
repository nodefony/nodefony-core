# Qualité front (Nodefony) — temps réel calme · perf CSS · a11y · sécu

Règles de qualité **transverses** à tout front Nodefony (React / Vue / Angular). Distillées en règles
intemporelles, applicables **en construisant**. Le spécifique Studio (briques Mantine, UI kit) →
skill `nodefony-studio-dev`. Protocole (HTTP/WS/CORS/cookies) → skill `nodefony-rfc`.

## Sommaire

- [1. Temps réel CALME — neutre pour l'œil](#1-temps-réel-calme--neutre-pour-lœil)
- [2. Perf CSS — coût de rendu](#2-perf-css--coût-de-rendu)
- [3. Accessibilité (WCAG 2.2 AA / ARIA)](#3-accessibilité-wcag-22-aa--aria)
- [4. Sécurité front](#4-sécurité-front)

---

## 1. Temps réel CALME — neutre pour l'œil

**Principe.** Dans une UI pro, le temps réel doit **informer sans solliciter**. La vision périphérique
détecte le mouvement de façon **involontaire** : le moindre scintillement vole l'attention hors du focus
et fatigue. **Règle d'or : le statique domine, le mouvement est RARE et porteur de sens.** À appliquer
sur **tout** widget live.

1. **Texte qui se met à jour = format STABLE par paliers.** Pas de bascule d'unité (ms↔s), pas de
   décimale qui « churne ». Utiliser des **paliers** : « à l'instant » sous ~1,5 s, puis secondes / min /
   heures **entières**. (Un âge `200ms→800ms→1.2s` clignote ; un libellé à paliers est calme.)
2. **`tabular-nums`** (`font-variant-numeric: tabular-nums`) + `white-space: nowrap` sur **tout nombre
   qui change** → 0 jitter de largeur (donc 0 reflow, 0 saut, CLS stable).
3. **Aucune animation qui REJOUE à chaque tick.** Un glow/`box-shadow` qui s'allume-s'éteint = paint
   répété = le clignotement. Un indicateur d'état = couleur/opacité **stable** (transition douce), pas un
   battement. Un pulse = **`opacity` only** (compositor), jamais `box-shadow`.
4. **Pas de bascule de style binaire sur donnée bruitée** : un badge `filled↔light` ou une couleur qui
   flippe quand un débit oscille 0/1 → garder un **variant stable** (la donnée change, pas le style).
5. **Isoler le re-render.** `contain: content` par carte live ; idéalement isoler la valeur qui tique
   dans un **petit composant auto-tickant** (le reste de la carte ne re-render pas). Un timer parent qui
   re-render toute la liste 1×/s = source de churn.
6. **Le flash est l'EXCEPTION.** Réserver un flash bref (re-key sur la valeur), sur **petite surface**,
   aux changements **signifiants** (change-blindness : un changement rare ET important peut être manqué →
   un flash subtil le révèle mieux qu'une alerte criarde). Jamais en régime permanent.
7. **Respecter `prefers-reduced-motion`.** Sous `@media (prefers-reduced-motion: reduce)` : couper /
   atténuer flashes et animations (alternative en opacité douce, ou rien). Obligation a11y (troubles
   vestibulaires).
8. **Contrôle utilisateur obligatoire (WCAG 2.2 SC 2.2.2 — Pause, Stop, Hide).** Tout contenu
   auto-mis-à-jour au-delà de ~5 s doit offrir **pause/stop/hide** ou un **contrôle de fréquence** (switch
   « Temps réel », granularité de cadence, cadence adaptative).

> **Test des 30 secondes** (le plus important, 0 outil) : ouvrir l'écran live, **ne rien faire**, fixer
> 30 s. Tout ce qui bouge/clignote/saute **sans cause** = défaut → neutraliser (palier, variant stable,
> `contain`, isoler le tick). Le temps réel parfait est **invisible** tant qu'il ne se passe rien.

**Outils de vérif** : DevTools → Rendering → **Paint flashing** (un widget calme ne repeint QUE la valeur
qui change, pas toute la carte) + **Layout Shift Regions** ; émuler `prefers-reduced-motion: reduce` ;
Lighthouse (viser 0 régression CLS).

**Checklist par widget live** : (a) format texte par paliers ? (b) `tabular-nums` ? (c) variant/couleur
stables ? (d) `contain: content` ? (e) re-render isolé au tick ? (f) contrôle pause/fréquence (2.2.2) ?
(g) `prefers-reduced-motion` géré ?

Sources (proxy `r.jina.ai`, jamais la page HTML lourde) :
`https://r.jina.ai/https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html` ·
`https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion`

---

## 2. Perf CSS — coût de rendu

Le CSS est un **sujet de perf à part entière**, surtout sur les écrans live re-rendus à chaque tick.
Écrire le CSS **le moins coûteux** pour le pipeline (layout → paint → composite), pas « du CSS qui marche ».

- **Animer UNIQUEMENT `transform` + `opacity`** (compositor-only, GPU : ni layout ni paint). **JAMAIS**
  animer `width`/`height`/`top`/`left`/`margin` (→ **layout/reflow**) ni `box-shadow`/`filter`/`blur`
  (→ **paint** coûteux). Un flash `background` = paint : toléré seulement **bref + petite surface**.
- **`will-change` parcimonieux** : seulement sur un élément qui anime **souvent**, retiré après. Forcer un
  calque (`will-change: transform` / `translateZ(0)`) coûte de la mémoire → pas en masse.
- **`contain: content`** (ou `layout paint`) sur **tout widget live indépendant** → isole reflow/repaint à
  la carte au lieu de toute la page. Réflexe pour un dashboard qui tique.
- **`content-visibility: auto`** (+ `contain-intrinsic-size`) sur les **longues listes hors écran** (logs,
  grosses tables) → le navigateur saute le rendu du hors-champ.
- **`tabular-nums`** sur tout nombre qui change (anti-jitter de largeur → anti-reflow). Cf §1.
- **Pas d'objet style recréé à chaque render** dans un composant live (nouvelle référence → ré-application)
  : **hisser** les styles statiques en constante au niveau module, ou les passer en **classe CSS** ; ne
  garder en inline que la **valeur réellement dynamique** (largeur d'une barre…).
- **Pas de layout thrashing** : ne pas lire une métrique de layout (`offsetWidth`,
  `getBoundingClientRect`) puis écrire un style dans la **même frame** en boucle. Mesurer une fois, écrire
  ensuite.
- **Style injecté une seule fois** (pattern « ensure styles » gardé par flag) ; animations/hover en **CSS
  pur** (0 re-render du framework de vue).

Réflexe : avant d'animer/styler un élément qui bouge, se demander **« layout, paint ou compositor ? »** et
choisir le moins cher.

Sources (proxy `r.jina.ai`) :
`https://r.jina.ai/https://web.dev/articles/animations-guide` ·
`https://r.jina.ai/https://web.dev/articles/content-visibility` ·
`https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/CSS/contain`

---

## 3. Accessibilité (WCAG 2.2 AA / ARIA)

Vérifier la norme **AVANT** de livrer, pour tout composant/interaction.

- **Un seul `<h1>` par page** (l'en-tête de page le porte). Hiérarchie de titres cohérente.
- **`aria-label` sur tout contrôle icône-seule** (bouton/`ActionIcon` sans texte visible).
- **`aria-expanded`** sur tout toggle de divulgation (disclosure, menu, accordéon) + `aria-controls`.
- **`aria-live`** (poli/assertif selon criticité) sur les zones qui changent en async (chargement,
  résultats, statut) → annoncé aux lecteurs d'écran. Un état « occupé » = `aria-busy`.
- **Graphes / SVG porteurs d'info** : `role="img"` + `aria-label` décrivant la donnée (une courbe muette
  est invisible au lecteur d'écran).
- **WCAG 2.2 AA** : contraste suffisant, **focus visible**, cible tactile assez grande, alternatives
  texte, **pas d'information portée par la couleur seule** (doubler d'une forme/d'un libellé).
- **Pattern ARIA exact** d'un widget composite (dialog, tabs, menu, combobox, disclosure, alert…) :
  suivre l'**ARIA Authoring Practices (APG)** — rôles, états (`-selected`/`-checked`/`-controls`),
  navigation clavier attendue. Beaucoup est couvert nativement par un bon kit, **mais valider les ajouts
  custom**.
- **`prefers-reduced-motion`** (cf §1) est aussi une obligation a11y.

Sources (proxy `r.jina.ai`, jamais `w3.org` direct) :
`https://r.jina.ai/https://www.w3.org/TR/WCAG22/` ·
`https://r.jina.ai/https://www.w3.org/WAI/ARIA/apg/patterns/`

---

## 4. Sécurité front

Conformité = priorité. Front specifics, **non négociables** :

- **Frontière isomorphe — ne JAMAIS embarquer de code/données SERVEUR dans le bundle client.** L'import
  `nodefony` côté front résout vers le build **client isomorphe** (condition `browser`) — jamais le
  serveur. N'importer **aucun** module serveur dans le front (`@nodefony/http`, `…/security`,
  `…/framework` runtime, kernel, services, config, ORM, secrets/`.env`). Les embarquer mettrait de la
  logique/des secrets serveur dans le navigateur = compromission du serveur. Besoin d'un type serveur →
  **type miroir local** (pas d'import runtime). Le SEUL pont front↔serveur = le **data-plane**
  (cf `data-bff.md`). Vérifier le bundle : un import qui tire `node:*` ou un service serveur = **STOP**.
- **Rendu de données non maîtrisées → TEXTE.** Toujours via un nœud texte (`<Text>` / `{value}` /
  composant texte / viewer JSON). **JAMAIS `dangerouslySetInnerHTML`** (ni équivalent `v-html` /
  `[innerHTML]`). Un dump JSON read-only se rend en texte sûr (0 injection). Le seul sink HTML toléré est
  un moteur explicitement durci (ex. Mermaid en `securityLevel:"strict"` sur du markdown du repo).
- **Markdown** : rendu **sans HTML brut** (pas de `rehype-raw` ni équivalent) → pas d'injection via le
  contenu.
- **Zéro secret côté client** : jamais affiché ni loggé en clair (la redaction est **serveur**) ; **0
  `console.*`** committé ; pas de token en `localStorage` (cf `data-bff.md` §3 — cookie `HttpOnly`).
- **Zero Trust d'affichage** : une API admin exige un rôle côté serveur (403 sinon). Le gating front =
  **affichage seulement**, jamais la défense. Ne pas présumer l'utilisateur fiable ; ne pas cacher une
  donnée sensible derrière un simple gate front.
- **Ne pas faire confiance aveugle aux réponses serveur** : `ApiClient` cast `as T` sans validation
  runtime → valider la forme au boundary (Zod) dès que la donnée est sensible/non maîtrisée.
- **Liens externes** : `rel="noreferrer noopener"` (+ `target="_blank"` si nouvel onglet).
- **Endpoints qui EXÉCUTENT** (lancer un test, scaffolder…) : à garder **dev-only** côté serveur (403 hors
  développement) — le front ne doit jamais exposer un déclencheur qui contournerait cette garde.

> Avant tout commit front : passer le diff à une revue sécurité (skill `nodefony-security-review`),
> vérifier l'a11y (§3), et lancer la gate de types du module (transpilation ≠ typage — `tsc` attrape ce
> que le bundler laisse passer).
