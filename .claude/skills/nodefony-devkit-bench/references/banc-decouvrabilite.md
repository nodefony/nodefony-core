# Banc de découvrabilité — l'agent trouve-t-il ?

> Référence du skill `nodefony-devkit-bench`, chargée **avant de lancer ce banc** : le script rend
> un chiffre, c'est le protocole qui en fait une mesure. Déclencheurs : « l'agent trouve-t-il les générateurs ? », « combien de tours a pris l'agent ? », « rejouer le banc devkit ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

```bash
# TOUS les contrôles internes du banc, en UNE commande — avant de conclure quoi que ce soit
node .claude/skills/nodefony-devkit-bench/scripts/selftests.mjs --prove
# La remise à zéro du décor sur un run RÉEL — le lot la joue sinon sur un décor jetable :
node .claude/skills/nodefony-devkit-bench/scripts/reinit-decor.selftest.mjs <runDir>
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --task 1
```

> ⚠️ **Un drapeau inconnu ne lance plus rien** — il rend l'usage et sort en `64`.
> Tant que le banc ignorait ce qu'il ne comprenait pas, un `--help` (qui n'existait
> pas) ou une faute de frappe déroulait le catalogue ENTIER avant qu'on s'en
> aperçoive : des dizaines de minutes d'agents payées pour une lettre en trop.
> `--help` liste maintenant les drapeaux, les variables de décor et les codes de
> sortie. **Une seule implémentation la porte** (`scripts/lib/argv.mjs`), et les quatre
> scripts qu'on tape s'y branchent — les deux bancs de vérité montent un décor
> complet, celui de découvrabilité déroule de vrais agents.
>
> Écrite à la main dans un seul banc, cette garde avait aussitôt recalé
> `--setup-only` : un drapeau que le fichier documentait ET traitait, mais que sa
> liste blanche ignorait. `scripts/lib/argv.selftest.mjs` confronte donc, pour chaque
> script, les drapeaux qu'il LIT à ceux qu'il DÉCLARE — sans exécuter aucun banc,
> en les appelant avec un drapeau bidon EN PREMIER, ce qui fait sortir la garde
> avant que rien ne soit monté. Il a trouvé `--etage` le jour où il est né.

> **Plus aucun contrôle n'est hors du lot.** Deux l'étaient, chacun avec son
> motif écrit — l'un « exige le chemin d'un run déjà consommé », l'autre « exige
> une application démarrée et une porte MCP ouverte ». Nommer un trou n'est pas
> le fermer : ni script npm, ni forge, ni le lot ne les appelaient, et ils
> gardaient précisément ce qui casse sans bruit (la remise à zéro entre deux
> tâches, la validité du jeton pendant tout un run). Le premier monte désormais
> un décor JETABLE quand on ne lui donne pas de run — son `.gitignore` est COPIÉ
> du gabarit du produit, jamais réécrit de tête, puisque c'est lui que le
> contrôle éprouve. Le second n'exigeait RIEN : relu, il ne fait aucun appel
> réseau et rend 10/10 en une seconde. **Une exclusion écrite une fois n'est
> jamais relue ; elle survit à ce qui la justifiait.**
>
> 🔴 **Un contrôle que personne ne lance ne garde rien.** Ces sondes étaient
> écrites, justes, et énumérées ici une par une — donc jamais exécutées :
> personne ne tape autant de commandes avant de conclure. Ce que ça a coûté, en
> une fois : `imputation.selftest.mjs` portait déjà le contrôle d'exhaustivité
> « toute cause émise par un juge est-elle classée ? », capable de nommer les
> quinze causes que trois juges neufs émettaient sans qu'aucune ne soit
> classable. Pendant un mois, le banc a donc écarté des runs PAYÉS en disant
> « trou d'instrument » de ce que son propre juge nommait précisément.
> `selftests.mjs` existe pour rendre le lot atteignable d'une seule commande.
>
> Et le contrôle lui-même était **aveugle par sa forme** : il relevait les causes
> à la source par le motif `CAUSE=<nom>`, que les juges de première génération
> impriment eux-mêmes — mais un juge qui sépare la collecte du verdict REND
> `{ cause: "<nom>" }` et laisse l'impression à l'appelant. Balayer le dossier ne
> suffisait pas : c'est la FORME écrite qui décidait de ce qu'on voyait, et le
> compte affiché (« 86 émises, 85 classées ») donnait le change.

### La TÂCHE 0 — l'agent crée lui-même l'application, dans le vide

Toutes les autres tâches démarrent dans une application que le décor a fabriquée,
toujours en « Vitrine complète » : **l'agent ne crée jamais l'application**. La tâche 0
le fait partir d'un dossier VIDE, avec la commande de création dans l'énoncé et rien
d'autre — c'est le premier contact d'un découvreur.

```bash
node $B --task 0                                 # canal par défaut : alpha
NF_DEVKIT_BENCH_CANAL=latest node $B --task 0    # après la 10.0.0
```

🔴 **Elle ne mesure PAS la même chose que les autres** : `npm create nodefony@alpha`
installe depuis le **registre public**, quand tout le reste du banc est monté en décor
isolé depuis les tarballs. Elle éprouve donc la chaîne PUBLIÉE, pas le dépôt — et la
version réellement installée entre dans l'empreinte du décor, sans quoi deux runs
séparés par une publication seraient comparés comme s'ils avaient joué le même décor.

Elle sépare **quatre issues** qu'aucune autre tâche ne distingue — ça marche · juste
mais inappelable · **fait ce qu'on demandait ET cassé l'existant** · n'a pas abouti.
La troisième est celle qu'on n'aurait pas vue : fermer la zone `/api` en entier, geste
que le gabarit RECOMMANDE, emporte les dix tests de bout en bout livrés.

Son décor est un **dossier vide**, créé par répétition et conservé après : la remise à
zéro ordinaire (`git clean -xdf` + `npm prune` + reconstruction) suppose une application
déjà là et ne s'applique à rien ici. Le montage du décor témoin est d'ailleurs **sauté**
quand toutes les tâches demandées sont en décor vide — il coûte une installation
complète dont la tâche 0 n'a aucun usage, et c'est ce qui la rend jouable seule.

Le dossier que l'agent a créé se **RÉSOUT**, il ne se suppose pas — et la base du diff
est le **premier commit**, celui que `create app` pose lui-même : une frontière exacte
entre « produit par le générateur » et « ajouté par l'agent », que le banc n'a pas eu à
fabriquer.

Le **critère client suit le moteur RÉELLEMENT choisi** (`scripts/lib/gate-porte-client.mjs`) :
le moteur se lit dans le manifeste, et c'est SA porte qui est exigée — `nodefony/svelte`,
`/vue`, `/angular`, `/react`. L'ancien critère était écrit en dur pour React, ce qui
rendait le banc React-centré exactement comme le gabarit qu'il éprouve.

**Le mode d'emploi complet est déporté** — le registre et ses trois régimes, la porte
machine du CLI (la mesure la plus intéressante de la tâche, et gratuite), les quatre
issues avec leurs codes, ce que `decor: "vide"` débranche dans le lanceur, les deux
pièges qui font un faux verdict, et la référence concurrente qui donne une échelle aux
tours : **[`references/tache-zero.md`](tache-zero.md)**.

> ⚠️ **On n'édite pas un `gate-*.mjs` ni un `prepare-*.mjs` EXISTANT pendant qu'un run
> tourne.** `empreinteTache` les relit **sur disque** au moment d'écrire la référence :
> les verdicts seraient rendus par l'ancien juge et l'empreinte calculée sur le nouveau.
> Ajouter des fichiers NEUFS et une tâche neuve, en revanche, ne touche aucune empreinte.

### Jouer une campagne sur une VERSION — dépôt ou registre

Le banc éprouve par défaut le **checkout** : le CLI vient de `src/nodefony/bin`, les
paquets de tarballs fabriqués localement. C'est ce qui en fait un instrument de
non-régression. Mais une campagne doit aussi pouvoir se jouer sur ce qu'un
**utilisateur reçoit** — et sur la version de son choix.

Deux réglages, orthogonaux, valables pour **TOUTES les tâches** :

```bash
B=.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs

node $B                                                   # depot (défaut) — le checkout
NF_DEVKIT_BENCH_SOURCE=registre node $B                   # la préversion publiée
NF_DEVKIT_BENCH_SOURCE=registre NF_DEVKIT_BENCH_CANAL=beta node $B
NF_DEVKIT_BENCH_SOURCE=registre NF_DEVKIT_BENCH_CANAL=10.0.0-alpha.5 node $B
```

| Réglage                  | Valeurs                                         | Ce qu'il décide            |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| `NF_DEVKIT_BENCH_SOURCE` | `depot` (défaut) · `registre`                   | **ce qu'on éprouve**       |
| `NF_DEVKIT_BENCH_CANAL`  | `alpha` · `beta` · `latest` · `local` · version | **quelle version publiée** |

En source `registre`, le générateur lui-même vient de npm (`npm create nodefony@<canal>`) :
mesurer une version publiée avec le CLI du checkout ferait un décor hybride dont aucune
moitié ne correspond à ce qu'un utilisateur reçoit. C'est aussi le **seul régime qui voie
un défaut d'EMPAQUETAGE** — un fichier absent de `files`, un type non publié, une
dépendance rangée en `devDependencies`.

🔴 **La version EXACTE est la seule forme REJOUABLE.** `latest` d'aujourd'hui n'est pas
celui du mois prochain : une campagne qui ne cite qu'une étiquette ne se rejoue pas.

🔴 **Les deux entrent dans l'empreinte du décor**, et le dépistage AFFICHE désormais les
deux décors comparés avant tout verdict — lire « 3 chutes » sans savoir qu'on oppose
`alpha` à `beta`, ce serait prendre un changement de décor pour une régression.
La forme historique est préservée **mot pour mot** en source `depot`
(`isolé (tarballs, hors dépôt) · …`) : la changer aurait rendu incomparables, d'un
seul coup, toutes les références déjà payées.

⚠️ `local` (registre interposé) **n'est pas monté** : le banc REFUSE en `78` plutôt que
de replier sur le registre public — un repli silencieux mesurerait la version publiée en
croyant mesurer le dépôt, et ce faux verdict ne se verrait nulle part.

La règle vit dans [`scripts/lib/decor-source.mjs`](../scripts/lib/decor-source.mjs), une
seule fois pour les trois bancs, et son auto-contrôle
(`scripts/lib/decor-source.selftest.mjs --prove`) mute chacune de ses cinq règles.

### Le DÉCOR d'un run : quel agent, et quelle porte MCP

Deux réglages indépendants décident de ce qu'un run mesure — **qui** travaille, et **ce qu'il
trouve en arrivant**. Les confondre produit des comparaisons fausses : un agent mieux outillé
qu'un autre n'est pas un agent meilleur.

```bash
B=.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs

NF_DEVKIT_BENCH_MCP=auth node $B --task 9          # porte authentifiée ET app démarrée
NF_DEVKIT_BENCH_MCP=off  node $B --task 9          # l'agent ignore qu'une porte existe

NF_DEVKIT_BENCH_AGENT=vibe NF_DEVKIT_BENCH_MODEL= \
  NF_DEVKIT_BENCH_AGENT_ARGS="--output streaming --yolo --trust -p" \
  NF_DEVKIT_BENCH_MCP=auth node $B --task 9        # un AUTRE agent, foyer jetable
```

`NF_DEVKIT_BENCH_MCP` : `eteint` (défaut — porte déclarée, **application arrêtée** : le cas réel
« j'ouvre un dépôt, rien ne tourne ») · `auth` (jeton émis **et** application démarrée — les deux
vont ensemble : la porte est une ROUTE) · `off`. Le régime entre dans le décor enregistré, donc le
dépistage refuse de comparer deux régimes. Le défaut reste `eteint` : la référence a été établie
dessus.

**Ce que ces runs coûtent en pièges** — audience à déclarer, build AVANT l'émission du jeton,
démarrage APRÈS la prémisse (sinon la tâche n'est pas jouée), un code de sortie qui n'est pas un
verdict, l'ordre des drapeaux de Vibe, le foyer jetable qui doit emporter la clé d'API, et la sonde
qui comptait ROUGE un agent utilisant le MCP : **`references/agents-et-porte-mcp.md`** — à lire
AVANT de câbler un agent de plus (Codex et Gemini y ont leur ligne, à établir).

### La PRÉMISSE d'identité — ne pas payer un agent pour un verdict impossible

Neuf tâches font mesurer une protection depuis une session `admin`. Sans ce
compte, leur juge rend un rouge de DÉCOR : la bonne conduite, mais après coup —
la tâche a été jouée et l'agent payé pour un verdict qu'on savait ne pas pouvoir
rendre. Le lanceur CONSTATE donc l'identité avant de lancer l'agent
(`scripts/lib/premisse-identite.mjs`), par le geste que le juge fera — ouvrir une
session, jamais lire une ligne en base. Prémisse absente ⇒ la tâche n'est pas
jouée, et le run le dit.

Le décor est rendu dans l'état où la garde l'a trouvé : l'application n'est
arrêtée que si c'est la garde qui l'a démarrée — en régime `eteint`, l'agent
doit trouver une application à l'arrêt.

> 🔴 **Le mot de passe du compte `admin` ne se recopie JAMAIS dans le banc.** Il
> se lit là où il est posé : `NF_ADMIN_PASSWORD` si l'exploitant l'a posée,
> sinon la constante du SEMIS de l'application témoin — pas celle du gabarit du
> dépôt, qui n'est pas forcément celle d'une application rendue en source
> `registre`. **Aucun repli en dur** : ne pas savoir est une information.
>
> Ce que ça a coûté : la valeur vivait ici en dur (« admin ») pendant que le
> gabarit la changeait pour `nodefony-dev-42`. La politique de mot de passe par
> défaut refusant l'ancienne, plus aucune session ne s'ouvrait — les neuf juges
> rendaient « identité indisponible » sur TOUTES leurs tâches, pas sur la tâche
> isolée qu'on croyait. Chaque moitié du jumeau restait cohérente avec
> elle-même ; c'est l'écart que personne ne regardait.
>
> `scripts/lib/identites.selftest.mjs` confronte donc au juge du PRODUIT les valeurs que
> les bancs posent eux-mêmes (`MOT_DE_PASSE_POSE`, `MOT_DE_PASSE_SONDE`) : un
> durcissement de la politique tombe là, plus trois semaines plus tard sur un
> décor qui ne sème plus rien.

**La liste des tâches concernées se DÉRIVE du code des juges**, jamais d'une
liste écrite à la main : `scripts/lib/premisse-identite.selftest.mjs` relit quels juges
emploient l'identité partagée et exige que leur tâche porte la garde. C'est
