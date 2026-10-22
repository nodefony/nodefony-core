# Changelog

Format : [Common Changelog](https://common-changelog.org/) — catégories fermées et
ordonnées, une entrée par ligne, à l'impératif, chacune référençant son commit.
Versions selon [Semantic Versioning](https://semver.org/).

Les sections naissent d'un BROUILLON rendu par `npm run release` depuis les messages
de commit, puis sont RÉÉCRITES à la main : un journal git est écrit pour l'auteur,
un changelog pour celui qui met à jour.

## 10.0.0-beta.4 - 2026-10-22

_La ligne bêta casse encore : chaque rupture ouvre sa catégorie et porte son geste de migration — et toutes les sessions sont à rouvrir après la mise à jour._

### Changed

- **http (breaking):** Séparer les paramètres d'URL du corps de la requête : `query` ne porte plus les champs du corps, `queryGet` devient `query`, `queryPost` devient `body` et `queryFile` devient `files`, sur la requête, le contrôleur et leurs interfaces, sans alias ; `@Body()` et `@UploadedFile(s)()` sont inchangés (#632) (2dbc7ad0a, fb5652b87, bc0f106f7)
- **http (breaking):** Réduire `context.type` à `http` ou `websocket` : lire le chiffrement sur `scheme` (`https`, `wss`) et HTTP/2 sur `alpnProtocol === "h2"` ; `ServerType` vaut `http`, `https`, `ws` ou `wss` (#639) (b1e835da1)
- **http (breaking):** Refuser un handshake WebSocket par un statut HTTP (401, 403, 421, 400, 429) avant le 101, au lieu d'ouvrir puis de fermer en 1008 ou 1002 ; `HttpKernel.onWebsocketRequest` devient `onWebsocketUpgrade` et `IRouteResolver` exige `authorizeAction` (bd101c6d0)
- **http (breaking):** Livrer à `@Body()` un corps non décodé tel qu'il est reçu — chaîne pour `text/*`, `Uint8Array` pour le reste — au lieu de `{}` (908dba525)
- **realtime (breaking):** Échanger des `Uint8Array` des deux côtés de la socket : `onBinary` en livre un, `sendBinary` l'exige, `RealtimeFrameData` perd `Blob` et `IRealtimeSocket` ne déclare plus `request` (#630) (1df6614c1)
- **core (breaking):** Ne plus résoudre un paramètre de constructeur par son type — le nommer par `@Inject("nom")` ; l'export `inject` disparaît de `nodefony` (94a41a0bd)
- **ai (breaking):** Déplacer le moteur MCP du cœur dans `@nodefony/ai` (`declareMcpTools`, `collectMcpTools`, `handleMcpMessage`, flux, progression, gardes) et le catalogue `nodefony_*` dans `@nodefony/devkit` ; le préfixe `nodefony_` est réservé aux modules `@nodefony/*` (fe3f75fd0, 09be9c873)
- **security (breaking):** Lier sessions, jetons et clés d'API à l'identifiant immuable du compte : ceux émis avant cette version sont refusés, chaque utilisateur se reconnecte et chaque clé d'API se réémet (#139) (f1f98bf8a, 21a558d6c)
- **security (breaking):** Couper les sessions et les jetons d'un compte au changement de son mot de passe ; une table `User` possédée par l'application gagne la colonne `credentialsVersion` (`orm:generate` puis `orm:migrate`) (285111041)
- **security (breaking):** Renommer la commande `security:token` en `security:mcp:token`, sans alias (31b80b4df)
- **scaffold (breaking):** Faire de `@nodefony/ai` un module obligatoire des applications générées : une application existante ajoute la dépendance et l'entrée `use("@nodefony/ai")` avant devkit (ada2a0d57)
- **nodefony (breaking):** Ajouter des membres requis aux interfaces publiques `IContext`, `IWebsocketContext`, `IHttpRequest`, `IController`, `IRouteResolver`, `IProcessHealth`, `IUserRow`, `IDevkitService`, `ProfileEntry`, `PlaygroundAction` et `IRealtimeHarness` — une implémentation maison doit les fournir (mesuré par release:api-diff)
- **http:** Répondre en HTTP/2 par un seul `end(corps)`, sans copier les en-têtes (#570) (106b9e1b9)
- **http:** Ne plus allouer de tableau de fichiers pour une requête sans envoi de fichier (e36a06ff2)
- **core:** Accélérer la fusion profonde d'`extend`, à résultat identique (06acbcaf7)
- **cli:** Répondre à `--version` avant de charger le cœur (b03a3bef3)
- **devkit:** Alléger les résultats MCP que relit l'agent de code (eb44e6750)

### Added

- **ai:** Ouvrir une porte MCP d'application sans recoder le protocole — la définir une fois, la servir d'une ligne, la générer par `create controller --kind mcp`, outils publics sans jeton et outils réservés à un scope (#602) (fe390f7da, feca58f2d, 4a202f783, 1d1da5790)
- **ai:** Servir les outils MCP en stdio par `nodefony ai:stdio`, pour les agents qui lancent eux-mêmes leur serveur, avec la posture de l'opérateur local (#462) (466dd8e45, ef960a896)
- **ai:** Faire agir un outil MCP au nom du compte du jeton, et le générer ainsi (#648) (ad824af55, 31dbcfed7)
- **ai:** Exiger un scope par argument d'outil MCP, demandé par un défi `insufficient_scope` (#650) (f56a8e94c)
- **ai:** Ouvrir le flux d'un appel MCP qui tarde, même sans `progressToken` (94d82930e)
- **ai:** Publier quels outils MCP lisent et lesquels modifient, et guider ces annotations à la génération (e0076add5, e28712713)
- **ai:** Poser le module `@nodefony/ai` par `nodefony create module` (c34f369b7)
- **devkit:** Observer l'application qui tourne depuis l'agent de code (`nodefony_observe`), journal des 5xx joint et rapport partiel si le serveur s'arrête (65499da81, 20f7f4734, 24aaaae64)
- **devkit:** Profiler une route en lui envoyant N requêtes au nom d'un compte (`nodefony_profile_route`), par une session à ticket à usage unique (#644) (2e27e5b4d, 9df7d82b1)
- **http:** Servir HTTP/2 en clair (h2c) derrière un proxy inverse (`servers.h2c`), et y diriger le HAProxy que génère `proxy:generate` (#570) (1fcea6afb, cf615a979)
- **http:** Agréger les profils de requêtes par route, phase et forme SQL, et les lire au fil de l'eau en comptant ce qui a été perdu (eb441be8b, 7eea3d333)
- **framework:** Valider et typer une route par un schéma déclaré (908dba525)
- **realtime:** Acquitter les abonnements pour dire quand le flux arrive (71055b999)
- **client:** Distinguer un refus d'une panne quand l'ouverture d'une socket échoue (c41a1e804)
- **security:** Borner les scopes d'une application aux rôles du compte (#604) (1d1f30f68)
- **cli:** Afficher la documentation d'une commande sous toute erreur d'usage (a1518519d)
- **doctor:** Signaler le jeton MCP expiré d'un agent, avec la commande qui le renouvelle (b0d361927)
- **scaffold:** Tirer les clés de production dans la CI de l'application générée (6348ac17a)

### Removed

- **framework (breaking):** Retirer le ré-export `graphql` et ses trois dépendances — importer directement `@graphql-tools/merge` et `@graphql-tools/schema` (e652fe3f7)
- **devkit (breaking):** Retirer `McpController.unsupported` (mesuré par release:api-diff)
- **http (breaking):** Retirer `Http2Request.resolveScheme` (mesuré par release:api-diff)
- **core:** Retirer la dépendance `chokidar` : les sources de développement sont surveillées par `fs.watch` natif (4a6bd3d87)

### Fixed

- **ai:** Refuser un appel relayé sur une porte MCP locale, même arrivé du loopback, et sur la porte de session par ticket (#648) (4a961fac8, bc2e1538d)
- **ai:** Honorer l'annulation MCP envoyée par notification (#647) (c2138c460)
- **security:** Purger les sessions et jetons hérités à la création d'un compte, et journaliser la brique en échec de la cascade de révocation (#139) (36f6d9423, 9013d7609)
- **security:** Reconnaître les jetons que l'application signe elle-même, révocation comprise (649d28143)
- **security:** Masquer le mot de passe d'une URL dans la configuration exposée, quelle que soit sa clé (44960db06)
- **security:** Nommer `NF_TLS_CA_FILE` quand l'autorité d'un serveur n'est pas reconnue (af8ed2c8d)
- **security:** Dire que `--ttl` de `security:mcp:token` se compte en minutes, et rappeler les rôles de plateforme en INFO hors production (98d631744, 6ad55f91e)
- **http:** Ne plus journaliser la valeur des cookies posés (#645) (77e4cf1a8)
- **http:** Drainer HTTP/2 par GOAWAY au lieu de couper les flux en vol, et ne plus retenir chaque session fermée jusqu'à son délai (#570) (c7bfb348e, 33cea43d8)
- **http:** Ne plus croire le pseudo-en-tête `:scheme` d'une requête HTTP/2, et lire `Host` en l'absence de `:authority` (241728efa, e557e180b)
- **http:** Faire sonder `/readyz` au HAProxy généré au lieu d'un simple contrôle TCP (c7a913974)
- **http:** Ne plus bloquer le démarrage sur une autorité de développement déclarée mais absente (#608) (9b462aaba)
- **http:** Terminer par un saut de ligne le `fullchain.pem` auto-signé (fc27048a8)
- **http:** Journaliser un handshake WebSocket refusé en WARNING avec son statut, et taire les frames destinées à un client parti ou les sessions HTTP/2 qu'une sonde a réinitialisées (b39c214c5, 70058ea23, 5a4c9876a)
- **http:** Ramener en DEBUG les étapes de requête que le développement imprimait (dc227e37a)
- **http:** Compter au profileur une réponse en flux abandonnée en 499, un refus 401/403 hors des erreurs serveur, et ne rapporter que les requêtes servies, dans un anneau par provenance (#646, #649) (457b7389b, 71f828096, 556627c8f, 44599f982, 62e61d3ff)
- **framework:** Empêcher une clé de query d'atteindre le prototype de sa copie (#632) (c8d9618a5)
- **framework:** Ne plus poser `Upgrade` et `Connection` sur un 426 en HTTP/2 (47713b59a)
- **realtime:** Ne plus lire en texte les trames binaires reçues, ni écarter en silence côté client une trame illisible (392c9e09e, e01078216)
- **realtime:** Ouvrir le contexte d'une trame dès sa réception pour corréler ses journaux, et ne plus signaler un canal de plateforme comme « sans règle » (#649) (31e154f81, 325fb7709)
- Valider la forme des JSON relus — PDU, journal, manifestes, réglages d'agent, réponses OAuth, jeu de clés JWT, préférences de Studio, idempotence, journal de migrations, outils MCP déclarés — au lieu de les croire (#572) (abf6f7bff, 3148ac407, 3aa7e990c, 6dbb01a54, 6fe1d5245, 1dc1ddcb9, 156b346fc, 2d8afa8b1)
- **core:** Déclarer un service transient sans le construire au démarrage (3474ea138)
- **core:** Mesurer le vrai retard de la boucle d'événements, et son pire blocage (df09ddd68)
- **core:** Lire `NF_DATABASE_URL_FILE` et `NF_REDIS_URL_FILE` dans la résolution de l'infrastructure (a14dfa0e0)
- **core:** Comparer la plage `engines.node` entière, pas sa seule majeure (c6c6352ae)
- **core:** Lire la forme objet `{ name, policy }` du manifeste des modules (d339650dc)
- **core:** Ne plus transmettre le `.env` du projet courant à l'application que crée `create app` (acf4d7257)
- **core:** Élaguer les journaux des workers morts à l'ouverture du driver fichier (82a9b56a4)
- **core:** Afficher au format console l'erreur d'un démarrage interrompu (339a60178)
- **core:** Faire rendre au filtre réseau les interfaces qu'il annonce (#611) (24d4d2a4f)
- **core:** Aligner les opérateurs des conditions du journal sur ceux de JavaScript (8d84a5efd)
- **dev:** Libérer les ports au Ctrl-C de `npm run dev`, et arrêter tout l'arbre lancé quand un démarrage détaché échoue (#598) (83c240e26, ccb4ac0ce)
- **doctor:** Supprimer trois faux signalements — sources d'un paquet imbriqué, manquement de câblage compté deux fois, frontière de segment prise pour une zone (05754c18b, ccc166853, 485ec885c)
- **cli:** Annoncer le vrai mot de passe admin de développement, tiré d'une seule source (9a52180c0, acdb7a688)
- **cli:** Juger l'application visée par `--cwd` avec son propre environnement, et écrire l'URL de son port pour `ai:mcp` (#62) (ab558c8ea, 5ceeaefda)
- **cli:** Annoncer la migration requise après `create entity` (#606) (bd90f4df9)
- **cli:** Constater le silence d'une commande avant de la déclarer calée (#472) (9ff05688d)
- **orm:** Écrire la première migration d'une application neuve, et dire quelle base manque et comment la créer (#566, #609) (6b2304229, 09653e2f1)
- **drizzle:** Mesurer la divergence sur la base visée par `NF_MIGRATE_DATABASE_URL`, et n'annoncer « schéma à jour » qu'une fois (749b4bdf9, 26668d2cb)
- **scaffold:** Engendrer du code qui passe le lint de l'application, sans conversion ni affirmation de type, et des modules nés paquets complets avec leur `clean` (8d9040524, 569242f91, 226baa910, e2a2555b9)
- **scaffold:** Corriger les tests e2e générés, qui punissaient leurs propres gardes, et l'`AGENTS.md`, qui induisait l'agent en erreur sur la socket (#597, #599) (895c9c3b2, a78721b59)
- **scaffold:** Ne plus déclarer dans l'échantillon d'une entité un entier qu'il ne lit pas (923314da0)
- **upgrade:** Juger le front d'une application sur son moteur, comme `create app` (cce4a1124)
- **studio:** Recharger une fois l'onglet périmé au lieu de casser au changement d'écran (aea3f92fd)
- **studio:** Ne plus proposer le portail de documentation sans son module, et l'installer par défaut (35541da6d)
- **devkit:** Ne plus arrondir à 0 ms la latence d'un socket local, et nommer un refus au handshake au lieu d'attendre (#596) (98cec3982, cbf5f8682)
- **portabilité:** Importer par URL ce qui levait sous Windows (#401) (f6016e8e6)

## 10.0.0-beta.3 - 2026-10-13

### Changed

- **client (breaking):** Renommer le client navigateur dans la famille `Nodefony*` : `RealtimeClient` devient `NodefonySocket`, `RealtimeOptions` devient `NodefonySocketOptions`, `ClientKernel` devient `NodefonyKernel` (`IClientKernel`, `ClientKernelOptions/State/Event`, `ClientIdentity`, `NodefonyClientServices` suivent) et `createClientKernel()` cède la place à `new NodefonyKernel()`, sans alias (#564, #576) (86ddd2fef, 07bd8a660, a591d3b4b)
- **security (breaking):** Nommer `identifier` l'identifiant d'un compte partout — `ISafeUser.username`, `AuditLogEntry.userId` et la clé `userId` du contexte de requête disparaissent au profit de `identifier` et `userIdentifier`, et `/me` rend `identifier` (#580) (2c90a51e6, e6bce0a2f, 3dd66c8f9, 81425f6d2)
- **security (breaking):** Répondre 200 avec `{ user: null }` à `GET …/auth/me` sans session, au lieu d'un 401 (#582) (59bb83b6e)
- **security (breaking):** Refuser en production, par un 403, un mot de passe ou un code de second facteur reçu en HTTP clair, sur les quatre portes et le plan d'administration (#547) (0e5a1e6e4, bb7f9afc2)
- **security (breaking):** Signer les jetons de production avec une clé partagée entre pods (`NF_JWT_KEYSET`, générée par `security:secrets --jwt-keyset`) — chaque process signait avec sa propre clé éphémère (#478) (e3362886a)
- **env (breaking):** Ne charger qu'un seul fichier d'environnement, `.env`, jamais commité — `.env.local` et `.env.<mode>` sont refusés au démarrage (862748743)
- **config (breaking):** Déclarer le nom court d'une variable d'environnement sur le champ du schéma de config d'un module (`.meta({ env })`), appliqué à tous les modules (ADR-0016) (e84a866a9, 16e403552)
- **core (breaking):** Exiger au démarrage de `nodefony production` les secrets déclarés « requis en production », que la garde ne voyait plus (245668ed5)
- **router (breaking):** Appliquer l'option `method` d'une route — une route déclarée `POST` servait toutes les méthodes (#553) (9f3d56e06)
- **router (breaking):** Refuser l'ouverture d'un WebSocket sur une route qui ne le déclare pas ; `IRequestRouter` exige désormais `servesWebsocket` (a9ec95de9)
- **framework (breaking):** Appliquer `requirements.scheme`, documenté mais ignoré, qui remplace `Route.schemes` (63b8f2e35)
- **nodefony (breaking):** Fermer le type du magasin de contexte de requête : `RequestContextPayload` n'accepte plus de clé arbitraire (#571) (8e5de0159)
- **nodefony (breaking):** Ajouter des membres requis aux interfaces `IKernel`, `IService`, `IBootReport`, `ISchemaLeaf`, `SocketSnapshot`, `IDiscoveredAuthorizationServer` et `IUserSummary` — une implémentation maison doit les fournir (mesuré par release:api-diff)
- **cli:** Laisser chaque paquet livrer ses fichiers dans l'application (`nodefony.contribute`) ; le cœur ne connaît plus Keycloak que par les gabarits du preset `complete` (#520) (2b10a3055)
- **studio:** Aligner la console d'administration sur un seul thème, celui de la barre de debug (1f1fad8db)
- **drizzle:** Ne plus recompiler les requêtes SQLite à chaque requête HTTP (815a3cfb9)
- **mongoose:** Alléger la vérification des sessions relues sur le chemin de chaque requête (#575) (71cbfe4c2)
- **nodefony:** Vider le magasin de contexte de requête sans parcourir ses clés (#571) (d102bbfea)
- **realtime:** Valider les entrées reçues par un contrôleur temps réel (#573) (56f81dc2e)

### Added

- **security:** Servir une page de connexion `/login` par défaut, en neuf habillages, réglable par la section `loginPage` et décrite par `describeLoginPage` (#547) (42639d7c7, 1c7abc33b, 79465b18f, ea477a901)
- **security:** Partager une seule feuille `login.css` entre la page de connexion et le thème Keycloak, qui suit son habillage (#547, #268) (d6b185c92, 54d1c7f86, 93f007b01)
- **client:** Ajouter `NodefonyLogin`, le déroulé de connexion sans interface imposée, avec ses liaisons React, Vue, Angular et Svelte, et `nodefony/login.js` en bundle autonome (#546, #547) (55ac4ff55, 485230155)
- **security:** Exiger sur une route une connexion récente et un second facteur (#588) (edb7eb4b1)
- **security:** Retenir dans la session l'heure et les méthodes d'authentification (`authAt`, `amr` au sens de la RFC 8176) (#547) (1ad3c6346)
- **security:** Ouvrir la liste des seconds facteurs proposés par le défi de connexion (#547) (2dbfe535f)
- **security:** Faire voyager `from` et `back` à travers le flux OAuth (#547) (4537fa936)
- **core:** Ajouter la garde contre les redirections ouvertes et les chemins de la page de connexion (#547) (9ea50bfb1)
- **framework:** Exposer `this.user` dans un contrôleur (#547) (a070732f2)
- **security:** Ajouter le service `keycloak` et `security:keycloak:realm`, qui dérive le realm de la configuration au lieu de le recopier (#268, #520) (93f007b01, 665cf6099, 44f22da33)
- **security:** Livrer un thème Keycloak complet — connexion, compte, administration, courriels — en clair comme en sombre (#520) (403626622, 0852f1817)
- **security:** Fermer les sessions quand Keycloak déconnecte (Back-Channel Logout) et fermer la session Keycloak à la déconnexion (RP-Initiated Logout) (a278129f5, 0aee33187)
- **security:** Dériver les rôles de l'application des rôles Keycloak, et ouvrir les rôles de plateforme à l'annuaire par `allowPlatformRoles` (5cb6a7112, c94205cb2)
- **security:** Diagnostiquer une configuration OAuth sans connexion humaine (#520) (45e337c9a)
- **security:** Obtenir le jeton d'un programme par `client_credentials`, et surcharger par zone la politique de sujet des jetons tiers (#544) (ad6a3d8cd, 262c5f085, c2c80cd65)
- **security:** Lire les métadonnées d'un émetteur par une adresse interne, et déclarer les autorités de certification sortantes (`NF_TLS_CA_FILE`) (#521) (e768771ec, 3250d1364)
- **security:** Signaler au démarrage une zone ouverte à quiconque peut créer un compte (#552) (3c34ea451)
- **security:** Faire désigner par le jeton d'API d'une personne le compte de sa session (#269) (80a77bf27)
- **security:** Poser un jeton d'agent valable 8 h par défaut (#563) (f4392f411)
- **security:** Ajouter `security:secrets --env`, qui rend les secrets de production au format de `docker run --env-file` (f2c1252fb)
- **http:** Servir un flux SSE avec les gardes d'une socket WebSocket, et son client `NodefonySse` avec ses liaisons React, Vue, Angular et Svelte (#559, #560, #568) (0e60f832a, 60a10e5b8, 266383b4c)
- **http:** Ajouter un proxy inverse générique, qui relaie requêtes et WebSocket sur la même origine (c7cdc4af1)
- **frontend:** Servir Vite derrière Nodefony, sur l'origine de la page (`/_vite/<famille>/`) (a0ccf3524)
- **mcp:** Répondre en flux SSE aux outils qui progressent, et les annuler à la fermeture du flux (#554) (a0e30eee5)
- **cli:** Ajouter `nodefony upgrade`, qui remet une application au niveau après une montée de version (#593) (9d8c64563)
- **cli:** Ajouter `scaffold:sync --update`, qui rafraîchit les fichiers livrés restés intacts (#268) (1c2bc9c32)
- **doctor:** Signaler les fichiers livrés par un paquet restés en retard sur sa version (#268) (d0cff5e38)
- **cli:** Afficher le serveur de développement en plein écran — barre d'état vivante, journal défilant, sélection et presse-papiers à la souris — par défaut hors Windows, sur demande sous Windows (`--mouse`, `NF_DEV_MOUSE`) (#533, #535, #536, #537) (f303f87e2, c77e2b805, b636bb7b5, 4f0df0d64, 0d3a3dd67, e7e042798)
- **cli:** Générer le graphe des symboles du code d'une application, lu fusionné avec celui du framework (#530) (be8bddc8d, 80f8995df)
- **cli:** Ouvrir une application de développement au réseau local par `NF_BIND_ALL` (6349b370d)
- **scaffold:** Générer la chaîne Keycloak dans une application neuve, avec une commande d'exemple qui appelle une API partenaire par jeton (#520, #544) (ded6ee8d0, 4f652867f)
- **scaffold:** Générer une action temps réel qui lit son appelant, avec son test (86c777e91)
- **scaffold:** Générer un `.env` rangé par sections et expliqué, avec les choix possibles de chaque variable, et sa notice `.env.example` pour chaque preset (#521) (34bd7944a, d1c7aafa5, f3d2883b1, f9e0082b9, c5b24d2ac)
- **scaffold:** Faire renvoyer la page d'accueil générée à `/login` et montrer la session (#547) (1ff32aca8, a681f79f6)
- **core:** Ajouter `navigate()` à `nodefony/testing`, la navigation qu'un `fetch()` ne joue pas (#579) (db0a6de57)
- **core:** Publier `nodefony/project-root`, qui trouve la racine de l'application sans charger le framework (20b0128e4)
- **client:** Rendre le noyau client accessible aux composants (#576) (fa7fa56bd)
- **client:** Montrer le noyau client dans la barre de debug, au journal fenêtré, sans ouvrir la socket au montage (3d7649417, 3a33f6bbc, d4def1074, 1b5d3d9ef)
- **devkit:** Livrer les skills `nodefony-authentication`, `nodefony-troubleshoot` et `nodefony-security-review` (#579, #587, #590) (315fdf158, 31e3d7318, 6ec95733b)
- **devkit:** Faire choisir à la sonde navigateur l'écran, dans une liste, et mesurer le pli (73f4d3db8, fb46b9f4e)
- **redis:** Compter les sessions par un index trié par expiration (e675d96c0)
- **studio:** Montrer les rôles des annuaires dans la page Rôles et la fiche utilisateur (a2ae579e3)
- **studio:** Réserver la feuille de route et les pages de doc internes au dépôt du framework (#594) (dc0fbf05a)
- **brand:** Servir le logo Nodefony en SVG, dont dérivent le PNG et le favicon (#527) (84583c06f, 91967b32e)
- **release:** Livrer `CHANGELOG.md` dans le paquet `nodefony` (5af44f2fd)

### Removed

- **frontend (breaking):** Retirer le proxy d'API de Vite (`apiProxyPaths`, `backendHost/Port/Protocol`) et les réglages `publicOrigin`, `https` et `requestHost`, sans effet depuis que Vite est servi derrière Nodefony — une clé restée interrompt le démarrage en la nommant (6ad269c35, 9cff36430)
- **http (breaking):** Retirer les champs morts `Context.isControlledAccess`, `rootCertPem` et `intermediateCertPem` (1be13cfe5)
- **core (breaking):** Retirer `Builder.force`, jamais lu (43698eed5)

### Fixed

- **security:** Fermer la socket et le flux SSE d'un compte dont les rôles changent (#591) (7c263ecac)
- **user:** Révoquer sessions et jetons au changement de mot de passe par HTTP, le service étant seul à émettre le cycle de vie du compte (#589) (3b97fed95, 2fdc777c8)
- **security:** Rattacher le second facteur au compte sous son identifiant, et purger les facteurs hérités à la création (#589) (034f35fc0, cd8df6fd8)
- **user:** Refuser le renommage d'un compte et un identifiant déjà pris, en mémoire comme au provisioning OAuth (#589) (81b0fbb52, 266074be3)
- **security:** Ne plus publier le hash du mot de passe dans le compte sérialisé (#580) (32256e677)
- **security:** Faire couvrir par une zone la casse et la barre finale que le routeur sert (d2b814046)
- **security:** Contrôler la provenance des requêtes vers les routes de connexion malgré `bypassFirewall` (6d29d0ce8)
- **framework:** Interdire tout cache partagé sur une réponse d'authentification (4ff587091)
- **security:** Garder les sessions et jetons relus d'un store (#572) (070ad2aee)
- **security:** Refuser au démarrage un émetteur de fournisseur absent ou mal formé (a3997670d)
- **security:** Conduire un visiteur anonyme à la page de connexion (#548) (b98f3f0b9)
- **security:** Auditer l'activation et le retrait du second facteur par son titulaire (9363c36da)
- **security:** Ne plus relire l'utilisateur deux fois dans la même requête (b50c27ecd)
- **http:** Effacer l'identité du contexte de requête à la fin de la requête (#571) (78a2ff59a)
- **http:** Fermer les failles des flux SSE trouvées en red team, et durcir les clients `NodefonySocket` et `NodefonySse` face à un serveur hostile (#559, #568) (2acc0b83c, 60d844eba, f282f7bb3)
- **mcp:** Ne plus renvoyer le message brut d'un outil qui échoue (#551) (9445ffe14)
- **http:** Appliquer le contrôle de domaine au handshake WebSocket (607193a81)
- **http:** Refuser par un statut HTTP une socket sans route (#577) (e47d4440e)
- **http:** Soumettre le WebSocket relayé aux quotas et durcir le proxy inverse (585cc0167)
- **http:** Répondre quand une erreur suit une redirection — la requête restait sans réponse (#581) (731db18c2)
- **http:** Fermer les connexions keep-alive inactives, dont `keepAliveTimeout` était ignoré, et ne plus retenir leur contexte (#561) (6b753abb4, c73568b90)
- **http:** Ne plus retenir requête et contexte du client par le socket amont en pool du relais (4eb03e8cc)
- **http:** Réparer `redirectHttps` et `redirectHttp` (en-tête `Location` vide, port jamais lu) (de05cf730)
- **http:** Ne plus annoncer de type de contenu sur une réponse sans corps (#562) (b8701c692)
- **http:** Reconnaître sous HTTP/2 un client parti avant toute réponse (385764244)
- **http:** Faire confiance à la CA de développement pour les requêtes sortantes (313258a13)
- **router:** Faire passer les routes de repli en dernier (#553) (b15fc9ef3)
- **framework:** Garder le contrôleur d'une connexion WebSocket après un `forward` (#574) (758befa6b)
- **framework:** Ne plus écrire les décorations d'une sous-classe chez son parent, contrôleurs HTTP comme temps réel (#573, #574) (fc9cb9cfd, 03fbe7558)
- **framework:** Ne plus annoncer d'échec quand l'utilisateur annule une connexion externe, et ne journaliser que les codes d'erreur OAuth normalisés (#268) (8ecb2be72, 11fa69236)
- **realtime:** Résoudre les paramètres décorés d'une action temps réel (e487eb81a)
- **realtime:** Rendre le statut d'un rendu en échec par le pont `api.request` (80d1505af)
- **redis:** Remplir une page de listing à travers les lots `SCAN` (824aff74d)
- **drizzle:** Refuser le repli SQLite quand les entités parlent un autre dialecte (#314) (1c2ef28a9)
- **orm:** Refuser `orm:generate` quand rien n'est écrit et qu'une entité est illisible (#396) (67936c8e7, 3003edc23)
- **drizzle:** Ne plus prendre une clé étrangère pour une écriture de lignes (aefbc9e3c)
- **frontend:** Ne relayer vers Vite que s'il sert, pas vers un port repris par une autre application (716366a1f)
- **frontend:** Remplacer à chaud un composant Angular au lieu de recharger la page entière (f310cb458)
- **frontend:** Afficher en développement les images importées par un front (ee45e6fe6)
- **cluster:** Arrêter le cluster quand un worker refuse sa configuration (7bcddc41c)
- **cli:** Recharger en développement un module local modifié (`modules/*`) (7e5063660)
- **cli:** Attendre au Ctrl+C la mort du serveur et de tout le groupe du build, et déclarer calé un build muet 120 s (#536, #537) (f45ce6f44, 09743e75a, 8bd17ea7f, 50925879d)
- **nodefony:** Rendre la main quand turbo se fige après son bilan (#479) (747418358)
- **core:** Faire voir à `doctor` les paquets `@nodefony/*` liés dont le build est périmé (601d0f94c)
- **core:** Ne plus déclarer « sans effet » dans `nodefony env` les réglages lus par les modules (5794051fb)
- **core:** Fournir les identifiants du client hors contexte sécurisé (page servie en HTTP par l'IP du réseau local) (815752877)
- **cli:** Faire de `host.docker.internal` un hôte de confiance des applications générées en développement (6c4452740)
- **scaffold:** Faire passer le typecheck et le lint au front de `create front`, au fournisseur Keycloak et aux gabarits qui typent l'utilisateur (48faf6470, 137ee3c0d, 60768b844)
- **cli:** Retrouver un symbole par son nom publié quand il diffère du nom déclaré (135409697)
- **studio:** Suivre le curseur des listes paginées par un store Redis, et mener « Dernière page » à la vraie fin (6a38a49c3, 57146bf45, 7a228fa6e)
- **studio:** Ne plus interroger la santé du temps réel pour un compte non administrateur (6be78dad0)
- **studio:** Compter dans le KPI d'un module les seules pages de doc servies (b69a90ebb)
- **login:** Rattacher le mot de passe à son compte dans les formulaires en deux étapes, pour les gestionnaires de mots de passe (1970c8a6f)

## 10.0.0-beta.2 - 2026-10-02

### Changed

- **orm (breaking):** Rendre zéro ligne pour un filtre `$or: []`, sur Drizzle comme sur Mongoose — il rendait toute la table (#20) (3f5b695de)
- **core:** Ne construire le bus d'événements d'un service de requête qu'à sa première demande (#508) (ffc9e84aa)
- **framework:** Servir une route littérale sans exécuter son motif d'expression régulière (#508) (7f82b96e2)
- **http:** Retirer quatre allocations du traitement de chaque requête, sans changer de comportement (#508) (6fe0b6f87)
- **orm:** Supprimer une recompilation de requête superflue sur le chemin Drizzle (#510) (f08d8c9de)

### Added

- **cli:** Ajouter `nodefony debug`, qui ouvre le débogueur Node dans le serveur en une commande (4bebbfacd)
- **cli:** Ajouter `create app --package-manager` pour générer une application npm, pnpm, yarn ou bun (#294) (f76685011)
- **cli:** Lancer scripts et processus par le gestionnaire de paquets du projet, résolu en un seul endroit (#294) (50aa33739, 6eacc64ea)
- **scaffold:** Générer la forge et l'image Docker dans le gestionnaire de paquets de l'application (#294) (7a0fc8b86)
- **doctor:** Signaler une version de Node qui porte des failles déjà corrigées (#20) (6dac3df00)
- **doctor:** Signaler un projet qui contredit son gestionnaire de paquets déclaré (#294) (00925eff4)

### Removed

- **http:** Retirer la dépendance `node-forge` — le certificat auto-signé de développement est fabriqué par `node:crypto` (b9f9cf60e)

### Fixed

- **orm:** Empêcher une clé du prototype de franchir la liste blanche des champs (771d0b298)
- **http:** Refuser un nom DNS hors ASCII dans le certificat de développement, au lieu de le changer en un autre nom (#20) (a800a9cb4)
- **http:** Laisser les workers de `nodefony cluster` partager leur port — le cluster tournait sur un seul worker (78e5d82e6)
- **drizzle:** Passer en mode WAL une base SQLite ouverte par plusieurs processus (5647db9bc)
- **security:** Corriger les alertes CodeQL d'expression régulière exponentielle et d'injection de commande (63d5018e3)
- **bundler:** Ne plus recopier un paquet `@nodefony/*` dans le `dist` d'un module (#351) (9cac73df0)
- **doctor:** Neutraliser les octets de contrôle de la liste des versions Node avant de les afficher (#20) (74397d5d1)
- **doctor:** Annoncer les bonnes gardes et formater les gabarits pour pnpm, yarn et bun (#294) (4153f871e)
- **cli:** Ne plus ignorer en silence `--inspect <hôte:port>`, et avertir quand le débogueur est exposé (9ef5e522e)
- **cli:** Déboguer le `.ts` de l'application en développement, pas son `dist` (f65d319c3)
- **cli:** Arrêter tous les minuteurs sans lever quand `stopTimer()` est appelé sans nom (7e8f35d80)
- **cli:** Installer les dépendances de `create module` sous CI et rendre son échec visible (3c48bb509)
- **scaffold:** Déclarer le framework en `^<version>` dans un module généré, jamais en `*` (#294) (8fc558381)
- **scaffold:** Aligner les versions des gabarits sur les dépendances du framework (5b4194976)
- **scaffold:** Faire passer à chaque front généré ses propres contrôles (81e8d262d)
- **studio:** Lancer les étapes du générateur par le gestionnaire de paquets de l'application (1cb760ac2)
- **docker:** Mettre le frontal nginx en 1.30 — la 1.27 ne reçoit plus de correctifs (2ad9bef49)

## 10.0.0-beta.1 - 2026-09-28

### Changed

- **framework (breaking):** rendre les contrôleurs singletons par défaut ; un contrôleur qui garde un état de requête sur `this`, prépare la requête dans `initialize()` ou injecte un service de portée `request` doit déclarer `@Scope("request")` (63453581e)
- **http,framework (breaking):** faire rendre `MaybePromise<T>` au lieu de `Promise<T>` à `send`, `render`, `write`, `close`, `end`, `renderResponse`, `renderJson` et `HttpKernel.handle` ; `await` reste valable, un `.then()` chaîné sur leur retour s'écrit `Promise.resolve(x).then(…)` (16a559eb5)
- **http (breaking):** lever `Response Already sended` quand `HttpContext.send` vise une réponse déjà partie, au lieu de rendre une promesse rompue (16a559eb5)
- **core (breaking):** geler en profondeur les `options` de chaque module à la fin de `onReady` ; une écriture après le démarrage lève, l'édition à chaud passe par `IKernel.replaceModuleOptions` (1457d0e47, 7fb2b5b69)
- **core (breaking):** changer le type `Scopes` en `Map<string, Set<IScope>>` et faire rendre un `ReadonlySet<IScope>` à `Container.addScope()` ; `Container.id` n'est plus assignable (36f834631)
- **core (breaking):** étendre `IScope` de `closed`, `hasOwn()` et `own()`, et `DIScope` de `"request"` ; un implémenteur externe ou un `switch` exhaustif doit les couvrir (ca37ca339, 36f834631)
- **http:** servir un GET sans aucune Promise sur le chemin synchrone, et écrire un corps texte en une seule écriture (efcf5afb9, a30c4c3da, 421bf93e6)
- **types:** passer tous les paquets publiés sous le typage strict, sans cycle de types entre le cœur, http, framework et security (d003f55d9, 2d4462ea3, 6e957afb9, 12beed71b, a3313c922, f778ff954, 53b6dc11e, 7f30ffd8b)

### Added

- **core:** ajouter la portée `request` aux services injectables, atteignable par `RequestContext.getScope()` (ca37ca339, 790e478b7, ea00abbbd)
- **framework:** refuser au démarrage un contrôleur singleton qui dépend d'un service de portée `request` (aaa2ddf40)
- **core:** poser un calque de configuration propre à une requête (2c40408d3)
- **http:** surcharger par requête les quotas de corps et d'envoi (a7760d24d)
- **orm-core:** traiter une clé `undefined` comme absente dans les écritures CRUD (97bccdf59)
- **scaffold:** donner aux applications générées le typage strict du framework, et enseigner la portée `request` à leurs agents (33cd65d13, 3ac9b4239)
- **cli:** afficher la bannière de la marque au démarrage et en tête du menu (fd9f62dd1)

### Removed

- **core (breaking):** retirer l'arbre de paramètres du conteneur — `setParameters`, `getParameters`, `freezeParameters` de `Container`, `Scope`, `Service` et de leurs interfaces, les types `DynamicParam` et `ProtoParameters`, le 2ᵉ argument `deep` du constructeur de `Container` ; un module lit sa configuration dans `this.options` (f88798caa)
- **http (breaking):** retirer le champ `HttpContext.csrf`, jamais affecté (7f30ffd8b)

### Fixed

- **framework:** servir HEAD sur toute route GET, comme l'exige la RFC 9110 (4c77e43a7)
- **framework:** répondre 426 à une route WebSocket appelée en HTTP (89c8496fd)
- **framework:** évincer un contrôleur singleton dont la création échoue (5ebea7a3c)
- **http:** corriger le 500 d'un média servi en HTTP/2 (en-tête en double) (521e566ad)
- **http:** rendre la longueur exacte et la phrase de raison IANA sur les réponses d'erreur (3969ce66f)
- **http:** borner la raison de fermeture WebSocket à 123 octets (d00ce9c76)
- **http:** trier en dernier un type refusé par `q=0` dans l'en-tête `Accept` (07b9b3f4a)
- **http:** appliquer les expirations de session même quand `refererCheck` est actif (c2d4c7887)
- **http:** arrêter le repli de port au plafond 65535 (2f03a7a8e)
- **realtime:** fermer en 1011 un handshake en échec, sans réinstancier le hub (2ba8a4469)
- **security:** porter un challenge `WWW-Authenticate` sur tout 401 (9ea0aa1ab)
- **security:** corriger les quatre alertes CodeQL ouvertes (737d25a31)
- **security:** ranger les événements d'audit authn et log dans des catégories du contrat (4abd84a69)
- **core:** corriger la fuite de paramètres et l'imbrication du scope de requête (d256429a4, 9af206c2a)
- **core:** écrire le journal fichier par un seul flux borné, dans l'ordre (b2a1cf387)
- **syslog:** garder la sévérité 0 (EMERGENCY) et ne plus déborder la pile sur une sévérité inconnue (ebf46c7d4, cbe85c16b)
- **cli:** ne plus déclarer libre un port occupé quand la boucle d'événements a bloqué (8c3b6fdec)
- **cli:** empêcher le git de `create` de se rediriger vers le dépôt appelant (860fb9a58)
- **cli:** refuser les options que `status` et `stop` ne déclarent pas, sans laisser `--wait` avaler la suivante (1cff11bb5, 30621cc61)
- **cli:** accepter le mode `F_OK` (0) dans `Cli.exists` (1bbf32f2e)
- **nodefony:** laisser cohabiter un lancement qui déclare ses propres ports (db95a4409)
- **doctor:** ne plus annoncer deux problèmes inexistants sur une application fraîche (b1e5b5706)
- **inspect:** ne plus prendre un nom hérité d'`Object.prototype` pour un sujet (ed51e3a7a)
- **documentation:** préfixer `NF_` les variables `DOCS_REPO_URL` et `DOCS_REPO_BRANCH` (e6f57baa3)
- **scaffold:** faire repasser au code généré le lint typé, et ne plus écrire `unknown | null` pour un champ json facultatif (0afe816e8, 5e220161b)
- **scaffold:** lire l'identité e2e dans `nodefony/testing`, et dire que les champs d'entité se séparent par des espaces (c533f77fd, afafd1946)
- **studio:** rendre l'ERD lisible sans relation, ouvrir les pages ORM sans paramètre, afficher 0 entité au lieu de « — » (4dccbf1e5, 853fccf75)
- **studio:** traduire le filtre de connexion de l'écran des sessions (15cf1cc52)
- **types:** corriger ce que `await-thenable` et `no-misused-spread` ont trouvé (59d42a87d)

<!-- Surface publique mesurée depuis 10.0.0-alpha.9 (npm) : 12 rupture(s) écrite(s) ci-dessus, 88 déclaration(s) de types à relire sur 1933. Détail : npm run release:api-diff -- --from 10.0.0-alpha.9 --details -->

## 10.0.0-alpha.9 - 2026-09-25

### Changed

- **mongoose (breaking):** Refuser les savepoints d'une transaction MongoDB au lieu de faire semblant de les poser (6b1875b52)
- **realtime:** Déprécier `PLATFORM_CHANNELS.dashboard`, qu'aucun fournisseur ne sert (2e47c1dfe)
- **bundler:** Vider `dist` à l'émission plutôt qu'avant la compilation (option `cleanDir` du socle `nodefony/bundler`) et ne plus dépendre de `rimraf` (b70e56e3a)
- **scaffold:** Faire déclarer ses connecteurs ORM à une application générée, dans `nodefony/config/drizzle.ts` ou `mongoose.ts` (5da1f5768)
- **scaffold:** Borner Angular à 22.1 dans les applications générées — `@angular/build` 22.2 casse le plugin Vite d'analogjs (e86647629)

### Added

- **mongoose:** Porter l'audit, le 2FA et l'idempotence sur MongoDB (460ef5531)
- **mongoose:** Refuser la suppression d'un document parent encore référencé (f99f267b0)
- **scaffold:** Proposer MongoDB au choix de base de `create app`, et générer des entités Mongoose sur une telle application (fcd035897, 02c6fb3c0, adc9a9e15)
- **scaffold:** Choisir la licence de l'application à sa création (a29a819ae)
- **cli:** Demander les champs d'une entité un par un dans le terminal (39cde50be)
- **orm:** Donner ses propres migrations à un connecteur secondaire (8965458fb)
- **orm-core:** Publier le mécanisme de reconnexion d'un connecteur et la chronologie de ses coupures (cc539e3bc)
- **stores:** Publier, pour chaque brique durable, le connecteur qui la porte (5703e5273)
- **doctor:** Signaler un connecteur ORM que personne n'a déclaré (98fae1528)
- **kernel:** Refuser au démarrage un ORM déclaré après le module qui consomme ses magasins (d1e256d8b)
- **core:** Refuser en 400 un identifiant mal formé dans un filtre de référence (96f0488d2)
- **studio:** Ajouter une page par connecteur ORM — base réellement portée, reconnexion, analyse de ce que le data plane mesure (1fb3cd108, b8fe50538, 3348e14ce)
- **studio:** Composer les champs d'une entité à sa création, avec leurs types par moteur, sur les seuls connecteurs ouverts (a36f5cf32, f4f80d6b3)
- **studio:** Regrouper par module les entités sans domaine, et montrer au survol le contenu d'un groupe (e30ebd2e8, 190ffde7a)

### Fixed

- **http:** Répondre 404, et non 500, à un identifiant mal formé dans le chemin (79bf5e1c6)
- **cli:** Ne plus déclarer libre un port occupé quand la boucle d'événements est saturée (42f5d5e71)
- **cli:** Accepter la licence composée `Apache-2.0 AND BSD-3-Clause` au contrôle des licences (b4ed7bb4a)
- **core:** Cesser de condamner la zone de firewall que le gabarit d'application prescrit (f69b553f4)
- **drizzle:** Dériver le schéma d'une base en mémoire, production comprise (3d5156689)
- **drizzle:** Refuser en le nommant un `await` de premier niveau dans un fichier d'entité, chemin avec espaces compris (2a5f6e303, 905741346)
- **drizzle:** Ne plus appliquer les migrations du framework à un connecteur secondaire (3d04e8dd4)
- **orm:** Ne plus ouvrir de base SQLite quand l'infrastructure déclarée n'est pas SQL (7cc1b57b1, 05804b38a)
- **orm:** Ouvrir le connecteur d'un module réservé au développement exactement quand ce module est chargé (d9e2232cb, ee990d9d1)
- **orm:** Journaliser la perte et la reprise d'une connexion (9659c2fb0)
- **orm:** Ne plus annoncer un échec de connexion quand le serveur refuse le schéma (21e32bc78)
- **orm:** Trier sur `id` avec Mongoose, et non sur un champ absent (2c66f3e8b)
- **orm:** Cesser d'écraser le compte d'une entité portée par deux connecteurs (ed0ce765c)
- **orm-core:** Ne plus présenter comme une faute de déclaration un connecteur resté fermé parce qu'un précédent a échoué (905741346)
- **mongoose:** Servir l'ordre du journal d'audit par un index composite (19ba16a0f)
- **redis:** Rendre atomique le seuil de révocation des jetons (88ece7f87)
- **frontend:** Vérifier réellement les templates Angular au build Vite (fb29db43d)
- **frontend:** Dire pourquoi la page de développement pointe une machine injoignable (7ded2b77a)
- **scaffold:** Rendre `User` référençable par une entité de l'application, typé comme la clé de l'identité (34b5dc66a, 595f5a0bf, 398296920)
- **scaffold:** Faire compiler les tests générés d'une entité qui se référence elle-même (d073c4dea)
- **scaffold:** Déclarer dans un module chaque paquet que ses fichiers générés importent (49b5010ac, cd69c97ec)
- **studio:** Attribuer les briques des stores au connecteur qui les porte, et non au moteur (f129f0354, 1024488a7, 63ae146aa)
- **studio:** Cesser d'annoncer chargé un moteur de persistance qui ne l'est pas (b4ad62536)
- **studio:** Cesser de présenter une entité plate comme une anomalie du modèle (21cec71ea)
- **studio:** Poser à la création d'une entité les mêmes questions que le terminal (9af1e1894)
- **studio:** Réparer l'accessibilité et la lisibilité du tableau de bord ORM en thème clair (59448c6c3, d99c8e868, 2ae17c9c6, 8431d8da1, e85c6d8cd, a727c8de7)

## 10.0.0-alpha.8 - 2026-09-20

### Changed

- **Breaking: framework:** refuser l'accès aux API d'administration à tout compte sans rôle, au lieu de le laisser passer (2d819407)
- **scaffold:** générer les scripts npm d'une application sans chemin en dur (4b4daf92)
- **deps:** monter les dépendances des quinze paquets publiés (64d0e0a5)

### Added

- **cli:** décrire les scripts npm du projet dans `nodefony --help`, et les lister avec `nodefony scripts` (c0c994c4)
- **orm:** poser les contraintes d'intégrité des relations déclarées entre entités (#138) (b7659c7d)
- **orm:** écrire et appliquer une migration de schéma en un seul geste (#430) (ef7c8953)
- **scaffold:** rendre à `create front` la page d'accueil de `create app`, socket compris (d94d2e8a)

### Removed

- **scaffold:** cesser de copier dix pages d'instructions d'agent dans chaque application générée — la porte `AGENTS.md` les remplace (#432) (fcc4685b)

### Fixed

- **security:** fermer les trois défauts d'autorisation relevés à l'audit du pipeline (e8b2e200)
- **security:** rendre à un utilisateur la gestion de son propre second facteur (d674d76f)
- **cli:** répondre à `nodefony see --help` au lieu de planter (ab037beb)
- **orm:** rendre lisible le code de sortie « action requise » de `orm:migrate` (#429) (39dcafa9)
- **scaffold:** cesser de lire « ! » comme « obligatoire » dans la grammaire de champs d'une entité (#431) (9f0a0e63)
- **scaffold:** semer la clé parente dans les tests générés d'une entité liée (#138, #434) (2a921873)
- **scaffold:** bâtir l'application avant d'appeler le CLI dans la chaîne GitHub générée (d791e9a1)
- **studio:** lire la liste des rôles depuis le serveur plutôt que d'une copie figée (#60) (a2a4111c)

## 10.0.0-alpha.7 - 2026-09-18

### Changed

- **http:** passer le corps à `end()` pour économiser un tick de boucle d'événements par réponse (09c22774)
- **scaffold:** faire rédiger par le framework le message de fin de semis, au lieu du gabarit (5c1c1ca5)

### Added

- **kernel:** refuser de servir quand deux copies du paquet `nodefony` cohabitent dans le processus (1d72231c)
- **cli:** ajouter `nodefony image:check`, qui inspecte couche par couche l'image d'une application (0cca01a2)
- **cli:** signaler, à la création d'une route protégée, les routes sœurs qu'aucun rôle ne couvre (3180243a)
- **cli:** signaler une base de données dont le moteur ne correspond pas à celui des entités (fe456d11)
- **scaffold:** poser une interface web sans dialogue, par un geste nommé (ca2aca53)
- **scaffold:** conserver la console d'administration dans une application générée pour la production (63e57d0e)
- **scaffold:** contrôler aussi l'image dans la chaîne d'intégration GitLab générée (f7306d41)
- **devkit:** livrer aux applications le skill de développement du framework (7b52a67a)
- **devkit:** livrer aux applications un skill de déploiement — image, secrets, frontal, Kubernetes (51dfb26a)

### Fixed

- **kernel:** nommer le paquet fautif là où la dualité de `nodefony` se produit vraiment (9aa6a356)
- **core:** refuser un conteneur de services venu d'une autre copie du cœur, au lieu de l'ignorer (6c0dbd4c)
- **core:** dire laquelle des deux causes fait refuser un conteneur de services (3213cf23)
- **core:** cesser d'exiger une API de `node:crypto` absente du plancher Node déclaré (58617171)
- **http:** libérer une requête restée en attente quand l'ouverture de session échoue (133224b4)
- **cluster:** lire la configuration de grappe aussi sous Windows (1cecfa5b)
- **orm:** signaler un champ déclaré facultatif que la base exige pourtant (8d74e336)
- **orm:** cesser de voir une destruction de données dans une table SQLite reconstruite (125d3717)
- **frontend:** nommer la cause d'un décalage de port, et cesser d'annoncer un port seulement espéré (bb658459)
- **frontend:** dire au démarrage qu'aucune interface web n'est posée (072f97fd)
- **cli:** montrer dans l'aide la forme complète de la commande de création (9292055a)
- **cli:** annoncer l'adresse réellement servie, et rendre un échec de démarrage constatable hors du journal (3a3c1ccf)
- **cli:** faire filtrer `inspect routes` par l'argument que son aide annonce (df73becf)
- **cli:** faire repartir le serveur de développement sur le paquet de l'application (1a8e0dcf)
- **scaffold:** compléter le contexte de sécurité du Job de migration généré (61ce0a0b)
- **scaffold:** composer les chemins du plan de génération dans une seule grammaire, portable sous Windows (b1f53da8)
- **scaffold:** rendre le pointeur d'agent généré conforme au formateur que l'application embarque (579b839d)
- **scaffold:** recaler sur sa taille réelle le seuil de découpe du pointeur d'agent (a397ba78)
- **scaffold:** écrire en anglais les identifiants des gabarits de test (2b2ff738)

## 10.0.0-alpha.6 - 2026-09-13

### Changed

- **security:** refuser à l'inscription et au changement les mots de passe manifestement faibles (#360) (7b4d9e85)
- **cli:** demander les modules par cases à cocher, et nommer le critère de choix de chaque moteur frontend (#368, #370) (8180a4b2)

### Added

- **scaffold:** livrer en préréglage « Minimal » un exemple de chaque geste — service, contrôleur, entité (#341) (d5c178e7)

### Fixed

- **scaffold:** réparer une application générée qui ne démarrait pas (#373) (be821921)
- **scaffold:** conserver les champs d'une entité que l'on complète, au lieu de les perdre (#375) (b598d265)
- **scaffold:** nommer le compte qui n'a pas été semé, et pourquoi (#373) (64940ea7)
- **scaffold:** dire ce que la fermeture de la zone `/api` coupe également (#362) (f271eb2d)
- **scaffold:** rendre vert le `npm run verify` d'une application neuve, que le relevé de licences faisait échouer (41f3e2fe)
- **orm:** annoncer au démarrage qu'une migration attend, avec le geste qui l'applique (#365) (dd8f95e2)
- **orm:** nommer la cause qui a arrêté la génération d'une migration (#376) (960e76a9)
- **orm:** générer une migration sqlite qui n'attend pas la colonne qu'elle ajoute (#374) (a1067a1e)
- **orm:** ne plus détruire de comptes sur un simple `-y` (#363) (3b4bf240)
- **http:** ne sonder le conflit de port que sur le port désiré (#214) (417aa40e)
- **http:** glisser de port quand un autre serveur occupe déjà la boucle locale (#214) (d01b2f51)
- **cli:** borner le verdict de `doctor` à ce qui a réellement été contrôlé (#364) (1b1cef3a)
- **cli:** ne plus contredire un bilan vert par un démarrage antérieur (#367) (a57065d7)
- **kernel:** fermer la course entre le contrôle d'un `.git` et sa lecture (cf039a4e)

## 10.0.0-alpha.5 - 2026-09-12

### Changed

- **licence :** passer l'ensemble du framework de CeCILL-B à Apache-2.0, concession de brevet comprise (70b5413c)
- **scaffold :** produire une topologie de production complète — frontal nginx, migrations, secrets séparés (52a88140)
- **docker :** cesser de prescrire `redis:7-alpine`, seul cran non libre de la gamme, dans le décor généré (0c026ee1)

### Added

- **cli :** livrer `nodefony licenses` et écrire `THIRD-PARTY-NOTICES.md` à la création d'une application (f59df9bb)
- **cli :** ajouter `security:user:password`, qui change un mot de passe depuis le terminal — le seul recours quand on l'a perdu (04b99066)
- **orm :** ajouter `create service --entity`, qui rend un service CRUD branché sur le dépôt d'une entité (4bf346b0)
- **cli :** poser dans l'application générée les fichiers d'instructions que VS Code, Copilot et Cursor lisent (608e8d8b)
- **cli :** sectionner le menu interactif, qui listait ses commandes à plat (a268ff18)

### Fixed

- **docker :** cesser d'emporter la clé privée TLS du poste dans l'image publiée (d4568516)
- **scaffold :** cesser de fabriquer en production un certificat que rien ne reconnaît (99b69485)
- **security :** avertir quand le trousseau JWT sortira dans l'image construite (43d9ab41)
- **cli :** refuser un argument Windows que `cmd.exe` développerait malgré ses guillemets (`%NOM%`), et fermer une course de fichier (2eaa882a)
- **scaffold :** réparer le démarrage de l'image générée — droits, persistance, reproductibilité (bf821f25, 33c1f5c5)
- **scaffold :** ne plus annoncer quatre vulnérabilités à la première installation (44b3a819)
- **scaffold :** corriger le contraste des vitrines générées en thème sombre (cab83127)
- **http :** rediriger une requête en clair arrivée sur le port TLS, au lieu de la laisser échouer (7d395d69)
- **http :** rendre `proxy:generate` opérant dans une application générée (05ca5459)
- **frontend :** dédupliquer le runtime Svelte au build de production (aaae540d)
- **log :** écrire un horodatage que les outils d'exploitation savent lire (b71b5e52)
- **cli :** nommer les causes d'un échec hors application, dont le cas des copies de travail git (f5a5d59b)
- **cli :** nommer la liaison cliente propre au moteur front choisi (f8424136)
- **cli :** dire, au moment du refus, comment obtenir une identité pour appeler une route protégée (d9e96c2a)
- **deps :** corriger deux failles « high » de `lodash-es` à leur source plutôt que reculer mermaid (b009586a)
- **release :** estampiller l'image officielle avec sa version et sa licence (782442f1, d61ce66b)

## 10.0.0-alpha.4 - 2026-09-09

### Changed

- **config (breaking):** renommer en `I…` les types d'entrée de configuration de module, un seul nom par type (c1661f48, 20739455)
- **http (breaking):** renommer la clé de configuration `openssl` en `selfSigned` (dc8ca20b)
- **config:** placer la configuration de chaque module dans son propre fichier `nodefony/config/<module>.ts`, gardé par un `satisfies` que `nodefony doctor` contrôle (43049bb4)

### Added

- **kernel:** exporter les lecteurs du manifeste d'application — `readManifestSources`, `readManifestCode`, `manifestFileWith`, `diskManifestReader` — pour qu'un module lise la configuration comme `doctor` la lit (f525f1e3, fd0af8d9)
- **cli:** exposer aux applications générées le réglage du nombre de processus (b7cb649a)
- **cli:** lister depuis la ligne de commande les clés de configuration d'un module (bbbe7094)
- **studio:** afficher tout fournisseur de connexion configuré (6dda2c28)

### Fixed

- **studio:** faire entrer le registre de configuration dans le programme TypeScript, ce qui rend au paquet ses déclarations de types, absentes de l'`alpha.3` (cc7739a0)
- **studio:** sortir zod du paquet publié (8b8481ab)
- **scaffold:** rendre vert le premier `npm run verify` d'une application générée (32a2092b)
- **cli:** lancer npm sous Windows sans confier d'arguments à un shell (6896a3ed)
- **cli:** nommer la panne quand `npm create nodefony` ne joint pas la base de données (ccc8d9a7)
- **cli:** annoncer tous les frontends servis par une application générée (636449c6)
- **cli:** rendre vrai le catalogue des clés de configuration (ffbb9dbd)
- **doctor:** ne plus contredire au diagnostic ce qu'une migration vient d'appliquer (fb48431f)
- **doctor:** ne plus laisser une sonde d'infrastructure interrompre le diagnostic qu'elle sert (c68c51e1)
- **kernel:** avertir quand un module écrase la configuration posée par l'application (abbc1acb)
- **kernel:** ne journaliser qu'une fois une erreur de configuration au démarrage (4424040f)
- **kernel:** reconnaître le catalogue des variables d'environnement entre deux instances de nodefony (0e1476a1)
- **frontend:** laisser le socket de rechargement suivre le client (3fb551ec)
- **frontend:** servir en local le client venu de la boucle locale (ff318901)
- **security:** démarrer sans base de données quand le lancement ne la réclame pas (e9991905)
- **redis:** n'ouvrir de connexion que lorsque le lancement déclare en avoir besoin (f8502a1c)
- **devkit:** cesser d'envoyer l'agent configurer la sécurité au mauvais endroit (b3b17443)

## 10.0.0-alpha.3 - 2026-09-07

### Changed

- **security (breaking):** `OAuth2Client.createAuthorizationURL` et `validateAuthorizationCode` prennent un objet de requête au lieu d'arguments positionnels, et `clientAuthMethod` devient requise à la construction (a3d86639)
- **security:** refuser au démarrage une clé du protocole OAuth placée dans `additionalParameters`, plutôt que l'émettre telle quelle (a3d86639)

### Added

- **cli:** afficher le diagnostic de l'application à la fin de sa génération (c6bcf875)
- **security:** découvrir les points d'entrée d'un serveur d'autorisation par ses métadonnées publiées, RFC 8414 — `discoverAuthorizationServer` (740c6d19)

### Removed

- **security:** la dépendance `arctic` — la face cliente d'OAuth 2.0 est désormais écrite dans le framework (740c6d19)

### Fixed

- **cli:** générer une application sans exiger que sa base de données réponde (cf9b5ad4)
- **orm:** rendre la main au bout de dix secondes quand un serveur de base accepte la connexion sans jamais répondre (3735307a)
- **orm:** construire l'ORM même sans connexion, et nommer dans l'erreur ce qui occupe le port (0d9ff149)
- **cli:** cesser de lire les commentaires comme du code dans le diagnostic, et y reconnaître les entités écrites par le générateur (a2677bd2)
- **scaffold:** écrire en anglais les tests générés, qui ne font plus crier le linter (2e3c1ca1)

## 10.0.0-alpha.2 - 2026-09-07

Cette préversion corrige l'installation de l'alpha.1 : un paquet scopé pris seul y
tirait la `7.0.2`. Elle se sert toujours sous le dist-tag `alpha` — `latest` reste la
`7.0.2`, dont l'API est sans rapport.

### Fixed

- **installation:** borner les dépendances de pair internes sur la version publiée — un paquet scopé installé seul tirait `nodefony@7.0.2` (a363d36e)
- **cli:** aligner sur la version publiée la page de manuel embarquée, qui annonçait `10.0.0` (f9d28f6d)

## 10.0.0-alpha.1 - 2026-09-06

Première publication de la série 10, réécrite en TypeScript et distribuée en quinze
paquets. Cette préversion existe pour faire NAÎTRE ces paquets sur le registre : elle
se sert sous le dist-tag `alpha`, et `latest` continue de servir la 7.0.2, dont l'API
est sans rapport. Installer sans nommer le canal ne donne donc PAS cette version.

### Changed

- **Breaking:** écrire en anglais tous les identifiants publics — classes, méthodes, options et clés de configuration (b78e061b)
- **core (breaking):** retirer les alias de compatibilité qui annulaient la rupture des identifiants (0017b454)
- **core (breaking):** retirer la sévérité de journal `SPINNER` — une animation n'est pas un journal (7b87896b)
- **config (breaking):** refuser une clé de configuration inconnue au lieu de la retirer en silence (411788e5)
- **kernel (breaking):** interrompre le boot sur une configuration fautive, module optionnel compris (151e5644)
- **drizzle (breaking):** rendre les trois pilotes de base optionnels et symétriques (149a729d)
- **realtime (breaking):** ne plus annoncer les canaux qu'un visiteur ne peut pas obtenir (64c15ead)
- **realtime (breaking):** retirer `RealtimeError`, exportée sans jamais être levée (db48bf7f)
- **client (breaking):** retirer l'appel non typé de la socket cliente (04d968c5)

### Added

- **cli:** une seule mécanique d'attente pour tout le framework, dont `nodefony doctor` (8131f60d)

### Fixed

- **cli:** accepter dans les commandes autonomes les options que leur propre aide promet (832a53a3)
- **cli:** rendre l'animation d'attente possible — `spawnSync` bloquait la boucle d'événements (924600dd)
- **core:** sortir en échec quand une commande échoue, au lieu de rendre 0 en cours de route (fd1f51a9)
- **http:** enjamber un port que Windows refuse en `EACCES` (f1212cde)
- **doctor:** ne plus condamner l'étage `--deep` sur un contrôle qui n'a pas été demandé (12c96f8a)
- **packages:** rendre à l'auteur les paquets dont le manifeste en nommait un autre (03eb6079)
