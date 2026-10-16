# @nodefony/ai

> La boîte à outils IA de Nodefony : exposer les outils de votre application à n'importe quel
> agent (serveur MCP), consommer des serveurs MCP, puis bâtir les services d'une couche
> agentique — accès modèle, index vectoriel, mémoire, orchestration d'agents, gouvernance.

## Pourquoi ce paquet

Un agent d'intelligence artificielle qui n'a ni terminal ni accès à votre code — Claude.ai,
ChatGPT, Copilot, l'agent d'un de vos clients — ne peut atteindre votre application que par une
porte standard. Cette porte, c'est le **Model Context Protocol** (MCP) : l'agent demande à votre
application quels outils elle offre, reçoit pour chacun un nom, une description et un schéma
d'entrée, puis les appelle. MCP est aux agents ce que REST a été aux applications.

`@nodefony/ai` vous donne cette porte, et tout ce qui va autour, dans le style du framework :
injectable, configuré par un schéma validé au démarrage, sans coût pour ce que vous n'utilisez pas.

## Deux usages de l'IA, deux paquets

| Vous voulez…                                                                               | Paquet             |
| ------------------------------------------------------------------------------------------ | ------------------ |
| que **votre application** offre des outils à des agents, ou embarque ses propres agents    | **`@nodefony/ai`** |
| qu'un **agent de code** (Claude Code, Codex, Gemini…) vous aide à développer l'application | `@nodefony/devkit` |

Le serveur MCP de développement de Nodefony — celui qui répond `nodefony_inspect`,
`nodefony_card`, `nodefony_check` à votre agent de code — est bâti avec ce paquet, exactement
comme le vôtre le sera.

## Un socle, pas une option

`@nodefony/ai` se charge comme `@nodefony/http` ou `@nodefony/framework` : toujours, dans
tous les environnements. Les autres modules s'y appuient pour déclarer leurs outils. Il ne coûte
rien tant qu'aucune capacité n'est configurée, et n'ouvre aucune porte en production sans
autorisation.

## Ce qui est fait, ce qui vient

Une capacité n'est **livrée** que lorsque son ticket est fermé ; les versions visées sont celles
de la feuille de route, et peuvent glisser. Ce qui est effectivement publié, version par version,
se lit dans le
[journal des changements](https://github.com/nodefony/nodefony-core/blob/main/CHANGELOG.md).

### Livré

| Capacité         | Ce qu'elle apporte                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **Module socle** | chargé partout comme `@nodefony/http`, configuration validée au démarrage (faute nommée) |

### En cours — `10.0.0`

| Capacité        | Ce qu'elle apporte                                                                                                           | Suivi                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Serveur MCP** | protocole, porte HTTP en flux, garde d'origine et d'adresse, autorisation OAuth par outil, outils déclarés par chaque module | [#565](https://github.com/nodefony/nodefony-core/issues/565) |

Chaque outil y annonce s'il ne fait que lire ou s'il modifie (indices `ToolAnnotations` de la
spec, [#540](https://github.com/nodefony/nodefony-core/issues/540)), pour que l'agent sache quand
demander confirmation. La boîte à outils MCP fonctionne déjà : elle sert aujourd'hui depuis le paquet `nodefony` (et la
porte de développement de `@nodefony/devkit`). Elle rejoint ce paquet pour la `10.0.0`, qui en
devient la seule adresse.

### Prévu

| Capacité                      | Ce qu'elle apporte                                                                 | Version visée | Suivi                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| **MCP par l'entrée standard** | les agents qui lancent eux-mêmes leur serveur (stdio)                              | `10.1`        | [#462](https://github.com/nodefony/nodefony-core/issues/462) |
| **Route annotée → outil**     | exposer une route existante à un agent, par le même pare-feu que la requête HTTP   | `12.0`        | [#503](https://github.com/nodefony/nodefony-core/issues/503) |
| **Registre MCP officiel**     | une porte de production publiable et trouvable dans l'annuaire des serveurs MCP    | `12.0`        | [#550](https://github.com/nodefony/nodefony-core/issues/550) |
| **Client MCP**                | consommer les serveurs MCP existants au lieu d'écrire chaque intégration           | `12.0`        | couche agentique                                             |
| **Accès modèle**              | une interface, plusieurs fournisseurs (Anthropic, OpenAI, Mistral, Ollama)         | `12.0`        | [#246](https://github.com/nodefony/nodefony-core/issues/246) |
| **Recherche augmentée**       | index vectoriel adossé à l'ORM, recherche appelée par l'agent comme un outil       | `12.0`        | [#248](https://github.com/nodefony/nodefony-core/issues/248) |
| **Mémoire**                   | court terme, long terme, épisodique                                                | `12.0`        | [#249](https://github.com/nodefony/nodefony-core/issues/249) |
| **Orchestration d'agents**    | boucle, outils, annulation, reprise ; un agent peut tourner seul dans un conteneur | `12.0`        | [#250](https://github.com/nodefony/nodefony-core/issues/250) |
| **Gouvernance**               | bornes d'exécution, validation humaine, audit                                      | `12.0`        | [#252](https://github.com/nodefony/nodefony-core/issues/252) |

La couche agentique (`12.0`) s'ouvre par un état de l'art
([#245](https://github.com/nodefony/nodefony-core/issues/245)) : son périmètre exact sera arrêté
à ce moment-là.

## Principes

- **Rien n'est payé sans être utilisé.** Une capacité sans fournisseur configuré n'alloue rien et
  n'importe rien. Les fournisseurs lourds (SDK d'un modèle, client d'une base vectorielle) sont
  des dépendances optionnelles, chargées au premier usage.
- **Le modèle ne tourne jamais dans votre serveur.** Nodefony orchestre un modèle servi ailleurs ;
  il ne l'exécute pas dans le process qui sert vos requêtes.
- **Prêt pour la production.** Une porte MCP exposée hors du développement exige une
  autorisation : chaque outil déclare ce qu'il exige, et un appelant ne voit que ce qu'il peut
  appeler.
- **Conforme à la spécification MCP** (révision `2026-07-28`, anciens clients acceptés).

## Installer et activer

Le paquet s'installe à côté du framework, puis s'active dans le manifeste de l'application :

```ts
// nodefony.config.ts
modules: [
  // …
  use("@nodefony/ai", {}, { policy: "mandatory" }),
],
```

La clé de configuration est validée au démarrage : une faute de frappe arrête l'application en
nommant le champ, au lieu d'être ignorée en silence.

## Pour aller plus loin

- La vision de la couche IA :
  [livre blanc](https://github.com/nodefony/nodefony-core/blob/main/docs/ia/livre-blanc-couche-ia.md)
- Les décisions d'architecture :
  [ADR](https://github.com/nodefony/nodefony-core/tree/main/docs/adr)

## Licence

Apache-2.0 — © Christophe CAMENSULI.
