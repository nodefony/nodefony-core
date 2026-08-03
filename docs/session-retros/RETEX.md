# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées**. Le skill `nodefony-session` le **lit au START/RESUME**
> et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.**
>
> **🔴 SEUIL DE GRADUATION — il porte sur le THÈME, pas sur le compteur d'un bullet.** Un thème qui
> atteint **~5 frictions distinctes** est démontré et part en `feedback_*`, puis disparaît d'ici.
> Le compteur `[N×]` ne sert qu'à repérer une friction qui se répète à l'identique — il ne
> déclenche rien. _Pourquoi ce changement (2026-08-02) : l'ancienne règle « ≥3× » n'a JAMAIS
> déclenché en 135 frictions — chaque session écrivait un bullet neuf au lieu d'incrémenter, si
> bien qu'un thème à 35 frictions en dix jours n'a jamais été gradué._
>
> **Taille bornée : ~1 écran.** Snapshots complets avant coupe :
> `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## 🧬 Appliquer un patron N fois n'est PAS le factoriser

- `[1× — 2026-08-03b]` 🔴 **J'ai répliqué « le store déclare, le data plane demande » sur quatre
  ressources en croyant appliquer « 1 règle = 1 implémentation » — et j'ai produit 15 concepts
  pour un.** Quatre noms de méthode (`sortableSessionFields`, `sortableUserFields`,
  `sortableTokenFields`, `sortableWebhookFields`), quatre redéclarations de la même propriété avec
  quatre TSDoc, **trois copies du même `map`** de traduction. C'est le USER qui l'a vu, en une
  question : « il faut 15 méthodes de tri ? ». Le critère qui tranche, et qui manquait :
  **l'ALGORITHME se factorise (un exemplaire), la FORME s'impose par une interface, la DONNÉE se
  déclare par ressource.** Le signe distinctif d'une règle dupliquée dans un fichier de
  vocabulaire : il contient une FONCTION au lieu d'une liste.
- `[1× — 2026-08-03b]` **Le refactor a trouvé ce que la réplication avait caché** : quatre stores
  ne filtraient pas l'ordre du tout (ils triaient sur un champ jamais déclaré, là où les autres
  refusaient), et le queryKit portait DEUX fonctions `ORDER BY` — dont celle que je venais
  d'écrire. Factoriser n'est pas cosmétique : c'est ce qui met les divergences côte à côte.

## 🧾 Un paramètre ACCEPTÉ PUIS JETÉ est pire qu'un paramètre refusé

- `[1× — 2026-08-03c]` 🔴 **Vingt lectures de filtre recopiées faisaient toutes la même chose :
  rendre la collection ENTIÈRE quand le client s'était trompé.** `?revoked=oui` posait le filtre à
  `undefined`, `?category=zzz` tombait hors allowlist, `?enbaled=true` n'existait pour personne —
  et dans les trois cas la réponse était une page non filtrée, que le client lit comme le RÉSULTAT
  de son filtre. Le pire cas est un journal d'audit : rendu entier à qui demandait
  `?outcome=deneid`, il se lit « aucun incident ». Le TSDoc appelait ça « permissif — l'endpoint est
  déjà gardé », ce qui confond **autorisation** (qui a le droit de lire) et **honnêteté** (ce que la
  réponse prétend être). Le refus de l'inconnu n'est pas une sévérité, c'est la seule façon de ne
  pas mentir.
- `[1× — 2026-08-03c]` ⭐ **Le critère qui range une capacité au STORE ou à la RESSOURCE** : le tri
  est une capacité de backend (Redis ne trie pas ⇒ `sortableFields` par store), un filtre inscrit
  dans un `IXListQuery` est une OBLIGATION de tous les backends (Redis l'honore inline dans son
  batch `SCAN`). Répliquer le patron du tri sur les filtres aurait refait l'erreur de la veille —
  déclarer par store aurait laissé croire qu'un filtre du contrat est facultatif.
- `[1× — 2026-08-03c]` **Une spec DÉCLARATIVE peut porter la validation ET le type** : `as const
satisfies IFilterSpec` + un générique `<const S>` fait dériver `{revoked?: boolean, category?:
"auth"|…}` de la donnée elle-même — les `as AuditCategory` des data planes disparaissent, et une
  valeur ajoutée à une énumération met à jour les deux d'un seul geste.
- `[1× — 2026-08-03d]` 🔴 **La tolérance survivait dans la LECTURE, sous le refus qu'on venait
  d'écrire.** `one()` — dupliqué dans `pageQuery.ts` et `pageFilters.ts` — prenait la première
  valeur d'une clé répétée et jetait les autres : `?actor=a&actor=b` rendait une page filtrée sur
  `a` seul, exactement le mensonge que le fichier bannissait dix lignes plus haut. **Deux tests la
  codifiaient**, écrits la veille par la même main que le refus. La leçon n'est pas « il restait un
  cas » : c'est qu'une doctrine s'applique d'abord aux fonctions qu'on ne regarde plus.
- `[1× — 2026-08-03d]` ⚠️ **Une échappatoire au refus (`accepts`) redevient le péché si on la pose
  au mauvais endroit.** Le gabarit allait déclarer `accepts: ["include"]` sur `list` — or `include`
  est lu par `show`. Un paramètre listé comme « traité par l'appelant » et jamais lu redevient un
  paramètre accepté puis jeté, avec en plus le confort d'avoir l'air correct. Toute clé mise dans
  une liste d'exemption est un ENGAGEMENT à la lire, vérifiable en une recherche.

## 🎛️ Une CAPACITÉ appartient au store branché — la coder au front, c'est deviner

- `[1× — 2026-08-03d]` ⭐ **Le front ne décide pas qu'une colonne est triable, il le DEMANDE.** Les
  4 tables Studio codaient `sortable: true` en dur ; or le tri est publié par le store branché à
  l'exécution — Redis n'en offre aucun (énumération par `SCAN`), l'annuaire en mémoire ignore
  `createdAt`, une base SQL le connaît. La même page rend donc 200 ou 400 selon le déploiement, et
  rien côté front ne peut le prévoir. Réponse : `IAdminEndpoint.page` publie `{sortable, filters}`
  dans le catalogue **que la console charge déjà** — zéro requête en plus, là où un endpoint
  `capabilities` par ressource en aurait coûté une par vue.
- `[1× — 2026-08-03d]` **Une capacité se publie en FONCTION, jamais en constante figée** : le store
  peut n'être branché qu'après le montage des routes, et un service peut devenir indisponible. Une
  valeur capturée une fois ment dans les deux cas — d'où l'évaluation à chaque lecture du catalogue,
  et un test qui change le backend entre deux lectures pour le prouver.
- `[1× — 2026-08-03d]` 🔴 **Passer une table en mode serveur casse ses AGRÉGATS, en silence.** Les
  4 vues calculent leurs cartes (`countUsers`, `countByAuth`…) sur la liste entière chargée ; avec
  une page de 25 lignes, « 12 actifs » devient un compte de page présenté comme un total. Le coût
  réel d'une bascule client→serveur n'est pas la prop `mode`, c'est le sort de tout ce que la vue
  dérivait de la collection complète — à repérer AVANT de promettre la bascule.

## 🥫 Un outil qui ne sert pas le dépôt qui le publie n'est éprouvé par personne

- `[1× — 2026-08-03b]` 🔴 **On unifie le dépôt, et le GÉNÉRATEUR continue de distribuer l'ancien
  dialecte.** Cinq parseurs de page supprimés du dépôt… pendant que le gabarit `create entity`
  produisait `?sort=-champ` (JSON:API) avec son propre `Number(limit) || 25`, et **ignorait** un
  champ non triable là où le framework le REFUSE. Chaque application générée en héritait. Un
  gabarit n'est pas du code du dépôt : c'est du code **distribué**, donc le dialecte qu'il porte
  gagne. Réflexe : après avoir unifié quoi que ce soit, `rg` dans `templates/` et dans les skills
  publiés AVANT de considérer le geste fini.

- `[1× — 2026-08-03c]` 🔴 **Un gabarit distribue aussi ses DÉPENDANCES.** Le test rendu par
  `create controller --kind realtime` importait `reflect-metadata`, qu'aucune application générée ne
  déclare — le polyfill est chargé par `@nodefony/realtime` lui-même. Invisible partout où le
  hissage npm sauve la résolution, rouge en `--link` et sous pnpm. La classe de défaut se contrôle
  d'un balayage statique (imports bare des `.tpl` ∩ manifestes générés), pas d'une relecture.

- `[1× — 2026-08-02h]` 🔴 **Un agent ÉTRANGER a trouvé en 15 minutes et 0,04 $ ce que 30 tâches de
  banc et deux passes complètes n'avaient jamais vu** — trois défauts produits, dont un qui rendait
  `create module --frontend` inutilisable POUR TOUT NOM, sur la commande même que l'`AGENTS.md`
  généré annonce. Le banc interne ne teste pas ce chemin, et il est juge et partie. Le rapport
  coût/trouvailles n'est pas comparable : **instruire une tâche instable coûte ~1 $ pour conclure
  « variance » ; un agent tiers sur une tâche métier coûte 4 centimes et rapporte des bugs réels.**
- `[1× — 2026-08-02h]` 🔴 **Une commande peut échouer sur ce qu'elle vient ELLE-MÊME d'écrire.**
  `create module --frontend` déléguait à deux scaffolds en leur passant le MÊME nom ; le second
  refusait la classe que le premier venait d'enregistrer, avec un message (« déjà référencé —
  choisis un autre nom ») qui envoyait chercher un conflit inexistant. L'agent a essayé quatre
  noms puis `--force`. **Un message d'erreur juste sur les faits peut être faux sur la CAUSE.**
- `[1× — 2026-08-02h]` **Un message qui réclame DEUX gestes dont un est déjà fait égare.**
  « ajoute la dep + au manifeste » : le manifeste l'avait déjà, l'agent est parti fouiller la
  config. Un refus doit nommer ce qui manque VRAIMENT, ici et maintenant.

- `[2× — 2026-08-02]` 🔴 **Quatre défauts sur cinq d'une soirée venaient des GABARITS**, aucun
  visible tant que le dépôt n'utilisait pas sa propre commande : un module né du scaffold sans
  arête de build (forge rouge sur quatre workflows), une erreur de config re-jetée sans sa `cause`,
  deux angles morts du banc. **C'est en commitant le premier paquet réellement produit par
  `create module` que la forge a vu ce que trois sessions de tests n'avaient pas vu.**
- `[1× — 2026-08-01d]` 🔴 **J'ai commencé à écrire à la main le squelette que notre propre commande
  produit** — et le skill avait ENTÉRINÉ l'écart (« deux scaffolders, c'est voulu »). Le geste
  juste quand un outil maison ne couvre pas le cas courant : **le lancer D'ABORD pour voir ce qu'il
  rend** (`--dry-run` : 80 % du chemin était là, en 3 s).
- `[1× — 2026-08-01d]` **Un gabarit dit « remplace ceci par le tien », et une garde exige que ce
  soit resté intact.** Motif à reconnaître : toute garde écrite en LISANT la sortie de son propre
  exemple.

## 📣 Une commande MAISON est filtrée par la familiarité, pas par la position

- `[1× — 2026-08-02]` 🔴 **Quatre gates dans le MÊME bloc, un écart d'usage de 1 à 9.** La position
  dans le fichier n'explique rien : l'agent lance ce qu'il connaît d'ailleurs (`npm test` 44/63) et
  ignore le verbe maison voisin. Un verbe propriétaire a besoin d'un **exemple d'usage**, pas d'une
  meilleure place.
- `[1× — 2026-08-02e]` **Comparer les scripts npm du DÉPÔT à ceux du gabarit d'app** trouve les
  verbes qu'on a oublié de livrer à l'utilisateur.

## 🛡️ Mesurer qu'on POSE une garde ne dit rien sur celle qu'on RETIRE

- `[1× — 2026-07-31]` 🔴 **Le témoin d'un « ne pas affaiblir » doit être HORS de l'énoncé** — sinon
  l'agent le lit et le respecte pour de mauvaises raisons. Et **l'échantillon vertueux d'une sonde
  de sécurité se copie du DÉFAUT du produit**, jamais réécrit à la main.
- `[1× — 2026-07-31d]` 🔴 **Poser un exemple ACTIF crée une surface d'affaiblissement neuve** :
  chaque garde qu'on montre est une garde que quelqu'un saura retirer.

## 🤖 Piloter un agent TIERS : ce qui BLOQUE, et ce qui MENT

- `[1× — 2026-07-29]` 🔴 **Sans TTY, un CLI agentique peut LIRE stdin jusqu'à EOF** et se figer.
- `[1× — 2026-07-31d]` 🔴 **Un format de sortie « à la fin » perd TOUT quand la fin n'arrive pas** ;
  et **une borne annoncée n'est pas une borne** (la doc de `vibe` dit elle-même que le coût
  rapporté est indicatif — seul le nombre de TOURS borne réellement).
- `[1× — 2026-07-31d]` ⭐ **La valeur d'un agent tiers n'est pas sa force, c'est son ÉTRANGETÉ** :
  il ne connaît ni nos skills ni nos conventions, donc il mesure ce que l'app dit VRAIMENT.

## 📦 Surface npm & publication (chantier release en cours)

- `[1× — 2026-08-02i]` 🔴 **Un front CONSTRUIT avant publication n'a plus AUCUNE dépendance
  d'exécution** — Studio faisait télécharger 190 Mo de paquets directs (React, Mantine, mermaid,
  icônes) à quiconque l'installe, pour du code que personne n'exécute. Deux conditions
  **cumulatives** l'autorisent : Vite a inliné le framework dans les assets livrés, **et** les
  sources ne partent pas dans l'archive (`files`) — donc rien à recompiler chez le consommateur.
  Si l'une saute, les deps redeviennent obligatoires. La faute ne se paie **nulle part** en
  développement : les deux champs s'installent pareil, typecheck vert, tests verts ; elle ne se
  constate que sur le tarball.
- `[1× — 2026-08-02i]` **`npm pkg set` SUPPRIME une clé dont l'objet devient vide** —
  `"dependencies": {}` disparaît sans un mot, et la convention-frère du dépôt la porte.
- `[1× — 2026-08-02g]` 🔴 **Un outil de BUILD ne se déclare JAMAIS en `peerDependencies`** — même
  « optionnelle » : la devDependency de l'app la SATISFAIT, donc `npm prune --omit=dev` la garde.
  Test qui tranche : _le paquet importe-t-il l'outil au RUNTIME ?_
- `[1× — 2026-08-02g]` **Un décor de test FIGÉ vieillit à côté de ce qu'il est censé prouver** — le
  générer depuis le TARBALL révèle en plus ce qu'aucun test du dépôt ne voit (un fichier oublié
  dans `files`).
- `[2× — 2026-07-24]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.**
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE** — la
  vérifier avant de le retirer. Et `publishConfig.exports` n'est PAS appliqué par npm (pnpm/yarn).

## 📄 Un fichier « pointeur » se remplit tout seul, et une livraison n'entraîne pas sa doc

- `[1× — 2026-08-02f]` 🔴 **Un lot livré ne met pas à jour la doc du paquet qu'il justifie** — 13
  affirmations fausses sur 15 dans la doc d'un module dont le lot venait d'être livré.
- `[1× — 2026-08-02f]` **Le `CLAUDE.md` généré annonçait « les trois réflexes » en en portant
  quatre** : un fichier pointeur grossit sans que personne ne relise ce qu'il annonce.

## 🧩 Une capacité arrive AVEC sa tâche, sinon son absence de mesure ressemble à un rejet

- `[1× — 2026-08-02]` 🔴 **La règle du banc enfreinte par ses propres auteurs** : trois verbes
  livrés sans aucune tâche pour les mesurer. **Concevoir la tâche a trouvé un défaut que la
  relecture n'avait pas vu.**
- `[1× — 2026-08-03]` 🔴 **Une capacité se PERD dans un décorateur, et le refus qui en découle
  a l'air légitime.** `RevocationGuardStorage` relayait `listPage`, `listAll`, `countSessions` —
  mais pas le `sortableFields` que je venais d'ajouter. Le décorateur étant posé en production
  dès qu'une révocation est possible, le tri aurait été refusé **partout**, y compris sur une
  base qui sait parfaitement trier ; et le 400 rendu ressemblait à un refus normal. Motif à
  reconnaître : **tout wrapper qui ré-expose sélectivement une interface est un point de perte
  silencieuse** — la nouvelle capacité doit être ajoutée AU DÉCORATEUR dans le même geste, et
  c'est un banc de contrat partagé qui l'attrape, jamais une relecture.

## 🕳️ Un filet anti-régression ne couvre que ce qu'on y a MIS, et il ne le dit pas

- `[1× — 2026-08-01]` 🔴 **Le dépistage du banc couvrait 7 tâches sur 28 et rendait « rien à
  signaler »** — un filet partiel se lit comme un filet.
- `[1× — 2026-08-03c]` 🔴 **Le typecheck du cœur N'INCLUT PAS `src/tests`** — j'ai écrit un test
  d'assertions de TYPES (« le générique rend bien `boolean`, pas `any` »), lancé `tsgo --noEmit`,
  vert. Il ne prouvait rien : `tsconfig.json` **exclut** `src/tests/**`, et c'est
  `tsconfig.tests.json` (2ᵉ maillon du script `typecheck`) qui les couvre. Constaté en cassant le
  type exprès — `tsgo --noEmit` restait vert, `-p tsconfig.tests.json` sortait l'erreur. **Un gate
  neuf se lance sur la CONFIG qui voit le fichier**, et la seule façon de savoir laquelle c'est,
  c'est de casser le fichier.
- `[1× — 2026-08-03d]` 🔴 **Une suite de paquet frère peut être VERTE sur l'ancien code du cœur.**
  J'ai modifié `pageQuery.ts` (source), lancé `security` → 914 verts, commité. Au rebuild suivant,
  un test tombait : `security` importe `nodefony` depuis son **dist**, que je n'avais pas rebâti —
  la suite avait éprouvé la version d'avant. Le typecheck ne le voit pas (les `types` pointent la
  SOURCE, l'`import` pointe le `dist`). Toute modif du cœur se rejoue chez ses consommateurs
  **après** `npm run build`, jamais avant. → [[feedback_prove_on_received_artifact]]
- `[1× — 2026-08-03c]` **Un fichier NEUF ne se prouve pas débranché par `git diff --stat`** — il
  est untracked, le diff est vide, et l'on croirait n'avoir rien débranché. Le contrôle qui marche
  dans les deux cas : `grep` du débranchement dans le fichier (`if (false &&`).
- `[1× — 2026-08-03b]` 🔴 **Un test qui BOUCLE sur une liste vide passe au vert sans rien lire.**
  « chaque champ déclaré est effectivement honoré » itérait sur `sortableFields` : store qui ne
  déclare rien → zéro tour de boucle → ✓. Vu SEULEMENT parce que j'avais débranché le câblage pour
  regarder les rouges — les cinq autres tombaient, celui-là restait vert. Toute boucle d'assertions
  a besoin d'une borne (`assert(liste.length > 0)`) AVANT d'itérer. Vaut aussi pour un `filter`
  qui rendrait zéro élément.
- `[1× — 2026-08-03b]` **Comparer un tri à `[...x].sort()` fait dépendre le test de la
  COLLATION** — celle de JS n'est pas celle de SQLite, ni celle de PostgreSQL (tirets, casse).
  L'invariant qui tient partout et malgré les ex æquo : **« DESC rend l'exact renversé de ASC »,
  sur les VALEURS et non sur les identifiants.**
- `[1× — 2026-08-02j]` 🔴 **Le contrôle anti-recollement eta ne regarde que les `.ts`** — or le
  défaut (« tag en FIN de ligne avale le saut suivant ») frappe pareil un YAML, un `.env`, un
  Markdown. Reproduit **trois fois** dans la même passe sur des gabarits non couverts, chaque fois
  invisible aux assertions de contenu. Un contrôle de FORME doit porter sur la classe de défaut,
  pas sur l'extension où on l'a rencontré la première fois.

## 🔀 DEUX appels au même traducteur, un seul informé — le second annule le premier

- `[1× — 2026-08-03]` 🔴 **Le même handler appelait `parsePageQuery` deux fois** : une fois avec
  l'allowlist de tri, une fois sans (via un helper hérité du lot précédent). Le second refusait
  en 400 ce que le premier venait d'accepter. **Aucun test unitaire ne pouvait le voir** — les
  deux appels sont corrects isolément, c'est leur COEXISTENCE qui est le défaut ; seul le wire
  l'a montré. Ce qui a tranché en un cycle : **instrumenter le point de passage** (afficher la
  valeur réelle au goulot) après trois hypothèses fausses d'affilée — cache turbo, dist périmé,
  mauvaise instance. Le signe distinctif était dans les messages : deux champs refusés avec
  **deux messages différents** disaient qu'il y avait deux chemins de refus.
- `[1× — 2026-08-03]` **Corollaire d'écriture** : quand un lot introduit un traducteur unique,
  le lot suivant doit SUPPRIMER les helpers qu'il remplace, pas cohabiter avec eux. Un helper
  laissé en place n'est pas du code mort — c'est un second chemin qui décide.

## 🎭 Le DÉCOR d'un banc doit être celui de l'utilisateur, sinon la mesure ment sur son objet

- `[1× — 2026-08-02h]` 🔴 **Le décor privait l'agent des skills que l'`AGENTS.md` lui ANNONCE.**
  Les 4 skills étaient bien dans `node_modules/@nodefony/devkit/skills/`, `.agents/skills/` était
  absent, et le texte généré disait « `ls .agents/skills/` les liste ». Le banc envoyait donc
  l'agent sur un dossier vide. **Le produit était innocent** : `create app` pose les pointeurs,
  mais le banc l'appelle AVANT d'installer les tarballs — à cet instant il n'y a rien à pointer,
  et personne ne repasse. Réflexe : **une capacité livrée se CONSTATE dans le décor**, pas dans le
  code qui la pose.
- `[1× — 2026-08-02h]` 🔴 **Un FAIL minoritaire figé peut n'être qu'un tirage.** T16, donnée
  « seul vrai défaut produit restant » à 1/3, rend **3/3 sans qu'aucun commit de l'intervalle ne
  touche son sujet**. Remesurer coûte moins cher qu'instruire — et l'ordre inverse fait chercher
  la cause d'un défaut qui n'existe pas. À appliquer aux quatre instables à 2/3.

## 📏 Une sonde de PERFORMANCE juge la machine avant de juger le code

- `[1× — 2026-08-02f]` ⭐ **Juger la FORME de la courbe, pas la durée** : doubler l'entrée doit
  doubler le temps. Un seuil de durée rouge sur UNE seule case d'une matrice de six désigne la
  machine, pas le code. Chauffer avant de mesurer, prendre le **MINIMUM** de N relevés (une
  préemption ne peut qu'AJOUTER du temps). ⚠️ Le minimum n'écarte qu'une préemption PONCTUELLE.
- `[1× — 2026-08-02f]` ⭐ **Avant d'accuser la mesure, lire la STRUCTURE — et inversement** : un
  scan sans retour arrière ne PEUT pas être quadratique, le chronomètre avait tort.

## ⚖️ Documenter un geste que l'OUTIL punit ne change rien

- `[1× — 2026-08-01]` 🔴 **Trois correctifs, un seul a compté — et ce n'était pas le mieux écrit.**
  Un geste que la chaîne d'outils sanctionne ne se rattrape pas par de la prose.
- `[1× — 2026-08-01]` **Un test qui pousse à désarmer une garde est pire qu'un test absent.**

## 🔇 Un mode machine qui coupe le journal coupe aussi les erreurs

- `[1× — 2026-07-26]` ⭐ **`--json` rendait une commande MUETTE sur échec** : 0 octet, stderr vide,
  code 1. Un mode machine doit garder un canal d'erreur.

## 🔎 Ce que le journal des commits CACHE

- `[1× — 2026-07-30]` 🔴 **Un correctif logé dans un commit au sujet étranger est invisible, et on
  le réécrit.** Deux trous « ouverts » d'un kit étaient corrigés depuis.

## 📦 npm : un arbre réparé à la MAIN n'est pas une garantie

- `[1× — 2026-07-30]` 🔴 **Un `node_modules` remis droit à la main tient jusqu'au prochain `npm
install`.** Et `npm run build` vert ne dit rien du chemin réel qu'emprunte l'utilisateur.
- `[1× — 2026-08-02i]` 🔴 **`npm outdated --workspaces --include-workspace-root` ne montre PAS les
  dépendances de la RACINE.** Il a rendu « 0 périmé » alors que `turbo` et `typescript` attendaient —
  c'est le user qui l'a vu, pas moi. **`npm outdated` NU les montre.** Corollaire qui coûte plus
  cher : **un sous-agent hérite de la cécité de la commande qu'on lui DICTE** — son rapport était
  exhaustif sur un périmètre amputé, et rien dans sa forme ne le signalait. Dicter la commande,
  c'est dicter l'angle mort.
- `[1× — 2026-08-02i]` **Une dépendance déclarée à N endroits ne se monte pas à N−1.** `tsx` vivait
  dans 3 workspaces **et** à la racine ; n'aligner que les workspaces a créé 3 copies imbriquées à
  côté de l'ancienne restée hissée. Relever TOUS les sites déclarants avant d'éditer le premier.
- `[1× — 2026-08-02i]` 🔴 **`test:all` laisse son SERVEUR allumé, et il pollue tout rejeu
  d'intégration.** Dix rouges sur 7393 : rejoués un à un, **aucun ne tenait au diff** — un timeout
  de 2 s sous la charge de 19 espaces de travail (redis), cinq tests d'environnement, et trois
  `session-revocation` qui disaient « expected +0 to equal 1 », c'est-à-dire un DELTA de sessions
  nul parce que le serveur portait l'état de la passe précédente. `nodefony stop` + `start.sh` →
  vert. **Un rouge d'intégration se rejoue sur un décor NEUF avant d'être qualifié**, et le rejeu
  en isolation ne suffit pas s'il tape le même serveur sale.

## 🧭 La PRÉMISSE d'une question se vérifie avant d'en chercher la cause

- `[1× — 2026-08-01f]` 🔴 **« Depuis les derniers changements, les agents ne sont plus appelés »** —
  la prémisse était fausse ; chercher la cause d'un fait inexistant coûte une séance.

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib**, faute d'avoir ouvert le source.
- `[1× — 2026-08-02j]` 🔴 **Une affirmation écrite dans un GABARIT est DISTRIBUÉE** — j'ai écrit
  dans le `.env` généré « pas de commentaire en fin de ligne, la valeur court jusqu'au saut » :
  faux, `node:util.parseEnv` coupe au `#` (prouvé en une commande). Un commentaire de gabarit part
  chez tous ceux qui génèrent une app — il se vérifie comme du code, jamais « au raisonnable ».

## 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance

- `[1× — 2026-08-02g]` 🔴 **`timeout` n'existe pas sur macOS** — un chien de garde s'écrit
  `( sleep N; kill -9 $PID ) &`.
- `[1× — 2026-08-02j]` 🔴 **Un script en chaîne `&&` ne vérifie QUE jusqu'au premier maillon
  rouge** — `npm run typecheck` (3 `tsgo` chaînés) s'arrêtait au back : le front n'était pas
  typé du tout, et je l'aurais cru vert. Pire, l'erreur affichée venait d'un **`dist` périmé**
  (types absents) et accusait un paquet tiers. Deux faux diagnostics dans une seule commande :
  lancer le maillon VISÉ séparément, et rebâtir avant de conclure sur des types.
- `[1× — 2026-08-03]` 🔴 **Une infra docker peut MOURIR en cours de suite** — PostgreSQL et
  MariaDB, démarrés et vérifiés, sont tombés pendant le run : **22 fichiers rouges d'un coup**,
  avec 0 test en échec (erreurs de collecte). Lu trop vite, ça ressemble à une régression du
  diff en cours. Deux réflexes : la forme du verdict trahit la cause (**fichiers rouges sans
  test rouge = décor, pas code**), et on **attend la disponibilité** (`until pg_isready`) au lieu
  de supposer qu'un `up -d` réussi vaut pour toute la durée du run.
- `[1× — 2026-08-03b]` 🔴 **`types` pointe la SOURCE, `import` pointe le `dist` — donc une valeur
  importée EXISTE pour TypeScript et vaut `undefined` à l'exécution.** Les paquets consommés en
  source (`security`, `http`, `user`…) déclarent `exports["."] = { types: "./index.ts", import:
"./dist/index.js" }`. J'ai ajouté une constante, importée depuis drizzle : typecheck vert, trois
  tests rouges, et le symptôme (`sortableFields` absent, tri par défaut disparu) accusait le
  contrat. **Une valeur neuve exportée par un paquet consommé en source exige son `npm run build`
  avant que le moindre consommateur ne la voie** — le type ne le dira jamais.
- `[1× — 2026-08-03b]` **`cmd | tail` rend le code de sortie de `tail`.** J'ai annoncé trois
  typechecks « exit=0 » qui mesuraient le filtre, pas `tsgo` — l'un des trois avait une vraie
  erreur, affichée à l'écran, avec « exit=0 » juste dessous. Capturer dans un fichier, lire
  `$?` de la commande SEULE. (Déjà gradué → [[feedback_shell_false_diagnostics]] ; noté ici pour
  la forme précise, qui n'y figurait pas.)
- `[1× — 2026-08-02b]` **Un script maison ne connaît pas `--help` : il LANCE le travail.** Les
  options se lisent au source.
- `[1× — 2026-07-30b]` **`spawnSync` BLOQUE la boucle du parent** — mortel dans un harnais qui
  lance des agents.
- `[1× — 2026-07-31e]` **La garde anti-geste-git du dépôt mord aussi sur l'agent PRINCIPAL** — et
  elle a eu raison à chaque fois.

## 🗣️ Quand le user REPOSE la question, c'est ma réponse qui est fausse

- `[1× — 2026-08-02j]` 🔴 **« kit en 8 étapes !!! »** — un plan dont plusieurs « lots » sont la
  MANIÈRE d'écrire les autres n'est pas un plan, c'est une checklist administrative. Sur 8 : 3
  étaient la manière (le parseur pur, le réalignement d'un endpoint, une correction de TSDoc), 2
  des conséquences conditionnelles, 1 une garde qu'**aucune mesure ne justifiait**. Ramené à 3
  gestes. Le test avant d'écrire un lot : **est-ce un RÉSULTAT, ou la façon d'en atteindre un ?**
  Le réflexe de complétude produit des plans que personne ne lit — et le premier symptôme est
  qu'ils impressionnent au lieu d'orienter.

- `[1× — 2026-07-27i]` ⭐⭐ **Trois fois la même question** — « comment tu fais pour que le code
  s'améliore ? ». Une reformulation n'est pas une demande de précision : c'est un signal que la
  réponse n'a pas répondu.

## 🗄️ Concurrence & atomicité (ce que le dialecte ne dit pas) — utile pour l'ORM S5

- `[1× — 2026-07-17]` **Un pool FROID masque les races** : le 1ᵉʳ écrivain finit avant que les
  autres aient leur TCP+auth.
- `[1× — 2026-07-17]` **`ON CONFLICT (x)` n'arbitre QU'UN index** ; **MySQL n'a ni `RETURNING` ni
  `WHERE` sur ODKU**.
- `[1× — 2026-07-17]` **La concurrence est un angle mort structurel des bancs** (séquentiels) :
  `Promise.allSettled` + tenir le travail ouvert.
- `[1× — 2026-07-17]` **Les valeurs JOUETS ne prouvent rien sur le type d'une colonne** : `1000`
  passe partout ; `1_775_000_000_123` prouve le bigint.

---

## 🗄️ Gradué au CONSOLIDATE du 2026-08-02 (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

| Thème (frictions)                                       | Mémoire                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 🧪 Suspecter son instrument / son propre diff (35)      | `feedback_suspect_instrument_and_own_diff`                              |
| 🪞 Un exemple de CODE agit, même faux (8)               | `feedback_agent_example_over_prose`                                     |
| 🕳️ Gate qui ne LIT rien · débranchement destructeur (7) | `feedback_gate_must_bite` + `feedback_destructive_needs_identity_scope` |
| 🎯 Isoler une variable · sonde de proximité (8)         | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| 🔍 Inventaire exhaustif par croisement (4)              | `feedback_inventory_needs_crosscheck`                                   |
| 🎲 Variance d'un run à l'autre (4)                      | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| ✅🧷 Un vert de test ne typecheck rien (3)              | `feedback_gate_must_bite`                                               |
| 🟢 Test non exécuté = rouge · vert annoncé (4)          | `feedback_gate_must_bite` + `feedback_green_covers_only_its_diff`       |
| 📦🔗🔬 Ce qui est COPIÉ ne se met pas à jour (4)        | `feedback_single_source_rule`                                           |
| 🧨 Commande composée refusée (1)                        | `feedback_shell_false_diagnostics`                                      |

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.
