---
adr: 1
title: Docs des modules — emplacement hybride + versionnement frontmatter/git
lang: fr
date: 2026-05-20
status: accepted
deciders: [Christophe CAMENSULI]
tags: [docs, studio, versioning]
---

# ADR-0001 — Docs des modules : emplacement hybride + versionnement frontmatter/git

## Statut

Accepté (2026-05-20).

## Contexte

Studio expose des pages par module (`/nodefony/modules/{key}`). On veut y intégrer
la documentation « à portée de main », colocalisée au code, sans qu'elle diverge.
État de départ : `docs/` racine contient surtout du transverse core
(`architecture/*`), un seul `packages/frontend.md`, et les modules
(`http`/`framework`/`studio`…) n'ont **ni README ni `docs/`** — seulement
`MEMORY.md` (IA). La doc était dispersée et sans règle de placement.

## Décision

1. **Emplacement hybride** : la doc prose **spécifique à un module** vit DANS le
   module (`src/.../<module>/docs/*.md`). Le `docs/` racine ne garde que le
   **transverse** : `architecture/` (concepts multi-module / core), `guides/`,
   `audits/`, `adr/`, `session-retros/`. Lien module ↔ doc transverse via
   frontmatter `module: <key>`. Relocalisation par `git mv` (préserve l'historique).
2. **Versionnement = frontmatter + fraîcheur git** : chaque `.md` porte
   `title / module / since / updated / status` (`draft|stable|deprecated`). La
   version affichée par Studio = `package.json` du module ; la **date du dernier
   commit git** du fichier sert de signal de dérive doc ↔ code. Pas d'arbre
   versionné (`docs/vX`).
3. **Référence API = 100 % auto** depuis les TSDoc (`.ai/symbols.json`), jamais
   écrite à la main (anti-divergence, cf interdiction des `.d.ts` manuels).
4. **Rendu** : `react-markdown` + `remark-gfm` côté Studio (React 19) ; le backend
   reste un pur data plane (sert le `.md` brut).

## Alternatives écartées

- **Centralisé** (tout dans `docs/`, mappé par frontmatter) : la doc reste séparée
  du code — exactement ce qu'on veut éviter (« à portée de main »).
- **Tout dans les modules** (y compris le transverse) : disperse les concepts
  multi-module, casse la cohérence architecture / RAG futur.
- **Arbre versionné `docs/vX`** (style Docusaurus) : lourd, prématuré avant la 1.0.

## Conséquences

- Studio lit `<modulePath>/docs/` + les docs racine taggées `module: <key>`.
- La couverture TSDoc (97/441 ≈ 22 %) devient un levier : plus de TSDoc → meilleure
  page API.
- Le core (`Container`/`Kernel`/`Syslog`…) n'est pas un module chargeable : ses docs
  vont dans `src/nodefony/docs/` ; leur surfaçage Studio (page « Core ») est un
  follow-up.
- Convention de placement figée → mémoire IA `feedback_doc_placement` +
  `CLAUDE.md` racine (tableau 3 niveaux) à garder synchrones.
