---
title: "nodefony-identifiers — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-05
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-identifiers/SKILL.md"
---

# `nodefony-identifiers`

> Les identifiants du code Nodefony, de bout en bout : le gate de langue qui dit LESQUELS sont français (dictionnaire, banc anti-faux-positif, exceptions déclarées), puis le renommage en masse par le LanguageService TypeScript — jamais par regex — avec la preuve qu'aucun symbole n'a dérivé ni aucune chaîne affichée bougé.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-identifiers**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Autres |
| Corps | 204 lignes |
| Coût d'activation | ~3 987 tokens (le corps est chargé à l'invocation) |
| Description | 965 / 1024 caractères |
| Déclencheurs | 9 |
| Ressources `references/` | 0 page(s) |
| Scripts | 7 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Les identifiants du code Nodefony, de bout en bout : le gate de langue qui dit LESQUELS sont français (dictionnaire, banc anti-faux-positif, exceptions déclarées), puis le renommage en masse par le LanguageService TypeScript — jamais par regex — avec la preuve qu'aucun symbole n'a dérivé ni aucune chaîne affichée bougé. Porte ce qu'un typecheck vert ne dit PAS : un membre privé rendu public, un raccourci d'objet relié à la mauvaise déclaration, un alias qui annule la rupture, les consommateurs qu'aucun tsconfig ne voit. À charger AVANT de lancer le gate ou d'écrire un plan : les outils rendent un compte rassurant sans le protocole.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **redis**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`framework-dev`](nodefony-framework-dev.md) · [`inspect`](nodefony-inspect.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`renommer un symbole partout` · `renommer en masse` · `écrire le code en anglais` · `des identifiants sont en français` · `ce nom de variable est en français` · `quels identifiants restent à traduire` · `ce renommage a-t-il tout attrapé ?` · `prouver qu'un renommage est complet` · `un membre privé est devenu public`

## Ce que contient le corps

- 1. Quand m'utiliser — et quand passer la main
- 2. Constater — le gate de langue
- 3. Renommer — la recette, dans cet ordre
- 4. Écrire le plan — cinq règles, toutes payées
- 5. Ce que le typecheck NE protège PAS — huit trous, tous rencontrés
- 6. Le contrôle de dérive — son modèle, et ses trois bords
- 7. Pièges vécus
- 8. Gate — comment on prouve
- 9. Les scripts de ce skill

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/bench-identifier-language.mjs` | Banc — éprouve le gate de langue sur du corpus RÉEL, pas sur des cas choisis. | `--help` `--json` `--limit` `--sample` | `HELP` |
| `scripts/check-identifier-language.mjs` | Gate — les IDENTIFIANTS du code de production s'écrivent en anglais. | `--depth` `--exceptions` `--help` `--json` | `HELP` `IDENT` `MODIFIERS` |
| `scripts/check-identifier-language.test.mjs` | Suite du gate de langue des identifiants — écrite pour le faire ÉCHOUER, | — | — |
| `scripts/check-literals-unchanged.mjs` | Vérifie qu'un renommage n'a touché AUCUNE chaîne de caractères. | `--base` `--except` `--name-only` | — |
| `scripts/check-rename-drift.mjs` | Confronte un renommage à son plan — la seule preuve qu'aucun symbole n'a | `--base` `--fix` `--plan` | — |
| `scripts/rename-identifiers.mjs` | Renomme des identifiants par le LanguageService TypeScript — jamais par regex. | `--dry` `--plan` `--project` | — |
| `scripts/rename-identifiers.test.mjs` | Auto-contrôle de `rename-identifiers.mjs`. | `--plan` `--project` `--test` | — |

**Invocation telle que documentée dans chaque script :**

```bash
node scripts/bench-identifier-language.mjs
node scripts/check-identifier-language.mjs [chemins…]
Usage : node .claude/skills/nodefony-identifiers/scripts/check-literals-unchanged.mjs [--base HEAD]
node .claude/skills/nodefony-identifiers/scripts/check-rename-drift.mjs --plan tmp/plan.json [--base HEAD]
node .claude/skills/nodefony-identifiers/scripts/rename-identifiers.mjs --project src/nodefony/tsconfig.json \
```

**Toutes les variables lues par ce skill** : `HELP` · `IDENT` · `MODIFIERS`

### Détail des scripts auto-documentés

#### `scripts/bench-identifier-language.mjs`

Produit : taux de faux positifs par paquet, sensibilité, échantillon terrain ;

```bash
node scripts/bench-identifier-language.mjs
node scripts/bench-identifier-language.mjs --limit 4000 --json
```

#### `scripts/check-identifier-language.mjs`

Produit : `fichier:ligne  identifiant  ← mot(s) français  → suggestion` ;

```bash
node scripts/check-identifier-language.mjs [chemins…]
node scripts/check-identifier-language.mjs --json
node scripts/check-identifier-language.mjs --exceptions mes-exceptions.json
```

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 965 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 204 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-identifiers/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
