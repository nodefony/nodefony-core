## Visite guidée — ce que l'app démontre

- **Route HTTP** — `curl http://127.0.0.1:5151/api/hello`
- **WebSocket, _même controller_** — `npx wscat -c ws://127.0.0.1:5151/api/echo` puis tape un message
<% if (it.front) { %>- **Frontend <%= it.frontend %> (Vite + HMR)** — http://127.0.0.1:5151/ — l'app fetch le backend via `/api`
<% } %><% if (it.complete) { %>- **Studio (console admin, dev)** — http://127.0.0.1:5151/nodefony — config, sessions, logs, routes
- **ORM + persistance** — Drizzle : sans `NF_DATABASE_URL`, sqlite locale automatique
- **Firewall + audit** — chaque requête traverse le pipeline sécurité (logs `audit`)
- **Temps réel — socket Nodefony** — `nodefony/controllers/LiveController.ts` : canal `live:events` (alimenté par `live:say`, jamais par une horloge) + RPC `live:ping`<% if (it.front) { %> — la carte « Temps réel » de la page d'accueil le consomme par la façade client<% } %>
- **Redis (opt-in)** — `NF_REDIS_URL` présente ⇔ module chargé, stores basculent dessus
<% } %>- **Probes cloud-native** — `curl http://127.0.0.1:5151/livez` (liveness k8s)

Le différenciateur Nodefony tient dans `nodefony/controllers/HelloController.ts` :
**une route GET et une route WEBSOCKET dans la même classe** — même pipeline,
pas deux mondes séparés.
