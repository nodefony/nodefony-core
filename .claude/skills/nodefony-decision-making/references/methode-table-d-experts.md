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

| Siège                           | Sa seule question                                                                          | Modèle   | Pourquoi ce modèle                                                                                                     | Skills à lui faire charger                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Contradicteur**               | « On est dans un an, cette décision a échoué : pourquoi ? » (pré-mortem)                   | `fable`  | trouver ce que personne n'a posé exige du jugement ; un modèle léger reformule la recommandation au lieu de l'attaquer | aucun — il lit le dossier                                                             |
| **Attaquant**                   | « Comment je détourne ce qui est décidé ? »                                                | `fable`  | le raisonnement adverse combine des failles ; un modèle léger récite une liste générique                               | `nodefony-security-review`                                                            |
| **Gardien de la compatibilité** | « Qui casse si on livre, et qui casse si on diffère ? »                                    | `sonnet` | applique une politique écrite (`docs/guides/compatibilite.md`) à un cas : de la lecture et un peu de jugement          | `nodefony-release`                                                                    |
| **Spécialiste perf**            | « Que coûte la décision par requête, par trame, par octet, à 100× ? »                      | `sonnet` | confronte la décision aux règles du chemin chaud et aux mesures existantes ; ne mesure pas lui-même                    | `nodefony-framework-dev`, `nodefony-load-test`                                        |
| **Exploitant**                  | « Qu'est-ce que je vois, règle et surveille en production, sur 2 serveurs, sur Windows ? » | `sonnet` | lit config, bus, journaux ; repère ce qui casse en silence                                                             | `nodefony-devops`                                                                     |
| **Développeur d'application**   | « Écris le code que la décision m'impose : est-il naturel, typé, sans piège ? »            | `sonnet` | écrit un vrai bout de code contre l'API proposée ; c'est de la plomberie guidée                                        | `nodefony-framework-dev`                                                              |
| **Auteur d'extension tierce**   | « J'écris mon driver, mon adaptateur, mon module : puis-je sans toucher au cœur ? »        | `sonnet` | lit les contrats publics (`exports`, interfaces) et tente l'extension sur papier                                       | `nodefony-inspect`                                                                    |
| **Mainteneur solo**             | « Combien de code, de tests et de doc à faire vivre seul ? Quelle règle en double ? »      | `sonnet` | compte, repère les doublons (1 règle = 1 implémentation) ; demande d'arbitrer le coût                                  | `nodefony-inspect`                                                                    |
| **Responsable de la version**   | « Faut-il le faire avant la version, ou peut-il attendre sans rupture ? »                  | `haiku`  | lit le tableau (`.ai/BOARD.md`) et la colonne « rupture si différé » : un verdict vérifiable                           | `nodefony-ticket`                                                                     |
| **Agent IA consommateur**       | « Avec la doc et l'exemple seuls, quelle solution j'écris ? »                              | `haiku`  | **volontairement le plus léger** : si `haiku` trouve la bonne solution par l'exemple, tout agent la trouvera           | le skill LIVRÉ aux applications du domaine (`src/packages/@nodefony/devkit/skills/…`) |

Le **principal ne siège pas** : il prépare, vérifie, synthétise. Les affirmations d'ancrage d'un
siège (`<fichier>.ts#<Symbole>` existe ? dit-il ça ?) se vérifient en lot par
l'agent **nodefony-check-claims** (`haiku`, `@agent-` devant son nom garantit le run), jamais à la main une par une au-delà de ~6.

## 3. Composer la table d'une décision

- **Toujours** : le contradicteur, et un siège consommateur (développeur d'application ou agent IA).
- **Puis** les sièges que la matrice désigne : une ligne « attaquant » dans le catalogue appelle
  l'attaquant ; « plusieurs instances » appelle l'exploitant ; « rupture si différé : oui »
  appelle le gardien de la compatibilité.
- **Quatre à six sièges.** Au-delà, le coût croît et les avis se répètent.

## 4. Le dossier remis à chaque siège

Le MÊME pour tous, écrit une fois dans un fichier du dossier temporaire de la session :

1. la question (socle du skill, point 1) et ce qu'elle ne couvre pas ;
2. le catalogue de scénarios (`methode-scenarios.md`) ;
3. les options et leur matrice (même page) — **sans la recommandation du principal** ;
4. les décisions qui font déjà foi, en chemins (`docs/adr/…`), et le code concerné en ancres
   `<fichier>.ts#<Symbole>`.

Montrer la préférence du principal, c'est obtenir sa confirmation : le dossier ne la contient pas.

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

Type d'agent : **`Plan`** (lecture du code, sans écriture de fichier, et dispensé de recharger la
hiérarchie `CLAUDE.md` — un plancher plus bas, ce qui compte sur six sièges). Il ne reçoit donc
PAS les règles du projet : la consigne les lui apporte par les skills qu'elle nomme. Le modèle
s'écrit aussi entre crochets dans le champ `description` de l'appel (`"[fable] Siège
contradicteur"`), parce qu'un agent intégré peut ne pas l'afficher.

## 6. Lancer, puis faire la synthèse

1. **Annoncer** à l'auteur : sièges, modèle de chacun, coût estimé (§7) ; attendre le go.
2. **Lancer tous les sièges dans le même message** (appels indépendants, en parallèle) : aucun ne
   voit les autres.
3. **Synthèse par le principal** :
   - **points d'accord** : rangés, non montrés un par un ;
   - **points contestés** : deux sièges en désaccord, ou un siège qui casse un scénario — chacun
     VÉRIFIÉ au code avant d'être retenu ;
   - **scénarios nouveaux** : ajoutés au catalogue, la matrice repassée.
4. Les points contestés retenus deviennent les tours de la méthode « pas à pas », un à la fois.

Une orchestration par l'outil `Workflow` (des dizaines d'agents, vérification adverse de chaque
constat) ne se lance que si l'auteur le demande en ces termes (« utilise un workflow ») ; la
table ordinaire tient en appels `Agent` parallèles.

## 7. Le budget, et comment l'économiser à résultat identique

Mesuré sur ce dépôt : un agent maison coûte ~33 k tokens AVANT d'avoir lu quoi que ce soit
(hiérarchie `CLAUDE.md` comprise) ; `Plan` en est dispensé et part plus bas. Coût relatif par
réponse : `haiku` 1, `sonnet` ~5, `fable` ~40. Une table de six sièges (deux `fable`, trois
`sonnet`, un `haiku`) se chiffre donc en centaines de milliers de tokens : réservée aux décisions
structurantes, annoncée avant, jamais relancée pour un détail. Le contexte principal, lui, ne
reçoit que les synthèses — c'est ce qui rend la table moins chère que la même exploration faite
au fil de la conversation, où chaque sortie se relit à chaque tour.

## 8. La revue finale d'un ensemble

Quand un ensemble de décisions structurantes est complet (un ADR entier, plusieurs ADR d'un même
domaine), un siège unique `fable` relit les documents **côte à côte** et le code qu'ils ancrent.
Grille : (1) contradictions entre documents ; (2) document contre code ; (3) une règle portée deux
fois ; (4) généricité — chaque décision tient ≥ 3 usages hétérogènes ; (5) typage — contrat partagé,
zéro conversion ; (6) isomorphisme — même règle pure des deux côtés. Rendu : « constat → fichier →
texte exact → preuve → correction proposée », chaque constat repassé devant l'auteur.

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
  jamais à un agent neuf qui relirait tout.
- **La vérification des ancres en lot**, par un agent `haiku` (§2), jamais siège par siège.
- **Le catalogue de scénarios réutilisé** d'une décision à l'autre du même domaine.

## 9. Apprendre : le bon modèle par siège, prouvé par l'usage

Le modèle d'un siège n'est pas une opinion figée : il se **prouve**. Un siège sur un modèle trop
fort coûte sans rien ajouter ; trop faible, il rend une analyse plausible et fausse, payée deux
fois. La table apprend des deux côtés, sur une seule grandeur : les **constats retenus** — ceux
que le principal a vérifiés au code et qui ont changé quelque chose (un scénario ajouté, une
option écartée, une condition posée, un point montré à l'auteur).

**Après chaque table**, le principal met à jour `assets/sieges.json`, siège par siège : tables
jouées, constats rendus, constats retenus, constats faux (affirmés, démentis au code), et le coût
du run, lu par `node .claude/skills/nodefony-session/scripts/session-cost.mjs --session <id>`
(une ligne par siège). C'est de la DONNÉE, pas un journal : des compteurs qui s'incrémentent
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
