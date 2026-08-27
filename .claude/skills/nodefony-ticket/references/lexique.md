# Lexique des tickets — source unique

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`.

Ce fichier est la **source unique** des définitions posées en tête des tickets. Il est lu par le
script qui pose les blocs `**Lexique**` — ne pas recopier une définition ailleurs, elle divergerait.

## Comment s'en servir

Un ticket qui emploie un de ces termes — **dans son titre ou dans son corps** — ouvre son corps par
un bloc `**Lexique**`, AVANT `**Le problème**`, ne reprenant **que** les termes réellement présents.

```markdown
**Lexique**

- **DDL** — _Data Definition Language_ : la partie du SQL qui crée et modifie la structure des tables (`CREATE TABLE`, `ALTER TABLE`), par opposition à celle qui manipule les données.

**Le problème**
…
```

**Au-delà de six entrées, le lexique n'est plus la réponse** : c'est le corps qui est écrit en
jargon, et c'est lui qu'il faut réécrire.

**Ce qui ne va JAMAIS au lexique** : un code de planification interne (`S5`, `R6`, `P10`, `D9`).
Il ne se définit pas, il se **remplace** par ce qu'il désigne — le lecteur n'a pas le document
auquel il renvoie. Écrire « l'étape 6 de la chaîne de publication », pas « R6 ».

## Le format, strictement

Les frontières de mot sont posées par le script — écrire le motif nu (`ADR`, `store`), jamais `\bADR\b`.

Une entrée par ligne, `- **terme** — définition`. Le terme est la forme telle qu'elle apparaît dans
les tickets ; les variantes se séparent par `|` dans le champ de détection entre parenthèses.

## Entrées

- **DDL** (detect: DDL) — _Data Definition Language_ : la partie du SQL qui crée et modifie la structure des tables (`CREATE TABLE`, `ALTER TABLE`), par opposition à celle qui manipule les données.
- **migration** (detect: migration de schéma|migrations de schéma) — un fichier de SQL versionné qui fait passer une base d'une version du schéma à la suivante, et qui garde trace de son passage.
- **TOTP** (detect: TOTP|totp) — _Time-based One-Time Password_ : le code à six chiffres qui change toutes les trente secondes, second facteur d'authentification.
- **idempotence** (detect: idempotency|idempotence) — propriété d'une opération qu'on peut rejouer sans changer le résultat ; ici, le magasin qui retient les requêtes déjà traitées pour ne pas les exécuter deux fois.
- **store** (detect: store|stores) — la brique qui range une donnée dans une base : une par base supportée (SQL, MongoDB, Redis, mémoire).
- **SemVer** (detect: SemVer|semver) — _Semantic Versioning_ : la convention `MAJEUR.MINEUR.CORRECTIF` où seule une version majeure a le droit de casser ce qui marchait.
- **CI** (detect: CI|intégration continue) — _Continuous Integration_ : les contrôles automatiques que la forge (GitHub Actions) rejoue à chaque poussée de code.
- **e2e** (detect: e2e|E2E|bout en bout) — _end to end_ : un test qui exerce la chaîne entière, du client à la base réelle, sans rien simuler.
- **soak** (detect: soak) — un test de **tenue dans la durée** : on fait tourner le serveur des heures sous charge pour voir si la mémoire dérive.
- **RSS** (detect: RSS) — _Resident Set Size_ : la mémoire réellement occupée par le process, telle que le système d'exploitation la voit.
- **red-team** (detect: red-team|red team) — une campagne d'attaque menée contre son propre produit, pour trouver les failles avant qu'un tiers ne les trouve.
- **liste d'exceptions** (detect: allowlist|liste d'exceptions) — la liste des alertes qu'un scanner doit ignorer parce qu'elles sont connues et légitimes (un jeton d'exemple tiré d'une norme, un certificat de test).
- **surcharge par l'environnement** (detect: override) — remplacer une valeur de configuration au démarrage par une variable d'environnement, sans toucher au code.
- **sous-chemin** (detect: subpath|subpaths|sous-chemin|sous-chemins) — une porte d'entrée secondaire d'un paquet npm (`nodefony/testing` à côté de `nodefony`), déclarée dans son `package.json`.
- **liaison** (detect: binding|bindings|liaison|liaisons) — la couche qui rend une brique du framework idiomatique dans un framework front donné : _hooks_ React, _composables_ Vue, services Angular, _runes_ Svelte.
- **isomorphe** (detect: isomorphe|isomorphisme) — le même code s'exécute des deux côtés, serveur et navigateur, avec la même API.
- **scaffold** (detect: scaffold) — le générateur de code : ce que produit `nodefony create app` ou `create module`, et qui est **figé à la création** de l'application.
- **injection de dépendances** (detect: DI) — le mécanisme qui fournit à une classe les services dont elle a besoin, au lieu qu'elle aille les chercher elle-même.
- **JWT** (detect: JWT|jwt) — _JSON Web Token_ : un jeton signé qui porte l'identité de son porteur et se vérifie sans interroger de base.
- **MCP** (detect: MCP) — _Model Context Protocol_ : le protocole par lequel un agent d'intelligence artificielle appelle les outils d'un logiciel.
- **ADR** (detect: ADR) — _Architecture Decision Record_ : une décision d'architecture écrite, datée et figée, avec ses raisons et les options rejetées.
- **CRUD** (detect: CRUD) — les quatre opérations de base sur une donnée : créer, lire, modifier, supprimer.
- **tarball** (detect: tarball|tarballs) — l'archive que npm publie et qu'un utilisateur reçoit à l'installation ; elle ne contient pas forcément ce que le dépôt montre.
- **gate** (detect: gate|gates) — un contrôle automatique bloquant : tant qu'il est rouge, la chaîne s'arrête.
- **banc** (detect: banc|bancs) — un montage de mesure : un décor, une charge, et un chiffre en sortie.
- **jalon** (detect: milestone) — la version dans laquelle un ticket doit sortir.

## Anglicismes — l'équivalent à employer

Ces mots ont un équivalent français net : les employer tels quels fait traduire le lecteur avant
qu'il comprenne. La liste est lue par [`../scripts/francise.mjs`](../scripts/francise.mjs), qui
n'agit **que hors du code** — un identifiant, un chemin ou une citation entre accents graves reste
intact. Format : `- anglais → français`.

**Les formes avec article d'abord** — un mot qui change de genre entraîne son déterminant, et le
script ne sait pas accorder : sans ces lignes on obtient « aucun liaison » et « le dérive ». Les
motifs les plus longs sont essayés en premier.

- aucun binding → aucune liaison
- un binding → une liaison
- ce binding → cette liaison
- le binding → la liaison
- du binding → de la liaison
- les bindings → les liaisons
- des bindings → des liaisons
- ces bindings → ces liaisons
- trois bindings → trois liaisons
- le drift → la dérive
- du drift → de la dérive
- un drift → une dérive
- l'override → la surcharge
- un endpoint → une route
- par endpoint → par route
- un **breaking change** → une **rupture**
- un breaking change → une rupture
- allowlist → liste d'exceptions
- binding → liaison
- bindings → liaisons
- breaking change → rupture
- dashboard → tableau de bord
- design → conception
- drift → dérive
- endpoint → route
- fallback → repli
- lifecycle → cycle de vie
- override → surcharge
- release → publication
- shim → paquet relais
- subpath → sous-chemin
- subpaths → sous-chemins

**Ne se traduisent PAS**, et c'est délibéré : les termes officiels d'une technologie (_hook_ React,
_composable_ Vue, _rune_ Svelte, _workflow_ GitHub Actions), les noms propres d'outils, et le
vocabulaire du dépôt qui a sa propre entrée ci-dessus (`gate`, `banc`, `store`, `scaffold`,
`tarball`, `soak`).

## Ne jamais traduire — motifs figés

Ces suites sont laissées telles quelles, comme du code : ce sont des **citations** (un statut
d'ADR, un en-tête de tableau repris d'un document) ou des termes dont la traduction changerait le
sens. Le script les protège avant toute substitution.

- design only
- Backend Node
- Backend navigateur
