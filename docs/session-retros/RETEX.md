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

## 🤖 Déléguer : le geste, pas seulement le verdict

- `[1× — 2026-07-26]` 🔴 **Un agent délégué a « nettoyé » l'arbre pour mesurer une baseline et a
  emporté une heure de code non commité.** La perte se voit PLUS TARD (un test échoue sur une
  fonction devenue introuvable). Gravé en règle dans `CLAUDE.md` + `AGENTS.md` : interdire l'index
  git EN TOUTES LETTRES dans chaque prompt de délégation, et **committer AVANT de déléguer**.
- `[1× — 2026-07-26]` 🔴 **Un verdict vérifiable ne rend pas le GESTE mécanique.** « Retirer les
  imports inutilisés » a un verdict binaire par occurrence — le modèle léger a coupé des listes
  d'imports en plein milieu, fichiers non compilables. Éditer du code est STRUCTUREL sur un arbre
  que le modèle ne parse pas. Déléguer le DIAGNOSTIC, garder l'ÉDITION — sauf si un automate la
  porte (`--fix`, codemod) avec compilation + tests derrière.
- `[1× — 2026-07-26]` Le **TYPE** d'agent (lecture seule vs complet) est le second levier de coût,
  choisi AVANT le modèle. Un agent en lecture seule ne peut pas casser le dépôt.
- `[1× — 2026-07-26]` 🔴🔴 **UN SOUS-AGENT ZOMBIE REND LA SESSION INATTEIGNABLE — et fait perdre du
  travail au USER.** Dix réveils d'un agent `completed` ont occupé le fil ; j'y répondais « rien de
  neuf, j'attends ta décision ». Vu du user : **session inerte, en lecture seule** (renforcé par les
  messages de l'agent, « je suis bloqué en lecture seule », qui parlaient de LUI). Ne pouvant plus
  reprendre la main, **il a ouvert une SECONDE session Claude Code**, qui a **tué son résumé de
  terminal**. Le grave n'est pas le coût : c'est la PERTE DE CONTRÔLE, et une parade (2ᵉ instance sur
  le même arbre) destructrice par nature. Remèdes : (1) **au 2ᵉ réveil sans apport, ARRÊTER l'agent**,
  jamais « ignorer » — chaque réponse polie est un tour où le user ne passe pas ; (2) si le fil est
  pollué, le **DIRE et AGIR** (« un agent zombie réveille le fil, je le tue »), jamais conclure
  « j'attends ta décision », qui se lit comme une session morte ; (3) **`TaskStop` ÉCHOUE** sur un
  agent `completed` qui consomme encore des outils (39→43) → seul un `SendMessage` d'ordre l'arrête ;
  (4) terminer TOUT prompt de délégation par « rends le rapport puis **TERMINE** — aucune question,
  aucune proposition, aucune action » (le mien finissait sur un format de rendu).
- `[1× — 2026-07-26]` 🔴 **Déléguer l'EXTRACTION, jamais la QUALIFICATION.** Le déclencheur « verdict
  binaire + preuve » m'a fait confier un tri « vrai défaut / faux positif / dette » — qui est un
  **jugement**, pas un verdict. Résultat : 3 verdicts faux sur 12 familles, dont **deux qui
  proposaient un bug** (retirer un spread qui protège d'une Map purgée pendant son parcours ;
  « corriger » une fusion interface+classe qui réconcilie deux builds), et un troisième qui classait
  « scripts de test » deux fichiers de PRODUCTION. Bon découpage : le sous-agent rend le CODE et son
  contexte factuel (`fichier:ligne`, la ligne, ce que la fonction appelle) ; le principal qualifie.

## ✂️ La preuve qu'on tronque est PERDUE — un pipe est destructif

- `[1× — 2026-07-26]` 🔴 **`npm run test:all | tail -80` a mangé le nom du SEUL test échoué**
  (1 sur 7094). Le rapport final tient dans les dernières lignes, le NOM du test non → flake
  impossible à caractériser, run relancé pour rien, et il est repassé vert : l'information est
  définitivement perdue. Un run dont on veut le DIAGNOSTIC se redirige **intégralement dans un
  fichier**, on filtre le fichier ensuite. Ne tronquer que ce dont on ne veut qu'un état.

## 🔧 Un correcteur automatique peut proposer un BUG

- `[1× — 2026-07-26]` 🔴 **`oxlint --fix-suggestions` réécrit `.map(x => ({...x, n}))` en
  `Object.assign(x, …)`** — qui **mute l'objet source** au lieu d'en produire une copie — et supprime
  des constructeurs. Son nom le dit (« may change program behavior ») ; on ne le lit qu'après. Un
  automate d'édition se **cadre sur la seule règle voulue**.
- `[1× — 2026-07-26]` 🔴 **`-D <règle>` en ligne de commande ÉCRASE les options de cette règle**
  définies dans le fichier de config (retour aux défauts) : `-A all -D no-unused-vars` a réactivé
  `caughtErrors:"all"` que le dépôt met à `"none"`, et touché **37 fichiers hors périmètre**. Cadrer
  un automate = une **config jetable** qui n'active que la règle, avec SES options — jamais un flag
  qui la redéfinit. Corollaire : l'arbre doit être PROPRE avant de lancer un `--fix`, le diff est le
  seul garde-fou.

## 🔍 Un contrôle que personne ne lance n'existe pas

- `[3× — 2026-07-26f]` **La CI ne lançait pas le lint** — 146 erreurs accumulées sans qu'aucune
  demande de fusion en dise un mot. Le contrôle existait en local, donc « on l'avait ». Corollaire
  vérifié sur CodeQL : deux alertes marquées « corrigées » l'étaient par un **renommage de
  dossier**, pas par un correctif — les mêmes défauts rouverts au nouveau chemin.
  **2ᵉ occurrence** : CodeQL n'avait JAMAIS tourné sur la branche de travail — il n'écoutait que
  `main`, et son filtre valait `paths: - "src"`, motif qui ne correspond à aucun fichier là où
  GitHub attend `src/**`. Les 7 alertes affichées étaient des fossiles de 2024 (`ref` = `main`,
  date de mise à jour = date de création) désignant des lignes devenues des commentaires. La liste
  d'exclusions ajoutée la veille n'avait jamais eu l'occasion de servir.
  **3ᵉ occurrence** : `npm audit` (neutralisé par le `--no-audit` de l'installation) et
  `skills:check` (en local depuis des semaines) n'étaient déclenchés nulle part. Un contrôle
  n'existe que dans le fichier de workflow — et **un gate à zéro se verrouille** (`--deny-warnings`),
  sinon la marche reste verte pendant que le compteur remonte.
- `[1× — 2026-07-26f]` 🔴 **`needs:` sur un job À MATRICE masque tout ce qui suit.** Le job dépendant
  attend les 6 variantes et échoue si UNE tombe → les tests passent en `skipped`, état qui s'affiche
  « non exécuté » et se lit « rien à signaler ». Deux mois d'aveuglement : une variante Windows
  rouge cachait l'état réel des tests unitaires ET d'intégration. Les jobs réinstallant et
  reconstruisant de toute façon, les **découpler** ne coûte rien et fait dire à chacun SA vérité.
  Corollaire de nommage : le job s'appelait « Build », ce qui laissait croire à une étape amont dont
  les autres attendaient la sortie — renommé « Vérifications », puisqu'il ne produit rien pour eux.
- `[1× — 2026-07-26]` **Une entrée de config qui NOMME un chemin se vérifie à l'écriture.** J'avais
  recopié `src/nodefony/src/service/babel/**` dans les exclusions du linter — le dossier n'existe
  plus depuis longtemps, et une exclusion morte n'échoue jamais, elle protège juste le vide. Le user
  l'a vu avant moi, et le fil a mené à trois autres vestiges (dont un dossier de l'ancien bundler et
  une exclusion de compilation). Écrire un glob = le confronter d'un `ls`, comme une ancre.
- `[1× — 2026-07-26]` **Une sonde doit porter sur un terrain qui DISTINGUE ce qu'elle mesure.** La
  cohérence FK↔PK écrite sur les entités SQLite du banc restait verte avec un générateur cassé
  exprès : en SQLite, `uuid` et `text` sont le MÊME type. Portée sur PostgreSQL, elle mord.
- `[1× — 2026-07-26d]` **Un gate rendu bloquant se paie tout de suite — et c'est le signe qu'il
  sert.** Une heure après avoir retiré `continue-on-error` du lint, une suppression de code mort a
  laissé 7 déclarations orphelines par ricochet (imports, une table de libellés, puis un type devenu
  inutile APRÈS elle). Le lint les a toutes nommées, en deux passes. Sans le gate, elles partaient
  dans le commit. Corollaire de méthode : les retirer À LA MAIN, jamais par `--fix`.

## 📂 Un fichier ABSENT du dépôt fait tenir ce qui tourne en local

- `[3× — 2026-07-26f]` 🔴 **Le même motif a mordu TROIS fois dans une seule session.** (1) Un
  `index.ts` versionné importait en dur une fixture de 410 tables que le MÊME commit avait mise au
  `.gitignore` (licence incompatible) : build cassé depuis deux mois pour quiconque clone, invisible
  ici où le dossier existe. (2) Les clés de production vivent dans `.env.local` (`*.local` ignoré) —
  sans elles, deux `CRITIC` légitimes, et la sonde de démarrage déclarait mort un serveur qui
  écoutait ses quatre ports. (3) L'analyse de code restait sur une autre branche, donc n'avait
  jamais lu le code écrit. **« Ça marche chez moi » est presque toujours cette phrase-là.**
  Règles qui en sortent : un dossier ignoré ne doit être importé par **aucun** fichier versionné, ni
  scanné par un artefact **commité** (un `symbols.json` qui décrit des fichiers absents des clones
  diverge d'une machine à l'autre) ; et le `.gitignore` est le bon endroit où écrire l'interdit,
  puisque c'est là qu'on le lira avant d'ignorer le prochain dossier.
- `[1× — 2026-07-26f]` **Preuve par contraste, à faire systématiquement** : écarter le fichier du
  disque et rejouer la commande (`mv` aller-retour dans une SEULE commande), ou constater que la
  variable est présente en local et absente du clone. Deux secondes, et le diagnostic devient un
  fait au lieu d'une hypothèse.

## 🧹 Remplacer sans retirer laisse du code fantôme — et un appel réseau qui tourne

- `[1× — 2026-07-26d]` ⭐ **Une brique générique a remplacé 4 badges écrits par page ; 3 sont restés
  en place, complets et inatteignables.** Pire : le point d'accès `/status` qui les alimentait
  continuait d'être appelé à chaque affichage de deux consoles, réponse jetée. Le geste manquant
  n'est pas le remplacement, c'est le RETRAIT des instances dans la même session. Symptôme à
  reconnaître : un composant riche (tooltip, couleurs, sémantique) qu'aucun fichier n'importe.
- `[1× — 2026-07-26d]` **Un renvoi de commentaire survit au refactor qui a supprimé sa cible.**
  `webhooksFormat` disait « calque du `StorageBadge` API Keys » — supprimé dans le même geste. Un
  renvoi par NOM se recontrôle quand on retire ce qu'il nomme ; mieux, le remplacer par la RAISON
  (ici : « il vit dans une colonne, pas dans un en-tête, la puce générique n'y irait pas »), qui,
  elle, ne pointe vers rien qui puisse disparaître.

## 🖥️ Sans navigateur, l'attendu EXACT vaut mieux qu'une description

- `[1× — 2026-07-26d]` **Annoncer la valeur précise que l'écran doit afficher transforme une
  vérification visuelle en contrôle binaire.** Plutôt que décrire un badge, j'ai lu les défauts de
  config (`idleTimeoutS: 1800`) et annoncé « tu dois lire _Révocation durcie · 30 min_ », plus les
  deux conditions sans lesquelles rien ne s'affiche (rôle admin, rechargement forcé). Le user a
  répondu par une capture : conforme, en un aller-retour. La règle projet interdit le navigateur
  headless — c'est donc l'attendu chiffré qui remplace l'œil, pas la prose.

## 🔢 La nomenclature d'un plan appartient à son lecteur

- `[1× — 2026-07-24]` ⭐ **Trois échelles empilées (lots `devkit N`, vagues `V1-V5`, décisions `T1-T10`) ont PERDU le user** (« je ne veux pas 15 sous-lettres »). Règle : **UNE seule échelle d'identifiants publics** (ici `devkit S<n>`, alignée sur la famille de lots existante) ; les décisions/justifications se NOMMENT (« Refuser avant d'écrire »), ne se numérotent JAMAIS — un numéro n'est dû que s'il sera cité dans un commit ou une demande de session. Corollaire : un identifiant court réutilisé entre kits (S5 du kit ORM vs `devkit S5`) exige le préfixe.
- `[1× — 2026-07-24]` **Une directive floue arbitrée sans reformuler l'INTENTION coûte 2 allers-retours.** « Entity beaucoup mieux » : j'ai renforcé le REST généré ; le user visait le formulaire STUDIO contextuel (types selon le dialecte). Reformuler l'objet CONCRET (un exemple) d'une directive avant de décider où elle vit dans le design.
- `[2× — 2026-07-25]` **Les deux échelles ont RE-perdu le user en session** (« comment ça le lot 2 nous l'avons déjà fait non ? »). Cause exacte : le lot 1 des lots `N` (AGENTS.md) a été **absorbé par la vague `S2`**, donc la numérotation des lots `N` est partiellement périmée — parler de « lot 2 » devient faux pour qui suit les vagues. Remède appliqué : ne plus citer le numéro, **nommer le livrable** (« inspect »). Un identifiant n'a de valeur que s'il désigne encore ce qu'il désignait.

## 📦 Ce qui est COPIÉ à la création ne se met jamais à jour

- `[1× — 2026-07-24]` ⭐ **Mon étagement release contredisait ma propre gate — le user l'a attrapé.** J'avais mis « entity bout-en-bout » APRÈS la release alors que le banc des 3 tâches (gate de 10.0.0) mord précisément sur ces trous. Deux leçons : (a) **vérifier qu'une gate définie ne mord pas sur ce qu'on reporte** ; (b) le critère de placement release pour tout artefact scaffold est l'**asymétrie de support** — le code généré est FIGÉ dans l'app à sa création (un fix 10.1 ne répare AUCUNE app née en 10.0.0), un module npm (Studio) se met à jour. Trancher par le support, pas par l'envie de sortir vite.

## 🚪 Ce que la frontière npm laisse passer

- `[1× — 2026-07-24]` ⭐ **TSDoc TRAVERSE le build, les commentaires inline NON.** Prouvé sur pièce : le bloc `/** */` de `ProfilerAdminApi` arrive intégral dans le `dist/` (+ `.d.ts` + 1ʳᵉ phrase dans symbols) ; le `// Encapsulation et runtime identiques.` de `sessions-service.ts:165` disparaît. **Tout savoir destiné à l'utilisateur d'une app vit en TSDoc ou en `docs/` — l'inline ne parle qu'au lecteur du repo.** Option « préserver les `//` au build » à instruire (kit release).

## 🤖 Sous-agents — vérifier avant de répercuter

- `[1× — 2026-07-24]` **Un sous-agent d'inventaire peut AFFIRMER un fichier qui n'existe pas.** L'agent haiku a déclaré un `AGENTS.md` racine « créé 22-23/07 » en sur-interprétant un message de commit — `ls` direct : rien. Une affirmation d'inventaire d'un sous-agent (surtout modèle léger) se REVÉRIFIE d'un `ls`/`grep` avant d'entrer dans une synthèse.
- `[1× — 2026-07-24]` **Un kit boussole non relu ment 22 jours sans alarme.** Le kit release décrivait encore le modèle mono-distrib ABANDONNÉ le 02-07 (la décision vivait dans le doc repo, jamais reportée en mémoire). Le garde-fou `_state`↔commits existe pour les états de session, pas pour les kits : **à la reprise d'un kit, croiser sa date avec le journal du doc vivant qu'il pointe.**

## 🧮 Un compteur dérivé ment quand la source parle deux langues

- `[1× — 2026-07-24]` ⭐ **Le rapport du registre affichait 68 items ouverts pour 33 réels, et 2 « critiques » déjà corrigés.** Il PARSE le kit, mais ne lit que la **colonne « suite à donner »** ; les lots soldés « par geste » étaient racontés en **prose sous le tableau**. Deux façons d'écrire le même état dans une même source, une seule que l'outil regarde. **Écrire l'état LÀ OÙ l'outil lit** — sinon on pilote un chantier sur un chiffre faux, et on croit qu'il reste le double de travail.
- `[1× — 2026-07-24]` **Recaler un compteur à la main peut abîmer la source.** Mon script a marqué « ✅ SOLDÉ » dans la 3ᵉ colonne d'un tableau de SYNTHÈSE dont la 3ᵉ colonne signifiait « ce que fait le code ». Vérifier ce que la colonne VEUT DIRE avant d'y écrire, pas seulement son index.

## 🎯 Une garantie LOCALE n'est pas une garantie de bout en bout

- `[1× — 2026-07-24]` ⭐ **Un commentaire peut être vrai chez lui et faux dans le pipeline.** `Resolver.executeAction` affirmait que `@IsGranted` « court-circuite l'instanciation DI + `initialize()` (Zero Trust) » : exact **de sa méthode**, faux du trajet HTTP, où le kernel avait déjà instancié en amont. Personne n'avait menti — le contexte d'appel a invalidé la promesse. **Une garantie de sécurité écrite dans un commentaire doit être prouvée par un test qui part du DEHORS** (ici : frapper la route en anonyme et regarder si le code du controller a tourné), pas relue dans la fonction qui la porte.
- `[4× — 2026-07-24]` ⭐ **Un test qui ne quitte pas la brique ne prouve pas le câblage.** Trois fois dans la même session : (1) mes 14 tests de propriété de canal passaient, mais débrancher le contrôleur n'en faisait tomber aucun ; (2) idem pour les seuils de contre-pression — 7 tests verts, câblage non prouvé ; (3) l'avertissement « canal dynamique non gardé » ne s'est révélé qu'au test de bout en bout, qui a d'ailleurs découvert que `clear()` ne réinitialisait pas les avertissements déjà émis. **Le réflexe : après avoir écrit les tests d'une brique, DÉBRANCHER le point de câblage et vérifier que quelque chose tombe.** Si rien ne tombe, le câblage n'est pas testé.
- `[1× — 2026-07-24]` **Pour prouver un ORDRE d'exécution, instrumenter le point observé et le relire par une route publique.** Le mouchard vit hors des instances (une instance ne survit pas à sa requête) et se lit hors de la zone protégée (un banc anonyme ne peut pas lire ce qu'une zone fermée a écrit). Trois lignes de décor, et l'ordre devient un fait mesuré au lieu d'une phrase.

## 📐 La cible d'une mesure fait partie du décor

- `[1× — 2026-07-24]` **Le défaut d'un script de banc peut être périmé alors que la bonne cible existe.** Je mesurais sur `/nodefony/kernel/api/livez` — qui traverse EN PLUS la zone firewall, un authenticator, le broker admin et appelle `getBootReport()`. Le user a rappelé qu'une route avait été faite EXPRÈS (`/nodefony/kernel/bench`, corps figé, hors aire admin, flag `NF_BENCH_ROUTE=1`). **Avant de mesurer : chercher si une cible dédiée existe** — sinon on chiffre l'étage d'à côté. Figé depuis dans le skill + posé par le script.
- `[1× — 2026-07-24]` **Un symbole introuvable à l'import = symbole DÉPLACÉ, pas runtime cassé.** Cinq bancs cluster importaient `RealtimeHub`/`ClusterBackplane` de `@nodefony/framework` ; tout est passé dans `@nodefony/realtime`. `.ai/symbols.json` (`.symbols.X.module`) le dit en une commande — avant de soupçonner une régression.

## 🧷 Un run vert ne typecheck rien — et tous les typechecks ne se valent pas

- `[2× — 2026-07-24]` **Des erreurs de type dans mes propres tests, invisibles en vert.** Vitest efface les types à la transpilation. 1ʳᵉ fois : un import pointait un type non exporté (TS2459), une conversion sautait `unknown` (TS2352) — c'est le **pre-push** qui a mordu. 2ᵉ fois : élargir le retour de `send` en `boolean | void` a cassé **6 stubs** `send: (f) => sent.push(f)` (une flèche concise renvoie le `number` de `push`) — suites 100 % vertes, `npm run typecheck` racine rouge. Pire piège : `npx tsc --noEmit` lancé DANS le module est vert, il ne couvre pas les mêmes fichiers. **Avant un push : `npm run typecheck` à la racine, pas le tsc du module.** Et **élargir un type de retour de callback casse les stubs concis**, jamais les tests.

## 📎 Un diff de code décale les ancres de la doc

- `[1× — 2026-07-24]` **40 lignes insérées dans un service → 16 ancres `fichier:ligne` fausses dans sa page de doc**, qu'aucun humain ne verrait. `anchor-check` les nomme mais ne les répare pas : recaler par SYMBOLE (chercher la ligne du symbole cité, la plus proche de l'ancienne) puis relancer jusqu'à 0 SUSPECT. **Toute modification de code touche la doc qui l'ancre** — le gate doit tourner dans le même geste, pas à la revue suivante.

## 🧪 Un contrôle négatif mal conçu ne prouve rien (et c'est le mien)

- `[3× — 2026-07-23e]` **Casser une règle NON normative ne fait pas mordre un gate.** Pour éprouver la barrière des skills, j'ai réduit une description à un caractère : toujours vert, car 1 ≤ 1024 — la règle n'était pas violée. Puis j'ai copié un lanceur existant pour simuler un orphelin : classé « à déplacer », catégorie que `--strict` ignorait. **Deux contrôles négatifs faux avant un vrai** (nom de skill ≠ dossier). Choisir la règle qu'on viole, et vérifier qu'elle est bien violée AVANT de conclure sur le gate.
- `[1× — 2026-07-23e]` **Le contrôle négatif a trouvé un vrai trou** : `--strict` ne comptait que orphelins et renvois morts, jamais « à déplacer » — un gate à moitié aveugle que j'allais livrer en disant qu'il marchait.
- `[1× — 2026-07-23e]` **Un outil externe voit ce que le contrôle maison rate.** `skills-ref` (validateur officiel) a trouvé 2 frontmatter YAML invalides que mon parseur regex laissait passer : une description **en ligne** contenant un `:` casse le mapping. Corollaire : auditer le paquet avant de l'exécuter (celui-ci n'a ni `repository` ni `homepage` et lit tous les skills — 20 Ko, `node:fs` seulement, vérifié).

- `[1× — 2026-07-24]` **Un test qui n'assertait que le cas REFUSÉ cachait que le chemin nominal est asynchrone.** Mon test F86 échouait : le handler n'avait « pas tourné ». En réalité le dispatch d'une requête JSON-RPC passe par une microtask — le test existant ne l'avait jamais montré, puisqu'il ne vérifiait que le refus (synchrone). **Un test qui ne couvre qu'une branche apprend faux sur l'autre.**
- `[1× — 2026-07-24]` **Le durcissement bat la documentation.** `UploadedFile.move()` composait sa destination avec le nom de fichier CLIENT ; un `[!WARNING]` dans la doc « couvrait » le piège. Un avertissement demande à chaque application de se souvenir ; un `basename` forcé ferme la porte. Quand le choix est « durcir ou documenter », c'est durcir.
- `[1× — 2026-07-25]` ⭐ **Une preuve négative peut être fausse à cause de la PERSISTANCE de la base.** Mon test « la colonne est indexée » restait VERT en PostgreSQL et MySQL après avoir retiré l'index de la spec : là-bas les tables survivent aux runs, il constatait donc un index créé la veille. Seul sqlite tombait (base en mémoire). Règle : sur un schéma persistant, une preuve de DDL doit **supprimer l'objet, vérifier qu'il est bien parti, puis relancer le DDL** — sinon elle mesure l'histoire, pas le code.
- `[1× — 2026-07-25]` **Le geste de débranchement lui-même peut être inopérant, en silence** : le `DROP INDEX` passé par `all()` (better-sqlite3 réserve `all` aux SELECT) ne faisait rien. Ce n'est pas l'assertion finale qui l'a dit, c'est le **garde intermédiaire** posé juste après le DROP (« l'index survit à son DROP → le test ne prouverait rien »). Poser ce garde coûte trois lignes et transforme une preuve douteuse en preuve.
- `[3× — 2026-07-25c]` ⭐ **Une sonde de transcript qui cherche un NOM DE FICHIER mesure une mention, pas une lecture.** `/catalogue\.md/` a affiché « ✅ a ouvert le catalogue » sur TROIS runs — le nom venait de l'`AGENTS.md`, qui le cite ; aucun agent ne l'avait jamais ouvert. Viser une chaîne du **contenu** (ici « Ne le prends pas si »). Même famille : chercher `\bstores?\b` a validé un agent qui écrivait « stores noSQL » sans rien avoir rapporté. **Un faux POSITIF est pire qu'un faux négatif : il déclare fermé un trou ouvert** — deux d'affilée sur la même tâche.
- `[1× — 2026-07-25c]` ⭐ **Un juge qui lit le diff git est aveugle à ce que le dépôt IGNORE.** Tâche de configuration : l'agent avait fait juste (`.env.local`), deux sondes l'ont recalé — le fichier est gitignoré par conception. Pour une tâche dont la bonne réponse vit hors du dépôt, seul un juge d'**état** dit la vérité (ici `nodefony env --json`, l'outil lui-même comme juge).
- `[1× — 2026-07-25c]` ⭐ **Publier un document et le POINTER ne suffit pas** : l'agent répond de mémoire plutôt que de détourner son chemin, même quand l'énoncé dit « ne devine pas ». Le catalogue, pointé en tête de la table tâche→doc, n'a été ouvert qu'une fois l'information dont dépend le CHOIX **affichée** dans l'`AGENTS.md` lui-même. Corollaire pour une tâche de banc : la concevoir contre le modèle qui **devine**, pas contre celui qui ignore — « mongoose pour du document » est de la culture générale, seul un fait non devinable (les stores manquants) mesure la découvrabilité.
- `[1× — 2026-07-25c]` ⭐ **Un harnais qui juge des agents doit vérifier que l'agent a PU travailler.** Quota épuisé au milieu d'un run complet : 8 tâches « échouées » qui n'étaient jamais parties (1 échange chacune), rapport `1/9` trait pour trait identique à celui d'une app devenue indécouvrable. Garde posé : erreur API terminale → run ARRÊTÉ, et distinguer « jamais démarré » (< 3 échanges) de « coupé en cours » (verdict partiel, ce qu'il n'a pas eu le temps de faire n'est pas un échec).
- `[1× — 2026-07-25c]` **Une capacité livrée sans sa tâche de banc est livrée aveugle.** Trois l'étaient (catalogue, mode machine, `inspect`) — trouvées en répondant à « tout est testé ? », pas par le banc, qui ne voit que ce qu'on lui a appris.
- `[2× — 2026-07-25]` **Ancrer une assertion sur un mot qui apparaît AILLEURS dans le texte ne prouve rien.** Gate de l'AGENTS.md généré : j'ai débranché le geste `@IsGranted` → toujours vert, le nom figurant dans deux phrases voisines. Vaut pour tout gate qui lit du texte rendu : ancrer sur un marqueur **propre à la ligne** qu'on veut garder (fragment de phrase), jamais sur un identifiant fréquent.
- `[1× — 2026-07-25]` ⭐ **`git stash push` sur un fichier DÉJÀ COMMITÉ ne stashe rien — et la preuve négative passe au vert sans rien avoir débranché.** J'ai « prouvé » un gate d'AGENTS.md ainsi : 110 verts, conclusion fausse. Le tell : `git stash list` vide, ou `git diff --stat` sans effet. Une preuve négative doit d'abord vérifier **que quelque chose a bien été retiré**, sinon elle mesure le statu quo. (Sur un fichier commité : éditer, tester, `git checkout --`.)
- `[1× — 2026-07-25]` **Une modification de GABARIT sans assertion est une modification non gardée.** Deux sections ajoutées à l'`AGENTS.md` généré (piloter le serveur, interroger l'app) sont parties sans gate — c'est le user qui l'a réclamé. Rien n'aurait signalé leur disparition, alors que c'est précisément ce qu'un agent lit pour savoir arrêter un serveur.

## 🧭 Ce qui est LU à chaque tour gouverne — pas ce qui est bien rangé

- `[1× — 2026-07-26]` ⭐ **La règle vit dans le fichier auto-chargé, ou elle n'agit pas.** Trois tâches de banc échouaient (commande CLI, environnement, choix de brique) : dans deux cas l'agent n'a **jamais ouvert** l'index de l'app — il en a vu le nom dans un `ls`, a même écrit deux fois son intention de le lire, sans jamais le faire. La cause était le `CLAUDE.md` d'une ligne, chargé lui à chaque tour : il **recopiait** quatre générateurs sur cinq, la liste avait dérivé quand un cinquième est arrivé, et l'agent qui n'y trouvait pas son cas écrivait à la main. Remède qui a marché : **supprimer la liste** (elle re-dérivera) et poser un test binaire qui couvre l'inconnu (« tu vas créer un fichier ? `create --help` d'abord ») + les CHEMINS interdits d'écriture manuelle. Corollaire : **un fichier ne déclenche que ce qu'il NOMME** — la tâche « arrête le serveur » a continué d'échouer jusqu'à ce qu'un 4ᵉ réflexe parle du pilotage.
- `[1× — 2026-07-26]` **Une sonde peut punir l'obéissance.** Le motif qui cherchait `lsof|pkill|kill -9` nus mordait sur le `CLAUDE.md` lui-même, qui NOMME ces commandes pour les interdire : l'agent qui lit la règle la fait entrer dans son transcript, et le harnais comptait la règle comme sa violation. Ancrer sur la clé `"command"` d'un appel d'outil — le geste, jamais la mention. **Le faux positif est le pire des deux** : il ferme un dossier ouvert.

## 🔇 Un mode machine qui coupe le journal coupe aussi les erreurs

- `[1× — 2026-07-26]` ⭐ **`--json` rendait une commande MUETTE sur échec** : `inspect <sujet> --json` sortait 0 octet, stderr vide, code 1, quand la base configurée était injoignable — l'appelant en concluait que l'app n'avait ni routes ni services (un agent a préféré inventer un chiffre plutôt que constater la panne). `initSyslog` retournait sans brancher AUCUN transport dès que `--json` était passé, alors que son propre commentaire promettait que « les erreurs partent sur la sortie d'erreur ». **Un commentaire n'est pas une garantie** : celui-ci décrivait un comportement que le code ne faisait pas, et le test qui gardait l'endroit affirmait « aucun listener ajouté » — il VERROUILLAIT le défaut, d'où son vert. Règle : `stdout` appartient aux données, `stderr` aux erreurs ; couper l'un ne doit jamais couper l'autre. (Cause racine du silence de boot : non trouvée → BUG-1.)

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib de rapports, faute d'avoir ouvert le source.** `tabs()` attend `body`, j'ai passé `html` → les trois onglets sont sortis **vides**, sans une erreur : 35 Ko de page, zéro tableau, et le script « réussissait ». Puis `table()` s'est révélé **ne PAS échapper** ses cellules (elle accepte du HTML) alors que mes libellés contenaient des `<module>`/`<sujet>`. Le tell commun : un livrable qui se génère sans broncher mais dont le CONTENU manque. **Compter ce qu'on vient de produire** (`grep -c "<table"`) vaut mieux que faire confiance à un code de sortie — et la signature se lit dans la lib, elle ne se devine pas depuis un tableau de doc.

## 🔫 Identifier avant de tuer — une sous-chaîne n'est pas une identité

- `[1× — 2026-07-25]` ⭐ **Le user a attrapé un angle mort que je n'avais pas cherché** (« attention, vérifie que les ports sont bien pris par nodefony, il ne faut pas tuer d'autres processus »). En vérifiant : la reconnaissance d'un runtime faisait `command.includes("nodefony server")` — donc `tail -f /dev/null nodefony server` était classé serveur de production, et `stop --all` (qui ne filtre par aucun projet) l'aurait **tué**. Deux règles : poser un `process.title` REMPLACE l'argv, donc le titre s'**ancre en tête** (`startsWith` sur la commande trimée) et ne se cherche jamais dans la ligne ; et un geste destructeur sans périmètre exige une **seconde preuve indépendante** du nom (ici : le process travaille-t-il dans un projet Nodefony ?). Corollaire de méthode : quand une session touche à un sujet voisin d'un `kill`, **auditer tous les points de kill AVANT**, sans attendre qu'on le demande.

## 🕰️ Une norme externe bouge — le gate qui la contrôle dérive en silence

- `[1× — 2026-07-24]` **Une GOUVERNANCE recopiée se propage jusque dans les gates.** « Agent Skills = AAIF/Linux Foundation » était faux (l'AAIF a reçu AGENTS.md+MCP+goose ; Agent Skills reste piloté par Anthropic) — et l'erreur vivait dans le kit devkit, `skills-doc.mjs` (`org:`) et l'index MEMORY. **Une attribution de gouvernance se vérifie à la source primaire** (communiqué de la fondation, repo de la spec), pas dans la presse secondaire ; corriger la source ET les gates qui la citent.
- `[1× — 2026-07-23f]` **Rafraîchir le standard AAIF a révélé DEUX dérives de mon gate** : le champ `compatibility` avait été ajouté à la spec (≤500) et manquait à `ALLOWED_FIELDS` (faux positif « hors standard » en puissance) ; la règle `name` interdit les tirets consécutifs et aux bords, que ma regex laissait passer. **Un contrôle de conformité calibré une fois se périme quand la norme avance — revalider contre la spec FRAÎCHE avant de lui faire confiance ou de le durcir.** Les constantes du standard citent désormais leur source en tête du script.
- `[1× — 2026-07-23f]` **Une fiche générée peut PROUVER sa conformité, pas seulement l'affirmer** : badge en tête (N/N normatifs MUST · projet · recommandé SHOULD) + une colonne qui CITE la règle exacte du standard et sa nature. « Du vrai travail visible » > un ✅ nu.

## 🧵 Générateur vs formateur — le diff perpétuel

- `[1× — 2026-07-23f]` **Prettier reformatait les fichiers GÉNÉRÉS à chaque commit ; le générateur les reproduisait sans ce formatage → diff perpétuel** (les tables se réalignaient dans un sens puis l'autre). Un fichier généré ne doit avoir **qu'un seul formateur : son générateur**. Fix = les exclure de `.prettierignore` ; idempotence de la régénération prouvée ensuite (0 diff).

## 🚰 Fermer un trou au POINT DE PASSAGE, pas site par site

- `[1× — 2026-07-24]` ⭐ **Deux fonctions écrivaient avant de refuser ; le kit demandait une pré-vérification DANS chacune.** Mettre les écritures dans une **transaction** (buffer mémoire, versement final par l'appelant racine) a fermé les DEUX cas plus tous les autres chemins de refus que je n'avais pas listés — et donné la simulation par-dessus, puisque simuler = ne pas verser. Réflexe : quand un correctif se décline par site, chercher le passage obligé en amont ; le corriger là ferme aussi ce qu'on n'a pas su énumérer, et la garde ajoutée demain naît sûre.
- `[1× — 2026-07-24]` **Un raccourci qui ne SERT que le premier appelant se paie au deuxième.** La table des étapes npm vivait dans Studio, le CLI en avait une copie en dur ; la manière de les MONTRER diffère légitimement (terminal hérité vs canal temps réel), ce qu'elles SONT non. Séparer « ce que c'est » de « comment on l'affiche » avant de dupliquer.

## 🧹 Le nettoyage d'un test vit dans le `finally`, jamais en fin de corps

- `[1× — 2026-07-24]` ⭐ **Un `node` traînait depuis la veille — un child factice de test, sur `setInterval(() => {}, 1 << 30)`.** Le `kill` était écrit APRÈS les assertions ; le `finally` ne s'occupait que du fichier de log. Une assertion qui tombe saute donc le nettoyage, et le process survit au run, à la suite, à la session. **Tout ce qu'un test alloue au-dehors (process, port, conteneur, fichier) se libère dans le `finally`** — et le nettoyage doit tolérer l'absence (pid nul, déjà mort) pour ne jamais masquer l'échec qu'il suit. Corollaire : un `ps` en fin de session est un contrôle qui rapporte.

## 🧿 Un plafond partagé appartient à celui qui l'a posé

- `[1× — 2026-07-24]` ⭐ **Deux `MaxListenersExceededWarning` au boot sans la moindre fuite.** Le Kernel dimensionne son bus d'événements à 60 (14 modules × leurs listeners de cycle de vie), mais chaque `Service` construit ENSUITE avec ce même bus y réappliquait son défaut de 20 : le dernier arrivé décidait. **Un composant qui reçoit une ressource partagée ne doit pouvoir que l'élargir, jamais la restreindre** — sinon la valeur effective dépend de l'ordre de construction, que personne ne contrôle. Vaut pour tout plafond/quota posé sur un objet qu'on ne possède pas.
- `[1× — 2026-07-24]` **Un secret ORPHELIN : `.env.local` le portait, rien ne le lisait.** L'avertissement « secret éphémère » avait l'air d'un défaut de configuration ; c'était un **câblage manquant** dans `env.ts` + `nodefony.config.ts` de l'app du dépôt — les apps GÉNÉRÉES, elles, l'ont toujours eu. Devant un avertissement de secret, vérifier d'abord que la variable est LUE avant de conclure qu'elle est absente (famille 👻 MIROIR).

## 🧊 On cache un RÉSULTAT, jamais un ÉCHEC

- `[1× — 2026-07-25]` ⭐ **Cacher l'ABSENCE d'une ressource fige la panne jusqu'au restart.** Le manifest Vite absent était mis en cache « pour le hot path » → page blanche en prod MÊME APRÈS un `frontend:build` réussi (vécu par le user, incompréhensible depuis l'extérieur). Fix : ne cacher que le manifest TROUVÉ — le coût de relecture n'existe que dans l'état dégradé, qui n'est pas un hot path à défendre, et l'état se répare seul au reload. **Avant de mettre un échec en cache, se demander qui le rafraîchira.**

## 🕵️ Un outil muet n'est pas une preuve d'absence

- `[1× — 2026-07-24]` ⭐ **`grep -rn --include=… .` a rendu VIDE là où `rg` trouvait 10 occurrences.** J'allais conclure « tout est corrigé » sur un silence. Le dépôt résout `grep` vers `ugrep`, dont les `--include` multiples ne se comportent pas comme attendu. **Un résultat vide qui vous arrange se re-teste avec un autre outil** — c'est le seul cas où l'absence de sortie mérite un contrôle, et c'est justement celui où on ne le fait pas. (Famille [[feedback_shell_false_diagnostics]].)

## 🧱 Ce qui sort du dépôt n'est pas testé par le dépôt

- `[2× — 2026-07-24]` ⭐ **Deux fois le même réflexe manquant : j'ai conclu sur le GABARIT au lieu de démarrer l'app.** (1) Devant l'avertissement de secret CSRF, j'ai vérifié que le template câblait bien `NF_CSRF_SECRET` et j'ai annoncé « les apps générées n'ont jamais eu le problème » — vrai, mais **déduit**. C'est le user qui a demandé la preuve ; l'app générée boote effectivement à zéro avertissement, mais je ne le savais pas. (2) Le lancement en `production` de cette même app a montré deux avertissements que je n'avais pas anticipés (certificat de secours, aucun admin seedé) — corrects tous les deux, et invisibles depuis le dépôt. **Lire le gabarit dit ce qu'on écrit ; démarrer l'app dit ce qui arrive.** Les deux modes valent le coup : `development` ET `production` ne racontent pas la même histoire.
- `[2× — 2026-07-25]` ⭐ **Le typecheck de l'app GÉNÉRÉE voit ce qu'aucune suite du dépôt ne peut voir.** (1) TS2882 : un import de feuille de style d'un gabarit — le tsconfig UNIFIÉ front/back de l'app ignore ce que Vite sait importer. (2) TS2305 : `import { RealtimeClient } from "nodefony"` — l'export racine n'existe que sous la condition `browser`, que Vite résout et que `tsgo` ne voit pas ; le geste sûr et enseignable = le subpath EXPLICITE (`nodefony/client`), résolu à l'identique partout. **Tout changement de gabarit se prouve en générant une app et en lui faisant passer SES propres gates** (install → test → typecheck → e2e), pas en relançant les nôtres.
- `[1× — 2026-07-24]` **Angular RENOMME les `@keyframes` déclarés dans `styles: [...]`** (encapsulation de vue) : une animation nommée par une variable CSS devient introuvable, sans erreur. Un style qui doit être global passe par un import CSS que Vite injecte — et les trois frameworks gagnent à utiliser le MÊME mécanisme plutôt qu'un idiome par framework.

## 🔎 Vérifier dans le rendu — et vérifier le décor de la vérification

- `[2× — 2026-07-23e]` **Deux fausses alertes d'affilée sur la même page.** (1) Une session expirée renvoyait du JSON d'erreur que mon parseur lisait comme un markdown vide → « les cards ont disparu ». (2) Le motif cherché était celui d'AVANT réécriture : le portail transforme `skills/x.md` en slug `root~skills~x.md`, comportement correct. **Avant de déclarer une régression sur une mesure HTTP : vérifier le code de retour, puis ce que la couche transforme légitimement.**

## 🪞 Utiliser l'outillage qu'on prêche

- `[1× — 2026-07-25]` ⭐ **J'ai écrit un skill à la main SANS charger `nodefony-skill`** — en livrant, dans la même session, un banc qui mesure si un agent découvre l'outillage existant. Le user l'a demandé (« tu as utilisé le skill ? ») ; les gates ont mordu aussitôt : description à **1072 > 1024**, et surtout **zéro cas au banc de déclenchement** (porte non testée, donc invérifiable). Règle : avant de produire un artefact STRUCTURANT (skill, banc, doc de référence), la première question est « un skill couvre-t-il ça ? » — c'est exactement le réflexe que le devkit essaie d'installer chez les autres.
- `[1× — 2026-07-25]` ⭐ **Un skill peut promettre une capacité par la voie la MOINS fiable, et personne ne le voit.** `nodefony-inspect` annonçait « config / services / routes d'un module » — en lisant les SOURCES, alors qu'une commande donne le Router réel. Un agent qui le chargeait pour connaître les routes allait déduire des décorateurs. Question du user (« le core peut les utiliser, c'est mentionné dans les skills ? »). Règle : **quand on livre un outil, balayer les skills qui promettent DÉJÀ la même réponse** — sinon le nouvel outil coexiste avec l'ancien conseil, et c'est l'ancien qui gagne (il est écrit).
- `[1× — 2026-07-25]` **Retirer un déclencheur pour tenir sous la limite de description casse une porte TESTÉE.** Coupé « qui implémente cette interface ? » pour gagner 42 caractères → banc à 49/50. La contrainte de taille se paie dans la PROSE, jamais dans les déclencheurs : la prose est lue par un modèle qui infère, un déclencheur est une porte qui existe ou n'existe pas.
- `[1× — 2026-07-25]` **`--check` contrôle, il ne régénère pas** (rappel du user). Passer le gate en `--check` et s'arrêter là laisse les fiches publiques et le registre périmés — l'inverse exact de ce que le gate est censé garantir.
- `[1× — 2026-07-25]` **Un protocole improvisé qui trouve des bugs doit devenir rejouable le jour même.** Le protocole de vérification du code généré (app témoin → compile → build → tests → HTTP réel) a trouvé 4 pannes invisibles aux assertions de chaînes. Laissé en gestes de session, il aurait été réinventé à la vague suivante. Devenu `nodefony-devkit-bench` — et il a trouvé 2 pièges de plus à son premier run automatisé.

## 🧭 Où vit un outil

- `[2× — 2026-07-23e]` **Un script rejoint un skill quand son résultat dépend d'un PROTOCOLE** (décor, ordre, interprétation) ; il reste à la racine s'il est déterministe et câblé au manifeste. Corollaire découvert en appliquant la règle : **un script dans un skill que le skill ne cite pas est introuvable** — 24 bancs dans ce cas. Et **sortir un script d'une chaîne casse la chaîne** : le smoke test appelait l'empaqueteur par chemin absolu, plus trois renvois vivants dans la doc.
- `[1× — 2026-07-23e]` **Un skill muet n'est pas inutile : sa règle est recopiée dans le `CLAUDE.md`.** L'agent lit la règle au démarrage, exécute la commande, n'ouvre jamais le skill — qui portait le diagnostic. Cause n°1 des 11 skills à zéro invocation sur 194 sessions.
- `[1× — 2026-07-23f]` ⭐ **Un lien pourri que PERSONNE n'a remarqué en 2 mois est la preuve qu'on n'ouvre jamais le skill.** `ts-docs` : 2 de ses 4 URLs en 404 (repo TS-Website restructuré), 0 invocation → retiré, ses 3 sources valides repliées dans `framework-dev`. La rot silencieuse d'une ressource EST le signal de non-usage — plus fiable qu'un compteur.
- `[1× — 2026-07-23f]` **« Ni garder ni jeter » n'est pas une réponse quand le user demande de trancher.** Données à l'appui : `rfc` (4 invocations, URLs revérifiées valides) gardé ; `ts-docs` (0 + liens pourris) retiré. Décider + justifier, pas « on verra ».

## 📦 Surface npm & publication (chantier release en cours)

- `[2× — 2026-07-24]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.** Six paquets publiaient `exports["."].types → ./index.ts`, absent du tarball (`files:`) : invisible dans le repo self-hosted, cassé pour tout installeur npm. Vérifier une surface publiée = **dépaqueter le tarball** (`npm pack` + lire le manifeste), jamais lire le `package.json` du dépôt. Revécu via `--link` : le `node_modules` symlinké montre les SOURCES complètes (CLAUDE.md, `.ts`) — conclure de là ce qu'un installeur verra est faux ; raisonner sur `files:`.
- `[1× — 2026-07-23]` **`publishConfig.exports` n'est PAS appliqué par npm** (c'est pnpm/yarn). Testé avant de le proposer.
- `[1× — 2026-07-23]` **Un import non déclaré ne casse rien ICI et deux choses AILLEURS** : turbo ne peut pas ordonner le build, et le consommateur npm n'installe pas la dépendance. Auditer les imports de **valeur** (pas seulement de types) contre les `dependencies`.
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE — la vérifier avant de le retirer.** `exports.types → ./index.ts` avait l'air d'une paresse ; c'était l'anti-race du CLAUDE.md. 4 `clean && build` complets pour le prouver (le `dist` d'avant masque exactement cette panne).

## 🐳 Décor de test (conteneurs, dist, sortie capturée)

- `[1× — 2026-07-23g]` **Un banc e2e a un DÉCOR ; les lancer en boucle naïve = faux « KO ».** 17 bancs e2e d'affilée sur le serveur dev standard → **13 « KO », 0 vrai bug**. Trois pièges, tous du décor : opt-in manquant (le banc DIT « relance avec `NF__…` »), DESTRUCTEURS (`graceful-shutdown`/`cluster-*` tuent le serveur partagé → cascade `ECONNREFUSED`), store PERSISTANT (résidus d'un run mort → « liste pas revenue à l'état initial »). Gradué → `nodefony-load-test` §RÈGLE N°2 + table décor.
- `[1× — 2026-07-23g]` **`assert.rejects(fn)` NE CAPTE PAS un throw SYNCHRONE du thunk.** Une garde qui lève AVANT le `Promise.resolve` d'un store non-`async` fuse hors du `await` interne → test rouge malgré le BON comportement. `try { await store.listPage(…) } catch` capte sync ET async — comme le vrai appelant admin (`async`).

- `[1× — 2026-07-23]` **Un service derrière un `profiles:` compose n'est JAMAIS monté par un `up` nu** — PostgreSQL et MariaDB étaient marqués « exercés » sans avoir jamais tourné. Un ID de réseau docker recréé les fait échouer au démarrage (volumes nommés = 0 perte à la recréation).
- `[1× — 2026-07-23]` **Un `dist/` réduit à `types/` casse un AUTRE module, avec un message qui ne le nomme pas.** Vérifier le décor AVANT la batterie : `docker ps` + profils compose + `ls <paquet>/dist/index.js`. Trois commandes contre quinze minutes de run.
- `[1× — 2026-07-22]` **Remplacer un décor ÉPHÉMÈRE par un décor PERSISTANT révèle les bancs non rejouables** (mongod neuf à chaque run → conteneur permanent : les bancs qui n'effaçaient rien sont tombés).
- `[1× — 2026-07-22]` **« Même dialecte » n'est pas « même serveur »** : MariaDB et MySQL Community partagent driver et dialecte, mais divergent sur collation, bornes numériques et arbitrage des uniques.

- `[1× — 2026-07-26e]` 🔴 **`turbo run <tâche> --filter` ne rebuild QUE ses cibles — et les tests qui lisent PLUSIEURS `dist` mentent ensuite.** Après un `--filter` sur 3 workspaces, 3 tests d'intégration CLI (`--help` doit lister les commandes des modules) sont passés au rouge. J'ai suspecté mon diff, stashé, rebuild COMPLET : 2245 verts sur HEAD **comme avec le diff** — la cause était le `dist` désynchronisé, pas le code. Le réflexe « baseline stashée » a tranché en 3 minutes ce qu'une lecture de diff n'aurait jamais montré. **Avant d'attribuer un rouge à son propre diff, se demander quels `dist` le test traverse** ; un test d'intégration multi-modules exige un `npm run build` complet, pas un `--filter`.
- `[2× — 2026-07-24]` **`head -N` fabrique un faux diagnostic.** J'ai conclu « la page Webhooks n'existe pas » sur un `ls | head -40` tronqué — le fichier venait juste après dans l'ordre alphabétique. Même famille que `tail`/`$?` après un pipe : **une sortie coupée n'est pas une absence**.
- `[2× — 2026-07-24]` **zsh ne découpe pas une variable non quotée** (contrairement à bash) : `perl … $FILES` a reçu UN seul argument contenant tous les chemins, et le message d'erreur ne le disait pas. Passer par `xargs` quand une liste de fichiers doit devenir des arguments.
- `[2× — 2026-07-24]` **Une substitution mécanique remplace plus large que prévu.** `s/ \(\)//g`, censé nettoyer des parenthèses vides laissées par une dé-datation, a mangé les `()` d'une arrow function dans un exemple de code ; et remplacer un motif « par `)` » a laissé neuf parenthèses orphelines. Après toute passe automatisée : relire le diff, et vérifier l'équilibrage.

## 🧯 Justifier une absence (le réflexe qui fabrique des trous)

- `[1× — 2026-07-23]` ⭐ **Un slogan sur la NATURE d'un composant n'est pas une justification.** « Couverture adaptée à la nature, pas parité SQL×NoSQL » servait à expliquer une absence qui n'avait aucune raison d'être.
- `[1× — 2026-07-23]` ⭐ **Vérifier ce que le composant porte DÉJÀ de la même famille avant d'invoquer sa nature.**
- `[1× — 2026-07-23]` **Une couverture partielle affichée sans ses cases vides devient un choix aux yeux du lecteur** — montrer AUSSI ce qui n'est pas couvert.
- `[1× — 2026-07-24]` **Écrire la limite vaut mieux qu'un exemple qui ne marche pas.** Demande d'un exemple « métier » pour les webhooks : impossible, la source est le journal d'audit et sa liste de catégories est FERMÉE. Plutôt qu'un `order.paid` qui ne partirait jamais, la page dit la limite et nomme le chantier qui la lèvera. Vérifier l'enum AVANT d'écrire l'exemple, pas après.

## 👻 Le MIROIR — une option qu'on POSE mais que rien ne LIT (motif du registre en cours)

- `[1× — 2026-07-23]` **Retirer une clé morte du schéma AGGRAVE le silence** : l'app continue de la poser, plus rien ne la refuse. Le remède est un **lecteur** (ou un avertissement au boot), pas une suppression.
- `[1× — 2026-07-23]` **Un champ d'audit non rempli peut EFFACER** (`markUsed(id, { at })` sans `ip`/`userAgent` remet les colonnes à `null`) — et **rempli, il ne sert à rien s'il n'est exposé nulle part**.
- `[1× — 2026-07-13]` **Une option que le code LIT mais que rien ne permet de POSER** : `timing.enabled` lu par le `Context`, absent du schéma Zod → inatteignable en production. Le pendant exact du miroir.

## 🗄️ Concurrence & atomicité (ce que le dialecte ne dit pas) — utile pour l'ORM S5

- `[1× — 2026-07-17]` **Un pool FROID masque les races** : le 1ᵉʳ écrivain (seule connexion chaude) finit avant que les autres aient leur TCP+auth → vert 3/3 sans le fix, structurellement. Chauffer (`Promise.all` de `count()`) avant de mesurer.
- `[1× — 2026-07-17]` **`ON CONFLICT (x)` n'arbitre QU'UN index** ; **MySQL n'a ni `RETURNING` ni `WHERE` sur ODKU** (tout upsert conditionnel y coûte 2-3 requêtes, donc une course) ; **un upsert reste un INSERT qui bascule** (colonnes `NOT NULL` obligatoires même quand la ligne existe).
- `[1× — 2026-07-17]` **La concurrence est un angle mort structurel des bancs** (séquentiels) : `Promise.allSettled` + tenir le travail ouvert, sinon les tâches se sérialisent et le bug ne sort jamais.
- `[1× — 2026-07-17]` **Les valeurs JOUETS ne prouvent rien sur le type d'une colonne** : `1000` passe partout ; `1_775_000_000_123` prouve le bigint, `INT32_MAX` trouve la borne.

## 🚦 Gates — le régime doit épouser la NATURE de ce qu'il vérifie

- `[1× — 2026-07-23g]` **Un banc qui n'EXTRAIT pas ce qu'il note teste du vent.** Le `trigger-bench` des skills exige `Déclencheurs :` (deux-points COLLÉ au mot) ; ma ligne `Déclencheurs (toute édition…) :` (parenthèse avant le `:`) cassait le split → **0 déclencheur extrait**, le skill ne scorait que sur sa prose. J'ai chassé un scoring « aberrant » côté FORMULE une demi-heure avant de voir que le PARSEUR ne lisait rien. Vérifier que le gate VOIT son entrée avant d'interpréter son verdict.
- `[1× — 2026-07-23g]` **Un test qui scanne PLUS LARGE que la prod fabrique des faux positifs.** `corpusLinks` scannait `session-retros` (exclu du portail réel via `scan.exclude`) et SUIVAIT un symlink racine (`docs/MIGRATION_STATUS.md`, liens relatifs à la RACINE) → 2 « liens morts » incliquables. Aligner le test sur ce que le consommateur RÉEL indexe (mêmes exclusions, ignorer les symlinks) — pas réécrire les fichiers.

- `[1× — 2026-07-22]` **Un gate qui échoue toujours pour de mauvaises raisons finit ignoré, y compris le jour où il a raison.** Corollaires : distinguer le CODE de la PROSE dans un markdown ; nommer le fichier, pas son basename ; **dire combien d'exceptions il a acceptées**.
- `[1× — 2026-07-22]` **Un contrôle peut être satisfait PAR ACCIDENT — le vérifier avant de l'imposer** (l'« intro en blockquote » matchait déjà pour une autre raison).
- `[1× — 2026-07-20]` **Changer le FORMAT d'un contenu peut le sortir du champ de vision de son gate** — étendre le gate en même temps que le format.

- `[1× — 2026-07-24]` **`code-check` dit qu'un bloc de doc COMPILE, pas qu'il décrit le rendu réel.** Le contrôleur montré dans `vue-ensemble.md` comme « le fichier généré, complet, compile tel quel » portait des noms de route que le scaffold ne produit plus : gate vert, page fausse. Un extrait présenté comme une transcription se vérifie en le RÉGÉNÉRANT, pas en le compilant.
- `[1× — 2026-07-24]` ⭐ **Un test rouge en permanence cesse d'être lu.** `create.test.ts` échouait depuis des jours ; ni le test ni le code n'étaient fautifs — l'assertion cherchait `RequestContext` dans le FICHIER entier, et le template avait gagné un commentaire pédagogique qui le cite à raison. Une assertion doit viser **ce que le code fait**, pas ce que le fichier contient. Resserrer la visée, jamais désarmer : vérifié qu'elle mord encore sur un usage réel.
- `[1× — 2026-07-24]` **Un catalogue déclaré et consommé par personne** : `OPT_IN_SWITCHES` existait depuis toujours, seul `test:all` le lisait. Résultat, dès que l'infra était présente le rapport signait « ✔ toutes cibles exercées » en laissant 9 tests muets. Un gate qui ne regarde qu'une moitié du silence produit un vert menteur.
- `[1× — 2026-07-24]` ⭐ **Une règle STRICTE et énonçable bat une règle EXACTE et imprévisible — mais il faut en MESURER le prix d'abord.** Refuser une action de controller sur le seul NOM est plus sévère que TypeScript (qui ne râle que si les signatures divergent : un `trace()` compilait). Avant de trancher, j'ai compté ce que la sévérité coûterait sur tout le dépôt : **un seul renommage**. Le chiffre a fait la décision, pas l'intuition — et une règle qui tient en une phrase (« une action ne reprend pas un nom de `Controller` ») vaut mieux qu'un TS2416 que personne n'anticipe.

- `[1× — 2026-07-26e]` ⭐ **`off` global ≠ `off` de zone — et un motif écrit dans la config ne détecte RIEN.** J'avais désactivé `promise/no-multiple-resolved` partout après avoir corrigé ses 2 vrais cas, en soignant le commentaire qui explique le piège (`error` PUIS `close` d'un `child_process`). Le user : « les prochains ne seront jamais détectés ». Exact — j'avais troqué un filet contre de la prose. Remise en `warn` en production, `off` seulement là où elle n'a jamais rien trouvé (tests, scripts), prix assumé et CHIFFRÉ : 5 faux positifs permanents, vérifiés un par un. **Avant de désactiver une règle, répondre par écrit à « et le PROCHAIN cas ? »** — et préférer toujours la zone la plus étroite (`overrides`) au `off` global.
- `[1× — 2026-07-26e]` ⭐ **Un lot de warnings « cosmétiques » cachait 4 défauts réels que rien d'autre ne voyait.** 24 `no-multiple-resolved` retenus parce qu'ils pouvaient masquer un test complaisant : aucun test en cause, mais un double verdict de promesse (`error` puis `close`), une **ReferenceError en zone morte** qui faisait échouer l'arrêt du superviseur Vite, une méthode morte appelant `open(context)` là où l'interface ne prend aucun argument, et une directive `eslint-disable` inerte depuis la bascule vers oxlint. **Un compteur de lint n'est pas une corvée d'esthétique : c'est un jeu d'hypothèses à confronter au code, une par une.**
- `[1× — 2026-07-26e]` ⭐ **Trier un gros lot se fait sur un critère NET et vérifiable, jamais sur une impression.** 62 `no-shadow` : le tri utile n'était pas « bénin ou pas » mais **« la déclaration masquée est-elle un import ? »**. Réponse mécanique, 6 cas en production — un `path` local masquant `node:path` utilisé 60 lignes plus bas, un `sql` masquant le tag-template de drizzle. Aucun ne cassait rien AUJOURD'HUI ; tous cassaient la prochaine ligne écrite dans cette portée. Les 56 autres restent visibles, la règle reste allumée.
- `[1× — 2026-07-26e]` **Une règle du dépôt se lit dans son ÉNONCÉ, pas dans son slogan.** J'ai attaqué les 54 `any` en visant « zéro `any` » ; le user a rappelé que certains sont obligatoires. L'énoncé réel du module dit « **0 `any` de DETTE** » : 30 étaient structurels (constructeur générique, décorateur dual classe+méthode), déjà justifiés inline. Les convertir aurait cassé l'assignabilité. **Relire la règle avant d'appliquer son résumé** — et quand un `CLAUDE.md` chiffre ce genre d'inventaire (« les 6 restants »), le chiffre est périmé avant le fichier : renvoyer à l'outil.

## 📣 Un signal ajouté pour l'utilisateur : QUI va l'émettre, en vrai ?

- `[1× — 2026-07-24]` ⭐ **Un avertissement correct au mauvais étage devient du bruit.** J'avais posé la notice « messages perdus » dans le `send()` bas niveau : correct, mais Studio (dés)abonne à chaque montage/démontage de vue — l'utilisateur aurait vu « messages perdus » à chaque changement de page pendant une coupure, pour des frames **rejouées au reconnect**. La question du user (« ça a des répercussions sur Studio ? ») a trouvé le défaut. **Réflexe : après avoir ajouté un signal visible, lister les appelants RÉELS qui vont le déclencher** — pas seulement vérifier qu'il dit vrai. Le signal a migré vers la seule voie dont personne n'apprend l'échec autrement (`emit`), et un test verrouille la distinction.

## 🧨 Une commande composée refusée n'exécute RIEN — et le run suivant ment

- `[2× — 2026-07-25]` **Un maillon en échec dans une chaîne `&&` fait mentir la mesure d'après.** (1) Un `cd` relatif refusé a emporté le `cat >>` suivant : tests jamais écrits, « 12 passed » = le compte d'AVANT. (2) Ma contre-preuve dedupe : le `npm run build` du module échouait (tsgo refusait la valeur hors union) DANS la chaîne — le banc d'après mesurait l'ANCIEN dist et « prouvait » que le fix ne changeait rien. **Après tout échec dans une commande composée, considérer que RIEN d'aval n'a tourné** ; vérifier que l'artefact mesuré a bien été RÉGÉNÉRÉ (hash/mtime), pas seulement relancer la mesure.

## 🔁 Deux implémentations d'une même règle (et comment on s'en aperçoit)

- `[1× — 2026-07-24]` ⭐ **La question du user « il faut utiliser celle de http au lieu de réinventer ? » a révélé une duplication que j'étais en train d'AGGRAVER.** Deux contre-pressions WS cohabitaient (`@nodefony/http` configurable et testée, une copie dans le transport realtime), déjà divergentes — 4 Mio contre 1 Mio — et je venais d'ajouter une SECONDE source de configuration au lieu de brancher la première. **Avant d'ajouter un réglage à un mécanisme, chercher si un module plus bas porte déjà la règle** : `grep` le concept, pas le nom de la clé.
- `[1× — 2026-07-24]` **Une règle partagée se type STRUCTURELLEMENT, pas par la classe du fournisseur.** Le transport realtime évite volontairement d'importer `ws` ; la règle a donc été généralisée sur `{ bufferedAmount?, close() }` au lieu d'exiger un `Ws`. Sans ça, l'unification aurait imposé une dépendance à toute la couche.
- `[1× — 2026-07-25]` ⭐ **Un correctif posé sur UN des deux chemins d'une même règle protège le seul chemin qu'on regarde.** `resolve.dedupe` (anti double-React des apps liées) vivait dans le fichier dev GÉNÉRÉ — avec le commentaire du piège — mais pas dans la config BUILD du ViteBuilder : vert en dev, crash au mount en prod (« useContext of null », vécu par le user). Deux générateurs de la même config Vite = deux implémentations d'une même règle ; quand on corrige l'un, `grep` le concept dans l'autre.

## 🕳️ Une garde qui ne peut PAS se déclencher

- `[1× — 2026-07-24]` ⭐ **Deux seuils en cascade dont le premier BORNE ce que le second observe = le second est mort.** La contre-pression jetait les frames au-delà de 1 Mio et fermait la connexion au-delà de 8 Mio ; or jeter empêche la file de croître, donc 8 Mio n'était jamais atteint. Mesuré : 4000 frames poussées à un client qui ne lit pas → 3 servies, **aucune fermeture**. Le client zombie gardait sa connexion pour toujours. **Quand deux seuils se suivent, vérifier que le premier n'empêche pas d'atteindre le second** — et que la condition du second est bien OBSERVABLE après action du premier.
- `[1× — 2026-07-24]` **Ma première correction était fausse aussi, et c'est la mesure qui l'a dit.** J'avais remplacé le second seuil par « N refus CONSÉCUTIFS » ; sur socket réelle la file OSCILLE autour du seuil (refus, drainage partiel, envoi), donc la remise à zéro empêchait encore toute fermeture. Un **solde** (+1 par refus, −1 par envoi) tient. **Une correction non mesurée est une hypothèse.**

## 🔬 Mesurer au bon endroit (sinon le chiffre ment poliment)

- `[1× — 2026-07-24]` ⭐ **Compter côté client ce que le serveur décide ne prouve rien.** « 129 frames reçues sur 400 » semblait démontrer le drop : c'était peut-être un client qui n'avait pas fini de lire. Il a fallu une sonde SERVEUR (route dédiée, état hors instances) pour obtenir `pushed / messagesSent / dropped / readyState`. **Le décideur est le seul témoin fiable — et il faut l'interroger par un AUTRE canal que celui qu'on est en train de saturer.**
- `[1× — 2026-07-24]` **Une sonde peut mentir en lisant le mauvais contexte.** Ma route GET relisait les réglages du serveur WS sur un contexte HTTP, qui n'en a pas : elle affichait « protection désactivée » pendant que le transport refusait 272 frames. Capturer la valeur **là où elle est réellement lue** (ici : au handshake), pas là où c'est commode.
- `[1× — 2026-07-24]` **Le banc a échoué trois fois pour trois raisons de DÉCOR, aucune n'étant le code testé** : un canal homonyme d'une action (qui héritait donc de sa politique fermée), un `dist` non rebuildé, et deux serveurs WS (`websocket` ws:// / `websocketSecure` wss://) dont je configurais le mauvais. **Avant de soupçonner le mécanisme, faire dire au serveur ce qu'il a RÉELLEMENT lu.**

## 🧠 Le contexte de l'agent — une règle lue s'érode, une règle affichée agit

- `[1× — 2026-07-24]` ⭐ **Mesuré en chaîne A/B/C au banc devkit (haiku)** : (A) AGENTS.md LU par l'agent → CRUD recomposé de mémoire quand même ; (B) prose durcie → zéro effet ; (C) la MÊME règle déplacée dans le `CLAUDE.md` AUTO-CHARGÉ → `create entity` lancé. Une lecture est un résultat d'outil qui recule dans la fenêtre et peut être compacté ; le fichier auto-chargé est réinjecté à chaque tour avec statut d'instruction. **Ce qui doit agir au moment d'ÉCRIRE vit dans le fichier auto-chargé ; le reste est une carte qu'on consulte.**
- `[1× — 2026-07-24]` **Instruction d'ACTION ≠ instruction de COMPORTEMENT.** « Lis AGENTS.md » est satisfaite par UNE lecture (puis s'épuise) ; « avant d'écrire un fichier, vérifie qu'un générateur le produit » est ré-évaluée à chaque décision. Sur un modèle léger, seule la seconde tient.

## 📏 Mesure & bancs

- `[1× — 2026-07-25d]` ⭐ **Un outil de mesure doit prouver qu'il sait TROUVER avant qu'on croie son « rien trouvé ».** Mon scan de secrets sur `git log -p` a rendu « 0 hit » : `rg` avait croisé un octet nul, déclaré l'entrée binaire et **abandonné le reste en silence** (`-a` corrige). Le tell était gratuit et je l'avais sous la main : la clé privée du dépôt EST dans l'historique et faisait partie des motifs — son absence dénonçait l'outil, pas le dépôt. **Tout scan qui conclut « propre » doit contenir un motif dont on SAIT qu'il existe.**
- `[1× — 2026-07-25d]` ⭐ **Un compteur qui agrège des transcripts doit dédupliquer AVANT de sommer.** Les JSONL de session répètent la même réponse à plusieurs lignes : 38 794 doublons sur 71 468, soit **plus de la moitié**. Sans dédup (par `message.id`), tout total est ~2× trop haut — et c'est invisible, le chiffre reste plausible. Même famille : un coût recalculé aux tarifs d'une génération précédente était **3× trop haut** ; un montant en devise se périme, une **proportion** non.
- `[1× — 2026-07-25d]` **La branche par défaut du dépôt n'est pas celle où l'on travaille.** Tout le travail vit sur `claude-ts` (616 commits d'avance) ; GitHub montre `main`, vieille d'un mois. Un fichier qui doit être VU par un visiteur ou détecté par la plateforme (`SECURITY.md`, README, badges) n'existe pour eux que sur la branche par défaut. À vérifier avant de rendre un dépôt public, pas après.
- `[1× — 2026-07-24]` ⭐ **Un banc de découvrabilité se joue au modèle le plus DÉFAVORABLE** (décision user) : un modèle fort compense les trous du kit en devinant juste — on mesure alors son intelligence, pas l'outillage. Corollaire : le modèle est une **variable du décor** → figé par env + RELEVÉ dans le rapport (ce qui a tourné, pas ce qui a été demandé).
- `[1× — 2026-07-24]` **Un agent JUGÉ peut committer lui-même en cours de tâche** : un juge qui diffe `HEAD~1` rate tout son travail. Base du diff = le commit de HARNAIS précédent. Et `cmd | tee log` avale l'exit code du gate — le banc FAIL affichait exit 0.
- `[1× — 2026-07-24]` **Une sonde NÉGATIVE passe aussi quand l'exigence est abandonnée en silence** : « pas de 409 artisanal » était verte chez haiku… qui n'avait jamais implémenté le 409 (et avait supprimé les tests « redondants »). Une sonde inversée doit être appariée à une sonde FONCTIONNELLE (frapper la route, attendre le 409). Petit frère : `$` sans flag `m` sur une liste multi-lignes = sonde jamais vraie.
- `[1× — 2026-07-25]` ⭐ **Une sonde négative qui scanne les FICHIERS ENTIERS recale un agent irréprochable.** Au banc T3, haiku avait tout bon (façade partout, 0 `new WebSocket` écrit) — mais il avait TOUCHÉ l'e2e généré, porteur du `new WebSocket` légitime du test echo → sonde rouge. **Un interdit se juge sur les lignes AJOUTÉES du diff**, jamais sur le contenu des fichiers touchés ; les sondes positives, elles, peuvent rester sur le contenu (un fichier généré compte à juste titre).
- `[1× — 2026-07-25]` **Un run FAIL d'un banc n'est pas un verdict — lire le transcript d'abord.** Le premier run T3 affichait 3 sondes rouges et 0 fichier touché : l'agent était sorti sur un 429 « session limit » sans avoir travaillé. Conclure sur la découvrabilité à partir d'un agent qui n'a pas tourné aurait été un faux diagnostic complet ; le `terminal_reason` du transcript tranche en une lecture.
- `[1× — 2026-07-23]` **Un banc qui ne vérifie pas que le travail a EU LIEU mesure la vitesse à laquelle on échoue** (vécu 2× le même jour).
- `[1× — 2026-07-22]` **Pour un gain d'ÉTAGE, banc d'étage** : le banc système (variance ×3) ne peut pas trancher quelques dizaines de % — il prouve un comportement (fan-out, injection, mémoire sous rafale). Le micro-banc écrit en 10 min a donné la réponse.
- `[1× — 2026-07-22]` **Éteindre soi-même une infra en cours de session rend des tests silencieusement verts.**
- `[1× — 2026-07-23]` **« Je n'ai pas la mesure » voulait dire « je n'ai pas CHERCHÉ la mesure »** ; et **vérifier l'hypothèse commode au lieu de la défendre** (4 testées en une session, 2 fausses).

## 🎨 Front / Studio (chaud)

- `[1× — 2026-07-23]` **En HMR, l'import passe AVANT le JSX qui l'utilise** : esbuild ne vérifie pas les identifiants → Vite sert une version cassée sans le dire. Le typecheck du module est le seul juge.
- `[1× — 2026-07-23]` **Un schéma se dessine à sa taille NATURELLE, puis se contraint** (un `viewBox` étiré à 100 % donne des textes de 8 px).
- `[1× — 2026-07-23]` **Avant d'écrire un écran explicatif, fixer le LECTEUR** (« quelqu'un qui ne connaît pas le mot backplane ») au même titre que les blocs : 3 des 4 refontes venaient de là. Le cahier des charges figé doit porter le **niveau de langue** et la **taille des dessins**, pas seulement le contenu.
- `[1× — 2026-07-13]` **Une modif front Studio ne se voit dans une app `--link` (ui static) qu'après `npm run build:ui`** — le HMR ne concerne pas le `dist/frontend` servi.

## 🔤 Nommer

- `[1× — 2026-07-22]` **Un nom de classe qui décrit le premier cas branché égare son propre auteur** (`SessionRealtimeAuthenticator` promeut TOUTE identité résolue par le firewall).
- `[1× — 2026-07-22]` **Un type figé en dur est une décision d'autorisation déguisée** (`type = "session"` faisait passer un agent JWT pour un humain).
- `[2× — 2026-07-14]` **DEUX noms pour UN concept = un bug qui attend** (`orm:` côté entité vs `connectors:` côté config, pour le même objet).
