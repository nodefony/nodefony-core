# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées** (vues 1-2×). Le skill `nodefony-session` le **lit au
> START/RESUME** et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.** À **3×** → CONSOLIDATE la promeut et la **retire d'ici**.
>
> **Taille bornée : ~1 écran.** Deux sorties, gérées par CONSOLIDATE : (a) ≥3× → graduée puis
> retirée ; (b) thème dont le chantier est clos → archive. Format : `[N× — date courte]`.
>
> Snapshots complets avant coupe : `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## 🎲 Ce qui varie d'un run à l'autre EST la mesure — pas le verdict

- `[1× — 2026-07-30]` 🔴 **Un banc à verdict binaire joué UNE fois ne dit rien.** T14 rejouée 4×,
  gabarit identique, même modèle, même décor : **2 PASS / 2 FAIL**, 68→98 tours. J'avais écrit le
  matin « la correction est prouvée » sur un seul PASS. Ce qui reste concluant sur un run unique,
  c'est une **sonde de contenu** (binaire, sans seuil) : façade employée 4/4 après vs 0/1 avant.
  Toute mesure d'effort = médiane ≥ 3 runs. Corollaire de coût : répondre à « un gros modèle
  tourne-t-il moins en rond ? » demande ~6 runs, pas 2 — l'estimation initiale était 3× trop basse.
- `[1× — 2026-07-30]` **Un chiffre qu'il faut aller chercher au `jq` n'agit pas.** Le harnais
  publiait déjà tours/durée/coût en fin de transcript ; personne ne les lisait. Même leçon que pour
  les agents, appliquée à moi : l'information doit être là où le regard passe déjà.

## 🧪 Suspecter son INSTRUMENT avant le sujet mesuré

- `[1× — 2026-07-30]` **Comparer une heure UTC à une heure locale fait conclure à un run bloqué
  depuis deux heures.** Les décors du banc s'horodatent en UTC ; `ELAPSED` de `ps` disait 9 minutes.
  Avant d'annoncer un blocage : lire un compteur, pas une soustraction de fuseaux.
- `[2× — 2026-07-30b]` 🔴 **Un juge qui PRÉSUME un trajet recale une réponse juste.** Le juge de
  T16 frappait la route de LECTURE pour récolter le jeton CSRF ; le mécanisme est « une requête
  sûre vers une route **protégée** sème le cookie », et l'agent avait exposé une route dédiée —
  réponse juste, recalée. Remède général : **un juge DEMANDE à l'application** (`inspect routes
--json`) au lieu de supposer un chemin. Et la correction ne vaut que prouvée sur le **décor
  CONSERVÉ du run recalé** — un serveur jouet montre que le juge sait faire, pas qu'il a cessé de
  se tromper sur CE code.
- `[1× — 2026-07-30b]` **`spawnSync` BLOQUE la boucle du parent** : un banc d'épreuve qui lance un
  juge pendant qu'il sert lui-même les requêtes rend « aucune réponse » sur TOUTES les causes —
  rouge uniforme qui accuse le juge, alors que l'instrument est seul en cause.

## 📏 Une règle de contrôle se juge sur le CODE EXISTANT, avant d'y croire

- `[1× — 2026-07-30b]` 🔴 **Une garde « nom réservé » écrite puis retirée : 37 signalements, tous
  sur du code qui COMPILE.** Croyance : redéfinir `get`/`log` d'une classe de base casse.
  Réalité TypeScript : c'est légal tant que la **signature reste assignable** — le framework
  lui-même fait `override log(`. Le vrai défaut (TS2416) exige de résoudre l'héritage, les types
  et l'assignabilité : le travail d'un vérificateur de types, hors de portée d'une lecture PURE
  par regex, et **déjà fait par la compilation**. Ce qui manquait n'était pas un détecteur mais
  un TRADUCTEUR (l'erreur s'affiche sur la méthode, la classe casse sur `@services([X])`).
  Réflexe : avant de croire une règle neuve, la **lancer sur le dépôt entier** — 100 % de faux
  positifs ne s'affine pas, ça s'abandonne.

## 🤖 Piloter un agent TIERS : ce qui BLOQUE, et ce qui MENT

- `[1× — 2026-07-29]` 🔴 **Sans TTY, un CLI agentique peut LIRE stdin jusqu'à EOF.** `vibe`
  (`cli/cli.py:53`) : `if sys.stdin.isatty(): return None` — sinon `read()`, pour accepter un
  prompt en pipe. Lancé par un agent ou un CI, stdin n'est pas un TTY **et reste ouvert** → il ne
  rend jamais la main. Vécu : **9 min 33 d'horloge pour 1,07 s de CPU**, aucune session créée — le
  symptôme se lit comme « le modèle réfléchit ». Remède : `< /dev/null` sur toute automatisation.
- `[1× — 2026-07-29]` **Une sonde de banc encode un HARNAIS, pas un comportement.** `vibe` charge
  `AGENTS.md` **nativement** (walk-up « le plus proche gagne ») : aucun appel d'outil ne montre la
  lecture, donc la sonde « a lu AGENTS.md », écrite pour Claude Code, rend un **FAUX rouge**.
  Généraliser un banc à un autre agent, c'est revoir les SONDES — pas seulement le lecteur de
  transcript.

## 🟢 Un test NON EXÉCUTÉ doit être ROUGE, jamais vert

- `[1× — 2026-07-27]` 🔴🔴 **Le vert par défaut est un SILENCE, pas une preuve.** Trois formes du
  même défaut, toutes rencontrées le même jour : `npm test` sur drizzle sort **exit 0 avec 517
  tests sautés sur 901** (les deux dialectes de PRODUCTION) ; deux cas anti-bruteforce passés en
  `skipIf` comptent **verts** ; une vingtaine de preuves e2e ne sont **jamais lancées**, donc
  jamais rouges. **Position du user, à graver : s'ils ne sont pas lancés, c'est ROUGE.**
  ✅ **Fermé depuis** : `gateReporter` (`vitest.gates.ts:540`) est BLOQUANT quand `CI` est posé
  (`process.exitCode = 1`), branché dans 6 configs, avec `NF_GATES_ALLOW` pour énoncer une absence
  voulue au lieu de l'oublier. Ce qui reste vrai, c'est la règle : un skip compte comme vert, donc
  toute cible déclarée doit être exercée ou l'absence nommée.
- `[1× — 2026-07-27]` **`--reporter=json` REMPLACE la sortie lisible** → un gate tombe sans dire
  quel cas ni de combien. Reproduit **trois fois dans la même session** (banc mémoire, stores,
  realtime) après l'avoir corrigé le matin même sur `turbo --continue`. Toujours
  `--reporter=default --reporter=json`.

## 📦 Ce qui est COPIÉ à la création ne se met jamais à jour

- `[1× — 2026-07-28c]` 🔴 **Corriger la DOC sans corriger les GABARITS laisse le mensonge exactement là où il fait mal.** La veille : le hook d'un service s'appelle `init`, pas `initialize` — 4 docs IA + la page de référence corrigées. Les **deux gabarits** avaient été oubliés, et ce sont EUX qui atterrissent dans le code des utilisateurs : ils rendaient `async initialize()` sous le commentaire « appelé une fois par le conteneur, au démarrage ». Le kernel ne cherche que `init` → méthode morte, abonnements kernel qui dorment, **rien ne le signale**. Règle : quand une correction porte sur un FAIT du framework, la liste des cibles inclut les gabarits — et le gabarit prime, puisqu'il se recopie dans chaque app créée.
- `[1× — 2026-07-24]` ⭐ **Mon étagement release contredisait ma propre gate — le user l'a attrapé.** J'avais mis « entity bout-en-bout » APRÈS la release alors que le banc des 3 tâches (gate de 10.0.0) mord précisément sur ces trous. Deux leçons : (a) **vérifier qu'une gate définie ne mord pas sur ce qu'on reporte** ; (b) le critère de placement release pour tout artefact scaffold est l'**asymétrie de support** — le code généré est FIGÉ dans l'app à sa création (un fix 10.1 ne répare AUCUNE app née en 10.0.0), un module npm (Studio) se met à jour. Trancher par le support, pas par l'envie de sortir vite.

## 🧷 Un run vert ne typecheck rien — et tous les typechecks ne se valent pas

- `[2× — 2026-07-24]` **Des erreurs de type dans mes propres tests, invisibles en vert.** Vitest efface les types à la transpilation. 1ʳᵉ fois : un import pointait un type non exporté (TS2459), une conversion sautait `unknown` (TS2352) — c'est le **pre-push** qui a mordu. 2ᵉ fois : élargir le retour de `send` en `boolean | void` a cassé **6 stubs** `send: (f) => sent.push(f)` (une flèche concise renvoie le `number` de `push`) — suites 100 % vertes, `npm run typecheck` racine rouge. Pire piège : `npx tsc --noEmit` lancé DANS le module est vert, il ne couvre pas les mêmes fichiers. **Avant un push : `npm run typecheck` à la racine, pas le tsc du module.** Et **élargir un type de retour de callback casse les stubs concis**, jamais les tests.

## 🔇 Un mode machine qui coupe le journal coupe aussi les erreurs

- `[1× — 2026-07-26]` ⭐ **`--json` rendait une commande MUETTE sur échec** : `inspect <sujet> --json` sortait 0 octet, stderr vide, code 1, quand la base configurée était injoignable — l'appelant en concluait que l'app n'avait ni routes ni services (un agent a préféré inventer un chiffre plutôt que constater la panne). `initSyslog` retournait sans brancher AUCUN transport dès que `--json` était passé, alors que son propre commentaire promettait que « les erreurs partent sur la sortie d'erreur ». **Un commentaire n'est pas une garantie** : celui-ci décrivait un comportement que le code ne faisait pas, et le test qui gardait l'endroit affirmait « aucun listener ajouté » — il VERROUILLAIT le défaut, d'où son vert. Règle : `stdout` appartient aux données, `stderr` aux erreurs ; couper l'un ne doit jamais couper l'autre. (Cause racine du silence de boot : non trouvée → BUG-1.)

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib de rapports, faute d'avoir ouvert le source.** `tabs()` attend `body`, j'ai passé `html` → les trois onglets sont sortis **vides**, sans une erreur : 35 Ko de page, zéro tableau, et le script « réussissait ». Puis `table()` s'est révélé **ne PAS échapper** ses cellules (elle accepte du HTML) alors que mes libellés contenaient des `<module>`/`<sujet>`. Le tell commun : un livrable qui se génère sans broncher mais dont le CONTENU manque. **Compter ce qu'on vient de produire** (`grep -c "<table"`) vaut mieux que faire confiance à un code de sortie — et la signature se lit dans la lib, elle ne se devine pas depuis un tableau de doc.

## 🗣️ Quand le user REPOSE la question, c'est ma réponse qui est fausse

- `[1× — 2026-07-27i]` ⭐⭐ **Trois fois la même question — « comment tu fais pour que le code s'améliore ? », « tu ajoutes quoi à chaque run ? », « il appelle pas create entity, comment tu fais ? »** — et trois fois j'ai répondu par la MÉTHODE (le protocole, l'isolation des variables, la boucle) alors qu'il demandait le **GESTE** : _qu'est-ce que tu écris, concrètement, entre deux runs ?_ La réponse qui a pris tenait en un tableau à deux colonnes — « ce que le banc a mesuré » → « ce que J'AJOUTE dans le framework » — avec la ligne de commande qui n'existe pas encore (`create entity --table account`). **Une question reformulée n'est pas une incompréhension du user : c'est le signal que je réponds à côté.** Réflexe : à la 2ᵉ occurrence, changer de REGISTRE (du pourquoi au quoi, de la prose au tableau, de l'abstrait à la commande exacte) au lieu de re-détailler la même chose.

## 📦 Surface npm & publication (chantier release en cours)

- `[2× — 2026-07-24]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.** Six paquets publiaient `exports["."].types → ./index.ts`, absent du tarball (`files:`) : invisible dans le repo self-hosted, cassé pour tout installeur npm. Vérifier une surface publiée = **dépaqueter le tarball** (`npm pack` + lire le manifeste), jamais lire le `package.json` du dépôt. Revécu via `--link` : le `node_modules` symlinké montre les SOURCES complètes (CLAUDE.md, `.ts`) — conclure de là ce qu'un installeur verra est faux ; raisonner sur `files:`.
- `[1× — 2026-07-23]` **`publishConfig.exports` n'est PAS appliqué par npm** (c'est pnpm/yarn). Testé avant de le proposer.
- `[1× — 2026-07-23]` **Un import non déclaré ne casse rien ICI et deux choses AILLEURS** : turbo ne peut pas ordonner le build, et le consommateur npm n'installe pas la dépendance. Auditer les imports de **valeur** (pas seulement de types) contre les `dependencies`.
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE — la vérifier avant de le retirer.** `exports.types → ./index.ts` avait l'air d'une paresse ; c'était l'anti-race du CLAUDE.md. 4 `clean && build` complets pour le prouver (le `dist` d'avant masque exactement cette panne).
- `[1× — 2026-07-27]` **Un scan de secrets saute les fichiers « binaires » sans un mot** (`rg` sans `-a`), et les fichiers publics doivent être vérifiés sur la **branche par défaut**, pas seulement sur celle où l'on travaille.

## 🗄️ Concurrence & atomicité (ce que le dialecte ne dit pas) — utile pour l'ORM S5

- `[1× — 2026-07-17]` **Un pool FROID masque les races** : le 1ᵉʳ écrivain (seule connexion chaude) finit avant que les autres aient leur TCP+auth → vert 3/3 sans le fix, structurellement. Chauffer (`Promise.all` de `count()`) avant de mesurer.
- `[1× — 2026-07-17]` **`ON CONFLICT (x)` n'arbitre QU'UN index** ; **MySQL n'a ni `RETURNING` ni `WHERE` sur ODKU** (tout upsert conditionnel y coûte 2-3 requêtes, donc une course) ; **un upsert reste un INSERT qui bascule** (colonnes `NOT NULL` obligatoires même quand la ligne existe).
- `[1× — 2026-07-17]` **La concurrence est un angle mort structurel des bancs** (séquentiels) : `Promise.allSettled` + tenir le travail ouvert, sinon les tâches se sérialisent et le bug ne sort jamais.
- `[1× — 2026-07-17]` **Les valeurs JOUETS ne prouvent rien sur le type d'une colonne** : `1000` passe partout ; `1_775_000_000_123` prouve le bigint, `INT32_MAX` trouve la borne.

## 🧨 Une commande composée refusée n'exécute RIEN — et le run suivant ment

- `[2× — 2026-07-25]` **Un maillon en échec dans une chaîne `&&` fait mentir la mesure d'après.** (1) Un `cd` relatif refusé a emporté le `cat >>` suivant : tests jamais écrits, « 12 passed » = le compte d'AVANT. (2) Ma contre-preuve dedupe : le `npm run build` du module échouait (tsgo refusait la valeur hors union) DANS la chaîne — le banc d'après mesurait l'ANCIEN dist et « prouvait » que le fix ne changeait rien. **Après tout échec dans une commande composée, considérer que RIEN d'aval n'a tourné** ; vérifier que l'artefact mesuré a bien été RÉGÉNÉRÉ (hash/mtime), pas seulement relancer la mesure.

---

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Texte intégral : **`archive/RETEX-snapshot-2026-07-30.md`** (805 lignes). Rien n'est perdu ; ce qui
suit dit seulement où la leçon vit désormais.

**Gradué en mémoire durable** — 9 frictions ≥ 3× promues, puis retirées d'ici :

| Leçon                                                         | Vit désormais dans                       |
| ------------------------------------------------------------- | ---------------------------------------- |
| exemple de CODE > prose > TSDoc ; tête de fichier = rare      | `feedback_agent_example_over_prose`      |
| la sonde du banc est le premier suspect ; faux vert = pire    | `feedback_bench_probe_false_verdicts`    |
| un fichier gitignoré ne tient que chez soi                    | `feedback_gitignored_breaks_clone`       |
| instruments faux · câblage débranché · contrôle non déclenché | `feedback_gate_must_bite` (3 volets)     |
| preuve négative sur une règle NORMATIVE                       | `feedback_gate_must_bite` (How to apply) |
| une capacité se CONSTATE, jamais depuis `process.platform`    | `feedback_cross_platform_axioms`         |

**Chantiers clos, leçon intégrée au code / aux skills** : CI assainie (lint câblé et verrouillé,
analyse de code réparée, audit de dépendances, `skills:check`) · lint 263 → 0 et régime des gates par
nature de règle · décor de test et bancs (isolation partagée, décor enregistré au rapport, modèle
défavorable) · portabilité et épreuve d'une plateforme absente → kit Windows · gotchas front et
Studio → skills front · nomenclature du plan et placement release · doctrine « où vit un outil » →
`nodefony-skill` · ReDoS, `skipIf`, GC forcé, plafonds partagés, cache d'un échec, fermeture au point
de passage, `npm pkg delete`, générateur vs formateur.

**Déjà couvert par une mémoire existante** : deux implémentations d'une règle →
`feedback_single_source_rule` · vérifier une affirmation de sous-agent avant de la répercuter → règle
du `CLAUDE.md` racine (§ délégation) · outil muet ≠ absence → `feedback_shell_false_diagnostics`.

**Patterns ÉPARPILLÉS, trouvés et gradués au CONSOLIDATE.** Chacun revenait 5 à 7 fois sous des noms
différents — donc jamais compté 3× au même endroit, donc jamais promu jusqu'ici :

| Pattern (nb de thèmes où il se cachait)                                  | Placé dans                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| la troncature ne s'annonce jamais (6)                                    | `feedback_shell_false_diagnostics` **+ CLAUDE.md**    |
| on conclut sur ce qu'on écrit, pas sur ce que le consommateur REÇOIT (7) | `feedback_prove_on_received_artifact` **+ CLAUDE.md** |
| l'information n'agit que là où le regard passe déjà (6)                  | `feedback_agent_example_over_prose` (volet final)     |
| un geste destructeur exige identité prouvée + périmètre borné (5)        | `feedback_destructive_needs_identity_scope`           |

Les deux premiers partagent une seule entrée du `CLAUDE.md` (§ PENDANT) : ce sont les seuls à devoir
être relus à CHAQUE tour, puisqu'ils invalident des conclusions en cours de route.
