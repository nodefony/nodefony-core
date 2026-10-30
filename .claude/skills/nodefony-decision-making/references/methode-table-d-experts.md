# Méthode — la table d'experts : des regards indépendants, chacun sur le bon modèle

> Référence du skill `nodefony-decision-making`. Emprunte au Delphi (avis indépendants, sans se
> voir) et au pré-mortem (le siège du contradicteur). **Maintenance** : vérité courante ; éditer
> en place. Le modèle COURANT de chaque siège vit dans `assets/sieges.json`, seule source.

## Sommaire

1. Ce que la table apporte, et ce qu'il n'apporte pas
2. Les sièges, leur question et leur modèle
3. Composer la table d'une décision
4. Le dossier remis à chaque siège
5. La consigne type
6. Lancer, puis faire la synthèse
   6bis. Tours de convergence : soumettre la FORME, puis s'arrêter
7. Le budget, et comment l'économiser à résultat identique
8. La revue finale d'un ensemble
9. Apprendre : le bon modèle par siège, prouvé par l'usage

## 1. Ce que la table apporte, et ce qu'il n'apporte pas

Il apporte des **regards qui ne partagent pas les angles morts du principal**. Le principal a
construit la recommandation ; il voit ce qui la confirme. Un siège qui ne l'a pas vue, avec une
seule question de métier, voit autre chose.

Il n'apporte PAS la vérité : un siège affirme avec le même aplomb ce qu'il a lu et ce qu'il
suppose. La table produit des **points à vérifier**, que le principal confronte au code avant
d'en montrer un seul à l'auteur.

## 2. Les sièges, leur question et leur modèle

Le modèle se choisit sur la NATURE du travail du siège (règle du `CLAUDE.md` racine : `haiku` par
défaut, monter se justifie en une phrase qui nomme ce que le modèle léger échouerait à faire). La
colonne « Modèle » ci-dessous est le **point de départ** ; le modèle à employer est celui de
`assets/sieges.json`, que l'usage fait évoluer (§9).

| Siège                           | Sa seule question                                                                          | Modèle   | Pourquoi ce modèle                                                                                                     | Skills à lui faire charger                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contradicteur**               | « On est dans un an, cette décision a échoué : pourquoi ? » (pré-mortem)                   | `fable`  | trouver ce que personne n'a posé exige du jugement ; un modèle léger reformule la recommandation au lieu de l'attaquer | aucun — il lit le dossier                                                                                                                                 |
| **Attaquant**                   | « Comment je détourne ce qui est décidé ? »                                                | `fable`  | le raisonnement adverse combine des failles ; un modèle léger récite une liste générique                               | `nodefony-security-review` (matrice d'attaque, campagnes passées), `nodefony-rfc` (la norme qui tranche)                                                  |
| **Gardien de la compatibilité** | « Qui casse si on livre, et qui casse si on diffère ? »                                    | `sonnet` | applique une politique écrite (`docs/guides/compatibilite.md`) à un cas : de la lecture et un peu de jugement          | `nodefony-release`                                                                                                                                        |
| **Spécialiste perf**            | « Que coûte la décision par requête, par trame, par octet, à 100× ? »                      | `sonnet` | confronte la décision aux règles du chemin chaud et aux mesures existantes ; ne mesure pas lui-même                    | `nodefony-framework-dev`, `nodefony-load-test` (bancs et chiffres déjà mesurés), `nodefony-check-memory-health` (seuils de rétention)                     |
| **Exploitant**                  | « Qu'est-ce que je vois, règle et surveille en production, sur 2 serveurs, sur Windows ? » | `sonnet` | lit config, bus, journaux ; repère ce qui casse en silence                                                             | `nodefony-devops`, `nodefony-multipod-bench` (plusieurs exemplaires sur un bus réel), `nodefony-test-campaign` (ce qu'un vert ne prouve pas)              |
| **Développeur d'application**   | « Écris le code que la décision m'impose : est-il naturel, typé, sans piège ? »            | `sonnet` | écrit un vrai bout de code contre l'API proposée ; c'est de la plomberie guidée                                        | `nodefony-framework-dev`, le skill LIVRÉ du domaine (`src/packages/@nodefony/devkit/skills/…`)                                                            |
| **Auteur d'extension tierce**   | « J'écris mon driver, mon adaptateur, mon module : puis-je sans toucher au cœur ? »        | `sonnet` | lit les contrats publics (`exports`, interfaces) et tente l'extension sur papier                                       | `nodefony-inspect`                                                                                                                                        |
| **Mainteneur solo**             | « Combien de code, de tests et de doc à faire vivre seul ? Quelle règle en double ? »      | `sonnet` | compte, repère les doublons (1 règle = 1 implémentation) ; demande d'arbitrer le coût                                  | `nodefony-inspect`                                                                                                                                        |
| **Responsable de la version**   | « Faut-il le faire avant la version, ou peut-il attendre sans rupture ? »                  | `haiku`  | lit le tableau (`.ai/BOARD.md`) et la colonne « rupture si différé » : un verdict vérifiable                           | `nodefony-ticket`, `nodefony-release`                                                                                                                     |
| **Agent IA consommateur**       | « Avec la doc et l'exemple seuls, quelle solution j'écris ? »                              | `haiku`  | **volontairement le plus léger** : si `haiku` trouve la bonne solution par l'exemple, tout agent la trouvera           | les skills LIVRÉS aux applications du domaine (`src/packages/@nodefony/devkit/skills/…`) — et eux seuls ; ses tâches viennent du banc devkit (ci-dessous) |

**Les skills d'un siège sont son expérience.** Un skill éprouvé porte des bancs, des chiffres et
des pièges déjà payés : le siège qui le charge juge sur ce qui a été MESURÉ ici, pas sur un savoir
générique. On nomme dans la consigne les skills que la question du siège exige, pas davantage —
chacun se paie à la lecture, sur chaque siège. Un skill qui révélerait la réponse attendue est
exclu de la vue de ce siège (§4) : c'est le cas du banc devkit pour l'agent IA.

**L'agent IA consommateur et le banc devkit** (`nodefony-devkit-bench`, banc de découvrabilité).
Le banc est la source des tâches, mais c'est le PRINCIPAL qui le lit, jamais le siège : il y
porte les portes de contrôle attendues, qui souffleraient la réponse.

1. **Une tâche du banc couvre le domaine** (`TASKS` de
   `.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs` — canal temps réel,
   canal privé, route protégée…) → on reprend son énoncé MOT POUR MOT. Le résultat se compare
   alors aux runs du banc, au lieu de rester un avis isolé.
2. **Aucune ne le couvre** → le principal écrit la tâche, et après la décision elle ENTRE au banc
   (skill `nodefony-devkit-bench`, « une capacité neuve → après y avoir ajouté sa tâche ») : la
   table aura fabriqué la mesure qui gardera la décision.
3. **L'API est codée** → la tâche se joue pour de bon (`bench-discoverability.mjs --task <n>`),
   dans une application fraîche, avec les skills livrés réellement installés. C'est la seule
   preuve que la forme se devine ; la passe sur papier n'en est que l'avant-goût.

Le **principal ne siège pas** : il prépare, vérifie, synthétise. Les affirmations d'ancrage d'un
siège (`<fichier>.ts#<Symbole>` existe ? dit-il ça ?) se vérifient en lot par
l'agent **nodefony-check-claims** (`haiku`, `@agent-` devant son nom garantit le run), jamais à la main une par une au-delà de ~6.

## 3. Composer la table d'une décision

- **Toujours** : le contradicteur, et un siège consommateur (développeur d'application ou agent IA).
- **Puis** les sièges que la matrice désigne : une ligne « attaquant » dans le catalogue appelle
  l'attaquant ; « plusieurs instances » appelle l'exploitant ; « rupture si différé : oui »
  appelle le gardien de la compatibilité.
- **Quatre à six sièges.** Au-delà, le coût croît et les avis se répètent.
- **L'agent IA consommateur ne siège que s'il a quelque chose à EXÉCUTER.** Il mesure ce qu'un
  agent trouve avec ce qui est livré : si l'API jugée n'est pas encore codée ni documentée, il
  rend « bloqué, rien trouvé » sur chaque tâche, et c'est prévisible — un run payé pour rien.
  Dans ce cas, sa vue reçoit la **surface proposée** (types, signature, un exemple d'usage),
  présentée comme livrée, et rien d'autre : il mesure alors si cette forme se DEVINE — quel champ
  il prend, quelle garde il oublie. Vécu (#702) : bloqué sur ses quatre tâches au premier tour ;
  au troisième, l'API proposée en main, il a écrit seul les gardes contre `null` que l'exemple
  de la proposition omettait — la preuve que la doc devait les porter.

## 4. Le dossier remis à chaque siège

Un **dossier commun**, écrit une fois dans un fichier sous `tmp/scratch/` :

1. la question (socle du skill, point 1) et ce qu'elle ne couvre pas ;
2. le catalogue de scénarios (`methode-scenarios.md`) ;
3. les options et leur matrice (même page) — **sans la recommandation du principal** ;
4. les décisions qui font déjà foi, en chemins (`docs/adr/…`), et le code concerné en ancres
   `<fichier>.ts#<Symbole>`.

Montrer la préférence du principal, c'est obtenir sa confirmation : le dossier ne la contient pas.

**Puis des VUES CLOISONNÉES** : un siège ne lit pas ce qui fausserait son regard. Chaque vue est
un fichier à part, et la consigne lui interdit en toutes lettres d'ouvrir le reste.

| Siège                              | Ce qu'on lui RETIRE                                                                              | Pourquoi                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Attaquant                          | la section « Attaquant » du catalogue                                                            | il cocherait les attaques déjà parées au lieu d'en chercher (menace d'abord)                  |
| Développeur d'application          | ADR, catalogue, code interne — il garde §1, §2 du dossier, la doc PUBLIQUE et les types exportés | il juge l'API telle qu'il la vivrait, pas notre raisonnement                                  |
| Agent IA consommateur              | tout sauf l'ÉNONCÉ des tâches, le skill livré et la doc publique                                 | il mesure ce qu'un agent trouve avec ce qui est LIVRÉ ; le dossier lui soufflerait la réponse |
| Contradicteur, gardien, exploitant | rien                                                                                             | aucune préférence n'est écrite dans le dossier commun                                         |

```bash
# la vue de l'attaquant : le catalogue sans sa section « Attaquant »
awk '/^## Attaquant/{s=1;next} s&&/^## /{s=0} !s' docs/adr/scenarios/<domaine>.md \
  > tmp/scratch/table-<sujet>-catalogue-attaquant.md
```

⚠️ **Chaque chemin d'un dossier se vérifie (`ls`) avant le lancement** : un kit rédigé la veille
donnait la doc publique des webhooks sous `docs/guides/`, elle vit dans le module. Un chemin faux
envoie un siège payant chercher dans le vide. Et toute vue se **régénère** après une modification
du catalogue (un cas ajouté par le contradicteur doit atteindre l'attaquant).

⚠️ **Chaque PRÉMISSE d'une option se vérifie aussi, pas seulement les chemins.** Une option qui
dit « le contrat reste dans le module X » est fausse si une copie du contrat vit déjà ailleurs —
et un siège qui la juge sur parole raisonne sur un état qui n'existe pas. Avant le lancement :
un `rg` de chaque type, contrat ou nom public que les options citent, à la recherche de ses
COPIES et de ses lecteurs, et les résultats écrits dans le dossier (« faits relevés au code »).
Vécu (#702) : l'option A disait « l'identité reste dans `@nodefony/realtime` » ; une copie
structurelle vivait dans `@nodefony/security`, sans test de parité — trouvée par le
contradicteur, pas par le dossier. Chaque composant que le dossier NOMME porte aussi son ancre :
un siège à qui l'on parle du « hub » sans chemin le cherche, ne le trouve pas, et le dit.

## 5. La consigne type

```text
MODÈLE : <modèle> — <pourquoi, en une phrase>
Tu es le siège « <siège> » d’une table d’experts qui instruit une décision sur le framework Nodefony.
Ta seule question : <question du siège>.
Charge d'abord le(s) skill(s) : <liste>.
Lis le dossier : <chemin absolu du fichier>. Lis le code qu'il ancre si tu en as besoin.
INTERDIT : toucher à l'index git (ni checkout, stash, restore, reset, commit, push), écrire ou
modifier un fichier du dépôt, lancer un serveur. Tu proposes ; tu n'appliques rien.
Réponds en au plus 40 lignes, dans cette forme :
1. Par scénario du catalogue : tient / casse / sans objet — pour chaque option, avec la preuve
   (`<fichier>.ts#<Symbole>` ou passage d'ADR) ou « supposé, non vérifié ».
2. Scénarios absents du catalogue que ton métier impose (0 à 3).
3. L'option que tu choisirais et la seule raison qui compte pour ton métier.
4. Ce que tu n'as pas pu vérifier.
```

**Le siège « agent IA consommateur » a sa propre forme** : il ne juge pas des options, il
EXÉCUTE des tâches. Sa consigne lui donne l'énoncé (« Notifie l'utilisateur 42… ») et lui demande

1. son plan et le code esquissé par tâche, 2. pour chaque choix le fichier et le passage qui l'y a
   conduit — ou « deviné, rien trouvé », 3. ce qu'il a cherché sans le trouver. Les « deviné » sont
   le résultat : chacun est un trou de la doc livrée.

Type d'agent : **`Plan`** (lecture du code, sans écriture de fichier, et dispensé de recharger la
hiérarchie `CLAUDE.md` — un plancher plus bas, ce qui compte sur six sièges). Il ne reçoit donc
PAS les règles du projet : la consigne les lui apporte par les skills qu'elle nomme. Le modèle
s'écrit aussi entre crochets dans le champ `description` de l'appel (`"[fable] Siège
contradicteur"`), parce qu'un agent intégré peut ne pas l'afficher.

## 6. Lancer, puis faire la synthèse

1. **Annoncer** à l'auteur : sièges, modèle de chacun, coût estimé (§7) ; attendre le go.
2. **Le contradicteur SEUL d'abord**, sur une seule question : « quels scénarios MANQUENT au
   catalogue ? » (au plus 5), plus les cas mal posés. Chaque cas proposé se vérifie au code, puis
   entre au catalogue ; les vues cloisonnées se régénèrent. Mesuré : c'est la passe au meilleur
   rendement de toute la table — ses 5 cas ont tous tenu au code, et 4 d'entre eux ont changé une
   décision que 10.0 allait figer.
3. **Puis les autres sièges dans le même message** (appels indépendants, en parallèle) : aucun ne
   voit les autres.
4. **PAS de seconde passe « matrice » du contradicteur.** Le relancer pour qu'il repasse toutes
   les options sur tout le catalogue relit son contexte entier au tarif `fable` : mesuré ~3,5 $, et
   aucun constat qu'il n'ait déjà rendu en première passe. La matrice, c'est la synthèse du
   principal qui la fait, sur les réponses déjà reçues.
5. **Synthèse par le principal** :
   - **points d'accord** : rangés, non montrés un par un ;
   - **points contestés** : deux sièges en désaccord, ou un siège qui casse un scénario — chacun
     VÉRIFIÉ au code avant d'être retenu. Un siège se trompe aussi en affirmant une ABSENCE
     (vécu : « aucun test ne garde ce comportement » — il y en avait un, trouvé par `rg`) ;
   - **scénarios nouveaux** : ajoutés au catalogue, avec la décision qu'ils ont fait changer ;
   - **une recommandation d'un siège qui contredit une décision déjà écartée dans un ADR** se
     confronte au motif écrit avant d'être retenue (vécu : l'anti-rejeu par horloge, écarté par
     ADR-0022, re-proposé par l'attaquant sous une autre forme).
6. Les points contestés retenus deviennent les tours de la méthode « pas à pas », un à la fois —
   ou le principal tranche, quand l'auteur le lui a délégué.

Une orchestration par l'outil `Workflow` (des dizaines d'agents, vérification adverse de chaque
constat) ne se lance que si l'auteur le demande en ces termes (« utilise un workflow ») ; la
table ordinaire tient en appels `Agent` parallèles.

## 6bis. Tours de convergence : soumettre la FORME, puis s'arrêter

Le premier tour tranche un CHOIX (A, B ou C). Souvent, la synthèse en sort une **forme** que
personne n'a vue : une signature, un type, un ensemble de gardes. Cette forme se resoumet à la
table — un tour de convergence. Vécu (#702, l'identité d'admission) : trois tours, et chacun a
changé la forme — tour 1 le choix (une donnée plutôt qu'un objet), tour 2 la structure (deux
types au lieu d'un), tour 3 des retraits et des ajouts (un champ retiré, un champ ajouté, cinq
protections) et un défaut de sécurité dans le code EXISTANT. Le tour 2 n'aurait pas suffi.

**La proposition dans UN fichier** (`tmp/scratch/table-<sujet>-<point>-v<N>.md`), jamais dans
les messages : la forme exacte ; « ce qui a changé depuis v<N-1> », chaque changement avec sa
preuve au code ; « écarté », avec le motif ; « hors de ce tour ».

**La préférence est visible par nature : on retourne donc la question.** Pas « es-tu d'accord ? »
— on obtiendrait une confirmation — mais « quel cas fait tomber CETTE forme, ou quelle forme
STRICTEMENT meilleure existe ? ». C'est cette question, posée au tour 3 seulement, qui a fait
sortir le retrait d'un champ que deux tours avaient laissé passer.

**La consigne de relance** (au MÊME siège, par `SendMessage` — son contexte est intact) :

```text
Relance de la table sur <point> : <ce que l'auteur attend>. Lis <chemin absolu de la proposition>.
Mêmes interdits qu'avant (index git, écriture, serveur).
Ta question (<siège>) : quel cas fait tomber cette forme — ou quelle forme strictement meilleure ?
Toute affirmation NEUVE se prouve au code : relis le fichier, ne cite pas de mémoire.
NE RÉPÈTE PAS ton rapport précédent. Au plus 15 lignes : D'ACCORD / RÉSERVE / CONTRE,
la preuve (`<fichier>.ts#<Symbole>`), le changement exigé.
```

Les deux phrases en capitales ne sont pas décoratives. Sans elles (#702) : un siège a recopié
tout son rapport T1-T4 à chaque relance, et trois sièges `sonnet` sur quatre ont jugé « sur le
texte seul, code non rouvert » — des réserves moins prouvées qu'au premier tour.

**Les cloisons tiennent aussi en relance** : l'attaquant ne lit toujours pas la section
« Attaquant » ; le développeur lit la proposition (c'est l'API qu'il vivrait) ; l'agent IA n'en
lit que la forme et l'exemple (§3).

**Qui relancer.** Les sièges qui avaient une réserve, plus le contradicteur quand la STRUCTURE a
changé — c'est lui qui, à chaque tour de #702, a trouvé ce qui faisait tomber la forme, et aussi le
plus cher (11,60 $ pour trois passes, contre ~1 $ par siège `sonnet`). Un changement de
formulation ne justifie pas sa relance.

**Le critère d'arrêt**, écrit, pour ne pas le réinventer devant l'auteur :

1. aucun siège CONTRE ;
2. aucun siège ne propose une autre architecture ;
3. les réserves restantes sont des AJOUTS (un champ, une garde, un test), vérifiés au code et
   intégrés à la forme.

Ce qui reste incertain alors ne se tranche plus en relisant : ça se prouve par les tests du ticket
qui code la décision (vus rouges une fois), et par la revue finale (§8). Ne pas payer un tour de
plus pour un détail.

**Ce qu'un tour coûte vraiment : le contexte du PRINCIPAL.** Mesuré sur #702 : sièges 16,20 $ pour
trois tours ; principal 26,66 $ — chaque tour relit tout l'historique de la session, et la synthèse
s'allonge à chaque passe. Dès le deuxième tour, écrire la proposition ET la synthèse sur le disque,
et proposer à l'auteur de continuer en session neuve. Après un `/clear`, ne pas supposer les
sièges encore joignables : la relance repart du fichier de proposition.

**Montrer un tour à l'auteur** : un tableau D'ACCORD / RÉSERVE / CONTRE par siège, les constats
vérifiés au code (et ceux qui étaient faux), la forme v<N+1>. Une question fermée par message —
et au second « explique », le socle du skill, point 5.

## 7. Le budget, et comment l'économiser à résultat identique

Mesuré sur ce dépôt : un agent maison coûte ~33 k tokens AVANT d'avoir lu quoi que ce soit
(hiérarchie `CLAUDE.md` comprise) ; `Plan` en est dispensé et part plus bas. Coût relatif par
réponse : `haiku` 1, `sonnet` ~5, `fable` ~40. Une table de six sièges (deux `fable`, trois
`sonnet`, un `haiku`) se chiffre donc en centaines de milliers de tokens : réservée aux décisions
structurantes, annoncée avant, jamais relancée pour un détail. Le contexte principal, lui, ne
reçoit que les synthèses — c'est ce qui rend la table moins chère que la même exploration faite
au fil de la conversation, où chaque sortie se relit à chaque tour.

**Mesuré sur une table réelle** (6 sièges, `session-cost --session`) : un siège `fable` coûte
**4,85 à 6,54 $**, un siège `sonnet` **0,34 à 0,46 $**, le siège `haiku` **0,25 $** ; le principal
~4 $ ; total ~17 $. Les deux sièges `fable` font donc les deux tiers de la dépense. Les compteurs
par siège vivent dans `assets/sieges.json` (§9).

**Le mode ÉCONOME est le défaut** : contradicteur `fable` en UNE passe (§6), attaquant `fable`
seulement si le catalogue porte une section « Attaquant » qui juge les décisions de la table,
tous les autres sur leur modèle de `assets/sieges.json`. Une table sans attaquant tombe sous 10 $.

**Ce qui économise sans rien changer au résultat** — chaque geste retire du coût que la synthèse ne
verrait pas :

- **Le dossier dans UN fichier**, chemin donné à chaque siège — jamais recopié dans six consignes.
- **`Plan` plutôt qu'un agent maison** : pas de hiérarchie `CLAUDE.md` rechargée par siège.
- **Les ancres déjà dans le dossier** (`<fichier>.ts#<Symbole>`) : un siège lit ce qu'on lui montre,
  il ne refait pas l'exploration du principal.
- **Une réponse bornée** (40 lignes, forme fixe) : la synthèse lit six réponses courtes au lieu de
  six essais.
- **Les seuls sièges que la matrice désigne** (§3) : un siège dont aucun scénario ne relève de son
  métier ne rendra rien que les autres n'aient dit.
- **Une relance va au MÊME siège** (`SendMessage` à l'agent qui a répondu, son contexte intact),
  jamais à un agent neuf qui relirait tout — mais elle relit ce contexte entier : sur un siège
  `fable`, ne relancer que pour une question que personne d'autre ne peut trancher.
- **La vérification des ancres en lot**, par un agent `haiku` (§2), jamais siège par siège.
- **Le catalogue de scénarios réutilisé** d'une décision à l'autre du même domaine.

## 8. La revue finale d'un ensemble

Quand un ensemble de décisions structurantes est complet (un ADR entier, plusieurs ADR d'un même
domaine), un siège unique `fable` relit les documents **côte à côte** et le code qu'ils ancrent.
Grille : (1) contradictions entre documents ; (2) document contre code ; (3) une règle portée deux
fois ; (4) généricité — chaque décision tient ≥ 3 usages hétérogènes ; (5) typage — contrat partagé,
zéro conversion ; (6) isomorphisme — même règle pure des deux côtés. Rendu : « constat → fichier →
texte exact → preuve → correction proposée », chaque constat repassé devant l'auteur.

## 9. Apprendre : le bon modèle par siège, prouvé par l'usage

Le modèle d'un siège n'est pas une opinion figée : il se **prouve**. Un siège sur un modèle trop
fort coûte sans rien ajouter ; trop faible, il rend une analyse plausible et fausse, payée deux
fois. La table apprend des deux côtés, sur une seule grandeur : les **constats retenus** — ceux
que le principal a vérifiés au code et qui ont changé quelque chose (un scénario ajouté, une
option écartée, une condition posée, un point montré à l'auteur).

**Après chaque table**, le principal met à jour `assets/sieges.json`, siège par siège : tables
jouées, constats rendus, constats retenus, constats faux (affirmés, démentis au code), et le coût
cumulé `coutUsd`, lu par `node .claude/skills/nodefony-session/scripts/session-cost.mjs --session <id>`
(une ligne par siège). Le rapport `constatsRetenus / coutUsd` est ce qui désigne le siège à
déclasser en premier. C'est de la DONNÉE, pas un journal : des compteurs qui s'incrémentent
en place.

**Essai de déclassement — pour économiser.** Quand un siège a joué au moins trois tables, la
suivante le fait siéger **deux fois en parallèle**, sur son modèle et sur le modèle juste en
dessous, avec le même dossier. Le principal compare les constats retenus :

- le modèle léger retient **les mêmes constats** (ou plus) sur deux essais de suite → le siège
  **descend** (`assets/sieges.json`, avec la raison) ;
- il en **manque un seul** qui comptait → le siège reste, et l'écart est noté (quel constat, pourquoi
  le modèle léger l'a raté) — c'est ce qui justifie le modèle fort, en une phrase vérifiable.

**Surclassement — pour la qualité.** Un siège dont un constat faux a été cru, ou qui a manqué un
cas qu'un autre siège ou la suite des événements a montré dans SON métier, **monte** d'un cran, avec
la raison écrite.

**Ce que l'essai coûte** : un siège de plus, une fois de temps en temps. C'est le prix de la
preuve ; sans lui, le modèle reste une supposition que personne ne remet en cause.

**Ce qui n'en dépend jamais** : le siège « agent IA consommateur » reste sur le modèle le plus
léger par construction — il mesure ce qu'un agent faible trouve, pas ce que la table sait faire.
