## Ce que l'application contient — et ce qu'elle ne contient pas

Une application GÉNÉRIQUE : ce qui est ici, tu le gardes. Aucun exemple à
supprimer avant d'écrire ton premier controller.

<% if (it.front) { %>- **Frontend <%= it.frontend %> (Vite + HMR)** — http://127.0.0.1:5151/ — une page minimale, la tienne<% if (it.complete) { %> : le nom de l'application, la connexion, le compte connecté<% } %>
<% } %><% if (it.complete) { %>- **Sécurité FERMÉE par défaut** — sans session, toute route sous `/api` répond 401 avant ton controller ; une route publique se DÉCLARE (`nodefony/config/security.ts`)
- **Connexion** — `/login`, servie par le framework ; zones `secure` (rôle exigé), `machine` (clé d'API) et `service` (jeton) prêtes, sans controller
- **Studio (console admin, dev)** — http://127.0.0.1:5151/nodefony — config, sessions, logs, routes
- **ORM + persistance** — Drizzle : sans `NF_DATABASE_URL`, sqlite locale automatique
- **Firewall + audit** — chaque requête traverse le pipeline sécurité (logs `audit`)
- **Redis (opt-in)** — `NF_REDIS_URL` présente ⇔ module chargé, stores basculent dessus
<% } %>- **Probes cloud-native** — `curl http://127.0.0.1:5151/livez` (liveness k8s)

Ton premier controller : `npx nodefony create controller hello --kind hello`
génère **une route GET et une route WEBSOCKET dans la même classe** — même
pipeline, pas deux mondes séparés. `npx nodefony create --help` liste les
autres générateurs (REST, temps réel, MCP, entité, service, commande).
