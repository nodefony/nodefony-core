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

## 🔢 La nomenclature d'un plan appartient à son lecteur

- `[1× — 2026-07-24]` ⭐ **Trois échelles empilées (lots `devkit N`, vagues `V1-V5`, décisions `T1-T10`) ont PERDU le user** (« je ne veux pas 15 sous-lettres »). Règle : **UNE seule échelle d'identifiants publics** (ici `devkit S<n>`, alignée sur la famille de lots existante) ; les décisions/justifications se NOMMENT (« Refuser avant d'écrire »), ne se numérotent JAMAIS — un numéro n'est dû que s'il sera cité dans un commit ou une demande de session. Corollaire : un identifiant court réutilisé entre kits (S5 du kit ORM vs `devkit S5`) exige le préfixe.
- `[1× — 2026-07-24]` **Une directive floue arbitrée sans reformuler l'INTENTION coûte 2 allers-retours.** « Entity beaucoup mieux » : j'ai renforcé le REST généré ; le user visait le formulaire STUDIO contextuel (types selon le dialecte). Reformuler l'objet CONCRET (un exemple) d'une directive avant de décider où elle vit dans le design.

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

## 📣 Un signal ajouté pour l'utilisateur : QUI va l'émettre, en vrai ?

- `[1× — 2026-07-24]` ⭐ **Un avertissement correct au mauvais étage devient du bruit.** J'avais posé la notice « messages perdus » dans le `send()` bas niveau : correct, mais Studio (dés)abonne à chaque montage/démontage de vue — l'utilisateur aurait vu « messages perdus » à chaque changement de page pendant une coupure, pour des frames **rejouées au reconnect**. La question du user (« ça a des répercussions sur Studio ? ») a trouvé le défaut. **Réflexe : après avoir ajouté un signal visible, lister les appelants RÉELS qui vont le déclencher** — pas seulement vérifier qu'il dit vrai. Le signal a migré vers la seule voie dont personne n'apprend l'échec autrement (`emit`), et un test verrouille la distinction.

## 🧨 Une commande composée refusée n'exécute RIEN — et le run suivant ment

- `[1× — 2026-07-24]` **Un `cd` relatif refusé par le hook a emporté le `cat >> …` qui suivait dans la même ligne.** Mes tests n'ont jamais été écrits ; j'ai relancé la suite, lu « 12 passed » et cru qu'ils passaient. Le compte était celui des tests d'AVANT. **Après un refus d'outil sur une commande composée, considérer que RIEN n'a tourné** — et vérifier le nombre de tests attendu, pas seulement la couleur. Corollaire : écrire un fichier par l'outil d'édition, jamais par heredoc dans un enchaînement.

## 🔁 Deux implémentations d'une même règle (et comment on s'en aperçoit)

- `[1× — 2026-07-24]` ⭐ **La question du user « il faut utiliser celle de http au lieu de réinventer ? » a révélé une duplication que j'étais en train d'AGGRAVER.** Deux contre-pressions WS cohabitaient (`@nodefony/http` configurable et testée, une copie dans le transport realtime), déjà divergentes — 4 Mio contre 1 Mio — et je venais d'ajouter une SECONDE source de configuration au lieu de brancher la première. **Avant d'ajouter un réglage à un mécanisme, chercher si un module plus bas porte déjà la règle** : `grep` le concept, pas le nom de la clé.
- `[1× — 2026-07-24]` **Une règle partagée se type STRUCTURELLEMENT, pas par la classe du fournisseur.** Le transport realtime évite volontairement d'importer `ws` ; la règle a donc été généralisée sur `{ bufferedAmount?, close() }` au lieu d'exiger un `Ws`. Sans ça, l'unification aurait imposé une dépendance à toute la couche.

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
