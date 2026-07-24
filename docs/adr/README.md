---
lang: fr
module: global
topic: adr-index
audience: [human, ai]
tags: [adr, decisions, index]
status: stable
---

# ADR — Architecture Decision Records

> Décisions d'architecture/design actées, une par fichier `NNNN-titre.md`. Un ADR est
> **immuable** : s'il est remis en cause, créer un nouvel ADR qui le _supersede_ — ne pas
> réécrire l'ancien, sinon la trace du raisonnement disparaît avec la décision qu'il portait.
> Format léger : contexte / décision / alternatives écartées / conséquences.

| #                                                             | Titre                                                                                       | Statut   | Date       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-docs-modules-emplacement-hybride.md)              | Docs des modules — emplacement hybride + versionnement frontmatter/git                      | accepted | 2026-05-20 |
| [0002](0002-schema-conference-webrtc-mediasoup.md)            | Schéma DB conférence WebRTC (mediasoup) — banc de test ORM + cible P15                      | accepted | 2026-05-21 |
| [0003](0003-orm-core-abstraction-repository-multi-orm.md)     | Architecture orm-core — abstraction Repository multi-ORM (3 risques + garde-fous P5.4)      | accepted | 2026-05-21 |
| [0004](0004-inference-llm-backend-supervise.md)               | Inférence LLM — backend supervisé, jamais embarquée dans le cœur                            | accepted | 2026-05-29 |
| [0005](0005-observabilite-prod-gate-env-audit-window.md)      | Observabilité prod — gate env des sévérités du cycle de vie + fenêtre d'audit à chaud       | accepted | 2026-06-01 |
| [0006](0006-configuration-unifiee-env-override.md)            | Configuration unifiée — une source Zod/module + override env générique `NF__*` + précédence | accepted | 2026-06-28 |
| [0007](0007-clientkernel-isomorphe-contrat-runtime-client.md) | ClientKernel isomorphe — geler le contrat runtime client (design only, impl Phase 3.2)      | accepted | 2026-07-03 |
