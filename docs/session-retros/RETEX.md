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

## 🎚️ Un DÉCOR posé pour un observateur casse l'autre — et un run partagé n'est pas un décor stable

- [1× — 08-05] `NF_FRONTEND_PUBLIC_ORIGIN=host.docker.internal` laissé sur le serveur après la
  session d'observation conteneur → TOUTES les pages du POSTE en écran vide (nom irrésolvable hors
  Docker). Une origine publique FIGÉE sert UN public : c'est une molette de décor d'observation,
  jamais un réglage qui reste. La poser = prévoir de la retirer.
- [1× — 08-05] `npm install` + rebuild du dist racine lancés PENDANT `test:all` → 9 rouges
  fantômes (les tests du BINAIRE réel ont vu `dist/node/*.js` à moitié réécrit) ; rejoués sur
  arbre stable : 111/111 verts. La règle « ne pas éditer pendant un run » couvre AUSSI les builds
  et l'install — tout ce qui touche ce que la suite exécute.

## 🔗 « Valider la chaîne » = EXÉCUTER la chaîne, pas recomposer son résultat

- [1× — 08-05] Module test svelte d'abord composé À LA MAIN (conforme au canonique) alors que la
  mission était de valider la CHAÎNE de création — rappel user. Quand le but est la chaîne, on
  lance la commande/le skill, et l'artefact rendu EST la preuve.
- [1× — 08-05] Le skill `create-frontend-module` prescrivait `getCspDirectives()` — API SUPPRIMÉE
  du code : un skill jamais rejoué depuis un refactor ment avec assurance. Corrigé (nonce). Rejouer
  un skill = le seul test qu'il ait.
- [1× — 08-05] Page blanche Vite « Failed to resolve ./App.svelte » : le fichier a été créé APRÈS
  le boot du dev-server (optimisation figée au démarrage) — restart Vite AVANT tout diagnostic
  quand un fichier neuf n'est pas vu.

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

- `[1× — 2026-08-03i]` ⭐ **Une ressource se lit à DEUX endroits — sa liste et ses compteurs — et
  le gate doit aller par PAIRES, en deux temps.** La DÉCLARATION (« si la liste cherche, ses
  compteurs cherchent ») ne suffit pas : un endpoint peut publier `search: true`, répondre `200` et
  jeter le terme. Il faut un second test sur l'EFFET — un terme sans correspondance doit VIDER les
  compteurs. C'est la seule paire qui attrape le symptôme réel : la barre filtre le tableau et fige
  les cartes au-dessus, deux vérités contradictoires dans le même écran.
- `[1× — 2026-08-03i]` 🔴 **Un DOUBLE de test qui filtre par deux chemins ne prouve rien.** Les
  doubles de `UserAdminApi`/`WebhookAdminApi` avaient un filtrage pour `listPage` et un autre pour
  les compteurs — exactement la divergence que le test devait dénoncer, reproduite dans son propre
  décor. Un seul `filterUsers`/`filterEndpoints`, partagé, comme le font les vrais dépôts.
- `[1× — 2026-08-03i]` ⭐ **Une hypothèse notée dans un kit se re-vérifie AU CODE avant d'être
  chiffrée.** Le kit annonçait « il faut `searchCriteria` dans les 4 chemins de comptage » : les
  six backends savaient déjà compter avec `q`, et le trou était le data plane — le même endroit que
  pour le tri, trois sessions plus tôt. Une demi-heure de lecture a supprimé les trois quarts du
  chantier annoncé.

- `[1× — 2026-08-03h]` 🔴 **Le dernier data plane à lire sa query à la main était celui du
  JOURNAL** — le pire endroit possible. `?severity=CRITICAL` (au lieu de `CRITIC`),
  `?protocol=grpc`, `?flow=nimporte` et la faute de frappe `?severty=ERROR` laissaient tous le
  critère vide et rendaient le journal ENTIER sous un `200`, que l'exploitant lit « rien à
  signaler ». Le vocabulaire n'existait nulle part côté serveur : il était écrit DEUX fois dans la
  console, dans deux ORDRES différents, et zéro fois là où on aurait pu s'en servir pour refuser.
- `[1× — 2026-08-03h]` ⭐ **Le critère qui distingue « ignorer » de « mentir » : la réponse
  change-t-elle ?** Un `?order=` sur un endpoint de COMPTAGE ne change aucun nombre rendu →
  l'ignorer ne ment sur rien. Un `?q=` SI → l'accepter sans l'honorer fait annoncer aux cartes une
  population que le tableau filtré ne montre pas. Un commentaire du dépôt assumait « admis et sans
  effet » pour les deux, sur une prémisse (« la console renvoie le même query string ») devenue
  fausse depuis `pickFilters`. **Une décision documentée se re-vérifie contre sa prémisse**, pas
  contre sa formulation.
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

- `[1× — 2026-08-03e]` 🔴 **Deux filtres sur la MÊME donnée : le SQL en jetait un, la mémoire les
  appliquait tous les deux.** `authenticated` signifie « `user` non nul » — même colonne que le
  filtre `user`. Les stores SQL/Mongo gardaient `user` et jetaient `authenticated` (leur commentaire
  l'assumait : « un critère AND-only ne porte qu'une condition par champ ») ; le store mémoire, lui,
  honorait les deux. Même question, DEUX réponses selon le backend branché — et
  `?user=alice&authenticated=false` rendait les sessions d'alice sous l'étiquette « anonymes ». Quand
  deux filtres se contredisent, la réponse honnête est l'ENSEMBLE VIDE, pas la page de l'un des deux.
- `[1× — 2026-08-03e]` 🔴 **Une facette ÉCRASE le filtre du même nom, et la réponse se contredit
  toute seule.** `stats?status=active` rendait `{total:5 … revoked:538}` : le total suivait la
  sélection, chaque carte l'ignorait. Ce n'est pas un cas tordu — c'est le cas NOMINAL, un client
  envoyant naturellement le même query string à la liste et aux compteurs. Règle qui manquait :
  **un endpoint de compteurs ne filtre pas la dimension qu'il décompose** (`facetDimensions`), et
  la spec de son endpoint est celle de la liste MOINS ces clés. Le trou était ouvert dans le lot
  précédent sans que rien ne le signale.
- `[1× — 2026-08-03f]` 🔴 **Publier « je n'accepte aucun filtre » oblige à en REFUSER.**
  `sessions/mine` publiait une spec vide (le self-service décide du périmètre par l'identité, pas
  par un paramètre) et acceptait pourtant `?user=alice` — qu'il jetait. Le scope serveur n'a jamais
  faibli (aucun IDOR), mais la réponse laissait croire qu'on avait filtré. **Une publication sans
  refus est une déclaration d'intention, pas un contrat** : le `parseFilters(query, {})` a l'air
  décoratif, c'est lui qui rend la publication vraie.
- `[1× — 2026-08-03f]` **Le refus, une fois posé, DÉMASQUE les seconds lecteurs.** `webauthn/list`
  relisait `q` à la main juste après `parsePageQuery` : invisible tant que le traducteur tolérait
  tout, `400` immédiat dès qu'il refuse. Un durcissement de contrat ne se mesure pas au nombre de
  lignes qu'il ajoute, mais aux appelants qu'il met en défaut — ici un test de la suite security.
- `[1× — 2026-08-03f]` ⚠️ **Fermé par ACCIDENT ≠ fermé par décision.** Les sessions n'avaient pas de
  `*_STATS_FILTERS` : la dimension décomposée (`authenticated`) n'était exposée nulle part, donc le
  trou « les compteurs acceptent ce qu'ils décomposent » ne pouvait pas s'ouvrir — et un test
  verrouillait cette coïncidence en l'affirmant comme une règle. Ouvrir le filtre sur la liste (pour
  rendre les cartes cliquables) l'aurait rouvert du même geste. Un invariant qui tient parce qu'une
  brique manque tombe le jour où on ajoute la brique.

## ✅ Une assertion d'ORDRE ne prouve rien sans données DISCRIMINANTES

- `[1× — 08-05e]` 🔴 **Filtre watch débranché exprès : AUCUN des 13 tests du banc ne tombait.**
  Tous les cas « frontend ignoré » utilisaient des `.tsx`/`.svelte` — rattrapés par la règle
  voisine « non-`.ts` ignoré », qui satisfaisait l'assertion à la place de la règle testée. Le
  cas discriminant (un `.ts` CLIENT, `frontend/src/main.ts`) n'existait pas. Généralisation du
  thème : quand DEUX règles peuvent rendre le même verdict, le banc doit porter au moins un cas
  que SEULE la règle visée satisfait — sinon il teste l'union, pas la règle (`890827aa`).
- `[1× — 2026-08-03f]` 🔴 **Un test de tri neuf est resté VERT alors que le tri était débranché.**
  Il lisait `record.createdAt` là où la donnée vit dans `record.data` : douze `undefined` forment
  une suite « triée » quel que soit l'ordre appliqué. Même piège avec une colonne constante. Un
  test d'ordre doit donc affirmer TROIS choses — le champ est **présent**, ses valeurs sont
  **distinctes**, et `DESC` est **exactement l'inverse** d'`ASC` — sinon il ne teste que sa propre
  capacité à ne pas planter. C'est le débranchement qui l'a révélé ; le vert initial ne disait rien.

- `[1× — 2026-08-03e]` **Quatre écrans d'administration calculaient leurs cartes dans le
  NAVIGATEUR, sur les lignes chargées.** Avec une fenêtre plafonnée, « 3 comptes actifs » décrivait
  trois lignes visibles en ayant l'air de décrire l'annuaire. Corriger par une mention en petits
  caractères (« sur la fenêtre chargée ») ne rend pas le chiffre vrai — c'est le même mensonge, avec
  une note de bas de page. Le compteur doit venir du serveur, ou ne pas être affiché.
- `[1× — 2026-08-03e]` ⭐ **`0` et « je ne sais pas » ne sont pas le même nombre.** Un store en
  curseur (Redis) refuse le comptage exact et rend `-1` ; sans canal distinct pour l'inconnu, cette
  réponse arrive au navigateur en `0` — et une carte à zéro se lit « aucun », pas « ignorance ».
  D'où `number | null` jusqu'à l'écran, et « — » à l'affichage.
- `[1× — 2026-08-03e]` ⭐ **Le critère qui décide si une facette EXISTE** : une facette n'est
  légitime que si le contrat de liste sait déjà la filtrer. Sinon ce n'est pas une facette — c'est
  soit une EXTENSION du contrat (`failing`, `locked`, `hasSocial`, `status` : exactement les filtres
  que la carte cliquable posera sur le tableau), soit une CAPACITÉ de backend déclarée (compter des
  valeurs DISTINCTES : SQL et Mongo savent, Redis non). Les coder pour les seules cartes puis les
  recoder pour les filtres aurait fait deux implémentations de la même règle.
- `[1× — 2026-08-03e]` **Ne JAMAIS déduire une facette d'une autre par soustraction.** Les
  populations se recoupent plus souvent qu'on ne croit : un webhook actif ET en échec, un compte
  désactivé ET verrouillé (4 + 1 + 2 = 7 pour 6 comptes au banc). Et même quand elles partitionnent
  vraiment (les trois états d'une clé), la partition est une propriété du domaine d'AUJOURD'HUI —
  un quatrième état la briserait en silence.

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
- `[1× — 2026-08-03f]` 🔴 **La RECHERCHE était le troisième maillon, et le plus silencieux :
  acceptée partout, honorée nulle part.** Deux data planes (sessions, clés d'API) recevaient `?q=`
  sans jamais le transmettre à leur store — la collection ENTIÈRE revenait, lue comme un résultat de
  recherche. Le tri avait son allowlist, les filtres leur vocabulaire ; `q` n'avait rien, parce
  qu'il n'a pas de valeur à valider — seulement un destinataire. D'où la symétrie exacte avec
  `sortable` : **défaut = REFUS**, la capacité se déclare (`searchable`) et se publie. Un `q` vide
  (barre effacée) ne déclenche rien : personne n'a rien demandé.
- `[1× — 2026-08-03f]` **Publier une capacité oblige à traiter « pas encore chargé ».** Le catalogue
  admin arrive après le premier rendu : `caps === null` ne doit offrir NI tri NI filtre NI recherche,
  jamais un défaut permissif « en attendant ». C'est le seul état qui ne promet rien qu'on ne puisse
  tenir — et il dure quelques centaines de millisecondes à chaque ouverture d'écran.
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
- `[1× — 2026-08-04]` 🔴 **Transposer les drapeaux d'un CLI agentique sur un autre est un
  DEVINEMENT, et il produit un faux verdict complet.** `-p` mis en tête (réflexe Claude Code) alors
  que `vibe` colle le texte au drapeau → `No prompt provided`, transcript VIDE, et le banc publie
  `0/6 tables · 0/83 colonnes` — indiscernable d'un agent incapable. Puis la doc a démenti deux
  autres suppositions : `--auto-approve` est le DÉFAUT du mode programmatique, et `--trust` ne
  restreint aucun outil (il ne gouverne que la config de projet). **Lire le `--help` ET la doc
  AVANT le premier run** — un run raté coûte le prix du run et la confiance dans le chiffre.
- `[1× — 2026-08-04]` 🔴 **Une garde écrite pour UN format d'agent ne protège que celui-là.** La
  garde « agent jamais démarré » du banc teste `"terminal_reason":"api_error"`, champ propre à
  Claude Code : avec tout autre agent elle ne mord pas. Le signe qui détrompe doit être une
  propriété du RÉSULTAT, pas du transport — ici **« 0 appel au générateur ET 0 édition à la main »**,
  impossible pour un agent qui a tourné.
- `[1× — 2026-08-04]` 🔴 **Un compteur ne voit que là où il regarde.** « éditions à la MAIN : 0 »
  pendant que l'agent avait écrit des dizaines de fichiers — dans `nodefony/entities/` (PLURIEL),
  quand la sonde lit `nodefony/entity/`. L'agent inventant une arborescence plausible est
  précisément le cas que le banc existe pour attraper, et c'est celui qu'il compte à zéro.

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

- `[1× — 08-05e]` **P14.17 livrée, DEUX composes restés à la doctrine d'avant** — le gabarit d'app
  et le compose du repo imposaient encore « pré-bâti obligatoire / HMR = chantier ouvert » alors
  que l'`AGENTS.md` généré dans la MÊME app donnait le remède : les satellites d'une livraison
  (composes, commentaires d'infra) ne sont pas dans le rayon du grep qui met à jour la doc. Et la
  démo svelte promettait « état conservé » — jamais vu à l'écran avant ce jour (`ed00a6ff`,
  `a182e618`).
- `[1× — 2026-08-02f]` 🔴 **Un lot livré ne met pas à jour la doc du paquet qu'il justifie** — 13
  affirmations fausses sur 15 dans la doc d'un module dont le lot venait d'être livré.
- `[1× — 2026-08-02f]` **Le `CLAUDE.md` généré annonçait « les trois réflexes » en en portant
  quatre** : un fichier pointeur grossit sans que personne ne relise ce qu'il annonce.
- `[1× — 2026-08-04]` 🔴 **Un RENOMMAGE n'atteint jamais la doc — et il y laisse le CADRAGE FAUX
  qui a causé le bug.** `SessionRealtimeAuthenticator` → `FirewallRealtimeAuthenticator` (juillet)
  vivait encore dans trois pages, qui le présentaient en plus comme « l'équivalent WebSocket de
  session ». Le TSDoc du code dit que cette lecture a coûté un durcissement pensé pour la session
  appliqué à TOUTES les identités, révoquant des connexions JWT valides : **la doc reconduisait la
  confusion qui avait produit le défaut**. Corollaire : après un renommage, `grep` le corpus ENTIER
  — et relire la phrase, pas seulement le nom.
- `[1× — 2026-08-04]` 🔴 **Un correctif automatique de doc se trompe une fois sur deux sur les gros
  écarts.** `anchor-fix` a recalé 373 ancres ; sur les 24 à fort saut vers le haut, **11 étaient
  fausses** (une propriété `run:` prise pour `RequestContext.run`, `function controller` pris pour
  `UseSession`, cinq `class X` pris pour la méthode citée). Le tri qui les isole : **le sens et
  l'amplitude du déplacement** — un recalage qui remonte de plusieurs centaines de lignes a
  attrapé la classe englobante. Sans ce tri, on remplace 531 ancres fausses par 40 ancres fausses
  ET vertes au gate.
- `[1× — 2026-08-04]` 🔴 **Mon propre remplacement global a cassé trois ancres justes** : la valeur
  `sessions-service.ts:808` désignait DEUX symboles après recalage. Un `replace` sur une chaîne
  `fichier:ligne` n'est pas sûr — remplacer par NUMÉRO DE LIGNE de la page, ou vérifier le compte
  d'occurrences avant.

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
- `[1× — 2026-08-03g]` 🔴 **Le gate `skills:check` ne mordait PAS sur ce qu'il prétend garder.**
  J'ai retiré un `references/*.md` fraîchement ajouté : passe **verte, exit 0**. Son « renvois
  morts : 0 » ne concernait que les scripts, jamais les renvois `references/` d'un SKILL.md — soit
  exactement le piège que le skill d'écriture documente. Un gate se vérifie en **supprimant sa
  cible**, pas en lisant son libellé.
- `[1× — 2026-08-03g]` ⚠️ **Le premier jet du gate neuf criait sur du code JUSTE** — un renvoi
  **croisé** (« `nodefony-frontend-dev` §4 → `references/build-hmr.md` ») cite légitimement la
  ressource d'un AUTRE skill. Un contrôle qui accuse le correct est le pire mode de défaillance :
  il fait « corriger » ce qui marchait. **Toute règle neuve se lance sur le dépôt ENTIER avant
  qu'on y croie** — et la résolution doit couvrir le cas croisé, pas seulement le cas local.
- `[1× — 2026-08-03g]` 🔴 **Un test du dépôt a cassé sur un COMMENTAIRE.** `assert.notInclude(e2e,
"409")` cherche la chaîne brute dans TOUT le fichier généré : ma prose expliquant « la seconde
  insertion partait en 409 » l'a fait tomber. Une assertion qui vise un code de statut doit viser
  l'**assertion** (`toBe(409)`), pas la chaîne — sinon elle mordra le prochain qui documente.
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

## ⚖️ Un JUGE peut être satisfait par ce qu'il a FOURNI lui-même

- `[1× — 2026-08-04]` 🔴 **Le juge de T8 cherchait « connecteur » dans la réponse — un mot ÉCRIT
  DANS SON PROPRE ÉNONCÉ** (« quels connecteurs de base de données sont déclarés »), et `sqlite`
  était lisible dans un commentaire de la config générée. Sur la tâche dont l'objet est « appeler
  le générateur au lieu de l'imiter », le PASS ne prouvait pas qu'un générateur avait été appelé :
  il prouvait qu'un mot avait été reproduit. Le test qui tranche : **retirer du juge tout ce que
  la question, le décor ou la doc fournissent déjà** — il ne doit rester que ce qui EXIGE le
  geste. Ici : le couple nom/dialecte DEMANDÉ à la porte machine au moment du jugement, et une
  trace que seule la simulation rend (`Invoice.schema.ts`, la réécriture `@entities([…])`).
- `[1× — 2026-08-04]` 🔴 **Un gate ancré sur un NOM est une loterie quand l'énoncé reste métier.**
  T10 exigeait `/remise|discount/` dans le conteneur, sur un énoncé qui ne nomme aucune brique et
  laisse l'agent dire `Pricing` ou `Tarif`. Elle est restée `FAIL 0/3` sans que ce zéro soit
  jamais instruit. Le critère juste se DÉDUIT du décor (aucun service dans une app fraîche ⇒ tout
  service porté par l'app a été écrit pendant la tâche), il ne se devine pas d'un vocabulaire.
- `[1× — 2026-08-04]` ⭐ **Un correctif produit peut rendre COMPLAISANT le gate qui le mesure — à
  refermer dans le MÊME geste.** Poser un service d'exemple dans le gabarit rendait vrai « au
  moins un service au conteneur » sans que l'agent fasse quoi que ce soit. Le gate exige donc un
  service AUTRE que celui du décor — et, l'exclusion par nom se retournant en silence dès qu'on
  renomme l'exemple, il exige d'ABORD de RETROUVER l'exemple : absent, il annonce « décor
  inattendu » au lieu de juger l'agent.
- `[1× — 2026-08-05b]` 🔴 **Un agent valide une sonde en RACONTANT le geste qu'il n'a pas fait.**
  La sonde « a lancé `create module` » était VERTE alors que le générateur n'avait jamais été
  appelé : l'agent avait affiché un récapitulatif décoratif contenant `npx nodefony create module
audit` dans un `cat <<EOF`. Le prédicat se gardait déjà de deux pièges — le CONTENU d'un fichier
  ouvert, une commande CITÉE dans un document lu —, tous deux du texte ENTRANT, écartés en exigeant
  la clé `"command"` d'un appel d'outil. Restait le troisième, SORTANT : le texte que l'agent écrit
  lui-même DANS une commande. C'est le pire des trois, un faux VERT que personne ne vient
  contester, et **vingt sondes** reposaient dessus. Élagage à un point unique (corps de heredoc et
  littéraux `echo`/`printf` retirés des commandes avant jugement), les sondes de LECTURE gardant le
  transcript entier. Règle : **ce qu'une commande AFFICHE n'est pas ce qu'elle FAIT.**

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
- `[1× — 2026-08-04]` 🔴 **L'agent IMITE la convention de commit du dépôt où on le lâche — y
  compris celle par laquelle le harnais se repère.** Un agent a écrit `tâche 10`, le message exact
  que le banc cherche : QUATRE passes comptées pour trois jouées, rangs décalés, une passe jugée
  sur son commit partiel, une comptée deux fois, la dernière jamais jugée. Verdict `FAIL 0/3`
  parfaitement formé, sur une tâche qui passait. **Le seul indice était une CONTRADICTION entre
  deux sondes** : le gate d'état rendait `exit 0` pendant que les sondes de code lisaient un diff
  qui n'était pas celui de la tâche. Règle : ce qu'un agent peut ÉCRIRE ne peut pas servir à
  l'identifier — le harnais se reconnaît à ce qu'il pose lui-même (ici l'AUTEUR git).
- `[1× — 2026-08-04]` ⭐ **L'agent imite ce qu'il VOIT : une capacité sans exemplaire dans le
  décor est une capacité absente.** L'app naissait avec trois controllers d'exemple et AUCUN
  service — pas même un `@services([…])` prouvant que le décorateur existe. Trois runs sur trois,
  l'agent écrivait une classe ordinaire. L'exemple posé, il n'a PAS recopié le fichier : il a
  cherché et lancé `create service`. **Un exemple ne sert pas de modèle à copier, il sert de
  PREUVE qu'une façade existe** — et ça suffit à déclencher la recherche du générateur.

- `[1× — 2026-08-05b]` 🔴 **Un dossier EXCLU du nettoyage protège tous ses parents.** La remise à
  zéro du décor faisait `git clean -xdfq -e node_modules` : sans barre oblique de tête, l'exclusion
  est un motif gitignore qui mord à TOUTE profondeur. Or `create module` fait naître un workspace
  npm — donc `modules/<nom>/node_modules/` — et son bundler dépose `dist/node_modules/`. Git ne
  supprimant pas un dossier dont il doit préserver le contenu, le squelette du module SURVIVAIT
  d'une répétition à l'autre, et la suivante se faisait refuser son propre générateur (« le module
  existe déjà »). Correctif d'un caractère : `-e /node_modules`. Règle : **une exclusion de
  nettoyage s'ANCRE**, sinon elle protège ce qu'on croyait effacer.

## ⚙️ Une montée d'OUTIL change le verdict sans qu'une ligne du dépôt bouge

- `[1× — 2026-08-05b]` 🔴 **Un linter en plage `^` rougit un dépôt inchangé.** Le lot de
  dépendances de la veille a monté oxlint de 1.76 à 1.77, qui apporte `no-map-spread` : CI rouge
  pendant six runs sur un fichier vieux de plusieurs semaines. **Aucun contrôle sur les fichiers
  STAGÉS ne pouvait l'attraper** — le commit déclencheur ne touchait que le verrou de dépendances.
  Deux gestes : le linter passe en version EXACTE (la montée redevient délibérée : on monte, on
  lance le lint complet, on corrige dans le même commit), et `oxlint` entre dans `lint-staged`
  pour l'autre moitié des cas (une ligne qu'on vient d'écrire, verdict identique en local, 200 ms).
- `[1× — 2026-08-05b]` 🔴 **Un réglage de MESURE qui n'est plus lu ne dit rien — et son banc reste
  vert.** `execArgv` est passé au premier niveau en Vitest 4 ; la config portait encore
  `poolOptions: { forks: { execArgv: ["--expose-gc"] } }`. Vitest 4 l'ignore **sans échouer** : les
  huit tests passent, et `globalThis.gc` vaut simplement `undefined`. La sonde cesse alors de
  forcer le ramassage et mesure les déchets en attente — soit autre chose que ce dont le seuil
  parle. Résultat en CI : « fuite mémoire suspectée : heapΔ 47.5MB (seuil 40MB) » sur un dépôt sans
  fuite. Après correction : **0,3 MB**, la valeur que le `CLAUDE.md` du module documentait depuis
  toujours — facteur 158. **Le seul indice était une ligne `DEPRECATED` noyée dans la sortie.**
  Réflexe : après une montée majeure de runner, relire les options de MESURE une par une ; un flag
  débranché ne se signale jamais par un rouge, seulement par un chiffre qu'on croit vrai.

## 📏 Une sonde de PERFORMANCE juge la machine avant de juger le code

- `[1× — 2026-08-02f]` ⭐ **Juger la FORME de la courbe, pas la durée** : doubler l'entrée doit
  doubler le temps. Un seuil de durée rouge sur UNE seule case d'une matrice de six désigne la
  machine, pas le code. Chauffer avant de mesurer, prendre le **MINIMUM** de N relevés (une
  préemption ne peut qu'AJOUTER du temps). ⚠️ Le minimum n'écarte qu'une préemption PONCTUELLE.
- `[1× — 2026-08-02f]` ⭐ **Avant d'accuser la mesure, lire la STRUCTURE — et inversement** : un
  scan sans retour arrière ne PEUT pas être quadratique, le chronomètre avait tort.
- `[1× — 2026-08-05f]` 🔴 **Un conteneur « idle » n'est pas innocent** : mongo au repos consommait
  64 % CPU (healthchecks en boucle, 78 000+ connexions au journal) et chargeait la VM Docker à
  91 % — couper Docker AVANT toute campagne de mesure, et le CONSTATER (`ps` top CPU), pas le
  supposer.
- `[1× — 2026-08-05f]` ⭐ **`--cpu-prof` couvre le process ENTIER, boot inclus** : fenêtrer
  l'analyse sur la seule période de charge (détection par l'activité `parserOnIncoming`), sinon un
  poste de boot (`package_json_reader`, résolution ESM) passe pour un poste par requête.
- `[1× — 2026-08-05f]` ⭐ **Un compteur CONSTATE, une contre-épreuve PROUVE** : faire BOUGER le
  compteur par la config (3→2 `setTimeout`/req en alignant `responseTimeout` par override
  `NF__…`) transforme une corrélation en cause — et valide l'override env au passage.

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
- `[1× — 08-05e]` 🔴 **La « Priorité 1 » d'un `_state` était un diagnostic jamais reproduit** —
  « le watch backend redémarre sur `frontend/**` » : le filtre existait depuis 3 semaines, testé ;
  le restart vécu venait des `.ts` écrits pendant le scaffold dans la même rafale. Reproduire
  (édition seule → 0 restart, contre-épreuve `.ts` → restart) a coûté 5 min et évité un chantier.
  Un constat de session sous pression entre au `_state` comme un FAIT — le RESUME suivant doit le
  traiter comme une hypothèse à reproduire, pas comme un backlog.

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib**, faute d'avoir ouvert le source.
- `[1× — 2026-08-02j]` 🔴 **Une affirmation écrite dans un GABARIT est DISTRIBUÉE** — j'ai écrit
  dans le `.env` généré « pas de commentaire en fin de ligne, la valeur court jusqu'au saut » :
  faux, `node:util.parseEnv` coupe au `#` (prouvé en une commande). Un commentaire de gabarit part
  chez tous ceux qui génèrent une app — il se vérifie comme du code, jamais « au raisonnable ».

## 🚫 Prouver le REFUS ne prouve PAS la CAPACITÉ — ce sont deux tests

- `[1× — 2026-08-03h]` ⭐ **Un banc GÉNÉRIQUE trouve ce qu'aucune relecture ne cherche.** Au lieu
  de tester mes deux endpoints, j'ai fait parcourir le CATALOGUE : pour chaque capacité publiée,
  l'endpoint l'honore-t-il ? Deux trous sont tombés que je n'aurais jamais soupçonnés — quatre
  endpoints `*/stats` publiaient `search:false` et acceptaient `?q=` en silence. Un banc écrit
  contre la LISTE plutôt que contre l'exemplaire couvre aussi les endpoints qui n'existent pas
  encore, et il ne peut pas être « oublié » à la prochaine ressource.
- `[1× — 2026-08-03h]` **Un banc qui itère a besoin d'une garde ANTI-BANC-VIDE.** `for (const x of
liste)` sans assertion sur `liste.length` est vert sur zéro itération : une régression qui
  SUPPRIME toute publication rendrait le banc entièrement vert. Une ligne (`length > 3` + deux
  chemins nommés) transforme un banc décoratif en gate.
- `[1× — 2026-08-03h]` **Accumuler les échecs, ne pas s'arrêter au premier.** Un `expect` dans une
  boucle nomme UN fautif et masque les suivants ; pousser dans un tableau puis
  `expect(failures).to.deep.equal([])` les nomme TOUS. C'est ce qui a montré que les quatre
  `*/stats` partageaient le même défaut, donc qu'il fallait corriger une famille, pas un cas.
- `[1× — 2026-08-03g]` 🔴 **Le banc du devkit éprouvait « un tri hors allowlist est refusé » et
  s'arrêtait là.** Un `ORDER BY` mort passe ce refus sans broncher : débranché dans le décor, le
  test de refus est resté **VERT**. Le générateur pouvait livrer une liste dont le tri et les
  filtres ne font rien, sur un banc intégralement vert. Le refus mesure l'HONNÊTETÉ, pas la
  capacité — et c'est la capacité que l'utilisateur achète.
- `[1× — 2026-08-03g]` ⭐ **Un test de tri se durcit en TROIS affirmations, un test de filtre exige
  une ligne TÉMOIN.** Le champ doit être PRÉSENT (sinon on ordonne des `undefined`, suite triée
  dans les deux sens), les valeurs DISTINCTES (une colonne constante rend « trié » l'ordre que la
  base a choisi seule), et `DESC` l'inverse EXACT d'`ASC` sur une page qui contient tout. Pour le
  filtre : sans une ligne qui NE matche pas, « toutes les lignes portent la valeur demandée » reste
  vrai filtre débranché — **c'est le témoin qui fait le test, pas l'assertion**.
- `[1× — 2026-08-03g]` **Une sonde qui vise « le premier déclaré » met en défaut le générateur au
  lieu de l'éprouver.** Le test de rejet visait `filters[0]` quel qu'il soit : sur une entité dont
  le seul filtre est une clé étrangère textuelle, il exigeait le refus d'une valeur **valide**.
  Toutes les natures ne refusent pas — un `"string"` accepte tout, par construction.

## 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance

- `[1× — 2026-08-05c]` 🔴🔴 **LE BUNDLE SERVI N'EST PAS CELUI QU'ON VIENT DE BÂTIR — et l'écran
  montre alors du code QUI N'EXISTE PLUS dans la source.** Quatre tours de vérification passés à
  soupçonner une migration qui était juste. Trois mécanismes indépendants, chacun inoffensif seul :
  `build:ui` **ne purge pas** `dist/frontend/` (deux générations de chunks, `index.html` désignant
  l'ancienne) · `start.sh` déclenche `turbo run build` qui **RESTAURE un dist depuis son cache**,
  écrasant le build manuel · `PrebuiltUi` lit `index.html` **au démarrage** seulement. Le
  diagnostic tient en deux lignes et doit être le PREMIER réflexe, pas le dernier : comparer
  `curl … | grep -o 'index-[hash].js'` (SERVI) à la même chaîne dans `dist/frontend/index.html`
  (BÂTI). Différent ⇒ le défaut n'est pas dans le code. Remède ORDONNÉ, aucun pas facultatif :
  `turbo run build --filter=… --force` → redémarrer le serveur → redémarrer le conteneur
  navigateur (son cache HTTP survit au rechargement). Gradué dans `gotchas-studio.md` §1 et
  `build-hmr.md` §9.2 ; porté aussi à l'`AGENTS.md` des apps générées.
- `[1× — 2026-08-05c]` ⭐ **Un serveur MCP peut TUER la session parce que le CLIENT ne répond pas à
  ses pings.** `mcp/playwright` lance un heartbeat (`server.ping()` toutes les 3 s) qui ne part que
  sur le flux GET SSE standalone ; sans ce flux ouvert **et lu en boucle**, `send()` retourne
  silencieusement, le ping expire à 5 s et le serveur ferme la session — d'où un `404 Session not
found` à l'appel 6, toujours au même instant (t+5,7 s), ce qui ressemble à un quota d'appels et
  n'en est pas. Un protocole bidirectionnel impose des DEVOIRS au client : ouvrir le canal retour,
  le lire, et RÉPONDRE. Diagnostic obtenu en lisant le code du serveur DANS le conteneur, pas en
  raisonnant sur les symptômes.

- `[1× — 2026-08-05c]` 🔴 **RÉIMPLÉMENTER UN CLIENT DE PROTOCOLE À LA MAIN COÛTE PLUS QUE LA TÂCHE
  QU'IL SERT.** Un conteneur exposait un serveur MCP ; au lieu de le brancher au harnais (une
  commande, `claude mcp add`), j'ai écrit six clients HTTP successifs — parsing SSE, gestion de
  session, canal keep-alive — pour finir sur `404 Session not found` à chaque séquence de plus de
  six appels. Le service, lui, marchait dès le premier essai. Le signal à reconnaître : **quand on
  débogue le TRANSPORT et non le sujet, on a pris le mauvais chemin** ; chercher le client existant
  avant d'en écrire un.
- `[1× — 2026-08-05c]` 🔴 **Une capture d'écran NE S'ÉCRASE PAS : réutiliser un nom de fichier fait
  relire une image PÉRIMÉE pendant que l'appel répond « OK ».** J'ai failli conclure « le login ne
  mène pas au tableau de bord » sur une image du run précédent, alors que l'URL disait `/workspace`.
  Seul le `mtime` a démasqué le décalage. Nom neuf à chaque prise, ou vérifier la date AVANT de
  regarder — le corollaire exact de `feedback_prove_on_received_artifact`, appliqué à une image.
- `[1× — 2026-08-05c]` 🔴 **Une sonde qui attend un texte présent dans DEUX états ne discrimine
  rien.** Attendre « Nodefony Studio » pour savoir si l'on est connecté : ce titre s'affiche aussi
  sur l'écran de connexion, donc l'attente aboutit toujours et la branche de reconnexion ne part
  jamais. Se repérer sur ce qui DIFFÈRE entre les deux états (l'URL, un texte propre à l'écran visé).
- `[1× — 2026-08-05c]` 🔴 **Pire qu'une sonde fausse : une sonde qui RÉPOND alors qu'elle n'a rien
  mesuré.** Mon contrôleur d'écrans a imprimé trois lignes de verdict (`attendu:vu grille:non`)
  pendant que la session était morte et qu'aucune capture n'était produite — j'ai d'abord cru à un
  défaut du code migré. Toute sonde doit rendre l'échec de son PROPRE canal distinct d'un verdict
  négatif : sans `result` NI `error`, afficher le brut, jamais « non ».

- `[1× — 2026-08-03i]` 🔴 **Un hook qui refuse une commande la refuse ENTIÈREMENT — et le heredoc
  qu'elle portait n'a jamais été écrit.** Un `cat >> banc.ts <<EOF … EOF && cd …` rejeté pour son
  `cd` relatif : le banc est resté INCHANGÉ, le run suivant a rendu **14 verts** qui ne testaient
  rien de neuf, et j'ai lu ce vert comme une réussite. Deux règles : écrire un fichier passe par
  l'OUTIL d'édition, jamais par un heredoc ; et un compte de tests qui ne BOUGE PAS après un ajout
  est un signal, pas un détail.
- `[1× — 2026-08-03i]` 🔴 **Vitest TRANSPILE, il ne vérifie pas les types : une suite verte peut
  laisser `npm run typecheck` rouge.** Deux `assert.rejects` mal typés ont traversé deux commits et
  n'ont été dits que par le hook de `pre-push`, à la clôture. Le typecheck global appartient à la
  MÊME passe que la suite du module touché — pas au moment du push, où il bloque une sauvegarde.
- `[1× — 2026-08-03i]` 🔴 **Un run lancé depuis la racine au lieu du module a confirmé ce faux
  vert** — vitest a résolu le chemin par motif et rejoué l'ancien fichier sans rien dire. Vérifier
  le `cwd` d'un run avant d'en tirer un verdict.

- `[1× — 2026-08-03h]` 🔴 **`$f:ASC` en zsh n'est pas `$f` suivi de `:ASC`** — `:A` est un
  modificateur (chemin absolu). Une boucle de vérification a donc annoncé **400 sur les six
  champs**, y compris ceux que le serveur acceptait : la même URL, tapée à la main, rendait 200.
  L'instrument fabriquait le verdict. Écrire `${f}:ASC` — et, devant un résultat UNIFORME et
  inattendu, soupçonner d'abord la commande, jamais le code.
- `[1× — 2026-08-03h]` **Commiter pendant qu'un watch reconstruit fait échouer le hook sur un
  `ENOENT` de `dist`.** Le DevSupervisor `rimraf` puis rebâtit : le fichier existe avant et après,
  jamais pendant. Le message accuse un fichier parfaitement présent — relancer après le build,
  pas chercher la cause dans le diff.
- `[1× — 2026-08-03g]` 🔴 **Trois faux diagnostics dans une seule séance, tous dus à l'outil, pas
  au code.** (a) `grep "a\|b=\{"` : `\{` ouvre un intervalle en BRE et casse TOUTE l'alternance →
  faux négatif silencieux, j'ai conclu « absent » sur du présent. (b) `rg -oh 'motif'` : `-h` c'est
  `--help`, ripgrep a imprimé son aide et je l'ai lue comme un résultat. (c) Rejeu d'une suite e2e
  **sans la variable d'environnement du banc** (`NF_PORT=5361`) → l'app du décor est retombée sur
  le port par défaut, occupé par le serveur de dev du dépôt, et **12 tests sont tombés en 404**.
  J'ai failli conclure à une régression massive. Le signe qui trahit : un test SANS RAPPORT avec le
  diff échoue aussi (`GET /api/hello`) — c'est le décor, jamais le code.
- `[1× — 2026-08-03g]` **Le banc TRONQUE sa propre sortie** (`[1/3]` affiché, 3 échecs réels). Pour
  savoir ce qui est rouge, rejouer la commande sous-jacente **avec l'environnement du banc**, et
  capturer en entier — pas lire le résumé du banc.

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

- `[1× — 2026-08-03i]` ⭐⭐ **Un contrat portable qui se TAIT n'a pas une sémantique, il en a
  autant que de moteurs — et « changer la sémantique » n'est alors pas le bon argument pour
  refuser.** J'avais noté la clause `ESCAPE` comme « à trancher à part, ça change `$like` pour tous
  les appelants ». Faux : sans clause, PostgreSQL et MySQL appliquaient DÉJÀ l'antislash, SQLite le
  cherchait littéralement, Mongo l'aplatissait en regex. L'émettre ne change pas le contrat, **elle
  le fait exister** — et le débranchement le montre littéralement : sans la clause, le même test
  TOMBE en SQLite et PASSE en PostgreSQL. Le critère qui tranche ce genre de décision : demander
  d'abord **ce que font les moteurs quand on ne dit rien**, pas ce que le changement coûterait.
- `[1× — 2026-08-03i]` ⭐ **Un adapter sans SQL doit LIRE la même grammaire, pas une
  approximation.** La traduction d'un motif en regex vivait chez Mongo et ignorait l'échappement :
  le même critère portable ne rendait pas le même ensemble selon le backend — la divergence la plus
  coûteuse qui soit, puisqu'elle ne se voit qu'en changeant de base. La grammaire (caractère
  d'échappement, neutralisation d'un littéral, lecture d'un motif) vit au socle, en un exemplaire.
- `[1× — 2026-08-03i]` 🔴 **Trois tests du dépôt VERROUILLAIENT la limite, en la nommant** (« le
  terme part TEL QUEL », « LIMITE CONNUE : `_` reste un joker »). Un test qui documente une
  renonciation est un panneau, pas un mur : le renverser fait partie du geste, et son commentaire
  doit garder le POURQUOI de la bascule — sinon quelqu'un rétablira la limite en croyant réparer.
- `[1× — 2026-08-03g]` 🔴 **Un échappement qu'on n'ÉMET pas est pire que pas d'échappement.**
  Quatre copies de la même règle de recherche échappaient `%`/`_` avec `\` — mais `like()` n'émet
  aucune clause `ESCAPE`, et sans elle le terme est cherché **littéralement**. Mesuré sur les trois
  moteurs réels : `a\_c%` rend **`[]` en SQLite**, la bonne ligne en PostgreSQL et MySQL (qui
  traitent `\` comme échappement par défaut). Le même code, deux comportements — et **SQLite est le
  défaut de développement** : on cherche en vain en dev, ça marche en production. Une protection
  qui échoue en silence ne protège pas ; retirée, les jokers restent actifs **uniformément** (une
  imprécision, jamais une réponse fausse). Le seul site correct compose du SQL natif et émet
  `ESCAPE` — avec sa divergence MySQL (`\` doublé dans un littéral).
- `[1× — 2026-08-03g]` ⭐ **La question « ce bug existe-t-il sur les autres dialectes ? » se
  MESURE, elle ne se déduit pas.** Ma lecture des specs disait « PG et MySQL honorent `\` par
  défaut » — c'était juste, mais je ne pouvais pas l'affirmer avec 573 tests skippés. Un docker
  compose, un test jetable de trois lignes par moteur, et la réponse est tombée en deux minutes,
  avec le tableau des trois verdicts. Le test jetable se supprime après ; le tableau reste.

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

## 🎯 Une sonde qui juge le MOYEN condamne un objet ATTEINT

- `[1× — 2026-08-05]` 🔴 **Six verdicts sur sept examinés venaient de l'instrument, pas du
  produit.** Trois sondes de la tâche 5 jugeaient une ORTHOGRAPHE d'invocation là où elles
  annoncent un geste : `npm start` **est** `nodefony production` (le gabarit le déclare), `npm stop`
  **est** `nodefony stop`, et `lsof` en lecture n'arrête rien — c'est `kill` qui tue. Les tâches 3
  et 6 tombaient sur un générateur non appelé alors que **toutes** leurs sondes de résultat étaient
  vertes, gate d'état compris. Le critère qui tranche : **quand un juge d'ÉTAT déclare l'objet
  atteint, une sonde de moyen ne peut plus faire échouer** — elle devient une observation. Preuve
  la plus nette obtenue : rejouer les MÊMES transcripts (`--analyze-only`, zéro agent relancé) fait
  passer 3 et 6 à `3/3`. → [[feedback_bench_probe_false_verdicts]]
- `[1× — 2026-08-05]` ⭐ **Le bénéfice qu'on croit mesurer se vérifie avant de sanctionner.** La
  tâche 3 punissait de ne pas appeler `create controller --kind realtime` ; le run qui l'appelait a
  coûté **40 tours / 273 s / 0,52 $** contre **32 / 158 s / 0,30 $** pour celui qui écrivait la
  façade à la main — même code produit. Le banc sanctionnait le chemin le moins cher. Là où
  ignorer le générateur fait un **dommage réel** (tâche 13 : pas d'injection, typecheck rouge), ce
  sont les sondes de résultat qui rougissent, et elles jugent.

## 🧹 Une remise à zéro qui ne rend que les FICHIERS n'en est pas une

- `[1× — 2026-08-05]` 🔴 **Le décor du banc revenait à l'état initial par git, et laissait les
  PROCESS vivants.** Un agent qui ne range pas son serveur fait échouer la tâche **suivante** :
  port 5371 tenu, le juge interroge une application qui n'est pas celle qu'il éprouve. La garde a
  mordu (`CAUSE=port-deja-tenu`, run écarté) — mais la tâche s'est retrouvée à deux runs retenus,
  donc **non prouvée, pour une faute étrangère**. Le gabarit dit bien « arrête ce que tu
  démarres » : compter là-dessus, c'est mesurer sa propre consigne.
- `[1× — 2026-08-05]` 🔴 **Le harnais est mort en lisant l'artefact que sa propre tâche
  réclame.** La tâche 14 demande de servir un GROS média ; l'agent en fabrique un ;
  `execFileSync` plafonne à 1 Mio et **lève** (`ENOBUFS`) au lieu de tronquer. La passe s'est
  arrêtée là, emportant les répétitions déjà jouées de trois autres tâches. Deux bornes, pas une :
  un `maxBuffer` large **et** une borne PAR FICHIER — au-delà, c'est une pièce jointe, pas du code,
  et son contenu ne peut rien apprendre à une sonde. L'écart s'ANNONCE.

## 🧬 Une contrainte de CE dépôt n'est pas une contrainte de l'app GÉNÉRÉE

- `[1× — 2026-08-05c]` 🔴 **J'ai écrit dans le gabarit d'`AGENTS.md` qu'un nom d'hôte « doit
  figurer dans `trustedHosts` » : vrai ICI, où `domainCheck: true`, FAUX dans une app générée qui
  ne l'active pas.** La consigne aurait envoyé chercher une panne inexistante. Rattrapé en ouvrant
  le gabarit de config de l'app — pas en relisant ma phrase. Toute règle destinée à un gabarit se
  vérifie dans le gabarit VOISIN, jamais transposée depuis le dépôt où on l'a apprise.
- `[1× — 2026-08-05c]` 🔴 **Le compose généré montait `./tmp/browser` alors que `tmp/` n'était pas
  dans le `.gitignore` généré** (il n'y avait que `var/`) : les captures d'écran seraient entrées
  dans l'historique de toute app créée. Ajouter un volume à un gabarit oblige à vérifier ce que le
  gabarit VOISIN ignore.

## 📚 La doc officielle périme la mémoire — deux fois dans la même session

- `[1× — 2026-08-05]` 🔴 **« Prends un token npm Automation » : ces jetons N'EXISTENT PLUS.** La
  doc npm (`about-access-tokens`) est explicite — _« As of November 2025, only Granular access
  tokens are supported. Legacy access tokens have been removed. »_ Et elle pousse ailleurs :
  trusted publishing (OIDC), aucun secret. J'aurais écrit le contraire de mémoire, avec aplomb.
- `[1× — 2026-08-05]` 🔴 **Une matrice dynamique GitHub sans parenthèses rend `true`, pas une
  liste.** La table des opérateurs donne `&&` prioritaire sur `||` : `A || B && X || Y` s'évalue
  `A || (B && X) || Y`, et `fromJSON` échoue sur un booléen — pour un motif sans rapport avec le
  sujet. Trouvé en TÉLÉCHARGEANT la doc, pas en relisant. Éprouvé sans pousser, en simulant la
  sémantique (comparaison lâche, opérateurs qui rendent une valeur), avec la preuve négative.
- `[1× — 2026-08-05]` ⚠️ **Deux étapes de CI écrites « au bon sens » étaient fausses.** Un
  `npm run check:externals --if-present` — le script **n'existe pas**, c'est un SKILL, donc un
  contrôle imaginaire qui serait resté vert pour toujours. Et un `paths-ignore: ['**/*.md']`, la
  forme évidente, aurait **désactivé `skills:check`** — dont la matière EST faite de `SKILL.md`.
  Économiser du runner en désarmant un gate est le pire des deux échanges.

## 🔴 Un gate rouge en PERMANENCE est un gate mort

- `[1× — 2026-08-05]` **La CI était rouge depuis sept runs consécutifs, ~15 h, et personne ne
  pouvait le voir** : un job sur dix-sept, noyé dans seize verts et trois autres workflows au vert.
  La cause tenait en une ligne — un test exigeait des entrées `DEBUG` qu'il n'écrit pas et que le
  mode production n'émet jamais ; le même cas passait en `development` **dans le même run**. La
  contradiction était lisible dès le premier rapport. Corollaire de méthode : quand deux sondes du
  même run se contredisent, c'est l'instrument qu'on ouvre en premier, pas le code.

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.
