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
| **IA DANS l'application** (ce que l'utilisateur bâtit) | **`@nodefony/ai`** | boîte MCP, mécanique de porte, client, `llm`, `vector`, `memory`, `agent`, garde  |
| **IA POUR développer l'application** (outillage)       | `@nodefony/devkit` | le MCP DE Nodefony (outils `nodefony_*`), lecteur de transcripts d'agents de code |

`@nodefony/devkit` est un **consommateur** de ce module, comme n'importe quelle application : il
déclare ses outils et s'appuie sur la base commune d'ici. Il n'en possède aucune copie, et il
garde SA porte de développement (`/nodefony/mcp`, `policy: "dev"`), bâtie sur `serveMcp`.

**Module SOCLE — `policy: "mandatory"`**, au même rang que `http`, `framework` et `security` :
toujours chargé, jamais filtré, dans TOUS les environnements. Il livre la base dont dépendent
devkit, tout module qui déclare des outils (`getMcpTools()`) et les agents de l'application.
Ce statut n'est sûr que tenu par deux règles du module : **aucun coût par requête** tant
qu'aucune capacité n'est configurée, et **aucune route montée** : une porte MCP se DÉCLARE, par
le controller de qui en a besoin (devkit, ou l'application — en développement ou en production,
à son choix). Il ne fait pas partie du paquet `nodefony` : le cœur ne l'importe jamais.

## Frontières

Cible arrêtée comme hypothèse de travail par l'auteur — révisable ; le plan, les preuves et la
table de placement complète vivent dans #565 (et l'ADR qui le clôt). Critère : **aucun symbole
public ni aucune clé de configuration ne déménage une seconde fois après la `10.0.0`**.

| Où                     | Ce qui y vit                                                                                                                                                                                                                                                            | Pourquoi                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cœur `nodefony`**    | les CONTRATS en types (`types/IMcpTool.ts`, hook `getMcpTools()`), JSON-RPC 2.0, serveur de ressource OAuth (`oauth/`, `runtime/bearer.ts`), `MCP_ENDPOINT_PATH`, `ai:mcp`, `ai:sync`                                                                                   | partagés (temps réel, security) ; le hook est typé par `Module` sous `noImplicitOverride` ; `ai:mcp`/`ai:sync` tournent avant toute installation (`create app`, `upgrade`) |
| **`@nodefony/ai`**     | protocole MCP, moteur `handleMcpMessage`, progression, flux, garde, rôles des appelants, collecte et appel des outils, **la mécanique de porte** (`serveMcpRequest` pure, `serveMcp` pour un controller, `mcpConfigSchema`, `mcpProtectedResources`) — **aucune route** | ce qu'une application emploie pour ouvrir SA porte, en production comprise ; ré-exporte les contrats du cœur                                                               |
| **`@nodefony/devkit`** | les 7 outils `nodefony_*` (`getMcpTools()`), et **sa porte de développement** `POST /nodefony/mcp` (`policy: "dev"`, config `devkit.mcp.*`), controller mince autour de `serveMcp`                                                                                      | le MCP de Nodefony : un CONSOMMATEUR de la mécanique, qui déclare sa porte comme le ferait une application                                                                 |

Règle des commandes : le cœur possède `ai:mcp` et `ai:sync` ; toute autre commande `ai:*`
(stdio, fiche du registre, exécution d'agent) appartient au module.

## Règles du module (non négociables)

- **Sens des dépendances** : `@nodefony/ai → nodefony` (+ `@nodefony/http`, `@nodefony/framework`
  en pairs) ; `@nodefony/devkit → @nodefony/ai`. **Le cœur n'importe JAMAIS `@nodefony/ai`** —
  `node scripts/gates/check-package-deps.mjs` refuse tout cycle, la liste des cycles déclarés est vide.
- **Coût borné au boot, nul par requête** : au démarrage, un import, un service et un parse Zod
  — constants, mesurés par le gate mémoire. Aucune route : par requête, zéro.
  Quatre invariants à tenir à CHAQUE capacité ajoutée : aucun écouteur sur le chemin de requête
  (`onRequest`, `onRequestScope`) ni minuteur tant que rien n'est configuré ; aucun registre
  peuplé au boot (collecte à la requête) ; aucun `import()` de fournisseur à la charge du module ;
  rien dans le constructeur ni dans `init()` d'un service non configuré, au-delà de lire sa config.
- **Ce module ne monte AUCUNE route** (`@controllers([])`) : une porte se déclare par un
  controller qui appelle `serveMcp()`. Ne jamais y ajouter « la » porte — c'est le contresens que
  #565 a corrigé.
- **Défaut sûr de la mécanique** : une porte NON protégée n'accorde AUCUN rôle
  (`mcpCallerRoles`, `serveMcpRequest`) ; ses outils réservés restent retenus. Seule une porte que
  son PÉRIMÈTRE protège (devkit, `policy: "dev"`) passe `operatorRoles`, et l'écrit.
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
- **Révision MCP** : le serveur parle aux clients déployés (handshake `initialize`) et porte la
  FORME de résultat de la révision COURANTE de la spec ; `server/discover` est volontairement non servi tant qu'aucun
  client déployé n'emprunte le fil moderne. Cette révision est **sans état** (plus de
  `initialize` ni de `Mcp-Session-Id`, plus de flux ouvert par `GET`, capacités du client dans
  `_meta` à chaque requête) et le serveur n'y émet JAMAIS de requête vers le client : une demande à
  l'utilisateur ou au modèle y passe par le « multi round-trip » (`resultType: "input_required"` +
  `requestState`, qui doit être signé, lié à l'appelant et borné dans le temps) — non servi ici. Sampling et Roots sont **dépréciés** : ne rien bâtir
  dessus. Spec hors ligne : skill `nodefony-rfc` (sa référence MCP, révision courante). Trancher une
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
  changelog sous `Changed` — semver §9 : une pré-version n'engage aucune compatibilité (la page
  `docs/guides/compatibilite.md` ne traite pas des pré-versions ; sa garantie porte sur `exports`).

## Structure cible (dossiers réservés)

Un dossier n'est créé que le jour où il reçoit du code — cette carte dit OÙ il ira, pour qu'aucun
déménagement ne soit nécessaire après la `10.0.0`.

```
index.ts                     AiModule + barrel public (seule porte d'import)
nodefony/config/             schéma Zod (config.ts) + builder (defineModuleConfig.ts)
nodefony/service/            un service par capacité (McpService, puis LlmService…)
nodefony/mcp/                protocole, moteur, progression, flux, garde, appelants, outils
nodefony/mcp/gate.ts         serveMcpRequest() (pur) + serveMcp() pour un controller — la porte SANS la route
nodefony/mcp/client/         client MCP (consommer un serveur externe)
nodefony/mcp/resources/      ressources et abonnements (subscriptions/listen)
nodefony/mcp/bridge/         jonction avec le hub temps réel (résolu par nom)
nodefony/command/            commandes qui SERVENT le MCP de l'app (stdio, fiche du registre, exécution d'agent)
nodefony/{llm,vector,memory,agent,guard}/   capacités de la couche agentique
```

Les esquisses `src/packages/@nodefony/{agent,llm,memory,rag,vector}` (privées, `0.0.0`, tests
inertes) ne sont PAS la source de ces capacités : leur suppression est décidée (geste 0 de #565),
git en garde l'historique. Une capacité naît ici, dessinée par l'état de l'art qui ouvre la
phase 12 (#245) — jamais recopiée d'une esquisse.

## Interdits sans accord explicite de l'auteur

- Importer `@nodefony/ai` depuis le cœur, ou depuis `@nodefony/http`.
- Ajouter une dépendance npm d'exécution (peser taille et mémoire) — un fournisseur part en
  sous-chemin optionnel.
- Ajouter une entrée à `exports`, ou déplacer un symbole public hors de ce paquet.

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
