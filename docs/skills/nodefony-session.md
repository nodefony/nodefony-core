---
title: "nodefony-session — fiche de skill"
navTitle: nodefony-session
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-24
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-session/SKILL.md"
---

# `nodefony-session`

> Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear — avec l'avancement RÉEL lu sur le jalon et les tickets GitHub, pas sur un document écrit à la main —, préparer le contexte d'un module, clôturer avec retex, fermeture des tickets soldés et mémoire de reprise.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-session**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Cycle de session |
| Corps | 206 lignes |
| Coût d'activation | ~3 165 tokens (le corps est chargé à l'invocation) |
| Description | 624 / 1024 caractères |
| Déclencheurs | 10 |
| Ressources `references/` | 3 page(s) |
| Scripts | 11 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear — avec l'avancement RÉEL lu sur le jalon et les tickets GitHub, pas sur un document écrit à la main —, préparer le contexte d'un module, clôturer avec retex, fermeture des tickets soldés et mémoire de reprise. RESUME et START sont dans le corps ; END et CONSOLIDATE dans `references/`.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **redis**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`inspect`](nodefony-inspect.md) · [`ticket`](nodefony-ticket.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`reprends` · `on en était où` · `dernière session` · `où en est la publication` · `quels tickets restent` · `prépare le contexte` · `session sur <module>` · `fin de session` · `retex` · `consolide les retex`

## Ce que contient le corps

- Routage du mode
- 1. Un appel, puis une lecture
- 2. Restituer (≤ 30 lignes)
- Usage
- 1. Résolution dynamique du chemin (PAS de table hardcodée — elle se périme)
- 2. Mode global (sans argument)
- 3. Mode module — doc IA (parallèle)
- 4. Mode module — contexte git (NOUVEAU)
- 5. Mode module — fraîcheur du dist
- 6. Mode module — symboles exportés (`.ai/symbols.json`, O(1))
- 7. Sortie finale (récap synthétique, ≤ 40 lignes)
- Anti-patterns START
- Liens

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/consolidate-toolkit.md` | Boîte à outils CONSOLIDATE — minage du transcript | 153 |
| `references/mode-consolidate.md` | MODE CONSOLIDATE — plan d'amélioration IA + maintenance du SAS | 135 |
| `references/mode-end.md` | MODE END — clôture de session (RETEX) | 139 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/board-next.mjs` | Le choix du PROCHAIN ticket — la règle, isolée pour être éprouvable sans réseau. | — | — |
| `scripts/board-next.test.mjs` | Le décor est celui du 2026-09-08, à l'identique — c'est lui qui a produit le | — | — |
| `scripts/board-snapshot.mjs` | Instantané du pilotage — projette les tickets GitHub DANS le dépôt. | `--check` `--force` `--readme` `--issue` `--dry-run` | `PROJECT_NUMBER` `PROJECT_OWNER` `QUERY` `REPO_NAME` `REPO_OWNER` |
| `scripts/board-snapshot.test.mjs` | Éprouve le maillon où une donnée du tableau de bord peut disparaître SANS | — | — |
| `scripts/lessons-carriers.mjs` | Qui PORTE chaque leçon durable — le chaînon manquant du cycle des retex. | `--dead` `--inert` `--recos` `--strict` `--write` | — |
| `scripts/retex-seuil.mjs` | Les thèmes de `RETEX.md` qui ont atteint le seuil de graduation. | `--all` | `SAS` `SEUIL` |
| `scripts/session-cost.mjs` | Agrège la consommation réelle de tous les transcripts Claude Code du projet. | — | — |
| `scripts/session-end.mjs` | session-end.mjs — la clôture de session en deux passes, mécanique d'un côté, | `--since` `--no-publish` | `MEM` `PUBLISH` |
| `scripts/session-lib.mjs` | Règles PURES de la reprise et de la clôture de session — sans réseau, sans | `--format` `--json` `--since` | — |
| `scripts/session-lib.test.mjs` | Règles pures de la reprise et de la clôture — chaque cas porte le défaut | `--since` | — |
| `scripts/session-resume.mjs` | session-resume.mjs — la reprise de session en UN appel, sortie bornée (~30 l). | `--offline` | — |

**Invocation telle que documentée dans chaque script :**

```bash
npm run board:snapshot
npm run session:end                 # préparation
npm run session:resume
```

**Toutes les variables lues par ce skill** : `MEM` · `PROJECT_NUMBER` · `PROJECT_OWNER` · `PUBLISH` · `QUERY` · `REPO_NAME` · `REPO_OWNER` · `SAS` · `SEUIL`

### Détail des scripts auto-documentés

#### `scripts/board-snapshot.mjs`

Produit : .ai/board.json (machine) + .ai/BOARD.md (lisible) — jamais édités à la main

```bash
npm run board:snapshot
node .claude/skills/nodefony-session/scripts/board-snapshot.mjs
node .claude/skills/nodefony-session/scripts/board-snapshot.mjs --check
npm run board:readme   (= --readme)
npm run board:issue    (= --issue)
```

| Option | Rôle |
| --- | --- |
| `--check` | ne rien écrire ; sortie 1 si l'empreinte a dérivé, 2 si GitHub est muet |
| `--force` | passer outre la garde de plausibilité |
| `--readme` | republie la zone générée du README du PROJET GitHub |
| `--issue` | republie l'issue-tableau publique (label `tableau-de-bord`) |
| `--dry-run` | montre ce qui partirait, sans rien écrire |

#### `scripts/session-end.mjs`

Produit : ≤ 25 lignes en préparation ; la liste des manques en `--verify`

```bash
npm run session:end                 # préparation
npm run session:end -- --verify     # gate de clôture (code 1 si incomplet)
```

| Option | Rôle |
| --- | --- |
| `--since` | <rév>   début de la session (défaut : date du dernier `_state`) |
| `--no-publish` | ne republie pas le README ni l'issue du tableau de bord |

#### `scripts/session-resume.mjs`

Produit : ~30 lignes ; code 0 toujours — c'est un état des lieux, pas un gate

```bash
npm run session:resume
```

| Option | Rôle |
| --- | --- |
| `--offline` | ne joint pas GitHub (empreinte du dernier END, datée) |

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| en-tête analysable par un vrai parseur YAML | ℹ️ normatif | ✅ |  | spec § frontmatter : « YAML frontmatter » — un en-tête que YAML refuse n'est pas rendu par GitHub, alors que le parseur de l'agent, tolérant, l'accepte sans un mot |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 624 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 206 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-session/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
