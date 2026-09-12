# La TÂCHE 0 du banc de découvrabilité — l'agent crée l'application

> Détail de la section « La TÂCHE 0 » du `SKILL.md`. Vérité courante, pas un journal :
> mettre à jour = éditer la section concernée en place.

Toutes les autres tâches démarrent dans une application que le décor a fabriquée,
toujours en « Vitrine complète ». L'étage du dessous n'était jamais joué : **l'agent
ne créait jamais l'application**. Il ne choisissait pas le contenu, ne répondait pas
au questionnaire, n'installait rien — or c'est le premier contact d'un découvreur, et
c'est là que l'essai réel du 2026-09-10 a cassé.

```bash
node $B --task 0                       # le canal par défaut : alpha
NF_DEVKIT_BENCH_CANAL=latest node $B --task 0   # après la 10.0.0
```

## 🔴 Elle ne mesure PAS la même chose que les autres — le registre

`npm create nodefony@alpha` installe depuis le **registre public**. Tout le reste du
banc est monté en décor ISOLÉ, depuis les tarballs du dépôt, et c'est délibéré
(`bench-discoverability.mjs:4449` : « ses deps `@nodefony/*` ne sont publiées nulle
part et son `npm install` part sur le registre »).

**La tâche 0 éprouve donc la chaîne PUBLIÉE, pas le code du dépôt.** Ce n'est pas un
défaut — c'est le seul étage qui éprouve ce qu'un découvreur reçoit vraiment — mais il
faut le savoir, sinon on croira dépister une régression du dépôt en mesurant une
version figée il y a trois jours.

**Une campagne se rejoue sur CHAQUE version qu'on peut réellement installer** :

| `NF_DEVKIT_BENCH_CANAL` | Ce que l'agent tape                  | Ce qu'on mesure          |
| ----------------------- | ------------------------------------ | ------------------------ |
| `alpha` (défaut)        | `npm create nodefony@alpha`          | la préversion PUBLIÉE    |
| `beta`                  | `npm create nodefony@beta`           | la beta PUBLIÉE          |
| `latest`                | `npm create nodefony@latest`         | la stable PUBLIÉE        |
| `10.0.0-alpha.5`        | `npm create nodefony@10.0.0-alpha.5` | **cette version-là**     |
| `local`                 | idem, **registre interposé**         | **le dépôt** (non câblé) |

🔴 **La version EXACTE est la seule forme REJOUABLE.** `latest` d'aujourd'hui n'est pas
celui du mois prochain : une mesure qui ne cite qu'une étiquette ne se rejoue pas, et
deux runs séparés par une publication porteraient la même étiquette en ayant joué deux
décors. C'est pourquoi la version RÉSOLUE entre de toute façon dans l'empreinte, quelle
que soit la forme demandée.

⚠️ **`local` n'est PAS câblé**, et `registreLocalRequis` existe pour que l'appelant
REFUSE de jouer plutôt que de replier sur le registre public. Un repli silencieux
mesurerait la version publiée en croyant mesurer le dépôt — le faux verdict le plus
coûteux du lot, puisqu'il ne se voit nulle part.

**La version RÉELLEMENT installée entre dans l'empreinte du décor** (`versionInstallee`,
lue dans `node_modules/nodefony/package.json`, jamais la plage du manifeste). Sans
elle, deux runs séparés par une publication seraient comparés comme s'ils avaient joué
le même décor — l'erreur exacte que la règle 3 du dépistage refuse, et elle serait
invisible puisque le dépôt, lui, n'aurait pas bougé d'une ligne.

## L'énoncé donne la commande, et rien d'autre

Un agent dans un dossier vide ne peut pas deviner le canal : aucun fichier ne le porte,
et `npm create nodefony` nu sert la **version 7**. La commande fait donc partie de
l'énoncé. Ce qu'on mesure n'est pas sa capacité à deviner un canal npm, c'est ce qu'il
fait ENSUITE : quel contenu, quel moteur front, quelle base, et où il trouve une
identité pour appeler sa propre route protégée.

`canalDe` **LÈVE** sur un canal inconnu, plutôt que de replier sur un défaut : `aplha`
servirait la version 7 sans un mot.

## Ce qu'elle révèle et qu'aucune autre ne voit : la porte MACHINE

Le CLI a `--describe-json`, `--answers-json <fichier|->`, `-y/--yes` et `--dry-run`, et
son aide les annonce sous « Mode machine (agents, scripts) ». Un agent n'a pas de
terminal interactif : **ou bien il trouve cette porte, ou bien il reste bloqué sur un
questionnaire qui attend une frappe**. C'est la mesure la plus intéressante de la
tâche, et elle est gratuite — elle se lit dans le transcript.

## Les QUATRE issues, et pourquoi les confondre coûte cher

| Issue                                 |      Sortie | Ce qui la constate                                     |
| ------------------------------------- | ----------: | ------------------------------------------------------ |
| **A** — ça marche                     |         `0` | ressource servie à qui a le rôle, refusée à l'anonyme  |
| **B** — juste mais INAPPELABLE        |         `8` | elle refuse **aussi** le porteur du rôle               |
| **C** — fait, mais a CASSÉ l'existant |         `5` | les tests **livrés par le générateur** ne passent plus |
| **D** — n'a pas abouti                | `1`/`3`/`6` | pas d'application, elle ne démarre pas, ou rien monté  |

**L'issue C est celle qu'on n'aurait pas vue.** Le 2026-09-12, sur « un visiteur non
connecté n'accède à rien », un agent a fermé la zone `/api` ENTIÈRE — geste que le
gabarit lui RECOMMANDE — emportant les routes de démonstration, le canal temps réel et
les **dix tests de bout en bout livrés**. Ni réparés, ni mentionnés : de son point de
vue, la tâche était faite. Un juge qui ne sépare pas cette issue imputerait au
framework une conséquence de l'ÉNONCÉ.

🔴 **L'ordre des contrôles EST la règle** : l'issue C se juge **avant** la protection.
Un agent dont la route est impeccable mais qui a cassé la suite livrée a échoué ;
l'ordre inverse rendrait un vert sur une application amputée. Le `--prove` du juge
mute cette priorité et le contrôle tombe — c'est ainsi qu'on sait qu'elle garde.

**La frontière livré / ajouté est un cadeau du produit** : `create app` pose lui-même
un dépôt git et un premier commit. `testsLivresDuPremierCommit` lit `ls-tree` de ce
commit — la frontière est donc EXACTE, et le banc n'a pas eu à la fabriquer. Quand elle
n'est pas lisible, l'issue C n'est **pas** comptée verte pour autant : le juge le dit
et poursuit sur ce qu'il peut mesurer.

## Deux pièges qui feraient un faux verdict

- **Le dossier créé se RÉSOUT, il ne se suppose pas.** `--dir` existe et le défaut est
  `./<nom>` : l'agent peut générer dans le dossier courant comme dans un sous-dossier
  au nom qu'il a inventé. Un juge qui attendrait `<vide>/<nom-attendu>/` rendrait « n'a
  pas abouti » sur un travail réussi — le faux rouge le plus cher du lot, puisqu'il
  accuse l'agent d'un échec qui est le nôtre. Le critère est ce qui DÉFINIT une
  application Nodefony : un `package.json` qui dépend de `nodefony`, `node_modules` et
  les dossiers cachés écartés (sans quoi le premier paquet venu gagne).
- **Deux candidats ⇒ on ne tranche PAS.** Cause `application-ambigue`, imputée à
  l'INSTRUMENT et non à l'agent. Mieux vaut une tâche non jouée qu'un verdict rendu sur
  le mauvais dossier.

## La référence CONCURRENTE — ce qui donne une échelle aux tours

Un banc qui ne rend qu'un nombre de tours ne dit pas si 40 est bon ou mauvais.
`REFERENCE_CONCURRENTE` porte le seul essai réel dont on possède le transcript complet :

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| agent · modèle | `copilot` (vscode-agent-host) · `gpt-5.6-luna`                                 |
| tours · outils | **86** · 143                                                                   |
| durée          | 34 min 28 s                                                                    |
| skills chargés | `nodefony-add-crud`, `nodefony-add-realtime-channel`, `nodefony-protect-route` |

🔴 **C'est une borne BASSE, et ASSISTÉE** : quatre messages humains se sont ajoutés à
l'énoncé, dont une **correction de trajectoire à 2 min 30** — « non il faut travailler
dans le repertoire de app ». L'agent s'était trompé de répertoire, ce qui est
précisément ce que la tâche 0 met en jeu. Un agent autonome n'a pas ce filet, et
comparer sans le dire surestimerait le concurrent. `situerTours` accole donc la réserve
à CHAQUE comparaison — son `--prove` mute ce point et le contrôle tombe.

## Éprouver la tâche sans la jouer

Les deux auto-contrôles sont dans le lot de `selftests.mjs` (qui les balaye), et se
lancent aussi seuls — quelques millisecondes, aucun décor, aucun agent :

```bash
node .claude/skills/nodefony-devkit-bench/scripts/lib/tache-zero.selftest.mjs --prove
node .claude/skills/nodefony-devkit-bench/scripts/lib/gate-tache-zero.selftest.mjs --prove
```

`tache-zero.selftest.mjs` éprouve le socle — résolution du dossier, canal, version
installée, comparaison des tours. `gate-tache-zero.selftest.mjs` éprouve la règle qui
sépare les quatre issues, sur `classerIssue`, qui est PURE.

🔴 **`--prove` mute le VRAI module** (une copie, dans un fichier voisin jeté ensuite) et
exige que le contrôle TOMBE. C'est la seule forme qui prouve quelque chose : une
première version de ces auto-contrôles réimplémentait la règle pour l'amputer, et
« prouvait » donc un code qui n'était pas celui qu'on exécute. Neuf mutations au total,
toutes vues tomber.

## Le décor VIDE — ce qui change dans le lanceur

La tâche porte `decor: "vide"`, et ce seul champ débranche toute la machinerie qui
suppose une application déjà là :

| Étape ordinaire                                                 | En décor vide                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| remise à zéro (`git clean -xdf` + `npm prune` + reconstruction) | **rien** — un dossier neuf est CRÉÉ par répétition          |
| prémisse de l'énoncé, commit de décor                           | aucune : c'est tout l'objet de la tâche                     |
| constat de la porte MCP, démarrage préalable                    | sautés — l'application n'existe pas encore                  |
| commit de la passe                                              | posé dans l'application que l'AGENT a créée                 |
| base du diff                                                    | le **premier commit**, celui que `create app` pose lui-même |

Le dossier est `<runDir>/tache-0/`, **conservé** après le run : c'est lui que les
sondes inspectent, et c'est en lui qu'on entre pour instruire un rouge.

🔴 **Le montage du décor témoin est SAUTÉ** quand toutes les tâches demandées sont en
décor vide. Il coûte une installation complète — plusieurs minutes — et la tâche 0
n'en a aucun usage : elle fabrique son décor et installe depuis le registre public.
C'est ce qui rend `--task 0` jouable seul, alors qu'il est déjà le poste le plus lourd
du catalogue.

## Le critère CLIENT suit le moteur choisi

Le juge `scripts/lib/gate-porte-client.mjs` lit le moteur front dans le **manifeste** de
l'application — `FRONTEND_PARAMS[…].client.marker`, le mot du produit — puis exige SA
porte : `nodefony/svelte`, `/vue`, `/angular`, `/react`, ou `nodefony/client` sans
moteur front. `RealtimeClient` reste accepté partout : c'est la façade elle-même.

**Pourquoi ce n'est pas un détail** : l'ancien critère était écrit en dur pour React.
Le banc était donc React-centré exactement comme le gabarit qu'il éprouve — et l'agent
du premier essai réel a choisi **Svelte**. Sur cette application, le critère recalait un
travail juste et ne pouvait rien voir du trou que #347 a fermé.

Deux moteurs signés, ou pas de manifeste lisible ⇒ **verdict non rendu**, imputé à
l'INSTRUMENT. Mieux vaut une sonde non opposable qu'un verdict rendu sur le mauvais
critère.

⚠️ **La table des portes est une COPIE** — sa source vit dans le produit, en
TypeScript, derrière une frontière de paquets qu'un banc en JavaScript pur ne franchit
pas. Son auto-contrôle la **confronte** au source (`engine.ts`) plutôt que de la
relire : ajouter un moteur au produit sans l'ajouter ici fait TOMBER le contrôle.

⚠️ **Ce changement touche aussi la tâche 3**, dont c'était la sonde `code` statique :
son empreinte change, donc le dépistage REFUSERA de la comparer à la référence tant
qu'elle n'aura pas été rejouée. C'est le prix du critère juste, et il est nommé.

## Ce qui reste à faire

- **Le point 4 du « Fini quand » de #348** — voir la tâche ROUGE avant les correctifs
  de #340, VERTE après — demande de vrais runs d'agent : il n'est pas prouvé.
- **Factoriser le contraste à trois identités** avec `gate-secure-route.mjs`, qui le
  porte déjà. Deux implémentations divergeraient en silence. Ce n'a pas été fait parce
  que modifier ce juge sous un run de recalage aurait fait refuser la comparaison sur
  sa tâche : l'empreinte d'une tâche couvre le CONTENU de ses juges.

> ⚠️ **Corollaire, et il vaut pour toute évolution du banc** : on n'édite pas un
> `gate-*.mjs` ni un `prepare-*.mjs` EXISTANT pendant qu'un run tourne. `empreinteTache`
> les relit **sur disque** au moment d'écrire la référence — les verdicts seraient
> rendus par l'ancien juge et l'empreinte calculée sur le nouveau. Ajouter des fichiers
> NEUFS et une tâche neuve, en revanche, ne touche aucune empreinte existante.
