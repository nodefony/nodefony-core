---
name: nodefony-dev
description: >
  Conduit une tâche de développement de bout en bout dans une application Nodefony — comprendre
  le code en place, choisir la bonne façade, générer plutôt qu'écrire à la main, retrouver la
  référence installée qu'une recherche ordinaire ne voit pas, puis prouver que c'est fait — et se
  charge AVANT la première modification, quelle que soit la tâche.
  Les gestes spécialisés ont leur propre skill (ressource REST, service, canal temps réel, garde
  de route, migration de schéma, écran vu au navigateur) ; celui-ci porte la conduite commune,
  les pièges du serveur et du front, et dit lequel prendre.
  Déclencheurs : "je veux ajouter une fonctionnalité", "comment on code dans ce framework",
  "par où je commence", "où est la doc de ça", "comment ça marche ici", "avant de coder",
  "est-ce que j'écris ça à la main", "comment vérifier que c'est bon", "mon changement
  est-il fini", "je ne trouve rien sur ce sujet", "ce n'est pas documenté", "je touche au
  frontend", "mon composant charge des données", "mon écran n'affiche rien".
metadata:
  version: 1.1.0
---

# nodefony-dev — développer dans cette application sans rien inventer

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Ce fichier n'a **pas** de `references/` — et c'est une décision mesurée, pas un
> oubli : sur 1020 transcripts d'agents lâchés dans une application générée, une page de
> `references/` a été ouverte **0 fois**, quand un script cité comme commande l'a été dans 80 %
> des cas. Ce qui doit atteindre un agent s'EXÉCUTE ou vit dans ce corps ; ce qu'on déporterait
> « pour alléger » n'atteindrait plus personne.

## Passer la main — à lire avant tout le reste

🔴 **Cette table est en tête parce qu'un agent ne lit pas toujours jusqu'au bout.** Mesurée au
banc : placée en avant-dernière section, elle a été manquée par un agent qui avait arrêté sa
lecture à la ligne 200 — il n'a jamais su qu'un skill portait sa réponse, a cherché la base de
l'application au mauvais endroit, et a fini par l'effacer. Celui qui l'a lue a chargé le skill et
réussi. Une orientation qu'on ne rencontre qu'en fin de page n'oriente personne.

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

Prendre le spécialiste DIRECTEMENT est le bon geste quand ta tâche est exactement la sienne : il
n'y a pas à passer par ici d'abord.

`ls .agents/skills/` liste ceux que TON projet a reçus ; `npx nodefony ai:sync` les remet à jour
après une montée de version. Ce sont des **pointeurs** : le contenu vit dans `node_modules` et
suit la version installée — les éditer ne servirait à rien.

## 1. La règle qui gouverne tout

**N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**

Ton `AGENTS.md` porte les trois actes et les tables qui vont avec — les générateurs, les
vérités du framework, les gates. **Ce skill ne les recopie pas** : une règle écrite à deux
endroits diverge au premier changement, et c'est alors la copie qu'on lit. Il porte ce qui n'y
tient pas : la **conduite** d'une tâche, les pièges qui coûtent une heure, et l'outil qui répond
à « où est-ce documenté ? ».

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

Il ne stocke aucune documentation : il lit celle de TES paquets à l'exécution, et rend le chemin
**et la ligne**. Tu ouvres à l'endroit exact au lieu de relire une page entière. Classement par
titre, sujet, étiquettes puis corps — une ligne qui porte TOUS tes termes passe devant deux
lignes qui en portent un chacune ; les accents sont ignorés.

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
   `inspect services`, `inspect config` rendent l'état RÉEL — routes montées, services résolus,
   valeur effective **et sa provenance**. Une route lue dans un fichier peut n'être montée nulle
   part ; l'inverse aussi.
   **Un argument RESTREINT la réponse** — `inspect routes auth` ne rend que les routes dont le
   chemin, le nom, le contrôleur, l'action, le module ou les méthodes portent `auth` ;
   `inspect schema http` fait de même sur les réglages d'un module. Ne tronque JAMAIS une sortie
   d'inspection (`| head`) pour la faire tenir : une application en sert facilement plusieurs
   centaines, et ce qu'on cherche est presque toujours dans la partie coupée — c'est ainsi qu'on
   conclut « le framework ne fournit pas ça » et qu'on le réécrit à la main.
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

## 4. Les pièges du serveur

Chacun a déjà coûté au moins une heure à quelqu'un. Les quatre premiers sont les plus fréquents.

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

### Ce qui tue le processus, pas la requête

- 🔴 **Une promesse lancée sans `await` porte TOUJOURS un `.catch()`.** Audit, courriel,
  notification, nettoyage différé : un rejet non capté ne casse pas la requête, il tue le
  **processus entier** — donc toutes les requêtes en vol, pas seulement la tienne.
- 🔴 **Un handler ne bloque jamais la boucle d'événements.** Aucune API `*Sync`
  (`readFileSync`, `pbkdf2Sync`, `zlib`, `child_process`), aucun `JSON.parse` sur un corps non
  borné, aucune expression régulière à quantificateurs imbriqués sur une entrée utilisateur.
  Au-delà d'une milliseconde de calcul, passe par `worker_threads` : un seul handler lourd
  bloque **tous** les clients, pas seulement celui qui l'a déclenché.
- **Un `PATCH` au corps vide se refuse en `400`.** Le laisser passer produit un `updateOne({})`,
  qui finit en `500 « No values to set »` — une erreur serveur pour une faute de client.

### Quand ça ne va pas, et que le message ne suffit pas

- **Un test vert seul et rouge en suite accuse une RESSOURCE PARTAGÉE**, pas ton code : base ou
  index réutilisé, port, store jamais purgé, assertion `count === N` qui suppose une table
  vierge. Lance deux fichiers ENSEMBLE pour isoler la paire, puis cloisonne. **Ne sérialise
  jamais la suite** pour faire passer le rouge : tu masques la cause et tu paies la lenteur à
  chaque exécution.
- **Une suite lancée contre un serveur en `production` reçoit `404` partout** : les modules
  `policy:"dev"` n'y sont pas. `NF_WITH_DEV_MODULES=1` déroge pour 30 minutes
  (`NF_WITH_DEV_MODULES_TTL_MIN`, 4 h au plus), et le `CRITIC « arrêt automatique … dérogation »`
  du journal est cette garde qui se referme — pas une panne.
- **Ton application a démarré AMPUTÉE et tout a l'air sain** — base injoignable, module écarté
  par sa politique. Seul `npx nodefony doctor` le dit, en relisant `var/last-boot.json`.
  ⚠️ Ce bilan a un ÂGE : il décrit le **dernier démarrage**, et une commande console (`inspect`,
  une commande de module) ne l'écrase pas. C'est voulu — lis la date avant d'en conclure.
- **L'application ne démarre plus et le superviseur avale la sortie** :
  `NF_DEV_CHILD=1 npx nodefony development` lance l'enfant seul et montre le crash brut.

## 5. Les pièges du front

Ne concerne qu'une application qui a un frontend. Sauf mention, **vaut pour les quatre moteurs**
(React, Vue, Angular, Svelte) : le framework ne t'en impose aucun.

### Ce qui fuit, et ce qui s'injecte

- 🔴 **Toute donnée non maîtrisée se rend en nœud TEXTE.** Jamais `dangerouslySetInnerHTML`
  (React), `v-html` (Vue), `[innerHTML]` (Angular), `{@html}` (Svelte). Un Markdown se rend sans
  HTML brut.
- 🔴 **L'identité est un cookie `HttpOnly` que le navigateur joint seul.** Aucun jeton en
  `localStorage` ou `sessionStorage`, aucun en-tête `Authorization` écrit à la main. Un `401`
  est un ÉTAT (« pas connecté »), pas une erreur à journaliser.
- 🔴 **Le bundle front n'importe jamais un module serveur** — `@nodefony/http`,
  `@nodefony/security`, une entité ORM, `nodefony.config`, `.env`. Un type serveur passe par
  `import type` ou un miroir. Le test qui tranche : **si l'import tire un `node:*`, arrête-toi**
  — ce bundle est public.
- **Rien de secret ne part côté client.** Toute clé `VITE_*` est lue par le navigateur ; un
  `console.*` de données committé est une fuite. Le front AFFICHE ce qu'il reçoit — la rédaction
  des secrets est un travail de serveur.

### Charger des données sans casser l'écran

- **Un écran qui charge a quatre états EXCLUSIFS**, dans cet ordre de priorité : erreur (avec un
  « réessayer »), chargement (un squelette qui épouse la page), vide (qui dit POURQUOI), données.
  Un seul visible à la fois.
- **Tout chargement porte un jeton de génération** : une réponse arrivée après démontage, ou
  après un changement de paramètre, est IGNORÉE — sinon un écran affiche les données d'un autre.
  `loading` vaut `true` dès le montage, jamais après. Le framework ne fournit pas de hook de
  ressource : c'est à écrire, dans les quatre moteurs.
- **Au vrai changement de compte** (l'identifiant passe d'une valeur à une AUTRE), force
  `disconnect()` puis `connect()` sur la socket partagée et purge les caches propres à
  l'utilisateur. Jamais au démarrage ni au rechargement : tu couperais les requêtes en vol.

### Un écran qui se met à jour tout seul

- **Un widget temps réel est invisible tant qu'il ne se passe rien.** Format par paliers (jamais
  une valeur qui saute de millisecondes à secondes), `font-variant-numeric: tabular-nums` sur
  tout nombre qui change, aucune animation rejouée à chaque tick, `prefers-reduced-motion`
  respecté, et un contrôle pause/fréquence dès que ça bouge seul plus de 5 s (WCAG 2.2.2).
  **Le test** : fixe l'écran 30 secondes — rien ne doit bouger sans cause.
- **N'anime que `transform` et `opacity`** ; `contain: content` sur chaque widget vivant,
  `content-visibility: auto` sur les longues listes.
- **Accessibilité, le minimum qui se vérifie à l'œil** : un seul `<h1>` par page, `aria-label`
  sur tout bouton-icône, `aria-expanded` sur tout bascule, `aria-live` sur les zones qui changent
  seules, `role="img"` + `aria-label` sur un graphe SVG, jamais une information portée par la
  **couleur seule**, `rel="noopener noreferrer"` sur les liens externes.

### Le piège qui fait croire à un bug de code

- **Vite affirme qu'un export n'existe pas** (`does not provide an export named …`) alors qu'il
  est bien dans le source — typiquement après un nouveau sous-chemin `nodefony/*`, une dépendance
  ajoutée, ou un `git pull`. C'est son cache : `rm -rf node_modules/.vite`, puis relance. Ne
  purge pas sans raison, ça coûte 5 à 20 s de ré-optimisation.

## 6. Avant de dire « fait »

```bash
npm run verify        # types + style + tests + câblage
npm run test:e2e      # boot réel + HTTP/WS — le gate LENT, hors `verify`
```

Puis, en une phrase : **nomme ce que tu n'as PAS lancé.** Un vert ne couvre que le diff qui l'a
produit, et un banc sauté faute de son décor compte comme vert. Dire « e2e non lancé » coûte
cinq mots ; le taire coûte la confiance dans tout le reste.

Quatre règles de plus, chacune payée par une conclusion fausse qu'on a crue. Elles ne parlent
pas de ce framework en particulier — elles parlent de la façon dont une preuve se fabrique.

- 🔴 **Ta preuve porte sur l'artefact qu'on REÇOIT, pas sur ce que tu viens d'écrire.** Le
  runtime charge `dist/`, une image embarque ce que le `Dockerfile` a copié, un paquet publié
  contient ce que `files` laisse passer. Et avant de mesurer, vérifie que la transformation a
  bien EU LIEU (date, empreinte) : dans une chaîne `a && b && c`, un maillon qui échoue laisse
  mesurer l'ancienne version — et « prouver » qu'un correctif ne change rien.
- 🔴 **Un test que tu n'as jamais vu ROUGE ne prouve rien.** Écris-le, puis casse exprès ce
  qu'il garde : retire le correctif, débranche le câblage. S'il reste vert, il ne mesure pas ce
  que tu crois. Remets, et alors seulement crois-le. Un test écrit face au code déjà corrigé est
  complaisant par construction.
- **Un décor SALE fabrique des verdicts faux** : un serveur resté ouvert sur le port, une base
  jamais purgée, une variable d'environnement absente. Avant d'accuser ton code, qualifie le
  rouge sur un décor NEUF — sinon tu corriges un problème qui n'existe pas, et tu laisses
  intact celui qui existe.
- **Suspecte ton instrument avant de suspecter le code.** Une commande qui rend « 0 résultat »,
  un compteur à zéro, un journal vide : demande-toi d'abord si l'outil regarde au bon endroit.
  Une sortie tronquée, un filtre trop étroit, un chemin qui n'existe plus ne s'annoncent jamais
  — ils rendent un silence qui ressemble à une réponse.
