---
name: nodefony-dev
description: >
  Conduit une tâche de développement de bout en bout dans une application Nodefony — comprendre
  le code en place, choisir la bonne façade, générer plutôt qu'écrire à la main, retrouver la
  référence installée qu'une recherche ordinaire ne voit pas, puis prouver que c'est fait — et se
  charge AVANT la première modification, quelle que soit la tâche.
  Les gestes spécialisés ont leur propre skill (ressource REST, service, canal temps réel, garde
  de route, migration de schéma, écran vu au navigateur) ; celui-ci porte la conduite commune et
  dit lequel prendre.
  Déclencheurs : "je veux ajouter une fonctionnalité", "comment on code dans ce framework",
  "par où je commence", "où est la doc de ça", "comment ça marche ici", "quelle est la bonne
  façon de faire", "je dois modifier cette application", "avant de coder", "est-ce que j'écris
  ça à la main", "où lire avant de toucher au code", "comment vérifier que c'est bon",
  "mon changement est-il fini", "je ne trouve rien sur ce sujet", "ce n'est pas documenté".
metadata:
  version: 1.0.0
---

# nodefony-dev — développer dans cette application sans rien inventer

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Ce fichier n'a **pas** de `references/` — et c'est une décision mesurée, pas un
> oubli : sur 1020 transcripts d'agents lâchés dans une application générée, une page de
> `references/` a été ouverte **0 fois**, quand un script cité comme commande l'a été dans 80 %
> des cas. Ce qui doit atteindre un agent s'EXÉCUTE ou vit dans ce corps ; ce qu'on déporterait
> « pour alléger » n'atteindrait plus personne.

## 1. La règle qui gouverne tout

**N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**

Ton `AGENTS.md` porte les trois actes et les tables qui vont avec — les générateurs, les
vérités du framework, les gates. **Ce skill ne les recopie pas** : une règle écrite à deux
endroits diverge au premier changement, et c'est alors la copie qu'on lit. Il porte ce qui n'y
tient pas : la **conduite** d'une tâche, et l'outil qui répond à « où est-ce documenté ? ».

Le réflexe, avant d'écrire le moindre fichier : **un générateur le produit-il ?**
`npx nodefony create --help` liste ceux de TA version — la liste s'allonge, ta mémoire non.

## 2. Trouver la référence — ce que `rg` ne peut pas voir

C'est le trou le plus coûteux de ce framework, et il ne ressemble pas à un trou : **la
documentation est installée, complète, et invisible**. `rg "session"` lancé à la racine ne
descend pas dans `node_modules` (git l'ignore, `rg` le suit). Le sujet paraît absent alors qu'il
occupe quinze pages — mesuré sur une application générée : **70 pages, plus de 38 000 lignes**.

Conclure « ce n'est pas documenté » et réécrire à la main est l'erreur que ce script existe pour
empêcher :

```bash
D=node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs

node $D session cookie          # les pages qui répondent — chemin, LIGNE, extrait
node $D --list                  # tout ce qui est installé, par module
node $D --open firewall         # le chemin d'une page, pour l'ouvrir
node $D upload --json           # pour rechaîner
```

Il rend le chemin **et la ligne**, vérifiés : tu ouvres à l'endroit exact plutôt que de relire
une page entière. Classement par titre, sujet, étiquettes puis corps — une ligne qui porte TOUS
tes termes passe devant deux lignes qui en portent un chacune.

**Ses codes de sortie disent quoi faire**, et l'un d'eux compte plus que les autres :

| Code | Ce qu'il veut dire      | Le geste                                                      |
| ---: | ----------------------- | ------------------------------------------------------------- |
|    0 | trouvé                  | ouvrir le fichier à la ligne rendue                           |
|    1 | rien sur ces termes     | un seul mot, ou `--list` pour voir les sujets couverts        |
|   78 | **rien n'est installé** | `npm install` — ce n'est PAS « le sujet n'est pas documenté » |
|   64 | drapeau inconnu         | `--help`                                                      |

> 🔴 **`78` n'est pas une panne, c'est une information.** Un projet dont les dépendances ne sont
> pas installées n'a aucune documentation à lire. Le DIRE ; ne jamais réécrire de mémoire ce
> qu'on n'a pas pu lire.

Deux autres voies existent quand l'application **tourne** : l'outil MCP `nodefony_docs` (cherche
dans la doc chargée) et `nodefony_symbols` (rend la SIGNATURE réelle d'un symbole, que ce script
ne porte pas). Elles supposent un serveur démarré et la porte câblée (`npx nodefony ai:mcp`) ;
`docs.mjs`, lui, répond toujours.

## 3. Conduire une tâche — la séquence, et ses points d'arrêt

1. **Demande à l'application, ne déduis pas du code.** `npx nodefony inspect routes`,
   `inspect services`, `inspect config` rendent l'état RÉEL — routes montées, services
   résolus, valeur effective **et sa provenance**. Une route lue dans un fichier peut n'être
   montée nulle part ; l'inverse aussi.
2. **Cherche la référence** (§2) avant de choisir une façade. Le framework en a presque toujours
   une, et la contourner compile — c'est tout le piège.
3. **Génère.** Si un générateur couvre le besoin, lance-le et **imite sa sortie** pour le reste.
   `--dry-run` montre le plan et les diffs sans rien écrire ; un refus n'écrit jamais rien.
4. **Édite le moins possible**, et regroupe : toutes les modifications serveur d'une même
   fonctionnalité, PUIS un seul cycle de reconstruction. Le frontend passe en HMR, zéro
   redémarrage.
5. **Prouve.** `npm run verify` — une seule commande : types, style, tests, câblage, dans cet
   ordre. Elle s'arrête au premier rouge, et **ce rouge est ta tâche suivante**.

**Le point d'arrêt qu'on rate** : `npm test` seul ne prouve pas que ça compile — vitest
n'inspecte aucun type. Une application peut être verte et ne pas compiler.

## 4. Cinq pièges qui coûtent une heure

- **Ta route répond 404 alors qu'elle existe dans les sources.** Le runtime charge `dist/`, pas
  le source : `npm run build`. C'est la cause n°1.
- **Une classe que rien ne déclare compile, passe ses tests, et casse au démarrage suivant** —
  entité hors `@entities([…])`, controller hors `@controllers([…])`. Table jamais créée, route
  en 404. C'est le mode d'échec de la COPIE : on recopie le voisin au lieu d'appeler le
  générateur, qui, lui, déclare. `npx nodefony doctor` la NOMME.
- **Une clé de configuration mal orthographiée est retirée en silence.** `satisfies` sur le
  fragment n'est pas décoratif : sans lui, la faute compile, puis la validation écarte la clé et
  le module démarre sur son défaut. Personne ne le voit.
- **Tu lis une liste sans la BORNER.** Un `find` sans limite matérialise la table entière —
  indolore sur les quelques lignes du poste de développement, fatal sur les dizaines de milliers
  de la production. Le service d'une entité hérite `findPage({ limit: 25 })`.
- **Ton application a démarré AMPUTÉE et tout a l'air sain** — base injoignable, module écarté
  par sa politique. Seul `npx nodefony doctor` le dit, en relisant le bilan du dernier
  démarrage.

## 5. Quand passer la main

Ces skills sont installés avec le framework et se chargent par leur nom. Les prendre coûte moins
que de chercher : chacun porte les pièges de son geste, et ceux-là ne se devinent pas.

| Ce que tu t'apprêtes à faire                                         | Le skill                        |
| -------------------------------------------------------------------- | ------------------------------- |
| Une ressource : table, validation, service, REST et WebSocket        | `nodefony-add-crud`             |
| Une logique métier réutilisable, hors de tout controller             | `nodefony-add-service`          |
| Un flux temps réel, un canal, un abonnement client                   | `nodefony-add-realtime-channel` |
| Réserver une route, un rôle, une zone, ouvrir à un partenaire        | `nodefony-protect-route`        |
| Changer une entité déjà en base, ou déployer un schéma changé        | `nodefony-migrate-schema`       |
| Conclure quoi que ce soit d'un ÉCRAN — affichage, contraste, console | `nodefony-browser`              |

`ls .agents/skills/` liste ceux que TON projet a reçus ; `npx nodefony ai:sync` les remet à jour
après une montée de version. Ce sont des **pointeurs** : le contenu vit dans `node_modules` et
suit la version installée — les éditer ne servirait à rien.

## 6. Avant de dire « fait »

```bash
npm run verify        # types + style + tests + câblage
npm run test:e2e      # boot réel + HTTP/WS — le gate LENT, hors `verify`
```

Puis, en une phrase : **nomme ce que tu n'as PAS lancé.** Un vert ne couvre que le diff qui l'a
produit, et un banc sauté faute de son décor compte comme vert. Dire « e2e non lancé » coûte
cinq mots ; le taire coûte la confiance dans tout le reste.
