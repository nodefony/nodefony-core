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

## 🪞 Le remède porte le défaut qu'il corrige — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_fix_the_family_not_the_instance`** (§ « Le REMÈDE porte le même défaut que ce qu'il corrige »).

## 🤝 Le terrain qu'on donne — GRADUÉ

→ [[feedback_stale_decor_poisons_verdicts]] (17 frictions versées) : se salir soi-même en éditant
pendant son propre run, le worktree qui isole les fichiers mais pas le SUJET, et le périmètre
décrit de travers à un délégué — qui affirme avoir balayé, extrapole, ou invente des URL.
Les deux frictions de sonde et de remplacement mécanique de cette même séance vivent ailleurs :
[[feedback_scope_wider_than_intended]] et [[feedback_bench_probe_false_verdicts]].

## 🔭🌍 Périmètre plus large que l'intention — GRADUÉ

→ [[feedback_scope_wider_than_intended]] (19 frictions versées, deux thèmes FUSIONNÉS : le
contrôle qui ratisse trop large et crie faux, et le geste dont la portée dépasse l'intention).
Séparés, aucun des deux n'atteignait son vrai poids.

## 🪤 Ajouter un CAS réveille des hypothèses jamais écrites — GRADUÉ

- Les 7 frictions sont versées dans **`feedback_prove_the_target_not_the_verdict`** (§ « Ajouter un CAS réveille les hypothèses… »).

## ⚙️ Réutiliser un script, c'est le RELANCER — GRADUÉ

→ [[feedback_script_import_executes]] (7 frictions) : l'import d'un script l'EXÉCUTE, une capacité
enfouie dans un fichier de 6 300 lignes est inatteignable donc réécrite, déplacer une règle rend
muettes les mutations qui la visaient, et un `grep` sans correspondance tue un script sous `set -e`.

## 🙈 L'outil ALTÈRE sa propre sortie — GRADUÉ

→ [[feedback_shell_false_diagnostics]] (21 frictions versées). Y compris ce qui n'est PAS du
shell : la notification de tâche de fond qui annonce « exit code 0 » sur un run rouge, l'empreinte
calculée sur un extrait, `awk` qui compte des octets, la mesure lancée en fond qui date de son
exécution.

- [3× — 09-17b] 🔴 **Cinq instruments faux en une séance, et quatre fois le même geste : une sortie
  tronquée ou une erreur masquée, lue comme une réponse.** (1) `grep -l $(liste de 1020 fichiers)`
  dépassait `ARG_MAX` et `2>/dev/null` avalait « argument list too long » → « 0 transcript »
  parfaitement faux ; (2) `xargs -a` n'existe pas sur BSD, même masque, même zéro ; (3) `grep -E`
  avec `\|` cherche le PIPE littéral → quatre comptages à 0 sur un corpus plein ; (4) `timeout`
  n'existe pas sur macOS → trois modèles déclarés « sans réponse » sans qu'aucun appel ait eu lieu ;
  (5) `head -6` a coupé la sortie d'un agent juste après ses avertissements → conclusion « il ne
  répond pas » démentie par le user. **La règle qui les couvre tous : ne jamais rediriger stderr
  quand on interprète un compte, et ne jamais conclure sur une sortie qu'on a tronquée soi-même.**

## 🗄️ 🧑‍⚖️ Un AUDIT + 🕶️ relire EN AVEUGLE — GRADUÉ

> Gradué le 2026-09-10 — 7 frictions RÉUNIES → **`feedback_outside_look_finds_what_green_hides`** : le regard extérieur (audit des jointures, USAGE réel, relecture en aveugle privée de mes conclusions) trouve ce qu'une suite verte ne peut pas voir. Ne PAS réécrire ici.

## 🧾 Un TEST porte une MESURE — le lire avant de trancher une conception

- [1× — 09-22] 🚧 **Un banc qui ne franchit jamais la frontière du framework ne voit rien de ce
  qui s'y casse.** Le banc de vérité générait `author:ref:Author` — une entité qu'il crée
  lui-même — et jamais `ref:User`, l'entité que `create app` POSE dans toute application. Les deux
  s'écrivent pareil et ne cassent pas pareil : la table du framework est bâtie depuis une spec
  CALCULÉE, celle d'une entité générée non. Cette seule entrée ajoutée, deux défauts sont tombés
  d'un coup — la clé primaire inatteignable au type, et l'échantillon `userSample` qu'aucun gabarit
  d'application n'exportait — que ~1600 tests laissaient passer. Le voisinage entretenait l'angle
  mort : un commentaire expliquait, à juste titre, pourquoi on ne NOMME pas une entité `User`, et
  cette raison tenait lieu de raison de ne pas en RÉFÉRENCER une.
- [1× — 09-22] 🧊 **Un cas d'EXÉCUTION ne peut pas garder un fait de TYPAGE.** La colonne a
  toujours existé à l'exécution — c'est le type qui l'avait perdue, et tout test vert l'aurait
  confirmé en boucle. Le garde-fou ne pouvait être que la COMPILATION du fichier de test lui-même,
  ce qu'il fallait écrire dans sa TSDoc pour que personne ne « répare » plus tard le rouge en
  retirant l'assertion.

- [1× — 09-21d] 📏 **J'ai prouvé qu'un attribut EXISTE, et cru avoir prouvé qu'il SERT.** Le
  détail d'une ligne passait par un `title` posé sur le seul libellé. Ma sonde le trouvait par
  sélecteur CSS — donc « c'est fait ». Le user : « le hover ne marche toujours pas ». Il avait
  raison : la cible faisait quelques dizaines de pixels quand la ligne en fait 513. Un sélecteur
  interroge le DOM ; il ne dit RIEN de ce qu'une souris peut atteindre. La bonne mesure était la
  TAILLE de la cible — la sonde la rend, je ne l'avais pas regardée. Même famille que mesurer un
  contraste sans lire la police : l'attribut n'est pas la propriété qu'on lui prête.
- [1× — 09-21d] 🔬 **J'ai failli ouvrir un ticket sur une hypothèse — la mesure l'a démentie.**
  Après avoir fait sauter la session du user en éditant du code serveur pendant qu'il travaillait,
  j'ai laissé entendre qu'une session « ne survit peut-être pas à un redémarrage ». Le contrôle
  tient en quatre commandes : cookie frais → `200`, arrêt/relance complet, MÊME cookie → `200`.
  Elle survit. Le ticket aurait gravé un défaut inexistant dans le jalon, et quelqu'un l'aurait
  cherché. Un symptôme observé une fois n'est pas une cause : entre les deux, il y a une mesure.

- [1× — 09-21c] 🔴 **Mon test affirmait une garantie que le CONTRAT ne permet à personne de
  tenir — et les trois implémentations mentaient de la même façon.** En portant l'idempotence sur
  Mongo, j'ai écrit « `complete` ne ressuscite pas une clé VOLÉE entre-temps ». Rouge. Réflexe
  premier : corriger mon store. Le geste juste a été d'aller lire l'implémentation de RÉFÉRENCE
  (`framework/nodefony/service/IdempotencyStore.ts`) : elle garde sur le seul `kind ===
"in-flight"`, exactement comme Drizzle — parce que `complete(key, response)` ne reçoit **aucun
  jeton de réservation** et n'a donc rien pour distinguer le détenteur légitime d'un handler figé
  qui se réveille. Ce n'est pas un oubli d'adaptateur, c'est une limite du contrat. Les trois
  TSDoc, eux, promettaient « ni bail expiré + volée entre-temps » — une phrase recopiée trois
  fois, fausse trois fois. **Diverger pour « mieux faire » aurait été pire que la limite** : le
  comportement d'un `@Idempotent` aurait dépendu du backend choisi. Le test constate désormais la
  limite en disant que c'en est une, et la fermer exige un jeton au contrat, donc une majeure.

- [1× — 09-21c] 🔴 **Un banc qui affirme tester une CONDITION a besoin d'un TÉMOIN qui prouve que
  la condition est bien dans le décor.** Banc de rafale du journal d'audit : 400 événements pour
  éprouver le curseur composite sur des collisions de milliseconde. Écrit avec un `await` par
  `append`, chaque écriture était espacée d'un aller-retour réseau — **zéro collision**, et les
  cinq cas suivants passaient au vert en ne départageant rien. Seul le témoin « la rafale a-t-elle
  produit des collisions ? » l'a dit. La correction n'était pas cosmétique : l'`AuditService` émet
  en **synchrone** (`record()` est fire-and-forget) et n'attend pas l'écriture — le décor devait
  refléter le producteur réel, pas une boucle d'écriture confortable. Un test vert sur un décor qui
  ne contient pas son sujet est un faux vert PARFAIT : rien ne cloche, tout passe.

- [1× — 09-20b] 🔴 **J'ai failli retirer huit scripts npm qu'un test du dépôt protégeait par une
  MESURE.** Raisonnement : un script qui n'est qu'un alias 1:1 d'une commande (`"doctor": "nodefony
doctor"`) n'a pas d'intérêt propre. `create.test.ts` portait la réponse en clair — « sans cette
  ligne, le verbe existe et personne ne l'apprend », `nodefony doctor` employé **5 fois sur 63** au
  banc de découvrabilité. Le manifeste n'est pas une redite de la CLI : c'est le canal par lequel un
  agent APPREND les commandes d'un framework qu'il ne connaît pas. Deux tests sont tombés au moment
  où je l'ai tenté — le filet a fonctionné, mais je ne l'avais pas lu avant de trancher.

- [1× — 09-20] 🔴 **Neuf tests affirmaient le choix que je venais de renverser, et les relâcher
  aurait effacé ce qu'ils gardaient.** En portant les canaux du processus de `ROLE_ADMIN` à
  l'échelle plateforme, neuf bancs sont tombés — tous disaient « un admin passe ». La tentation
  est de corriger l'assertion ; le geste juste est de corriger l'ACTEUR : leurs jetons portent
  désormais les deux échelles, comme la fixture réelle du dépôt, et leurs parcours de hiérarchie
  couvrent la nouvelle. Puis d'AJOUTER le fait neuf, qui n'existait dans aucun test — « un rôle
  d'organisation seul est refusé sur un canal de plateforme, et garde ses canaux applicatifs ».
  Sans ce contrôle jumeau, rien ne distingue « la protection mord » de « tout est fermé ».

- [1× — 09-19c] 🔴 **Mon tri d'architecture était faux, et ce sont les tests du dépôt qui l'ont
  redressé — pas une relecture, pas le user.** En retirant les pages d'instructions copiées dans
  chaque app (#432), j'avais tranché « ce qui est propre à l'app va dans la porte, le générique va
  dans les skills ». Sept assertions sont tombées, chacune portant en commentaire un fait MESURÉ
  que ma règle ignorait : « deux runs sur deux, l'agent a tapé `orm:reset` — la ligne de CE fichier
  copiée à la lettre — puis `rm` la base quatre fois » et « ce document est le SEUL qu'il ouvre
  d'office, le skill qui l'interdit n'est jamais chargé ». La règle juste était donc : la porte
  garde aussi **ce dont l'ignorance fait faire une bêtise**, générique ou non. Ces faits ne vivent
  NULLE PART ailleurs — ni dans un `CLAUDE.md`, ni dans une mémoire : leur seul domicile est le
  commentaire du test qui les garde. Corollaire : avant de déplacer ou supprimer quoi que ce soit,
  lire les tests qui le couvrent **pour ce qu'ils affirment**, pas seulement pour les faire passer.

## 🏷️ Un NOM qui a survécu à ce qu'il désignait envoie chercher ce qui n'existe plus

- [1× — 09-21d] 🧮 **Un agrégat indexé sur un nom NON UNIQUE perd des données sans rien dire —
  facteur 100 à l'écran.** `counts` du plan d'administration ORM renvoyait `{ nom: total }`. Avec
  deux ORM chargés, `audit_event` de Mongoose (**265** documents) écrasait celui de Drizzle
  (**264 080** lignes) : le tableau de bord annonçait « 2.1k lignes » pour une base qui en porte
  268k, et affichait le même chiffre sur les deux connecteurs — dont un faux. Rien ne criait :
  une clé écrasée est une affectation réussie. Le même mot, `default`, portait par ailleurs deux
  sens sur le même écran — « connecteur par défaut de Drizzle » et « base par défaut de
  l'application » — et sacrait « primaire » une base SQLite vide pendant qu'une application
  tournait sur MongoDB. Le contrôle : une clé d'agrégat se qualifie dès que son espace de noms
  n'est pas garanti unique, et un libellé d'écran se relit en se demandant de QUI il parle.

- [1× — 09-21] 📖 **La documentation fait CROIRE qu'une capacité est fournie — et c'est pire qu'un
  trou, parce que personne ne la cherche.** `react-hooks.md:217` montre un `useRoomPresence`
  complet, le cookbook un canal `chat:presence` : ce sont des **exemples que l'utilisateur écrit**
  (la page le dit — « ton hook porte le vocabulaire de ton domaine »), et la présence n'existe nulle
  part dans le framework. Constaté sur un agent réel lâché dans une application générée : il les a
  rangés dans sa colonne **« déjà fourni — ne rien réécrire »**. Un patron bien documenté se lit
  comme une primitive. Le pendant exact de [[feedback_capability_unreachable_is_absent]] : là une
  capacité réelle qu'on n'atteint pas, ici une capacité absente qu'on croit atteignable — même
  écart entre ce que le corpus affirme et ce que le code porte.
- [1× — 09-21] 🏷️ **Un label homonyme d'un jalon confond deux instruments, et le double se périme
  seul.** Huit labels portaient le nom des huit jalons ; **quinze tickets ouverts** affichaient une
  version que leur jalon démentait — quatorze marqués `10.1.0` sur un jalon `10.2.0`, et un portant
  `10.1.0` + `backlog`. Personne ne déplace un double en déplaçant un jalon. La cause était dans
  l'outil (`ticket-open.mjs` posait le label homonyme à chaque création), pas dans la discipline.
  Gate `LABEL-DOUBLE-JALON`.
- [1× — 09-21] 🔦 **Un drapeau qui existe et que rien ne nomme n'est pas atteignable.**
  `board-snapshot.mjs --issue` republie l'issue publique d'avancement, et le script npm existait ;
  mais l'en-tête ne documentait que `--check` et `--force`, et le mode END décrivait l'étape du
  README puis s'arrêtait. Résultat : la vitrine publique affichait la photo de la veille (112
  tickets contre 122). Le miroir du premier bullet — ici le code porte plus que le corpus n'annonce.

- [1× — 09-20c] 🔐 **Le dépôt portait DEUX mots de passe de développement, et l'écran annonçait le
  mauvais.** `secret` a survécu au durcissement de la politique : `DEV_FIXTURE_PASSWORD` valait
  `secret-de-dev-42` pour le dépôt persistant, mais les hachages pré-calculés de l'annuaire en
  mémoire encodaient toujours `secret` — deux vérités selon `NF_USER_STORE`, que rien à l'écran ne
  disait. Conséquence : l'écran de connexion affichait `dev : admin / secret`, les **sept** recettes
  du skill navigateur échouaient, **cinq** scripts de charge ne s'authentifiaient plus. Aucun test
  ne tombait — le code des suites avait suivi, **seuls leurs commentaires mentaient**. Même famille
  le même jour : `audit:web`, script npm supprimé la veille, encore nommé par le menu du CLI. Le
  remède n'est pas de corriger les occurrences (deux passes manuelles en ont laissé quatre
  derrière elles) mais un gate qui balaye `git ls-files` et VALIDE le hachage contre la constante —
  `npm run test:dev-credentials`.

- [1× — 09-20] 🔴 **J'ai nommé un drapeau par ce qu'il PROMETTAIT, et le nom est devenu une porte.**
  `selfGuarded` — « la route se garde elle-même » — n'installait aucune garde : il en RETIRAIT une
  (le rôle exigé par la zone). Posé sur une route qui ne décide de rien, il l'ouvrait à tout compte
  connecté, en silence, et il était exposé dans les options publiques du routeur. Un auditeur
  extérieur l'a vu en une lecture ; moi qui l'avais écrit trois heures plus tôt, non. Renommé
  `areaRoleExempt`, marqué interne, affiché dans la ligne de journal d'une route, et gardé par un
  contrôle d'inventaire. La règle : **un nom qui promet une garde invite à le poser pour débloquer
  une route** — nommer par le GESTE, jamais par l'intention qu'on lui prête.

- [1× — 09-19g] 🔴 **Le renommage français → anglais a corrigé le CODE ; les pages qui le
  DÉCRIVENT sont restées sur l'ancien nom.** `check:lang` est vert — 0 identifiant français sur
  1588 fichiers — mais sept `MEMORY.md`/`CLAUDE.md` citaient encore `controlesSautes`,
  `grouperParRaison`, `nombreDeControlesPasses`, `surfaceDe`, `argvListe`, `separerGeste`,
  `aFaireEnsuite`, `mcpEchecAdmin`. Un agent lit « primitives PURES : `controlesSautes` », le
  cherche, ne le trouve nulle part. Le gate qui a renommé n'avait aucune raison de regarder du
  Markdown, et aucun autre ne lisait ces fichiers : `anchor-check` résout les ancres
  `fichier:ligne` du corpus PUBLIÉ, jamais un symbole cité sans ancre dans un fichier
  d'instructions. La famille du remède était plus large que le remède.
- [1× — 09-19g] **Un composant supprimé reste décrit par la doc qui s'adresse aux agents.**
  `ConnectionDrawer.tsx` n'était importé par personne, et le `CLAUDE.md` comme le `MEMORY.md` de
  studio le donnaient en exemple de « frontend React à instrumenter ». Le supprimer sans relire
  ces deux pages aurait laissé un exemple qui nomme un fichier absent.

- [1× — 09-19d] 🔴 **Notre propre aide enseignait l'INVERSE de ce que le code faisait, et tous nos
  exemples avec.** Dans la grammaire de champs, `!` posait une contrainte d'UNICITÉ ; `help.ts:62`
  l'annonçait « `!` requis », `spec.ts:834` disait « ! unique », et README, guides, gabarit de la
  porte et skill livré écrivaient tous `title:string!` — en croyant dire « obligatoire ». Trois
  rédactions de la même grammaire, dont une fausse, et personne pour les confronter. Un agent tiers
  a suivi nos exemples : son salon de discussion refusait deux fois le même message, et il a brûlé
  35 minutes en migrations pour s'en sortir. La règle : une notation qui contredit un réflexe
  universel (`!` = non-null en GraphQL, TS, Kotlin, Swift, Prisma) ne se rattrape par AUCUNE prose —
  ce qu'il faut changer, c'est la notation. Et le signe qu'on est dans ce cas : les rédactions
  divergent entre elles, parce qu'aucune n'est évidente.

- [1× — 09-19c] 🔴 **Le dossier de gabarits s'appelait `templates/app/agents/` alors qu'il ne
  posait plus aucun dossier `agents/` dans l'application.** Conséquence immédiate : mon propre
  compte rendu a écrit « `agents/client/*.md` restent », et le user a compris qu'un dossier hors
  norme subsistait chez l'utilisateur — « nodefony n'a pas à s'immiscer dans l'app d'un user ». Il
  n'en restait aucun : ces fichiers sont des fragments INJECTÉS dans `AGENTS.md` au rendu, et le
  `agents/` cité était celui du DÉPÔT. Le nom a fabriqué la méprise, et je l'ai relayée. Renommé
  `agent-instructions/`. La règle : après tout retrait, le nom de ce qui reste se relit — un
  contenant qui porte le nom de sa sortie disparue est une ancre fausse d'un genre particulier,
  puisqu'il ne pointe sur rien de FAUX dans le code, seulement dans la tête de qui le lit.

## 🔗 Une DÉPENDANCE peut être encodée ailleurs que dans le champ « dépend de »

- [1× — 09-21c] 🔴 **J'ai relayé un renvoi MORT trouvé dans le corps d'un ticket, et je l'ai
  propagé dans trois endroits avant que le user ne l'attrape.** En fermant #30, j'ai écrit
  « `DATABASE_CHOICES` sans mongodb, c'est **#32**, hors périmètre » — parce que le corps de #30
  le disait. **#32 est clos depuis le 2026-08-27 et porte tout autre chose** (« trancher les
  arbitrages avant la publication ») ; surtout, **aucun ticket ouvert ne porte ce sujet** : le
  trou n'est pas « suivi ailleurs », il n'est pas tracké. J'avais chargé le skill `nodefony-ticket`
  dans la même session — il porte ce piège EN EXEMPLE, avec presque le même cas (« un corps
  renvoyait à #9 pour de la documentation ; #9 est une mise à jour de dépendances »). Lire la règle
  ne suffit pas : un renvoi se contrôle **au moment où l'on s'en sert**, d'un `gh issue view`, et
  celui-là coûtait dix secondes. Le coût de l'erreur n'est pas le mauvais numéro — c'est qu'un
  trou réel passe pour couvert, dans un compte rendu de fermeture que personne ne relira.

- [1× — 09-21c] 🔴 **Un ticket que mon travail soldait aux trois quarts est resté invisible, parce
  que l'automate de sélection ne connaît que les FICHIERS.** `ticket-verify.mjs --touched-by HEAD`
  a rendu trois tickets voisins, tous sans rapport ; il n'a PAS rendu **#238**, qui déclare
  pourtant `Dépend de: #30` en toutes lettres et dont trois critères sur quatre venaient d'être
  remplis. Normal : l'outil sélectionne les tickets qui **citent les fichiers du diff**, et #238
  cite des fichiers que je n'avais pas touchés. Je ne l'ai trouvé qu'en cherchant autre chose. La
  règle : après avoir fermé un ticket, lire aussi **ce qui DÉPEND de lui** (`gh issue list` +
  recherche du numéro dans les corps) — la dépendance déclarée est un lien que l'automate des
  fichiers ne voit pas, et c'est précisément le lien le plus fort.

- [1× — 09-18g] 🔴 **J'ai annoncé au user qu'un ticket était l'ENFANT d'un autre, sur la foi d'une
  recherche plein texte.** `gh issue list --search "316 in:body"` rend tout ce qui CITE #316 ; j'en
  ai conclu une parenté, et bâti là-dessus un raisonnement sur la fermeture du parent (« il attend
  deux enfants situés dans d'autres jalons »). La requête qui dit la vérité est
  `issue(number:N){parent}` / `subIssues` : elle a montré que le ticket en question **n'avait aucun
  parent**, et que les 14 vrais sous-tickets étaient **tous fermés** — la fermeture était donc plus
  propre que je ne l'avais dite. Citer n'est pas être rattaché ; une relation de structure se LIT
  dans le champ qui la porte, jamais dans un texte qui la mentionne.

- [1× — 09-10] **Retirer un mécanisme oblige à corriger ce qui le PRESCRIT et ce qui le
  DÉCRIT — et ni l'un ni l'autre ne vit dans son fichier.** Le `prepack` de `@nodefony/studio`
  était rattaché au reste par deux liens qu'aucun `grep package.json` ne visite : un message du
  préflight de release qui annonçait « s'exécutera PENDANT le pack » (faux depuis que le pack
  passe `--ignore-scripts`, donc un message exact-mais-périmé qui envoie chercher là où il n'y a
  rien), et un gabarit de skill qui le PRESCRIVAIT « en filet ». Le contrôle qui les trouve n'est
  pas de chercher le nom du mécanisme dans le code, c'est de le chercher dans la PROSE exécutable
  et dans les gabarits — là où il est recommandé, pas là où il est déclaré.

- [1× — 09-09] **J'allais extraire un bloc de config et casser le générateur EN SILENCE ; c'est une
  question du user qui m'a arrêté, pas ma lecture du ticket.** #285 portait « Dépend de : rien », et
  j'ai pris ça pour un feu vert. La dépendance était pourtant écrite à DEUX endroits que je n'avais
  pas croisés : le champ `Ordre` du tableau (16.1 pour #284, 16.2 pour #285 — l'ordre encode les
  dépendances, c'est sa définition), et une section du corps intitulée « Ce qui n'est PAS dans ce
  ticket », qui nommait la raison exacte (« rendrait `doctor` aveugle tant que les lecteurs textuels
  du manifeste ne partagent pas une fonction unique »). Le terrain a confirmé : `roleHierarchy`
  vivait l.352, en plein dans le bloc que je déplaçais, et le scaffold l'ancre à l'expression
  régulière — zéro erreur, zéro constat, un rapport de surface qui se lit « tout va bien ».
  Le contrôle qui l'attrape avant d'écrire une ligne : **lire le champ `Ordre` ET la section « ce
  qui n'est pas dans ce ticket » du ticket VOISIN**, pas seulement `Dépend de` du sien.

- [1× — 09-09] **Un ticket peut partir de prémisses devenues fausses, et sa taille change alors du
  tout au tout.** #287 affirmait « seuls deux modules exposent leur schéma » et « aucune description
  n'est atteignable » : mesuré avant d'écrire, **neuf modules sur dix** le rendaient déjà, avec
  429 descriptions, et la provenance par champ existait. Le travail n'était pas la plomberie
  annoncée mais un RENDU. Mesurer les trois affirmations a coûté deux commandes ; les croire aurait
  coûté une refonte inutile. ↝ [[feedback_anchor_expires_silently]]

## 🧊 Un banc meurt à chaque étage de son cycle — GRADUÉ

- Les 7 frictions sont versées dans **`feedback_bench_probe_false_verdicts`** (§ « Un banc meurt à chaque étage de son cycle »).

## ⌨️ Une commande que je fais TAPER au user s'exécute dans SON terminal, pas dans le mien

- [1× — 09-13e] 🔴 **La variable qui expliquait TOUT était dans la commande du user, et je ne la
  lui ai demandée qu'au bout de deux heures.** Son serveur de dev ne démarrait pas (« manifeste :
  0 module(s) déclaré(s) », sortie 69) ; le mien démarrait, même dossier, même `dist`, même
  environnement. J'ai successivement accusé un `dist` en cours d'écriture, une course entre le
  build et le boot, des instances concurrentes, puis son environnement — quatre causes annoncées
  avec assurance, quatre fois fausses. Il lançait `nodefony dev` (binaire du PATH, lié vers le
  dépôt) ; je lançais `npm run dev` (binaire local). C'était TOUTE la différence, et elle n'était
  écrite nulle part dans le code. **Quand un symptôme n'est pas reproductible, la première
  question n'est pas "qu'est-ce qui diffère dans le code ?" mais "quelle commande EXACTE
  tapes-tu ?"** — la réponse tient en une ligne et elle a coûté une session.

- [2× — 09-11d] **Deux commandes proposées au user ont BLOQUÉ son terminal, pour deux causes
  différentes.** D'abord un `read -rsp` — une saisie interactive dont le stdin n'est pas branché :
  il attend indéfiniment, et `-s` masque même l'absence d'écho, donc rien ne signale l'attente.
  Ensuite une boucle `for` dont le `;` est arrivé échappé (`\;`) au collage : le shell ne voit
  jamais la fin de la commande et reste en attente de la suite (`for>`). Dans les deux cas le user
  a dû interrompre, et dans les deux cas j'avais écrit une commande que je n'avais PAS exécutée.
  Règles qui en sortent : jamais d'interactif (`read`, un éditeur, une invite) dans une commande
  destinée à un autre terminal ; jamais de boucle ni de `;` quand trois lignes indépendantes font
  le même travail — une ligne qui échoue se rejoue seule, et rien ne peut rester ouvert.

- [1× — 09-11d] **Et le mauvais identifiant.** Le namespace du dépôt d'images (`nodefony`) n'est
  pas le compte qui s'y authentifie (`ccamensuli`). J'avais pris le premier pour le second. Un
  identifiant se DEMANDE ou se CONSTATE — `docker login` l'affiche —, il ne se déduit pas du nom
  de l'organisation.

## 📐 Composer un chemin avec la MÊME opération — GRADUÉ

→ [[feedback_cross_platform_axioms]] (7 frictions) : composer des deux côtés ne suffit pas si ce
n'est pas la même opération (`resolve` contre enraciné), un attendu littéralisé de tête est faux,
et la frontière d'un format structuré se compose avec sa grammaire.

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

- [1× — 09-21b] ⚖️ **Le défaut d'un générateur est choisi pour UN public, et l'autre le subit sans
  recours.** `create app` posait `"license": "UNLICENSED"` et un « Tous droits réservés » écrits en
  dur — le bon défaut pour une application privée, et assumé en toutes lettres dans le gabarit.
  Mais le MÊME gabarit produit la vitrine publique `nodefony/nodefony` (93 ★ contre 0 pour le
  dépôt du framework) : un projet libre y montrait une démonstration que personne n'avait le droit
  de copier, classée `NOASSERTION` par GitHub — donc hors de tout filtre de recherche par licence
  et écartée d'office par une politique d'entreprise. **Et rien ne pouvait le corriger sur place** :
  ce dépôt est écrasé à chaque publication, donc l'option devait exister dans le générateur ou
  nulle part. Le contrôle qui tranche : **qui d'autre reçoit ce défaut ?** — un générateur dont la
  sortie est publiée a toujours au moins deux publics.

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

- [1× — 09-11] **Une clé privée ne restait hors de l'image que par COÏNCIDENCE de chemins.** Le
  trousseau JWT vit sous `var/keys` et le Dockerfile généré efface `var/` : rien n'attachait la
  sécurité à la configuration. Un utilisateur écrivant `keystore: { dir: "nodefony/config/keys" }`
  — chemin parfaitement raisonnable — publiait sa clé privée, sans aucun signal. Quand une garantie
  tient à deux valeurs posées dans deux fichiers différents, ce n'est pas une garantie : c'est une
  coïncidence, et elle se contrôle par un test qui CONFRONTE les deux.

- [1× — 09-05f] **Un FAUX secret dans un dépôt public est refusé exactement comme un vrai, et
  c'est correct.** `SMOKE_SECRET="0123456789abcdef…"` — 32 hexadécimaux, valeur jetable d'un banc
  local, n'ouvrant rien — a fait rougir le gate `Secrets` le soir même. Aucun relecteur, humain ou
  automate, ne distingue les deux. Un secret jetable se **TIRE** (`openssl rand -hex 16`, repli
  `/dev/urandom`) : il n'a aucune raison d'être reproductible. L'exclure par une règle de
  `.gitleaks.toml` aurait appris au scanner à se taire sur cette FORME partout ailleurs — c'est
  `.gitleaksignore`, par empreinte exacte, qui acquitte un constat déjà commité.

- **Un jeton écrit SANS son mode : 0644, lisible par toute la machine.** Parti d'une alerte de
  RACE (`existsSync` puis `write`), j'ai trouvé pire à deux lignes. Et le remède existait DÉJÀ dans
  le paquet (`JwtKeystore` écrit sa clé en 0600) : une CLI en avait une version dégradée.
  Après chaque « on écrit quoi, où ? », poser « et qui a le droit de le LIRE ? ». `[1× — 08-25]`
- **Le fichier TEMPORAIRE porte le secret, et survivait à l'échec.** L'écriture atomique passe par
  `<f>.<pid>.tmp` puis `rename` ; si le `rename` lève, le tmp reste EN CLAIR sur le disque. On avait
  durci les permissions de la cible en laissant fuir le contenu à côté. Le cas est PROBABLE sous
  Windows (remplacer une cible ouverte y échoue, là où POSIX remplace) — et la cible est un `.env`
  que l'utilisateur a sous les yeux dans son éditeur. `[1× — 08-25]`

- **`--write` posait le jeton MCP dans `.env.local` : AUCUN code de l'application ne le lit.** Elle
  est le serveur de ressource, elle vérifie des jetons, elle n'en porte pas. Le consommateur — un
  agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton. Une heure de diagnostic.
  `[1× — 08-22]`
- **La duplication ne survit pas à la ROTATION** : le fichier refusait d'être touché pendant que les
  agents auraient dû recevoir le neuf. La question de l'utilisateur — « pourquoi aussi dans
  `.env.local` ? » — valait mieux que ma conception. `[1× — 08-22]`
- **L'état de câblage n'a pas à être mémorisé : il EST dans les fichiers.** Un agent qui porte la
  clé a été câblé un jour ⇒ rotation muette. Un fichier d'état parallèle aurait menti à la première
  édition manuelle. `[1× — 08-22]`

- [1× — 08-29f] **Un avertissement émis à un niveau AVALÉ n'existe pas — et changer le niveau ne suffit pas.** Le message qui annonce qu'une variable détourne la base partait en `INFO` ; passé en `WARNING`, il n'est toujours PAS sorti (le boot silencieux des commandes avale les deux) — constaté en exécutant, pas déduit. La bonne question n'est pas « à quel niveau ? » mais « PAR OÙ ça sort ? ». Porté dans l'en-tête du rapport, qui emprunte le même chemin que le `--json`, l'écran et la charge utile ne peuvent plus diverger. Un avertissement qui n'atteint personne est pire qu'aucun : on le croit posé.

## 🧪 Ce qu'on PUBLIE est une affirmation — GRADUÉ

→ [[feedback_agent_example_over_prose]] (8 frictions) : une phrase de rapport écrite en dur dément
sa propre donnée, une preuve d'absence se formule en COMMANDE pour obliger à la lancer, et les
surfaces périphériques gardent l'ancien chiffre après un recalage.

## 🗄️ 🧨 DÉCLARATION qui désarme + 💾 CACHE à demi écrit — VERSÉS

> Versés le 2026-09-10 dans **`feedback_destructive_needs_identity_scope`** (§ « Détruire SANS EN AVOIR L'AIR ») : une déclaration, un nettoyage de décor ou une écriture de cache détruisent sans l'annoncer. Ne PAS réécrire ici.

## 🧵 Trois choses ne suivent PAS d'un process à l'autre — enchaîner se teste

- [1× — 09-05d] **Un test lisait `NODE_ENV` de SON process pour savoir si le SERVEUR tourne en production.** Deux horloges : la forge démarre le serveur en production et lance la suite sans ce mode. Le cas exigeait donc, en production, la phrase que la production retire exprès — rouge sur les trois plateformes à la fois. Le porteur existait déjà (`NF_TEST_ENV`, posé par un `globalSetup` qui SONDE le serveur sur `/livez`) ; ce cas était le seul à ne pas l'appeler. Avant d'écrire une condition sur l'environnement dans un test d'intégration, chercher QUI porte déjà le mode de la cible.

- Enchaîner une commande sur une autre (`spawnSync`) : l'ENVIRONNEMENT (un enfant ne reçoit que ce
  qu'on lui donne — et `NODE_ENV` si la cible n'existe qu'en dev), le RÉPERTOIRE (écrire dans le
  PROJET, pas là où l'on a tapé), le TERMINAL (`stdio: "inherit"`, sinon `isTTY` est faux chez
  l'enfant et il ne peut rien demander). Rendre la DÉCISION pure et la tester ; le spawn est de la
  plomberie. Le gabarit `create command` l'enseigne désormais. `[1× — 08-21e]`

## 🖥️ Piloter un TTY par `expect` prouve mal — préférer rendre le câblage testable

- Cinq tentatives pour valider un choix de menu : filtres qui ne mordent pas, `\r` qui valide le
  premier item, prompt masqué impilotable, serveur de dev lancé par erreur **deux fois** (qu'il a
  fallu arrêter). Le prompt `search` d'inquirer ne se pilote pas de façon fiable. Quand un câblage a
  échoué en silence, l'exposer (méthode publique) et l'ÉPROUVER coûte moins cher qu'un pty.
  `[1× — 08-21e]`

## 🖥️ L'interactif se prouve au PTY — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_shell_false_diagnostics`** (§ « L'interactif ne se prouve qu'au PTY »).

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-29] `process.exit()` posé dans un `try` ne déroule AUCUN `finally` : les pods déjà levés survivaient au banc avec leur port ET leur connexion à la base, et le run suivant échouait sur un `DROP DATABASE` refusé — pour une raison qui n'était pas la sienne. Pire dans un cas : le pod fautif n'était pas encore rangé dans la variable que le `finally` inspecte, donc personne ne l'aurait arrêté. Abandonner se fait par une sentinelle qu'on JETTE.
- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

- [1× — 09-14d] 🔴 **Tuer un process ne tue pas son arbre : un `wrk` orphelin à 308 % de CPU.**
  J'ai arrêté un banc de tenue par un signal à SON process ; le générateur de charge qu'il avait
  lancé a survécu et a continué de saturer trois cœurs. Découvert par hasard en lisant un `ps`
  pour autre chose — rien ne le signalait, et toute mesure lancée ensuite aurait été fausse sans
  qu'aucun compteur ne bronche. Même famille que le superviseur sans port : ce qui échappe au
  critère d'arrêt continue de tourner. Le contrôle d'un décor propre doit énumérer les ENFANTS,
  pas seulement les écouteurs.

- [1× — 09-14e] 🔴 **Le symétrique : il ÉCOUTE, mais son NOM a changé — et c'est lui qui répondait
  à mes mesures.** Nodefony renomme son process (`setProcessTitle` → `nodefony server`), si bien
  que mes `pkill -f "bin/nodefony production"` échouaient **en silence** depuis une heure. Un
  serveur résiduel orphelin (`PPID 1`) tenait le port 5151 et servait toutes mes vérifications
  manuelles — trois instruments l'ont dit sans que je l'entende : une sonde SQL muette, un profil
  CPU ne contenant que du boot, et zéro `prepare()` pendant une requête. Le banc VERSIONNÉ, lui,
  était sain : il purge **par port** (`kill_listeners`), ce qui attrape un process renommé, puis
  attend la libération. Le geste : avant toute mesure à la main, reprendre la purge de l'outil —
  et **vérifier que le PID qu'on a lancé est celui qui écoute** (`lsof -t` comparé à `$!`).

## 🧱 Remplacer un mécanisme du NAVIGATEUR par du code à soi, c'est en devenir responsable

- [1× — 09-01d] Pour rendre le titre d'une section cliquable, j'ai troqué `<details>/<summary>` —
  dont le pliage est NATIF et ne peut pas tomber — contre un en-tête à deux commandes plié en
  JavaScript. Le pliage est tombé : l'écouteur était bien attaché (vérifié au protocole de débogage
  du navigateur), sans aucun effet, et le user a trouvé le menu bloqué avant moi. Revert. **Ce qui
  marche sans JavaScript ne se remplace pas pour un confort ; on AJOUTE à côté.**

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**Gradué au fil de l'eau, jusqu'au CONSOLIDATE 2026-09-11 :**

| Thème (frictions)                                             | Destination                                  |
| ------------------------------------------------------------- | -------------------------------------------- |
| 🏭 Ce que le PRODUIT construit ≠ ce que la CONFIG demande     | `feedback_prove_on_received_artifact`        |
| 🧭 Un identifiant dans la MAUVAISE LANGUE (renommage) (14)    | `feedback_code_rewrite_mechanical_traps`     |
| 🤖 Un agent LIT l’interdit et le transgresse (6)              | `feedback_destructive_needs_identity_scope`  |
| 📖 Ce qui est ÉCRIT ne protège que si on le relit (10)        | `feedback_written_rule_needs_reread`         |
| 🧭 La voie FIABLE reléguée en repli (10)                      | `feedback_reliable_path_demoted_to_fallback` |
| 🧪 Un test qui ne parle jamais au serveur (9)                 | `feedback_prove_on_received_artifact`        |
| 🩺 Une correction qui ne couvre qu’un cas (28)                | `feedback_fix_the_family_not_the_instance`   |
| 🎯 Un PORT qui répond ne dit pas À QUI (9)                    | `feedback_stale_decor_poisons_verdicts`      |
| 🧭 La doc qui AFFIRME une automatisation inexistante (7)      | `feedback_capability_unreachable_is_absent`  |
| ⏳ Un symptôme qui ressemble à un DÉLAI (5)                   | `feedback_test_no_fixed_delay`               |
| 🚪 Une porte a plusieurs ENTRÉES (21)                         | `feedback_single_source_rule`                |
| 🧭 Une garde ne couvre jamais une AUTRE question (10)         | `feedback_prove_the_target_not_the_verdict`  |
| 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT             | `feedback_capability_unreachable_is_absent`  |
| 🟢 Un test peut passer depuis TOUJOURS sans rien mesurer (61) | `feedback_prove_the_target_not_the_verdict`  |
| 🎭 Mon PROPRE `--dry-run` mentait (12)                        | `feedback_suspect_instrument_and_own_diff`   |
| 🪟 Un message d’erreur qui n’énonce QU’UNE cause (9)          | `feedback_error_message_names_all_causes`    |
| 🕳️ Un gate rend un verdict RASSURANT sur son angle mort (10)  | `feedback_prove_the_target_not_the_verdict`  |
| 📐 Le verdict BINAIRE d'un banc (5)                           | `feedback_verdict_discards_its_evidence`     |
| 🎭 Un test de CARACTÉRISATION grave un défaut (9)             | `feedback_test_discriminant_or_dead`         |
| 🪟 Un contrôle VERT qui ne POUVAIT rien voir (21)             | `feedback_gate_must_bite`                    |
| 🧾 Un RITUEL de pilotage qui coûte plus qu'il ne rend (5)     | `feedback_ritual_must_earn_its_keep`         |
| 🚪 Un fast-path standalone n'hérite de RIEN (2)               | `feedback_single_source_rule`                |
| 🕳️ Déclarer ABSENT ce qu'on n'a pas cherché (5)               | `feedback_capability_unreachable_is_absent`  |
| 🧪 Vérifier que la transformation a EU LIEU (57)              | `feedback_prove_on_received_artifact`        |
| 🧰 Un GATE excellent que personne ne lance ne garde rien (47) | `feedback_gate_must_run`                     |
| 🎯 Une ancre PLAUSIBLE et fausse (27)                         | `feedback_anchor_expires_silently`           |
| 🤝 Un sous-agent répond « INCHANGÉE » (9)                     | `feedback_delegation_balance`                |
| 🪤 Une garde peut EMPÊCHER ce qu’elle prétend gérer (20)      | `feedback_gate_must_bite`                    |
| 🔇 Ce qu’on COUPE pour mesurer (6)                            | `feedback_shell_false_diagnostics`           |
| 👯 Un JUMEAU non vérifié (6)                                  | `feedback_twin_alignment_unproven`           |
| 🎪 Le DÉCOR d’un banc est un état PARTAGÉ                     | `feedback_stale_decor_poisons_verdicts`      |
| 📖 Une DOC qui enseigne un geste dangereux (9)                | `feedback_agent_example_over_prose`          |

Snapshot : `archive/RETEX-snapshot-2026-09-10.md`.

**CONSOLIDATE 2026-08-24 :**

| Thème (frictions)                                                  | Destination                                      |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| 🔌🧪🎭 Le DÉCOR d'un banc : variable, pas dû ; ni celui livré (19) | `feedback_stale_decor_poisons_verdicts` (§ banc) |
| 🎯🔍⚖️🗣️ La sonde mesure-t-elle la CHOSE ? zéro muet (12)          | `feedback_prove_the_target_not_the_verdict` (§)  |
| 🏭🖨️ Le GABARIT n'est pas son RENDU — formater l'un ≠ l'autre (9)  | `feedback_dogfood_distributed_templates` (§)     |
| 🚦🐚🧾 Le code de sortie LU n'est pas celui MESURÉ (7)             | `feedback_shell_false_diagnostics` (§)           |
| 🎯🧰 La commande du DÉPÔT est l'autorité — le frère existe (7)     | **`feedback_repo_command_is_authority`** (neuve) |
| 🧪 Un test neuf peut FIGER sans discriminer (6)                    | `feedback_gate_must_bite` (§ figer)              |
| 📌 Un chiffre publié sans son COMMIT n'est pas réfutable (6)       | `feedback_measure_method` (§ 5)                  |
| 🩹🔁🧭 Corriger l'OCCURRENCE, pas le MOTIF — se recontaminer (6)   | `feedback_single_source_rule` (§)                |
| 🔎 Une ABSENCE de trace n'est pas une preuve (5)                   | `feedback_source_over_memory` (§)                |
| 🔗 « Valider la chaîne » = l'EXÉCUTER (5)                          | `feedback_prove_on_received_artifact` (§)        |

_Coupés au même passage (toutes frictions antérieures au CONSOLIDATE du 08-20, jamais reconduites) :_
🚦 contrôle de cible rouge · 🔇 mode machine qui coupe le journal · 📐 pourcentage de profil ·
🤖 `haiku` trompé 2× · 🕵️ cause temporelle commune · 🧭 leçon gravée dans UN artefact ·
🏷️ nom de variable déjà pris · 🧾 racine ≠ paquet · 🧰 réécrire le métier d'un outil ·
⛓️ gate en chaîne · 🎚️ valeur par défaut · 🎭 état sauvegardé sans identité · 🪟 Windows « après » ·
🖼️ rendu qui remplace · 🎲 variance d'un banc d'agent · 🪦 phrase qui justifie une absence ·
🤝 nom partagé entre paquets · 🕸️ interface sans son appelant · 🚚 déménager un artefact ·
🪞 serveur tolérant vs strict · 🚧 donnée arrêtée à la frontière · 🕳️ pointeur conforme ·
📏 cellule obèse · 🩺 montée de version · 🗣️ juge qui exige une sortie vide.
Snapshot : `archive/RETEX-snapshot-2026-08-24.md`.

**CONSOLIDATE 2026-08-20 :**

| Thème (frictions)                                             | Destination                                    |
| ------------------------------------------------------------- | ---------------------------------------------- |
| 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance (24)    | `feedback_prove_the_target_not_the_verdict`    |
| 🧪 Un gate ne prouve rien tant qu'on ne l'a pas vu ROUGE (14) | `feedback_gate_must_bite` (§ débranchement)    |
| 🧭 Annoncer une NORME sans l'avoir lue jusqu'aux ÈRES (10)    | `feedback_spec_conformance_vs_reachability`    |
| 📚 La doc officielle périme la mémoire (7)                    | `feedback_source_over_memory`                  |
| 🔬 Quatre instruments faux d'affilée sur UNE question (6)     | `feedback_suspect_instrument_and_own_diff` (§) |
| 🔦🧩 Une capacité qu'on n'ATTEINT pas n'existe pas (6)        | `feedback_capability_unreachable_is_absent`    |
| ⏱️ Un test qui attend un DÉLAI FIXE mesure la machine (5)     | `feedback_test_no_fixed_delay`                 |
| 🗣️🧭 Le user REPOSE la question · prémisse à vérifier (7)     | `feedback_user_repeats_question`               |
| 📦 npm : un arbre réparé à la MAIN n'est pas une garantie (5) | `feedback_npm_tree_not_a_guarantee`            |

_Coupés au même passage (antérieurs au 2026-08-06, déjà couverts par une mémoire graduée) :_
🧬 patron N fois · ⚖️ geste puni par l'outil · ⚙️ montée d'outil · 📖 API d'une lib maison ·
🔎 ce que le journal des commits cache · 🔴 gate rouge en permanence · 🛡️ garde posée/retirée ·
🕳️ import qui compile chez moi. Snapshot : `archive/RETEX-snapshot-2026-08-20.md`.

**CONSOLIDATE 2026-08-06 :**

| Thème (frictions)                                             | Destination                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 🧾🎛️ Paramètre accepté puis jeté · capacité au store (21)     | `feedback_param_accepted_then_dropped`                             |
| 📏🌡️🔬 Régime machine · fenêtre de banc · profil/in-situ (26) | `feedback_bench_machine_regime`                                    |
| ✅🚫🕳️ Données discriminantes · refus≠capacité · filet (22)   | `feedback_test_discriminant_or_dead`                               |
| 🥫🧬 Gabarits distribués · dogfooding · agent étranger (11)   | `feedback_dogfood_distributed_templates`                           |
| 🧰🎚️ Décor sale : serveurs, ports, stores, env de banc (10)   | `feedback_stale_decor_poisons_verdicts`                            |
| 📄 Une livraison n'entraîne pas sa doc · anchor-fix (6)       | `feedback_refactor_grep_consumers` (section doc)                   |
| 🧰 Formes shell : zsh `:A`, BRE `\{`, `rg -oh`, `&&` (6)      | `feedback_shell_false_diagnostics` (tableau)                       |
| 🗄️ Concurrence & dialectes (ESCAPE, ODKU, pool froid) (9)     | kit `project_orm_multidialect_chantier_kit` (§ Leçons dialectes)   |
| 📦 Surface npm & publication (6)                              | kit `project_release_nodefony10` (§ Pièges de surface npm)         |
| 🤖 Piloter un agent TIERS (6)                                 | kit `project_devkit_bench_agent_switch` (§ Piloter un agent tiers) |
| ⚖️🎯🎭 Juges, sondes de moyen, décor du banc (11)             | kit `project_devkit_bench_matrix` (§ Juges et sondes)              |
| 🔀 Deux appels au même traducteur (2)                         | fondu dans `feedback_param_accepted_then_dropped`                  |
| 📣 Commande maison filtrée par la familiarité (2)             | fondu dans `feedback_dogfood_distributed_templates`                |
| 🧹 Remise à zéro fichiers ≠ process (2)                       | fondu dans `feedback_stale_decor_poisons_verdicts` + kit matrix    |

**CONSOLIDATE 2026-08-02 :**

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

## 🩹 Un repli qui rend une ESPÉRANCE pour un FAIT — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_reliable_path_demoted_to_fallback`** (§ « Un repli qui rend une ESPÉRANCE pour un FAIT »).

## 📏 Le CHANGELOG résume, le titre approxime — GRADUÉ

- Les 9 frictions sont versées dans **`feedback_source_over_memory`** (§ « Toute affirmation ÉCRITE est crue sans être relue »). Règle anti-doublon : ne plus rien ajouter ici, verser là-bas.

## 🧪 Un banc comparatif dont les camps dérivent — GRADUÉ

→ [[feedback_measure_method]] (7 frictions) : contrôler ce que chaque camp CHARGE et pas seulement
ce qu'il écrit (deux instances du même ORM = +46 % faux), et se demander si la grandeur mesurée est
celle que le DÉCIDEUR regarde (`rss` contre `phys_footprint`).

- [1× — 09-17b] 🔴 **J'ai comparé deux mécanismes qui n'avaient pas la même FENÊTRE D'EXISTENCE, et
  j'ai failli en tirer une décision d'architecture.** « Les `references/` et les annexes sont à zéro
  sur 1020 transcripts » : vrai pour les premières (présentes depuis le 08-08), vide de sens pour les
  secondes, créées la VEILLE — elles n'avaient que 2 transcripts pour exister. C'est le user qui l'a
  relevé. Le contrôle qui manquait tient en une commande : `git log --diff-filter=A` sur chaque
  brique comparée, AVANT de mettre deux chiffres dans la même colonne. Corollaire : trois tâches
  plus tard, les trois mécanismes avaient servi au moins une fois chacun.

## 🎚️ Une méthode ÉCRITE et non IMPOSÉE ne s'applique pas — même quand on vient de la lire

- [1× — 09-21d] 🗺️ **J'ai déduit la surface d'une application de ce qu'UN module en montre — et
  bâti un correctif pour un trou inexistant.** Conclusion reprise d'hier : « le 2FA est
  inatteignable par HTTP, aucune route d'écriture ». Elle venait d'une lecture du data plane
  d'ADMINISTRATION, qui n'expose en effet que des lectures. `npx nodefony inspect routes` — la
  commande que le `CLAUDE.md` désigne en toutes lettres comme la voie de l'état RÉEL, et que je
  n'avais pas lancée — nomme `POST /nodefony/security/api/totp/{enroll,confirm,disable}`, le CRUD
  complet des webhooks et `webauthn/register/*`. Coût : un controller de sonde écrit, éprouvé,
  commité, puis RETIRÉ au commit suivant. Le fait de départ restait vrai (trois tables à zéro) ;
  seule la CAUSE était inventée — rien ne les exerçait. Le contrôle coûte une commande, et il
  répond à la seule question qui compte : ce que l'application EXPOSE, pas ce qu'un module déclare.
- [1× — 09-21d] 🎨 **La norme était écrite DANS le composant, et j'ai tâtonné trois fois avant de
  l'ouvrir.** Pour l'aide d'une ligne de classement : `title` natif, puis `Tooltip` Mantine, puis
  enfin `DocHint` — le user a dû refuser deux fois. La TSDoc de `DocHint.tsx` dit « bulle d'aide
  typée façon fiche de documentation (**≠ tooltip brut**) », prévoit le déclencheur personnalisé
  que je cherchais, et avertit même contre le `tabIndex` que j'avais ajouté. Trois allers-retours
  pour une page jamais ouverte. Le réflexe manquant n'est pas « demander la norme » mais « lire le
  composant qu'on s'apprête à contourner » — c'est lui qui la porte, pas une page de skill.

- [1× — 09-21] 📣 **Une capacité que RIEN N'APPELLE n'existe pas — et le skill affirmait qu'elle
  tournait.** `accueil-gate.mjs --basculer` savait porter les pages d'accueil au cran servi. Aucun
  workflow ne le lançait : il n'était CITÉ que dans un message d'erreur, et le geste vivait à
  l'étape 6 d'un « RESTE À FAIRE » imprimé en fin de publication. Le `SKILL.md`, lui, écrivait « la
  bascule des VERSIONS est désormais faite par la chaîne » — une automatisation INEXISTANTE, qu'on
  croit sur parole parce qu'elle est écrite au passé. Coût : l'accueil reste au cran précédent, et
  la garde ne s'en aperçoit qu'à la publication SUIVANTE, en la bloquant (alpha.4→5, puis
  alpha.7→8). Le contrôle qui tranche en dix secondes : `rg` le nom de l'option dans
  `.github/workflows/` — s'il n'apparaît que dans une chaîne de message, personne ne l'exécute.
- [1× — 09-21] 🧨 **Un script qui ÉCRIT avant de contrôler laisse un état que sa propre garde
  refuse de reprendre.** `release --write` estampille les quinze manifestes, PUIS régénère la page
  de manuel — dont le générateur refuse un `dist` périmé, à raison. Au refus, l'arbre portait une
  estampille sans changelog ni page, et la garde « arbre propre » interdisait de relancer : il a
  fallu défaire à la main ce que le script venait de faire, contre un hook qui protège justement
  l'arbre sale. L'ordre des étapes EST la correction — le contrôle remonte dans les gardes
  préalables, là où rien n'a encore bougé — et il ne se recopie pas : `generate-man.mjs --check`
  le porte déjà, on lui demande seulement de se prononcer plus tôt.
- [1× — 09-20c] 🆘 **Le pied de l'aide PROMET `--help` à toute commande ; un fast-path ne
  l'honorait pas, et PLANTAIT.** `nodefony see --help` prenait le drapeau pour un chemin de page et
  naviguait vers `https://127.0.0.1:5152--help`. La promesse était écrite — dans le pied de l'aide,
  et dans le TSDoc d'une autre commande (« une commande qui répond `option inconnue : --help`
  apprend au lecteur à ne plus croire le pied de l'aide ») — mais rien ne l'imposait aux
  fast-paths. Le banc qui l'impose EXISTAIT (`standaloneHelp.test.ts`, « aucun fast-path de
  CliKernel n'échappe à cette liste ») et nommait le trou en toutes lettres : il a fallu une passe
  complète pour que quelqu'un lise son verdict. Écrire la promesse ne suffit pas ; c'est le banc
  qui l'impose, et un banc dont personne ne lit la sortie ne l'impose pas non plus.

- [1× — 09-20b] 🎫 **J'ai ouvert un ticket sans chercher s'il existait déjà — le user a dû poser la
  question.** Le skill que je venais de charger dit en toutes lettres qu'un ticket « qui a peut-être
  déjà été fait se CONSTATE avant d'être repris », et la devise du dépôt est « la confiance n'exclut
  pas le contrôle ». Le contrôle coûtait UNE commande (`gh issue list --state all` sur titres ET
  corps) ; je l'ai faite APRÈS, sur demande. Verdict : aucun doublon, mais un voisin à distinguer
  explicitement (#205, qui range `scripts/` du dépôt et non ceux d'une app générée) — précisément ce
  qu'une recherche préalable aurait donné gratuitement.

- [1× — 09-19h] 🔴 **J'ai mis des liens de tickets dans cinq pages de doc publiques, alors que la
  règle était TRANCHÉE — et c'est le user qui m'a arrêté.** Le standard dit « pas de journal dans le
  corps : ni date, ni TODO, ni à venir » ; j'ai lu « avancement = les tickets » comme une
  autorisation de POINTER un ticket, quand la phrase veut dire « l'avancement n'est pas dans la
  doc ». Un `#NNN` dans une page publiée y introduit précisément le journal que la règle proscrit,
  et il se périme à la fermeture. La règle existait, je venais de la lire, et je l'ai inversée.
  **Le remède n'était pas de me le rappeler : c'est de l'écrire en toutes lettres dans le standard**
  (fait — avec l'exception du ticket AMONT, qui est un fait).

- [1× — 09-19g] 🔴 **Sept instruments faux dans une seule séance, tous écrits par moi, tous après
  avoir relu « suspecter son instrument ».** Cinq sur la passe de code mort (545 → 116 → 50 → 10 → 4) : entrées lues dans `exports` qui pointe le `dist` donc aucune source ; frontends Vite et
  modules ouverts par le Kernel comptés comme morts ; **un motif d'import qui interdisait le saut
  de ligne, donc aveugle à tout import multi-lignes** ; outillage (`*.config.ts`, `scripts/`)
  compté comme du produit ; alias posés par un plugin du bundler et par `tsconfigClient.json`.
  Deux sur la passe de dérive (1140 → 55) : chercher `class X`/`const X` rate toute méthode et
  tout champ, et **`execSync` n'a pas `rg` dans le PATH de `/bin/sh`** — le `|| true` transformait
  « outil absent » en « zéro résultat », donc en « tout est mort ». Aucun de ces sept n'a levé
  d'erreur : chacun rendait un chiffre plausible.
- [1× — 09-19g] 🔴 **J'ai donné au user une ESTIMATION comme si c'était une mesure, et elle a
  déclenché du travail.** « ~1/3 de vraies dérives » sur les 55 candidats : la mesure dit 7, soit
  13 %. Le user a validé la construction d'un gate sur cette phrase. Une fraction annoncée sans
  avoir compté est un chiffre inventé — il fallait écrire « je n'ai jugé que 6 cas sur 55 ».
- [1× — 09-19g] **Un sous-agent se trompe précisément sur le cas qui exige de connaître une règle
  du projet.** Les 55 symboles partis en `haiku` sont revenus « 49 légitimes » — juste sur trois
  des quatre que j'ai recontrôlés, faux sur le quatrième : `controlesSautes` classé « légitime »
  alors que la phrase le liste comme primitive EXISTANTE. C'était le seul qui demandait de savoir
  que le dépôt s'interdit les identifiants français — et c'est celui qui fondait tout le gate.
  Ce qu'on délègue sans donner la règle revient jugé sans elle.

- [1× — 09-19f] 🔴 **J'ai écrit cinq identifiants FRANÇAIS dans du code de production neuf, le
  LENDEMAIN du jour où le user me l'a fait remarquer** — et c'est `npm run check:lang` qui les a
  trouvés, pas moi (`décrits`, `largeur`, `lignes`, `muets`, `motif`, `groupe`, `cible`). Le
  `_state` de la veille prescrivait explicitement « lancer `check:lang` avant de proposer un
  commit » : je l'avais lu au RESUME du matin. Une règle relue ne protège pas au moment du geste ;
  seul un automate lancé le fait. Corollaire mesuré le même jour : le linter a attrapé ensuite un
  `no-shadow` que le renommage venait de créer — réparer à la main dans un fichier de 4 000 lignes
  fabrique son propre défaut, et il faut RELANCER le gate après l'avoir satisfait une fois.

- [1× — 09-19f] 🔴 **J'ai lancé la suite du cœur avec `npx vitest --root src/nodefony` depuis la
  racine, et récolté 49 faux rouges que j'ai failli instruire comme des régressions.** `--root`
  change la racine de vitest mais PAS le `process.cwd()` : les fixtures se résolvaient depuis
  `/<dépôt>/src/tests/finder/…` au lieu de `/<dépôt>/src/nodefony/src/tests/finder/…`, et
  `FileClass`/`Finder` levaient `ENOENT` sur des fichiers parfaitement présents. La commande du
  dépôt — `cd src/nodefony && npm test` — rend **4226 verts**. La règle est écrite et graduée
  ([[feedback_repo_command_is_authority]]) ; ce qui manquait, c'est de la suivre au lieu de
  composer une invocation « équivalente ». Un seul des 49 était vrai : la page de manuel, qui
  ignorait la commande que je venais d'ajouter.

- [1× — 09-19e] 🔴 **J'ai édité les sources PENDANT ma propre campagne `test:all`, et j'ai
  fabriqué 5 rouges que j'ai failli imputer au code.** La règle « ne jamais éditer les fichiers
  qu'un run est en train de lire » est écrite, je venais de la lire au RESUME du jour — et turbo a
  rebâti les `dist` au milieu des tests, produisant un `Cannot find module
'@nodefony/security/dist/index.js'` qui a aussi empêché le serveur de démarrer, donc la suite
  d'intégration de tourner. Relancée sur un arbre stable : 12 échecs → 7. Le geste qui manque n'est
  pas une relecture, c'est une barrière — un run long occupe l'arbre, et rien ne le dit.

- [1× — 09-19d] 🔴 **J'ai écrit un identifiant de production EN FRANÇAIS le jour où je venais de
  lire la règle qui l'interdit.** `DEJA_DANS_L_ETAT_VISE` dans `DrizzleMigrator.ts`, plus `valeur`
  / `exemple` dans `create.ts` — alors que le `CLAUDE.md` du dépôt ET le skill `framework-dev`
  chargé en début de session portent « LE CODE S'ÉCRIT EN ANGLAIS » en gras, avec son pourquoi.
  C'est le user qui l'a vu, pas moi. Ce qui l'a rattrapé ensuite n'est pas la relecture mais
  `npm run check:lang`, qui a d'ailleurs trouvé un quatrième cas que j'avais laissé (`motif`).
  Le contraste est net : la même session a respecté sans effort les règles PORTÉES PAR UN GATE
  (budget de la porte, format du rendu, largeur d'aide, commitlint) et a fauté sur la seule qui
  ne se déclenche qu'en y pensant. Corollaire pratique : lancer `check:lang` AVANT de proposer
  un commit, pas après qu'on me l'ait fait remarquer.

- [1× — 09-19c] 🔴 **Le mode rapide était écrit EN TÊTE du script, j'ai payé trois passes lentes
  avant de m'en servir.** `scripts/check-scaffold-format.mjs` porte ligne 26 :
  `--raw # le seul régime sans installation (~5 s)`. J'ai lancé la passe COMPLÈTE (4 apps
  installées, ~3 min) trois fois de suite pour corriger trois décalages d'une ligne vide — soit
  ~9 min d'attente pour ce qui prenait 15 s. Rien ne m'a caché l'option : elle est dans l'en-tête
  du fichier que j'avais ouvert pour comprendre le mode « rendu brut ». La règle générale : quand
  un outil du dépôt a un mode rapide, il est documenté à l'endroit où l'on cherche à le
  comprendre — c'est-à-dire trop tard si on ne le lit qu'après le premier échec.

- [1× — 09-19] 🔴 **Le TSDoc montrait la bonne forme, l'agent l'avait LU, il a écrit l'autre.**
  Session réelle d'un agent tiers : `ChatController.ts:37-45` porte l'exemple
  `RealtimeClient.shared({ url: "/api/live/realtime" })` — URL relative, façade résolvant seule le
  schéma. Il a ouvert ce fichier, puis composé dans sa page
  `location.protocol === "https:" ? "wss:" : "ws:"` — ce que `RealtimeClient.ts:335-339` fait déjà —
  et coupé la socket PARTAGÉE en croyant libérer son abonnement. La correction n'a pas été
  d'écrire mieux la prose : c'est le GABARIT de la page qui manquait l'exemple. Un exemple agit
  dans le fichier qu'on ÉDITE ; à côté, il informe.

- [1× — 09-19] 🔴 **Le skill que je venais de charger disait NOIR SUR BLANC de ne pas conclure d'un
  silence — j'ai conclu « le banc est figé ».** `nodefony-devkit-bench` porte l'avertissement en
  toutes lettres (« il suit un fichier, la sortie arrive par à-coups ») ; dix minutes plus tard, un
  flux immobile et un `find` qui rendait 0 m'ont suffi. Le run servait des requêtes HTTP à la
  seconde près. Lire une règle ne la met pas en place au moment du geste : c'est le geste qui doit
  la rappeler, d'où la section ajoutée AU skill (le CPU du process, jamais une date de fichier).

- [1× — 09-14c] 🔴 **J'ai mesuré cinq camps en séries séquentielles alors que les paires alternées
  sont documentées** dans l'en-tête de `bench-ab-mono.sh` ET dans le skill que je venais de
  charger. Rien ne les imposait : il fallait taper `A1 ; B1 ; A2 ; B2` soi-même. Chaque série était
  propre (dispersion ≤ 3 %) et le RAPPORT entre deux camps ne valait rien — c'est l'audit délégué
  qui me l'a fait remarquer, pas moi. Même famille que [[feedback_gate_must_run]], côté mesure :
  ce qu'aucun script n'orchestre n'est pas appliqué.
- [1× — 09-17] **Une consigne qu'on ne peut pas tenir se REFUSE au départ.** `soak.yml` acceptait `minutes=90`
  sur un job plafonné en dur à 60 : le run partait, mourait à 60 min 17 s, et ne rendait AUCUN artefact — la
  seule trace était un job tué sans explication. Le plafond dérive maintenant de l'entrée, et une garde refuse
  au-delà de ce que la forge tient. Un défaut par ACCEPTATION est plus coûteux qu'un refus.

- [1× — 09-17b] 🔴 **J'ai REPRODUIT, le lendemain, le faux vert que j'avais corrigé la veille.** La
  sonde « a ouvert une annexe » avait été réparée le 09-17 pour exiger un APPEL D'OUTIL, avec le
  motif écrit en quinze lignes de commentaire juste au-dessus. Le jour suivant, j'ai écrit la sonde
  voisine (`docs.mjs`) sur le CHEMIN NU — elle a rendu vert sur deux runs où le script n'avait jamais
  tourné, les correspondances venant de la ligne d'`AGENTS.md` que l'agent venait de lire. Avoir
  NOMMÉ le piège, et l'avoir nommé à cet endroit précis, n'a pas protégé : seul un cas de contrôle
  l'aurait fait. C'est l'argument entier du selftest — il a d'ailleurs refusé le motif dès qu'on
  le lui a donné.

- [1× — 09-18] 🔴 **Un renvoi REÇU, lu en entier, et pas suivi — mesuré 6 fois sur 6.** Le skill
  généraliste livré aux applications porte une table « quand passer la main ». Elle vivait en
  avant-dernière section : un agent qui arrêtait sa lecture à la ligne 200 sur 263 ne la voyait
  jamais. Remontée en tête (ligne 46), le problème a changé de nature sans disparaître — l'agent
  suivant a lu le fichier **jusqu'à la ligne 270 sur 269**, avait la table sous les yeux
  (`grep -c` le prouve sur son transcript), et ne l'a pas suivie : il a écrit une migration qu'il
  n'a jamais appliquée. Sur six exécutions, **chaque agent qui a chargé le skill de sa tâche a
  réussi, chacun de ceux qui ne l'ont pas chargé a échoué.** La table INVITAIT (« les prendre coûte
  moins que de chercher ») ; elle ORDONNE maintenant. La leçon n'est pas « le texte était mal
  placé » — c'était vrai et ça a été corrigé — mais qu'une fois la portée réglée, **il restait
  exactement le même défaut sous une autre forme**. Cf [[feedback_gate_must_run]] et la règle du
  `CLAUDE.md` sur la délégation : la disponibilité ne déclenche rien, seule la mention garantit.

## 🚨 Un contrôle qu'on ne peut pas SATISFAIRE finit désarmé — comme celui qui crie faux

- [1× — 09-22] ⚖️ **Le GABARIT prescrivait ce que le VÉRIFICATEUR condamnait — et le conseil
  rendu était dangereux.** Le `security.ts` que `create app` pose recommande en TSDoc, comme « le
  geste à préférer », une zone de firewall au pattern ÉNUMÉRÉ ouverte à l'anonyme ; `nodefony
doctor` comptait exactement ce bloc en manquement. Un agent du banc l'a appliqué — il avait lu la
  doc — et a récolté un rouge. La règle jugeait sur le seul `pattern`, sans jamais lire les
  `authenticators` : son raisonnement (« la prochaine route naîtra publique ») ne vaut que pour une
  zone qui PROTÈGE, et s'inverse terme à terme pour une zone qui OUVRE, où son conseil (« écris
  `^/api` ») ouvrirait l'espace entier. **Deux organes du même produit se contredisaient, et aucun
  test ne pouvait le voir : chacun passait les siens.** Le tort n'était pas côté gabarit — corriger
  celui-ci aurait dégradé un bon conseil pour contenter une règle fausse.
- [1× — 09-22] 🔍 **Le contrôle ne voyait qu'UNE zone sur N, et se taisait sur le reste.** Le bloc
  `areas` était découpé par une expression régulière qui s'arrête à la première accolade fermante
  peu indentée — donc à la fin de la PREMIÈRE zone. Un manifeste à cinq zones n'en faisait juger
  qu'une, sans un mot. Découvert par accident : mon cas neuf plaçait la zone fautive en DEUXIÈME
  position et restait rouge après le correctif. Une regex ne sait pas équilibrer des accolades —
  quand la cible est un bloc, il faut les compter. Même famille que le périmètre de lecture trop
  large ci-dessus, par l'autre bout : trop ÉTROIT, ça ne crie pas non plus.

- [1× — 09-21b] 👁️ **Un gate écrit le jour même est né FAUX VERT, et seul le débranchement
  l'a montré.** Il devait apparier les codes rendus par `board-lint.mjs` à la table de sa page de
  référence. Il cherchait `` `CODE` `` dans le fichier ENTIER — or la prose qui explique un code le
  cite deux lignes sous la table. Ligne de table retirée à l'essai : **vert**. Resserré sur les
  lignes `| \`CODE\``, il tombe. Sans l'essai, un contrôle mort partait en production de pilotage,
  avec l'air d'un filet. Le symptôme général : **le périmètre de LECTURE d'un contrôle, plus large
  que sa cible, ne crie pas — il se TAIT**, et c'est l'échec le plus cher à voir.
  Ce qu'il cachait, au passage : la table listait **11 codes pour 18 rendus**, et la prose annonçait
  tantôt « neuf » tantôt « onze » à trois endroits — [[feedback_anchor_expires_silently]] côté CHIFFRE.
- [1× — 09-21b] 🗓️ **Un critère de fin CHIFFRÉ n'est vrai qu'à l'instant où on le mesure.** #385
  s'est fermé sur « le compte d'alertes d'analyse de code rend `0` » — exact ce jour-là. Sept jours
  plus tard la même règle était remontée sur un fichier NOUVEAU, né après la clôture : le verdict
  avait été posé **site par site, à la main**, donc tout code neuf en rouvre une. Rien ne l'a dit —
  `code-scanning` n'apparaissait nulle part ailleurs que dans la config de l'analyse — et c'est le
  user qui l'a vue à l'œil. **Un critère de fin qui se mesure une fois n'est pas un gate : il ne
  garde rien dès le lendemain.** Croisement de [[feedback_gate_must_run]] et de
  [[feedback_fix_the_family_not_the_instance]] — le remede ferme le CAS, la famille reste ouverte.

- [1× — 09-21] ⛓️ **Un interblocage ADMIS devient une exclusion, et l'exclusion survit à sa
  cause.** Le gate de format du code généré était rouge à CHAQUE publication depuis l'alpha.3 : il
  installe l'application témoin depuis npm, or le gabarit épingle une version que la publication
  n'a pas encore créée (`ETARGET`). Le motif était juste ; la conclusion ne l'était pas — on en a
  fait une entrée de `WORKFLOWS_NON_BLOQUANTS`, avec son propre test asserant que son rouge rend
  VERT. L'interblocage ne tenait qu'à la SOURCE des paquets, pas au gate : celui-ci juge la FORME
  de fichiers rendus et n'a besoin du registre pour rien. **Une ligne** (`--link` sur les variantes
  qui installent) l'a rendu vert. Le signe qu'on est dans ce cas : l'exclusion ÉNONÇAIT sa
  condition de levée (« le jour où le banc ne dépendra plus du registre ») et personne ne l'avait
  relue depuis. ⚠️ Et la fenêtre de preuve est étroite : la correction ne se démontre que pendant
  que la version est estampillée et ABSENTE du registre — une fois publiée, le gate serait vert
  pour une raison qui n'est pas la sienne, et le retrait de l'exclusion se serait appuyé sur rien.
- [1× — 09-21] 🕳️ **« Je n'ai RIEN VU » et « il n'y a RIEN » sont deux états, et les confondre
  fabrique un faux rouge.** Le juge de CI traitait une liste vide comme une condamnation immédiate,
  alors qu'il faisait déjà la distinction pour une panne d'API (`runs = null` fait réessayer). Une
  exécution met quelques secondes à devenir interrogeable par `head_sha` : le contrôle de la
  vitrine a refusé à 22:05:10 un commit poussé à 22:04:51 dont les deux chaînes, créées à 22:04:54,
  ont fini VERTES. Le workflow avait POURTANT prévu le cas — une boucle qui attend qu'un run
  existe avant d'appeler le juge — mais elle vérifie une fois puis passe la main : la garde était
  au mauvais endroit. Remède : patience BORNÉE, dont l'épuisement est **injecté** (le cœur reste
  pur, l'appelant tient l'horloge), et défaut du paramètre à « sévère » pour qu'un appelant muet
  n'obtienne jamais la garde la plus laxiste.
- [1× — 09-20d] 🪞 **Un gate peut garder la COHÉRENCE de deux façades sans garder leur
  SINCÉRITÉ.** L'accueil affirmait « quatre dépendances de production », et `site-plan.test.mjs`
  vérifiait que ce chiffre suivait bien le gabarit. Les deux disaient vrai — et l'affirmation était
  fausse au sens où on la lit : l'application **installe 109 paquets** en production (155 en
  préréglage complet). Le gate comparait deux écritures entre elles, jamais l'une au terrain, et
  aucune de ses cinq assertions ne pouvait s'en apercevoir. Un chiffre public se démonte en un
  `npm ls` : il dit alors « ils enjolivent », ce qui coûte plus cher que de ne rien annoncer. Le
  geste qui répare n'est pas un meilleur gate, c'est une formulation qui survit à la vérification
  (« déclarées », plus ce que le chiffre n'est pas). Mesuré en générant puis INSTALLANT les deux
  préréglages, pas en lisant le `package.json`.

- [1× — 09-20d] 🧯 **Un gate qui REFUSE apprend la règle ; la même règle écrite ailleurs ne
  l'aurait pas apprise.** Le contrôle de format du scaffold a rejeté mon commit en nommant le
  motif exact — « une table markdown à lignes conditionnelles ne peut pas être alignée juste, en
  faire une liste ». Je ne connaissais pas cette contrainte, aucune lecture préalable ne me l'aurait
  donnée au bon moment, et le message portait le geste. C'est le contre-exemple utile du thème
  voisin : ce qui est IMPOSÉ au moment du geste s'applique, ce qui est écrit se rate.

- [1× — 09-20c] 🧮 **Deux bancs échouent SYSTÉMATIQUEMENT en passe complète et passent
  SYSTÉMATIQUEMENT seuls — ce n'est pas un flake, c'est une incompatibilité structurelle.**
  `clusterIpc.e2e` et `redisCluster.e2e` forkent de vrais workers dans une passe turbo qui sature
  déjà les cœurs : 7 rouges à chaque fois, 5/5 et 2/2 en isolation. Un rouge qui revient à chaque
  passe et qu'on sait faux est exactement le contrôle qu'on finit par ignorer — et le jour où il
  dira vrai, personne ne le lira. **SOLDÉ le 09-20d** (`60113234`) : lot `test:cluster` à part,
  gate `NF_RUN_CLUSTER_E2E` migré avec ses bancs, CI et `test:all -- --load` qui le jouent — passe
  complète 38/38 vertes. La cause lue au journal n'était pas celle qu'on croyait : le master
  expirait sur l'attente de `ready`, puis le worker écrivait dans un canal fermé et son `EPIPE`
  **remplaçait la vraie cause** dans la sortie. Même séance, même famille côté décor : la suite de charge HTTP/WS exige un serveur
  (`requires server`) et rendait 7 fichiers rouges en `ECONNREFUSED 5152` parce que mon script
  l'arrêtait juste avant.

- [1× — 09-20b] 🧭 **Ranger un fichier au bon endroit peut créer un rouge permanent — le choisir en
  connaissant les contrôles du dossier.** `BUG_REPORT.md` devait quitter la racine ; la cible
  évidente était `docs/`. Or `doc:lint` balaie `docs/` et n'a aucun régime pour un journal de
  travail : ni Lexique, ni Vision, ni Pièges. Le poser là aurait ajouté un rouge que personne ne
  peut fermer. Rangé dans `docs/session-retros/`, hors corpus par construction — le dossier des
  journaux d'agent, ce qu'il est. Le contrôle est resté à 189/198, inchangé.

- [1× — 09-19h] 🔴 **Les deux tiers des rouges d'un gate lui demandaient l'IMPOSSIBLE, et personne
  ne l'avait remarqué en des semaines.** `doc:lint` comptait 53 pages fautives ; **34 étaient des
  fiches de skill GÉNÉRÉES**, à qui l'on réclamait un lexique, une section « Pièges », un
  inventaire de tests et trois ancres `fichier:ligne`. Ces sections devraient être écrites DANS la
  page — or la page est réécrite à chaque `skills:doc`, et toute main y est effacée. Le réflexe
  était de les remplir (le user proposait même d'y mettre un agent en écriture) : ça aurait produit
  du texte détruit à la régénération suivante. Le bon geste est un **régime** de plus dans le gate,
  reconnu au champ `generated:`, et **corriger le GÉNÉRATEUR** pour le reste (`navTitle` : 28
  reproches d'un coup). **53 → 9 sans une ligne de remplissage.** Le signe qui doit alerter : quand
  un gate accuse un LOT homogène, ce n'est pas le lot qui est fautif, c'est le gabarit qu'on lui
  applique.
- [1× — 09-19h] 🔴 **L'écart entre deux chiffres du même gate était un PÉRIMÈTRE, pas une qualité —
  et j'ai failli traiter les 9 restants comme une dette.** `npm run doc:lint` rendait « 9 à
  corriger » quand l'étape de forge, qui ne reçoit que les pages PUBLIÉES, rendait **98/98**. Les 9
  pages ne sont pas publiées : elles ne bloquaient rien, et aucune n'aurait été vue par la CI même
  restée rouge. Le geste qui a évité une session de rédaction inutile : **rejouer la commande de la
  forge à l'identique** avant de conclure. Même famille que le gate du 09-19g qui ne tournait
  jamais — vérifier ce que reçoit la commande qui lance, dans les deux sens.
- [1× — 09-19g] 🔴 **J'allais livrer un gate qui aurait crié faux 49 fois sur 55.** Le contrôle
  visé — « un symbole cité par un fichier d'instructions doit exister » — paraissait évident.
  Mesuré avant de le brancher : sur 55 symboles absents du code, **49 étaient des mentions
  parfaitement légitimes** — un retrait énoncé en toutes lettres (« moteur Eta — pas de
  `renderTwig` », « `getCspDirectives` N'EXISTE PAS », « Drop au rétro-fit »), un travail futur
  (« aucun `KafkaBackplane` n'est codé »), une faute de frappe dont la page garde la trace
  (« ← was `ckeckPath` »), un nom emprunté à Symfony. Recentré sur les identifiants FRANÇAIS
  absents, qui n'ont aucune de ces lectures : 10 signalements, 0 faux. Le geste qui sauve n'est
  pas d'écrire le gate, c'est de **compter ce qu'il dirait avant de le brancher**.
- [1× — 09-19g] 🔴 **Un gate branché au bon endroit logique peut ne JAMAIS tourner.** J'ai mis le
  contrôle dans `doc-lint`, ce qui était juste — mais l'étage de forge qui lance `doc-lint` reçoit
  la liste de `build-docs-site.mjs --list`, c'est-à-dire les pages PUBLIÉES, dont les `CLAUDE.md`
  et `MEMORY.md` ne font pas partie. Le gate aurait existé, serait passé en revue, et n'aurait
  gardé rien. Il a fallu un drapeau `--instructions` et une étape de forge à part. Brancher un
  contrôle, ce n'est pas l'écrire au bon endroit : c'est vérifier **ce que reçoit la commande qui
  le lance**.

- [1× — 09-19f] 🔴 **Un banc qui s'ARRÊTE au premier rouge ne cache pas un détail : il cache tout
  ce qui suit — ici dix-sept étapes, dont une régression livrée la veille.** Le workflow « Code
  généré (3 systèmes) » était rouge depuis trois jours, sur 7 jobs et 3 systèmes, pour une cause
  triviale : le banc appelait une syntaxe de champ retirée du produit l'avant-veille. Réparer ce
  point a fait avancer le banc de 3 étapes à 21 — et révélé que `create entity X author:ref:Y`
  produisait un test ROUGE À LA NAISSANCE (clé étrangère inventée, refusée par la base depuis que
  les relations posent une contrainte), plus la même panne à travers HTTP (500 au lieu de 201).
  **Aucun de ces deux défauts n'était visible tant que le rouge trivial tenait la porte.** Un rouge
  ancien n'est pas « connu » : c'est un aveuglement qui grandit derrière lui, et son coût ne se
  mesure qu'en le réparant.

- [1× — 09-19f] **Un workflow VERT ne dit rien des ALERTES qui portent son nom.** Le user signalait
  « la CI rouge, CodeQL » ; les runs CodeQL étaient verts sur `main` — parce qu'un workflow d'analyse
  réussit dès qu'il a téléversé ses résultats, et ne rougit JAMAIS sur un finding. Ce qui était
  rouge vivait ailleurs : deux alertes ouvertes dans l'onglet Sécurité, plus une alerte de scan de
  secrets ouverte depuis huit semaines. Répondre « CodeQL est vert » aurait été exact et inutile.
  Deux surfaces, un seul nom : il faut regarder les deux, et le dire.

- [1× — 09-19e] 🔴 **Une sonde de décor qui constate une DISPONIBILITÉ n'a rien constaté : deux
  campagnes de suite ont rendu 7 rouges parce qu'une AUTRE application tenait le port.** Le banc MCP
  avait pourtant sa garde (`describe.skipIf`), et elle fonctionnait : elle demandait « quelque chose
  répond-il sur 5151 ? », à quoi l'application voisine du user répondait oui. Les assertions ont donc
  porté sur une application qui n'a aucune raison de déclarer les outils du dépôt, et le message
  d'échec parlait d'un outil manquant — jamais du fait qu'on interrogeait quelqu'un d'autre. J'ai
  d'abord soupçonné mon propre diff, ce qui était juste, puis il a fallu arrêter l'application
  voisine pour voir 17/17. Le remède (#433) est que la sonde demande son NOM à l'application
  (`nodefony_card` → `app.name`, comparé au manifeste racine) : une identité, pas un code HTTP.
  Ce que `start.sh` faisait déjà, lui, en refusant de tuer le runtime d'un autre projet — et c'est
  son refus, pas la sonde, qui a fini par nommer la cause.

- [1× — 09-19c] ✅ **Le contre-exemple, et il vaut d'être gardé : une sonde qui DÉCLARE d'avance
  le résultat qui la condamnerait rend son verdict lisible le jour où il tombe.** La sonde
  d'observation `a ouvert une annexe agents/nodefony/` portait en commentaire « un zéro franc
  dirait que le découpage a rendu le contenu inatteignable, et c'est le seul résultat qui
  condamnerait la structure ». Le run réel a rendu 1/10 — le verdict n'a demandé aucune
  interprétation, et la structure est tombée. Corollaire appliqué : la sonde devenait
  INSATISFIABLE après le retrait (plus aucune annexe à ouvrir), donc retirée dans le MÊME geste.
  Une sonde qu'on laisse derrière une capacité supprimée rend FAUX pour toujours.

- [1× — 09-19] 🔴 **Un juge qui s'ABSTIENT passe pour inoffensif — il ne garde rien.**
  `gate-porte-client.mjs` est inscrit dans la tâche 0 du banc devkit depuis toujours. Sans moteur
  front au manifeste il sort en code `2` — « l'INSTRUMENT ne sait pas quoi exiger, pas l'agent » —
  donc il ne rendait JAMAIS de verdict, et l'énoncé ne demandait aucune page. Un juge nommé dans la
  liste, compté dans les sondes, et muet depuis sa création : le run affichait PASS. L'abstention
  est plus discrète que le rouge ET que le vert — elle ne se voit ni dans le verdict ni dans le
  compte. Ce qui l'a révélé : avoir cherché ce qu'il ferait AVANT de le croire utile.

- [1× — 09-19] 🔴 **Mon motif a attrapé la PROSE qui interdit ce qu'il cherchait.** Un gate neuf
  refusait `new WebSocket` dans le code généré ; il tombait rouge sur le gabarit CONFORME, parce
  que celui-ci écrit « aucun `new WebSocket` à la main » dans son propre commentaire. Une assertion
  qui cherche une mauvaise pratique par son NOM trouve d'abord la documentation qui l'interdit.
  Resserrée sur l'appel (`new WebSocket(`, parenthèse comprise). Vaut pour tout gate de style :
  le texte qui proscrit un motif contient le motif.

- [1× — 09-19] 🔴 **J'ai ouvert un ticket qui qualifiait de BUG une convention délibérée.** #429
  affirmait que `orm:migrate:repair` et `orm:migrate:status --json` mentaient sur leur code de
  sortie. Ils ne mentaient pas : `1` signifie « action humaine requise » (`explain.ts:194`), la
  table est figée et des passes de déploiement s'arrêtent dessus (`|| exit 1`). Coder sur cette
  prémisse aurait cassé l'usage publié. Ce qui m'a arrêté est d'être allé lire la constante AVANT
  d'éditer — le vrai défaut était la DÉCOUVRABILITÉ (grille en TSDoc, invisible à qui tape la
  commande). Un ticket est cru sans être relu : écrire « c'est un bug » sans avoir vu la convention
  fabrique du travail faux.

- [1× — 09-18f] 🔴 **Un seuil bloquant aurait rendu un job rouge POUR TOUJOURS.** La chaîne de
  production que je venais d'écrire échouait sur toute vulnérabilité critique de l'image. Mesuré
  sur `node:24-slim` : `zlib1g` CVE-2023-45853 est marquée `will_not_fix` — aucune mise à jour ne
  la corrigera jamais. Le job aurait été rouge à chaque exécution, sans que personne ne puisse rien
  y faire, et il aurait fini par être retiré — emportant avec lui le contrôle du drain et de la
  topologie, qui eux prouvaient quelque chose. Il ne tranche donc plus que sur ce qui est
  **corrigeable** (`--ignore-unfixed`), la passe informative montrant tout. La question à poser en
  écrivant un gate n'est pas seulement « mord-il ? » mais « **peut-on le satisfaire ?** ».
- [1× — 09-18f] **Un garde-fou a mordu sur une CHAÎNE au lieu d'un geste.** Mon script d'édition
  Python contenait, dans son motif de recherche, le texte d'une commande de réécriture d'historique
  qu'il ne faisait que déplacer d'un fichier à l'autre. Le contrôle a refusé l'appel entier. Le
  remède était d'ancrer autrement — mais le coût est le même que pour un faux positif ordinaire :
  un contrôle qui refuse ce qui est sûr apprend à chercher comment le contourner.
  Même famille que [[feedback_gate_must_bite]], côté opposé.

## 🧹 Entretenir le SAS est un geste qui se rate comme un autre

- [1× — 09-17] **Mes propres frictions du jour ont été versées dans le MAUVAIS thème.** Le script
  d'insertion les a placées AVANT le titre visé — donc à la fin du thème PRÉCÉDENT. Deux d'entre
  elles seraient parties dans une mémoire qui ne les concernait pas ; attrapé en graduant, parce
  que la lecture du thème a montré des bullets étrangers à son titre. **Insérer « avant le titre
  suivant » et « à la fin du thème visé » sont deux gestes différents**, et rien ne les distingue à
  l'exécution. Le contrôle qui tranche : relire le thème APRÈS écriture, pas le diff.
- [1× — 09-17] **L'index `MEMORY.md` dépassait sa limite, donc des entrées n'étaient PLUS
  chargées** — 27 Ko pour 24,4 autorisés, sept lignes coupées en silence. Le fichier grossit d'une
  ligne d'état par session, et personne ne regarde son poids. Ramené à 23,2 Ko en groupant cinq
  états anciens. **Le CONSOLIDATE doit contrôler la TAILLE de l'index, pas seulement celle du
  sas** : un index tronqué fait perdre exactement ce qu'il existe pour rendre atteignable.
