---
title: "nodefony-multipod-bench — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-30
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-multipod-bench/SKILL.md"
---

# `nodefony-multipod-bench`

> Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-multipod-bench**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 140 lignes |
| Coût d'activation | ~2 431 tokens (le corps est chargé à l'invocation) |
| Description | 988 / 1024 caractères |
| Déclencheurs | 12 |
| Ressources `references/` | 2 page(s) |
| Scripts | 9 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout. Fournit le décor (Redis docker, apps liées au framework, ports dédiés), les scripts de mesure (latence, charge, coût de publication, forge d'enveloppe scellée), la matrice d'attaque du backplane et les pièges du lancement multi-instances. À charger AVANT de monter le décor ou de lancer un script : sans le protocole, un banc saturé mesure un backlog et non une latence, et une infra éteinte en route rend les tests silencieusement verts.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **redis** · **docker**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`load-test`](nodefony-load-test.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`banc multi-pods` · `tester en cluster` · `cross-pod` · `deux apps` · `plusieurs pods` · `injection backplane` · `bus Redis partagé` · `fan-out cross-pod` · `prouver en réel` · `backplane secret` · `est-ce que ça marche à plusieurs instances ?` · `les apps sont-elles cloisonnées ?`

## Ce que contient le corps

- Quand ce banc est le bon outil
- 1. Monter le banc — deux commandes
- 2. Ce que le décor contient (et pourquoi)
- 3. La matrice d'attaque du bus
- 4. Les mesures
- 5. Le démontage
- Ce que ce banc a déjà trouvé
- Liens

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/controller.md` | Le controller du banc | 124 |
| `references/pieges.md` | Pièges du banc multi-pods | 82 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/bench.mjs` | Banc de charge F83 — latence de bout en bout d'un fan-out CROSS-POD. | — | — |
| `scripts/forge.mjs` | — | — | — |
| `scripts/latency.mjs` | Latence PURE du chemin cross-pod, hors saturation : 1 client, messages | — | — |
| `scripts/listen.mjs` | Écouteur du banc F83 — WebSocket brut parlant le JSON-RPC 2.0 de la socket | — | — |
| `scripts/mempeak.sh` | Pic mémoire d'un pod pendant une rafale de publications. | — | — |
| `scripts/pubcost.mjs` | — | — | — |
| `scripts/run.sh` | Démarre les pods du banc : deux instances de la première application (même | `--stop` | `NF_BENCH_SECRET` |
| `scripts/setup.sh` | Monte le banc multi-pods : Redis + N applications générées, liées au framework | `--controller` `--frontend` `--link` `--no-auth-warning` `--no-install` `--no-service` `--preset` `--yes` | `APP` |
| `scripts/soak.mjs` | Charge soutenue cross-pod, par paliers de connexions. | — | — |

**Invocation telle que documentée dans chaque script :**

```bash
node bench.mjs <portRécepteur> <portÉmetteur> <connexions> <rafales>
node latency.mjs <portRx> <portTx> <nbMessages> <intervalleMs>
node listen.mjs <port> <secondes>
bash scripts/run.sh [dossier] [namespace]
bash scripts/setup.sh [dossier] [namespace]
node soak.mjs <portRx> <portTx> <paliers> <secondesParPalier>
```

**Toutes les variables lues par ce skill** : `APP` · `NF_BENCH_SECRET`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 988 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 140 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-multipod-bench/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
