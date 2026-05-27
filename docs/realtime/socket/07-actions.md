---
slug: socket/actions
title: Actions RPC — la direction « contrôle »
section: realtime
audience: developer,architect,supervisor
version: v1.0
status: stable
updated: 2026-05-28
source: docs/realtime/socket/07-actions.md
---

> [!NOTE]
> **TL;DR.** Une **action RPC** = frame JSON-RPC **avec `id`** : le client demande,
> le serveur exécute, le serveur répond. C'est la direction « contrôle » de la
> Socket (vs lecture pub/sub). Les actions sont **découvrables** via le welcome
> (`realtime:welcome.methods`). Sécurité Zero Trust : authentification +
> autorisation + DEV-only quand pertinent.

## Pub/sub vs RPC — la distinction qui sauve

| Aspect           | Pub/sub (sans `id`)           | RPC (avec `id`)            |
| ---------------- | ----------------------------- | -------------------------- |
| Direction        | flux (1 → N)                  | requête → réponse (1 → 1)  |
| Sémantique       | « ceci s'est passé »          | « fais ceci »              |
| Latence attendue | inférieure à la milliseconde  | jusqu'à plusieurs secondes |
| Ordre            | par canal                     | par requête                |
| Retry            | inutile (perte = OK)          | possible (idempotent)      |
| Exemple          | `orm:health`, `syslog:stream` | `kernel:ping`, `kernel:gc` |

> [!TIP]
> **Confusion fréquente.** Si ton « action » n'attend pas de réponse, c'est un
> _publish_, pas un RPC. Si ton « événement » a besoin de retour, ça devient un RPC.
> Le critère = **le client a-t-il besoin de savoir si ça a marché ?**

## Le welcome — découverte des méthodes

Au handshake, le serveur envoie :

```jsonc
{
  "jsonrpc": "2.0",
  "method": "realtime:welcome",
  "params": {
    "methods": ["kernel:ping", "kernel:gc", "orm:vacuum", "cache:purge"],
    "version": "1.7.0",
  },
}
```

Studio **lit** ce welcome et active/grise les boutons : un bouton « Vacuum DB » est
visible seulement si `methods.includes("orm:vacuum")`. **Pas de hard-coding** —
ajouter une action côté serveur la rend immédiatement visible côté UI.

## Anatomie d'une requête

```ts
// CLIENT
const result = await client.request<{ rttMs: number }>("kernel:ping", {});
// → { rttMs: 0.42 }

// SERVER (RealtimeController.realtimeActions)
realtimeActions(): Record<string, ActionHandler> {
  return {
    "kernel:ping": async ({ peer }) => ({ rttMs: performance.now() - peer.lastTickAt }),
    "kernel:gc":   async ({ context, roles }) => {
      if (!roles.includes("ROLE_ADMIN")) throw new ForbiddenError("admin only");
      if (!global.gc)                    return { available: false };
      global.gc(); return { available: true, heap: process.memoryUsage().heapUsed };
    },
  };
}
```

> [!IMPORTANT]
> **Le `throw` côté serveur = `-32603` côté client.** Le message d'origine
> N'EST PAS transmis (info-leak). Le détail est loggé serveur. Pour signaler une
> erreur métier précise (autorisation, validation), lance une `RealtimeError` typée
> avec code (`-32403`, `-32602`) — `RealtimeController` la propage avec le bon
> code et un message **générique** au client.

## Méthodes core (livrées)

| Méthode       | Sémantique                             | Authorization     | DEV-only |
| ------------- | -------------------------------------- | ----------------- | :------: |
| `kernel:ping` | RTT applicatif (≠ TCP RTT)             | Aucune            |   non    |
| `kernel:gc`   | Force `global.gc()` (si `--expose-gc`) | `ROLE_ADMIN`      | **oui**  |
| `kernel:env`  | Snapshot env (clés non-secrètes)       | `ROLE_SUPERVISOR` |   non    |

> [!CAUTION]
> **`kernel:gc` doit être DEV-only.** Forcer un GC en prod = pause stop-the-world
> qui peut atteindre la seconde. Sur un service exposé, c'est une attaque DoS
> triviale. Le handler vérifie `kernel.environment === "development"` ; en prod il
> renvoie `{ available: false, reason: "production" }` même si `global.gc` existe.

## Méthodes prévues (P12 — agentic)

| Méthode              | Sémantique                            | Authorization      |
| -------------------- | ------------------------------------- | ------------------ |
| `cache:purge`        | Vider un cache par préfixe (`/orm/*`) | `ROLE_ADMIN`       |
| `orm:vacuum`         | `VACUUM` / `OPTIMIZE` sur la base     | `ROLE_ADMIN`       |
| `realtime:reconnect` | Forcer un peer à se reconnecter       | `ROLE_ADMIN`       |
| `agent:invoke`       | Lancer une tâche agentic (P12)        | `ROLE_DEV` + audit |
| `firewall:revoke`    | Révoquer une session active           | `ROLE_ADMIN`       |

Toutes ces actions devront tomber sous le **firewall P6** (RBAC), être **auditées**
(qui, quoi, quand) et présenter une confirmation explicite côté UI (cf
`/nodefony/approvals` Studio P12).

## Pattern complet — ajouter une action

```ts
// 1. Déclare l'action dans ton controller realtime
@realtimeController("/nodefony/orm/api/realtime")
class OrmRealtimeController extends RealtimeController {
  realtimeActions() {
    return {
      "orm:vacuum": async ({ roles, params, peer }) => {
        // 2. Autorisation Zero Trust
        if (!roles.includes("ROLE_ADMIN")) throw new ForbiddenError();
        // 3. Validation params (Zod recommandé)
        const { connector } = OrmVacuumParams.parse(params);
        // 4. Action métier
        const stats = await this.orm.vacuum(connector);
        // 5. Audit
        this.audit.record("orm:vacuum", { peer: peer.id, connector, stats });
        // 6. Retour générique (pas de chemins FS, pas de secrets)
        return { ok: true, freedBytes: stats.freedBytes };
      },
    };
  }
}

// 7. Côté client
const r = await client.request<{ ok: true; freedBytes: number }>("orm:vacuum", {
  connector: "main",
});
console.log(`Libéré : ${r.freedBytes} octets`);
```

> [!TIP]
> **Le bouton apparaît dans Studio automatiquement** dès que `orm:vacuum`
> figure dans `realtime:welcome.methods` ET que l'utilisateur connecté porte
> `ROLE_ADMIN`. **Aucune modif Studio** nécessaire.

## Idempotence & retries

| Action                    |       Idempotente ?        |       Retry sûr ?        |
| ------------------------- | :------------------------: | :----------------------: |
| `kernel:ping`             |             ✅             |            ✅            |
| `kernel:gc`               |      ✅ (effet : GC)       |            ✅            |
| `cache:purge` par préfixe |             ✅             |            ✅            |
| `orm:vacuum`              |             ✅             |            ✅            |
| `agent:invoke`            | ❌ (effet de bord externe) | ⚠️ avec `idempotencyKey` |
| `firewall:revoke`         |             ✅             |            ✅            |

> [!IMPORTANT]
> **Pour les actions non idempotentes**, le client DOIT envoyer un
> `params.idempotencyKey` (UUID). Le serveur garde une LRU `key → result` pendant
> N minutes — un retry avec la même clé renvoie le résultat caché plutôt que de
> ré-exécuter. Évite la double facturation, le double envoi de mail, etc.

## Timeouts & annulation

```ts
// Timeout par défaut : 30 s (configurable côté client)
const r = await client.request(
  "orm:vacuum",
  { connector: "main" },
  { timeoutMs: 120_000 },
);

// Annulation explicite (le serveur n'arrête pas pour autant — best-effort)
const ctrl = new AbortController();
client
  .request("agent:invoke", { task: "summary" }, { signal: ctrl.signal })
  .catch((e) => {
    /* AbortError */
  });
ctrl.abort();
```

> [!CAUTION]
> **`abort()` annule l'attente client, PAS l'exécution serveur.** Si l'action a
> commencé à modifier l'état, elle continue. Pour vraiment annuler côté serveur,
> il faut une action complémentaire (`agent:cancel`) qui passe l'identifiant de
> la tâche.

## Sécurité — règles non négociables

> [!WARNING]
> **Pas d'auth dans `params`.** L'identité du peer est établie au handshake (cookie
> HttpOnly, future P6). Tu ne lis JAMAIS `params.userId` pour décider de
> l'autorisation. Tu lis `peer.roles` (dérivés serveur de la session).

> [!WARNING]
> **Message d'erreur générique au client.** `-32603 "Internal error"` ou
> `-32403 "Forbidden"` — JAMAIS le contenu d'une exception, qui leak les chemins
> internes, les noms de table, les versions. Le détail va dans les logs
> serveur (avec `requestId` pour corrélation).

> [!WARNING]
> **Audit obligatoire pour les actions mutables.** Toute action qui modifie l'état
> (purge, vacuum, revoke, …) doit logger dans `audit_log` (table dédiée P6) :
> `who`, `what`, `when`, `params hash`, `outcome`. Sans audit, pas de forensics
> en cas d'incident.

> [!CAUTION]
> **DEV-only = vérification environnement, pas juste un flag UI.** Le bouton peut
> être caché côté Studio, mais le handler serveur doit AUSSI refuser hors dev.
> Sinon un attaquant qui forge la frame WS directement bypasse l'UI. Vérifié
> dans `kernel:gc`.

## Anti-patterns

> [!CAUTION]
> **Ne pas mélanger pub/sub et RPC dans un même handler.** Une action qui aussi
> `publish` un événement côté broadcast doit le faire EXPLICITEMENT en plus du
> `return` — pas remplacer la réponse par le publish. La frame `result` reste
> obligatoire (sinon client.request() timeout).

> [!CAUTION]
> **Pas de stream via RPC.** Un RPC = 1 requête, 1 réponse. Si tu veux streamer
> (résultats partiels, progression d'agent IA), ouvre un **canal pub/sub
> dédié** au démarrage (`agent:invoke:<jobId>`), retourne `{ jobId }` dans le
> `result` du RPC, et stream sur ce canal. Le client subscribe au canal AVANT
> d'envoyer le RPC pour ne rien rater (course).

## Suite

- [Vue d'ensemble](./01-vue-ensemble.md) — retour au mental model.
- [Protocole JSON-RPC](./03-protocole.md) — la grammaire des frames.
- [Backplane](./06-backplane.md) — pour propager une action cross-worker.
- [Sondes](./05-sondes.md) — la direction « observation » (sœur jumelle des actions).
