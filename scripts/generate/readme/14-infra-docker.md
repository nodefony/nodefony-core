<% if (it.complete) { %>
## Infra de développement (docker)

<% if (it.db) { %>Tu as retenu **<%= it.db.label %>** à la création : le `compose.yaml` ne porte que
ce service (plus Redis), et `.env` déclare déjà `NF_DATABASE_URL` dessus. Lance
l'infra **avant** l'app :

```bash
npm run infra:up     # docker : Redis + <%= it.db.label %> (le compose ne porte qu'eux)
npm run dev
npm run infra:down   # arrêt (les volumes survivent)
```

Redis n'est utilisé que si `NF_REDIS_URL` est déclarée — sinon l'app reste en
mémoire de process, ce qui suffit tant qu'elle tourne en un seul exemplaire :

```bash
NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"   # dans .env
```

Repasser en **sqlite locale** : commente `NF_DATABASE_URL` dans `.env`, rien
d'autre. Le dialecte SQL est déduit du **scheme de l'URL** (`postgres://`,
`mysql://`, `sqlite:`) — changer de base ne change **rien d'autre** dans l'app.
Les mots de passe par défaut du compose sont publics, pour le dev local uniquement.
<% } else { %>L'app démarre **sans docker** : la base est une **sqlite locale** (`var/databases/`),
retenue à la création. Le `compose.yaml` fournit le cran au-dessus :

```bash
npm run infra:up                          # Redis (sessions partagées, realtime multi-process)
docker compose --profile loki up -d       # + Loki + Grafana (logs centralisés)
npm run infra:down                        # arrêt (les volumes survivent)
```

<% if (it.complete) { %>### Éprouver la topologie de PRODUCTION — l'app derrière son frontal

En production ton application vit derrière un proxy, et c'est lui qui décide de
l'adresse cliente retenue, du protocole annoncé et du sort d'une WebSocket
silencieuse. Le profil `edge` monte cette topologie en local — l'application en
image, **sans aucun port publié**, et un frontal nginx devant :

```bash
npx nodefony http:certificates            # une fois — le certificat de développement
docker compose --profile edge up -d --build
curl -k https://localhost:8443/api/hello
```

La configuration du frontal n'est pas écrite : elle est **dérivée de ton
application** à la construction de l'image (`nodefony proxy:generate nginx`),
avec tes hôtes de confiance, tes fichiers statiques, ta taille de corps acceptée
et le battement de tes WebSockets. Tu changes l'application, tu reconstruis : la
configuration suit.

Rejouer ta suite de bout en bout **à travers le proxy**, sans la modifier :

```bash
NF_E2E_BASE_URL=https://localhost:8443 \
NODE_EXTRA_CA_CERTS=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem \
  npm run test:e2e
```

> Le certificat est **monté**, jamais gravé dans l'image : une clé privée dans
> une image reste lisible par qui la télécharge, même effacée par une couche
> suivante. En production, c'est ton hébergeur ou ton ingress qui le fournit.

<% } %>Câblage côté app — une variable, tout le reste se dérive (`store: "auto"`) :

```bash
NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"   # dans .env
```

Pour passer sur une vraie base SQL : déclare `NF_DATABASE_URL`. Le dialecte est
déduit du **scheme de l'URL** (`postgres://`, `mysql://`, `sqlite:`) — changer de
base ne change **rien d'autre** dans l'app. Le service docker correspondant n'est
pas dans ce `compose.yaml` (une app y retient un seul dialecte) : ajoute-le, ou
recrée une app avec `nodefony create app <nom> --database postgres`.
<% } %><% } %>
