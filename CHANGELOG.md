# Changelog

Format : [Common Changelog](https://common-changelog.org/) — catégories fermées et
ordonnées, une entrée par ligne, à l'impératif, chacune référençant son commit.
Versions selon [Semantic Versioning](https://semver.org/).

Les sections naissent d'un BROUILLON rendu par `npm run release` depuis les messages
de commit, puis sont RÉÉCRITES à la main : un journal git est écrit pour l'auteur,
un changelog pour celui qui met à jour.

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
