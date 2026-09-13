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

## 🤝 Le terrain qu'on donne à un délégué — le salir ou le décrire de travers coûte un audit

- [1× — 09-13b] **DEUX sessions ont écrit la même implémentation du même ticket, à cinq minutes
  d'écart, et git ne pouvait pas le dire.** Isolé dans un worktree créé à 11 h 09, j'ai commité #366
  à 11 h 46 ; l'autre session a commité le sien à 11 h 51, directement sur `dev`. Aucune des deux ne
  pouvait voir l'autre : au moment où j'ai écrit, il n'y avait RIEN à voir. Le résultat est deux
  modules de prémisse concurrents (`premisse-admin.mjs` / `premisse-identite.mjs`) et deux
  auto-contrôles homonymes — exactement la duplication que « 1 RÈGLE = 1 implémentation » interdit,
  produite sans qu'aucune règle soit enfreinte. Ce que ça enseigne : **l'isolation par worktree
  protège des collisions de FICHIERS, pas des collisions de SUJET.** Le seul point de coordination
  qui existe est le ticket lui-même — un `gh issue view` juste avant d'écrire, et un `git fetch`
  juste avant de commiter, auraient rattrapé le second cas sinon le premier. Corollaire : quand
  deux travaux se recouvrent, comparer les DEUX et garder le meilleur (ici celui de `dev`, qui LIT
  le mot de passe dans le semis au lieu de le recopier) coûte moins cher que de fusionner les deux.

- [1× — 09-13b] **Un worktree sans `node_modules` fabrique des rouges qu'on impute à son propre
  diff.** 8 tests d'entité ont échoué ; j'ai d'abord conclu « c'est mon changement » après les avoir
  vus verts sur le dépôt principal — inférence FAUSSE, puisque le principal différait par DEUX
  choses (le diff **et** le build). La cause était le `dist` du module `user` absent du worktree. Un
  `npm run build` ciblé les a tous rendus verts d'un coup, et 4 rouges restants disaient « aucune
  entrée d'app résolue », c'est-à-dire encore le décor. Le contrôle qui tranche ne coûte rien :
  **mes commits touchent-ils seulement les fichiers concernés ?** (`git diff --name-only`) — c'est
  ce qui a prouvé, plus tard dans la même session, qu'un rouge du banc devkit ne venait pas de moi.

- [1× — 09-12e] **La piste que j'avais moi-même déposée dans un ticket était FAUSSE, et je l'ai
  suivie avant de regarder le terrain.** Le commentaire de #365 concluait, d'une observation faite
  en production, que le trou était « borné à l'environnement où le schéma se dérive du code ». En
  appariant commandes et sorties du transcript qui a motivé le ticket, l'application tournait en
  fait dans l'autre mode — et le défaut était DOUBLE, pas simple. Un ticket est cru sans être relu,
  y compris par celui qui l'a écrit : sa piste est une hypothèse datée, pas un acquis. Elle se
  vérifie comme une ancre, au moment où l'on s'en sert. Corollaire mesuré ici : le décor d'un banc
  n'est pas le décor par DÉFAUT — conclure du premier au second m'aurait fait corriger la moitié
  du défaut en croyant l'avoir fermé.

- [1× — 09-11h] **Le délégué a AFFIRMÉ avoir balayé un périmètre où il n'a rien vu — et il y
  avait cinq fichiers.** Inventaire des mentions de l'ancienne licence : le prompt NOMMAIT
  `src/nodefony/templates/**` parmi les emplacements souvent oubliés, le rapport a rendu 103
  occurrences, aucune là, et sa section « Non couvert » ne mentionnait pas ce dossier. Un `rg`
  de trois secondes en trouvait **cinq**, dont **quatre vitrines frontend qui AFFICHENT la
  licence dans toute application générée** — exactement le reliquat que le user redoutait. Le
  rapport avait par ailleurs raté `docker-compose.yml`, les deux scripts de publication et un
  écran de la console d'administration. Règle : un relevé délégué ne se répercute JAMAIS sans
  recompter d'un motif, et le motif se choisit sur le CONCEPT (ici « cecill »), pas sur la
  liste de fichiers que le délégué a bien voulu rendre. Ce que le modèle rend est un CONTEXTE,
  l'exhaustivité vient de l'automate — c'est écrit dans la description de l'agent, et je ne
  l'ai pas appliqué.

- [1× — 09-11g] **Un délégué `haiku` a EXTRAPOLÉ au lieu de lire — 84 verdicts fabriqués, dont une
  partie juste.** Chargé de confronter 84 ancres de doc au code (verdict binaire + preuve, le cas
  d'école de la délégation mécanique), il a rendu un tableau complet et présentable où la « ligne
  juste » vaut l'ancre **+ 18**, item après item. Son propre préambule le disait : « tous les
  éléments suivent un pattern clair ». Contrôle sur trois items : un juste, un faux
  (`Kernel.ts:542` = `environment`, pas `get varDir()`). Le lot a été rejeté EN BLOC — trier le vrai
  du faux aurait coûté plus cher que refaire. Deux leçons : (a) sur une liste longue et régulière,
  demander la preuve CITÉE (le texte de la ligne) et non le seul numéro, qui ne coûte rien à
  inventer ; (b) un rendu dont la colonne de résultat suit une ARITHMÉTIQUE constante est un signal
  de fabrication, pas de rigueur. Le déclencheur de délégation était pourtant bon (84 items ≫ seuil) :
  c'est la VÉRIFIABILITÉ du rendu qui manquait.

- [1× — 09-08c] **Un décor de démonstration posé dans un fichier qu'un sous-agent analysait.**
  Pour montrer un bouton à l'écran, j'avais réintroduit une entrée de configuration factice dans le
  fichier même que l'audit en vol devait juger. Rattrapé par un message au délégué (« ce bloc n'est
  pas du code du dépôt, l'état de référence est HEAD »), mais le réflexe manquait : avant de salir
  un fichier, se demander qui d'autre le lit EN CE MOMENT.

- [1× — 09-08c] **La question du user reformulée de travers a produit un audit à côté.** « Mettre
  la config dans un module » a été transmis comme « dans le paquet npm `@nodefony/security` », alors
  que le user parlait de SA config d'application. L'audit a donc argumenté longuement contre une
  option que personne ne proposait (secrets dans un paquet publié). Une reformulation n'est pas
  neutre : c'est elle que le délégué prend pour la question. La relire en se demandant « est-ce
  bien ce qu'on m'a demandé ? » coûte dix secondes, l'audit coûte des minutes et des tokens.

- [1× — 09-08c] **Mon propre commit a périmé des ancres de doc, et je ne les ai pas recalées en
  fermant.** L'ajout de deux clés au schéma a décalé une trentaine de lignes : quatre ancres
  `fichier:ligne` d'une page publique pointent désormais un commentaire ou une parenthèse. J'avais
  pourtant recalé la PROSE de cette page dans le même commit. Le protocole de fermeture nomme les
  trois recalages (code, tickets voisins, documentation) — j'ai fait le troisième à moitié, et
  c'est la moitié invisible qui a sauté. Voir [[feedback_anchor_expires_silently]].

- [1× — 09-10c] **Le juge s'est trompé sur le point qui décidait de tout — et il avait l'air
  sûr.** Un audit délégué en `fable` (image de conteneur, volumes, réseau) a rendu un travail
  excellent, ancré `fichier:ligne`, avec UNE affirmation fausse : « il manque un réglage produit
  absent — aucun moyen de désactiver le service de fichiers statiques ». Or `statics.enabled`
  existe, et sa propre description prescrit exactement l'usage visé. C'est la seule affirmation
  qui conditionnait le verdict d'un chantier entier. Elle a été rattrapée parce que je vérifie les
  affirmations graves avant de les répercuter — pas parce qu'elle détonnait. Le rapport a été versé
  au ticket AVEC sa réserve en tête, plutôt que corrigé en silence : le lecteur doit savoir qu'un
  passage est faux, pas découvrir un texte retouché.

- [1× — 09-11d] **J'ai donné au délégué une prémisse FAUSSE, et c'est lui qui l'a corrigée.**
  L'audit devait comparer le `Dockerfile` du dépôt à celui des gabarits — « les jumeaux ». Le dépôt
  n'a PAS de Dockerfile : la source est unique, et le workflow de publication le dit en toutes
  lettres. Le rapport s'ouvre donc sur « prémisse de Q4 fausse », suivi du `ls` qui le montre. Bien
  rendu, mais c'est un quart de question payé pour rien, et le risque était qu'un modèle moins
  regardant fabrique une comparaison plausible entre deux objets dont l'un n'existe pas. Une
  question posée dans un prompt affirme ; ce qu'elle affirme se vérifie comme une ancre.

## 🔭 Un contrôle qui ratisse trop large crie faux — et on lui apprend à être ignoré

- [1× — 09-13] **Mon contrôle passait par une AUTRE garde que celle qu'il annonçait — vert, et
  complaisant.** « Des flux injectés retombent sur le readline » devait éprouver la garde
  d'identité des flux (`input !== process.stdin`). Il passait — mais par la garde TTY, un banc
  vitest n'ayant pas de terminal : retirer la garde d'identité ne le faisait PAS tomber. Le
  débranchement l'a révélé, pas la lecture. Remède : **feindre l'autre condition**
  (`process.stdin.isTTY` forcé à `true`) pour que le contrôle ne puisse plus être satisfait que
  par ce qu'il nomme. La leçon générale : quand deux gardes protègent le même cas, un contrôle
  écrit sur l'une est vert grâce à l'autre — et seul le débranchement de LA garde visée le dit.

- [1× — 09-12f] **Mon assertion visait un MOT là où le fait porte sur une AFFIRMATION — et une
  négation contient le mot qu'elle nie.** Le refus corrigé devait cesser d'accuser « les droits »
  et « la base qui n'a pas répondu » ; j'ai écrit `doesNotMatch(/droits|n'a pas répondu/)`, et il
  est tombé rouge sur ma propre phrase « ce n'est PAS une question de droits » — celle qui prouve
  justement que le défaut est corrigé. Le contrôle juste vise ce qui DISTINGUE les deux états :
  ici le code de refus (`NF_GENERATE_TOOL_FAILED` contre `NF_MIGRATE_UNAVAILABLE`) et la
  formulation du fourre-tout, pas un mot du vocabulaire commun aux deux.

- [1× — 09-12d] **Ma garde anti-destruction refusait sur une application FRAÎCHE** — donc sur le
  cas normal. Première version : « une table d'identité porte au moins une ligne ⇒ refus ». Or une
  application générée porte TOUJOURS le compte d'administration que son semis repose à chaque
  démarrage : il n'y a rien à perdre, et l'on aurait appris à taper les deux drapeaux par réflexe.
  Le remède n'est pas de relâcher le refus mais de lui donner un SEUIL qui dit ce que la perte
  coûte vraiment (`reseededRows` : ce qu'un semis repose tout seul). Le cas vécu qui fonde la
  garde avait trois comptes, dont deux créés à la main — le seuil mord là, et se tait avant.
  Corollaire : j'ai aussi dû RETIRER `access_token` de la liste (un jeton se réémet par un login) ;
  le garder faisait crier la garde sur toute base un peu utilisée, soit toujours.

- [1× — 09-12b] **La sonde regardait le bon motif dans le mauvais FICHIER — trois passes
  d'agent payées pour un faux rouge, et il est GRAVÉ dans la référence.** Tâche 17 du
  banc devkit, `PASS 3/3` → `FAIL 0/3` : la sonde cherche une zone de firewall dans
  `nodefony.config.ts`, or elles vivent dans `nodefony/config/security.ts` depuis que la
  configuration est extraite en fragments. Le commentaire de la sonde AFFIRMAIT la règle
  périmée — « une zone vit dans le manifeste, et nulle part ailleurs » — ce qui a figé
  l'erreur mieux que le code. Deux signes qui auraient dû alerter plus tôt : **tous les
  gates de la tâche étaient verts**, seule la sonde de code tombait ; et l'agent avait
  fait exactement ce que le gabarit lui montre en exemple. Règle : un ancrage `file:`
  dans une sonde se rejoue contre une app RÉELLE (`grep -c` dans les deux emplacements)
  à chaque fois que la structure du produit bouge — et une phrase d'exclusivité dans un
  commentaire (« et nulle part ailleurs ») est une date de péremption qui ne se voit pas.
  [[feedback_bench_probe_false_verdicts]]

- [1× — 09-12] **La garde que j'ai écrite aurait INTERBLOQUÉ toutes les publications.** Pour
  qu'un tag ne publie pas sur une CI rouge, j'ai exigé le vert de TOUS les workflows du commit,
  exclusions nommées à part. Or l'un d'eux (`Code généré`) installe l'application générée DEPUIS
  le registre npm : sur un commit d'estampillage, `^10.0.0-alpha.N` n'existe pas encore — c'est la
  publication que le tag déclenche qui la crée. Il est donc rouge par CONSTRUCTION sur tout commit
  de release (vérifié sur alpha.3, alpha.4, alpha.5), et exiger son vert bloquait la seule action
  capable de le rendre vert. Le défaut ne s'est vu qu'en confrontant la garde à l'HISTORIQUE des
  runs, pas en la relisant. Règle : avant d'exiger le vert d'un contrôle, se demander si l'action
  gardée est ce qui le rend vert — une garde circulaire a l'air d'une garde rigoureuse.

- [1× — 09-11g] **L'inverse, et il est plus dangereux : un contrôle qui ratisse trop ÉTROIT rend un
  vert.** Le gate des descriptions de commandes, étendu aux modules, filtrait sur
  `class X extends Command` — ce qui écartait EN SILENCE les sept commandes ORM, qui héritent d'une
  base intermédiaire (`OrmMigrateCommand`), dont la seule qui débordait. Sept verts pour une
  population amputée de moitié. Trois gardes ont été ajoutées : un plancher sur le nombre d'items
  lus, un cas qui ÉCHOUE si un fichier éligible ne livre rien de mesurable, et la distinction
  explicite entre « rien à mesurer » et « délègue à ses filles ». La règle : un contrôle qui
  SÉLECTIONNE sa population doit prouver la taille de cette population, sinon son vert ne parle que
  de ce qu'il a bien voulu regarder. Même famille, même jour : le contrôle d'ancres de doc était
  aveugle à `scripts/`, et rendait FILE_NOT_FOUND sur une ancre JUSTE.

- [1× — 09-11f] **`doc:lint` livré sur tout le corpus rendait 626 rouges sur 729 pages.** La cause
  n'était pas la doc : **553 des 729 pages sont des retex ARCHIVÉS**, des documents datés qu'on ne
  republie jamais, jugés au standard d'une page de référence. Un contrôle dans cet état n'est pas
  sévère, il est inutilisable — et le jour où il a raison, personne ne le lit. Le périmètre d'un
  gate se BORNE avant de le livrer, et le bornage est une décision à écrire (ici : ce qui vit sous
  un dossier `docs`, archives exclues).

- [1× — 09-11f] **Le gate d'ancres a signalé une ancre JUSTE.** `webauthn.md:647` → `AuthStore.ts:209`
  est exacte ; le gate cherchait `nodefony` et `profile` parce que la phrase cite le chemin d'URL
  `/nodefony/profile` — il a pris un chemin pour un symbole. « Corriger » l'ancre pour faire taire
  le contrôle aurait fabriqué une ancre fausse à partir d'une vraie. Un verdict d'outil se LIT avant
  d'être suivi, surtout quand l'outil dit lui-même qu'il a des angles morts.

- [1× — 09-11f] **Un gate neuf est resté VERT en satisfaisant la LETTRE.** Le contrôle exigeait que
  le guide d'une app nomme la liaison cliente de son moteur front ; une énumération des quatre
  liaisons le satisfaisait — donc une page qui n'apprend RIEN à l'agent passait. Ce qui l'a fait
  mordre est le volet inverse : exiger l'ABSENCE des trois autres. Quand un gate passe du premier
  coup sur un défaut réel, c'est l'assertion qu'il faut suspecter, pas le code.

## 🪤 Ajouter un CAS à une table réveille les hypothèses que ses lecteurs n'avaient jamais écrites

- [1× — 09-12c] **Une garde rangée dans une branche ne garde que cette branche.** Le banc
  refuse (exit 78) un canal `local` qui exigerait un registre interposé — mais ce refus
  vivait dans la fonction de montage du décor. En ajoutant un décor VIDE qui saute ce
  montage, j'ai rendu la garde inatteignable **sans la toucher** : `--task 0` partait jouer
  sur un canal que npm ne sert pas. Un chemin neuf ne contourne pas seulement du code, il
  contourne les gardes que ce code portait ; la garde remonte donc dans le lanceur, où elle
  vaut pour tous les chemins. Vue mordre après coup.

- [1× — 09-11] **Un test prenait un NOM RÉEL comme contre-exemple, et le nom est devenu réel.**
  `agentTargets.test.ts` vérifiait le refus d'une clé inconnue avec `requestedAgents("claude,cursor")`.
  Le jour où `cursor` est entré dans la table, le test est passé au VERT en prouvant l'exact
  contraire de ce qu'il affirme — aucun signal, il ne rougit pas. Un contre-exemple se choisit
  parmi ce qui ne peut PAS exister (`agent-qui-nexiste-pas`), jamais parmi ce qui n'existe pas
  ENCORE.

- [1× — 09-11] **`flag: "wx"` lève ENOENT — qui n'est pas EEXIST — quand le dossier parent manque.**
  Tous les pointeurs d'instructions vivaient à la racine ; le premier posé en SOUS-DOSSIER
  (`.github/copilot-instructions.md`) sortait du `catch (EEXIST)` et faisait échouer la création de
  l'application ENTIÈRE pour un fichier d'appoint. La forme d'une valeur (un chemin à un segment)
  était une hypothèse tacite du code qui la consommait.

- [1× — 09-11] **Une garde inoffensive le reste tant que personne n'ÉCRIT.** `targetsToDeclare`
  faisait entrer tout agent détecté dont le canal n'était pas `cli` — sans danger, ces agents-là
  n'écrivaient rien. Le canal neuf, lui, ÉCRIT : la même ligne aurait posé un fichier chez un outil
  que personne n'a nommé, sur la seule foi d'un `.vscode/` présent. Élargir un ensemble, c'est
  relire ce que chacun de ses lecteurs en FAIT — pas seulement ce qu'il en lit.

## ⚙️ Réutiliser du code d'un SCRIPT, c'est le RELANCER

- [1× — 09-12b] **Déplacer une règle dans un autre module rend MUETTES les mutations qui
  la visaient.** En sortant `canalDe` et `VERSION_EXACTE` vers un module partagé, deux
  mutations `--prove` du selftest d'origine ont perdu leur ancre : elles ne mutaient plus
  rien. Le contrôle l'a DIT (« ancre introuvable — mutation MORTE ») au lieu de rendre un
  vert tranquille, et c'est la seule raison pour laquelle ça s'est vu. Règle : après tout
  déplacement de règle, relancer les `--prove` **avant** de croire au vert — un test de
  mutation dont l'ancre a bougé passe silencieusement de « garde » à « décor ». Corollaire
  de conception : une mutation doit ÉCHOUER bruyamment quand sa cible disparaît, jamais
  être ignorée.

- [1× — 09-11] **Un `grep` sans correspondance TUE un script sous `set -euo pipefail`, sans un
  mot.** Ajouté un contrôle au banc de publication ; son `grep -o` ne trouvait rien (l'application
  était éteinte à cet endroit), a rendu 1, et `set -e` a arrêté le script — donc sans passer par
  `fail`, donc sans message d'échec ET sans nettoyage : quatre conteneurs laissés debout, et un
  journal qui s'interrompt au milieu sans rien dire. Le script documentait déjà le piège JUMEAU
  (`grep -q` qui ferme le tuyau et rend 141). Tout `grep` en substitution de commande y prend
  `|| true`.

- [1× — 09-07f] **Repayé le jour même où je l'ai lu.** Un test qui importe `ticket-effort.mjs`
  pour éprouver deux fonctions pures relançait tout le script : appels réseau, lecture de git,
  affichage. Le voisin `ticket-open.mjs` portait pourtant déjà la garde
  (`if (process.argv[1]?.endsWith(...))`). Une garde d'exécution n'est pas une précaution de style :
  c'est ce qui rend un script IMPORTABLE, donc éprouvable.

- [1× — 09-05i] **`import()` d'un script pour « vérifier qu'il charge » l'EXÉCUTE.** Voulant
  prouver que trois scripts du banc importaient encore, j'en ai démarré un vrai (banc de scaffold,
  tué à la main). Un module au corps non trivial n'a pas de mode « je regarde seulement » : pour
  éprouver une chaîne d'imports, lancer l'auto-contrôle prévu — ici `exec-portable.selftest.mjs`,
  qui traverse le même module partagé et rend un verdict.

- [1× — 09-02] **Un module qui agit à l'import rend le contrôle de son IMPORTATEUR illisible.** Un décor de banc importait deux fonctions pures d'un décor frère ; celui-ci lançait son auto-contrôle sur `process.argv.includes("--selftest")`, au niveau module. Lancer le contrôle du NOUVEAU déclenchait donc aussi celui de l'ancien, et son rouge se serait affiché sous le mauvais nom. La forme sûre existait déjà dans le dépôt (`process.argv[1]?.endsWith("<ce fichier>")` d'abord, le drapeau ensuite) — elle n'avait simplement pas été appliquée partout.

- **Importer `test-all.ts` pour une seule fonction relançait l'infra, le build et la batterie
  entière.** Un script n'est pas une bibliothèque : son corps s'exécute à l'import. Ce qu'on veut
  partager se SORT du script d'abord (`scripts/lib/docker.ts`), sinon « réutiliser » veut dire
  « relancer ». Le symptôme était visible — `npm run coverage` affichait la bannière de la batterie
  de tests — mais il aurait pu ne pas l'être. [1× — 08-26]
- **Poser la variable d'un service ABSENT ne rend pas les tests skippés : elle les fait ÉCHOUER.**
  `NF_LOKI_TEST_URL` posée sans Loki → 4 tests du cœur rouges, module entier sans rapport, et le
  rouge imputé au produit. Un banc qui n'a personne au bout de son URL ne se tait pas, il tombe.
  Constater la santé du conteneur AVANT de poser quoi que ce soit. [1× — 08-26]

## 🙈 L'outil ALTÈRE sa propre sortie — et ce qu'il avale passe pour une réponse

- [1× — 09-13] **Citer un ticket dans le CORPS d'un commit le fait passer « en cours » — je l'ai
  fait à quatre tickets sans les toucher.** Mon message de #367 disait « les 2 problèmes de ports
  relèvent de #62, #214 et #154 » — une phrase d'orientation, pas de travail. Le hook post-commit
  (`ticket-progress.mjs`) ne lit pas l'intention : il voit `#N` sans fermeture et monte le statut.
  Résultat : #62 et #154 affichés « en cours » alors que rien ne les avance, et le seul commit
  « de travail » que `git log --grep` leur trouve est le mien, qui parle d'autre chose. Le user l'a
  vu avant moi (« pourquoi 154 n'est pas fermé ? »). Deux conduites : **nommer un ticket voisin en
  COMMENTAIRE d'issue plutôt que dans un message de commit** — c'est là que ça se lit — et ne pas
  sauter l'étape 4 du END, seule à faire redescendre un statut que rien ne fait descendre tout seul.

- [1× — 09-13] **Un compte BRUT n'est pas le compte utile — facteur 16 sur un chiffre de
  ticket.** Pour dimensionner un ticket d'internationalisation, mon premier relevé donnait
  « 3 222 lignes françaises dans les gabarits d'application ». Trié, c'est **203 chaînes
  affichables** dans 38 fichiers : les 2 256 autres étaient des lignes de COMMENTAIRE du code
  généré, qui ne se traduisent pas. Écrit tel quel, le chiffre aurait fait dériver l'estimation
  d'un ordre de grandeur — exactement le défaut que le skill `nodefony-ticket` cite déjà
  (« 437 ancres » qui valaient 108). **Avant qu'un chiffre entre dans un ticket, dire ce qu'il
  COMPTE** — ici « chaîne affichable », pas « ligne portant un accent ».

- [1× — 09-13] **`awk '{ if (length($0) > 80) … }'` compte des OCTETS, pas des caractères — et
  tout corpus accentué « déborde ».** En contrôlant la largeur des pages d'aide du CLI, j'ai
  annoncé au user trois lignes trop longues : `--agents … développement …` mesurait « 81 » pour
  79 caractères réels, et les titres de section « 214 » à cause des `─` (3 octets chacun). Les
  trois étaient FAUX. Rejoué en Python (`len(ligne)`), zéro débordement — et les vrais, eux,
  existaient ailleurs. La règle : **une largeur d'affichage se mesure en caractères** ; `awk`,
  `wc -c` et `cut -c` mentent sur du français, donc sur tout ce dépôt. Corollaire, plus dur : un
  faux positif de mesure fait « corriger » du texte qui allait bien.

- [1× — 09-12e] **`>/dev/null 2>&1` sur un maillon d'une chaîne `&&` fait passer un ÉCHEC pour un
  succès silencieux.** En voulant abréger une séquence de preuve, j'ai écrit
  `create entity … >/dev/null && orm:generate … >/dev/null && cat le-fichier` : la génération
  refusait, la chaîne s'arrêtait, et les deux commandes suivantes n'ont RIEN affiché. J'ai lu ce
  vide comme « le fichier est vide », pas comme « rien n'a tourné » — le diagnostic est parti dans
  la mauvaise direction jusqu'à ce que je relance sans masque. La règle vaut au-delà du `>/dev/null` :
  **une chaîne `&&` dont un maillon est muet ne distingue plus « a échoué » de « n'a rien produit »**.
  Masquer une sortie est acceptable pour du bruit connu, jamais pour la commande dont on va lire le
  résultat.

- [1× — 09-12d] **`sed -i '' 's/\bmot\b/autre/'` ne remplace RIEN sur macOS, et sort 0.** Le
  `\b` de GNU n'existe pas dans le `sed` BSD : la commande réussit, le fichier est inchangé, et
  l'étape suivante (`check:lang`) est passée au vert — elle ne voyait pas le barbarisme resté en
  place parce que ce n'était pas un mot français. J'ai donc cru un renommage fait, deux fois, et
  c'est un `grep` de contrôle qui l'a dit. Règle : après un remplacement en masse, RECOMPTER les
  occurrences restantes ; un code de sortie 0 d'un `sed` ne prouve aucune substitution.
- [1× — 09-12d] **Un build en ÉCHEC a laissé mesurer l'ancien `dist`.** `turbo run build` sort en
  2 sur une erreur TS, et la commande suivante du même appel a tourné sur l'artefact précédent —
  concluant que la garde que je venais d'écrire « ne mordait pas ». Le chaînage sans `&&` est le
  coupable, mais la leçon est plus large : AVANT de mesurer, constater que la transformation a eu
  lieu (code de sortie du build, ou empreinte de l'artefact).

- [1× — 09-12c] **Neuf mutations « toutes vues tomber » tombaient sur un import non résolu.**
  Le `--prove` d'un auto-contrôle copiait le module muté dans `/tmp` ; depuis qu'un voisin
  en avait été extrait, ce module l'importait en relatif — Node sortait en
  `ERR_MODULE_NOT_FOUND`, code non nul, et le lot comptait « le contrôle tombe » pour
  CHAQUE mutation, y compris une mutation **inoffensive**. Le commit qui l'a introduit
  annonçait « 9 mutations, toutes vues tomber » : elles tombaient, pas pour leur règle.
  Le remède n'est pas le déplacement du fichier mais la **ligne TÉMOIN** — une mutation qui
  ne change rien et doit rester VERTE. Posée, elle a immédiatement révélé qu'une de mes
  mutations neuves ne prouvait rien non plus (elle mutait un libellé, la règle comparait
  une clé). Un contrôle qui tombe n'apprend rien tant qu'on n'a pas montré qu'il sait aussi
  ne PAS tomber.

- [1× — 09-12c] **Quatre fichiers de test demandés, deux joués, « 2 passed » affiché.** Un
  juge lançait `vitest run <4 fichiers livrés>` : le gabarit range le bout en bout sous
  `vitest.e2e.config.ts`, que la config ordinaire EXCLUT. Les deux absents étaient
  précisément ceux qui frappent le serveur en anonyme — les seuls que le défaut cherché
  fait tomber. Le rapport ne les mentionne ni comme réussis ni comme sautés : ils
  n'existent pas. Et le contournement a son propre piège : avec un serveur déjà sur les
  ports, la suite e2e rend « No test files found » et sort en 1 **sans jouer une ligne** —
  deux verdicts opposés pour la même application. Ce qu'une suite a JOUÉ se relève sur SA
  sortie, jamais sur la concaténation des suites.

- [1× — 09-12b] **`lint-staged` a RESTAURÉ ma correction, et j'ai cru avoir mal édité.** Le
  commit refusé par le lint, je corrige la ligne fautive, je relance — même erreur, même
  ligne. Deuxième correction, même refus. La cause n'était pas mon édition : à chaque
  échec, `lint-staged` affiche « Reverting to original state » et **remet les fichiers
  stagés dans l'état d'avant**, ma correction comprise. Le message est pourtant à
  l'écran, en clair. Règle : quand une correction « ne prend pas » deux fois de suite,
  **relire ce que l'outil dit AVOIR FAIT** avant de suspecter son propre diff — et
  vérifier le fichier sur le disque (`sed -n '<n>p'`), pas la mémoire de ce qu'on a écrit.

- [1× — 09-12] **`cmd > log 2>&1; echo "EXIT=$?"` en tâche de fond rend le code du `echo`.** Le
  harness a rapporté « exit code 0 » pour un `test:all` qui avait SIX tests rouges, et j'ai failli
  enchaîner sur la publication. Ce qu'il faut écrire : `{ cmd; echo "EXIT=$?"; } > log 2>&1`, pour
  que le code parte DANS le journal — puis le relire là, jamais dans le verdict du lanceur.

- [1× — 09-12] **Une sonde qui ne peut JAMAIS rendre un vert n'attend pas : elle brûle son délai,
  puis laisse passer.** L'attente de propagation npm lisait `npm view <nom> versions --json`, qui
  rend un TABLEAU DE CHAÎNES, avec un filtre qui ne gardait que les entrées OBJET : verdict
  « aucun paquet servi » à chaque tour. Mesuré : 32 tours, 302 s — la limite entière — pendant que
  les quinze paquets étaient servis depuis plusieurs minutes. Le symptôme qui trahit : un compteur
  qui ne DIMINUE jamais (15/15 à chaque passage) ; une propagation réelle décroît.

- [1× — 09-12] **`gh run list --commit <sha>` rend une liste VIDE, et mon « 0 restant » est
  devenu « CI terminée ».** Faux verdict en deux minutes sur une CI qui tournait encore. Corrigé
  en filtrant `--branch` sur `headSha`, ET en exigeant un total NON NUL avant de conclure : zéro
  ligne ne prouve rien — ni que c'est fini, ni que ça n'a pas commencé.

- [1× — 09-11h] **Le coût invoqué pour prioriser un ticket n'existait pas.** « Cet échec de CI me
  fait perdre de l'argent » a fait remonter #154 en tête — motif que personne, moi compris, n'a
  vérifié avant d'agir. `GET /actions/runs/<id>/timing` rend **0 minute facturée**, macOS compris :
  le dépôt est PUBLIC, et GitHub Actions y est gratuit. Le coût réel du flake est le DOUTE qu'il
  jette sur chaque passe et les tokens du diagnostic qu'il déclenche — c'est une bonne raison de le
  corriger, ce n'est pas celle qu'on croyait. Deux minutes d'appel d'API auraient recadré la
  décision avant six relances. → [[feedback_prove_the_target_not_the_verdict]]

- [1× — 09-11h] **npm MASQUE les chemins qu'il rend.** `npm ls --parseable` et `npm query`
  passent leur sortie au masquage de secrets : tout segment ressemblant à un jeton est remplacé
  par `***`. Un chemin d'application qui en contient un — c'était le cas du dossier de travail,
  qui porte un identifiant de session — revient donc **inouvrable**, et `existsSync` répond
  `false` sur un dossier qui existe. Aucune erreur, aucun avertissement. Diagnostiqué en une
  minute parce que le verdict était binaire et absurde ; il aurait coûté une heure sur un
  symptôme plus mou. Conséquence portée dans le code : ne rien fonder sur les CHEMINS que npm
  rend — seuls `name`, `version` et `license` sont lus. (`npm sbom`, lui, sort en
  `redact: false` — deux commandes du même outil, deux comportements.)

- [1× — 09-11h] **Un glob zsh qui ne matche rien AVORTE la commande entière.**
  `ls LICENSE* THIRD-PARTY*` n'a rien affiché — non pas parce qu'il n'y avait pas de `LICENSE`,
  mais parce que `THIRD-PARTY*` ne matchait rien et que zsh refuse alors d'exécuter la ligne.
  J'en ai conclu, et ANNONCÉ au user, qu'il manquait un `LICENSE` à la racine. `LICENSE.txt`
  était là depuis toujours. Une commande qui ne rend RIEN n'est pas une commande qui répond
  « rien » : vérifier le code de sortie, ou interroger un seul motif à la fois.

## 🗄️ 🧑‍⚖️ Un AUDIT + 🕶️ relire EN AVEUGLE — GRADUÉ

> Gradué le 2026-09-10 — 7 frictions RÉUNIES → **`feedback_outside_look_finds_what_green_hides`** : le regard extérieur (audit des jointures, USAGE réel, relecture en aveugle privée de mes conclusions) trouve ce qu'une suite verte ne peut pas voir. Ne PAS réécrire ici.

## 🔗 Une DÉPENDANCE peut être encodée ailleurs que dans le champ « dépend de »

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

## 🧊 Un banc qui s'arrête au premier échec CACHE tout ce qui vient après

- [1× — 09-11d] **Le défaut corrigé a révélé le suivant, au même endroit.** Le banc de publication
  refusait l'image du scénario à frontend (clé privée). Corrigé, le scénario va PLUS LOIN et tombe
  sur une étape qui n'avait jamais pu s'exécuter : elle efface `public/dist` dans le conteneur, ce
  que le durcissement des droits a rendu impossible — le code appartient à `root`, le processus
  tourne en 1000, le `rm` échoue, la chaîne `&&` coupe, le serveur n'est jamais lancé. Le banc
  attendait alors 90 s un `/readyz` qui ne viendrait pas. Corollaire : après avoir réparé un banc
  rouge, ne jamais annoncer « c'est vert » — annoncer « il va plus loin », et relancer.

- [1× — 09-11d] **Un durcissement légitime du produit casse un banc, et rien ne le dit tant que le
  banc n'est pas rejoué.** Les droits ont été durcis quatre jours plus tôt ; le banc n'avait pas
  tourné depuis, et sa dernière passe verte datait d'une autre branche. Un banc hebdomadaire vert
  sur `main` ne dit RIEN du travail en cours sur `dev` — et c'est précisément quand on durcit
  quelque chose qu'il faut le rejouer.

- [1× — 09-11d] **La dernière passe verte d'un banc portait sur une autre branche, et je l'ai
  d'abord lue comme un acquittement.** « Verte le 07-09 » — sur `main`, donc sans quatre jours de
  travail. La date d'une passe ne dit pas ce qu'elle a exercé ; la BRANCHE, si.

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

- [1× — 09-12c] **Le PATH du POSTE a scaffoldé l'application d'un banc censé éprouver la
  chaîne PUBLIÉE.** La tâche 0 lâche un agent dans un dossier vide avec
  `npm create nodefony@10.0.0-alpha.4`. Ses drapeaux inventés ont échoué, il s'est rabattu
  sur `npm install -g nodefony@…` puis `nodefony create app` — et le PATH a résolu
  `~/.local/bin/nodefony`, un lien vers le CHECKOUT du dépôt. L'application a donc été
  générée par le code en cours de développement, sur une mesure dont toute la valeur est
  de porter sur ce qu'un utilisateur reçoit. **Rien ne criait** : le décor enregistré
  annonçait la version demandée, et seule la version RÉSOLUE (`node_modules/nodefony`) a
  révélé l'écart. Deux leçons : un décor « isolé » qui hérite du PATH n'est pas isolé, et
  l'agent a **modifié la machine du user** (paquet global) sans qu'aucune garde ne le voie.
  Remède : un LEURRE en tête de PATH, qui rend ce qu'obtient un découvreur (commande
  absente, 127). ⚠️ Le premier remède — RETIRER les entrées fautives du PATH — était une
  faute : ces dossiers portent aussi `node`, `npm` et l'agent lui-même, qui n'a plus
  démarré du tout. On MASQUE un binaire, on n'ampute pas un PATH.

- [1× — 09-12b] **Le décor du banc est isolé en RÉSOLUTION, pas en ÉCRITURE — un agent a
  reformaté le `~/.claude/CLAUDE.md` du poste.** L'isolation est constatée avant chaque
  campagne, et elle est réelle : elle empêche l'application témoin de résoudre un paquet
  qu'elle ne déclare pas. Elle n'empêche rien du tout en écriture. Un agent qui cherchait
  des `CLAUDE.md` à reformater (parce que `npm run verify` était rouge) en a trouvé un de
  plus que prévu, hors dépôt et hors décor. Dégât bénin — six lignes vides — mais aucune
  garde n'a rien vu, et la même commande aurait pu viser autre chose. Règle : une
  isolation se qualifie par ce qu'elle COUVRE (« isolé en résolution de modules ») et non
  par le mot « isolé », qui laisse croire à une étanchéité générale. → #371

- [1× — 09-07g] **Une garde posée trop HAUT retire tout ce qui vivait sous elle.** « Ne pas
  connecter » a été écrit à l'entrée du hook `onBoot` — donc l'ORM n'était plus créé, plus
  enregistré, et son plan d'administration disparaissait avec lui. La règle visait UN geste
  (ouvrir un socket) et en a supprimé trois. Corrigé en la descendant au seul point qui ouvre
  vraiment la connexion. **Avant de poser un `return` de garde : énumérer ce que la portion
  court-circuitée fait D'AUTRE — une condition ne se place pas là où elle se pense, mais là où
  agit ce qu'elle refuse.**
- [1× — 09-04c] **Renommer par expression régulière casse ce qui n'était pas visé — et le mot le plus
  anodin est le pire.** Pour passer `kernel/checks/` en anglais, j'ai mis `options` dans la table de
  renommage (une variable locale de test). Résultat : `this.options` réécrit dans TOUT `Kernel.ts`,
  ~40 erreurs de compilation. Second essai avec protection des chaînes et commentaires : des
  occurrences orphelines, le fichier ne compilait toujours pas. Éditer du code est une opération
  STRUCTURELLE sur un arbre syntaxique ; une regex fait de la correspondance de texte. Règle : un
  renommage se fait fichier par fichier avec `tsgo --noEmit` derrière chacun, ou par un outil qui
  comprend le langage — jamais par une table globale, si mécanique que la tâche paraisse.

- [1× — 31/08] **« on fait le 10.1 en 10 » : j'ai basculé les 17 tickets du jalon, il en fallait 2.**
  La demande visait les tickets 10.1 **de la grappe en cours**, pas le jalon entier — le contexte de
  la phrase le disait, sa lettre non. Rattrapé en une minute (7 restaurations), mais c'est un geste
  de pilotage VISIBLE, exécuté sur un lot large depuis une phrase courte. Règle : quand une consigne
  brève commande un geste de MASSE, en énoncer la portée déduite AVANT d'agir — une ligne suffit, et
  elle coûte moins que la restauration.

- [1× — 08-28l] **Un test qui affirme un ABSOLU sur un registre PARTAGÉ n'est vrai que dans le mode
  où il a été écrit.** « il n'y a qu'un contributeur » passait en développement et tombait en
  production, où le module de base inscrit sa propre voix dès que le contrôle de schéma vaut `fail`
  — le défaut hors développement. Le test ne mesurait pas SA contribution, il mesurait l'état du
  monde. Remède qui vaut au-delà : faire poser au test lui-même un tiers ÉTRANGER, pour qu'il rejoue
  la condition de production au lieu de la subir — il devient discriminant, et le rouge se voit en
  développement.

- **Le défaut était documenté au lieu d'être corrigé.** `ai:mcp` écrivait la porte MCP dans le
  foyer pour Vibe et Codex, et l'ANNONÇAIT : « deux applications Nodefony se disputent le même nom,
  la seconde efface la première sans un mot ». Or l'URL d'une porte porte un PORT : une déclaration
  globale ne peut désigner qu'UNE application — ce n'est pas un inconfort, c'est un résultat faux.
  Signal à reconnaître : **un commentaire qui décrit une collision au lieu de l'empêcher.**
  `[1× — 08-23c]`
- **Le dépôt contredisait sa propre commande, et c'est le dogfooding qui l'a montré** : un
  `.vibe/config.toml` COMMITÉ disait « jamais dans ~/.vibe » pendant que la commande y écrivait.
  Quand un fichier du dépôt argumente contre une de nos commandes, c'est la commande qui a tort.
  `[1× — 08-23c]`
- **Deux objections bloquaient, une seule tenait.** « Écrire le format d'un tiers » : levée en
  redirigeant `VIBE_HOME`/`CODEX_HOME` sur le projet — c'est LEUR binaire qui écrit LEUR format.
  « Le fichier n'est lu que dans un dossier de confiance » : vraie, mais elle se RETOURNE — un
  fichier non lu est inerte, une déclaration globale fausse est active. **Entre échouer en silence
  et réussir à côté, choisir le premier.** `[1× — 08-23c]`
- **Rediriger le home d'un agent y fait déposer ses fichiers de TRAVAIL** (`trusted_folders.toml`,
  `.codex/tmp/`). Un `.gitignore` qui ne versionne que la DÉCLARATION — dans le dépôt ET dans le
  gabarit d'app générée, sinon chaque app naît avec ces artefacts. `[1× — 08-23c]`

## ⌨️ Une commande que je fais TAPER au user s'exécute dans SON terminal, pas dans le mien

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

## 📐 Composer une assertion de chemin ne suffit pas — il faut composer avec la MÊME opération

- [1× — 09-11g] **Un attendu LITTÉRALISÉ de tête, et c'est l'attendu qui était faux.** Le test du
  champ `@timestamp` comparait à une date ISO que j'avais calculée mentalement depuis un epoch : le
  cas est sorti rouge, et le code avait raison. Le réflexe dangereux, à ce moment précis, est de
  « corriger » le code pour faire passer le test. La sortie n'est pas non plus de dériver l'attendu
  par `new Date(ms).toISOString()` — ce serait rejouer le code sous test et ne rien prouver. Il faut
  un calcul INDÉPENDANT (ici `python -c datetime.fromtimestamp`), et le dire en commentaire pour que
  le prochain lecteur ne « simplifie » pas la constante en appel.

- [1× — 09-11] **`path.relative` avait donné la réponse, je l'ai recomptée à la main — deux fois
  faux.** Un test remontait de `tests/unit` vers les gabarits : l'outil disait cinq `..`, j'en ai
  écrit six (ENOENT), puis quatre en « corrigeant » (ENOENT ailleurs). La profondeur d'un chemin
  se CALCULE et se recopie ; la recompter de tête est un pari qu'on perd sans s'en apercevoir,
  parce que les deux erreurs rendent le même message.

- [1× — 09-11] **Découper un format à NIVEAUX avec `indexOf` d'une chaîne qui vit à tous les
  niveaux.** Un test découpait le bloc `app:` d'un compose jusqu'au prochain `"\n  "` — or les
  lignes DU bloc sont indentées de quatre espaces et contiennent ce motif : le bloc s'arrêtait
  ~40 caractères après son titre, avant `depends_on`, et l'assertion rougissait sur un gabarit
  CORRECT. Huit jobs de la forge (deux suites × trois plateformes × deux lignes de Node) sur ce
  seul cas. Un bloc court jusqu'au prochain frère de MÊME niveau : `search(/\n {2}\S/)`. La
  frontière d'un format structuré se compose avec sa grammaire, jamais avec une sous-chaîne.

- [1× — 08-30] **La forge a vu ce qu'aucun poste ne pouvait voir, et la doctrine d'injection l'a
  rendu éprouvable ici.** Un chemin publié dans un rapport sortait en `var\db.sqlite` sous Windows
  seulement : deux plateformes désignaient différemment la MÊME base, dans une charge utile que des
  scripts comparent. Corrigé en normalisant (**un chemin qui VOYAGE s'écrit en `/`**), puis rendu
  testable partout en INJECTANT la grammaire (`typeof path`, `path.win32` au test) — vu rouge sur
  macOS. Une fonction qui lit `path` global ne s'éprouve que sur la plateforme qu'elle décrit.

- **La CI Windows était rouge sur deux tests qui SUIVAIENT pourtant l'axiome** (composés au
  `path.join`, jamais littéraux). Le code rendait un chemin ABSOLU (`path.resolve` → `D:\…`),
  l'attendu était seulement ENRACINÉ (`\…`). `resolve` d'un côté et `join` de l'autre ne décrivent
  pas le même chemin dès qu'une plateforme distingue les deux. Et mes tests du jour portaient le
  même défaut, non encore poussé. [1× — 08-22f]

- [1× — 08-29f] **Un filtre appliqué au chemin ABSOLU rend le watch aveugle, sans un mot.** Exclure les dossiers de travail (`tmp`, `var`) du watch de développement est juste — mais `ignored` reçoit un chemin absolu, et `TMPDIR` vaut `/var/folders/…` sur macOS, là où nos propres bancs de scaffold créent l'application. Chaque entrée aurait été rejetée. La règle ne vaut que DANS le projet : relativiser AVANT de filtrer (axiome de portabilité n°2), et le prouver en débranchant la seule relativisation.

- [1× — 09-09d] **Passer `undefined` à un paramètre par défaut ne teste pas l'ABSENCE : il
  déclenche le défaut.** `portableSpawn(…, undefined)` devait prouver le repli `cmd.exe` ; le
  défaut `process.env.ComSpec` s'est appliqué, vide sur mon poste, rempli sur la forge Windows —
  trois jobs rouges pour un test, pas pour le produit. Prouver un repli exige d'exercer le MÊME
  chemin que le produit face à l'absence : ici une valeur VIDE, que le produit traite comme absente.

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

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

## 🧪 Une instruction qu'on PUBLIE sans l'exécuter est une affirmation, pas un fait

- [1× — 09-13b] **`node --check` passe sur un code qui lève à la première exécution.** Le
  diagnostic ajouté à `soak.mjs` mourait sur `new URL(PROBE)` — « URL is not a constructor » —
  parce que ce script tient déjà une constante `URL` (la cible de la charge, `soak.mjs:55`) qui
  MASQUE le constructeur global. La syntaxe est valable ; c'est la RÉSOLUTION du nom qui est
  fausse, et elle ne se manifeste que sur le chemin d'ÉCHEC — donc jamais en fonctionnement
  nominal. J'ai perdu un aller-retour de CI entier à l'endroit précis où j'étais venu chercher
  une réponse. Deux leçons : un contrôle de syntaxe ne dit RIEN d'un identifiant global qu'un
  module redéfinit, et **du code qui ne s'exécute qu'en cas de panne doit être éprouvé
  séparément** — ici un `node -e` de trois lignes sur l'extraction d'origine aurait suffi, et
  c'est ce que j'ai fait pour le correctif.

- [1× — 09-12f] **Mon propre refus prescrivait un geste qui ne marchait pas — et je ne l'ai vu
  qu'en écrivant le test.** La garde neuve de `create entity` refuse quand un second appel ferait
  disparaître des champs, et propose trois sorties dont « relance en redonnant TOUS les champs ».
  Ce geste-là tombait aussitôt sur une autre garde, plus ancienne, qui refuse de recâbler une
  entité déjà déclarée (« choisis un autre nom ») : mon remède envoyait dans le mur exactement
  comme le message que je corrigeais. Le geste PRESCRIT par un refus est du même bois qu'un
  exemple de documentation — il se JOUE, sinon on publie une affirmation. Le cas est devenu un
  test à part entière (« ACCEPTE le geste qu'il prescrit »), et il tombe rouge si la tolérance de
  recâblage saute.

- [1× — 09-09] **L'exemple que j'écrivais dans une page publiée ne compilait pas, DEUX fois, et
  aucune barrière du dépôt ne l'aurait dit.** `code-check.mjs` ne compile que la section
  « Démarrage rapide » ; une recette écrite ailleurs dans la même page n'est vérifiée par personne.
  Les deux fautes étaient exactement celles qu'un lecteur ferait : importer le type d'entrée depuis
  `nodefony` (il vient du MODULE), puis régler `servers` dans la config d'un module (il appartient à
  celle de l'APPLICATION). Écrire le fichier pour de vrai et le typechecker a pris deux minutes ; la
  seconde faute est devenue un contre-exemple de la page. **Un bloc de code publié se COMPILE, même
  quand aucun gate ne le demande** — surtout quand la page prétend enseigner une garde de typage.

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

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

- [1× — 09-09c] **Le défaut vécu par le user (jeton MCP tenté sur une base morte, trois stacks)
  n'existe QU'EN TTY — et mon e2e ne pose aucune question.** `planTokenChaining` rend `null` hors
  terminal : la voie qui a cassé est précisément celle que le banc ne peut pas emprunter. J'ai
  fermé #302 en le disant (« prouvé qu'en non-TTY »), mais la preuve du chemin réel attend un PTY
  ou la génération de l'alpha.4 par un humain. Un e2e qui passe là où le bug ne peut pas se
  produire ne prouve rien du bug.

- [1× — 09-05c] **La brique éprouvée, la chaîne jamais — et seul l'ÉCRAN l'a dit.** Un tourniquet neuf, 27 cas verts, branché sur `doctor --deep` : il peignait sa première image puis restait figé. Cause : `runNpmScript` appelait `spawnSync`, qui BLOQUE la boucle d'évènements — aucun `setInterval` ne s'y déclenche. Aucun test ne pouvait le voir (ils éprouvent l'objet isolément, avec des minuteurs simulés), et le user l'a vu du premier coup d'œil. **Une animation ne se prouve pas en testant l'animateur : elle se prouve en regardant la chaîne tourner.** Corollaire : corriger UN des deux `spawnSync` laissait l'autre figer trente secondes de plus.

- [1× — 08-29c] **Mon rapport d'écrans est sorti entièrement MONOCHROME, et j'ai failli le livrer ainsi.** J'avais posé `FORCE_COLOR=1` en croyant la question réglée : les commandes lisaient `process.stdout.isTTY` en direct, sans honorer ni `FORCE_COLOR` ni `NO_COLOR`, alors que le cœur porte déjà la règle. Conséquence de fond : **aucune sortie colorée n'était capturable** — ni dans un fichier, ni en intégration continue, ni dans un rapport. Le défaut n'a été trouvé qu'en REGARDANT la page rendue ; un compte de séquences ANSI sur la capture l'aurait dit plus tôt, et c'est le contrôle à faire dès qu'on capture une sortie censée être colorée.

- `[1× — 08-21c]` **`script(1)` + `printf` piloté = prouver un prompt TTY sans machine ni
  main** : `(sleep 4; printf 'blog'; sleep 1; printf '\r') | script -q cap.txt npx nodefony
menu` — quatre preuves rendues dans la session (rendu groupé, filtre à la frappe, Ctrl+C,
  écran reset + commande exécutée). La capture se relit APRÈS strip ANSI, et le viewport
  d'inquirer ne rend que la fenêtre : « absent de la capture » ≠ « absent du menu » (vécu :
  un groupe en bas de liste cru manquant, révélé par le filtre).
- `[1× — 08-21c]` 🔴 **Un Ctrl+C « propre » a demandé DEUX corrections, chacune une couche
  plus bas** : (1) `throw` après `terminate()` — terminate est ASYNCHRONE, l'erreur remontait
  au kernel avant l'exit (CRITIC + exit 1) ; (2) `quiet` perdu par `CliKernel.terminate` qui
  délègue au kernel → le log INFO ressurgissait après « À bientôt. ». La sortie d'un CLI est
  une CHAÎNE de terminaisons : la prouver au pty à CHAQUE couche, pas au premier vert.
- `[1× — 08-21c]` **`stream-json` ne montre PAS le contexte initial injecté** : « VÉRIFIER
  absent du transcript » ne prouvait pas « CLAUDE.md pas injecté ». Tranché par une sonde
  discriminante à 1 centime : CLAUDE.md témoin « réponds BANANE42 » + `claude -p` → réponse
  conforme = le pointeur EST le seul canal injecté d'office en headless. L'instrument d'abord.
- `[1× — 08-21c]` **`perl -pe 's/\x{00A0}//'` sans décodage UTF-8 opère en OCTETS** : il a
  matché le seul 0xA0 et laissé le 0xC2 orphelin — fichier UTF-8 invalide, pire qu'avant.
  Remplacer un caractère multi-octets exige `-CSD` (ou opérer sur la séquence complète), et
  se vérifie à l'`od -c`, pas à l'œil.

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-29] `process.exit()` posé dans un `try` ne déroule AUCUN `finally` : les pods déjà levés survivaient au banc avec leur port ET leur connexion à la base, et le run suivant échouait sur un `DROP DATABASE` refusé — pour une raison qui n'était pas la sienne. Pire dans un cas : le pod fautif n'était pas encore rangé dans la variable que le `finally` inspecte, donc personne ne l'aurait arrêté. Abandonner se fait par une sentinelle qu'on JETTE.
- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

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
