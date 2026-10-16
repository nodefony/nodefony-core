# CLAUDE.md — @nodefony/ai

> Instructions IA de CE module. Vérité COURANTE, jamais un journal : pas de date, pas de TODO,
> pas d'avancement (il vit dans les tickets, jalon `10.0.0`, hors ligne `.ai/BOARD.md`). Un fait
> périmé se CORRIGE en place. Internals : [`MEMORY.md`](./MEMORY.md) · humains : [`README.md`](./README.md).

## Rôle — la boîte à outils de l'IA DANS l'application

`@nodefony/ai` donne à une application Nodefony **tout ce qu'il faut pour bâtir un service IA** :
exposer ses outils métier à n'importe quel agent (serveur MCP), consommer des serveurs MCP
externes (client), puis les capacités de la couche agentique — accès modèle, index vectoriel,
mémoire, orchestration d'agents, gouvernance. Un utilisateur qui fait un serveur MCP importe
**tout** de ce paquet.

Deux usages de l'IA, deux paquets — ne JAMAIS les confondre :

| Usage                                                  | Paquet             | Exemples                                                                          |
| ------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| **IA DANS l'application** (ce que l'utilisateur bâtit) | **`@nodefony/ai`** | boîte MCP, porte, client, `llm`, `vector`, `memory`, `agent`, garde               |
| **IA POUR développer l'application** (outillage)       | `@nodefony/devkit` | le MCP DE Nodefony (outils `nodefony_*`), lecteur de transcripts d'agents de code |

`@nodefony/devkit` est un **consommateur** de ce module, comme n'importe quelle application : il
déclare ses outils et s'appuie sur la base commune d'ici. Il n'en possède aucune copie.

**Module SOCLE — `policy: "mandatory"`**, au même rang que `http`, `framework` et `security` :
toujours chargé, jamais filtré, dans TOUS les environnements. Il livre la base dont dépendent
devkit, tout module qui déclare des outils (`getMcpTools()`) et les agents de l'application.
Ce statut n'est sûr que tenu par deux règles du module : **coût nul** tant qu'aucune capacité
n'est configurée, et **aucune porte ouverte en production sans autorisation**. Il ne fait pas
partie du paquet `nodefony` : le cœur ne l'importe jamais.

## Frontières (arrêtées)

| Où                     | Ce qui y vit                                                                                                                    | Pourquoi                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **cœur `nodefony`**    | JSON-RPC 2.0 (`jsonrpc/`), serveur de ressource OAuth (`oauth/`, `runtime/bearer.ts`), `ai:mcp`, `ai:sync`, `MCP_ENDPOINT_PATH` | partagés avec le temps réel et `@nodefony/security` ; `ai:mcp`/`ai:sync` tournent avant toute installation (`create app`, `upgrade`) et doivent exister dans une app `minimal` |
| **`@nodefony/ai`**     | protocole MCP, moteur `handleMcpMessage`, progression, flux, garde d'accès, rôles des appelants, collecte et appel des outils   | ce qu'une application emploie pour exposer SES outils — prêt pour la production, pas réservé au dev                                                                            |
| **`@nodefony/devkit`** | les 7 outils `nodefony_*` (inspect, card, check, symbols, docs, admin_list, admin_call)                                         | le MCP de Nodefony, chargé en développement (`policy: "dev"`)                                                                                                                  |

Les arbitrages encore ouverts (porte HTTP ici ou dans devkit, emplacement des types `IMcpTool`,
dépendance de l'app générée, règle de production d'une porte anonyme) vivent dans le ticket
**#565** et dans l'ADR qui le clôt — pas ici. Ce fichier ne porte que ce qui est arrêté.

## Règles du module (non négociables)

- **Sens des dépendances** : `@nodefony/ai → nodefony` (+ `@nodefony/http`, `@nodefony/framework`
  en pairs) ; `@nodefony/devkit → @nodefony/ai`. **Le cœur n'importe JAMAIS `@nodefony/ai`** —
  `node scripts/gates/check-package-deps.mjs` refuse tout cycle, la liste des cycles déclarés est vide.
- **Coût nul sans usage** : une capacité dont aucun fournisseur n'est configuré coûte **zéro
  allocation et zéro import**. Collecte des outils paresseuse, à la requête ; aucun registre
  peuplé au boot « au cas où ». Règle perf/mémoire du `CLAUDE.md` racine, sans exception.
- **Fournisseurs lourds = sous-chemins optionnels** (`@nodefony/ai/<fournisseur>`, SDK de modèle,
  client de base vectorielle) : `peerDependenciesMeta.optional` + `import()` au premier usage.
  La racine `@nodefony/ai` n'en tire aucun. Un sous-chemin ne se déclare dans `exports` que le
  jour où il a une cible (une entrée vide casse `release:pack`).
- **L'inférence ne tourne JAMAIS dans le process** (ADR-0004) : on orchestre un modèle, on ne
  l'exécute pas. Pas de `node-llama-cpp`, pas de `transformers.js`.
- **Tout est injectable** : une capacité = un service nommé dans le conteneur (`mcp`, puis `llm`,
  `vector`, `memory`, `agent`, `guard`). Les jonctions avec d'autres modules (temps réel,
  vérificateur de jeton) se résolvent **par NOM + contrat structurel**, jamais par une
  dépendance de paquet (précédents : `ACCESS_TOKEN_VERIFIER`, `IAdminBrokerLike`).
- **Révision MCP servie : `2026-07-28`, en double ère** (anciens clients acceptés). Cette révision
  est **sans état** : plus de `initialize`, plus de `Mcp-Session-Id`, plus de flux ouvert par
  `GET` ; les capacités du client voyagent dans `_meta` à chaque requête ; le serveur n'émet
  JAMAIS de requête JSON-RPC vers le client — une demande à l'utilisateur ou au modèle passe par
  le « multi round-trip » (`resultType: "input_required"` + `requestState`, qui doit être signé,
  lié à l'appelant et borné dans le temps). Sampling et Roots sont **dépréciés** : ne rien bâtir
  dessus. Spec hors ligne : skill `nodefony-rfc` (`references/mcp-2026-07-28/`). Trancher une
  question de protocole sur la spec, jamais de mémoire.
- **Un échec métier d'outil est un résultat `isError`, jamais une erreur JSON-RPC** : le
  protocole réserve ses erreurs aux fautes de protocole ; l'agent ne peut corriger seul que la
  première.
- **Aucun contrôle d'autorisation dans l'appel d'un outil** : il vit à la COLLECTE (le catalogue
  servi à un appelant ne contient que ce qu'il peut appeler). Ne jamais passer une liste non
  filtrée à l'appel — deux points de décision divergeraient.
- **L'appel en process reste public** (collecte + appel sans porte HTTP) : c'est la voie d'un
  agent de l'application qui appelle ses propres outils, y compris dans un pod sans serveur.
- **Variables d'environnement préfixées `NF_`**, lues par le seul `env.ts` de l'application.
- **Pré-version** : pas d'alias de compatibilité pour ce qui a quitté `nodefony` ; entrée de
  changelog sous `Changed`. À partir de la `10.0.0`, la politique publique
  (`docs/guides/compatibilite.md`) s'applique : la garantie porte sur `exports`.

## Structure cible (dossiers réservés)

Un dossier n'est créé que le jour où il reçoit du code — cette carte dit OÙ il ira, pour qu'aucun
déménagement ne soit nécessaire après la `10.0.0`.

```
index.ts                     AiModule + barrel public (seule porte d'import)
nodefony/config/             schéma Zod (config.ts) + builder (defineModuleConfig.ts)
nodefony/service/            un service par capacité (McpService, puis LlmService…)
nodefony/mcp/                protocole, moteur, progression, flux, garde, appelants, outils
nodefony/mcp/client/         client MCP (consommer un serveur externe)
nodefony/mcp/resources/      ressources et abonnements (subscriptions/listen)
nodefony/mcp/bridge/         jonction avec le hub temps réel (résolu par nom)
nodefony/command/            commandes qui SERVENT le MCP de l'app (stdio, fiche du registre, exécution d'agent)
nodefony/{llm,vector,memory,agent,guard}/   capacités de la couche agentique
```

Les esquisses `src/packages/@nodefony/{agent,llm,memory,rag,vector}` (privées, tests inertes)
restent où elles sont jusqu'à l'audit d'ouverture de la phase 12 (#245), qui dira ce qui se garde,
se réécrit ou se supprime. Ne pas les absorber par anticipation.

## Interdits sans accord explicite de l'auteur

- Importer `@nodefony/ai` depuis le cœur, ou depuis `@nodefony/http`.
- Ajouter une dépendance npm d'exécution (peser taille et mémoire) — un fournisseur part en
  sous-chemin optionnel.
- Ajouter une entrée à `exports`, ou déplacer un symbole public hors de ce paquet.
- Supprimer les esquisses de la phase 12 ou les dossiers vides `mcp/`, `agent-guard/`.

## Gates avant commit

```bash
cd src/packages/@nodefony/ai && npm run build && npm run typecheck && npx vitest run
node scripts/gates/check-package-deps.mjs        # racine : sens des dépendances, types joignables
npm run check:lang                               # racine : identifiants de production en anglais
```

Touché à la porte HTTP ou au pipeline de requête → suite mémoire (skill
`nodefony-check-memory-health`). Touché au protocole → relire la section concernée de la spec
(skill `nodefony-rfc`). Touché à l'autorisation → skill `nodefony-security-review`.

## Liens

- Vision : `docs/ia/livre-blanc-couche-ia.md` · inférence orchestrée : ADR-0004 (`docs/adr/`)
- Feuille de route de la phase 12 : skill `nodefony-roadmap`
- Coder dans un module du dépôt : skill `nodefony-framework-dev`
