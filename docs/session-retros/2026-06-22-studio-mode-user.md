---
date: 2026-06-22
focus: Studio MODE USER dual-audience (front) — visibilité par rôle + régression socket fixée
---

# Session retro — 2026-06-22 — Studio mode user (4ᵉ du jour)

## Fait

- **Mode user dual-audience FRONT livré** (commit `1ff7d2bf`, 17 fichiers, `@nodefony/studio/frontend`).
  Visibilité par rôle de bout en bout : helper `isVisibleForRoles` (admin voit tout) + `VIEW_ROLES`
  source unique ; `RoleGuardOutlet` coupe les pages admin en deep-link ; catégorie `account` + blocs
  self profil/clés ; bureaux par rôle + template « Mon compte » + « + » filtré (bump localStorage v3) ;
  Sessions admin-only ; docs persona=rôle ; purge user-scoped au vrai changement de compte.
- **Décision archi persistance Studio** posée + gravée en kit (store prefs back pluggable) — pas codée.
- **Fix régression bloquante** (socket disconnect au boot → spinner timeout via le pont).

## Coûts / frictions

- **Gros chantier d'un coup (11 fichiers routing/auth/socket) → régression.** Le bump de visibilité a
  exposé un bug latent (disconnect socket au boot coupait les requêtes du pont en vol). Leçon : sur du
  **routing/auth/socket sensible, incrémenter + valider visuellement TÔT**, ne pas balancer 11 fichiers.
- **Itération aveugle évitée par l'image Network du user** : je ne trouvais pas la « boucle » par
  lecture ; l'image (« 8 / 164 ») a tranché en 1 coup (8 fetch ×2, pas un emballement → spinner =
  timeout du pont). Confirme la règle « demander 1 fait observable TÔT, pas itérer à l'aveugle ».
- **Bonne décision** : le user a soulevé la dette persistance (bureaux = localStorage) → tranché (store
  prefs back) + kit, **sans sur-construire à chaud**. Réflexe « décider + graver, coder plus tard ».
- **Self-service ≠ uniforme** : présumé que Sessions avait un mode self comme ApiKeys → 403 (Sessions
  n'a que l'endpoint admin). Vérifier l'endpoint AVANT de présumer un « mode mine » self-service.

## Recommandations

1. Sur routing/auth/socket → petits lots validés visuellement (pas 11 fichiers d'un coup).
2. Diag runtime React qu'on ne reproduit pas en lecture → image console/Network du user au 2ᵉ aller-retour.

## Commits produits

| Commit     | Sujet                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| `1ff7d2bf` | feat(studio): mode user dual-audience — visibilité par rôle + bureaux self-service |
| (docs)     | skill nodefony-studio-dev 1.29.0 (retex) + mémoires IA                             |

## Reste

BACK `sessions/mine` (self anti-IDOR) → `account.sessions` + Sessions réactivé user + page profil.
Pousser `1ff7d2bf`. Cf `project_studio_mode_user_kit` + `project_studio_preferences_backend_kit`.
