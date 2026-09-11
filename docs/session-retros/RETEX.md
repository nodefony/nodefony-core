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

## 🪟 Un contrôle VERT qui ne POUVAIT rien voir — le régime de mesure rend l'objet invisible

> Distinct de « le gate n'est pas lancé » et de « le gate a un angle mort » : ici il tourne, il
> est vert, et son RÉGIME de mesure lui interdit par construction de voir ce qu'il prétend garder.
> La question à poser à tout gate vert : _qu'est-ce qu'il aurait vu si le défaut avait été là ?_

- [1× — 09-11] **Un `200` sur un asset laissait passer un écran NOIR.** La configuration nginx
  générée n'incluait pas `mime.types` : elle REMPLACE celle de l'image, donc nginx servait tout en
  `text/plain` et le navigateur REFUSAIT le module ES. Le cas du scénario vérifiait le CODE DE
  RETOUR, jamais le TYPE — il était vert, l'application inutilisable. Le contrôle porte désormais
  sur `content_type`. La question qui l'aurait attrapé : « ce 200 prouve-t-il que le client peut
  s'en servir ? »
- [1× — 09-11] **Un cas de test qui ne tourne JAMAIS ne peut pas échouer.** Le cas `__Host-` de la
  suite générée est `skipIf(!isExternalTarget)` : il n'existe que derrière un frontal, décor que
  rien ne montait. Il lisait `process.env.NF_ADMIN_PASSWORD` du RUNNER au lieu de la constante du
  décor — une erreur qui l'aurait fait rougir dès la première exécution, restée invisible parce
  qu'il n'y en a jamais eu. Un `skipIf` sans décor qui l'active est un test mort.
- [1× — 09-11] **Une assertion sur le TEXTE d'un gabarit reste verte pendant que le rendu ne
  démarre pas.** `create.test.ts` figeait la ligne `RUN mkdir -p /app/tmp /app/var && chown …` du
  Dockerfile — vert, exact, et inutile : `chown` n'étant pas récursif, `var/databases` restait à
  root et l'image mourait en `SQLITE_CANTOPEN`. Une assertion de chaîne prouve la FORME, jamais le
  comportement ; il faut un banc qui EXÉCUTE l'artefact.
- [1× — 09-11] **Un défaut invisible tant qu'on garde les valeurs par défaut.** Le compose passait
  le port d'HÔTE comme port INTERNE au build du frontal : avec 8080/8443 les deux coïncidaient, et
  rien ne se voyait. C'est le décalage de ports de mon banc (imposé par un Redis déjà pris) qui l'a
  révélé. Corollaire : un banc qui rejoue exactement le décor nominal ne peut pas voir les défauts
  que seule une variation expose.
- [1× — 09-11] **Le banc de découvrabilité ne POUVAIT voir aucun des deux murs d'un essai réel de
  89 minutes.** Il fabrique lui-même son app témoin en `--preset complete`
  (`bench-discoverability.mjs:4444`), donc il ne joue jamais le contenu « Minimal » — celui que
  choisit un découvreur, et où il n'y a ni identité ni exemple à copier. Pire, sa tâche 3 juge déjà
  « la façade isomorphe est montrée » mais l'écrit `RealtimeClient / nodefony/react` : sur une
  application Svelte il rendrait un VERT avec un critère qui ne désigne pas la porte du moteur
  choisi — et le gabarit d'instructions a le même angle mort (react `3` mentions, vue `2`,
  angular `1`, **svelte `0`**). Un banc qui monte lui-même le décor favorable ne mesure pas le
  premier contact, il mesure sa propre mise en scène.
- [4× — 09-10g] **Quatre fois dans la même séance, sur des instruments différents.** (1) Le gate
  mémoire de `@nodefony/http` a rendu `NaN MB` sur ses huit mesures : il TAPE un serveur qu'il ne
  démarre pas, et celui qui tournait n'avait pas `--expose-gc` — un rouge qui n'accusait rien, et
  qui aurait pu être un vert si les seuils avaient comparé autrement. (2) `nginx -t` s'est arrêté
  sur l'upstream ligne 10 : il n'avait jamais LU le bloc TLS que je croyais valider — un backend
  résoluble a été nécessaire pour que le contrôle atteigne sa cible. (3) Le motif du test « tout
  volume monté est déclaré » ne voyait que 6 espaces d'indentation, aveugle aux ancres YAML de
  premier niveau que je venais d'introduire : il serait resté vert en ne regardant plus rien.
  (4) Mon propre cas neuf, bâti sur l'attribut `Secure` du cookie, restait VERT avec `trustProxy`
  RETIRÉ — `Secure` vaut `true` par défaut en configuration, il est donc posé même quand le
  serveur se croit en clair. Réécrit sur le préfixe `__Host-`, qui se DÉRIVE du scheme constaté :
  vert avec, rouge sans. Sans le réflexe « débrancher et regarder tomber », j'aurais livré un
  test décoratif en croyant tenir le critère du ticket.

- [1× — 09-10g] **Une clé ABSENTE d'un défaut rend sa surcharge silencieusement inopérante.**
  `NF__APP__DOMAINCHECK=true` était accepté sans effet : les surcharges génériques n'écrivent que
  sur des chemins DÉJÀ PRÉSENTS, et `domainCheck` n'était dans aucun défaut. La barrière `Host`
  — soignée par ailleurs, testée, documentée — était donc inatteignable pour qui déploie par
  variables d'environnement, c'est-à-dire derrière un frontal, là où elle sert. Le piège était
  DÉJÀ écrit, en commentaire, à six lignes de là (`timing.enabled`) : il n'a pas mordu parce que
  personne ne relit un commentaire au moment où il compte. → [[feedback_capability_unreachable_is_absent]]

- [3× — 09-09f] **Trois fois dans la même séance.** (1) Le gate de format du code généré fabrique
  ses applications témoins AVEC installation — or `create app` formate ce qu'il produit juste
  après l'installation : ses quatre variantes ne pouvaient RIEN voir du rendu des gabarits, alors
  que son commentaire affirmait garder « la forme des gabarits eux-mêmes ». Un régime `--raw`
  (sans installation) a sorti deux défauts réels, invisibles partout ailleurs. (2) L'inventaire
  des dépendances ne voyait pas le catalogue du scaffold, faute de périmètre. (3) `oxlint` 1.82.0
  ne rend plus AUCUN résumé quand tout est propre — sortie identique à celle d'un linter qui n'a
  rien lu ; il a fallu une sonde `debugger` pour distinguer les deux.

- [1× — 09-10] **J'ai annoncé une PUBLICATION PARTIELLE sur une lecture unique — et c'était
  faux.** `npm publish` avait rendu `+ nodefony@10.0.0-alpha.4`, mais ni `npm view` ni un `curl`
  au registre ne voyaient la version : j'ai alerté le user d'un lot partiel, le pire scénario
  d'une release en lockstep. Deux minutes plus tard, elle était là. Le registre ACCEPTE avant de
  SERVIR, et la propagation est indépendante par paquet — une lecture instantanée ne peut pas
  décrire un système en cours de propagation. La même cause a fait tomber les deux jobs qui
  suivent la publication, sur deux paquets DIFFÉRENTS, avec des messages qui accusaient la
  dépendance. Le geste manquant tient en un mot : RETESTER avant d'alerter, surtout quand
  l'observation contredit ce que l'outil vient de confirmer. ↝ [[feedback_suspect_instrument_and_own_diff]]

- [1× — 09-10] **Ma SONDE ne cherchait pas le bon marqueur — et son vert a failli condamner
  le bon code.** Pour prouver que `doctor` lit la configuration extraite en fragments, j'ai posé
  une zone firewall `authenticators: ["anonymous"]` : verdict `rien d'ouvert sans
authentification`. J'allais conclure que le lecteur était aveugle au fragment. Le contrôle
  cherche `security: false` (`kernel/checks/surface.ts:263`) — ma zone n'était pas « ouverte » à
  ses yeux. Avec le bon marqueur, il crie `zone publique ^/sonde` depuis le fragment. La question
  ne suffit donc pas telle qu'écrite : avant de dire « il n'a rien vu », il faut savoir CE QU'IL
  CHERCHE — sinon on impute au contrôle ce qui est un défaut de la sonde.

- [1× — 09-10c] **Une requête qui répond 200 et un panneau qui reste VIDE.** En bâtissant un
  tableau de bord Grafana sur les journaux, deux panneaux n'affichaient rien. Interrogée
  directement, leur requête rendait `200` avec les bonnes colonnes : le défaut était un
  `format: "table"` manquant côté panneau. Aucun message, aucune erreur de console — le succès de
  la requête MASQUE l'échec du rendu. Et j'ai d'abord accusé la lenteur : deux autres panneaux,
  eux, étaient effectivement seulement lents, et j'avais capturé l'écran trop tôt — le piège que
  le skill `nodefony-browser` documente en toutes lettres, lu une heure plus tôt
  ([[feedback_written_rule_needs_reread]]). Le départage ne vient pas de l'écran : il vient
  d'interroger la source SANS l'interface.

- **[1× — 09-10d] Le SYMÉTRIQUE, et il coûte autant : un contrôle ROUGE que son décor fabrique.**
  Le banc devkit en décor lié rendait un `TS2322` sur une application générée. J'ai remonté la piste
  jusqu'à une divergence de versions et j'étais à deux doigts de faire réécrire quinze manifestes —
  le décor `--link` installait simplement DEUX exemplaires d'une dépendance de pair (npm ne hisse
  pas à travers un lien `file:`). Le même banc en décor isolé : 21 étapes sur 21 vertes. Le décor
  annonçait lui-même son verdict « AMPUTÉ », et je l'ai lu après. **Avant d'imputer un rouge au
  produit, rejouer dans le décor le plus proche de l'utilisateur** — ici, celui qui installe depuis
  les tarballs.
- **[1× — 09-10d] Et il bloque plus que lui-même** : le banc s'arrête au premier échec, donc ce rouge
  étranger empêchait de prouver quoi que ce soit d'AUTRE. Une étape neuve n'a pu être jouée qu'en la
  remontant en tête d'une copie du script.

- **[1× — 09-10d] Un outil qui pose la MAUVAISE question rend un verdict juste et inutile.**
  `npm outdated` et notre `deps:check` comparaient à `dist-tags.latest` — qui n'est pas « la
  dernière version » mais ce que le mainteneur sert par défaut. `@types/node` publie par ligne de
  TypeScript et laisse `latest` sur une ligne ANTÉRIEURE : le dépôt paraissait en avance tout en
  accumulant du retard. La bonne question était _quelle est la plus haute version que ma PLAGE
  accepte ?_. Corollaire : un rapport dont les chiffres semblent bizarres (« latest inférieur au
  courant ») dit quelque chose sur l'OUTIL, pas seulement sur les données.
- **[1× — 09-10d] Et j'ai déduit un symptôme au lieu de le mesurer.** J'ai transposé à Svelte le
  double-runtime vécu pour React, sans vérifier : le plugin officiel Svelte pose déjà son
  `resolve.dedupe`, le bundle est identique à l'octet près avec et sans notre ligne. Le mécanisme se
  ressemblait ; la conclusion était fausse. Un défaut ANALOGUE n'est pas un défaut constaté.
- **[1× — 09-10e] Le gate des skills tournait en intégration continue et NE POUVAIT PAS voir une
  faute d'en-tête YAML** : il découpe le frontmatter à la main, « sans dépendance ». Trois
  `SKILL.md` sur vingt-sept portaient un `:` dans un scalaire plain — invalide en YAML. GitHub
  refusait de rendre la page ; le parseur de l'agent, tolérant, l'acceptait ; donc rien ne le
  signalait jamais en séance. Un audit extérieur en a vu UN, par hasard, en ouvrant la page. Le
  remède n'était pas de mieux découper, c'était de donner le même texte à un VRAI parseur.
- **[1× — 09-10e] Quatre zones muettes dans la garde des dépendances, toutes du même genre.**
  `--json` imprimait puis `exit(0)` AVANT le calcul du verdict (donc `--json --gate` absolvait
  n'importe quoi) ; un manifeste illisible était avalé par un `catch` muet tout en restant compté
  dans le total annoncé ; une entrée du catalogue du scaffold disparaissait si la ligne portait un
  commentaire ; les `overrides` n'étaient pas lus. Aucune n'avait d'instance vivante — c'est
  exactement ce qui les rendait invisibles. **Un contrôle ne se juge pas sur les défauts qu'il
  trouve, mais sur ceux qu'il laisserait passer.**
- **[1× — 09-10e] Et la règle elle-même posait la mauvaise question.** « Existe-t-il une version
  qui satisfait toutes les spécifications ? » n'est pas ce que npm FAIT : il ne remplace une copie
  posée que par une version supérieure ou égale. Une spécification exacte dominée par une plage
  plus haute ne fait donc pas conflit — elle fait une copie IMBRIQUÉE, que la règle déclarait
  conciliable en toute bonne foi. Le verrou tranche sans réseau ; la question juste est _le dépôt
  recevra-t-il plusieurs exemplaires ?_
- **[1× — 09-10f] Un motif qui s'arrête aux LETTRES est aveugle à un nom qui porte un chiffre.**
  `argv.selftest.mjs` existe pour confronter les drapeaux qu'un banc LIT à ceux qu'il DÉCLARE. Il
  annonçait « verify-generated.mjs — 4 lus, 4 accordés » sur un fichier qui en lit **5** : son
  motif s'arrêtait à `[a-z-]+`, et `--no-e2e` porte un `2`. Conséquence en aval : le banc REFUSAIT
  `--no-e2e` (lu mais non déclaré) et rendait son usage en sortant 64, sans que rien ne le
  signale. Même faute que le compteur du sas la veille — c'est la FORME du motif qui décide de ce
  qu'on voit, et un compte affiché donne le change.
- **[1× — 09-10f] Une assertion de contenu se fait mordre par le texte qui EXPLIQUE la règle.**
  `assert.notInclude(dockerfile, "org.opencontainers.image.licenses")` a échoué sur le
  **commentaire du gabarit** qui justifie précisément l'absence de cette étiquette. Le test avait
  raison de mordre, sur la mauvaise cible : une assertion doit viser la DIRECTIVE (`^[^#\n]*…`),
  pas la chaîne. Un contrôle qui ne distingue pas le code de son commentaire ne juge pas ce qu'il
  croit — variante de [[feedback_prove_the_target_not_the_verdict]].
- **[3× — 09-10f] Trois instruments faux en une séance, tous du même geste : lire un code de
  sortie qui n'est pas celui qu'on croit.** (a) une commande de fond terminée par `echo "exit=$?"`
  fait rapporter au harness le code de l'`echo`, pas celui du programme — conclu « banc vert »
  sur un banc qui n'avait RIEN lancé ; (b) `${PIPESTATUS[0]}` est vide en zsh (c'est
  `$pipestatus[1]`), donc `npm … | grep …; echo $?` rend le code du `grep` — un gate rouge lu
  comme vert ; (c) une boucle de sonde `for i in $(seq 1 40)` **sans `sleep`** a fait quarante
  requêtes en 0,2 s, et conclu à un échec de démarrage sur un conteneur qui bootait normalement.
  Le remède est le même dans les trois cas : écrire le code de sortie DANS UN FICHIER, et ne
  lire que lui. → [[feedback_shell_false_diagnostics]]

## 🕳️ Déclarer ABSENT ce qu'on n'a pas cherché — sur ce dépôt, la capacité existe presque toujours

> Le symptôme est l'inverse de [[feedback_capability_unreachable_is_absent]] : là-bas une capacité
> livrée était déclarée « non implémentée » ; ici c'est MOI qui affirme une absence, sans l'avoir
> cherchée. Le test qui tranche avant de parler : _ai-je lancé un motif qui aurait TROUVÉ la chose
> si elle existait ?_ Un `ls` d'un dossier voisin, un `grep` sur le CONCEPT et pas sur le nom.

- [1× — 09-11] **Trois diagnostics rendus au user AVANT d'ouvrir la source, les trois faux.**
  « Le compagnon a improvisé », puis « les générateurs lui ont résisté », puis « le document
  d'instructions est trop long ». Le transcript complet — 2 112 événements,
  `~/.copilot/session-state/<id>/events.jsonl` — était sur le disque depuis le début et dit
  l'inverse : 4 skills chargés spontanément, 83 commandes sur 107 citant `nodefony`, et 3 refus de
  générateur corrigés du premier coup en 25 secondes. Je n'avais pas cherché la source ; c'est le
  user qui a demandé « tu as le transcript ? ». Le réflexe manquant n'est pas d'analyser mieux,
  c'est de **demander où vit la trace avant d'interpréter le récit** — un agent laisse toujours un
  journal quelque part.
- [3× — 09-10c] **Trois affirmations d'absence, trois démentis, dans la même heure.** (1) « Il
  faudrait un collecteur en plus pour envoyer les journaux vers OpenSearch » — faux :
  `syslog/transports/OpenSearchTransport.ts` existe, avec son pilote de relecture et sa clé de
  configuration. (2) « Aucun décor ne le fait tourner contre un vrai serveur » — faux : le compose
  du dépôt a un profil `opensearch` complet, Dashboards compris. (3) « Il n'y a pas de garde-fou
  d'environnement pour ça » — faux : `OPENSEARCH_GATE` ET `PROXY_GATE` sont dans `vitest.gates.ts`.
  À chaque fois le user a demandé « tu es sûr ? », à chaque fois le terrain l'a démenti. Le vrai
  trou était ailleurs, et bien plus intéressant : `node.js.yml:524` liste ces variables dans
  `NF_GATES_ALLOW`, la liste des absences AUTORISÉES — la forge déclare noir sur blanc qu'elle ne
  les exerce pas. **Sur ce dépôt, ce qui manque n'est presque jamais le code : c'est son
  exécution.** Chercher d'abord ce qui existe déjà change la question posée.

- **[1× — 09-10d] J'allais écrire un gate que le dépôt possédait déjà, et c'est le user qui l'a
  nommé.** Sur une divergence de versions, j'ai conçu un contrôle dans `create.test.ts` — alors que
  `scripts/check-deps-latest.mjs` lisait DÉJÀ le catalogue du scaffold, résolvait le verrou et
  rangeait le paquet en `[DIVERGENT]`. Le vrai défaut n'était pas l'absence de détection mais
  l'absence d'APPEL : aucun flux d'intégration, aucun crochet, et un code de sortie 0 quoi qu'il
  trouve. Le test avant de concevoir un contrôle : _quel script existant produit déjà ce verdict, et
  qui le lance ?_ Un gate ajouté à côté d'un gate aveugle en crée deux.

- **[1× — 09-10d] RECULER n'est pas corriger — le user a dû me le dire.** Une majeure (`mermaid 12`)
  introduisait deux failles « high » par une dépendance transitive épinglée ; j'ai redescendu la
  majeure pour débloquer la forge. La vraie correction était deux crans plus bas : `lodash-es`
  **avait déjà publié** la version corrigée, et un `overrides` suffisait. Le réflexe « annuler le
  changement qui a rendu rouge » traite le symptôme et abandonne le gain. Le test : _la correction
  existe-t-elle en AMONT, et puis-je l'atteindre ?_ — avec sa contrepartie, vérifier que la version
  corrigée n'a pas RETIRÉ ce que le consommateur utilise (ici `template`/`unset`/`omit`, présents).

## 🤝 Le terrain qu'on donne à un délégué — le salir ou le décrire de travers coûte un audit

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

## ⚙️ Réutiliser du code d'un SCRIPT, c'est le RELANCER

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

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

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

## 📐 Composer une assertion de chemin ne suffit pas — il faut composer avec la MÊME opération

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

## 🧪 Un exemple de DOC qu'aucun gate ne compile est une affirmation, pas un fait

- [1× — 09-09] **L'exemple que j'écrivais dans une page publiée ne compilait pas, DEUX fois, et
  aucune barrière du dépôt ne l'aurait dit.** `code-check.mjs` ne compile que la section
  « Démarrage rapide » ; une recette écrite ailleurs dans la même page n'est vérifiée par personne.
  Les deux fautes étaient exactement celles qu'un lecteur ferait : importer le type d'entrée depuis
  `nodefony` (il vient du MODULE), puis régler `servers` dans la config d'un module (il appartient à
  celle de l'APPLICATION). Écrire le fichier pour de vrai et le typechecker a pris deux minutes ; la
  seconde faute est devenue un contre-exemple de la page. **Un bloc de code publié se COMPILE, même
  quand aucun gate ne le demande** — surtout quand la page prétend enseigner une garde de typage.

## 🚪 Un fast-path standalone ne vaut QUE pour l'invocation directe

- [1× — 09-05d] **L'aide PROMET, la commande REFUSE — et rien ne dit qui a raison.** `nodefony create app --interactive` répondait « option inconnue », alors que `nodefony --help` annonce `-i, --interactive` deux lignes plus haut. Cause : ces options sont posées sur commander pour tout le CLI, et SEPT commandes répondent par le raccourci autonome, qui lit `process.argv` lui-même — précisément pour répondre sans démarrer l'application. Aucune ne cassait ; toutes démentaient l'aide, sur la toute première commande qu'on tape en découvrant le framework. Le raccourci n'hérite de RIEN : ce que la couche court-circuitée offrait doit être réoffert explicitement, à UN endroit (`cli/globalFlags.ts`), sinon la huitième commande autonome rouvre le trou sans que personne le voie.

- `card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`, `git:hooks` : lancées depuis le MENU, le
  kernel tourne déjà, elles passent par commander et **BOOTENT** — leur sortie arrivait sous dix à
  trente lignes de « MODULE ADD ». Même piège pour les capacités déclarées : `CliKernel.start()` les
  applique d'après la commande DEMANDÉE, or depuis le menu c'est `menu`. Toute règle posée « au
  démarrage d'après argv » a un angle mort : le choix différé. `[1× — 08-21e]`

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

## 🧾 Un RITUEL de pilotage qui coûte plus qu'il ne rend

- [1× — 09-11] **Les dates du tableau démarraient au 21 septembre, un 11 septembre.** Posées lors
  d'une session passée, jamais reparties, et 28 tickets sur 57 n'en portaient aucune : une frise à
  moitié remplie et décalée de dix jours ne se lit plus — verdict du user, « on comprend plus rien ».
  Reposées en une passe (un jour ouvré par ticket, dans l'`Ordre`, alpha puis beta ; 57/57 relues
  sur le tableau). Mais **rien ne les fera repartir la prochaine fois** : une date posée à la main
  se périme exactement comme tout ce qui s'écrit à la main, et aucun contrôle du dépôt ne signale
  une frise dont le départ est dans le passé.
- [1× — 09-09c] **Huit tickets « In Progress » que rien ne faisait avancer — posés par mes propres
  commits d'EMPREINTE.** `post-commit` passe en cours tout ticket cité par un commit ; un
  `chore(board): … #288 (#297 #298 #299 #300)` en cite cinq d'un coup. Le lint, lui, exclut les
  commits de pilotage de son verdict — donc il ne voyait rien de faux, et le tableau affichait huit
  chantiers ouverts pour zéro ligne de code. Deux règles pour la même question (« ce commit
  est-il du travail ? ») dans deux automates qui ne se lisent pas ; le hook devrait porter la même
  exclusion que le lint. Redescendus à la main au END, 21 items contrôlés un par un.

- [1× — 09-08] **Le user m'a arrêté sur un outil que j'allais brancher au END.** J'avais écrit un
  script qui classe les leçons par porteur, et mon réflexe était de l'ajouter à la clôture — alors
  que le END est déjà jugé trop long, ce qui avait déjà été dit en mai. Sa phrase : « il faut que le
  jeu en vaille la chandelle ». Le script a fini au CONSOLIDATE (une fois tous les 10-20 retex), sa
  sortie ramenée de 53 lignes à 6, les listes derrière un drapeau. **Un outil utile branché au
  mauvais moment devient un coût récurrent** — et sa sortie longue s'apprend à ignorer, exactement
  comme un rouge permanent.
- [1× — 09-08] **J'allais ouvrir un ticket pour un travail déjà fait, testé et commité.** Le user :
  « quel ticket tu veux ouvrir ? je ne comprends pas ». Le motif était « la note de reprise dit
  qu'aucun ticket n'existe » — un rituel, pas un besoin : un ticket porte du travail À FAIRE, et la
  trace d'un travail fait, c'est `git log`. Il l'a finalement voulu (l'ouvrir et le fermer donne un
  compte rendu que le commit ne porte pas), mais la décision lui revenait, pas au réflexe.
- [1× — 09-08] **Mon propre script a imprimé « ✓ » et le disque ne portait pas le changement.**
  Une édition de `registerStores.ts` a disparu de l'arbre entre deux commandes ; je ne l'ai vu qu'en
  lisant `git diff --stat`, pas en croyant la ligne de succès que j'avais moi-même écrite. Un `✓`
  que j'imprime prouve que MON code a atteint sa dernière ligne — jamais l'état du disque. Le
  contrôle qui vaut, après toute écriture qui compte : `git diff --stat`, ou un `grep` du motif posé.

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**Gradué au fil de l'eau, jusqu'au CONSOLIDATE 2026-09-10 :**

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
