---
date: 2026-06-01
session_id: logs-observabilite-2026-06-01-soir
focus: Observabilité des logs full-stack — filtres protocole/étape, audit sévérités gaté env, page Suivi de requête, fix requestId teardown
---

# Session retro — 2026-06-01 (soir) — observabilité logs

## Fait (4 commits poussés `a08cef1..d474ed9`)

- `a08cef1` feat(syslog) : filtres **protocole**/**étape** STRUCTURÉS au core (pduProtocol/pduFlow
  isomorphes, 0 divergence front/back) + critères `protocol`/`flow` (filterPdus + buildCriteria).
- `f9f0666` feat(http) : **audit sévérités** cycle de vie GATÉ par env (INFO hors prod / DEBUG prod)
  - 🐛 **fix corrélation requestId teardown** (override Context.log micro-bulle ALS, tous drivers).
- `5330ecf` feat(studio) : page **« Suivi de requête »** `/nodefony/logs/trace/:id` (TabbedPage +
  onglets Accueil/Chronologie/ORM/Sécurité/Brut) + filtre Protocole + sélecteur Étape adaptatif.
- `d474ed9` docs(adr) : **ADR-0005** (gate env + fenêtre d'audit à chaud, auto-revert serveur).

## Coûts évidents / frictions

- **Session très longue, demandes empilées** (protocole → étape → sévérités → gate → TraceView →
  fix requestId → doublons) : aurait gagné à être découpée (`/clear` entre features).
- ~6 rebuilds + restarts (back hot path → memory.test obligatoire à chaque modif Context).
- 2 bugs découverts par le user en cours (requestId vide teardown ; doublons driver-switch) → vérifs
  sur driver `file`, pas que `memory`.

## Décisions structurantes (survivent au /clear)

- **Gate env des sévérités** = 3ᵉ voie perf↔observabilité (résolu 1×, 0 surcoût prod).
- **Classification au core** (pduFlowStep) = source unique front/back.
- **ADR-0005** protège la spec du bouton audit (auto-revert SERVEUR garanti).

## Reste / prochaine session

1. 🐛 doublon driver-switch (cleanup write tap dans setActiveLogDriver).
2. onMessage WS dans TraceView (pleine page).
3. Bouton « audit à chaud » (ADR-0005 §2) — quand à préciser.
4. Bump lockstep skills studio-dev/framework-dev (2 sessions de retard).

## Commits produits

| Commit  | Sujet                                                        |
| ------- | ------------------------------------------------------------ |
| a08cef1 | feat(syslog) filtres protocole + étape (core isomorphe)      |
| f9f0666 | feat(http) audit sévérités gaté env + fix requestId teardown |
| 5330ecf | feat(studio) page Suivi de requête + filtres Logs            |
| d474ed9 | docs(adr) ADR-0005 observabilité prod                        |
