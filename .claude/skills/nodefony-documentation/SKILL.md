---
name: nodefony-documentation
version: 2.0.0
description: >
  Kit de dev de la DOCUMENTATION Nodefony — le portail doc Studio (`/nodefony/documentation`)
  et le futur module `@nodefony/documentation`. Concern TRANSVERSE (ni purement front, ni purement
  back) : briques React réutilisables (DocLayout = layout docs-site 3 colonnes, DocToc = sommaire +
  scrollspy, MarkdownDoc = markdown + Mermaid + ancres, FlowGraph = graphe React Flow/dagre,
  SymbolGraph = graphe de classes), règles de mise en page docs-site (0 magic number via layout.ts,
  sidebars sticky + 1 seul scroll), data plane `/nodefony/documentation/api/{tree,page/:slug}`
  (allowlist anti-traversée), design figé du module final (index transverse, providers `{{ }}`,
  versioning par tags git, frontmatter `audience`, RBAC P6) et conventions d'écriture (ADR-0001
  emplacement hybride, vulgarisation). NE couvre PAS les écrans Studio génériques (→ nodefony-studio-dev)
  ni la création back from scratch (→ nodefony-create-module / nodefony-framework-dev).
  Porte AUSSI le SYSTÈME D'ÉCRITURE de la doc de référence : standard `reference/redaction-contenu.md`
  (Diátaxis, intro obligatoire, ancres symboliques, Démarrage rapide compilable) + outillage
  `scripts/` (doc-lint DoD bloquante, anchor-check exactitude des ancres, gen-counters compteurs de
  tests réels, build-preview aperçu HTML fidèle Studio).
  Déclencheurs : "portail doc", "doc portal", "DocLayout", "@nodefony/documentation", "MarkdownDoc",
  "DocToc", "sommaire de doc", "scrollspy doc", "FlowGraph", "page de documentation Studio",
  "écrire la doc dans Studio", "module documentation", "layout docs-site", "rendre du markdown Studio",
  "écrire une page de doc", "doc de référence", "standard de rédaction", "doc-lint", "anchor-check",
  "ancre symbolique", "démarrage rapide", "corpus doc", "reprendre la doc".
---

# nodefony-documentation — kit doc (portail Studio + module futur)

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

## Briques front — API exacte (`import { … } from "../components/ui"`)

Toutes co-localisées dans `@nodefony/studio/frontend/src/components/ui/` (sauf `SymbolGraph` →
`../components/SymbolGraph`). Réutilisées par le portail ET l'onglet « Docs » d'un module.

### `DocLayout` — LE layout docs-site (source unique)

**Grille FLEXBOX 3 colonnes à largeur fixe** (façon MDN/Docusaurus) : **nav 264px** | **contenu FLEX
(dominant)** | **sommaire 240px** (optionnel). PAS une `Grid` Mantine proportionnelle (l'ancienne
md:3/6/3 plafonnait le contenu à 50 % = « centre trop petit »). CSS responsive injecté 1×
(`ensureDocLayoutStyles`, pattern `ensureDocStyles`) : sous 992px → empilement + sommaire masqué.
Portail et onglet Docs module consomment le MÊME composant → cohérence.

Deux modes de scroll :

- **`mode="container"` (RECOMMANDÉ — portail + onglet module)** : zone à **hauteur fixe** (`height`,
  ex `PAGE_CONTENT_HEIGHT`) où **chaque colonne scrolle INDÉPENDAMMENT** (hauteur `--nf-doc-h` posée
  inline + `.nf-doc-region-col`). **Robuste : 0 dépendance au sticky/scroll de page.** Corrige « menus
  sans scroll » + « fullscreen médiocre » (le plein écran rend le même flex en `container` plein viewport).
- **`mode="page"`** : sidebars sticky, le contenu scrolle avec la page. **Fragile** (dépend de
  `--nf-pageheader-height` publiée + du scroll de `AppShell.Main`) → réservé au cas où on VEUT le scroll
  de page. Le portail est passé de `page` à `container` pour cette raison.

```tsx
<DocLayout
  navTitle="Documentation"
  navSearch={<TextInput … />}      // fixe, hors scroll
  navActions={<Button … />}        // tout plier/déplier
  nav={<TreeOfPages … />}          // scrollable
  title={<PageHeading badges … />} // en-tête du contenu
  tocMarkdown={markdown}           // absent ⇒ pas de colonne droite
  mode="page"                      // "page" (scroll de page) | "container" (hauteur fixe)
  height={READER_HEIGHT}           // requis seulement en mode="container"
  enableFullscreen
>
  <MarkdownDoc markdown={markdown} />
</DocLayout>
```

### `MarkdownDoc` — rendu markdown + Mermaid + ancres + admonitions + code-copy

```tsx
<MarkdownDoc
  markdown={md}
  maxWidth={860} // largeur de lecture (défaut 860px)
  onInternalLink={(slug) => goTo(slug)} // clic sur `xxx.md` → callback (retourne true si géré)
/>
```

Pose les ancres de titres avec le MÊME `slugifyHeading` que `DocToc` → le scrollspy s'aligne.

**Briques riches livrées (v1.1.0)** — toutes consommables DIRECTEMENT en `.md`, 0 nouvelle dep :

- **Admonitions GitHub-flavor** : `> [!NOTE]` · `> [!TIP]` · `> [!IMPORTANT]` · `> [!WARNING]` ·
  `> [!CAUTION]` → rendu `<Alert>` Mantine (icône + couleur + titre traduit FR). Le marqueur arrive
  comme texte brut dans le 1ᵉʳ paragraphe du blockquote (remark-gfm ne parse pas les admonitions) ;
  `parseAdmonition` parcourt récursivement les children React du blockquote, retire le préfixe
  `[!TYPE]` du 1ᵉʳ text node, retourne le type + rest.
- **Heading anchors cliquables au hover** sur `##`/`###`/`####` : icône `#` à droite, `opacity 0→0.7`
  au `:hover` du titre, `opacity 1` sur l'anchor `:hover`/`:focus`. Clic = copie URL profonde
  (`origin + path + #slug`) + `scrollIntoView` (gate `prefers-reduced-motion`). Styles statiques
  injectés une fois (`ensureDocStyles`, identique au pattern `ensureLiveStyles` du UI kit). Pseudo-classe
  `:hover` impossible inline → CSS injecté reste la solution la plus simple.
- **Code blocks enrichis** : ` ```ts ` (etc.) → wrapper `Paper` avec topbar (chip langue +
  bouton Copier avec feedback). Inline `<code>` inchangé. **Pas** de syntax highlighting (lourd,
  différé). ⚠️ Override `<pre>` (pas `<code>`) sinon `<pre><Paper>…</Paper></pre>` = HTML invalide.
- **`prefers-reduced-motion`** : gate sur tout `scrollIntoView` (`DocToc.go()` ET anchor copy)
  → `behavior: reduce ? "auto" : "smooth"`. WCAG 2.3.3.

### `DocPageHeader` — en-tête riche d'une page de doc (v1.1.0)

```tsx
<DocPageHeader
  breadcrumbs={["Documentation", "Realtime"]} // optionnel
  title="La socket Nodefony"
  version="v1.2.0" // optionnel
  status="stable" // stable | draft | temporary | experimental | deprecated (couleurs auto)
  wip={false} // badge "à venir" si true
  updated="2026-05-28" // ISO / Date — rendu "Mis à jour le 28 mai 2026"
  sourceUrl="https://github.com/.../socket.md" // bouton "Modifier sur GitHub"
  actions={<RoleSwitch …/>} // optionnel, à droite
/>
```

Usage : `<DocPageHeader/>` passé au `title=` du `DocLayout`. Tout (sauf `title`) est **optionnel** :
dégradation gracieuse → le backend pourra remonter `updated`/`sourceUrl` plus tard (frontmatter
`updated` + frontmatter `source` → URL GitHub assemblée serveur) **sans casser les call-sites**.
Le titre est en `h2` (la page hôte porte le `h1` global via `PageHeader`).

### `DocToc` — sommaire « Sur cette page » (scrollspy + recherche)

```tsx
<DocToc
  markdown={md}
  scrollRootRef={ref} // viewport scrollable observé (sinon = viewport global)
  minLevel={2}
  maxLevel={3}
  maxHeight={SIDEBAR_MAX_HEIGHT} // fourni ⇒ panneau auto-porté (en-tête FIXE + liste qui scrolle)
/>
```

> `maxHeight` fourni = en-tête figé + liste flex qui scrolle — **robuste**. NE PAS reposer sur
> `position:sticky` DANS un `ScrollArea` Mantine (cassé). Cf règles layout.

### `FlowGraph` — graphe orienté (React Flow + dagre, déjà bundlés)

```tsx
<FlowGraph
  nodes={nodes}
  edges={edges}
  dir="LR"
  height={420}
  ariaLabel="Flux de la socket"
/>
```

`ariaLabel` **obligatoire** (a11y). `dir`: `"TB"` (haut→bas) | `"LR"` (gauche→droite). Stack
mermaid/React Flow/dagre **déjà** dans le bundle → ne PAS ajouter de lib de diagramme.

### `SymbolGraph` — graphe des classes d'un module (depuis `symbols.json`)

Onglet « Graphe » de `ModuleDetail` (classes auto + relations extends/implements). S'appuie sur
`FlowGraph`. Source = `.ai/symbols.json` / endpoint symbols du module.

---

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

> **Standard intégral** : [`reference/redaction-contenu.md`](reference/redaction-contenu.md) — LIRE
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

| Script                                  | Rôle                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/doc-lint.mjs <page.md>`        | **Definition of Done bloquante** (frontmatter, sections, ≥3 ancres, compteur tests, 0 HTML brut) |
| `scripts/anchor-check.mjs <page.md>`    | **Exactitude des ancres** : résout chaque `fichier:ligne` contre le code réel (SUSPECT/LINE_OUT) |
| `scripts/gen-counters.mjs [topic]`      | Compteurs de tests **comptés réellement** depuis `scripts/test-map.json` (JAMAIS de photo figée) |
| `scripts/build-preview.mjs <md> <html>` | Aperçu HTML autonome fidèle Studio (version/branche/commit pris de git ; Mermaid si mmdc)        |

### Workflow par page (ordre imposé)

lire le CODE réel → rédiger (standard §8→§8sexies) → `gen-counters.mjs <topic>` (MAJ `test-map.json`
si nouveaux fichiers de test) → `build-preview.mjs` → **`doc-lint.mjs` vert ET `anchor-check.mjs`
0 SUSPECT** → commit `docs(<module>): …` sur la branche `doc` (jamais mergée sans validation humaine).

---

## Gates avant commit

```bash
# 1. typecheck front Studio (0 erreur — fichiers de SOURCE, pas les .test.ts)
cd src/packages/@nodefony/studio/frontend && npx tsc --noEmit
# 2. build studio DIRECT si index.ts public changé (sinon turbo sert un dist caché → 404)
cd src/packages/@nodefony/studio && rm -rf dist && npm run build
# 3. endpoints vivants
curl -s -o /dev/null -w "tree:%{http_code}\n"  http://127.0.0.1:5151/nodefony/documentation/api/tree
curl -s -o /dev/null -w "page:%{http_code}\n"  http://127.0.0.1:5151/nodefony/documentation/api/page/socket
```

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
    "../../../../../../../../docs/realtime/socket/*.md",
    { query: "?raw", import: "default", eager: true },
  );
  ```
  → ajouter un MD = il apparaît automatiquement dans la nav (Vite HMR détecte
  le nouveau fichier matching le pattern, ré-évalue le module).
- **PIÈGE Vite glob #1 — pattern LITTÉRAL** : le path doit être une string statique
  (Vite parse à la compile-time). Pas de concat, pas de template literal. Si tu
  changes de profondeur du fichier hôte (ex : `routes/` → `realtime/socket/`),
  recompte les `..` à la main, le compilateur ne te le dit pas.
- **PIÈGE Vite glob #2 — `Object.assign({})` vide = glob qui match rien** : si le
  transform Vite (`curl /@fs/.../pages.ts`) montre `Object.assign({})` SANS entrée,
  c'est que le glob ne résout aucun fichier (mauvais nombre de `..`, ou en dehors
  de `server.fs.allow`). Diagnostic 30 secondes vs heures perdues à chercher le
  bug React. **Toujours `curl` la transform après écriture du `pages.ts`**.
- **Backend scan hiérarchique** (`DocumentationController.#listRootDocs`) :
  grouper par chemin parent COMPLET (`realtime/socket`), pas par 1ᵉʳ segment (qui
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

---

## Changelog (SemVer)

- **2.0.0** (2026-07-19) — **Le skill devient le foyer du SYSTÈME D'ÉCRITURE de la doc de référence**
  (reprise du corpus cloud, retours user : ancres illisibles/décalées, pas d'exemples). Nouveau :
  `reference/redaction-contenu.md` (standard intégral §8→§8sexies) + `scripts/` = doc-lint (DoD
  bloquante), **anchor-check** (exactitude des ancres contre le code réel — 19/283 décalées trouvées),
  **gen-counters** v2 (compteurs COMPTÉS depuis `test-map.json`, fin des photos hardcodées),
  build-preview (provenance git réelle, artefacts → `tmp/doc-work/`). 3 règles nouvelles au standard :
  **ancre symbolique** (symbole d'abord, ligne en preuve), **Démarrage rapide compilable obligatoire**
  (point de vue app générée — fondation des recettes `@nodefony/devkit`), point de vue consommateur.
  Section « Écriture de la doc » du SKILL réécrite (workflow par page + tableau outillage).
- **1.3.0** (2026-06-30) — **Refonte ergonomie DocLayout (flexbox 3 colonnes + container par défaut)**.
  3 plaintes ergo du portail (menus sans scroll, centre trop petit, fullscreen médiocre) = UNE racine :
  le modèle « scroll de page + sticky » (`Grid` md:3/6/3 → contenu 50 %, sticky fragile dépendant de
  `--nf-pageheader-height` + scroll `AppShell.Main`). Fix : `DocLayout` passé de `Grid` Mantine à un
  **flexbox 3 colonnes à largeur fixe** (nav 264 | contenu FLEX dominant | sommaire 240), CSS responsive
  injecté 1× (`ensureDocLayoutStyles`, hauteurs via `--nf-doc-h` + `.nf-doc-region-col`, empilement +
  TOC masqué < 992px). Portail `Documentation.tsx` migré `mode="page"` → `mode="container"`
  `height={PAGE_CONTENT_HEIGHT}` → **chaque colonne scrolle indépendamment** (0 dépendance au sticky),
  fullscreen = même flex immersif. `ModuleDetail` (déjà `container`) hérite du contenu dominant.
  **Leçon** : pour un docs-site, préférer **container + flex largeur fixe** au **page + sticky** (ce
  dernier dépend de trop de variables shell). Gates : typecheck studio 0, transforms Vite 200 (HMR).
- **1.2.0** (2026-05-28) — **Vitrine « doc Socket » + Registry Vite glob + Backend scan hiérarchique**.
  Création de la première vitrine de doc complète (`docs/realtime/socket/`) :
  7 pages MD (vue-ensemble · architecture · protocole · fan-out · sondes · backplane ·
  actions), avec admonitions GitHub, anchors hover, code-copy, Mermaid, liens internes.
  **Backplane détaillé** (Loopback / Cluster IPC / Redis pub-sub / Kafka) — tableau
  comparatif, arbre de décision, sécurité, anti-patterns. **Registry frontend**
  `realtime/socket/pages.ts` : `import.meta.glob` charge tous les MD du dossier en
  bloc (eager, `?raw`), parse frontmatter mini-inline, expose `socketPages` trié par
  préfixe numérique. Map `LIVE_GRAPHS[slug]` associe optionnellement un composant
  graphe live (extensible). Brique **`LiveGraphSection`** (Paper + switch + graphe)
  réutilisable. **Composant `ArchitectureLiveGraph`** (Phase B) consomme
  `realtime:health` et alimente le `liveNodeData` du `FlowGraph`. Page POC
  `/nodefony/socket-poc?sub=<slug>` route via `useSearchParams`. **Backend Studio
  `DocumentationController.#listRootDocs`** étendu : groupement par chemin parent
  COMPLET (`realtime/socket` ≠ `realtime/` plat) + parser frontmatter côté serveur
  → tree expose les vrais titres + `page()` remonte `updated`/`status`/`sourceUrl`.
  Labels enrichis (`Realtime / La Socket Nodefony`). Routing migré sur la page
  principale `/nodefony/documentation` (`?doc=<slug>`). **PIÈGES retenus** :
  Vite glob pattern littéral statique (8 `..` vs 7 selon profondeur du fichier
  hôte) ; turbo cache parfois capricieux sur le rebuild Studio (utiliser
  `npx rolldown` direct quand `npm run build` semble silencieux) ; `Object.assign({})`
  vide dans le transform = signe d'un glob qui ne match rien.
- **1.1.0** (2026-05-28) — **Template doc impeccable + 0 magic number** (session 1, front-only).
  Briques `MarkdownDoc` enrichies : admonitions GitHub-flavor (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`
  → `<Alert>` Mantine, parser direct dans l'override blockquote, 0 dep), heading anchors cliquables
  au hover (icône `#`, copie URL profonde + scroll, `prefers-reduced-motion` respecté), code blocks
  enrichis (topbar chip langue + bouton Copier ; override `<pre>` pour HTML valide). Nouvelle brique
  `DocPageHeader` (breadcrumb · titre h2 · badges version/status/wip · meta line « Mis à jour le … »
  - « Modifier sur GitHub », tout optionnel = dégradation gracieuse, prêt à recevoir `updated`/
    `sourceUrl` du backend). `layout.ts` étendu = 4 tokens publics (`PAGE_CONTENT_HEIGHT`,
    `PAGE_CONTENT_HEIGHT_WITH_BAND`, `TABS_PANEL_HEIGHT`, `MODAL_FULLSCREEN_BODY/CONTENT`) + 2 constantes
    internes (`BAND="48px"`, `MODAL_HEADER="60px"`). 8 magic numbers migrés (RoutesView/ModuleDetail×2/
    Database/Chat/DocLayout×2/FlowGraph) ; bug debugbar Chat fixé en bonus ; 0 résiduel hors `layout.ts`.
    Section Retex initiée avec les pièges rencontrés. Gates : `npm run typecheck` Studio = 0 erreur,
    transform Vite 200 sur 11 fichiers, HMR Vite = 0 restart serveur.
- **1.0.0** (2026-05-25) — Création. Capitalise le POC portail doc `eb078ce` : briques front
  (DocLayout/DocToc/MarkdownDoc/FlowGraph/SymbolGraph + `layout.ts`), règles docs-site (0 magic
  number, sticky + 1 scroll, Card overflow, pas de sticky dans ScrollArea), data plane
  `/nodefony/documentation/api/{tree,page/:slug}` + sécurité allowlist, design figé du module
  `@nodefony/documentation` (index transverse, providers `{{ }}`, versioning git, RBAC P6),
  conventions d'écriture (ADR-0001, vulgarisation). Piège dist turbo (404 registration) documenté.
