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
  Il décide AUSSI de la publication sur le site public (cf `publish` ci-dessous).
- La date lue est **`updated`** — **jamais `last-updated`** (sinon date non affichée, fallback git).
- `section` frontmatter est parsé mais **non utilisé** pour le regroupement : les sections de l'index
  sont bâties depuis le **dossier parent** du fichier (`docScanner.ts` `group`).

### 🌍 `publish` — cette page part-elle sur le SITE PUBLIC ?

Le site publié (`scripts/build-docs-site.mjs` → GitHub Pages) ne rend pas tout le corpus : un dépôt
ouvert contient des pages qui n'ont aucun lecteur au-dehors. Le tri se fait à trois niveaux, du plus
général au plus précis — **et le dernier gagne toujours** :

1. **le DOSSIER** — `docs/architecture`, `docs/guides`, `docs/tutoriels` et tous les
   `<module>/docs/` sont publics. Le journal de sessions, les archives, les décisions
   d'architecture, l'outillage d'agent, le plan de version et le tableau de bord de migration ne le
   sont pas. Une page NEUVE dans un dossier public est publiée d'office : la liste ne se périme pas ;
2. **le STATUT** — seuls `stable` et `accepted` sont publiables. `draft`, `vision`, `superseded`,
   `experimental`, `deprecated` restent dedans : un texte de travail ENGAGE dès qu'il est en ligne,
   et un lecteur ne distingue pas un brouillon d'une promesse. Une page **sans** `status` reste
   publiée — retirer un guide utile pour un frontmatter incomplet serait une punition, pas une
   règle — mais elle est signalée au rendu ;
3. **la PAGE elle-même**, par cette clé :

   ```yaml
   publish: false # retire du site une page qui y serait allée
   publish: true # publie une page que son dossier ou son statut excluait
   ```

Le générateur AFFICHE ce qu'il écarte et pourquoi, page par page — publier à l'aveugle est le seul
vrai risque de cet outil. Vérifier avant de pousser :

```bash
node scripts/build-docs-site.mjs --out tmp/site --mount /docs   # la liste des écartés, par motif
node scripts/build-docs-site.mjs --out tmp/apercu --only <chemin/page.md>   # une seule page
```

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
# publish: false        # (optionnel) retire cette page du site public
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
   - Au **rendu** (le générateur du site, et MarkdownDoc Studio à terme) : une ancre `fichier.ts:NNN` est
     affichée en **référence discrète** (petite, atténuée, type note de bas de page) — le MD reste
     la source vérifiable, le lecteur voit un texte propre.
4. **Le code doit être VISUEL** : coloration syntaxique obligatoire au rendu ; un bloc = une idée ;
   commentaires courts qui disent le POURQUOI ; jamais un bloc > ~25 lignes sans être découpé.
5. **Mots-clés en gras** pour le balayage (le lecteur scanne en F) ; sous-titres significatifs qui
   répondent à une question, pas des titres décoratifs.
6. **Catalogue de briques = CARDS** (série homogène : authenticators, stores, drivers…) —
   convention 100 % Markdown : chaque brique s'écrit ``### `nom` — titre`` (le nom en code
   inline) ; le rendu (le générateur du site, MarkdownDoc Studio à terme) en fait une **card** (bordure
   accent, nom en pill, corps encadré). Toujours précéder le catalogue d'un **tableau de synthèse**
   (choisir en 5 s) — les cards donnent le détail.
7. **Rythmer avec les admonitions** (`> [!TIP]` · `> [!WARNING]` · `> [!IMPORTANT]`) : un piège
   énoncé en « Piège : … » dans un paragraphe se noie ; en `[!WARNING]` il saute aux yeux.
   1-3 par page, aux endroits où se tromper coûte cher — pas une par paragraphe.
8. **ICÔNES DE SECTION — le lecteur se prépare** (signalisation : le pictogramme annonce le
   registre AVANT la lecture ; même icône = même type de contenu sur TOUTES les pages).
   Vocabulaire CANONIQUE (emoji en tête du titre `##`, dans le Markdown — porté partout :
   Studio, GitHub, RAG) :

   | Section                | Icône | Section                   | Icône |
   | ---------------------- | ----- | ------------------------- | ----- |
   | Démarrage rapide       | 🚀    | Pièges                    | ⚠️    |
   | Lexique                | 📖    | Tests & couverture        | 🧪    |
   | Modèle mental / Schéma | 🧠    | Observabilité Studio      | 📡    |
   | Configuration / modes  | ⚙️    | Normes appliquées         | 📜    |
   | Architecture interne   | 🏗️    | Pour aller plus loin      | 🔗    |
   | API publique           | 🧰    | Sécurité / authentifiants | 🔐    |
   | Performance & mémoire  | ⚡    | Extension                 | 🧩    |
   | Autorisation (jury)    | 🧑‍⚖️    | Transport HTTP/WS         | 🔌    |
   | Défenses (en-têtes…)   | 🛡️    |                           |       |

   Une section hors vocabulaire → pas d'icône (mieux : aucune) plutôt qu'une icône inventée —
   la cohérence EST le signal. Jamais d'icône dans les `###` (réservé aux `##`).

9. **METTRE EN SITUATION — tout concept à CHOIX se raconte en scénarios** (retour user : « il
   faut mettre le développeur en situation et le guider »). Un mode, une option, une stratégie ne
   s'expliquent JAMAIS par la seule définition des variantes. Format imposé, dans cet ordre :
   **le besoin vécu** (« Ton back-office est appelé par le navigateur ET par un script CI ») →
   **la config qui y répond** (bloc court) → **le comportement observable** (table « le client
   envoie… → résultat », ou curl). Inclure le **contre-exemple piégeux** quand il existe
   (`["anonymous", "session"]` : ✅/❌ côte à côte). Modèle : section « Ordre et modes » de
   `firewall.md`.

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
   portail. L'aperçu HTML autonome (`build-docs-site.mjs --only`) ne sert qu'à une revue HORS Studio.
6. Commit `docs(<module>): <brique> — <ce qui a changé>`.

**Détecter la dérive** : date git de la page < date git du code du module (Studio affiche déjà la
fraîcheur). Toute contradiction code↔doc trouvée en chemin va dans le **kit de chantier**
(mémoire IA `project_doc_corpus_chantier_kit`, § « Trouvailles code↔doc ») — **jamais dans `tmp/`,
qui est jetable. Le code gagne** : la page documente le réel, le défaut du code part en correctif séparé.

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

## 8bis-nav. NAVIGATION — on ne se perd jamais (fil d'Ariane obligatoire)

> Raison : dans Studio, l'arbre de navigation devient **touffu** dès qu'un module a 8 pages. Un menu
> plat de 40 entrées n'enseigne rien et décourage. La navigation doit être portée par des **hubs
> propres** — le menu latéral n'est qu'un raccourci pour qui sait déjà où il va.

**Toute page** (brique comme hub) porte **deux** points de remontée, en Markdown pur :

1. **Fil d'Ariane**, sur la ligne qui suit immédiatement le blockquote d'intro :

   ```markdown
   📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **CORS**
   ```

   - Le dernier maillon = la page courante, **en gras, jamais un lien**.
   - Les liens sont **relatifs au fichier** (le portail résout aussi `xxx.md` par slug via
     `onInternalLink`) — vérifier le chemin depuis l'emplacement réel de la page.
   - Un hub de module n'a que deux maillons (`Documentation › **Sécurité**`).

2. **Retour au hub en PIED**, première ligne de « 🔗 Pour aller plus loin » — sur une page de 500
   lignes, le lecteur arrivé en bas est loin de l'Ariane :

   ```markdown
   - ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
   ```

Les liens **latéraux** (pages sœurs) restent dans « Pour aller plus loin », après le retour au hub.
Une page ne se lit jamais en cul-de-sac : elle dit toujours d'où elle vient et où aller ensuite.

## 8bis-index. Point d'entrée du module — `index.md`, le HUB « bureau de travail »

Chaque module a un **`index.md`** (ADR-0001 : `<module>/docs/index.md`) — le **hub** affiché en
premier dans l'onglet Docs de Studio. Il **récapitule tout le module** et pointe vers les pages de
brique (il ne les duplique jamais).

**Un hub n'est pas un sommaire, c'est un bureau de travail** : il doit ENSEIGNER l'organisation du
module et permettre de choisir sa page en quelques secondes, sans lire l'arbre de navigation.

Contenu, dans cet ordre :

1. **Titre + pitch + fil d'Ariane** (§8bis-nav) + statut/version.
2. **🧭 Par où commencer — parcours guidés** (c'est ce qui rend le hub _formateur_). 2 à 4 parcours
   nommés par PROFIL et par BESOIN, chacun = une suite ordonnée de 3-5 liens :
   « **Je découvre la sécurité Nodefony** » → firewall › authenticators › autorisation ;
   « **Je protège une API machine** » → tokens › api-keys › autorisation ;
   « **J'audite avant mise en production** » → en-têtes › csrf › cors › audit.
   Un parcours dit **pourquoi cet ordre**, pas seulement quoi lire.
3. **🗂️ Le catalogue en CARDS** — la pièce maîtresse. D'abord un **tableau de synthèse**
   (page · à quoi ça sert · quand tu en as besoin) pour choisir en 5 s ; puis **une card par page**,
   convention Markdown du §6-ergo n°6 : ``### [`cors`](cors.md) — partage de ressources entre origines``
   suivi de 2-4 lignes : le **problème** que la page résout, **quand** on la lit, et l'entrée
   concrète (« démarre par sa section Démarrage rapide »). Une card explicite vaut dix lignes d'arbre.
4. **Place dans le graphe de dépendances** (Mermaid) + ce que le module apporte.
5. **Surface publique** (exports clés) → renvoi `symbols.json` (jamais recopier les signatures).
6. **Configuration** principale → renvoi au bloc/section config.
7. **Observabilité Studio** du module (écrans, ERD, API `/nodefony/<module>/api/*`).
8. **Compteur tests + couverture du MODULE** (photo régénérable — jamais de chiffre figé dans le MD).
9. **🔗 Pour aller plus loin** — remontée vers l'index général + hubs des modules voisins.

L'`index.md` est la vue « module entier » ; les pages de brique sont les vues « concept ». Le même
gabarit vaut pour l'**index général** (`docs/index.md`), dont les cards pointent vers les hubs de
module au lieu des pages.

> [!TIP]
> Test du hub réussi : un dev qui ne connaît pas le module trouve SA page en moins de 30 secondes,
> sans ouvrir le menu latéral, et comprend au passage comment le module est organisé.

## 8bis-lexique. Régime GLOSSAIRE — `lexique.md`, la page qui DÉFINIT le vocabulaire

Une page de brique **explique un concept** ; un hub **oriente**. Un **glossaire** fait une troisième
chose : il **définit du vocabulaire** (tables `sigle → développé → en clair`). Lui réclamer une section
« Qu'est-ce/Vision », des « Pièges », des ancres `fichier:ligne` et un inventaire de tests fabriquerait
du remplissage — la même raison qui dispense déjà un hub. C'est donc un **3ᵉ régime** du `doc-lint`,
reconnu au **nom canonique** `lexique.md` (ou `glossaire.md`), à deux niveaux :

- **`docs/lexique.md` = le GLOBAL** : les termes transverses employés partout (opt-in, lazy, hot path,
  gate, ESM, DI…) + l'index des lexiques par module.
- **`<module>/docs/lexique.md` = par MODULE** : les termes PROPRES au module, surfacés dans sa carte
  Studio (ADR-0001). Modèle de référence : `@nodefony/security` (BFF, JWT, voters, OAuth…).

Règle de répartition : terme employé dans ≥2 modules → global ; spécifique à un module → son lexique.
On NE crée PAS les lexiques-module vides d'avance : chacun naît quand on travaille le module.

**Ce que le régime exige** (le reste est du remplissage, donc interdit) :

1. **Frontmatter** convention A (§2) : `title/topic/audience/updated/source/status`.
2. **Intro en blockquote** : à quoi sert ce lexique + le renvoi vers l'autre niveau.
3. **Navigation** (§8bis-nav) : fil d'Ariane en tête, retour au hub en pied.
4. **Une section `## Lexique`** (icône tolérée : `## 📖 Lexique`) chapeautant les tables, groupées par
   thème en `###`.
5. **`## Pour aller plus loin`** : l'autre niveau de lexique + les pages qui emploient ces termes.

**Pas** de section Tests ni d'ancres code : un glossaire ne teste ni ne cite de lignes (opt-out
automatique). Une section **`## Pièges`** reste **optionnelle** et recommandée dès que le vocabulaire
prête à confusion (les **faux-amis** : `authn` ≠ `authz`, `scope` OAuth vs `scope` DI, `Attribute` du
vote vs attribut ABAC) — utile, jamais imposée.

## 8bis-readme. Régime INDEX DE DOSSIER — `README.md`, la pancarte du répertoire

Un `README.md` de dossier n'est **pas une page du portail** : le portail publie `index.md`. On ne
l'atteint par aucun parcours de lecture — on tombe dessus en ouvrant le répertoire (dépôt, forge,
session IA). Son travail tient en une phrase : **dire ce que contient ce dossier, et pointer juste**.

Lui réclamer le gabarit d'une page de brique (Lexique, Qu'est-ce/Vision, Pièges, ancres
`fichier:ligne`, carte de tests, fil d'Ariane, retour au hub) fabriquerait une demi-page de
remplissage autour de quatre lignes de sommaire. C'est le **4ᵉ régime** du `doc-lint`, reconnu au
**basename `README.md`**.

**Ce que le régime exige** — et rien d'autre :

1. **Frontmatter allégé** : `module`, `topic`, `audience`, `status`. Pas `title`/`updated`/`source` :
   ces champs servent à publier et à dater une page, or un index n'est ni rendu ni versionné comme telle.
2. **Intro en blockquote** : à quoi sert le dossier, et ce qui n'y va PAS.
3. **Liens internes vivants** — le seul contrôle qui compte vraiment ici. Un index dont un lien est
   mort a échoué à sa fonction unique ; c'est ce que le gate doit mordre.

> **Corollaire** : une page de CONTENU nommée `README.md` sera jugée sur ce régime et signalée
> (frontmatter incomplet). Ce n'est pas un faux positif — c'est un défaut de nommage. Une page qui
> explique quelque chose porte un nom qui dit quoi ; `README.md` est réservé à la pancarte.

**Ce que le gate ne compte plus pour un lien** (tous régimes) : un lien **cité en exemple**, dans une
fence de code ou entre backticks. Une page qui enseigne la syntaxe des liens était punie pour ses
propres illustrations — un gate qui crie sur l'énoncé d'une règle apprend à être ignoré, y compris le
jour où il a raison. Un exemple n'est ni cliquable ni promis au lecteur. Restent contrôlées : la prose
**et** les fences déclaratives `nodefony-cards`, qui sont, elles, de la vraie navigation.

## 8bis-adr. Régime ADR — `docs/adr/NNNN-titre.md`, la décision datée et IMMUABLE

Un ADR n'explique pas un concept : il **trace une décision**, à une date, avec ce qu'on savait
alors. Il est **immuable** (`docs/adr/README.md`) — remis en cause, on en écrit un nouveau qui le
_supersede_. Lui appliquer le gabarit d'une page de brique serait contradictoire dans les termes :
cela reviendrait à demander de **rouvrir un texte qu'on s'interdit de modifier** pour y coudre un
Lexique, des Pièges, des ancres et une carte de tests. **5ᵉ régime**, reconnu au nom numéroté
`NNNN-` ou au champ `adr:`.

**Ce que le régime exige** :

1. **Frontmatter ADR** : `adr`, `title`, `date`, `status`, `deciders`. Pas `updated` — un ADR est
   daté une fois ; « mis à jour » n'a pas de sens pour lui. Il engage quelqu'un, d'où `deciders`.
2. **Statut dans le cycle de vie fermé** : `proposed` · `accepted` · `rejected` · `deprecated` ·
   `superseded`. Un statut inventé décrit une décision dont on ne sait pas si elle s'applique.
3. **Les 4 sections canoniques** (format Nygard) : `Statut`, `Contexte`, `Décision`, `Conséquences`.
   `Alternatives écartées` et `Liens`/`Références` sont recommandées, jamais imposées.
4. **Liens internes vivants**.

**Pas** d'intro en blockquote, de fil d'Ariane, de retour au hub, d'ancres ni de carte de tests :
la mise en contexte d'un ADR **est** sa section `Contexte`, et on l'atteint par son numéro depuis le
registre, pas par un parcours de lecture.

> **Un ADR ne s'archive pas et ne se supprime pas.** C'est le point du format : il garde sa valeur
> même quand sa décision tombe — il dit **pourquoi** on avait tranché ainsi, ce qu'aucun autre
> document ne conserve. Ce qui bouge est son **statut** (`deprecated`, ou `superseded` avec le
> pointeur vers le nouveau), jamais son existence. Supprimer un ADR périmé, c'est effacer la seule
> trace du raisonnement au moment précis où quelqu'un pourrait vouloir le refaire.

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

- frontmatter incomplet (`title/topic/audience/updated/source/status` — allégé en
  `module/topic/audience/status` pour un index de dossier, §8bis-readme) ;
- une section obligatoire manque — **selon le régime de la page** : brique = Lexique + Qu'est-ce/Vision
  - **Pièges** + Pour aller plus loin ; hub (`index.md`, §8bis-index) = point de départ + catalogue +
    Pour aller plus loin ; **glossaire** (`lexique.md`, §8bis-lexique) = Lexique + Pour aller plus loin ;
    **index de dossier** (`README.md`, §8bis-readme) = aucune (intro + liens vivants suffisent) ;
    **ADR** (`NNNN-titre.md`, §8bis-adr) = Statut + Contexte + Décision + Conséquences, et un
    `status` du cycle de vie fermé ;
- pas d'intro en blockquote ;
- **pas de section « Tests »** ET pas de `coverage/tests.<topic>.json` (le défaut historique) — sauf
  opt-out explicite `tests: none` dûment justifié (page purement conceptuelle) ;
- moins de 3 ancres `fichier:ligne` (doc probablement superficielle) ;
- du HTML brut (le portail Studio n'a pas `rehype-raw`).

**Workflow par page (ordre imposé)** : lire le code → rédiger (intro §8 + analyse §8bis + complétude
§8quater) → compter les tests sur la machine (`grep -cE "^\s*(it|test)\(" …`) → écrire
`coverage/tests.<topic>.json` (+ `coverageModule/coverageFiles` si couverture dispo) → générer l'aperçu
(`build-docs-site.mjs --only`) → **`doc-lint.mjs` au vert** → livrer + committer. Passer le linter sur TOUT le
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
