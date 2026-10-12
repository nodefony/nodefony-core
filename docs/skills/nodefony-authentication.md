---
title: "nodefony-authentication — fiche de skill"
navTitle: nodefony-authentication
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-12
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-authentication/SKILL.md"
---

# `nodefony-authentication`

> Établit QUI est l'utilisateur d'une application Nodefony par ce que le framework sert déjà — page /login et son habillage, client NodefonyLogin, route me, second facteur, connexion récente, retour sûr après connexion, fournisseurs (Keycloak, GitHub), jeton d'un programme — au lieu de le réécrire.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-authentication**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Autres |
| Corps | 215 lignes |
| Coût d'activation | ~3 350 tokens (le corps est chargé à l'invocation) |
| Description | 876 / 1024 caractères |
| Déclencheurs | 16 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Établit QUI est l'utilisateur d'une application Nodefony par ce que le framework sert déjà — page /login et son habillage, client NodefonyLogin, route me, second facteur, connexion récente, retour sûr après connexion, fournisseurs (Keycloak, GitHub), jeton d'un programme — au lieu de le réécrire. À charger AVANT d'écrire un formulaire de connexion, une redirection après login, une lecture de session ou un appel d'API depuis un script. Ce qu'un utilisateur connecté a le DROIT de faire → nodefony-protect-route.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`ajoute une page de connexion` · `formulaire de login` · `se connecter` · `second facteur` · `TOTP` · `MFA` · `exiger une connexion récente` · `ramener l'utilisateur après la connexion` · `?from=` · `qui est connecté` · `déconnexion` · `Keycloak` · `se connecter avec GitHub` · `mon script doit appeler l'API sans formulaire` · `jeton d'accès` · `202 au login`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. 🔴 Ce qui est DÉJÀ servi — n'écris ni page, ni controller de compte
- 3. Habiller la page `/login` — sans la réécrire
- 4. Une connexion dans TON front — `NodefonyLogin`, jamais `fetch`
- 5. Le `202` est un DÉFI, pas un succès
- 6. Ramener l'utilisateur après la connexion — `safeRedirectPath`
- 7. Exiger une connexion RÉCENTE, ou deux facteurs, avant une action sensible
- 8. Les routes de connexion restent sous le contrôle anti-falsification
- 9. 🔴 En production, un mot de passe en HTTP clair est refusé (`403`)
- 10. Se connecter par un fournisseur (Keycloak, GitHub…)
- 11. Un PROGRAMME ne remplit jamais le formulaire
- 12. Prouver que c'est fait

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 876 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 215 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-authentication/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
