---
title: "nodefony-rfc — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-25
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-rfc/SKILL.md"
---

# `nodefony-rfc`

> Cite et applique les normes qui font foi pour Nodefony — RFC IETF, specs W3C/WHATWG, et la spécification Model Context Protocol — depuis des sources brutes, jamais des pages HTML.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-rfc**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.1.0` |
| Famille | Références et livrables |
| Corps | 147 lignes |
| Coût d'activation | ~2 428 tokens (le corps est chargé à l'invocation) |
| Description | 829 / 1024 caractères |
| Déclencheurs | 22 |
| Ressources `references/` | 0 page(s), 162 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Cite et applique les normes qui font foi pour Nodefony — RFC IETF, specs W3C/WHATWG, et la spécification Model Context Protocol — depuis des sources brutes, jamais des pages HTML. Porte HORS LIGNE la révision MCP 2026-07-28 (transport, versioning, autorisation) et renvoie au corpus RFC unique du dépôt (40 full-text, dont OAuth 8414/9728/6750/8707) : les relire coûte zéro requête.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`RFC` · `conformité HTTP` · `norme WebSocket` · `CORS spec` · `Fetch standard` · `RFC 9110/9113/6455/6265` · `pseudo-headers HTTP/2` · `frame masking` · `SameSite cookies` · `spec MCP` · `Model Context Protocol` · `révision 2026-07-28` · `server/discover` · `ère legacy MCP` · `autorisation MCP` · `resource server OAuth` · `protected resource metadata` · `RFC 9728` · `WWW-Authenticate` · `jeton Bearer` · `audience d'un jeton` · `resource indicator`

## Ce que contient le corps

- Règle d'or
- Sources canoniques
- Pattern d'usage
- Anti-patterns à éviter

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 829 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 147 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-rfc/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
