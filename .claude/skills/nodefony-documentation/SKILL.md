---
name: nodefony-documentation
metadata:
  version: 2.4.0
description: >
  Kit de dev de la DOCUMENTATION Nodefony, deux faces. (1) Le PORTAIL doc Studio et le futur module
  `@nodefony/documentation` : briques React (DocLayout, DocToc, MarkdownDoc, FlowGraph, SymbolGraph),
  mise en page docs-site, data plane avec allowlist anti-traversée. (2) Le SYSTÈME D'ÉCRITURE de la
  doc de référence : standard de rédaction (Diátaxis, ancres symboliques, Démarrage rapide
  compilable, navigation par hubs) et ses gates `scripts/` — doc-lint, anchor-check, code-check,
  gen-counters, build-preview. Ni les écrans Studio génériques (→ nodefony-studio-dev), ni la
  création back (→ nodefony-create-module).
  Déclencheurs : "portail doc", "DocLayout", "@nodefony/documentation", "MarkdownDoc", "DocToc",
  "page de documentation Studio", "écrire la doc dans Studio", "écrire une page de doc",
  "doc de référence", "standard de rédaction", "doc-lint", "anchor-check", "corpus doc",
  "reprendre la doc", "avant de rédiger une doc", "la doc dit-elle encore vrai ?",
  "corriger un écart doc↔code".
---

# nodefony-documentation — kit doc (portail Studio + module futur)

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, la version dans `metadata.version`. Une leçon durable devient une règle d'une section,
> pas une entrée datée.

La documentation Nodefony est un **sous-système transverse** : un portail web dans Studio aujourd'hui
(POC committé `eb078ce`), un **module dédié `@nodefony/documentation` demain**. Elle touche le front
(React/Mantine), le back (un data plane qui lit les `.md` co-localisés) ET l'écriture (frontmatter,
vulgarisation). C'est pourquoi elle a son propre kit : la noyer dans `nodefony-studio-dev`
(front-only, déjà ~88 KB) ou `nodefony-framework-dev` (back-only) la découperait artificiellement.

**Quand ce skill, quand un autre :**

| Tâche                                                         | Skill                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Page de doc, portail, sommaire, rendu markdown, graphe de doc | **ce skill**                                           |
| Écran Studio générique (dashboard, panneau, onglet data/live) | `nodefony-studio-dev`                                  |
| Créer le module back `@nodefony/documentation` from scratch   | `nodefony-create-module` puis ce skill pour le contenu |
| Service/controller/endpoint back hors doc                     | `nodefony-framework-dev`                               |
| Conformité RFC/sécu d'un diff                                 | `nodefony-rfc` / `nodefony-security-review`            |

---

## État actuel (vérité terrain)

- **POC committé `eb078ce`** (branche `claude-ts`), **jetable mais gardé** : `DocumentationController`
  (studio) + page front `Documentation.tsx` + nav « Documentation ». Tout est en dur côté contenu
  (1 page réelle : `socket`) — c'est une **démo d'architecture**, pas le module final.
- **Briques réutilisables** (elles, elles survivent au vrai module) : voir § Briques front.
- **Module final `@nodefony/documentation`** : pas encore créé. Design figé ci-dessous.

> ⚠️ **Piège dist déjà rencontré (2026-05-25)** : ajouter un controller à `@controllers([…])` dans
> `studio/index.ts` change l'index public → turbo peut servir un `index.js` caché SANS la registration
> (le `.js` du controller est émis, mais l'`index.js` ne l'importe pas → **404 sur des routes pourtant
> définies**). Fix : rebuild DIRECT du package (`rm -rf dist && npm run build` dans le module), puis
> restart serveur. Règle générale : changement d'`index.ts` public d'un module → `npm run clean && npm run build`.

---

## Briques front — API exacte

> L'API exacte des briques React (`DocLayout`, `MarkdownDoc`, `DocPageHeader`, `DocToc`, `FlowGraph`,
> `SymbolGraph`) — props, modes de scroll, admonitions, ancres, code-copy — vit dans
> **`references/briques-front.md`**, chargé à la demande quand on code une page ou un onglet Docs.
> Toutes sont co-localisées dans `@nodefony/studio/frontend/src/components/ui/` et réutilisées par le
> portail ET l'onglet « Docs » d'un module. Retenir : `DocLayout` est la **source unique** du layout
> docs-site (flexbox 3 colonnes, `mode="container"` recommandé) ; `MarkdownDoc` et `DocToc` partagent
> le même `slugifyHeading` (scrollspy aligné) ; `FlowGraph` exige un `ariaLabel`.

---

## Navigation du portail — LE HUB D'ABORD, l'arbre ensuite

Décision d'ergonomie (retour user) : **l'arbre de navigation latéral devient touffu** dès qu'un module
a 8 pages, et un menu plat de 40 entrées n'enseigne rien. La navigation du portail repose donc sur
**trois** appuis, dans cet ordre d'importance :

1. **Les hubs** (`<module>/docs/index.md`) = **bureaux de travail** : parcours guidés par profil +
   catalogue en **cards cliquables** (une card = une page, avec le problème qu'elle résout et quand
   la lire). Gabarit imposé : standard `references/redaction-contenu.md` §8bis-index. C'est le chemin
   NORMAL d'entrée dans un module — pas le menu.
2. **La recherche** (`navSearch` du `DocLayout`) : traiter en première classe, pas en décoration —
   c'est le raccourci de qui sait ce qu'il cherche. Elle doit porter sur les **titres ET le corps**
   des pages, avec l'extrait de contexte autour du terme trouvé.
3. **L'arbre latéral** = raccourci pour l'habitué, jamais l'outil d'apprentissage. Le garder
   **replié par défaut au-delà d'un module**, et ne déplier que la branche courante.

Toute page porte en plus un **fil d'Ariane** (haut) et un **retour au hub** (pied) en Markdown pur —
règle §8bis-nav du standard, vérifiée par `doc-lint`. Le lecteur ne doit jamais être en cul-de-sac.

**Rendu des cards de hub** : une card naît d'un `### [\`nom\`](nom.md) — titre`(nom en code inline,
éventuellement lié).`build-preview.mjs` rend l'en-tête entier cliquable (`.brick-nav`/`.brick-link`,
focus visible, `prefers-reduced-motion`) — **`MarkdownDoc.tsx` doit atteindre la même parité** ; l'aperçu
est la référence visuelle.

## Règles de mise en page docs-site (NON négociables)

Issues d'un reproche user (2026-05-25 : patchs layout au coup par coup). Une UI pro = **un modèle
pensé**, pas une série de correctifs. Source de vérité = `components/ui/layout.ts`.

1. **0 magic number.** Tout offset vient de `layout.ts`, qui dérive des vars CSS du shell :
   - `STICKY_TOP` = `var(--app-shell-header-height)` — top d'un élément collé sous le header global.
   - `CONTENT_STICKY_TOP` = header + hauteur PageHeader **RÉELLE** (= `var(--nf-pageheader-height, 76px)`,
     publiée par `<PageHeader sticky>` via `ResizeObserver` — pixel-perfect, suit le subtitle/actions ;
     fallback `76px` quand pas de PageHeader sticky monté). **JAMAIS** retomber sur la constante en dur.
   - `SIDEBAR_MAX_HEIGHT` = `calc(100vh - header - pageHeader - debugbar - 2*gap)` — hauteur max
     d'une sidebar sticky. **Soustraire `--nodefony-debugbar-height`** sinon la debug bar recouvre.
   - `HEADING_SCROLL_MARGIN` — marge d'ancre : un titre cible ne passe pas sous l'en-tête sticky au saut.
   - `PAGE_CONTENT_HEIGHT` (alias `SIDEBAR_MAX_HEIGHT`) — contenu plein viewport sous un PageHeader
     (Card mih, panel principal).
   - `PAGE_CONTENT_HEIGHT_WITH_BAND` — sous PageHeader + UNE bande sup (toolbar de recherche DataGrid,
     bande de filtres ERD). Compose avec `BAND="48px"` interne.
   - `TABS_PANEL_HEIGHT` — sous PageHeader + Tabs.List sticky DANS une Card paddée (Tabs.Panel à
     scroll interne). Comprend les paddings sup de la Card.
   - `MODAL_FULLSCREEN_BODY` / `MODAL_FULLSCREEN_CONTENT` — body/contenu d'un Modal Mantine fullScreen
     (sous la topbar = `MODAL_HEADER="60px"` interne).
   - **Jamais** un `250px` / `calc(100vh - 110px)` en dur dans une page. Vérifié par grep régulier :
     `grep -rn "calc(100vh" src/packages/@nodefony/studio/frontend/src --include="*.tsx" | grep -v layout.ts`
     doit renvoyer 0 résultat.
2. **Modèle 3 colonnes** : nav | contenu | sommaire. **Le contenu est le SEUL à scroller** avec la
   page (aucune hauteur fixe, aucune `ScrollArea` interne). Les sidebars sont **sticky** + leur propre
   overflow (`ScrollArea.Autosize mah={SIDEBAR_MAX_HEIGHT}`, scroll interne SEULEMENT si trop long).
3. **Un seul en-tête sticky par zone de scroll.** Ne pas empiler 2 headers `top:0` dans le même
   conteneur (ils se chevauchent) → séparer en colonnes.
4. **`Card` Mantine = `overflow:hidden` par défaut** → clippe et casse tout enfant `position:sticky`.
   Mettre `style={{ overflow: "visible" }}` si un sticky vit dedans.
5. **Jamais `position:sticky` dans un `ScrollArea` Mantine** (ne s'accroche pas). Pour un panneau
   figé-en-tête-+-liste-scrollable, utiliser le mode auto-porté de `DocToc` (`maxHeight`) ou un
   `flex column` + `maxHeight`.
6. **3 sticky parallèles à `CONTENT_STICKY_TOP`** en mode `page` du `DocLayout` —
   nav (gauche), **en-tête de page (`title=`, le `DocPageHeader`)** et sommaire (droite). Le
   **titre de la sous-page DOIT rester visible quand on scroll dans le contenu**, sinon
   l'utilisateur perd le repère. Cohérent avec le PageHeader global sticky à `STICKY_TOP` :
   PageHeader (top=56px) ↑ puis trio (top=CONTENT_STICKY_TOP=132px). Implémenté dans
   `DocLayout` (en-tête central en `position:sticky; top: CONTENT_STICKY_TOP; background:
var(--mantine-color-body); z-index: 1`). **À PRÉSERVER lors de toute refonte de `DocLayout`**.
   N'est PAS appliqué en mode `container` (scroll interne) — la sticky serait relative au flex
   parent et n'aurait pas le bon comportement.

Réf mémoire : [[feedback_studio_layout_rigor]].

---

## Recette — ajouter une page de doc (portail ou onglet module)

1. **Contenu** : écrire le markdown (frontmatter `audience`/`section`/`version` — voir § Écriture).
   POC = en dur dans le controller ; module final = fichier `<module>/docs/*.md` co-localisé.
2. **Data plane** : la page est exposée par `GET /nodefony/documentation/api/page/{slug}` (markdown +
   `vars` résolues serveur). L'index par `GET …/api/tree`.
3. **Front** : `useResource` pour fetch `tree`/`page`, puis `DocLayout` + `MarkdownDoc` + `DocToc`.
   Liens internes `xxx.md` → `onInternalLink` qui navigue vers le slug.
4. **Route SPA** : `/nodefony/documentation` (segment unique) est déjà couvert par le fallback
   générique `@Get("/{page}")` de `StudioController` (deep-link/F5 OK). Une route à 2 segments
   nécessiterait son propre fallback littéral (cf `modules/{name}`).
5. **Gate** : `tsc` front 0 erreur + endpoints 200 (curl) avant commit.

### Squelette — page de doc

```tsx
import { DocLayout, MarkdownDoc, DataState } from "../components/ui";
import { useResource } from "../hooks/useResource";

export function DocPage({ slug }: { slug: string }) {
  const tree = useResource(
    () => fetch("/nodefony/documentation/api/tree").then((r) => r.json()),
    [],
  );
  const page = useResource(
    () =>
      fetch(
        `/nodefony/documentation/api/page/${encodeURIComponent(slug)}`,
      ).then((r) => r.json()),
    [slug],
  );
  return (
    <DataState resource={page}>
      {(p) => (
        <DocLayout
          navTitle="Documentation"
          nav={<DocTree tree={tree.data} active={slug} />}
          title={
            <PageTitle title={p.title} version={p.version} status={p.status} />
          }
          tocMarkdown={p.markdown}
          mode="page"
        >
          <MarkdownDoc
            markdown={p.markdown}
            onInternalLink={(s) => {
              go(s);
              return true;
            }}
          />
        </DocLayout>
      )}
    </DataState>
  );
}
```

---

## Data plane back — contrat (POC) + cible

### Endpoints

| Route                                         | Renvoie                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /nodefony/documentation/api/tree`        | `{ generatedAt, audiences[], sections[] }` — index TRANSVERSE (par section, pas par module), pages taguées `audience` |
| `GET /nodefony/documentation/api/page/{slug}` | `{ slug, title, version, status?, markdown, vars? }`                                                                  |

Shapes (POC) :

```ts
// tree
{ audiences: [{ key:"developer"|"devops"|"supervisor"|"admin", label, desc }],
  sections: [{ id, label, pages: [{ slug, title, audience: string[], version, status, wip? }] }] }
// page
{ slug, title, version, markdown, vars?: Record<string,string> /* providers {{ }} résolus serveur */ }
```

### Sécurité du data plane (PRIORITÉ — lecture de fichiers)

Le data plane LIT des `.md` depuis le disque → surface de **traversée de répertoire**. Règles
appliquées dans le POC, à conserver dans le module :

- **Jamais concaténer un slug brut dans un chemin FS.** Le slug est **validé contre une allowlist**
  (le scan `tree` produit la liste des slugs ; `find` par égalité, puis lecture du chemin connu).
- **Noms de fichiers FIXES** quand c'est possible (ex `MIGRATION_STATUS.md`) — 0 entrée utilisateur.
- **Valeurs `vars` SÛRES uniquement** : aucun chemin FS absolu, aucun secret. Les providers `{{ }}`
  ne renvoient que du dérivé public (version, compteurs, noms de symboles).
- Auth = mock comme le reste de Studio aujourd'hui ; **firewall réel = P6** (RBAC par `audience`).

Réf : [[feedback_security_rfc_rigor]].

---

## Module futur `@nodefony/documentation` — design figé

À créer via `nodefony-create-module` (package `@nodefony/*`), puis remplir avec ce kit. POURQUOI un
module dédié et pas juste un controller Studio : il porte de l'**état** (index, cache, registre de
providers, versions) — donc 0 hot path request, mais un cycle de vie propre.

- **Index transverse** : scanne les `<module>/docs/*.md` co-localisés (ADR-0001), parse le frontmatter
  (`audience`/`section`/`version`/`status`), construit l'arbre. Cache invalidé au changement de version.
- **Registre de providers `{{ }}`** : résout les variables à la LECTURE, côté serveur, depuis des
  sources SÛRES — `symbols.json` (graphe TS), `package.json` (versions), git (tags/commits). Un
  provider = `(ctx) => string`, enregistrable par module.
- **Versioning = tags git** : la doc « live » concerne la version installée ; les versions passées se
  lisent par tag. Pas de table de versions maison.
- **Diagrammes** : stack DÉJÀ bundlée (React Flow + dagre + mermaid). Le module n'ajoute AUCUNE lib.
- **RBAC** : filtrage par `audience` (persona developer/devops/supervisor/admin) une fois P6 livré.
  Aujourd'hui le `RoleSwitch` front existe mais ne filtre pas encore (manque le frontmatter `audience`
  branché côté back).
- **Perf** : tout est lazy (index construit au 1er accès, pas au boot), cache mémoire, 0 alloc par
  request hors lecture. Suivre la RÈGLE perf-mémoire du CLAUDE.md (lazy alloc, pas de structure « au cas où »).

Réf complète (étude de faisabilité) : [[project_doc_portal_faisabilite]].

---

## Écriture de la doc (contenu) — LE SYSTÈME COMPLET

> **Standard intégral** : [`references/redaction-contenu.md`](references/redaction-contenu.md) — LIRE
> AVANT d'écrire une page (intro §8 obligatoire, analyse §8bis par brique, complétude §8quater,
> exemples d'usage §8sexies, Definition of Done §8quinquies). Ce qui suit est le résumé opératoire.

### Où et comment

- **Emplacement hybride (ADR-0001)** : doc d'un module DANS le module (`<module>/docs/*.md`,
  frontmatter `module:`), transverse sous `docs/` racine. `git mv` pour déplacer.
  ⭐ **`files: ["dist", "docs"]` dans le package.json** → les pages PARTENT dans le paquet npm et
  sont lisibles depuis `node_modules` (c'est la fondation des recettes `@nodefony/devkit` : une IA
  dans une app générée lit la doc de la version INSTALLÉE — jamais de copie qui dérive).
- **Frontmatter « convention A »** (ce que le runtime lit) : `title`, `lang: fr`, `module`, `topic`,
  `section`, `audience` (persona), `version: "doc"`, `status: stable|draft`, `updated`, `source` ;
  carte de tests : `coverageModule`/`coverageFiles`/`coveragePackage`.
- **Vulgariser TOUJOURS** (analogie d'abord, POURQUOI avant COMMENT) · **ton selon l'audience** ·
  **TSDoc** 1ʳᵉ phrase auto-suffisante. Réfs : [[feedback_doc_vulgarization]], [[feedback_writing_tone_audience]].

### Les 3 règles qui font la qualité (nées du retour user 2026-07-19)

1. **ANCRE SYMBOLIQUE — le symbole d'abord, la ligne en preuve** : `` `Firewall.matchPath()`
(`firewall.ts:529`) ``. JAMAIS de ligne nue (``(`:223-232`)``) : illisible pour un humain,
   irrésoluble pour une IA, et fragile (vécu : 19/283 ancres décalées 2 jours après écriture).
2. **« Démarrage rapide » = LIVRABLE** : toute page de brique montre l'exemple minimal COMPLET vu
   depuis une app `nodefony create app` (imports réels, config `use()`, controller, ce qu'on
   observe) — et il **compile**. Chaque capacité majeure = un extrait d'usage. Une doc qui décrit
   sans montrer est inutilisable (constat : 22 pages, 15 blocs TS en tout).
3. **Point de vue = CONSOMMATEUR** (`import { … } from "nodefony"`), jamais l'interne du repo.

### Outillage (source unique : `scripts/` de CE skill ; artefacts → `tmp/doc-work/`)

| Script                                  | Rôle                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/doc-lint.mjs <page.md>`        | **Definition of Done bloquante** (frontmatter, sections, ≥3 ancres, compteur tests, liens vivants, 0 HTML brut). **5 régimes** selon la nature de la page — brique · hub `index.md` · glossaire `lexique.md` · index de dossier `README.md` · ADR `NNNN-*.md` (cf standard §8bis-\*) |
| `scripts/anchor-check.mjs <page.md>`    | **Exactitude des ancres CODE** : résout chaque `fichier:ligne` contre le code réel (SUSPECT/LINE_OUT)                                                                                                                                                                                |
| `scripts/anchor-fix.mjs`                | **RÉPARE** les ancres SUSPECT : relit la sortie d'`anchor-check` sur stdin et recale chaque ancre sur la LIGNE DE DÉFINITION du symbole qu'elle cite. Sans `--apply` = simulation.                                                                                                   |
| `scripts/anchor-inpage.mjs <page.md>`   | **Ancres INTERNES** : chaque `](#section)` mène-t-il à un titre de la page ? (sommaires morts)                                                                                                                                                                                       |
| `scripts/code-check.mjs <page.md>`      | **Compilabilité** : extrait les blocs du « Démarrage rapide » et les compile en TS strict                                                                                                                                                                                            |
| `scripts/gen-counters.mjs [topic]`      | Compteurs de tests **comptés réellement** depuis `scripts/test-map.json` (JAMAIS de photo figée)                                                                                                                                                                                     |
| `scripts/build-preview.mjs <md> <html>` | Aperçu HTML autonome fidèle Studio (version/branche/commit pris de git ; Mermaid si mmdc)                                                                                                                                                                                            |

> 🔁 **Un diff de code décale les ancres de la doc qui le cite — recaler à la MAIN coûte cher et se
> trompe.** Enchaîner les deux scripts, en simulation puis pour de bon :
>
> ```bash
> node .../anchor-check.mjs <module>/docs/*.md | node .../anchor-fix.mjs .            # simulation
> node .../anchor-check.mjs <module>/docs/*.md | node .../anchor-fix.mjs . --apply    # applique
> node .../anchor-check.mjs <module>/docs/*.md                                        # re-contrôle
> ```
>
> Deux pièges, vécus tous les deux en une passe : (1) le symbole le plus proche gagne, or **le nom
> de la CLASSE est plus près que la méthode** → toutes les ancres d'un fichier convergeaient sur
> `export class X` ; `anchor-fix` lit donc d'abord le symbole **cité juste avant l'ancre** dans la
> page. (2) Une définition « faible » (`  nom: Type,`) attrape un **paramètre**, pas une méthode →
> les motifs forts (class/interface/function/const/type + méthode) l'emportent, le faible ne sert
> qu'en dernier recours. Ce qui reste SUSPECT après la passe est en général un **littéral** cité
> entre backticks (`unauthorized`, `limit`) : le gate ne peut pas le résoudre, ce n'est pas une
> ancre fausse. **Relire le diff** — une passe automatisée sur du markdown déplace parfois plus que
> prévu.

> ⚠️ **`anchor-inpage.mjs` et `slugifyHeading()` (`studio/frontend/src/components/ui/DocToc.tsx`)
> portent la MÊME règle de slug** — convention GitHub, accents conservés, ponctuation/symboles/emoji
> retirés. Modifier l'un sans l'autre remet des sommaires morts **en silence** : c'est exactement
> comme ça que 77 ancres internes ont cassé d'un coup à l'arrivée des pages à catalogue.

### Workflow par page (ordre imposé)

lire le CODE réel → rédiger (standard §8→§8sexies) → `gen-counters.mjs <topic>` (MAJ `test-map.json`
si nouveaux fichiers de test) → `build-preview.mjs` → **les 4 gates verts : `doc-lint.mjs`,
`anchor-check.mjs` (0 SUSPECT), `anchor-inpage.mjs` (0 ancre morte), `code-check.mjs` (compile)** →
commit `docs(<module>): …` sur la branche `doc` (jamais mergée sans validation humaine).

---

## Gates avant commit

```bash
# 1. typecheck front Studio — LE SEUL QUI MORD (les 3 projets : module, tests, frontend)
cd src/packages/@nodefony/studio && npm run typecheck
# 2. build studio DIRECT si index.ts public changé (sinon turbo sert un dist caché → 404)
cd src/packages/@nodefony/studio && rm -rf dist && npm run build
# 3. endpoints vivants
curl -s -o /dev/null -w "tree:%{http_code}\n"  http://127.0.0.1:5151/nodefony/documentation/api/tree
curl -s -o /dev/null -w "page:%{http_code}\n"  http://127.0.0.1:5151/nodefony/documentation/api/page/socket
```

> 🔴 **N'utilise JAMAIS `cd .../studio/frontend && npx tsc --noEmit` comme gate.** Il sort **EXIT=0
> sans compiler un seul fichier de `src/`** — prouvé en injectant `const __probe: number = "boom"` :
> toujours vert, et `--listFiles` ne montre aucun fichier du frontend. C'est un gate **fantôme** :
> il donne la confiance sans la vérification. Le typecheck réel du projet passe par **`tsgo`**
> (`package.json` → `typecheck`), qui lui lève bien `TS2322` sur la même probe.
>
> Règle générale : avant de faire confiance à un gate, **casse-le exprès une fois**. Un gate qu'on
> n'a jamais vu échouer n'est pas un gate, c'est une incantation.

Après modif front pure → HMR Vite (0 restart). Après modif controller → `stop.sh && start.sh`
(skill `nodefony-start-server`). Hard-reload navigateur (cache React) avant de conclure.

---

## Retex — template doc impeccable (kit VIVANT, à enrichir)

Photo à jour des pièges et briques rencontrés sur le portail doc. Format : symptôme → cause → fix.

**Briques riches markdown (v1.1.0, 2026-05-28)**

- **Admonitions sans dep** : `remark-gfm` (déjà bundlé) ne parse PAS les admonitions GitHub
  (`> [!NOTE]`) — elles arrivent comme texte brut. Fix = parser direct dans l'override `blockquote`
  de `MarkdownDoc` (`parseAdmonition`) qui descend récursivement les children React, regex sur le
  1ᵉʳ text node, retire le préfixe, retourne `{meta, rest}`. Évite d'ajouter `remark-directive` +
  custom plugin (overkill, ~10 KB de dep pour 5 patterns).
- **Code blocks enrichis = override `<pre>`, PAS `<code>`** : React Markdown rend
  `<pre><code className="language-X">…</code></pre>`. Si on override `<code>` pour rendre un `<Paper>`,
  on a `<pre><Paper>…</Paper></pre>` = HTML invalide (block dans inline-ish). C'est `<pre>` qu'on
  override : on inspecte son enfant `<code className="language-…">` et on rend le wrapper Paper à la
  place. Inline `<code>` (sans `language-`) reste géré par `<code>`.
- **Hover anchor cliquable = CSS injecté UNE fois + classe** : la pseudo-classe `:hover` est
  IMPOSSIBLE en `style={{…}}` inline → la solution simple est d'injecter un `<style>` global une
  seule fois (pattern `ensureDocStyles`, miroir de `ensureLiveStyles`) avec `.nf-heading:hover
.nf-heading-anchor { opacity: 0.7 }`. Pas de re-render, pas de state, l'effet visuel coûte 0 frame.
  Ajouter `@media (prefers-reduced-motion: reduce) { transition: none }` dans le même bloc.
- **`prefers-reduced-motion` au moment du scroll, pas au montage** : lire `window.matchMedia(…).matches`
  AU CLIC (l'utilisateur peut basculer la préférence pendant la session). Coût négligeable
  (`matchMedia` est synchrone et caché par le navigateur). Vaut pour `DocToc.go()` et l'anchor copy.
- **Copie d'URL profonde sûre** : `navigator.clipboard.writeText` nécessite **HTTPS** ou localhost ;
  Studio sert en HTTPS (5152) → OK partout. Construire l'URL via `window.location.origin +
window.location.pathname + "#" + slug` (jamais `href` brut qui pourrait contenir des hash en cascade).
  Catch silencieux : si l'utilisateur refuse l'accès clipboard, le scroll au moins continue.

**`DocPageHeader` (v1.1.0)**

- **Dégradation gracieuse = champs optionnels côté front, remontée optionnelle côté back** : seuls
  `breadcrumbs` et `title` ont du sens en POC ; `updated`/`status`/`sourceUrl`/`version` ne s'affichent
  QUE si présents (rien à filtrer côté JSX, condition `&&`). Le backend documentation pourra remonter
  ces champs dans la response `/api/page/{slug}` (frontmatter `updated`/`source` → URL GitHub assemblée
  serveur via la config repo) sans toucher au call-site. Pattern recommandé pour TOUTE évolution du
  contrat data plane → étend la response, le front consomme avec `?.` et `&&`.
- **Pourquoi `h2` et pas `h1`** : la page Studio porte déjà un `h1` global via `<PageHeader>` ; ajouter
  un `h1` interne casserait la hiérarchie (2 h1 frères). Le titre de la doc courante est sémantiquement
  un `h2`. Les `##` du markdown rendu deviendront aussi des `h2` → frères sémantiquement OK
  (l'en-tête de page + ses sections sont au même niveau, comme MDN/Docusaurus).
- **Status reconnus & couleurs** : map `STATUS_COLOR` interne (`stable→teal`, `draft→yellow`,
  `temporary→orange`, `experimental→violet`, `deprecated→red`, fallback `gray`). Étendre quand un
  nouveau status sort du frontmatter ; ne pas hand-roller dans les call-sites.

**Layout 0 magic number (v1.1.0)**

- **`Chat.tsx` avait un bug debugbar** : `h="calc(100vh - 96px)"` SANS soustraction
  `var(--nodefony-debugbar-height)` → la zone de chat débordait sous la debug bar quand elle était
  active. Fix collatéral en migrant à `PAGE_CONTENT_HEIGHT` ET en passant le titre custom à
  `<PageHeader>` (cohérence kit). Règle : tout `calc(100vh - …)` DOIT soustraire le debugbar — codifié
  dans `layout.ts`, plus possible d'oublier.
- **Taxonomie 4 tokens, pas 8** : les 8 magic numbers réels (170/200/210/250/96/60/90/90) tombent
  dans 4 contextes sémantiques (page plein, page+bande, panel sous Tabs.List dans Card, Modal
  fullScreen). Nommer les **contributeurs** (HEADER, PAGE_HEADER, BAND, DEBUGBAR, GAP, MODAL_HEADER)
  - composer. La variance ±6 px entre valeurs absorbée par les paddings naturels Mantine — ne PAS
    chercher la formule magique exacte. Préférer un nouveau token sémantique à un magic number en page.

**Vitrine « doc Socket » + Registry Vite glob (v1.2.0, 2026-05-28)**

- **Registry frontend = `import.meta.glob` eager pour les `.md`** : un seul appel
  absorbe la laideur du path relatif et liste tous les MD en bloc. Pattern :
  ```ts
  const RAW_MAP = import.meta.glob<string>(
    "../../../../../../../../src/packages/@nodefony/realtime/docs/*.md",
    { query: "?raw", import: "default", eager: true },
  );
  ```
  → ajouter un MD = il apparaît automatiquement dans la nav (Vite HMR détecte
  le nouveau fichier matching le pattern, ré-évalue le module).
- **PIÈGE Vite glob #1 — pattern LITTÉRAL** : le path doit être une string statique
  (Vite parse à la compile-time). Pas de concat, pas de template literal. Si tu
  changes de profondeur du fichier hôte (ex : `routes/` → un sous-dossier plus
  profond), recompte les `..` à la main, le compilateur ne te le dit pas.
- **PIÈGE Vite glob #2 — `Object.assign({})` vide = glob qui match rien** : si le
  transform Vite (`curl /@fs/.../pages.ts`) montre `Object.assign({})` SANS entrée,
  c'est que le glob ne résout aucun fichier (mauvais nombre de `..`, ou en dehors
  de `server.fs.allow`). Diagnostic 30 secondes vs heures perdues à chercher le
  bug React. **Toujours `curl` la transform après écriture du `pages.ts`**.
- **Backend scan hiérarchique** (`DocumentationController.#listRootDocs`) :
  grouper par chemin parent COMPLET (`<a>/<b>`), pas par 1ᵉʳ segment (qui
  fusionnait à plat). Map `labels` enrichie pour les chemins fréquents ; fallback
  auto-capitalisé en `<segment> / <segment>` pour les inconnus.
- **Frontmatter parsé côté serveur** : `#listRootDocs` lit chaque `.md` et appelle
  `#parseFrontmatter(raw)` pour extraire `title:` — le tree backend expose le VRAI
  titre (pas le filename humanisé). Idempotent, lazy au scan, ~50 fichiers = imperceptible.
- **PIÈGE turbo rebuild Studio** : parfois `npm run build` du studio rend un dist
  qui ne reflète pas la dernière modif source (cache turbo agressif). Symptôme :
  `grep <ta-string> dist/*.js` retourne vide alors que la source la contient.
  Fix éprouvé : `rm -rf dist && npx rolldown -c rolldown.config.ts`
  (direct, court-circuite le wrapper). Vérifier ensuite `grep` du dist AVANT de
  redémarrer le serveur.
- **DevSupervisor watch les SOURCES TS, pas le dist** : pour forcer un restart
  après un rebuild manuel, `touch <source>.ts` déclenche le superviseur. Le PID
  doit changer (`lsof -nP -iTCP:5152 -sTCP:LISTEN -t`) → restart effectif.
- **Frontmatter mini-parser frontend** (POC) : 5 lignes regex, partagé entre
  `pages.ts` (registry) et `SocketPocPage` (avant Phase C). À factoriser dans
  un util commun quand un 3ᵉ consommateur arrive.
- **Routing — Documentation.tsx migré de `useState` à `useSearchParams("?doc=")`**.
  `useState(initialSlug)` interdit le deep-link, F5, et le bouton retour navigateur.
  **Règle** : toute page Studio à état de sous-navigation (page courante, onglet,
  filtre principal) DOIT utiliser `useSearchParams`. Pas négociable pour une doc
  qu'on partage par URL.

---

## Réfs (mémoires IA — détails)

- [[project_doc_portal_faisabilite]] — étude de faisabilité (persona, graphes, providers, versioning, RBAC).
- [[feedback_studio_layout_rigor]] — règles de mise en page docs-site (modèle figé).
- [[feedback_doc_placement]] — où mettre chaque `.md` (ADR-0001, module vs racine vs ADR).
- [[feedback_doc_vulgarization]] / [[feedback_writing_tone_audience]] — comment écrire.
- [[feedback_security_rfc_rigor]] — exigence sécurité/RFC (allowlist, 0 traversée, 0 secret).
- Skills voisins : `nodefony-studio-dev` (écrans génériques), `nodefony-framework-dev` (back), `nodefony-create-module` (scaffold).
