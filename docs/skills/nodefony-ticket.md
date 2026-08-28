---
title: "nodefony-ticket — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-28
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-ticket/SKILL.md"
---

# `nodefony-ticket`

> Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de bord, le moment où un ticket se fait dans la foulée, et ce qui fait qu'un ticket ACHÈTE du temps au lieu d'en coûter : chemins exacts, commandes prêtes, décor nommé, pièges connus, fausses pistes écartées.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-ticket**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **0/1** recommandé (SHOULD) · 🏷️ `v1.6.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.6.0` |
| Famille | Autres |
| Corps | 530 lignes |
| Coût d'activation | ~9 647 tokens (le corps est chargé à l'invocation) |
| Description | 1006 / 1024 caractères |
| Déclencheurs | 16 |
| Ressources `references/` | 4 page(s) |
| Scripts | 10 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de bord, le moment où un ticket se fait dans la foulée, et ce qui fait qu'un ticket ACHÈTE du temps au lieu d'en coûter : chemins exacts, commandes prêtes, décor nommé, pièges connus, fausses pistes écartées. À charger AVANT d'ouvrir une issue ou d'en reformuler un lot.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md) · [`session`](nodefony-session.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un ticket` · `ouvre une issue` · `fais-en des tickets` · `corrige les tickets` · `ce titre est incompréhensible` · `renomme cette issue` · `ticket parent` · `découper cette issue` · `estimer un ticket` · `priorité d'un ticket` · `ce ticket est-il encore vrai ?` · `ferme ce ticket` · `quel ticket prendre maintenant ?` · `quels tickets parlent de ce que j'ai changé ?` · `ce ticket est trop vague` · `il manque le contexte pour le prendre`

## Ce que contient le corps

- La règle qui gouverne tout
- ⚖️ La devise vaut ICI aussi — « la confiance n'exclut pas le contrôle »
- 1. Le titre — Conventional Commits, comme les commits du dépôt
- 2. Le corps — quatre blocs, toujours dans cet ordre
- 3. Le ticket est un instrument d'ÉCONOMIE — il achète du temps, ou il en coûte
- 4. Parent et sous-tickets
- 5. Labels et champs du tableau de bord
- 6. Créer, ordonner, rattacher
- 7. Fermer un ticket — le geste est TRIPLE
- Pièges vécus
- Les scripts de ce skill
- Références (chargées à la demande)

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/conventional-commits.md` | Conventional Commits 1.0.0 — la spec, hors ligne | 53 |
| `references/economie.md` | Le ticket comme instrument d'économie — le détail | 149 |
| `references/github-issues.md` | Issues GitHub — sous-tickets, jalons, projets | 76 |
| `references/lexique.md` | Lexique des tickets — source unique | 124 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/francise.mjs` | Remplace, dans le corps des tickets ouverts, les anglicismes qui ont un équivalent français. | `--body-file` `--json` `--limit` `--state` `--write` | — |
| `scripts/pose-lexique.mjs` | Pose le bloc `Lexique` en tête du corps des tickets GitHub ouverts. | `--body-file` `--json` `--limit` `--state` `--write` | — |
| `scripts/ticket-close.mjs` | Compose le COMPTE RENDU de fermeture d'un ticket — la moitié mécanique. | `--comment` `--format` `--grep` `--name-only` `--reverse` `--since` | — |
| `scripts/ticket-close.test.mjs` | Suite du compte rendu de fermeture. | `--format` `--grep` `--no-verify` `--reverse` | — |
| `scripts/ticket-effort.mjs` | ticket-effort.mjs — confronte l'estimation d'un ticket à ce que le travail a | `--format` `--grep` `--json` `--limit` `--since` `--state` | `OWNER` `REPO` |
| `scripts/ticket-open.mjs` | Ouvre un ticket ET l'inscrit au tableau de bord, d'un seul geste. | `--assignee` `--backlog` `--body-file` `--cl` `--field-id` `--format` `--id` `--jours` `--label` `--limit` `--milestone` `--number` `--ordre` `--owner` `--parent` `--priorite` `--project-id` `--repo` `--single-select-option-id` `--title` `--url` | `OWNER` `REPO` |
| `scripts/ticket-open.test.mjs` | Suite de la dérivation d'ordre d'un sous-ticket. | — | — |
| `scripts/ticket-progress.mjs` | Passe en « In Progress » les tickets qu'un commit vient de citer sans les fermer. | `--field-id` `--format` `--id` `--owner` `--project-id` `--single-select-option-id` | `OWNER` |
| `scripts/ticket-progress.test.mjs` | Suite du marquage automatique « In Progress ». | — | — |
| `scripts/ticket-verify.mjs` | ticket-verify.mjs — confronte les tickets OUVERTS au code réel, par deux voies. | `--json` `--limit` `--name-only` `--no-commit-id` `--show-toplevel` `--state` `--touched-by` | — |

**Invocation telle que documentée dans chaque script :**

```bash
node scripts/francise.mjs            # diff seul, n'écrit rien
node scripts/pose-lexique.mjs            # rapport seul, n'écrit rien
node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95
node .claude/skills/nodefony-ticket/scripts/ticket-effort.mjs              # tous les tickets fermés du dépôt
node .claude/skills/nodefony-ticket/scripts/ticket-open.mjs --title "fix(x): …" --body-file corps.md \
Usage : node .claude/skills/nodefony-ticket/scripts/ticket-progress.mjs [<sha>]   (défaut : HEAD)
node ticket-verify.mjs                       # ancres de tous les tickets ouverts
```

**Toutes les variables lues par ce skill** : `OWNER` · `REPO`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1006 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ❌ | 530 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-ticket/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
