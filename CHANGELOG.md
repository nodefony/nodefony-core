# Changelog

Format : [Common Changelog](https://common-changelog.org/) — catégories fermées et
ordonnées, une entrée par ligne, à l'impératif, chacune référençant son commit.
Versions selon [Semantic Versioning](https://semver.org/).

Les sections naissent d'un BROUILLON rendu par `npm run release` depuis les messages
de commit, puis sont RÉÉCRITES à la main : un journal git est écrit pour l'auteur,
un changelog pour celui qui met à jour.

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
