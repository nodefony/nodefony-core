# {{appName}}

Application [Nodefony](https://github.com/nodefony/nodefony-core) — générée par `nodefony create app`.

## Démarrer

```bash
npm install
npm run build        # bundle rolldown (dist/)
npm run dev          # serveur de développement → http://127.0.0.1:5151
```

## Ce que l'app démontre

| Quoi                          | Comment                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| Route HTTP                    | `curl http://127.0.0.1:5151/api/hello`                             |
| WebSocket — MÊME controller   | `npx wscat -c ws://127.0.0.1:5151/api/echo` puis tape un message   |
| Studio (console admin, dev)   | http://127.0.0.1:5151/nodefony                                     |
| ORM + persistance             | Drizzle chargé — sans `NF_DATABASE_URL` : sqlite local (users, sessions, jetons persistent) |
| Firewall + audit              | chaque requête est auditée (logs `audit`) ; zones à déclarer dans `nodefony.config.ts` |
| Realtime (canaux multiplexés) | module `@nodefony/realtime` chargé (backplane cluster, 0 dep)      |
| Redis (opt-in)                | déclare `NF_REDIS_URL` → module chargé, sessions/idempotence basculent dessus |

HTTP et WebSocket sont co-citoyens du même contexte controller — regarde
`nodefony/controllers/HelloController.ts` : une route GET et une route
WEBSOCKET dans la même classe, même pipeline (firewall, audit, logs).

## Structure

| Fichier                    | Rôle                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `nodefony.config.ts`       | LA config de l'app — uniquement les écarts aux défauts du framework   |
| `env.ts`                   | Catalogue typé des variables d'environnement (seul lecteur de `process.env`) |
| `index.ts`                 | Point d'entrée : la classe `App` (module racine) + ses controllers    |
| `nodefony/controllers/`    | Tes controllers (`@controller` + `@route`, HTTP **et** WS)            |
| `rolldown.config.ts`       | Build — délègue tout au socle `nodefony/bundler`                      |

## Production (cloud-native)

```bash
npm run build
npm start            # nodefony production — bind 0.0.0.0, logs stdout, probes /livez /readyz
```

Un process Node = un pod/container ; le scaling horizontal vient de l'orchestrateur.
Studio est chargé en dev seulement (`policy: "dev"`) — pour l'exposer en production,
protège `/nodefony` par une zone firewall puis passe la policy à `"mandatory"`.
Persistance : déclare `NF_DATABASE_URL` dans `env.ts` et ajoute `@nodefony/drizzle`
au manifeste — les stores (users, sessions, jetons) se câblent tout seuls.
