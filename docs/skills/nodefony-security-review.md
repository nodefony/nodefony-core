---
title: "nodefony-security-review — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-security-review/SKILL.md"
---

# `nodefony-security-review`

> Hub SÉCURITÉ de Nodefony, deux modes.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-security-review**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 356 lignes              |
| Description              | 973 / 1024 caractères   |
| Déclencheurs             | 14                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Hub SÉCURITÉ de Nodefony, deux modes. REVIEW : conformité d'un diff AVANT commit (injection bindée, secrets hors logs, RFC HTTP/WS/cookies/CORS, Zero Trust 403, JWT, crypto mot de passe, zéro any). RED/BLUE-TEAM : campagne d'attaque sur une brique en 2 passes — threat-first (matrice depuis OWASP/RFC AVANT de lire le code, anti-biais) puis code-first (couvrir les branches restantes) — avec le cycle faille trouvée → corrigée → re-prouvée, et un rapport par vecteur. Conçoit des attaques propres à l'architecture (pipeline HTTP+WS partagé, token dans l'ALS, pont api.request, canaux WS, zones et bypass du firewall, scopes DI, trust-proxy), pas seulement des attaques OWASP génériques.

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

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 973    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 356    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
