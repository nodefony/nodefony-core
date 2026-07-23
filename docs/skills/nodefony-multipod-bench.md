---
title: "nodefony-multipod-bench — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-multipod-bench/SKILL.md"
---

# `nodefony-multipod-bench`

> Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-multipod-bench**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 140 lignes              |
| Description              | 988 / 1024 caractères   |
| Déclencheurs             | 12                      |
| Ressources `references/` | 2 page(s)               |
| Scripts                  | 9                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout. Fournit le décor (Redis docker, apps liées au framework, ports dédiés), les scripts de mesure (latence, charge, coût de publication, forge d'enveloppe scellée), la matrice d'attaque du backplane et les pièges du lancement multi-instances. À charger AVANT de monter le décor ou de lancer un script : sans le protocole, un banc saturé mesure un backlog et non une latence, et une infra éteinte en route rend les tests silencieusement verts.

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

- `references/controller.md`
- `references/pieges.md`

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script                | Rôle                                                                           | Options                                                                                                   | Variables d'environnement |
| --------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `scripts/bench.mjs`   | Banc de charge F83 — latence de bout en bout d'un fan-out CROSS-POD.           | —                                                                                                         | —                         |
| `scripts/forge.mjs`   | —                                                                              | —                                                                                                         | —                         |
| `scripts/latency.mjs` | Latence PURE du chemin cross-pod, hors saturation : 1 client, messages         | —                                                                                                         | —                         |
| `scripts/listen.mjs`  | Écouteur du banc F83 — WebSocket brut parlant le JSON-RPC 2.0 de la socket     | —                                                                                                         | —                         |
| `scripts/mempeak.sh`  | Pic mémoire d'un pod pendant une rafale de publications.                       | —                                                                                                         | —                         |
| `scripts/pubcost.mjs` | —                                                                              | —                                                                                                         | —                         |
| `scripts/run.sh`      | Démarre les pods du banc : deux instances de la première application (même     | `--stop`                                                                                                  | `NF_BENCH_SECRET`         |
| `scripts/setup.sh`    | Monte le banc multi-pods : Redis + N applications générées, liées au framework | `--controller` `--frontend` `--link` `--no-auth-warning` `--no-install` `--no-service` `--preset` `--yes` | `APP`                     |
| `scripts/soak.mjs`    | Charge soutenue cross-pod, par paliers de connexions.                          | —                                                                                                         | —                         |

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

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 988    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 140    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
