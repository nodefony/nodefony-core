---
adr: 5
title: Observabilité des logs en prod — gate env des sévérités + fenêtre d'audit à chaud
lang: fr
date: 2026-06-01
status: accepted
deciders: [Christophe CAMENSULI]
tags: [logs, syslog, perf, observabilite, securite, prod]
---

# ADR-0005 — Observabilité prod : gate env des sévérités du cycle de vie + fenêtre d'audit à chaud

## Statut

Accepté (2026-06-01).

- **Partie 1 — gate env des sévérités** : décidée **et implémentée** (commit de la session
  « filtre protocole/étape + audit sévérités »).
- **Partie 2 — fenêtre d'audit à chaud** : **spécification figée** ici, **à implémenter** en
  session dédiée (sécurité-sensible). Ce document EST la spécification protégée à respecter.

## Contexte

Les logs du cycle de vie d'une requête / connexion (events `onRequest`, `onRequestEnd`,
`Match route`, `onSend`, `onConnect`, `onMessage`, `onClose`, `onFinish`…) étaient **tous émis
en DEBUG** (centralisés dans `Context.fire/emit` côté `@nodefony/http` + le log « Match route »
du `Router`). Conséquence : une **connexion WebSocket n'avait aucun jalon visible hors DEBUG**
(asymétrie vs HTTP, dont le bilan `req` est INFO). On a voulu rendre les **jalons notables**
visibles sans activer DEBUG.

Tension fondamentale :

- **Observabilité** : voir le cycle (entrée → route → réponse → fin ; ouverture/fermeture WS)
  sans devoir activer DEBUG.
- **Performance (règle ABSOLUE du projet)** : `Context.fire/emit` est sur le **hot path** (chaque
  event de chaque requête). Promouvoir des events DEBUG→INFO **en prod** = ~3 logs INFO de plus
  par requête qui passent le filtre prod (INFO+) → ~9 MB/s d'alloc Pdu supplémentaires à
  10 000 req/s → pression GC permanente **pour rien** quand personne ne debugge.

## Décision

### Partie 1 — Gate des sévérités par environnement (implémenté)

Les jalons notables sont promus à une sévérité visible **uniquement hors production** :

| Jalon                              | Hors prod (dev/test/staging) | Production |
| ---------------------------------- | ---------------------------- | ---------- |
| `onRequest` (requête entrante)     | INFO                         | DEBUG      |
| `Match route` (route trouvée)      | NOTICE                       | DEBUG      |
| `onSend` (réponse envoyée)         | INFO                         | DEBUG      |
| `onConnect` (connexion WS ouverte) | INFO                         | DEBUG      |
| `onClose` (connexion WS fermée)    | INFO                         | DEBUG      |
| autres events techniques           | DEBUG                        | DEBUG      |
| bilan `req` (déjà existant)        | INFO                         | INFO       |

- **Coût code** : table figée module-level (lookup O(1), 0 alloc), drapeau d'env résolu **1×**
  (1ʳᵉ requête, kernel présent) puis caché. La string de log est inchangée → perf-neutre.
- **Prod = identique à avant** : tout reste DEBUG → **0 log INFO supplémentaire / requête** →
  pression GC inchangée. Implémentation : `Context.eventSeverity()` (http) + drapeau
  `routeNoticePromoted` (`Router`) gatés sur `kernel.environment` (`!== "production" && !== "prod"`).
- **Debug en prod par défaut** : on garde le **bilan `req` INFO** (méthode, URL, statut, durée,
  IP, requestId) de chaque requête + les **erreurs** ; le détail du cycle s'obtient en **montant
  le niveau de log à DEBUG** (cf Partie 2).

### Partie 2 — Fenêtre d'audit « à chaud » (spécification à implémenter)

Pour debugger en prod **sans** payer le volume en permanence : un **bouton « Audit à chaud »**
(Studio) élève la verbosité (DEBUG) pour une **fenêtre bornée** de N secondes/minutes, puis
**retour automatique** au niveau normal.

#### 🔒 Garde-fous NON négociables

1. **Auto-revert CÔTÉ SERVEUR, garanti.** Le timer de fin vit dans le **serveur**
   (`setTimeout` `.unref()` + cleanup), **JAMAIS** dans le navigateur. Si l'opérateur **oublie**,
   **ferme l'onglet** ou son **navigateur crashe** → le serveur revient seul au niveau normal au
   bout de N s. Le client ne fait que **déclencher** + **afficher** le compte à rebours (dérivé
   du status serveur).
2. **Durée BORNÉE (plafond dur).** Jamais d'audit « infini ». Plafond serveur (ex. 5 min). Un
   re-déclenchement reste sous le plafond (anti-oubli, anti-DoS de volume).
3. **Très protégé (Zero Trust).** RBAC `ROLE_NODEFONY_ADMIN` ; action sensible en prod →
   confirmation + **traçabilité** (qui a activé, quand, quelle durée) loggée en INFO (audit de
   l'audit). Détail d'erreur générique au client, précis côté serveur.
4. **Un seul audit actif** par process/pod. État **interrogeable** (`GET status` → reste Xs, par
   qui) → tout client qui se (re)connecte voit la fenêtre en cours + son échéance. Per-pod
   (cloud-native) ; fan-out cluster ultérieur.
5. **Coût NUL hors fenêtre.** Inactif = le gate reste DEBUG en prod, hot path intact. Pendant la
   fenêtre : +volume DEBUG **assumé et borné dans le temps**.

#### Esquisse (design AVANT code, en session dédiée)

- **Back** : élever runtime le filtre syslog (`Syslog.setConditions` / override de niveau) pour
  la fenêtre + `setTimeout(revert, ms).unref()` ; exposer l'échéance (`auditUntil`). Revert
  idempotent + cleanup sur `clean()`.
- **Data plane** (`SyslogAdminApi`) : `POST /nodefony/syslog/api/audit/start { durationMs }`
  (borné) · `POST …/audit/stop` · `GET …/audit/status` → `{ active, untilTs, remainingMs, by }`.
  PAS « dev-only » (c'est pour la PROD) → la garde = **RBAC strict** + plafond + trace.
- **Front (Studio)** : bouton « Audit à chaud » (page Logs) → durée (30 s / 1 / 5 min) +
  confirmation ; **bandeau « AUDIT EN COURS — reste Xs »** (countdown dérivé du `status` serveur,
  pas un timer local) + « Arrêter » ; état restauré au montage depuis `GET status`.

## Conséquences

- **Positif** : perf prod préservée (règle ABSOLUE) ; observabilité riche en dev (Studio voit le
  cycle WS en INFO) ; debug prod possible **à la demande** sans volume permanent ; sûreté garantie
  par le serveur (indépendante de la discipline opérateur / survie du navigateur).
- **Négatif / limites** : en prod par défaut, le détail du cycle n'est pas visible sans audit ;
  la fenêtre d'audit reste **à implémenter** (cette ADR la cadre). La détection prod repose sur
  `kernel.environment` — garder `"production"`/`"prod"` alignés.

## Références

- Règle perf+mémoire ABSOLUE : `CLAUDE.md` racine (§ PERF & MÉMOIRE).
- Classification d'étape isomorphe : `src/nodefony/src/syslog/drivers/pduFlow.ts` (`pduFlowStep`).
- Filtres structurés `protocol`/`flow` : `filterPdus` + `ILogQueryCriteria` + `SyslogAdminApi`.
- Mémoires IA : `project_log_audit_window_vision`, `project_request_tracking_page_vision`,
  `project_log_backplane_vision`.
