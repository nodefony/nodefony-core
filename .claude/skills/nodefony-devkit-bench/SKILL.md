---
name: nodefony-devkit-bench
description: >
  Éprouve ce que Nodefony PRODUIT et ce qu'il fait CROIRE, par quatre mesures — le code généré
  tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche
  découvre-t-il l'outillage, le modèle de données d'un vrai logiciel libre est-il exprimable, et que
  conclut un agent qui lit le dépôt sans y entrer. À charger AVANT de déclarer finie une évolution
  des gabarits, du moteur de génération ou des pages d'accueil : les assertions du dépôt lisent des
  chaînes dans des fichiers rendus — elles ne voient ni qu'un type généré ne compile pas, ni qu'un
  lecteur conclut le contraire de ce qu'on croit écrire.
  Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create
  entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?",
  "un vrai schéma est-il exprimable ?", "combien de tours a pris l'agent ?",
  "un agent recommanderait-il ce framework ?", "que conclut un agent en lisant le dépôt ?",
  "notre accueil dit-il vrai ?".
metadata:
  version: 1.3.0
---

# nodefony-devkit-bench — prouver ce que le scaffold produit

> **Maintenance** : ce fichier décrit la vérité COURANTE des trois bancs. Mettre à
> jour = éditer la section concernée en place. Pas de journal, pas de date :
> l'historique vit dans `git log`, l'avancement dans les **tickets**.

## Les DEUX buts — ne pas inventer, et ne pas tourner en rond

Le premier but est celui qu'on cite toujours : **l'agent ne doit rien inventer**
qu'un générateur produit déjà. Le second est aussi important, et il se rate parce
qu'aucune sonde ne le regarde : **il doit y arriver en un minimum de TOURS.**

Un devkit qui obtient la bonne réponse au bout de trente allers-retours a échoué
autrement — plus lentement, plus cher, et sur un fil : chaque tour est une
occasion de partir dans une impasse, et un agent qui tourne en rond finit par
abandonner l'outil pour écrire à la main. Le nombre de tours n'est donc pas une
métrique de confort, c'est **le même défaut vu par l'autre bout** : ce que l'agent
ne trouve pas du premier coup, il le cherche — ou il l'invente.

Chaque tâche le mesure déjà, sans rien à instrumenter — et la même commande lit
le transcript de **n'importe lequel** des six agents, pas seulement celui du CLI
de Claude :

```bash
node scripts/analyse-transcript.mjs <runDir>/task-<n>.transcript.jsonl
node scripts/analyse-transcript.mjs <fichier> --timeline   # le déroulé, commande par commande
node scripts/analyse-transcript.mjs <fichier> --json       # pour rechaîner
```

Elle rend le relevé (tours, durée, coût, appels MCP), la répartition des outils,
les gestes qui ont ÉCHOUÉ, et le déroulé apparié. Un tiret signifie « cet agent
ne l'émet pas » — jamais zéro, qui se comparerait à tort au run d'un autre.

**Pendant que le run se joue, on peut déjà le lire.** Le banc capture la sortie de
l'agent par `spawnSync` : elle n'existe qu'à la FIN de la tâche. Mais certains agents
tiennent en PLUS un journal écrit au fil de l'eau, et celui-là se suit :

```bash
node scripts/suivre-run.mjs            # le run le plus récent, gestes décisifs seulement
node scripts/suivre-run.mjs --tout     # sans filtre
```

> 🔴 **Le live se lance sur UNE tâche qu'on débogue, JAMAIS sur une campagne.** Il
> rend un flux : chaque geste de chaque agent, pendant des heures. Branché sur un
> run de 33 tâches × 3 répétitions, il déverse des milliers de lignes dans le
> contexte de qui le regarde — pour une matière dont on a déjà dit qu'elle ne rend
> AUCUN verdict. C'est le coût le plus facile à prendre sans s'en apercevoir :
> l'outil ne coûte rien à la machine, il coûte au lecteur.
> Le geste juste : `--task <n>` sur le banc, et le live à côté. Sur une campagne,
> on lit le RAPPORT, et on n'ouvre le live que si une tâche précise pose question.
>
> ⚠️ **Et il ne s'étrangle pas.** `suivre-run.mjs | head -N`, ou un `kill` au bout
> de quelques secondes, ne rendent RIEN — il suit un fichier, la sortie arrive par
> à-coups. Conclure de ce silence que « cet agent n'écrit pas de journal » est un
> faux verdict sur l'outil : le rediriger vers un fichier et lire ce fichier.

**Les deux lecteurs lisent la MÊME matière — ce qui les sépare est le moment et le
volume, jamais la richesse.** Le croire ferait écrire un troisième lecteur pour
rien :

| Question                                                      | L'outil                                        |
| ------------------------------------------------------------- | ---------------------------------------------- |
| « que fait l'agent **en ce moment** ? » — une tâche, du debug | `suivre-run.mjs`                               |
| « combien de tours, combien coûté, quels gestes ont échoué ?» | `analyse-transcript.mjs`                       |
| « quel outil, avec quel argument, dans quel ordre ? »         | `analyse-transcript.mjs --timeline`            |
| « la tâche est-elle verte ? »                                 | **ni l'un ni l'autre** — `task-<n>.gates.json` |

Ce qu'un appel affiche de lui-même (sa commande, son fichier, **le skill qu'il
charge**) est choisi par `argSaillant()` dans `scripts/lib/transcript-dialectes.mjs` —
**une seule fois pour les six grammaires et pour les deux lecteurs**. Une clé qui
manque là manque partout, et se rattrape en un mot ; la rajouter dans un lecteur
seul rendrait l'autre aveugle sans que rien ne le dise.

🔴 **Ce n'est PAS la source du verdict**, et les confondre coûterait la mesure : le
juge lit la sortie capturée, jamais ce journal. On ne conclut donc rien d'ici — on
INSTRUIT. Ce que ça a déjà rendu : éprouver un motif de sonde contre la matière
réelle avant de le figer (au lieu de l'écrire de tête et de payer un run pour
découvrir qu'il rate), trancher un geste au moment où il tombe — « il vient
d'effacer la base » : destruction, ou déplacement avec retour ? —, et voir tôt
qu'un run part de travers avant d'en payer trois.

> 🔴 **Elle vaut aussi pour une session que le banc n'a PAS lancée.** Copilot et
> vibe écrivent leur journal chez l'utilisateur (`~/.copilot/session-state/…`,
> `~/.vibe/logs/session/…`) : un essai réel du framework se dépouille donc en une
> commande, là où il fallait une heure de `jq`. C'est le matériau le plus
> instructif du dispositif, et il était le seul à n'être pas outillé. Les
> grammaires vivent dans
> [`scripts/lib/transcript-dialectes.mjs`](scripts/lib/transcript-dialectes.mjs),
> **source unique** : le banc les consomme au lieu d'en garder une copie.

### Le flux se TAIT — le run avance-t-il encore ?

Le journal d'un agent est écrit par à-coups : une installation, un `docker build`
ou une suite de tests ne produisent pas une ligne tant qu'ils n'ont pas rendu la
main. Un `suivre-run.mjs` figé pendant des minutes est donc l'état NORMAL, et le
lire comme un blocage fait abandonner un run qui travaillait.

**Le seul signal qui tranche est le PROCESS, jamais le disque** :

```bash
ps -Ao pid,etime,%cpu,command | grep -E "bench-discoverability|claude -p" | grep -v grep
```

Un agent qui consomme du CPU travaille ; un agent à `0,0` depuis plusieurs
relevés est un vrai blocage, et c'est alors le décor qu'on ouvre.

> ⚠️ **Ne PAS déduire l'inactivité d'une date de fichier.** `find … -newermt
"-2 minutes"` rend `0` sur macOS quelle que soit l'activité — la grammaire BSD
> ne lit pas les durées relatives de GNU, et elle ne se plaint pas. Un run en
> pleine rafale de requêtes a été déclaré figé sur cette seule sortie. Même
> famille que le reste de ce skill : **la sonde est le premier suspect**, pas ce
> qu'elle prétend mesurer.

### Instruire un run EN VOL — où regarder dans le décor

Le flux dit ce que l'agent TENTE ; le décor dit ce qui en RÉSULTE. Les deux se
lisent pendant que le run tourne, et c'est là qu'on corrige — après, il faut
repayer un run pour revoir la même chose.

| La question                                    | Le fichier, sous `<runDir>/tache-<n>/<app>/`     |
| ---------------------------------------------- | ------------------------------------------------ |
| l'application a-t-elle démarré, et sert-elle ? | `tmp/nodefony-detached.log`                      |
| pourquoi le boot a-t-il échoué ?               | `var/last-boot-console.json`                     |
| le schéma est-il réellement en base ?          | `var/databases/*.db` (`sqlite3 … sqlite_master`) |
| quelles migrations ont été appliquées ?        | table `nodefony_migrations` de cette même base   |

🔴 **Lecture SEULE.** Écrire dans le décor d'un run en vol, c'est mesurer sa
propre intervention — le juge relit cette application pour rendre son verdict.

**Ce que ça a déjà rendu, en une séance** : une boucle
`orm:migrate → repair → migrate → repair` répétée cinq fois était visible dans le
flux bien avant le verdict — le motif « tourne en rond », qui est le second but du
banc, se voit ICI et jamais dans un PASS/FAIL. La base, elle, disait que la
migration avait fini par passer : `nodefony_migrations` portait les identifiants
**1, 2, puis 5**. Les deux tentatives manquantes avaient été effacées par
`orm:migrate:repair`, leur cause avec elles — un outil de réparation qui supprime
le motif de la panne qu'il répare ne laisse rien à instruire à l'exploitant.

**Détail : [`references/methode-de-mesure.md`](references/methode-de-mesure.md)** — trois
résultats mesurés, valables pour les trois bancs : la variance écrase l'écart d'un run à
l'autre (médiane de ≥ 3 runs obligatoire), le modèle par défaut choisi conditionne si le banc
peut seulement VOIR un trou, et un générateur livré abaisse le poids de modèle nécessaire pour
développer avec le framework.

## Pourquoi trois bancs, et pas un

Ils répondent à trois questions qu'on confond facilement, et aucun ne protège
seul :

| Banc                            | Question                                          | Ce qu'il ne voit pas               |
| ------------------------------- | ------------------------------------------------- | ---------------------------------- |
| **`verify-generated.mjs`**      | Le code produit **tient-il debout** ?             | Si l'agent l'a trouvé              |
| **`bench-discoverability.mjs`** | Un agent le **trouve-t-il** ?                     | Si ce qu'il trouve fonctionne      |
| **`bench-schema.mjs`**          | Un **vrai** modèle de données est-il exprimable ? | Ce qu'aucun schéma réel ne demande |

Un scaffold peut générer du code parfait que personne ne lance, un scaffold
parfaitement documenté qui produit du code qui ne compile pas — et une grammaire
que ses propres exemples valident, jusqu'au jour où on lui donne le schéma de
quelqu'un d'autre.

## Ce que les tests du dépôt ne peuvent pas prouver

`create.test.ts` vérifie que les fichiers rendus **contiennent** les bonnes
chaînes. C'est utile et rapide, mais aveugle à tout ce qui ne se voit qu'à
l'exécution. Trois pannes réelles, trouvées par le banc de vérité et invisibles
aux assertions :

- un échantillon de test généré violait le schéma Zod de sa propre entité (une
  valeur d'énumération fabriquée par interpolation — puis, plus tard, un décimal
  et un caractère fixe : le même piège trois fois) ;
- une relation déclarée faisait **lever l'ORM au démarrage**, parce que le test
  généré n'enregistrait que son entité, pas la cible du lien ;
- un type généré ne compilait pas chez le consommateur, l'export utilisé
  n'existant que sous condition ;
- une colonne de référence sortait en texte face à une clé `uuid` : le code
  compile, les tests passent, la ressource répond — et toute jointure SQL écrite
  ensuite est refusée par PostgreSQL.

Aucune de ces quatre n'aurait été vue autrement qu'en compilant et en exécutant.

### Le formateur de l'application refuse ce que le générateur lui donne

Cinquième panne du même genre, et la plus silencieuse : une application
fraîchement générée arrivait avec **sept fichiers** que son propre
`npm run format` réécrivait au premier passage — `AGENTS.md`, `README.md`,
`env.ts`, `nodefony.config.ts`, `package.json`, `.oxlintrc.json`,
`tests/e2e.test.ts`. Rien ne le signalait : le dépôt ne formate pas les `.tpl`
(prettier ignore les extensions qu'il ne connaît pas), et les assertions
lisent des chaînes, pas une mise en forme.

```bash
npm run format:scaffold            # les trois variantes
npm run format:scaffold -- --diff  # ce que prettier changerait, ligne à ligne
npm run format:scaffold -- --keep  # conserve les apps générées pour inspection
```

**Trois variantes, et pourquoi celles-là** (`scripts/check-scaffold-format.mjs`) :
`complete+react` allume tout ce qui est conditionnel, `minimal` n'en allume
rien — une non-conformité qui n'apparaîtrait que dans un cas intermédiaire
supposerait un contenu présent dans NI l'un NI l'autre. La troisième,
`nom-long`, est le seul régime qui exerce **les lignes dont la longueur dépend
d'une valeur interpolée** : `content="<nom> — application Nodefony."` tient sur
une ligne pour `probe` et doit être éclatée pour un nom de vingt caractères.
Sans elle, on livre un rendu conforme aux noms courts seulement.

**Quatre pièges, tous payés au moins une fois :**

| Symptôme                                                | Cause                                                                                                                                                                                                                                                          | Le geste                                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une table markdown revient toujours non conforme        | prettier impose l'alignement canonique, calculé sur la cellule la plus large — donc sur un contenu qui n'existe que dans certaines variantes                                                                                                                   | **une table à lignes conditionnelles devient une LISTE** ; aucun alignement écrit à la main ne peut être juste pour toutes                                |
| Un `prettier --write` sur un `.tpl` markdown            | il lit une balise eta suivie d'une barre verticale comme une CELLULE, et en injecte d'autres                                                                                                                                                                   | ne formater directement QUE les gabarits sans balise (`npm run format:templates`)                                                                         |
| Formater un gabarit À BALISES « pour bien faire »       | prettier formate le texte qu'il voit ; une fois les balises remplacées, les lignes changent de longueur et la forme canonique n'est plus la même — **le rendu peut se DÉGRADER** (vécu : deux fichiers de test acceptés par le gate en sont ressortis refusés) | corriger à la main en lisant le RENDU (`format:scaffold -- --diff`), jamais la source ; `npm run format:templates` ne traite QUE les gabarits sans balise |
| Une correction du moteur reste sans effet               | le CLI s'exécute depuis `dist` ; un gabarit se lit au disque, pas le moteur                                                                                                                                                                                    | **build avant de mesurer** — sinon on conclut sur du code inchangé                                                                                        |
| Deux lignes vides ou zéro autour d'un bloc conditionnel | la newline vit du mauvais côté de la balise                                                                                                                                                                                                                    | placer la ligne vide **DANS** le bloc (`…\n\n<% } %>## Titre`), jamais après                                                                              |

**Ce que le script ne peut pas rendre conforme, et pourquoi ce n'est plus un
problème** : la forme canonique d'une ligne dépend souvent d'un identifiant que
l'utilisateur choisit. `content="<nom> — application Nodefony."` tient sur une
ligne pour `probe` et doit être éclatée pour un nom de vingt caractères ;
`export type ReportingMensuelConfigInput = z.input<…>` fait 87 colonnes, et
tiendrait sous 80 pour un module nommé `blog`. Un gabarit rend UNE forme : aucune
écriture ne peut être juste pour tous les noms. Ce n'est pas un cas particulier —
c'est la règle, puisque presque tout ce qu'un générateur produit porte un nom
dérivé.

**C'est donc le RÉSULTAT qui est mis en forme, avec le prettier du projet.**
`create` formate ce qu'il écrit : dans la transaction quand le projet est déjà
installé (`create module|entity|service|command|controller`, où le dry-run
montre alors le texte exact qui sera écrit), et juste après `npm install` pour
`create app`, dont les dépendances n'existent pas encore au moment où ses
fichiers sont rendus. Le coût qui avait fait écarter cette solution — embarquer
prettier dans le CLI — n'existait pas : l'application générée a DÉJÀ prettier en
dépendance de développement. Prettier absent (`--no-install`, registre
injoignable) : les fichiers sont écrits tels quels et `unformatted` le dit.

> 🔴 **Un rouge PERMANENT cache les vrais défauts.** Tant que ces cas faisaient
> échouer le gate, on lisait son rouge comme « les cas connus » — et `App.tsx` a
> pu accumuler **onze** écarts que personne n'a vus, livrés tels quels. Le gate
> CONSTATE désormais qu'une non-conformité dépend du nom (sa première ligne
> fautive porte le nom de l'application), la nomme, et n'échoue que sur le reste.
> Il garde ce qui lui reste à garder : la forme des GABARITS, et le cas où
> l'installation échoue — c'est alors le rendu brut que l'utilisateur reçoit.

### Deux formateurs, et ce qu'aucun des deux ne regarde

```bash
npm run format:templates            # les gabarits SANS balise, formatés à la SOURCE
npm run format:templates -- --check # sort 1 si l'un d'eux changerait
```

| Gabarits                                     | Qui juge leur forme                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| sans balise eta                              | `format:templates`, sur la source — c'est exact                                  |
| à balises, rendus par `create app`           | `format:scaffold`, sur le RENDU des 3 variantes                                  |
| à balises, appartenant à un AUTRE générateur | **personne** — 29 gabarits : module, controller, entity, front, service, command |

`format:templates` **refuse** délibérément un gabarit à balises : formater sa
source ne rend pas son RENDU conforme et peut le DÉGRADER (deux fichiers de test
acceptés en sont ressortis refusés). Le script nomme lui-même les 29, groupés par
générateur, à chaque exécution : un « 0 à reformater » ne veut pas dire « tout est
propre », mais « propre là où je regarde ». Ces 29 ne sont plus livrés bruts — le
formatage à la génération les couvre — mais leur forme reste celle qu'on LIT dans
le dépôt.

> ⚠️ Deux instruments mentent en silence quand on mesure ça soi-même. Prettier
> lancé sur une copie sous `tmp/` ne traite RIEN — le `.prettierignore` du dépôt
> écarte ce dossier, et la commande sort 0 sans avoir lu le fichier. Et le gate
> formate depuis le dossier de l'app générée (`cwd: dest`) : c'est la seule cible
> dont le verdict vaille.

## Les trois gros bancs — le protocole vit en `references/`

Chaque banc a son décor, ses seuils, ses contrôles internes et ses pièges d'interprétation. On en
lance **un à la fois** : les garder tous dans le corps ferait payer les trois à qui n'en veut qu'un.

| Banc               | La question                                              | Charger AVANT de lancer                                                            |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Vérité**         | le code généré compile, teste et répond en HTTP ?        | [`references/banc-verite.md`](references/banc-verite.md)                           |
| **Découvrabilité** | un agent lâché dans une app fraîche trouve-t-il ?        | [`references/banc-decouvrabilite.md`](references/banc-decouvrabilite.md)           |
| **Conformité**     | l'application tient-elle les promesses du framework ?    | [`references/banc-conformite.md`](references/banc-conformite.md)                   |
| **1ʳᵉ impression** | que conclut un agent en LISANT le dépôt, sans y entrer ? | [`references/banc-premiere-impression.md`](references/banc-premiere-impression.md) |

**Ce qu'il faut savoir sans ouvrir** — de quoi choisir, jamais de quoi lancer :

- 🔴 **Les contrôles internes se lancent AVANT de conclure quoi que ce soit.** Un banc dont la sonde
  est fausse rend un verdict sur l'agent alors qu'il juge son propre instrument — et le faux VERT
  est le pire des deux.
- **Le décor est conservé quand une étape échoue** : le chemin est affiché, et la première chose à
  faire est d'y entrer et de rejouer la commande fautive à la main.
- **Un run de découvrabilité coûte cher** (heures d'agents, dizaines de dollars) : avant d'en
  proposer un, lire la mémoire `project_devkit_bench_night_runs` — le recalage de référence ne se
  propose JAMAIS sur « le dépôt a bougé ».

retire.

## Banc de schéma — un vrai modèle de données est-il exprimable ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --schema calcom
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --dump-only    # la cible, sans agent
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --analyze-only <runDir>
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs       # le juge, AVANT le verdict
```

Un agent reçoit le schéma d'un logiciel libre — umami, cal.com, Ghost — et doit
le reproduire. Les cinq entités du banc de vérité ont été écrites POUR exercer
la grammaire : elles ne peuvent, par construction, rien demander qu'elle ne
sache faire. Un schéma que quelqu'un d'autre a écrit sans nous connaître n'a pas
cette complaisance.

**Trois schémas, pas un plus gros** : ils stressent des axes disjoints. Sur
umami seul on conclurait « la grammaire ne sait pas nommer » sans voir qu'elle
ne sait pas non plus déclarer une énumération PARTAGÉE par dix tables (46 chez
cal.com), ni une cascade de suppression (53 chez Ghost).

**Ce qui juge : la base réellement créée**, jamais les fichiers. Les `.ts`
disent ce que l'agent a écrit ; `information_schema` dit ce qui EXISTE.

**Sur PostgreSQL, et c'est structurel** — SQLite ne distingue pas
`varchar(255)` de `char(2)` de `text` : un juge posé dessus serait aveugle
exactement là où les schémas réels sont exigeants (onze longueurs distinctes
chez umami, `maxlength` sur chaque colonne chez Ghost). Même leçon que la sonde
FK ↔ PK du banc de vérité.

**La mesure qui compte n'est pas la justesse du schéma** mais le nombre
d'éditions faites à la MAIN : un agent finit toujours par obtenir le bon schéma
s'il écrit assez de Drizzle — et il aura alors prouvé que le générateur ne
servait à rien.

Détail : [`references/banc-schema-etudes-de-cas.md`](references/banc-schema-etudes-de-cas.md) —
pourquoi le décor doit sortir du dépôt (isolation constatée, pas supposée), et pourquoi le juge
PostgreSQL doit lui-même s'éprouver avant de rendre un verdict.

## Interpréter un échec — commencer par le décor

Trois causes ont déjà envoyé chercher très loin du vrai problème. Les écarter
avant de suspecter le code généré :

- **Tout répond 404, y compris les routes du gabarit.** Un autre serveur
  Nodefony occupe les ports. `--detach --wait` sonde les ports, l'autre serveur
  répond, la readiness est déclarée — et les tests interrogent une application
  qui n'est pas celle qu'on éprouve. Le banc de vérité s'en protège par des
  ports dédiés ; en manuel, `nodefony status` puis `nodefony stop`.
- **Une route existe dans les sources mais répond 404.** Le `dist/` est périmé.
  Le runtime charge le build, pas le source.
- **Le typecheck échoue sur `drizzle-orm` introuvable.** Artefact du mode
  `--link` : npm symlinke les paquets du framework sans hisser leurs
  dépendances. Sans rapport avec le code généré.
- **Le typecheck tombe sur un `TS2322` qui accuse `undefined` sans que rien ne
  soit `undefined`** — typiquement `parseModuleConfig<T>` qui cesse d'inférer
  `T`. Même famille, en pire : la dépendance existe **en deux exemplaires**, un
  par côté du lien, et TypeScript refuse de les unifier. `--link` épingle
  désormais les pairs sur l'exemplaire du dépôt et le CONSTATE avant de
  compiler ; si la sonde parle de « DÉCOR », l'échec ne dit rien du code généré.
  Deux façons de l'écrire, et npm n'en accepte qu'une par cas : une pair que
  l'application déclare se contraint sur SA plage (un `overrides` y serait
  refusé, `EOVERRIDE`), les autres passent par `overrides`. Les paquets du
  dépôt, eux, ne s'épinglent jamais — ils sont atteints en `file:`, et c'est
  précisément ce que `--link` sert à éprouver.
- **`drizzle-kit` réclame « install either 'better-sqlite3' or '@libsql/client' »**
  et l'étape des migrations tombe en `NF_MIGRATE_UNAVAILABLE`. **Même cause que
  ci-dessus**, et elle mérite sa ligne parce que le message accuse la BASE : le
  pilote SQLite est une dépendance de `@nodefony/drizzle`, que `--link` symlinke
  sans la hisser — `node_modules/better-sqlite3` n'existe tout simplement pas
  dans l'application témoin. Tout ce qui suit cette étape n'est donc **jamais
  atteint** en boucle courte. Le constater d'un `ls` avant de suspecter quoi que
  ce soit, et rejouer en décor ISOLÉ (sans `--link`) pour obtenir le verdict.

Et un piège qui, lui, n'est pas du décor : **une entité nommée `User` entre en
collision avec celle du module de sécurité** — l'application ne démarre plus, sur
un message qui parle de colonne inconnue. Nommer autrement dans un banc.

## Quand les lancer

| Tu viens de toucher…                                             | Lance                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| gabarits, `entityFields.ts`, `engine.ts`                         | vérité (`--no-e2e` en boucle courte, complet avant de conclure) |
| `ResourceController`, contrat de ressource, DDL de développement | vérité, complet                                                 |
| `AGENTS.md` généré, docs embarquées, nommage des générateurs     | découvrabilité                                                  |
| une capacité NEUVE offerte aux agents (générateur, commande)     | découvrabilité — **après y avoir ajouté sa tâche**              |
| le SQL généré, une migration, un type de colonne                 | vérité, `--database postgres` PUIS `--database mysql`           |
| une vague `devkit S<n>` que tu veux déclarer finie               | les deux                                                        |

## Quand passer la main

| Besoin                                                          | Skill                    |
| --------------------------------------------------------------- | ------------------------ |
| Éprouver ce qu'un **installeur** reçoit (npm, conteneur vierge) | `nodefony-release`       |
| Charge, débit, latence                                          | `nodefony-load-test`     |
| Coder dans le cœur backend                                      | `nodefony-framework-dev` |
| Créer ou éditer un skill                                        | `nodefony-skill`         |

## Références

- `references/banc-verite.md` — le banc de vérité : décor, étapes, seuils, et la lecture d'un échec
- `references/banc-decouvrabilite.md` — le banc de découvrabilité : lot, juges, contrôles internes, remise à zéro du décor
- `references/banc-conformite.md` — le banc de conformité : promesses éprouvées, identité partagée, gardes des juges
- `references/methode-de-mesure.md` — variance d'un run unique, modèle par défaut, générateur qui abaisse le modèle nécessaire
- `references/banc-decouvrabilite-lecons.md` — dix leçons du banc de découvrabilité, chacune payée par un défaut réel
- `references/banc-schema-etudes-de-cas.md` — pourquoi le décor et le juge PostgreSQL du banc de schéma s'éprouvent avant de juger
- `references/tache-zero.md` — la tâche 0 : registre public contre décor isolé, porte machine du CLI, les quatre issues, la référence concurrente
- `references/agents-et-porte-mcp.md` — le décor d'un run : régimes de porte MCP, drapeaux par agent, foyer jetable, et les pièges qui font mesurer autre chose que ce qu'on croit
