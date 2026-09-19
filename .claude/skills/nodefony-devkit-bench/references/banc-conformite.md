# Banc de conformité — l'application tient-elle les promesses du framework ?

> Référence du skill `nodefony-devkit-bench`, chargée **avant de lancer ce banc** : le script rend
> un chiffre, c'est le protocole qui en fait une mesure. Déclencheurs : « l'app générée tient-elle ses promesses ? », « les promesses du framework sont-elles vraies ? ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

```bash
node scripts/verify-generated.mjs --keep        # d'abord : monte le décor et l'éprouve
node scripts/verify-runtime.mjs                 # puis : la conformité, trois étages
node scripts/verify-runtime.mjs --etage unit    # un seul étage (unit | integration | e2e)
```

**Deux bancs, deux questions qu'on confond.** `verify-generated.mjs` demande « ce
qui a été PRODUIT tient-il debout ? » ; celui-ci demande « ce qui a été CÂBLÉ
tient-il les promesses ? ». Une application peut compiler parfaitement, démarrer
sans un mot, et servir une liste dont le client dicte la borne, une suppression
que personne n'a besoin d'autoriser, un controller déclaré dont aucune route
n'est montée.

Il **réutilise le décor** du banc de vérité (`--keep`) : monter le sien coûterait
une minute, et surtout il jugerait une AUTRE application que celle dont on vient
de prouver qu'elle compile.

| Étage         | Décor                                                     | Ce qu'il attrape SEUL                                                                                                                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`        | aucun                                                     | balise de gabarit non résolue, `any`, service `@injectable` non déclaré, `process.env` hors catalogue                                                         |
| `integration` | l'app boote en entier, **zéro port** (`nodefony inspect`) | service non résolu au conteneur, controller déclaré sans route, collision méthode+chemin, route qui contourne le firewall, schéma qui ne produit pas de table |
| `e2e`         | serveur RÉEL, en production                               | CRUD complet (201+Location, 422, PATCH, 204→404), suppression sans identité, borne de pagination, `nosniff`, cookie HttpOnly+SameSite, WebSocket co-citoyen   |

Les suites vivent dans `suites/` (`harness.ts`, `conformite.unit.test.ts`,
`conformite.integration.test.ts`, `conformite.e2e.test.ts`) et sont **injectées**
dans l'application témoin, jouées, puis jetées avec le décor. Elles ne sont
**jamais livrées à l'utilisateur** : « ma commande porte-t-elle son namespace ? »
est une question du générateur, pas de l'application.

> 🔴 **Quatre GARDES anti-suite creuse, et elles ont mordu dès le premier run.**
> Chaque étage commence par un cas qui vérifie que la sonde a trouvé de quoi
> mesurer — des sources, des routes, une ressource REST, une identité. Sans
> elles, la famille CRUD entière rendait la main sur un `null` et comptait
> **quinze cas verts en 0 ms, zéro requête émise**. Le signe ne se voit que dans
> la colonne des durées, et jamais dans le total.

> ⚠️ **La sonde est le premier suspect, pas le produit.** Au premier run, dix cas
> sur onze accusaient le générateur — et tous étaient faux : les suites
> s'analysaient elles-mêmes, un contrôle de code lisait les commentaires,
> `nodefony check` tombait sur le serveur de développement du POSTE faute de
> ports dédiés, et `cluster` — une valeur de configuration — était compté comme
> un module manquant. Un seul défaut réel dans le lot.

### Lancer npm sur les trois systèmes — `scripts/lib/exec-portable.mjs`

Sous Windows, `npm` et `npx` sont des `.cmd`, et Node **refuse** de les
exécuter sans `shell: true` depuis le correctif de CVE-2024-27980. Il ne le dit
pas : il rend `spawnSync npm ENOENT`, qui se lit « npm n'est pas installé » — sur
un runner où `npm ci` vient de réussir. C'est ainsi que le premier passage
Windows du banc du code généré est tombé, à la première étape, pendant que linux
et macOS étaient verts.

La règle a **une seule** implémentation (`needsShell`), appelée par les deux
helpers d'exécution (`scripts/lib/isolation.mjs`, `scripts/verify-generated.mjs`). Elle est
**pure** — plateforme et grammaire de chemins injectées — parce qu'une fonction
qui lit `process.platform` ne s'éprouve que sur la plateforme qu'elle décrit,
c'est-à-dire jamais ici :

```bash
node scripts/lib/exec-portable.selftest.mjs           # les deux branches, partout
node scripts/lib/exec-portable.selftest.mjs --prove   # amputée, elle doit faire tomber 2 cas
```

> ⚠️ **Non couvert** : `bench-schema.mjs` et `bench-discoverability.mjs` ont leurs
> propres helpers et lancent de vrais agents — ils ne tournent pas en intégration
> continue, donc rien ne les éprouve sous Windows. Le défaut y est présent, et il
> est nommé plutôt que corrigé à l'aveugle.

### Rendre la page publique du banc

```bash
node .claude/skills/nodefony-devkit-bench/scripts/build-devkit-report.mjs [--data docs/devkit/data/10.0.0.json] [--out tmp/devkit.html]
```

**Ce rendeur ne MESURE rien**, et c'est le contrat : le banc lance de vrais
agents, coûte de l'argent et prend des heures ; sa sortie est **commitée** dans
`docs/devkit/data/<version>.json`. La page n'est qu'un rendu de ce jeu —
déterministe, rejouable, indépendant de la machine qui l'exécute. Même règle que
le site de performance, et pour le même motif : un chiffre reste attaché à sa
version, définitivement.

### Purger les décors — garder la MESURE, jeter le DÉCOR

```bash
node $B --purge              # ce qui serait libéré, sans rien toucher
node $B --purge --confirmer  # supprime les `app/`, garde tout le reste
```

Un run pèse ~300 Mo, dont **moins de 1 %** est la mesure : le reste est
l'application témoin et ses `node_modules`. Mesuré ici : **47 runs = 13 Go**,
pour 200 Mo de transcripts, verdicts de gates et rapports. Le décor se
reconstruit — c'est tout l'intérêt d'un décor jetable ; les transcripts, non.
Ce sont eux qui permettent d'INSTRUIRE un échec des mois plus tard sans repayer
un run, et deux faux rouges du banc ont été trouvés exactement comme ça.

🔴 **Le run que la référence cite garde son décor**, et ce n'est pas une
politesse : `--analyze-only` rejoue les gates SUR l'application — elle est
reconstruite et interrogée en HTTP. Sans son `app/`, le re-jugement gratuit
devient impossible et il faut repayer des heures d'agent. La purge le nomme et
l'écarte.

Le mode DIT par défaut et n'agit que sur `--confirmer` : c'est une suppression,
elle ne se déclenche pas par inadvertance.

### Dépistage — 1 run sur tout, 3 runs sur ce qui a bougé

Rejouer toutes les tâches trois fois à chaque changement coûte des heures et des
dizaines de dollars. Les rejouer **une** fois ne prouve rien : même gabarit,
même modèle, même décor, la tâche 14 a rendu **2 PASS / 2 FAIL**. La sortie
n'est ni l'un ni l'autre — c'est de comparer un run large à une **référence
écrite**, et de ne payer trois runs que sur le peu qui a bougé.

```bash
B=.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node $B                                  # 1º le run large — c'est LUI qui coûte, et on le décide
node $B --depistage --analyze-only <run> # 2º le compare à baseline.json : gratuit, aucun agent
node $B --task 26 --runs 3               # les 3 runs, décor remis à zéro entre chaque
node $B --task 26 --runs 3 --enregistrer-reference   # fige le résultat dans la référence
node $B --analyze-only <run1>,<run2>,<run3>          # agréger des runs déjà joués
```

**Le dépistage ne produit pas la mesure qu'il compare — elle lui est DONNÉE.**
`--depistage` sans `--analyze-only` refuse en **78** et nomme les runs
comparables : il déroulerait sinon le catalogue entier avec de vrais agents
avant de comparer le rapport du run qu'il vient de payer. Et il ne choisit pas
de run à ta place — « le dernier » serait un run partiel, ou d'un autre décor,
c'est-à-dire la comparaison fausse que la règle 3 ci-dessous existe pour
refuser.

Sorties : **0** rien n'a bougé · **3** des tâches attendent trois runs · **78**
refus (décor incompatible, référence absente, ou dépistage sans run). Un FAIL
_conforme à la référence_ ne sort pas 1 : le mode répond « qu'est-ce qui a
bougé ? », pas « tout est-il vert ? ».

La référence (`baseline.json`, versionnée à la racine du skill) porte le modèle,
le décor, l'agent, et par tâche le verdict, le nombre de runs et les runs
d'origine. Quatre règles la gouvernent, chacune payée par une erreur déjà
commise — et toutes vues rouges par `reference.selftest.mjs --prove` :

0. **Le verdict binaire ne DÉCIDE pas seul — la référence garde aussi les
   TOURS.** L'unanimité sur 3 runs a une résolution catastrophique : une tâche
   que le devkit réussit 4 fois sur 5 sort « instable » une fois sur deux
   (P(3/3 | p=0,8) = 0,51). Rejouer ne la stabilise jamais — la référence
   portait la tâche 13 à `passes: 2, runs: 3` le 2 août ; trois runs repayés
   trois semaines plus tard ont rendu exactement 2/3. Deux mesures, zéro
   information. Les TOURS, eux, sont continus et déjà mesurés à chaque run :
   sur ces mêmes trois runs, 52 · 54 · 88, et le seul qui échoue est le seul où
   l'agent n'a pas trouvé le générateur. Là où le verdict hésite, l'effort
   tranche. `medianeTours` (jamais le dernier run, jamais la moyenne) entre dans
   la référence, et le dépistage classe les tâches **ALLÉGÉES** et **ALOURDIES**
   — verdict inchangé, effort qui bouge. Elles ne se REJOUENT pas : c'est tout
   l'intérêt.
1. **Unanimité** — un verdict agrégé n'est PASS que si TOUS les runs le sont.
   « 2/3 » n'est pas « plutôt bon » : c'est instable, donc non prouvé.
2. **Asymétrie** — une REMONTÉE (référence FAIL → run PASS) se rejoue autant
   qu'une chute. Elle suit une correction, elle arrive quand on l'espère, et
   c'est précisément pour ça qu'on la croit sur un run. L'erreur est vécue.
3. **Le décor est une variable de la mesure** — modèle, isolation, agent : un
   écart REFUSE la comparaison (sortie 78). Un avertissement se lit après coup ;
   une comparaison fausse s'utilise tout de suite.
   ⚠️ **Et ce refus ne se contourne pas à la main.** Vécu : un run large rendu
   dans un décor « MCP atteignable » face à une référence sans MCP a vu sa
   comparaison refusée, puis rejouée au `jq` par l'opérateur — qui a lu trois
   « chutes » qu'aucun changement n'expliquait. Refaire soi-même le calcul que
   la garde interdit, c'est reproduire exactement l'erreur qu'elle empêche.
   3bis. **Le CODE qui rend le verdict est une variable de la mesure, au même
   titre que le décor.** L'empreinte d'une tâche couvre l'énoncé, le `prepare`,
   les noms des sondes — et désormais le **source de chaque `observe`** et le
   **contenu de chaque juge** que la tâche nomme. Sans cela, corriger un juge
   n'invalidait rien : trois juges qui punissaient une protection légitime ont
   été corrigés, un quatrième était mort depuis cinq jours, et pas une référence
   n'a bougé — on opposait des verdicts d'aujourd'hui à des verdicts rendus par
   un juge qui n'existe plus, sous l'étiquette « conforme à la référence ».
   Toucher une ligne d'un `gate-*.mjs` fait donc **refuser** la comparaison sur
   ses tâches, en les NOMMANT : on sait quoi rejouer plutôt que tout redemander.
   Un commentaire compte aussi — refuser à tort coûte un run nommé, comparer à
   tort coûte la mesure entière et ne se voit pas ; seule la remise en forme
   (espaces) est absorbée. L'empreinte est **indépendante de la machine** :
   les tâches composent leurs chemins de juge en absolu, et sans normalisation
   un dépôt cloné ailleurs voyait toutes ses tâches « réécrites ».

4. **Un rouge NON OPPOSABLE écarte le run** — une gate rejouée sur l'app
   d'aujourd'hui (run antérieur aux gates figées) ne juge pas la tâche. Le banc
   le DISAIT déjà dans son texte, sans en tirer la conséquence : le rouge était
   compté, et il a fabriqué un FAIL de référence sur une tâche qui passait.

Le mode **ne relance rien** : il nomme les tâches et rend la commande à copier.
Un banc qui décide seul de rejouer dépense sans qu'on l'ait voulu — c'est ce que
la garde ci-dessus fait tenir, plutôt que de le promettre.

> 🔴 **Ne pas repayer des runs pour reconfirmer un verdict déjà instable.** Une
> tâche que la référence donne à « 2/3 » le restera : la rejouer remesure le même
> aléa. Ce qui apprend quelque chose, c'est d'INSTRUIRE le transcript d'un run
> rouge — c'est ainsi qu'on a trouvé deux bugs du framework (une sortie tronquée
> au-delà de 64 Ko, un `inspect` muet sur son mode) et trois défauts du banc
> lui-même. Le banc sert à ouvrir une enquête, pas à produire un score.

**Détail : [`references/banc-decouvrabilite-lecons.md`](banc-decouvrabilite-lecons.md)**
— dix leçons, chacune payée par un défaut réel : les sondes s'éprouvent avant de juger, mesurer
la performance sans jamais comparer une durée, le meilleur juge demande à l'application (pas au
dépôt), un vert par abandon n'est pas un vert, une tâche ne juge pas l'agent sur la saleté de la
précédente, le décor est celui de l'utilisateur, ce banc ne découvre pas les trous — il les garde
fermés, nommer la cause ne suffit pas (il faut dire à qui elle est opposable), la sécurité ne se
juge pas sur une présence de texte, et mesurer qu'on pose une garde ne dit rien sur celle qu'on
