# Derrière un frontal — nginx, HAProxy, h2c, Ingress, Gateway API, Traefik

> **Maintenance** : vérité courante. Éditer en place.

## 1. La configuration se DÉRIVE, elle ne s'écrit pas

```bash
npx nodefony proxy:generate nginx      # sur la sortie standard, pour lire avant d'installer
npx nodefony proxy:generate haproxy -o haproxy.cfg
```

| Option                                    | Rôle                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `-o, --out <fichier>`                     | écrire dans un fichier plutôt que sur la sortie standard                      |
| `-b, --backend <hôte>`                    | l'adresse à laquelle le frontal joint l'application (défaut `127.0.0.1`)      |
| `-l, --listen <port>`                     | le port d'écoute du frontal (défaut `80`)                                     |
| `--reencrypt`                             | TLS jusqu'à l'application (port HTTPS) au lieu du clair sur le réseau interne |
| `--tls-cert`, `--tls-key`, `--tls-listen` | nginx seulement : le frontal termine le TLS (écoute `443` par défaut)         |
| `--assets-root <dossier>`                 | servir tous les fichiers statiques depuis un seul arbre (`assets:publish`)    |

La commande **démarre l'application sans ouvrir de port** et lit sa configuration **réelle** :
ports, domaines de confiance, dossiers statiques montés par chaque module, taille de corps
maximale, battement de cœur WebSocket, port h2c. 🔴 Elle lit la configuration **de l'environnement
où elle tourne** : lance-la avec les variables de production, sinon tu obtiens la configuration
d'un autre déploiement — par exemple sans h2c.

**Pourquoi ça compte** : une configuration écrite à la main est juste le jour où on l'écrit. Au
premier dossier statique ajouté, à la première route de téléversement, elle devient fausse — et
elle ne le dit pas : elle sert un 404 ou un 413 que personne ne rattache au frontal.

## 2. Ce que le générateur pose, et pourquoi

| Ce qui est généré                                                                 | Ce que ça évite                                                                                                                     |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-Forwarded-For` **écrasé** avec l'adresse vue du client                         | un client qui s'invente une adresse                                                                                                 |
| `Upgrade` / `Connection` relayés                                                  | une WebSocket qui « ne se connecte pas », sans le moindre message                                                                   |
| inactivité = **4 battements WebSocket, plancher 300 s**                           | un frontal qui coupe des sockets **vivantes** ; nginx `proxy_read_timeout`/`proxy_send_timeout`, HAProxy `timeout client`/`server`  |
| HAProxy : `timeout tunnel` à la même valeur                                       | une fois passée en WebSocket, la connexion n'obéit plus à `timeout server` : sans cette ligne, le défaut la coupe                   |
| `client_max_body_size` dérivé de la taille de corps de l'application              | un `413` de nginx (1 Mo par défaut) que l'application n'a jamais vu passer                                                          |
| une chaîne de `try_files` sur **toutes** les racines statiques                    | les fichiers d'un module en `404` alors qu'ils sont bien montés                                                                     |
| HAProxy : `Forwarded` entrant **effacé** avant le nôtre                           | un en-tête forgé conservé à côté du vrai                                                                                            |
| HAProxy : le schéma **constaté** sur la connexion entrante (`ssl_fc`)             | annoncer `https` pour un client venu en clair — cookies `Secure` posés sur du clair                                                 |
| HAProxy : `option httpchk GET /readyz` dans chaque backend                        | un exemplaire qui draine gardé dans la table — un contrôle TCP le croit sain tant que son port accepte (§6)                         |
| nginx avec TLS : HTTP/2 côté navigateur (`http2 on`), HTTP/1.1 vers l'application | le plafond d'environ six connexions par origine est celui du navigateur envers le **frontal** : c'est là que le multiplexage compte |

## 3. Le point qui casse tout si on l'oublie — `NF__HTTP__TRUSTPROXY`

Quand ton frontal termine le TLS, l'application reçoit du **HTTP en clair**, plus un en-tête qui
annonce le schéma d'origine. Sans réglage, elle ne croit pas cet en-tête — et c'est la bonne
position par défaut, parce qu'un en-tête est trivialement falsifiable par un client.

Conséquence si tu ne le poses pas : le schéma constaté est `http`, donc :

- **le cookie de session part sans le préfixe `__Host-`** — ce préfixe n'est posé que sur une
  origine que l'application sait sécurisée. La session marche, mais perd ce qu'il garantit (pas de
  `Domain`, donc pas de fixation de session depuis un sous-domaine), **sans aucun message** ;
- l'adresse cliente enregistrée est celle du frontal : l'audit, la limitation de débit et le
  plafond de connexions par adresse portent sur **une seule** IP — une vague de reconnexions
  WebSocket se fait alors refuser en `429` pour tout le monde ;
- les redirections peuvent pointer sur `http://` ;
- **toute connexion par mot de passe répond `403`** (« doit passer par HTTPS ») : en production,
  un secret reçu sur une requête que l'application croit en clair est refusé avant toute
  vérification. `security.allowInsecureCredentials` n'est PAS la correction — elle accepterait
  vraiment le clair ; la correction est cette variable.

```yaml
NF__HTTP__TRUSTPROXY: uniquelocal # le frontal est sur un réseau privé
```

Jamais `true` si l'application est joignable par un autre chemin que le frontal : n'importe quel
client pourrait alors écrire sa propre adresse. Dans une **cascade** (équilibreur d'hébergeur →
frontal → application), chaque saut doit être de confiance : la remontée de l'adresse se fait de
droite à gauche et s'arrête au premier inconnu.

**Le prouver, plutôt que le croire** :

```bash
curl -ksSI https://<hôte>/
# dans les en-têtes rendus, un Set-Cookie doit porter le préfixe __Host-
```

Puis **débranche-le** : retire la variable, redéploie, refais la requête. Le cookie doit tomber. Un
réglage qu'on n'a jamais vu manquer n'est pas un réglage prouvé.

## 4. Les autres réglages du mode « derrière un frontal »

| Variable                     | À poser                     | Ce qu'elle fait                                                                                                                                    |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NF__HTTP__TRUSTEDHOSTS`     | les hôtes réellement servis | Un `Host` étranger est refusé — coupe l'empoisonnement d'en-tête                                                                                   |
| `NF__APP__DOMAINCHECK`       | `"true"`                    | Contrôle du domaine actif                                                                                                                          |
| `NF__HTTP__STATICS__ENABLED` | `"false"`                   | **Le frontal sert les fichiers statiques** ; l'application cesse de les servir en double                                                           |
| `NF_OAUTH_REDIRECT_BASE`     | l'URL publique, sans chemin | Connexion par un fournisseur d'identité : sans elle, l'adresse de retour vaut `https://localhost:<port>` et le fournisseur refuse (`redirect_uri`) |

Laisser l'application servir les statiques derrière un frontal qui les sert aussi n'est pas une
erreur fonctionnelle — c'est un gaspillage silencieux : chaque fichier peut être servi par le
mauvais des deux, avec des en-têtes de cache différents.

## 5. Ne publie aucun port de l'application

Derrière un frontal, l'application **ne doit publier aucun port**. C'est la définition d'être
derrière quelque chose : le seul chemin doit passer par le frontal. C'est ce que fait le profil de
topologie de production du compose — l'application n'y a aucune ligne `ports:`.

Si tu publies quand même un port « pour déboguer », tu as deux portes d'entrée, dont une sans TLS,
sans limitation et sans les en-têtes que ton frontal pose. Utilise `docker compose exec` ou un
transfert de port temporaire.

## 6. Les sondes, vues du frontal

| Sonde     | Pour quoi                       | Pendant l'arrêt |
| --------- | ------------------------------- | --------------- |
| `/livez`  | « le process est-il vivant ? »  | **reste `200`** |
| `/readyz` | « peut-il prendre du trafic ? » | passe à `503`   |

Un frontal qui retire les exemplaires doit sonder **`/readyz`**, jamais `/livez` : c'est `/readyz`
qui bascule dès le début de l'arrêt. Les deux répondent **avant la limitation de débit** — un `429`
sur une sonde veut dire que tu n'interroges pas le chemin nu (une réécriture ajoute un préfixe).

🔴 **Ce que les configurations générées font réellement** — à savoir dès que tu mets
**plusieurs** exemplaires derrière un même frontal :

| Frontal généré | Contrôle de santé                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HAProxy        | `option httpchk GET /readyz` dans **chaque** backend : l'exemplaire est retiré dès que `/readyz` répond `503`, alors que son port accepte encore. En h2c, la sonde part sur le port HTTP en HTTP/1.1 (`check port 5151 check-proto h1`) |
| nginx          | nginx libre n'a **pas** de contrôle actif : il retire un amont après des échecs constatés, jamais sur `/readyz`                                                                                                                         |

Le chemin vient de la configuration (`health.readinessPath`) ; sondes désactivées, le générateur
retombe sur un contrôle de connexion, plutôt que d'interroger un chemin que plus rien ne sert.
Éprouvé par un HAProxy 3.0 réel sur la configuration générée : un exemplaire dont la sonde ne
répond pas `200` sort du répartiteur alors que son port accepte.

Ce que la sonde ne règle pas seule : le frontal ne la lit que toutes les deux secondes. Pose un
**délai avant drain** (`shutdownDelay`, en millisecondes) au moins égal à deux
intervalles de contrôle, pour que le frontal ait vu le `503` avant que l'exemplaire cesse
d'accepter.

## 7. Les flux SSE derrière le frontal

Un flux SSE est une réponse HTTP qui ne finit pas. Trois réglages décident s'il est bien relayé :

| Réglage                | Qui le pose                                  | Pourquoi                                                                                          |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| pas de mise en tampon  | l'application envoie `X-Accel-Buffering: no` | nginx relaie chaque événement au lieu d'attendre de remplir son tampon. Ne filtre pas cet en-tête |
| inactivité ≥ 300 s     | le générateur                                | un flux muet n'est tenu que par son battement de 15 s : vingt battements de marge                 |
| HTTP/2 côté navigateur | le générateur (nginx avec TLS)               | au-delà de six flux par origine en HTTP/1.1, le navigateur met les suivants en attente            |

Entre le frontal et l'application, chaque flux SSE occupe **une connexion** en HTTP/1.1. Beaucoup
de flux longs par pod : c'est le cas où h2c (§8) vaut la peine.

## 8. HTTP/2 jusqu'à l'application — le port h2c

Par défaut le frontal parle HTTP/1.1 à l'application. Un frontal qui termine le TLS peut aussi lui
parler **HTTP/2 en clair** (h2c, connaissance préalable) sur un port **dédié**, désactivé par défaut :

```bash
NF__APP__SERVERS__H2C__ENABLED=true     # port 5153 ; NF__APP__SERVERS__H2C__PORT pour le changer
```

**h2c n'est pas « plus rapide » par principe.** Mesuré sur une route triviale, un seul process :
débit h2c rapporté à HTTP/1.1 = **−48 %** à forme égale (64 connexions × 1 flux), **−18 %** dans la
forme d'un frontal (4 connexions × 16 flux). Le frontal garde déjà un pool de connexions HTTP/1.1
qui masque le blocage en tête de file, et HTTP/2 coûte du travail par requête (trames, compression
des en-têtes). Le choix se fait sur la **forme du trafic** :

| Forme du trafic                              | h2c ?         | Pourquoi                                                                                      |
| -------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| gRPC                                         | **requis**    | gRPC n'existe qu'en HTTP/2                                                                    |
| Beaucoup de flux SSE longs par pod           | **oui**       | en HTTP/1.1 chaque flux tient une connexion du frontal ; en h2c ils partagent                 |
| En-têtes lourds et répétés (cookies, jetons) | probable      | la compression HPACK les factorise d'une requête à l'autre                                    |
| REST classique, petites réponses             | **mesurer**   | souvent neutre, parfois perdant                                                               |
| WebSocket                                    | **non**       | reste sur le port HTTP                                                                        |
| Plusieurs workers dans un pod                | **attention** | le cluster Node répartit des connexions : avec les rares connexions h2c, un worker prend tout |

**Trois règles valent pour TOUS les frontaux :**

| Règle                                                                 | Pourquoi                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| les requêtes vont au port **h2c**, les **WebSocket** au port **HTTP** | le port h2c ne sert ni `Upgrade` ni le CONNECT étendu (RFC 8441), seul chemin d'une WebSocket en HTTP/2 |
| les **sondes** visent le port **HTTP**                                | le port h2c refuse HTTP/1.1, et une sonde de kubelet parle HTTP/1.1. Garde le port HTTP **actif**       |
| le schéma passe par `X-Forwarded-Proto` **et** `NF__HTTP__TRUSTPROXY` | en clair, l'application ne croit jamais le `:scheme` que le frontal écrit                               |

Vérifier le port, puis comparer avec le même instrument :

```bash
curl --http2-prior-knowledge http://127.0.0.1:5153/readyz
h2load --h1 -n 100000 -c 64 http://127.0.0.1:5151/<route>   # HTTP/1.1
h2load      -n 100000 -c 4 -m 16 http://127.0.0.1:5153/<route>   # h2c, forme d'un frontal
```

### HAProxy — généré

Lancé avec h2c actif, `proxy:generate haproxy` envoie les requêtes au port h2c en `proto h2` et
garde les WebSocket sur le port HTTP. Rien à écrire :

```text
  use_backend be_nodefony if { hdr(upgrade) -i websocket }
  default_backend be_nodefony_h2c

backend be_nodefony_h2c
  option httpchk GET /readyz
  http-check expect status 200
  # la sonde vise le port HTTP en HTTP/1.1 : le port h2c refuse HTTP/1.1
  server nodefony_h2c 10.0.0.12:5153 check port 5151 check-proto h1 proto h2
```

Avec `--reencrypt`, h2c est ignoré : le port TLS négocie déjà HTTP/2. **C'est la seule cible jouée
contre un frontal réel** (HAProxy 3.0, configuration générée) : requête servie en h2c, sonde lue
sur le port HTTP, WebSocket ouverte sur le port HTTP.

### nginx — reste en HTTP/1.1 vers l'application

nginx ne parle pas HTTP/2 à ses amonts (hors gRPC) : `proxy:generate nginx` ignore h2c.

### Envoy

Un cluster h2c pour les requêtes, un cluster HTTP/1.1 pour les WebSocket :

```yaml
routes:
  - match:
      prefix: "/"
      headers:
        [
          {
            name: upgrade,
            string_match: { exact: websocket, ignore_case: true },
          },
        ]
    route:
      { cluster: nodefony_http, upgrade_configs: [{ upgrade_type: websocket }] }
  - match: { prefix: "/" }
    route: { cluster: nodefony_h2c }
clusters:
  - name: nodefony_h2c # port 5153
    typed_extension_protocol_options:
      envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
        "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
        explicit_http_config: { http2_protocol_options: {} }
  - name: nodefony_http # port 5151, HTTP/1.1 par défaut
```

### Traefik

```yaml
labels:
  - "traefik.http.routers.app.rule=Host(`app.example.com`)"
  - "traefik.http.routers.app.service=app-h2c"
  - "traefik.http.services.app-h2c.loadbalancer.server.port=5153"
  - "traefik.http.services.app-h2c.loadbalancer.server.scheme=h2c"
  - "traefik.http.routers.app-ws.rule=Host(`app.example.com`) && HeaderRegexp(`Upgrade`, `(?i)^websocket$`)"
  - "traefik.http.routers.app-ws.priority=100"
  - "traefik.http.routers.app-ws.service=app-http"
  - "traefik.http.services.app-http.loadbalancer.server.port=5151"
```

> Envoy, Istio, Gateway API et Traefik : recettes tirées de leur documentation, **pas encore jouées
> contre un frontal réel**. Les éprouver avant de les déclarer justes.

## 9. Traefik sans h2c

`proxy:generate` ne connaît que nginx et HAProxy. Avec Traefik, la déclaration vit avec les
conteneurs :

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.app.rule=Host(`app.example.com`)"
  - "traefik.http.routers.app.entrypoints=websecure"
  - "traefik.http.routers.app.tls.certresolver=le"
  - "traefik.http.services.app.loadbalancer.server.port=5151"
  - "traefik.http.services.app.loadbalancer.responseforwarding.flushinterval=100ms"
  - "traefik.http.services.app.loadbalancer.healthcheck.path=/readyz"
  - "traefik.http.services.app.loadbalancer.healthcheck.interval=5s"
```

Traefik relaie `Upgrade` de lui-même et ne croit les `X-Forwarded-*` entrants que des adresses
déclarées dans `entryPoints.<nom>.forwardedHeaders.trustedIPs` : derrière un équilibreur
d'hébergeur, déclarer cet amont, sinon l'adresse cliente est perdue.

## 10. En Kubernetes — pas de configuration nginx générée

Le frontal dérivé sert pour une machine, un compose, une machine virtuelle. **Dans un cluster, ce
rôle appartient au contrôleur d'entrée** (Ingress ou Gateway API), que l'application ne connaît pas.

> 🔴 **ingress-nginx est retiré depuis mars 2026** (annonce du projet Kubernetes, novembre 2025) :
> plus de version, plus de correctif de sécurité. Les déploiements existants tournent encore, mais
> un nouveau déploiement vise la **Gateway API** ou un autre contrôleur.

| Point                           | Avec un frontal à toi   | Avec un contrôleur d'entrée                          |
| ------------------------------- | ----------------------- | ---------------------------------------------------- |
| `NF__HTTP__TRUSTPROXY`          | **obligatoire**         | **obligatoire** — le CIDR des pods du contrôleur     |
| `NF__HTTP__TRUSTEDHOSTS`        | recommandé              | recommandé                                           |
| Configuration dérivée           | oui                     | non — `Ingress`, `HTTPRoute`                         |
| Inactivité ≥ 300 s              | posée par le générateur | **à poser toi-même** — sinon les WebSocket tombent   |
| Taille de corps                 | dérivée                 | **à poser toi-même**, égale à celle de l'application |
| Qui sert les fichiers statiques | le frontal              | l'application, ou un service dédié                   |

**Si tu restes sur ingress-nginx**, les réglages que le générateur aurait posés s'écrivent en
annotations (la WebSocket, elle, passe sans rien demander) :

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-buffering: "off" # flux SSE
    nginx.ingress.kubernetes.io/proxy-body-size: "<taille de corps de l'application>"
```

**h2c sous Kubernetes** : c'est le `Service` qui déclare le protocole de chaque port, puis la route
envoie les requêtes au port h2c et `Upgrade: websocket` au port HTTP (`VirtualService` sous Istio,
`HTTPRoute` avec une règle sur l'en-tête `upgrade` sous Gateway API) :

```yaml
apiVersion: v1
kind: Service
spec:
  ports:
    - name: http # sondes, WebSocket
      port: 5151
      appProtocol: http
    - name: h2c
      port: 5153
      appProtocol: kubernetes.io/h2c # Gateway API ; Istio : http2
```

Les sondes du `Deployment` visent le port **5151**, jamais 5153.

## 11. Sous Podman sans privilèges — ce qu'on ne peut pas réparer

L'adresse source du client **est perdue** : le trafic arrive depuis la passerelle de redirection.
Derrière un frontal, l'en-tête d'adresse d'origine porte donc la passerelle, pas le client.

Ce n'est pas un réglage à trouver : c'est une propriété du mode sans privilèges. **Énonce-le** —
ton audit et ta limitation par adresse sont faux, sans aucune erreur pour le signaler. Voir
[`podman.md`](podman.md).

## 12. Symptôme → cause → correction

| Symptôme                                                 | Cause                                                                | Correction                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| La WebSocket se ferme seule au bout d'une minute         | l'inactivité du frontal est plus courte que le battement             | régénérer ; sur un contrôleur d'entrée, `proxy-read-timeout` ≥ 300 s             |
| La WebSocket ne s'ouvre pas, aucune erreur nulle part    | `Upgrade`/`Connection` non relayés                                   | régénérer ; sur une configuration écrite à la main, les ajouter                  |
| Depuis h2c, la WebSocket ne s'ouvre plus                 | le frontal l'envoie au port h2c                                      | router `Upgrade: websocket` vers le port HTTP                                    |
| Depuis h2c, le pod n'est jamais prêt                     | la sonde vise le port h2c, qui refuse HTTP/1.1                       | sonder `/readyz` sur le port HTTP                                                |
| Un flux SSE n'arrive qu'en bloc, ou à la fin             | le frontal met la réponse en tampon                                  | ne pas filtrer `X-Accel-Buffering` ; sur ingress-nginx, `proxy-buffering: "off"` |
| `413` sur un envoi que l'application accepte             | limite de corps du frontal plus basse                                | régénérer ; sur un contrôleur d'entrée, `proxy-body-size`                        |
| Les statiques d'un module en `404` derrière nginx        | une seule racine statique déclarée                                   | régénérer : la chaîne de `try_files` vient des montages réels                    |
| Des `5xx` à chaque déploiement, plusieurs exemplaires    | le frontal ne lit pas `/readyz` (§6), ou pas de délai avant drain    | régénérer le frontal (sonde `/readyz`) + `shutdownDelay`                         |
| `429` en rafale juste après un déploiement               | reconnexions comptées sur la seule adresse du frontal                | `NF__HTTP__TRUSTPROXY`                                                           |
| Toutes les adresses des journaux sont celles du frontal  | `NF__HTTP__TRUSTPROXY` absent — le défaut sûr                        | déclarer l'adresse ou le CIDR du frontal                                         |
| Une adresse cliente **forgée** apparaît dans l'audit     | confiance accordée alors que l'application est joignable directement | fermer l'accès direct, ne jamais poser `true` dans ce cas                        |
| `Invalid parameter: redirect_uri` en ligne, pas en local | `NF_OAUTH_REDIRECT_BASE` absente                                     | la poser à l'URL publique de l'application                                       |
