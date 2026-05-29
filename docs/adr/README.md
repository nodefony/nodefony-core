# ADR — Architecture Decision Records

Décisions d'architecture/design actées, une par fichier `NNNN-titre.md`.
Un ADR est **immuable** : s'il est remis en cause, créer un nouvel ADR qui le
_supersede_ (ne pas réécrire l'ancien). Format léger (contexte / décision /
alternatives écartées / conséquences).

| #                                                         | Titre                                                                                  | Statut   | Date       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-docs-modules-emplacement-hybride.md)          | Docs des modules — emplacement hybride + versionnement frontmatter/git                 | accepted | 2026-05-20 |
| [0002](0002-schema-conference-webrtc-mediasoup.md)        | Schéma DB conférence WebRTC (mediasoup) — banc de test ORM + cible P15                 | accepted | 2026-05-21 |
| [0003](0003-orm-core-abstraction-repository-multi-orm.md) | Architecture orm-core — abstraction Repository multi-ORM (3 risques + garde-fous P5.4) | accepted | 2026-05-21 |
| [0004](0004-inference-llm-backend-supervise.md)           | Inférence LLM — backend supervisé, jamais embarquée dans le cœur                       | accepted | 2026-05-29 |
