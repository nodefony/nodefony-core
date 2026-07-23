# Briques front de la doc — API exacte

> Chargé à la demande par le skill `nodefony-documentation`, quand on code une page ou un onglet Docs.
> Toutes ces briques sont co-localisées dans `@nodefony/studio/frontend/src/components/ui/` (sauf
> `SymbolGraph` → `../components/SymbolGraph`) et réutilisées par le portail ET l'onglet « Docs » d'un
> module. Import : `import { … } from "../components/ui"`.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## `DocLayout` — LE layout docs-site (source unique)

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

## `MarkdownDoc` — rendu markdown + Mermaid + ancres + admonitions + code-copy

```tsx
<MarkdownDoc
  markdown={md}
  maxWidth={860} // largeur de lecture (défaut 860px)
  onInternalLink={(slug) => goTo(slug)} // clic sur `xxx.md` → callback (retourne true si géré)
/>
```

Pose les ancres de titres avec le MÊME `slugifyHeading` que `DocToc` → le scrollspy s'aligne.

**Briques riches livrées** — toutes consommables DIRECTEMENT en `.md`, 0 nouvelle dep :

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

## `DocPageHeader` — en-tête riche d'une page de doc

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

## `DocToc` — sommaire « Sur cette page » (scrollspy + recherche)

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

## `FlowGraph` — graphe orienté (React Flow + dagre, déjà bundlés)

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

## `SymbolGraph` — graphe des classes d'un module (depuis `symbols.json`)

Onglet « Graphe » de `ModuleDetail` (classes auto + relations extends/implements). S'appuie sur
`FlowGraph`. Source = `.ai/symbols.json` / endpoint symbols du module.
