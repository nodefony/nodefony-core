# Rédiger une documentation Nodefony — standard d'écriture (contenu)

> **Maintenance** : décrit la vérité COURANTE. Éditer en place, jamais de journal daté (historique =
> `git log`). Référence chargée à la demande par le skill `nodefony-documentation`.
>
> But : donner à un humain **ET à un agent** (futur devkit-agent qui génère de la doc Nodefony) la
> règle exacte pour produire une page de doc correcte, rendue parfaitement, et réingérable en RAG.
> Chaque contrainte ci-dessous est **vérifiée au code** (ancrages `fichier:ligne`), pas supposée.

## 1. Deux audiences, une source

La doc sert deux lecteurs à partir du **même Markdown** :

1. **Humain** → lit le **HTML rendu par Studio** (`@nodefony/documentation` → `MarkdownDoc.tsx`).
2. **Agent IA** → **réingère le Markdown** (chunk/embed) + le graphe TSDoc `.ai/symbols.json`.

Conséquence : on écrit du **Markdown**, jamais du HTML à la main. Le Markdown est la vérité versionnée
et réingérable ; le HTML est un rendu (Studio) ou un compagnon généré (cf §5).

## 2. Le contrat runtime du frontmatter (ce que le module LIT vraiment)

Le parser (`@nodefony/documentation/nodefony/src/frontmatter.ts`) est **YAML plat** (clé: scalaire,
`[a,b]`, ou liste en bloc). Le service (`service/DocumentationService.ts`, `getPage`) ne consomme que :
`title`, `audience`, `version` (défaut `"doc"`), `status`, `updated`, `source`. Les autres clés sont
conservées mais ignorées (utiles au RAG).

- `audience` = **persona**, enum `DocAudience` (`interfaces/IDocumentation.ts`) : `developer` |
  `devops` | `supervisor` | `admin`. Toute autre valeur (`human`, `ai`, `architect`, `dev`) est
  **filtrée** (⇒ « toutes »). Ne PAS écrire `[human, ai]`.
- `status` = enum `DocStatus` : `stable` | `draft` | `temporary` | `experimental` | `deprecated`.
- La date lue est **`updated`** — **jamais `last-updated`** (sinon date non affichée, fallback git).
- `section` frontmatter est parsé mais **non utilisé** pour le regroupement : les sections de l'index
  sont bâties depuis le **dossier parent** du fichier (`docScanner.ts` `group`).

### Gabarit unique (à copier)

```yaml
---
title: "Titre lisible"
lang: fr # locale de la page (réservé i18n ; défaut fr)
module: "@nodefony/http" # ou "global" ; extra RAG (ignoré par le parser)
topic: pipeline-http # slug de sujet stable (RAG)
section: "Cœur runtime" # informatif
audience: [developer] # developer|devops|supervisor|admin (vide = toutes)
tags: [http, context] # extra RAG
version: "doc" # docs module : version du package
status: stable
updated: AAAA-MM-JJ # ⚠️ `updated`, PAS last-updated
source: "<chemin repo>" # optionnel
---
```

## 3. Où écrire (ADR-0001)

- Doc **d'un module** → DANS le module : `src/packages/@nodefony/<m>/docs/*.md` (core →
  `src/nodefony/docs/`). Surfacé dans l'onglet Docs du module (Studio).
- Doc **transverse** (multi-module, guide, tutoriel, ADR) → `docs/` racine.
- **Référence d'API** (signatures/membres) → **jamais écrite à la main** : générée depuis les TSDoc
  (`.ai/symbols.json`). La doc explique, montre, relie — elle ne recopie pas les signatures.
- Déplacer un `.md` = `git mv` (préserve l'historique).

## 4. Visuels — « jamais bloqué » (capacités VÉRIFIÉES du portail)

Rendu Studio (`MarkdownDoc.tsx`) : **Mermaid 11.16** + react-markdown + remark-gfm, **SANS
`rehype-raw`** (`MarkdownDoc.tsx:57` — « 0 HTML injecté »).

| Visuel voulu                                                | Comment                                               |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| Flux, séquence, état, classe, ER                            | **Mermaid** dans le MD                                |
| **Kanban**, timeline, gantt, mindmap                        | **Mermaid 11** (types natifs)                         |
| Barres, lignes                                              | **Mermaid `xychart-beta`**                            |
| Scatter+régression, heatmap, waterfall, jauge, donut        | **Compagnon HTML** (`report.mjs`) ou composant Studio |
| Interactif : tri/filtre, calculateur, kanban éditable, drag | **Compagnon HTML** (`report.mjs`) ou `FlowGraph`      |

> **RÈGLE NON NÉGOCIABLE** : **jamais de HTML/SVG brut dans le MD** — le portail ne le rend pas et ça
> pollue le RAG. Tout visuel passe par Mermaid (structure/kanban/chart simple) ou par le compagnon
> HTML / composant Studio (data-riche, interactif). C'est ce qui rend la reconstruction HTML **parfaite**.

Admonitions supportées (remark-gfm + override) : `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`.

## 5. Deux classes de livrables

1. **Corpus Markdown (COMMITÉ)** : `docs/` + `<module>/docs/`. Versionné, RAG, doc du code, rendu
   Studio. Le MD **porte le modèle** (formules, constantes, entrées, invariants) en prose + tables →
   rien de ce qui rend un HTML utile n'est perdu, et l'outil interactif reste régénérable.
2. **Outil HTML interactif (GÉNÉRÉ, `tmp/`, NON commité)** : aide à décider/manipuler/imprimer.
   Généré par `nodefony-html-report/lib/report.mjs` (import, jamais recopié). Autonome (0 CDN/réseau),
   échappé (`esc()`), a11y, imprimable, rejouable. Ex. calculateur de capacité
   (`nodefony-load-test/scripts/capacity.mjs`). Ne PAS committer dans `docs/`.

Choix du format = **qui lit** (`html-vs-md.md`) : humain qui décide → HTML ; outil/LLM/diff → MD.

## 6-ergo. ERGONOMIE DE LECTURE (retour user 2026-07-19 — appuyé NN/g + Google style guide)

> Mesures Nielsen Norman Group : texte concis = **+58 %** d'usabilité, listes scannables = **+47 %**,
> les trois principes combinés = **+124 %**. Un lecteur découragé ne lit PAS — l'exactitude d'une
> page illisible ne sert à rien.

1. **Un paragraphe = UNE idée, ≤ 4 lignes rendues.** Un pavé de 7 lignes se découpe ou devient une
   liste. Couper de moitié par rapport au premier jet (pyramide inversée : conclusion d'abord).
2. **Liste > prose** dès qu'on énumère ≥ 2 propriétés/défenses/étapes. Séquence → liste numérotée.
   Conditions AVANT instructions (« Si X, fais Y » — jamais l'inverse).
3. **Les ancres de preuve ne polluent PAS la lecture** : ce sont des références pour la
   vérification (gates, IA, mainteneur), pas du contenu pour le lecteur.
   - Dans la prose : **1 ancre max par affirmation-clé, en FIN de phrase** entre parenthèses.
     Jamais en plein milieu d'une phrase, jamais 3 ancres dans un paragraphe narratif.
   - Les ancres denses vivent dans les **tableaux** (Normes, Pièges) et sections de référence.
   - Au **rendu** (build-preview, et MarkdownDoc Studio à terme) : une ancre `fichier.ts:NNN` est
     affichée en **référence discrète** (petite, atténuée, type note de bas de page) — le MD reste
     la source vérifiable, le lecteur voit un texte propre.
4. **Le code doit être VISUEL** : coloration syntaxique obligatoire au rendu ; un bloc = une idée ;
   commentaires courts qui disent le POURQUOI ; jamais un bloc > ~25 lignes sans être découpé.
5. **Mots-clés en gras** pour le balayage (le lecteur scanne en F) ; sous-titres significatifs qui
   répondent à une question, pas des titres décoratifs.
6. **Catalogue de briques = CARDS** (série homogène : authenticators, stores, drivers…) —
   convention 100 % Markdown : chaque brique s'écrit ``### `nom` — titre`` (le nom en code
   inline) ; le rendu (build-preview, MarkdownDoc Studio à terme) en fait une **card** (bordure
   accent, nom en pill, corps encadré). Toujours précéder le catalogue d'un **tableau de synthèse**
   (choisir en 5 s) — les cards donnent le détail.
7. **Rythmer avec les admonitions** (`> [!TIP]` · `> [!WARNING]` · `> [!IMPORTANT]`) : un piège
   énoncé en « Piège : … » dans un paragraphe se noie ; en `[!WARNING]` il saute aux yeux.
   1-3 par page, aux endroits où se tromper coûte cher — pas une par paragraphe.

## 6. Style d'écriture

- **Vulgariser d'abord** : analogie physique concrète (ex « backplane = fond de panier »), puis terme
  exact + trad FR, schéma, « pourquoi » avant « comment ». Vaut aussi pour la 1ʳᵉ phrase TSDoc.
- **Première phrase auto-suffisante** (extraite dans `symbols.json` / résumé RAG).
- Phrases courtes, voix active. Deux niveaux : accroche pour le débutant + détail pour l'expert.
- **Pas de journal** dans le corps : ni date (sauf frontmatter `updated`), ni « TODO », ni « à venir »,
  ni n° de phase de migration. Avancement = `MIGRATION_STATUS.md`, historique = `git log`.

## 7. Vérification (devise : « la confiance n'exclut pas le contrôle »)

- **Le code est la règle, le `git log` est la règle.** `MEMORY.md`/`CLAUDE.md`/`MIGRATION_STATUS.md`
  = indices périmables, jamais preuve. Chaque affirmation ancrée sur un `fichier:ligne` lu, ou sur un
  **test** (dont `tests/load` et `memory.test.ts` pour les chiffres de perf/mémoire).
- **ANCRE SYMBOLIQUE (règle 2026-07-19) — le symbole d'abord, la ligne en preuve.** Format :
  `` `Firewall.matchPath()` (`firewall.ts:529`) ``. Le NOM porte le sens (le lecteur sait ce qu'il va
  trouver sans ouvrir le fichier) et survit aux déplacements de code ; la ligne date la preuve.
  **INTERDIT** : une ligne nue sans symbole ni fichier (``(`:223-232`)``) — illisible pour un humain,
  irrésoluble pour une IA (vécu : 19 ancres sur 283 déjà décalées 2 jours après écriture ; le symbole,
  lui, se re-résout par `grep`/`.ai/symbols.json`). Vérif mécanique : `anchor-check.mjs` (résout chaque
  ancre contre le code réel — FILE_NOT_FOUND/LINE_OUT/SUSPECT).
- **Exemples** > 3 lignes : tirés du dépôt (donner le chemin) ou compilés (typecheck du module).
- **Gate rendu HTML parfait** (par page) : 0 HTML/SVG brut ; aperçu vérifié avec un moteur fidèle à
  Studio (react-markdown + remark-gfm + Mermaid 11, sans rehype-raw) ; tous les Mermaid compilent ;
  lisible thème clair ET sombre ; a11y (SVG `role`/`aria-label`, focus, contraste).

## 8. Introduction OBLIGATOIRE (en tête de CHAQUE page)

Toute page s'ouvre par le même bloc, dans cet ordre — c'est ce qui met le lecteur (et l'agent) à
l'aise avant le technique :

1. **Schéma général** (Mermaid) — une vue d'ensemble de la brique et de sa place, dès le début.
2. **Lexique** — table de **tous les acronymes/termes** employés dans la page (sigle → développé +
   1 ligne). Le lecteur ne doit jamais deviner. Ex : `CSRF` → _Cross-Site Request Forgery_ : un site
   tiers force le navigateur de la victime à envoyer une requête authentifiée à son insu.
3. **Qu'est-ce que c'est ?** — le concept **générique et concret**, vulgarisé (analogie d'abord).
   - Si la brique est de **sécurité** : dire **quelle faille concrète elle bloque** et **pourquoi**
     (scénario d'attaque en une phrase). Ex. idempotence : bloque le **double effet** d'une requête
     rejouée (double débit sur un paiement retenté / rejeu réseau).
4. **La vision Nodefony** — **comment** Nodefony l'implémente (la brique réelle, ancrée au code),
   ce qu'il fait différemment et le compromis assumé.
5. **Liens** utiles (normes, doc voisine, code source) — dès l'intro quand c'est pertinent.

## Maintenance — mettre à jour une page quand le code change

La doc vit **dans le module** (ADR-0001) → on l'édite à côté du code qu'on vient de changer. Workflow :

1. Déclencher le skill `nodefony-documentation` ("mets à jour la doc <brique>") → il (re)charge cette
   référence.
2. **Re-vérifier le code changé** (`fichier:ligne`) — ne jamais patcher la doc de mémoire (devise).
3. Éditer **en place** la ou les sections concernées (règle intemporelle : 0 date dans le corps, 0
   « corrigé le… », 0 changelog — l'historique est `git log`). Une table de config se **re-dérive** du
   schéma Zod ; une entité, du fichier d'entité.
4. Bumper `updated:` dans le frontmatter (le SEUL endroit daté).
5. **Studio rend le `.md` en direct** (cache 30 s ; `cache.ttlMs:0` en dev) → rien à régénérer côté
   portail. L'aperçu HTML autonome (`build-preview.mjs`) ne sert qu'à une revue HORS Studio.
6. Commit `docs(<module>): <brique> — <ce qui a changé>`.

**Détecter la dérive** : date git de la page < date git du code du module (Studio affiche déjà la
fraîcheur). Toute contradiction code↔doc trouvée en chemin va dans `tmp/doc-findings.md` (le code gagne).

## 8bis. Analyse PRÉALABLE par brique — « qu'est-ce qu'un dev doit comprendre ? »

Avant d'écrire, répondre à ces questions SUR LA BRIQUE ; les réponses **décident** des sections à
ajouter (le squelette §9 est un maximum, pas une checklist rigide — on n'écrit que ce qui a du sens) :

- Quel **problème** résout-elle, et pour la sécurité **quelle faille** bloque-t-elle ? → intro §8.
- **Persiste-t-elle** un état ? → §« Entité(s) de persistance » (colonnes + **types par dialecte**).
- **Combien de backends/dialectes** la portent, et lesquels NON ? → §« Dialectes / bases » (dénombrer,
  dire l'absent — ex. idempotence : pas de Mongo ; session : Mongo OUI).
- Est-elle **surfacée dans Studio** (Playground, écran admin, ERD, API `/nodefony/<m>/api/*`) ? → §Observabilité avec **liens**.
- Concerne-t-elle **HTTP et WebSocket** ? → l'expliquer (différenciateur).
- A-t-elle une **config** (schéma Zod) ? un **coût perf/mémoire** mesurable (tests) ? des **normes** ?
- Quels **pièges réels** (vus dans le code/tests) un dev rencontrera-t-il ?

Une section sans matière se **supprime** (pas de remplissage). Une brique riche (session) aura entité +
dialectes + Studio + sécurité fournie ; une brique pure (un helper) n'aura ni entité ni Studio.

## 8bis-index. Point d'entrée du module — `index.md` (récapitulatif)

Chaque module a un **`index.md`** (ADR-0001 : `<module>/docs/index.md`) — c'est le **hub** affiché en
premier dans l'onglet Docs de Studio. Il **récapitule tout le module** et pointe vers les pages de
brique (il ne les duplique pas). Contenu :

- Titre + pitch du module + statut/version.
- **Place dans le graphe de dépendances** (Mermaid) + rôle (ce que le module apporte).
- **Table des concepts/briques** du module → liens vers chaque page (`idempotence`, `session`, …) avec
  1 ligne de résumé chacune.
- **Surface publique** (exports clés) → renvoi `symbols.json` (jamais recopier les signatures).
- **Configuration** principale → renvoi au bloc/section config.
- **Observabilité Studio** du module (écrans, ERD, API `/nodefony/<module>/api/*`).
- **Compteur tests + couverture du MODULE** (photo régénérable — pas de chiffre figé dans le MD).
- Pour aller plus loin (liens transverses).

L'`index.md` est donc la vue « module entier » ; les pages de brique sont les vues « concept ».

## 8ter. Granularité — page dédiée OU section du parent ?

Avant de créer un fichier, décider du **niveau** de la chose à documenter.

**Page dédiée** si ≥ 2 critères :

- Concept **public nommé** qu'un dev cherche seul (idempotence, session, firewall, router).
- **Matière propre** : config Zod et/ou entité et/ou normes et/ou sécurité → ≥ 3 sections §8bis remplies.
- **Contrat à plusieurs implémentations** (session stores, idempotency stores, authenticators) → le
  _contrat_ porte la page.
- **Surfacée indépendamment dans Studio** (écran/onglet propre).

**Section du parent** (ou simple TSDoc → `symbols.json`, pas de prose) si :

- Détail d'implémentation / helper qui n'a de sens que dans son parent (`computeFingerprint`, `colKit`,
  tri topologique `serviceOrder`).
- Un dev ne le chercherait jamais isolément ; il ne remplirait pas plus d'1–2 sections.
- C'est de la **signature** → ça vit dans le graphe généré, jamais recopié à la main.

**Cas multi-module** (contrat au core/owner, implémentations dans les adapters) : **UNE** page canonique
dans le module _propriétaire_ + un **tableau comparatif** des backends ; chaque adapter a une _section_
pour ses spécificités (entité, quirks driver), **liée, jamais dupliquée** (règle anti-triple-vérité, cf
F4). Ex. appliqués : idempotence/session = pages ; leurs stores memory/redis/drizzle/mongoose = sections

- tableau (pas 4 pages) ; entité renvoyée à la doc de l'adapter.

## 8quater. Passe de COMPLÉTUDE (anti-régression — obligatoire avant livraison)

Cause d'un défaut réel : réécrire une page en visant l'AJOUT demandé et laisser filer une dimension
déjà couverte (ex. firewall — authentification approfondie, autorisation/voters/scopes perdue). Deux
gardes, à passer avant toute livraison :

1. **Toutes les dimensions du sujet** : énumérer ce qu'un dev attend sur CE sujet et vérifier que
   chacune est traitée. Pour la sécurité d'accès : authentification (qui) **ET** autorisation (droits :
   rôles, scopes, voters). Pour une brique persistante : contrat **ET** entité **ET** dialectes. Une
   moitié approfondie ne rachète pas l'autre absente.
2. **Jamais perdre l'existant** : si une version antérieure (ou une page voisine) couvrait un point, la
   réécriture ne doit pas le supprimer — on l'intègre, on ne le troque pas contre le nouvel ajout.

## 8sexies. EXEMPLES D'USAGE — le « Démarrage rapide » est un LIVRABLE, pas une option

> Constat 2026-07-19 (retour user) : 22 pages, **15 blocs TypeScript en tout, 4 « Démarrage
> rapide »**. La doc DÉCRIVAIT le framework sans MONTRER comment s'en servir — inutilisable pour un
> dev pressé, et pour le devkit (une IA apprend par recettes exécutables, pas par prose).

1. **Toute page de brique** (pas les hubs ni les pages purement conceptuelles) porte une section
   **« Démarrage rapide »** : l'exemple **minimal COMPLET** vu depuis une app générée par
   `nodefony create app` — imports réels, la config `nodefony.config.ts`/`use()` si la brique se
   configure, le controller/service qui l'utilise, et **ce qu'on observe** (réponse curl, log, écran
   Studio). Le lecteur copie-colle et ça marche.
2. **Chaque capacité majeure** de la brique (les lignes de son tableau API / ses cas d'usage §8bis)
   = **un extrait d'usage** (fragment toléré), pas seulement de la prose.
3. **Compilabilité VÉRIFIÉE** : les blocs ```ts de la section « Démarrage rapide » doivent être
   **autonomes** et passer `code-check.mjs` (extraction → `tsc --noEmit` contre les paquets réels du
   repo). Ailleurs dans la page, les fragments sont tolérés (pas de gate).
4. **Point de vue = CONSOMMATEUR du framework** (l'app générée), jamais l'interne du repo
   self-hosted : `import { … } from "nodefony"` / `"@nodefony/http"`, pas de chemins relatifs internes.

## 8quinquies. Definition of Done — BARRIÈRE MÉCANIQUE (`doc-lint`)

> Cause racine d'un défaut réel (2026-07-18) : une page a été déclarée « déjà au niveau, 0 réécriture »
> sur la seule vérification des ancres — **sans** contrôler la présence de l'inventaire des tests
> (§8-tests). Vérifier les ancres ≠ page complète. Une conviction n'est pas une preuve.

**Règle** : une page n'est JAMAIS marquée ✅ tant que `node doc-lint.mjs <page.md>` n'est pas vert.
C'est un **gate bloquant**, pas un conseil. Interdiction d'écrire « vérifiée / déjà au niveau / 0
réécriture » sur la base de la mémoire ou d'une lecture d'ancres : la seule preuve d'achèvement est le
linter au vert **plus** l'aperçu HTML qui montre la carte de tests.

Le linter (`tmp/doc-corpus/_tools/doc-lint.mjs`) échoue si, pour une page :

- frontmatter incomplet (`title/topic/audience/updated/source/status`) ;
- une section obligatoire manque : Lexique, Qu'est-ce/Vision, **Pièges**, Pour aller plus loin ;
- pas d'intro en blockquote ;
- **pas de section « Tests »** ET pas de `coverage/tests.<topic>.json` (le défaut historique) — sauf
  opt-out explicite `tests: none` dûment justifié (page purement conceptuelle) ;
- moins de 3 ancres `fichier:ligne` (doc probablement superficielle) ;
- du HTML brut (le portail Studio n'a pas `rehype-raw`).

**Workflow par page (ordre imposé)** : lire le code → rédiger (intro §8 + analyse §8bis + complétude
§8quater) → compter les tests sur la machine (`grep -cE "^\s*(it|test)\(" …`) → écrire
`coverage/tests.<topic>.json` (+ `coverageModule/coverageFiles` si couverture dispo) → générer l'aperçu
(`build-preview.mjs`) → **`doc-lint.mjs` au vert** → livrer + committer. Passer le linter sur TOUT le
corpus après un lot (`node doc-lint.mjs tmp/corpus/*.md`) pour attraper les régressions.

## 9. Squelette de page module (maximum — adapter selon §8bis)

```markdown
---
<frontmatter §2>
---

# <Module/Brique> — <rôle en une ligne>

> Pitch en une phrase (résumé RAG).

## Schéma général <!-- Mermaid : vue d'ensemble -->

## Lexique <!-- table sigle → développé + 1 ligne, TOUS les acronymes de la page -->

## Qu'est-ce que c'est ? <!-- concept concret ; sécurité → faille bloquée + pourquoi -->

## La vision Nodefony <!-- comment Nodefony le fait, ancré au code -->

## Démarrage rapide (exemple minimal qui compile)

## Architecture interne (Mermaid + parcours d'une opération)

## Configuration (table dérivée du schéma Zod : option · type · défaut · effet · mutable à chaud)

## Entité(s) de persistance — SI la brique persiste : table des colonnes + **types par dialecte**

## + § « Dialectes / bases pris en charge » (compter les backends : redis, SQL pg/mysql/sqlite, mongo… ; dire ce qui N'EST PAS supporté)

## API publique (usage réel ; renvoi symbols.json pour les signatures)

## Extension (brancher son backend/adapter/authenticator)

## Normes appliquées (RFC/W3C/OWASP + comment le code s'y conforme)

## Sécurité · ## Performance & mémoire (chiffrée par les tests)

## Observabilité — Studio : LIER les pages Studio qui surfacent la brique (Playground, ERD, écran admin, API `/nodefony/<module>/api/*`)

## Pièges (symptôme → cause → correction)

## Tests — INVENTAIRE des types présents/absents + suites + coverage.

## Recenser explicitement, pour la brique : unitaires · intégration · **E2E** (`*.e2e.test.ts`, base

## réelle) · **charge/mémoire** (`tests/load/**`, `memory.test.ts`) · **bancs de contrat**

## (`tests/support/*Contract.ts` = invariants tenus par TOUS les backends) · **tests d'attaque**

## (`*.attack.test.ts`). Dire ce qui MANQUE (ex. « pas de test de charge dédié »).

## Lier les **skills** de test pertinents : `nodefony-load-test` (charge/dimensionnement),

## `nodefony-check-memory-health` (mémoire), `nodefony-security-review` (sécurité).

## Coverage : commande `npm run coverage` (vitest json-summary). ⚠️ JAMAIS de % figé dans le MD (il

## rot) → le chiffre vit dans le rapport vitest / la carte de l'aperçu (frontmatter `coverageModule`/`coverageFiles`).

## Outils (compagnon HTML si pertinent)

## Pour aller plus loin (liens internes)
```
