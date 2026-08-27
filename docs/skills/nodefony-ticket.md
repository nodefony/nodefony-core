---
title: "nodefony-ticket — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-ticket/SKILL.md"
---

# `nodefony-ticket`

> Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de bord, et le moment où un ticket se fait dans la foulée plutôt que plus tard.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-ticket**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.2.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.2.0` |
| Famille | Autres |
| Corps | 248 lignes |
| Coût d'activation | ~4 611 tokens (le corps est chargé à l'invocation) |
| Description | 995 / 1024 caractères |
| Déclencheurs | 20 |
| Ressources `references/` | 3 page(s) |
| Scripts | 2 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de bord, et le moment où un ticket se fait dans la foulée plutôt que plus tard. À charger AVANT d'ouvrir une issue ou d'en reformuler un lot : un titre qui commence par un code interne se fait réécrire ensuite.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un ticket` · `ouvre une issue` · `fais-en des tickets` · `corrige les tickets` · `ce titre est incompréhensible` · `mets un lexique` · `écris-le en français` · `évite le jargon` · `renomme cette issue` · `ticket parent` · `découper cette issue` · `estimer un ticket` · `priorité d'un ticket` · `ajouter au board` · `jalon 10.0.0` · `on ne l'a pas déjà fait ?` · `ce ticket est-il encore vrai ?` · `ferme ce ticket` · `quel ticket prendre maintenant ?` · `est-ce le bon moment pour celui-là ?`

## Ce que contient le corps

- La règle qui gouverne tout
- ⚖️ La devise vaut ICI aussi — « la confiance n'exclut pas le contrôle »
- 1. Le titre — Conventional Commits, comme les commits du dépôt
- 2. Le corps — quatre blocs, toujours dans cet ordre
- 3. Parent et sous-tickets
- 4. Labels et champs du tableau de bord
- 5. Créer, ordonner, rattacher
- Pièges vécus
- Références (chargées à la demande)

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/conventional-commits.md` | Conventional Commits 1.0.0 — la spec, hors ligne | 53 |
| `references/github-issues.md` | Issues GitHub — sous-tickets, jalons, projets | 76 |
| `references/lexique.md` | Lexique des tickets — source unique | 124 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/francise.mjs` | Remplace, dans le corps des tickets ouverts, les anglicismes qui ont un équivalent français. | `--body-file` `--json` `--limit` `--state` `--write` | — |
| `scripts/pose-lexique.mjs` | Pose le bloc `Lexique` en tête du corps des tickets GitHub ouverts. | `--body-file` `--json` `--limit` `--state` `--write` | — |

**Invocation telle que documentée dans chaque script :**

```bash
node scripts/francise.mjs            # diff seul, n'écrit rien
node scripts/pose-lexique.mjs            # rapport seul, n'écrit rien
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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 995 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 248 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-ticket/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
