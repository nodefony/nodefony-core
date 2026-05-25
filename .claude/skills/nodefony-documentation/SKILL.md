---
name: nodefony-documentation
version: 1.0.0
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
  Déclencheurs : "portail doc", "doc portal", "DocLayout", "@nodefony/documentation", "MarkdownDoc",
  "DocToc", "sommaire de doc", "scrollspy doc", "FlowGraph", "page de documentation Studio",
  "écrire la doc dans Studio", "module documentation", "layout docs-site", "rendre du markdown Studio".
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

3 colonnes : **nav** (gauche, sticky) | **contenu** (centre, le SEUL à scroller) | **sommaire**
(droite, sticky, optionnel). Portail et onglet Docs module consomment le MÊME composant → cohérence.

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

### `MarkdownDoc` — rendu markdown + Mermaid + ancres

```tsx
<MarkdownDoc
  markdown={md}
  maxWidth={860} // largeur de lecture (défaut 860px)
  onInternalLink={(slug) => goTo(slug)} // clic sur `xxx.md` → callback (retourne true si géré)
/>
```

Pose les ancres de titres avec le MÊME `slugifyHeading` que `DocToc` → le scrollspy s'aligne.

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
   - `CONTENT_STICKY_TOP` = header + hauteur PageHeader — pour un panneau sticky SOUS un PageHeader
     lui-même sticky (sinon il passe DERRIÈRE le PageHeader opaque).
   - `SIDEBAR_MAX_HEIGHT` = `calc(100vh - header - pageHeader - debugbar - 2*gap)` — hauteur max
     d'une sidebar sticky. **Soustraire `--nodefony-debugbar-height`** sinon la debug bar recouvre.
   - `HEADING_SCROLL_MARGIN` — marge d'ancre : un titre cible ne passe pas sous l'en-tête sticky au saut.
   - **Jamais** un `250px` / `calc(100vh - 110px)` en dur dans une page.
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

## Écriture de la doc (contenu)

- **Emplacement hybride (ADR-0001)** : la doc d'un module vit DANS le module (`<module>/docs/*.md`,
  frontmatter `module:`), surfacée dans Studio. Le transverse reste sous `docs/` racine. `git mv`
  obligatoire pour déplacer. Réf : [[feedback_doc_placement]].
- **Frontmatter** : `module`, `audience` (liste persona), `section`, `version`, `status`
  (`draft`/`stable`), `title`. C'est ce que lit l'index transverse.
- **Vulgariser TOUJOURS** : analogie physique d'abord (ex « backplane = fond de panier »), puis terme
  exact + trad FR, schéma, le POURQUOI avant le COMMENT. Vaut pour la 1ʳᵉ phrase TSDoc, le README
  module et les pages doc. Réf : [[feedback_doc_vulgarization]].
- **Ton selon l'audience** : page DEV = technique précis (SoC), pas analogie grand public ; l'analogie
  sert à expliquer au lecteur, pas à truffer la copy d'ingénieurs. Réf : [[feedback_writing_tone_audience]].
- **TSDoc** : 1ʳᵉ phrase auto-suffisante (extraite dans `symbols.json` → hover IDE + graphe).

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

## Réfs (mémoires IA — détails)

- [[project_doc_portal_faisabilite]] — étude de faisabilité (persona, graphes, providers, versioning, RBAC).
- [[feedback_studio_layout_rigor]] — règles de mise en page docs-site (modèle figé).
- [[feedback_doc_placement]] — où mettre chaque `.md` (ADR-0001, module vs racine vs ADR).
- [[feedback_doc_vulgarization]] / [[feedback_writing_tone_audience]] — comment écrire.
- [[feedback_security_rfc_rigor]] — exigence sécurité/RFC (allowlist, 0 traversée, 0 secret).
- Skills voisins : `nodefony-studio-dev` (écrans génériques), `nodefony-framework-dev` (back), `nodefony-create-module` (scaffold).

---

## Changelog (SemVer)

- **1.0.0** (2026-05-25) — Création. Capitalise le POC portail doc `eb078ce` : briques front
  (DocLayout/DocToc/MarkdownDoc/FlowGraph/SymbolGraph + `layout.ts`), règles docs-site (0 magic
  number, sticky + 1 scroll, Card overflow, pas de sticky dans ScrollArea), data plane
  `/nodefony/documentation/api/{tree,page/:slug}` + sécurité allowlist, design figé du module
  `@nodefony/documentation` (index transverse, providers `{{ }}`, versioning git, RBAC P6),
  conventions d'écriture (ADR-0001, vulgarisation). Piège dist turbo (404 registration) documenté.
