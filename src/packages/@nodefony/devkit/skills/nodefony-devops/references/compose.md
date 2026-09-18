# Le `compose.yaml` — services, profils, topologie

> **Maintenance** : vérité courante. Éditer en place.

## 1. La règle qui explique tout le fichier : les profils

**Rien de ce qui n'est pas dans un profil actif ne démarre.** Les services d'infrastructure dont
l'application a besoin — cache, base de données — n'ont **pas** de profil : ils démarrent avec un
`docker compose up -d` nu. Tout le reste est derrière un profil, et c'est ce qui rend le fichier
utilisable en développement comme en production.

```bash
docker compose up -d                        # le décor : cache + base. C'est ce qu'il faut pour `npm run dev`
docker compose --profile app up -d          # + l'application en conteneur, port publié
docker compose --profile edge up -d         # la TOPOLOGIE DE PRODUCTION : frontal + application SANS port
docker compose --profile tools up -d        # les explorateurs de données
docker compose --profile loki up -d         # journalisation centralisée + tableaux de bord
docker compose --profile browser up -d      # un navigateur piloté
```

> Le profil `app` et le profil `edge` sont **exclusifs par nature** : le premier publie un port sur
> ta machine, le second ne publie rien du tout et laisse le frontal être la seule porte d'entrée.
> Les lancer ensemble démarre deux exemplaires de l'application.

## 2. Les services

| Service                    | Profil        | Image                                                | Port publié _(sur `127.0.0.1` uniquement)_ |
| -------------------------- | ------------- | ---------------------------------------------------- | ------------------------------------------ |
| `redis`                    | _(aucun)_     | `redis:8-alpine`                                     | `6379`                                     |
| la base _(selon le choix)_ | _(aucun)_     | selon le dialecte retenu à la création               | `5432` ou `3306`                           |
| `migrate`                  | `app`, `edge` | l'image de l'application                             | aucun                                      |
| `app`                      | `app`         | l'image de l'application                             | `5251` → `5151`                            |
| `app-edge`                 | `edge`        | l'image de l'application                             | **aucun, volontairement**                  |
| `edge`                     | `edge`        | construite avec `--target edge`                      | `8080`, `8443`                             |
| `redisinsight`             | `tools`       | explorateur du cache                                 | `5540`                                     |
| `loki` / `grafana`         | `loki`        | journaux et tableaux de bord                         | `3100`, `3000`                             |
| `browser`                  | `browser`     | navigateur piloté (image **épinglée par empreinte**) | `3001`                                     |

**Les ports sont publiés sur la boucle locale**, pas sur `0.0.0.0`. Une base de développement
accessible depuis le réseau est une base de développement qui finit indexée.

Le service de la base n'existe que si tu as retenu un dialecte serveur à la création. En SQLite, il
n'y a pas de service : la base est un fichier dans le volume de l'application.

## 3. L'ordre de démarrage — et le service `migrate`

C'est le point du fichier qui mérite d'être lu, parce qu'il encode une règle de production.

```
redis (sain) ┐
             ├──► migrate (jusqu'à SUCCÈS) ──► app / app-edge ──► edge (app-edge sain)
base  (saine)┘
```

`app` ne démarre pas sur `migrate` _lancé_, mais sur `migrate` **terminé avec succès**. Un schéma à
jour avant le premier exemplaire, toujours, sans que tu aies à t'en souvenir. Si `migrate` échoue,
l'application **ne démarre pas** — c'est le comportement voulu : mieux vaut pas d'application qu'une
application qui écrit dans un schéma qu'elle ne comprend pas.

Les dépendances vers le cache et la base attendent leur **état de santé**, pas leur démarrage.

## 4. Les deux ancres partagées

Le fichier ne se répète pas : trois services de l'application dérivent d'un même modèle.

| Ancre           | Ce qu'elle porte                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `x-app-env`     | L'URL de la base — pointée vers le **nom de service** du compose, pas `127.0.0.1` — et l'URL du cache                                     |
| `x-app-service` | La construction, le nom d'image local, `restart: unless-stopped`, le réseau, les volumes, **`stop_grace_period: 20s`** et les dépendances |

> 🔴 **`stop_grace_period: 20s` n'est pas décoratif.** Le défaut de Docker est **10 s**, et le drain
> de l'application est borné à **15 s** : au défaut, chaque `docker compose down` tuerait
> l'application au milieu de son drain — code de sortie `137`, requêtes en vol perdues, aucun
> message. Si tu écris ton propre compose, reporte ce réglage.

> 🔴 **L'URL de la base du compose ne se reporte JAMAIS dans un manifeste Kubernetes.** Elle
> désigne un service du compose ; le même nom dans un cluster désigne un Service qui n'existe pas.
> Rien ne casse au déploiement, tout casse au premier accès.

## 5. Le profil `edge` — la topologie de production, en local

C'est le profil qui mérite le plus d'attention : il reproduit une production, sur ta machine.

- **`app-edge` ne publie aucun port.** Elle n'est joignable que par le réseau du compose. C'est
  exactement ce qu'est une application derrière un frontal : injoignable directement.
- Elle reçoit des variables que `app` n'a pas :

| Variable                     | Valeur           | Pourquoi                                                                                                                         |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NF__HTTP__TRUSTPROXY`       | `uniquelocal`    | Le frontal est sur le réseau privé du compose. Sans ça, le schéma constaté serait `http` et le cookie `__Host-` ne partirait pas |
| `NF__HTTP__TRUSTEDHOSTS`     | les hôtes servis | Un `Host` étranger est refusé                                                                                                    |
| `NF__APP__DOMAINCHECK`       | `"true"`         | Le contrôle de domaine est actif, comme en production                                                                            |
| `NF__HTTP__STATICS__ENABLED` | `"false"`        | **C'est nginx qui sert les fichiers statiques**, pas l'application                                                               |

- `edge` monte les certificats **en lecture seule depuis le disque** — ils ne sont pas dans
  l'image. Voir [`secrets.md`](secrets.md).
- `edge` attend que `app-edge` soit **saine**, pas seulement démarrée.

```bash
docker compose --profile edge up -d --build
curl -kfsS https://localhost:8443/          # par le frontal, pas par l'application
```

## 6. Volumes et réseau

Volumes nommés : un par service qui garde quelque chose — le cache, la base, les explorateurs, les
tableaux de bord — plus **un pour les données de l'application** (son dossier `var`).

Le réseau est un pont nommé d'après l'application, **sans sous-réseau figé** : figer un sous-réseau
provoque des collisions dès qu'une autre pile tourne sur la même machine, et le symptôme
(`Pool overlaps with other one`) ne dit pas laquelle.

## 7. Les gestes courants

```bash
docker compose ps                                  # ce qui tourne, et l'état de santé
docker compose logs -f app                         # suivre
docker compose --profile edge down                 # arrêter CE profil
docker compose down -v                             # ⚠️ supprime AUSSI les volumes : base et cache PERDUS
docker compose run --rm migrate                    # jouer les migrations seules
docker compose config                              # le fichier RÉSOLU — variables substituées
```

`docker compose config` est le geste qui tranche quand « la variable ne fait rien » : il montre ce
que Docker a **réellement** compris, substitutions comprises.
