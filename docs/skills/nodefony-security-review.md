---
title: "nodefony-security-review — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-security-review/SKILL.md"
---

# `nodefony-security-review`

> Hub SÉCURITÉ de Nodefony, deux modes.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-security-review**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Inspecter et auditer |
| Corps | 356 lignes |
| Coût d'activation | ~6 339 tokens (le corps est chargé à l'invocation) |
| Description | 973 / 1024 caractères |
| Déclencheurs | 14 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Hub SÉCURITÉ de Nodefony, deux modes. REVIEW : conformité d'un diff AVANT commit (injection bindée, secrets hors logs, RFC HTTP/WS/cookies/CORS, Zero Trust 403, JWT, crypto mot de passe, zéro any). RED/BLUE-TEAM : campagne d'attaque sur une brique en 2 passes — threat-first (matrice depuis OWASP/RFC AVANT de lire le code, anti-biais) puis code-first (couvrir les branches restantes) — avec le cycle faille trouvée → corrigée → re-prouvée, et un rapport par vecteur. Conçoit des attaques propres à l'architecture (pipeline HTTP+WS partagé, token dans l'ALS, pont api.request, canaux WS, zones et bypass du firewall, scopes DI, trust-proxy), pas seulement des attaques OWASP génériques.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`inspect`](nodefony-inspect.md) · [`rfc`](nodefony-rfc.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`revue sécurité` · `audit sécurité` · `security review` · `check sécurité avant commit` · `c'est safe ?` · `vérifie la sécurité` · `red-team` · `blue-team` · `matrice d'attaque` · `test d'attaque` · `attaquer le framework` · `attaquer cette brique` · `durcir la sécurité` · `pentest`

## Ce que contient le corps

- Quand
- 1. Cadrer le diff (ne scanner que le changé)
- 2. Checklist (grep ciblé sur le diff, pas tout le repo)
- 3. Verdict (format de sortie)
- 4. Mode RED/BLUE-TEAM — campagne de tests d'attaque sur une brique
- 5. Référentiels & sources de menace (ouverts)
- Anti-patterns
- Liens

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 973 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 356 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-security-review/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
