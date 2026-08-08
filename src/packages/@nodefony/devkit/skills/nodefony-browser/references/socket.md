# Le socket, de bout en bout — `socket.mjs` et le protocole qu'il parle

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans git.

`socket.mjs` pilote un endpoint temps réel Nodefony COMPLET, depuis une vraie page : accueil,
abonnement, action, latence, pont API, reconnexion. Le scénario s'exécute **dans la page** — la
connexion porte donc les cookies de session et l'`Origin` réels. Un client « à côté » n'aurait ni
l'un ni l'autre, et l'on croirait à un refus d'authentification là où il n'y a qu'un décor faux.

```bash
docker exec -e NF_BROWSER_API=/api/sante mon-app-browser node /app/see-screen/socket.mjs /chat/realtime
```

## Le protocole du fil — quatre formes de frame, à l'œil

Tout ce qui passe est du **JSON-RPC 2.0**. La nature d'une frame se lit sur `method`, jamais sur
`id` :

| Forme             | Contenu                                           | Exemple                                                                          |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Notification**  | `method` seul — aucune réponse, jamais            | `{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"orders:new"}}`       |
| **Requête**       | `method` + `id` — une réponse est due             | `{"jsonrpc":"2.0","id":1,"method":"api.request","params":{"path":"/api/sante"}}` |
| **Réponse**       | `id` seul, `result` OU `error`                    | `{"jsonrpc":"2.0","id":1,"result":{…},"meta":{"requestId":"…"}}`                 |
| **Push de canal** | notification dont le NOM du canal est la `method` | `{"jsonrpc":"2.0","method":"orders:new","params":{…}}`                           |

Deux frames servent de repères :

- **`realtime:welcome`** — la première notification poussée par le serveur : protocole, **canaux**
  annoncés, **actions** exposées, **identité résolue au handshake**. C'est la carte du territoire ;
  tant qu'elle n'est pas là, rien d'autre n'a de sens.
- **`realtime:denied`** — le refus d'une notification. Une notification n'a pas de canal de
  réponse : sans cette frame dédiée, un abonnement refusé serait indiscernable d'un canal
  silencieux. La sonde l'écoute, et son verdict `REFUSÉ` vient de là.

## Les étapes du scénario, et comment lire chaque verdict

### `accueil`

`recuApresMs`, canaux, méthodes, identité. **S'il ne vient jamais** (code de retour 65), les trois
suspects, dans l'ordre : le chemin du endpoint est faux ; la page n'est pas authentifiée (donner
`NF_BROWSER_USER` + `NF_BROWSER_LOGIN`) ; l'`Origin` de la page est refusé par le serveur. Le
réseau qui « passe » n'innocente aucun des trois.

### `abonnement`

S'abonne au canal de `NF_BROWSER_CHANNEL` — à défaut, au **premier canal annoncé par l'accueil** —
puis écoute pendant `NF_BROWSER_SOCKET_WAIT` ms (défaut 4 000).

- `OK` : au moins une poussée reçue (horodatées, tronquées, plafonnées).
- `REFUSÉ` : le serveur a poussé `realtime:denied` pour ce canal — droits insuffisants ou plafond
  de canaux. Le motif reste générique par conception : le serveur ne dit jamais QUEL droit manquait.
- `SILENCIEUX` : **pas forcément une panne.** Un canal d'événements ne pousse que quand il se passe
  quelque chose ; seul un canal d'état cadencé garantit du trafic dans la fenêtre. Avant de
  conclure, provoquer un événement, allonger la fenêtre, ou choisir un canal cadencé.

L'abonnement part **sans `id`** : c'est une notification. Envoyé avec un `id`, il serait classé
requête, ne trouverait aucun handler, et récolterait un `-32601` — piège classique du protocole.

### `latence`

Mesure `NF_BROWSER_PINGS` allers-retours (défaut 5) sur une méthode **corrélée** : l'action de
`NF_BROWSER_ACTION` si elle est donnée, sinon le pont API si `NF_BROWSER_API` l'est. Rend chaque
mesure, les expirations, et la **médiane** — jamais la moyenne, qu'un seul aller-retour aberrant
(ramasse-miettes, réveil de connexion) suffit à déplacer.

- **Sans méthode corrélée, pas de latence** : la notification `ping` du battement de cœur est un
  no-op serveur, aucun pong n'en revient. Verdict `NON MESURÉE`, jamais un zéro inventé.
- **`RÉPOND EN ERREUR -32601`** : l'aller-retour est COMPLET — la latence mesure le fil, mais ne
  valide pas l'action, qui n'existe pas sur cet endpoint. Lire `methodes` dans l'accueil avant
  d'appeler.

### `api`

Rejoue une route HTTP de l'application **sur le socket** (`api.request`, `params.path`). La réponse
porte le `result` de la route et, souvent, un champ frère `meta` (identifiant de requête serveur) —
la preuve que le plan de données passe bien par le WebSocket. Une erreur corrélée (`-32601` si le
pont n'est pas exposé sur cet endpoint, erreur applicative sinon) est rendue telle quelle.

### `reconnexion`

Ferme le socket (code 1000), en rouvre un, attend le nouvel accueil, et compare l'identité.
`memeIdentite: true` prouve que l'identité est portée par la **session** (résolue au handshake,
jamais dans les frames) : c'est la propriété qui compte pour une application qui reconnecte en
production. Un `ÉCHEC` ici avec un premier accueil réussi désigne un serveur qui refuse la
DEUXIÈME connexion — plafond de connexions, ou état serveur consommé par la première.

## Variables d'environnement

| Variable                   | Rôle                                                                 | Défaut            |
| -------------------------- | -------------------------------------------------------------------- | ----------------- |
| `NF_BROWSER_SOCKET`        | chemin du endpoint (ou 1er argument) — **requis**, rien n'est deviné | —                 |
| `NF_BROWSER_PAGE`          | page ouverte AVANT le socket — elle porte cookies et `Origin`        | `/`               |
| `NF_BROWSER_CHANNEL`       | canal à écouter                                                      | 1er canal annoncé |
| `NF_BROWSER_ACTION`        | action RPC à appeler (la latence la réutilise)                       | aucune            |
| `NF_BROWSER_ACTION_PARAMS` | paramètres JSON de l'action                                          | aucun             |
| `NF_BROWSER_API`           | chemin rejoué par le pont `api.request`                              | aucun             |
| `NF_BROWSER_SOCKET_WAIT`   | fenêtre d'écoute du canal (ms)                                       | 4000              |
| `NF_BROWSER_PINGS`         | nombre de mesures de latence                                         | 5                 |

Plus les variables communes à toutes les sondes : `NF_BROWSER_BASE`, `NF_BROWSER_LOGIN`,
`NF_BROWSER_USER`, `NF_BROWSER_PASSWORD`.

## Quand cette sonde se trompe

- **Elle parle le protocole à la main, sans la bibliothèque cliente.** C'est voulu — on observe le
  FIL, pas une surcouche — mais ce que la bibliothèque ferait en plus (reconnexion automatique,
  ré-abonnements, cadence adaptative) n'est PAS exercé ici : la « reconnexion » du scénario prouve
  que le serveur accepte une nouvelle connexion authentifiée, pas que le client de l'application
  reconnecte bien.
- **La fenêtre d'écoute échantillonne.** Trois poussées en 4 s ne disent rien du débit de pointe ni
  d'une fuite lente — c'est `watch.mjs`, plus longtemps, qui observe une dérive.
- **Une latence médiane de quelques millisecondes est celle du conteneur vers l'hôte** — un
  aller-retour local. Elle borne le coût du protocole, elle ne prédit pas la latence d'un
  utilisateur réel derrière un réseau.
