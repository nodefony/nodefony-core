---
title: "nodefony-rfc — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-rfc/SKILL.md"
---

# `nodefony-rfc`

> Cite et applique les RFC officielles IETF et W3C pour valider la conformité HTTP/1.1, HTTP/2, WebSocket, CORS, Cookies dans Nodefony — sources brutes (TXT IETF, raw GitHub W3C) via proxy r.jina.ai, jamais les pages HTML.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-rfc**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                  |
| ------------------------ | ------------------------------------------------ |
| Version                  | — (non versionné)                                |
| Famille                  | Références et livrables                          |
| Corps                    | 68 lignes                                        |
| Coût d'activation        | ~631 tokens (le corps est chargé à l'invocation) |
| Description              | 400 / 1024 caractères                            |
| Déclencheurs             | 9                                                |
| Ressources `references/` | 0 page(s)                                        |
| Scripts                  | 0                                                |
| Conformité               | ✅ conforme au standard                          |

## Ce qu'il fait

Cite et applique les RFC officielles IETF et W3C pour valider la conformité HTTP/1.1, HTTP/2, WebSocket, CORS, Cookies dans Nodefony — sources brutes (TXT IETF, raw GitHub W3C) via proxy r.jina.ai, jamais les pages HTML.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`RFC` · `conformité HTTP` · `norme WebSocket` · `CORS spec` · `Fetch standard` · `RFC 9110/9113/6455/6265` · `pseudo-headers HTTP/2` · `frame masking` · `SameSite cookies`

## Ce que contient le corps

- Règle d'or
- Sources canoniques
- Pattern d'usage
- Anti-patterns à éviter

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 400    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 68     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-rfc/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
