---
name: nodefony-troubleshoot
description: >
  Dépanne une application Nodefony en partant du SYMPTÔME constaté — démarrage qui échoue, route
  en 404, refus 401 ou 403 inattendu, erreur au journal, colonne absente, tests rouges d'un coup,
  page lente — et donne pour chacun le premier geste, la commande qui le constate et le skill qui
  porte le détail. Extrait les erreurs du journal par un script ; mesure une route par l'outil MCP
  `nodefony_profile_route` (il tire lui-même les requêtes), le trafic qu'on génère par
  `nodefony_observe`. À charger DÈS qu'une chose qui marchait ne marche plus, AVANT de lire les
  sources ou de contourner la panne. Coder une fonctionnalité → `nodefony-dev`.
  Déclencheurs : "l'application ne démarre plus", "le serveur plante au démarrage", "ma route
  répond 404", "ça marchait hier", "dépanner", "erreur dans les logs", "tous mes tests sont
  rouges", "cette page est lente", "trop de requêtes SQL", "problème de N+1", "mesure cette route",
  "est-ce plus rapide après ma modification", "erreur 500 intermittente", "EADDRINUSE",
  "ECONNREFUSED".
metadata:
  version: 1.1.0
---

# nodefony-troubleshoot — du symptôme au geste, sans contourner

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Pas de `references/`, comme `nodefony-dev` et pour la même raison mesurée : une page
> de `references/` n'est presque jamais ouverte par un agent, un script cité comme commande l'est.
> Ce qui doit atteindre un agent s'EXÉCUTE ou vit dans ce corps.

## Passer la main

| Ce que tu fais en réalité                                            | Le skill                  |
| -------------------------------------------------------------------- | ------------------------- |
| Tu codes une fonctionnalité, rien n'est cassé                        | `nodefony-dev`            |
| Le refus 401/403 vient d'une route que tu protèges ou ouvres         | `nodefony-protect-route`  |
| La connexion elle-même échoue : mot de passe, second facteur, retour | `nodefony-authentication` |
| La base n'a pas la colonne ou la table que l'entité déclare          | `nodefony-migrate-schema` |
| Le symptôme est À L'ÉCRAN : rien ne s'affiche, erreur de console     | `nodefony-browser`        |
| La panne n'apparaît qu'en conteneur, en production, au déploiement   | `nodefony-devops`         |

## 1. La règle — constater, puis corriger la cause

**Une panne se CONSTATE avant de se corriger.** L'application sait dire ce qui ne va pas : son
diagnostic, ses routes montées, son journal. Lire les sources pour deviner, c'est reconstruire à la
main ce qu'une commande rend en une seconde — et se tromper sur ce qui est réellement chargé.

**Ne contourne jamais une panne.** Élargir une zone pour faire taire un 401, retirer une garde,
sérialiser une suite pour faire passer un rouge, relâcher une assertion, effacer la base : chacun
fait disparaître le symptôme et garde la cause, qui revient ailleurs — souvent en production. Si la
cause t'échappe, dis-le, avec ce que tu as constaté.

## 2. Le symptôme → le premier geste

| Symptôme                                                              | Premier geste                                                          | Puis                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| L'application ne démarre pas, ou démarre puis s'arrête                | `npx nodefony doctor`                                                  | le journal (§3) ; sortie `78` = clé de configuration refusée, elle est NOMMÉE                             |
| Elle démarre, mais quelque chose manque (module, base, fournisseur)   | `npx nodefony doctor --live`                                           | `var/last-boot.json` : le bilan du dernier démarrage, daté                                                |
| Le superviseur avale le message de plantage                           | lance l'enfant seul : `NF_DEV_CHILD=1` puis `npx nodefony development` | le plantage brut s'affiche                                                                                |
| Une route répond `404`                                                | `npx nodefony inspect routes --json`                                   | absente → `npm run build` ; présente → le chemin MONTÉ diffère (§4)                                       |
| TOUT répond `404`, même les routes du gabarit                         | `npx nodefony status`                                                  | un autre serveur tient les ports, ou le tien a glissé (§4)                                                |
| Refus `401` ou `403` inattendu                                        | lire le corps et l'en-tête `WWW-Authenticate` de la réponse            | `nodefony-protect-route` (zone, rôle, jeton anti-falsification)                                           |
| `401` avec `error="insufficient_user_authentication"`                 | la route exige une connexion récente ou un second facteur              | `nodefony-authentication`                                                                                 |
| `403` « Credentials must be sent over HTTPS »                         | un mot de passe envoyé en HTTP clair, refusé en production             | servir en HTTPS, ou déclarer le proxy TLS (`trustProxy`)                                                  |
| Une erreur dans le journal                                            | le script du §3                                                        | la piste qu'il donne, sinon le message lui-même                                                           |
| « colonne inexistante », « no such table », migrations à appliquer    | `npx nodefony doctor --live`                                           | `nodefony-migrate-schema`                                                                                 |
| Des dizaines de tests d'intégration rouges d'un coup (`ECONNREFUSED`) | `npx nodefony status`                                                  | ils FRAPPENT un serveur, ils ne le lancent pas : il est éteint. En e2e, laisse la commande gérer le cycle |
| Une page est lente, trop de requêtes SQL, des `500` par intermittence | l'outil MCP `nodefony_profile_route { "path": "/la/page" }`            | §5 : le rapport nomme la route, la cause et le geste                                                      |
| `nodefony <commande>` échoue là où `npm run dev` réussit              | `npm ls nodefony`                                                      | deux copies du framework dans le processus (§4)                                                           |

**Lis toute la réponse d'une commande de diagnostic.** Ne la tronque jamais (`| head`, une
recherche dans sa sortie) : la ligne qui nomme la cause est presque toujours dans la partie coupée.

## 3. Le journal — extraire, pas lire

Un journal de développement fait des milliers de lignes, presque toutes saines. Le script lit tout,
garde les erreurs, recolle chaque pile d'appels à la ligne qui l'a levée, fusionne les répétitions,
date ce qu'il a lu, et nomme le premier geste quand la cause est établie :

```bash
node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs
node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs logs/dev.log
node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs --warnings --last 40
node node_modules/@nodefony/devkit/skills/nodefony-troubleshoot/scripts/log-errors.mjs --json
```

Sans argument, il lit `logs/*.log` et `logs/*.jsonl`. Sorties : `0` aucune erreur · `1` au moins
une · `64` usage · `66` aucun journal lisible.

⚠️ **En développement, le journal part sur la sortie du TERMINAL, pas dans un fichier.** Le script
répond alors `66` et dit comment l'obtenir : lancer le serveur avec `npx nodefony development
--detach` (journal dans `logs/nodefony-detached.log`), ou rediriger la sortie dans un fichier qu'on
lui passe. **Lis l'âge** qu'il affiche pour chaque fichier : un journal d'hier ne parle pas de la
panne d'aujourd'hui.

⚠️ **Une erreur du journal n'est pas toujours une panne.** Un port pris par l'outil du front se
rattrape seul sur le suivant (la ligne « retrying » qui suit le dit) ; un `CRITIC SIGTERM` est un
arrêt demandé. Le script le signale quand il le reconnaît — sinon, relie l'erreur au symptôme avant
de la corriger.

## 4. Les pannes qui trompent

Chacune a déjà coûté au moins une heure à quelqu'un.

- **Ta route répond `404` alors qu'elle existe dans les sources.** Le runtime charge `dist/`, pas
  le source : `npm run build`. C'est la cause n°1.
- **Une classe que rien ne déclare compile, passe ses tests, et casse au démarrage suivant** —
  entité hors `@entities([…])`, controller hors `@controllers([…])`. Table jamais créée, route en
  `404`. C'est le mode d'échec de la COPIE : on recopie le voisin au lieu d'appeler le générateur,
  qui, lui, déclare. `npx nodefony doctor` la NOMME.
- **Ta route NEUVE répond `404` et le `dist/` est à jour** : elle n'est pas montée où tu crois. Le
  chemin réel est le PRÉFIXE de son controller suivi du `path` de la route — une action
  `path: "/widget"` dans un controller `@controller("/api")` répond sur `/api/widget`.
  `npx nodefony inspect routes --json` donne le chemin MONTÉ.
- **TOUT répond `404`** : un AUTRE serveur tient les ports — ou LE TIEN a glissé, le port voulu
  étant pris. `npx nodefony status` montre les ports RÉELS, pas ceux que tu as configurés, et
  NOMME le projet voisin.
- **Une clé de configuration mal orthographiée ARRÊTE le démarrage** (sortie `78`), en la nommant.
  Une clé retirée par une version du framework produit le même arrêt après un `npm update` : lis
  le message, il nomme la clé.
- 🔴 **`nodefony <commande>` échoue là où `npm run dev` réussit, sur la MÊME application** : DEUX
  paquets `nodefony` tournent dans le processus — un binaire lié ailleurs (installation globale,
  `npm link`) exécute un noyau pendant que l'application importe le sien. Chaque copie a ses
  propres classes, son contexte de requête et ses registres d'injection : un module construit à la
  frontière perd son container SANS la moindre erreur — il figure dans la liste des modules et ne
  fait rien. ⚠️ Les deux copies peuvent être la MÊME version ; deux fichiers distincts suffisent,
  il n'y a aucune incohérence à repérer. `npm ls nodefony` liste les copies (« deduped » partout = une seule) ;
  `NF_CLI_DEBUG=1 nodefony --version` dit quel CLI s'exécute.
- **`localhost` et `127.0.0.1` te jouent des tours** : ce sont deux ORIGINES distinctes — cookies,
  cache et passkeys ne les partagent pas. Une session ouverte sur l'une n'existe pas sur l'autre :
  `401` assuré. Une seule origine en développement, partout, URL ouverte comme callbacks.
- **Ton application a démarré AMPUTÉE et tout a l'air sain** — base injoignable, module écarté par
  sa politique. Seul `npx nodefony doctor` le dit, en relisant `var/last-boot.json`. ⚠️ Ce bilan
  a un ÂGE : il décrit le **dernier démarrage**, et une commande console ne l'écrase pas — lis la
  date avant d'en conclure.
- **Une suite lancée contre un serveur en `production` reçoit `404` partout** : les modules
  `policy:"dev"` n'y sont pas. `NF_WITH_DEV_MODULES=1` déroge pour 30 minutes
  (`NF_WITH_DEV_MODULES_TTL_MIN`, 4 h au plus), et le `CRITIC « arrêt automatique … dérogation »`
  du journal est cette garde qui se referme — pas une panne.
- **Un test vert seul et rouge en suite accuse une RESSOURCE PARTAGÉE**, pas ton code : base ou
  index réutilisé, port, store jamais purgé, assertion `count === N` qui suppose une table vierge.
  Lance deux fichiers ENSEMBLE pour isoler la paire, puis cloisonne. **Ne sérialise jamais la
  suite** pour faire passer le rouge : tu masques la cause et tu paies la lenteur à chaque
  exécution.
- **Les routes authentifiées plafonnent quand le reste tient la charge** : le stockage de session
  par défaut est SYNCHRONE — chaque reprise bloque la boucle d'événements. Compare une route
  anonyme et une route authentifiée AVANT d'accuser TLS ou le pare-feu ; passe le stockage sur
  redis pour la charge.

## 5. Mesurer l'application qui tourne — `nodefony_profile_route` et `nodefony_observe`

Le profileur de développement mesure chaque requête : temps de chaque phase, chaque requête SQL,
décision du pare-feu. Deux outils MCP te rendent ces mesures. C'est la seule façon de SAVOIR
qu'une page est lente ou qu'elle interroge la base dans une boucle — ni le code ni les tests ne le
montrent. **Mesure avant d'écrire un script de banc** : l'outil le fait déjà, et mieux.

| Tu veux…                                                         | L'outil                  | Qui envoie les requêtes                 |
| ---------------------------------------------------------------- | ------------------------ | --------------------------------------- |
| mesurer UNE page, avant/après une modification                   | `nodefony_profile_route` | l'outil lui-même, N fois, sur un chemin |
| voir ce que fait le trafic que TU génères (tests, navigation, …) | `nodefony_observe`       | toi, pendant une fenêtre de secondes    |

**Le protocole — mesurer, corriger, re-mesurer :**

1. **Une page** : `nodefony_profile_route { "path": "/orders?page=2" }` — un CHEMIN de
   l'application, jamais une URL. `count` (défaut 50, max 200), `concurrency` (défaut 4, max 8),
   `warmup` (défaut 3 : requêtes tirées AVANT et hors mesures — la première compile la route et
   ouvre la connexion à la base). GET (défaut) ou HEAD seulement.
   **Un trafic** : `nodefony_observe { "durationSec": 10 }` (1 à 50 s), et PENDANT la fenêtre,
   sollicite le code — l'outil n'envoie RIEN ; sans trafic, son verdict est « rien à juger ».
   `"route"` restreint à une route, par son NOM (`nodefony_inspect` sujet `routes`).
2. Lis le rapport (ci-dessous), corrige la cause nommée.
3. **Rappelle l'outil avec les MÊMES arguments** et compare le bloc `Données (JSON…)` des deux
   appels : un correctif qu'on n'a pas vu changer le chiffre est une hypothèse. Exemple réel, un
   N+1 corrigé par `$in` : 18 requêtes SQL par page → 3, p50 1,2 ms → 0,7 ms.

**Au nom de qui — une page protégée vue sans compte ne mesure que des refus.**
`nodefony_profile_route` joue par défaut le **propriétaire du jeton MCP** si ce jeton porte le
scope `admin:write` : il ouvre une vraie session à son nom (tous ses rôles), tire avec, puis la
détruit — l'audit l'écrit (`login.success`, raison `devkit`). `"as": "<identifiant>"` joue un autre
compte, dont les rôles doivent être inclus dans ceux du propriétaire (jamais de montée en droits).
`"anonymous": true` force l'anonyme. Sans `admin:write`, l'outil joue l'anonyme et le rapport dit
la commande : `npx nodefony security:mcp:token --scope "admin:read admin:write" --write` — puis
relance l'agent, qui lit son jeton au démarrage.

**Lire le rapport, dans l'ordre où il s'écrit :**

| Ligne                                  | Ce qu'elle dit                                                                     | Le geste                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Verdict : … INCOMPLÈTE` + `⚠️`        | les chiffres ne portent pas sur tout — la cause suit, AVANT tout chiffre           | lever la cause nommée, rappeler l'outil                                                                         |
| `⚠️ … REFUSÉE(S) (401×…, 403×…)`       | la page est protégée : ces requêtes ne mesurent rien (verdict « rien à juger »)    | anonyme → le jeton `admin:write` ; compte → un compte qui a le rôle (`as`), ou la zone n'accepte pas la session |
| `⚠️ … REDIRIGÉE(S) vers /login`        | la page renvoie vers la connexion : on mesure la redirection, pas la page          | jouer un compte, comme ci-dessus                                                                                |
| `Tir :` · `Joué en tant que :`         | ce qui a été envoyé, la chauffe, l'identité réellement jouée                       | vérifier que c'est bien la mesure voulue                                                                        |
| `N+1 — route … ×N dans une requête`    | la même requête SQL répétée N fois dans UNE requête HTTP : une boucle sur la base  | charger d'un coup : `relations` du dépôt, ou `$in` sur les identifiants                                         |
| `Erreurs — route …` + `Journal …`      | les `5xx` et les lignes WARNING/ERROR de leur journal, par `requestId`             | corriger d'après le message ; `nodefony_admin_call` syslog `logs` pour la suite du journal                      |
| `Lente — route … p95 …`                | p95 ≥ 500 ms, avec ce qui coûte par requête                                        | `action.self` domine → le code de l'action ou d'un service ; `SQL (cumul)` → les requêtes ; `render` → la vue   |
| `Boucle d'événements bloquée`          | un traitement SYNCHRONE a gelé le process ≥ 100 ms : toutes les routes ont attendu | chercher la boucle lourde, l'API `*Sync`, le gros `JSON.parse` ; juste après un démarrage, rappeler plus tard   |
| `Refus (hors percentiles)` (`observe`) | des `401`/`403` dans le trafic observé : ces requêtes ne mesurent rien             | appeler avec une session ou un jeton, pas conclure sur ces durées                                               |

**Pièges :**

- **Ne modifie AUCUN fichier pendant la mesure** : le serveur de développement redémarre, l'outil
  rend un rapport partiel marqué « interrompu ». Rappelle-le une fois le serveur relancé.
- **Les requêtes de `nodefony_profile_route` sont de VRAIES requêtes** : une page qui écrit en GET
  (compteur, session créée pour chaque visiteur anonyme) écrit N fois. Le rapport le montre — c'est
  souvent une découverte en soi.
- **Les zones à jeton (`jwt`, `external-jwt`) ne sont pas jouées** : seule la session l'est ; leurs
  requêtes rendent `401`, et le rapport le dit.
- **Le journal d'une `5xx` n'est lu que par un appelant authentifié** (scope `admin:read`). Sans
  jeton, le rapport le dit et nomme le geste.
- **`nodefony_observe` écarte l'outillage (`/nodefony/…`)** — console, API d'administration, porte
  MCP ; `"includeTooling": true` le compte. `nodefony_profile_route` mesure le chemin qu'on lui
  donne, quel qu'il soit.
- **Les valeurs SQL sont masquées** (`?`) : le rapport montre la FORME d'une requête, jamais une
  donnée.
- **« boucle d'événements : non mesurée »** : le tir a duré moins de cinq périodes de la sonde ;
  augmente `count` pour la lire.
- **Abandonner l'appel** n'arrête pas toujours l'outil côté serveur : selon le client, il va au bout
  de son tir (45 s au plus) ou de sa fenêtre.
- Les deux outils n'existent qu'en **développement** (`@nodefony/devkit`) ; ailleurs, ils répondent
  qu'il n'y a aucun profileur.

## 6. Avant de dire « réparé »

1. **Rejoue le symptôme d'origine** — la même requête, la même commande — et constate qu'il a
   disparu. Un correctif qu'on n'a pas vu agir sur le symptôme est une hypothèse.
2. **`npx nodefony doctor`** ne signale plus rien de neuf.
3. **`npm run verify`** : le correctif n'a rien cassé ailleurs.
4. **Dis la cause**, pas seulement le geste : « le `dist/` était en retard » apprend quelque chose
   au suivant ; « j'ai relancé le build » ne lui apprend rien.
