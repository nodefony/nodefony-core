# CLAUDE.md — @nodefony/redis

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (gotchas, config, lifecycle)
- [`README.md`](./README.md) — usage humain
- [`docs/`](./docs/) — doc vulgarisée surfacée dans Studio `/nodefony/documentation`
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Mémoires IA : `feedback_config_validation_zod`, `project_p13_realtime_finish_plan`,
  `project_decisions_realtime_isomorphic`

## Rôle du module

Fournisseur d'**accès Redis générique** (lib `redis` v6). Gère N connexions nommées à partir
d'une config validée par Zod, expose le **client brut** par connexion. N'impose aucun usage
(cache / sessions / queue / pub/sub / verrous…). C'est une brique d'infra **consommée** par
d'autres couches — il ne contient aucune logique métier.

## Décisions techniques figées

| Sujet               | Décision                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lib**             | `redis` v6 (node-redis). `createClient({ socket, username, password, database, name, maintNotifications })`. `reconnectStrategy` dans `socket`.                                                          |
| **RESP3 (v6)**      | RESP3 = protocole par défaut v6 (assumé : set/get/pub/sub inchangés côté API). `maintNotifications: "disabled"` forcé (Redis OSS, pas Enterprise → déterministe). Fallback si souci pub/sub : `RESP: 2`. |
| **Fermeture (v6)**  | `client.close()` (graceful, drain) — `quit()`/`QUIT` dépréciés. `destroy()` = forcé (non utilisé).                                                                                                       |
| **Config**          | Source de vérité = `nodefony/config/schema.ts` (Zod). Builder `defineRedisConfig` valide + applique l'env + gèle. Style realtime.                                                                        |
| **Env layering**    | `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` appliqués APRÈS le parse (schéma reste pur, déterministe, JSON Schema).                                                                     |
| **3 connexions**    | `main` (commandes/storage), `publish`, `subscribe`. Raison : un client abonné ne peut plus émettre de commandes (protocole Redis).                                                                       |
| **reconnect**       | Politique déclarative (`baseMs`/`maxMs`/`maxRetries`) → fonction `reconnectStrategy` construite au runtime (Zod ne sérialise pas).                                                                       |
| **Pas de `cci-vm`** | Défaut `localhost:6379` ; jamais d'hôte d'infra hardcodé. Aligné `docker/docker-compose.yml`.                                                                                                            |
| **`prefix` legacy** | Supprimé (pas natif redis v6 → cassé). À reporter en concept app-level si besoin.                                                                                                                        |
| **Tests**           | Vitest + coverage v8 (convention universelle, cf `feedback_test_framework_vitest`). Unitaires sans serveur ; intégration = docker.                                                                       |

## Perf & mémoire (règle absolue)

- Map de connexions en **lazy alloc** (`null` jusqu'à la 1ʳᵉ connexion).
- `Connection` conserve ses handlers et fait **`removeListener` explicite** à `close()`.
- Fermeture déterministe au `kernel.once("onTerminate")`.

## Structure

```
@nodefony/redis/
├── index.ts                         ← Module + onKernelRegister (validate) + exports
├── package.json / rollup / tsconfig ← NE PAS MODIFIER rollup/tsconfig sans accord
├── vitest.config.ts
├── CLAUDE.md / MEMORY.md / README.md
├── docs/{index,architecture,configuration}.md
└── nodefony/
    ├── config/{schema.ts, defineRedisConfig.ts, config.ts}
    ├── interfaces/{IRedisConfig.ts, index.ts}
    ├── service/redis.ts             ← RedisService
    ├── src/{Connection.ts, buildClientOptions.ts}
    └── tests/unit/config.test.ts
```

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json` (zod ajouté à `external` + tests exclus le 2026-05-28).
- Lire `process.env` dans `schema.ts` (le schéma doit rester pur → env dans le builder).
- Coder le `RedisBackplane` (P13.5) ou `RedisSessionStorage` (P5.12) DANS ce module — ce sont
  des **consommateurs** (realtime / security) qui importent `RedisService`.
- Hardcoder un hôte ou un secret.

## Roadmap

| Étape                                    | Statut          | Note                                                   |
| ---------------------------------------- | --------------- | ------------------------------------------------------ |
| **P13.2** Refonte config/doc/conventions | ✅ 2026-05-28   | Zod + env + 3 connexions propres + reconnect + cleanup |
| Tests d'intégration (connexion réelle)   | ⬜              | `tests/integration/` avec docker compose Redis         |
| **P13.5** `RedisBackplane` (realtime)    | ⬜ Bloc B       | Consomme ce module (pub/sub) derrière `IBackplane`     |
| **P5.12** `RedisSessionStorage`          | ⬜ bonus Bloc B | Consomme la connexion `main`                           |
