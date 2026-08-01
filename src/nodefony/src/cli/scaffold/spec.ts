/**
 * Spec DÉCLARATIVE du scaffold — la source unique des choix de création.
 *
 * Les questions sont des DONNÉES (JSON-able, zéro fonction) : le même contrat
 * alimente les TROIS fronts de création —
 *   1. CLI rapide     : flags argv → réponses (`--preset minimal --frontend react`) ;
 *   2. CLI interactif : `interactive.ts` rend chaque question en readline natif ;
 *   3. Studio         : un endpoint data plane sert `getScaffoldSpec()` en JSON,
 *      le formulaire React poste les réponses au MÊME moteur (`engine.ts`).
 * Ajouter un choix = ajouter UNE entrée ici ; aucun front n'est à modifier.
 */

/** Une question de scaffold — champ `pattern` en string (JSON-able, validation partagée). */
export interface IScaffoldQuestion {
  key: string;
  /** Libellé montré tel quel par le CLI interactif et Studio. */
  label: string;
  /**
   * `"list"` = plusieurs valeurs indépendantes, chacune conservée entière.
   *
   * Distinct de `"string"` pour une raison qui se paie cher autrement : les
   * réponses sont normalisées en texte, et deux valeurs concaténées deviennent
   * indiscernables d'une seule. Deux index de deux colonnes se fondraient ainsi en
   * un index de quatre — du code qui compile et n'indexe pas ce qu'on croit.
   */
  type: "string" | "boolean" | "choice" | "list";
  /** Choix ordonnés (type "choice") — le premier N'est PAS forcément le défaut. */
  choices?: { value: string; label: string; hint?: string }[];
  default: string | boolean | string[];
  /** Regex source (sans flags) que la valeur string doit satisfaire. */
  pattern?: string;
  /** Message d'aide affiché si la validation échoue. */
  patternHint?: string;
  /**
   * Condition d'affichage par CAPACITÉ d'environnement (JSON-able — pas de
   * fonction) : la question n'est posée que si le front la déclare vraie.
   * `hasCheckout` = un checkout nodefony-core est résolvable (mode --link).
   */
  askIf?: "hasCheckout";
  /**
   * Source des choix RÉELS de cette question, dans le projet courant (JSON-able,
   * même esprit qu'`askIf`).
   *
   * Certaines réponses ne sont connues que du projet : les connecteurs qu'il
   * déclare, les entités qu'il contient déjà. Les écrire dans la spec serait
   * faux le lendemain. La question désigne donc une clé de
   * `getScaffoldContext()`, et chaque front l'hydrate à sa manière — Studio en
   * liste déroulante, le terminal en choix numérotés, `--describe-json` en
   * embarquant le contexte.
   *
   * Sans cela, `ref:` et `--connector` restent du texte libre : une faute de
   * frappe passe le scaffold et ne se voit qu'au démarrage suivant.
   */
  optionsFrom?: "connectors" | "entities";
  /**
   * Réglage **avancé** : jamais posé en dialogue (son défaut est sûr), mais piloté par
   * une option de la ligne de commande — et proposé par Studio dans un repli.
   *
   * Pourquoi ce drapeau plutôt que sortir la question de la spec : c'est la spec qui
   * porte les défauts, la validation et les valeurs permises. Une option absente d'ici
   * serait silencieusement ignorée par le moteur (`resolveAnswers` ne garde que les
   * clés déclarées) — le pire des deux mondes.
   */
  advanced?: boolean;
}

/** Spec d'un type de scaffold (`app` aujourd'hui ; `module`/`controller`/`entity` suivent). */
export interface IScaffoldTypeSpec {
  type: string;
  description: string;
  questions: IScaffoldQuestion[];
}

/** Frameworks front supportés par `@nodefony/frontend` (builder Vite multi-framework). */
export const FRONTEND_CHOICES = ["none", "react", "vue", "angular"] as const;
export type TFrontendChoice = (typeof FRONTEND_CHOICES)[number];

/** Presets d'app : la vitrine complète (défaut) ou la base saine http+framework. */
export const PRESET_CHOICES = ["complete", "minimal"] as const;
export type TPresetChoice = (typeof PRESET_CHOICES)[number];

const APP_SPEC: IScaffoldTypeSpec = {
  type: "app",
  description: "Application Nodefony autonome (hors du repo framework)",
  questions: [
    {
      key: "name",
      label: "Nom de l'application (kebab-case, ex : mon-app)",
      type: "string",
      default: "",
      pattern: "^[a-z][a-z0-9-]*$",
      patternHint:
        "kebab-case attendu — minuscules, chiffres, tirets (ex : mon-app)",
    },
    {
      key: "preset",
      label: "Contenu de l'application",
      type: "choice",
      choices: [
        {
          value: "complete",
          label: "Vitrine complète (recommandé)",
          hint: "ORM + realtime + security + Studio + infra docker + tests e2e",
        },
        {
          value: "minimal",
          label: "Minimal",
          hint: "http + framework seulement — la base saine, à faire grandir",
        },
      ],
      default: "complete",
    },
    {
      key: "frontend",
      label: "Framework frontend de l'app",
      type: "choice",
      choices: [
        {
          value: "none",
          label: "Aucun",
          hint: "API/backend seulement (ajoutable plus tard)",
        },
        {
          value: "react",
          label: "React 19",
          hint: "entry Vite + HMR fast-refresh",
        },
        { value: "vue", label: "Vue 3", hint: "SFC <script setup> + HMR" },
        {
          value: "angular",
          label: "Angular (standalone, zoneless)",
          hint: "via AnalogJS",
        },
      ],
      default: "none",
    },
    {
      key: "link",
      label:
        "Câbler les paquets nodefony sur le checkout local (dev framework) ?",
      type: "boolean",
      // false : un moteur ne réécrit JAMAIS des deps en file: sans demande
      // EXPLICITE (interactif : l'utilisateur répond ; API/flags : --link).
      default: false,
      askIf: "hasCheckout",
    },
  ],
};

/** Saveurs de controller : le WS est TOUJOURS là (différenciateur Nodefony). */
export const CONTROLLER_KIND_CHOICES = [
  "hello",
  "rest",
  "duplex",
  "realtime",
  "example",
] as const;
export type TControllerKindChoice = (typeof CONTROLLER_KIND_CHOICES)[number];

const CONTROLLER_SPEC: IScaffoldTypeSpec = {
  type: "controller",
  description:
    "Controller dans le projet courant (app racine ou module) — HTTP + WebSocket même classe",
  questions: [
    {
      key: "name",
      label:
        "Nom du controller (ex : blog ou BlogPost — suffixe Controller ajouté)",
      type: "string",
      default: "",
      pattern: "^[A-Za-z][A-Za-z0-9-]*$",
      patternHint:
        "lettres/chiffres/tirets, commence par une lettre (ex : blog, BlogPost)",
    },
    {
      key: "kind",
      label: "Saveur du controller",
      type: "choice",
      choices: [
        {
          value: "hello",
          label: "HTTP + WebSocket (recommandé)",
          hint: "pour DÉCOUVRIR le pipeline partagé : GET + echo WS même classe — WS métier → --kind realtime",
        },
        {
          value: "rest",
          label: "REST resource",
          hint: "CRUD de production (list/get/create/update/delete) — HTTP pur",
        },
        {
          value: "duplex",
          label: "Duplex REST + socket (api.request)",
          hint: "les MÊMES actions CRUD en HTTP ET par socket.request/mutate (@nodefony/realtime)",
        },
        {
          value: "realtime",
          label: "Realtime (socket Nodefony)",
          hint: "canaux pub/sub + actions RPC via RealtimeController (@nodefony/realtime)",
        },
        {
          value: "example",
          label: "Vitrine des décorateurs",
          hint: "démo pédagogique : TOUS les décorateurs commentés + curl d'essai",
        },
      ],
      default: "hello",
    },
    {
      key: "route",
      label:
        "Route de base (vide = /api/<nom> — couverte par la zone firewall ^/api)",
      type: "string",
      default: "",
      pattern: "^$|^/[A-Za-z0-9/_-]*$",
      patternHint: "chemin absolu (ex : /api/blog) ou vide pour le défaut",
    },
    {
      key: "module",
      label: "Cible (vide = app racine, sinon nom d'un module du projet)",
      type: "string",
      default: "",
      pattern: "^$|^[@A-Za-z][@A-Za-z0-9/_-]*$",
      patternHint: "nom d'un module du projet (dossier modules/<nom>) ou vide",
    },
  ],
};

const SERVICE_SPEC: IScaffoldTypeSpec = {
  type: "service",
  description:
    "Service injectable (@injectable) dans le projet courant (app racine ou module) — la logique métier, réutilisable par un controller, une commande CLI ou un autre module",
  questions: [
    {
      key: "name",
      label:
        "Nom du service (ex : billing ou Billing — suffixe Service ajouté)",
      type: "string",
      default: "",
      pattern: "^[A-Za-z][A-Za-z0-9-]*$",
      patternHint:
        "lettres/chiffres/tirets, commence par une lettre (ex : billing, UserBilling)",
    },
    {
      key: "description",
      label: "Description courte (TSDoc du service)",
      type: "string",
      default: "",
    },
    {
      // Le geste que le banc a mesuré ROUGE : sans exemple ACTIF, l'agent passe
      // par `container.get` partout — la dépendance n'est alors pas déclarée,
      // donc ni ordonnée par le conteneur ni visible dans la signature. Le
      // scaffold refuse un nom qu'il ne trouve pas dans la cible : mieux vaut
      // pas d'injection qu'un import vers une classe absente.
      key: "inject",
      label:
        "Injecter un service existant de la cible (nom de classe, ex : BillingService)",
      type: "string",
      default: "",
      pattern: "^$|^[A-Za-z][A-Za-z0-9-]*$",
      patternHint:
        "nom d'un service de la cible (nodefony/service/<Nom>Service.ts) ou vide",
    },
    {
      key: "module",
      label: "Cible (vide = app racine, sinon nom d'un module du projet)",
      type: "string",
      default: "",
      pattern: "^$|^[@A-Za-z][@A-Za-z0-9/_-]*$",
      patternHint: "nom d'un module du projet (dossier modules/<nom>) ou vide",
    },
  ],
};

const FRONT_SPEC: IScaffoldTypeSpec = {
  type: "front",
  description:
    "Ajoute un frontend Vite (page + entry + controller) à l'app ou à un module SANS front",
  questions: [
    {
      key: "name",
      label: "Nom de la page/entry (kebab-case, ex : dashboard)",
      type: "string",
      default: "",
      pattern: "^[A-Za-z][A-Za-z0-9-]*$",
      patternHint:
        "lettres/chiffres/tirets, commence par une lettre (ex : dashboard)",
    },
    {
      key: "frontend",
      label: "Framework frontend",
      type: "choice",
      choices: [
        {
          value: "react",
          label: "React 19",
          hint: "entry Vite + HMR fast-refresh",
        },
        { value: "vue", label: "Vue 3", hint: "SFC <script setup> + HMR" },
        {
          value: "angular",
          label: "Angular (standalone, zoneless)",
          hint: "via AnalogJS",
        },
      ],
      default: "react",
    },
    {
      key: "route",
      label: "Route de la page (vide = /<nom>)",
      type: "string",
      default: "",
      pattern: "^$|^/[A-Za-z0-9/_-]*$",
      patternHint: "chemin absolu (ex : /dashboard) ou vide pour le défaut",
    },
    {
      key: "module",
      label: "Cible (vide = app racine, sinon nom d'un module du projet)",
      type: "string",
      default: "",
      pattern: "^$|^[@A-Za-z][@A-Za-z0-9/_-]*$",
      patternHint: "nom d'un module du projet (dossier modules/<nom>) ou vide",
    },
  ],
};

/**
 * Saveurs de controller posables AVEC le module — les mêmes que `create
 * controller` (le scaffold module DÉLÈGUE, il ne duplique aucun template),
 * plus `none` pour une coquille nue.
 */
export const MODULE_CONTROLLER_CHOICES = [
  "none",
  ...CONTROLLER_KIND_CHOICES,
] as const;
export type TModuleControllerChoice =
  (typeof MODULE_CONTROLLER_CHOICES)[number];

const MODULE_SPEC: IScaffoldTypeSpec = {
  type: "module",
  description:
    "Module applicatif dans le projet courant (modules/<nom>/) — workspace npm, chargé par le manifeste",
  questions: [
    {
      key: "name",
      label: "Nom du module (kebab-case, ex : blog)",
      type: "string",
      default: "",
      pattern: "^[a-z][a-z0-9-]*$",
      patternHint:
        "kebab-case attendu — minuscules, chiffres, tirets (ex : blog, mon-module)",
    },
    {
      key: "description",
      label: "Description courte (README + docs + package.json)",
      type: "string",
      default: "",
    },
    {
      key: "controller",
      label: "Controller posé avec le module",
      type: "choice",
      choices: [
        {
          value: "hello",
          label: "HTTP + WebSocket (recommandé)",
          hint: "pour DÉCOUVRIR le pipeline partagé : GET + echo WS même classe — WS métier → --kind realtime",
        },
        {
          value: "rest",
          label: "REST resource",
          hint: "CRUD de production (list/get/create/update/delete) — HTTP pur",
        },
        {
          value: "duplex",
          label: "Duplex REST + socket",
          hint: "les MÊMES actions CRUD en HTTP ET par socket.request/mutate",
        },
        {
          value: "realtime",
          label: "Realtime (socket Nodefony)",
          hint: "canaux pub/sub + actions RPC (@nodefony/realtime)",
        },
        {
          value: "example",
          label: "Vitrine des décorateurs",
          hint: "démo pédagogique : TOUS les décorateurs commentés + curl d'essai",
        },
        {
          value: "none",
          label: "Aucun",
          hint: "coquille nue — `nodefony create controller x --module <nom>` plus tard",
        },
      ],
      default: "hello",
    },
    {
      key: "service",
      label: "Service injectable principal (la logique du module) ?",
      type: "boolean",
      default: true,
    },
    {
      key: "command",
      label: "Commande CLI (`nodefony <nom>:hello`) ?",
      type: "boolean",
      default: false,
    },
    {
      key: "frontend",
      label: "Frontend Vite du module",
      type: "choice",
      choices: [
        {
          value: "none",
          label: "Aucun",
          hint: "backend seulement (ajoutable : `nodefony create front x --module <nom>`)",
        },
        { value: "react", label: "React 19", hint: "entry Vite + HMR" },
        { value: "vue", label: "Vue 3", hint: "SFC <script setup> + HMR" },
        {
          value: "angular",
          label: "Angular (standalone, zoneless)",
          hint: "via AnalogJS",
        },
      ],
      default: "none",
    },
  ],
};

/**
 * Phases de boot proposées comme point d'exécution d'une commande.
 *
 * C'est le `kernelEvent` de `OptionsCommandInterface` — le kernel s'ARRÊTE à
 * cette phase. Trois valeurs suffisent à couvrir les usages réels ; les autres
 * phases (`onPreBoot`, `onServersReady`…) restent atteignables en éditant le
 * fichier généré, mais n'ont pas à être proposées à qui crée sa première
 * commande.
 */
export const COMMAND_PHASE_CHOICES = [
  "onReady",
  "onRegister",
  "onPostReady",
] as const;
export type TCommandPhaseChoice = (typeof COMMAND_PHASE_CHOICES)[number];

const COMMAND_SPEC: IScaffoldTypeSpec = {
  type: "command",
  description:
    "Commande CLI `nodefony <module>:<action>` dans le projet courant (app racine ou module)",
  questions: [
    {
      key: "name",
      label:
        "Action de la commande (ex : publish, user:add — le préfixe du module est ajouté)",
      type: "string",
      default: "",
      // Les sous-actions sont la convention du framework (`security:user:add`) :
      // le `:` est donc légal DANS l'action, pas seulement comme séparateur.
      pattern: "^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$",
      patternHint:
        "kebab-case, sous-actions séparées par « : » (ex : publish, user:add)",
    },
    {
      key: "description",
      label: "Description (affichée par `nodefony --help`)",
      type: "string",
      default: "",
    },
    {
      key: "phase",
      label: "Phase de boot où la commande s'exécute",
      type: "choice",
      choices: [
        {
          value: "onReady",
          label: "Services prêts, aucun serveur (recommandé)",
          hint: "lire/écrire des données, appeler un service — sans ouvrir de port",
        },
        {
          value: "onRegister",
          label: "Modules enregistrés",
          hint: "ultra-léger : les services ne sont pas encore construits",
        },
        {
          value: "onPostReady",
          label: "Serveurs HTTP/WS en écoute",
          hint: "seulement si la commande doit parler à ses propres serveurs",
        },
      ],
      default: "onReady",
    },
    {
      key: "module",
      label: "Cible (vide = app racine, sinon nom d'un module du projet)",
      type: "string",
      default: "",
      pattern: "^$|^[@A-Za-z][@A-Za-z0-9/_-]*$",
      patternHint: "nom d'un module du projet (dossier modules/<nom>) ou vide",
    },
    {
      // Jamais demandé en dialogue : c'est `create module --command` qui l'active,
      // parce que lui SAIT ce qu'il vient de générer. Demandé à la main, le
      // scaffold vérifie que la cible a bien un service appelable — plutôt que de
      // produire un appel qui ne compilerait pas.
      key: "service",
      label: "Appeler le service du module (exemple de délégation)",
      type: "boolean",
      default: false,
      advanced: true,
    },
  ],
};

/** Stratégies de clé primaire proposées par `create entity`. */
export const ENTITY_ID_CHOICES = ["uuid7", "uuid4", "serial"] as const;
export type TEntityIdChoice = (typeof ENTITY_ID_CHOICES)[number];

const ENTITY_SPEC: IScaffoldTypeSpec = {
  type: "entity",
  description:
    "Entité + schémas de validation + service CRUD + controller REST/WebSocket (dans l'app ou un module)",
  questions: [
    {
      key: "name",
      label: "Nom de l'entité (PascalCase, ex : Post)",
      type: "string",
      default: "",
      pattern: "^[A-Za-z][A-Za-z0-9]*$",
      patternHint:
        "PascalCase attendu — lettres et chiffres (ex : Post, BlogPost)",
    },
    {
      key: "fields",
      label:
        "Champs (nom:type, séparés par des espaces — ? nullable, ! unique, :index)",
      type: "string",
      default: "",
    },
    {
      key: "id",
      label: "Clé primaire",
      type: "choice",
      choices: [
        {
          value: "uuid7",
          label: "UUID v7 (recommandé)",
          hint: "ordonné dans le temps → index compact ; non énumérable",
        },
        {
          value: "uuid4",
          label: "UUID v4",
          hint: "imprévisible — quand l'identifiant ne doit rien laisser deviner",
        },
        {
          value: "serial",
          label: "Auto-incrément",
          hint: "table interne uniquement (un id exposé s'énumère)",
        },
      ],
      default: "uuid7",
    },
    {
      key: "timestamps",
      label: "Horodatages createdAt / updatedAt",
      type: "boolean",
      default: true,
    },
    {
      key: "softDelete",
      label: "Suppression douce (deletedAt)",
      type: "boolean",
      default: false,
    },
    {
      key: "controller",
      label: "Controller REST + WebSocket",
      type: "boolean",
      default: true,
    },
    {
      key: "tests",
      label: "Tests (base sqlite en mémoire)",
      type: "boolean",
      default: true,
    },
    // Réglages avancés : jamais demandés en dialogue (défauts sûrs), pilotés par les
    // options de la ligne de commande. Ils restent DANS la spec pour que Studio puisse
    // les proposer et que le moteur les valide.
    {
      key: "service",
      label: "Service CRUD",
      type: "boolean",
      default: true,
      advanced: true,
    },
    {
      key: "module",
      label: "Module cible",
      type: "string",
      default: "",
      advanced: true,
    },
    {
      key: "connector",
      label: "Connecteur ORM",
      type: "string",
      default: "default",
      advanced: true,
      // Les connecteurs sont ceux que l'application DÉCLARE : les proposer évite
      // qu'un nom inventé produise une entité rattachée à une base inexistante.
      optionsFrom: "connectors",
    },
    {
      key: "dialect",
      label: "Dialecte SQL (défaut : lu dans la config)",
      type: "string",
      default: "",
      advanced: true,
    },
    {
      key: "route",
      label: "Route REST (défaut : /api/<pluriel>)",
      type: "string",
      default: "",
      advanced: true,
    },
    // ─── Épouser un schéma qui EXISTE DÉJÀ ────────────────────────────────────
    // Les trois réglages ci-dessous ne servent qu'à cela, et c'est pourquoi ils
    // portent des défauts qui reproduisent exactement le comportement historique :
    // une entité neuve n'a aucune raison de les toucher. Une table déjà en
    // production, elle, impose ses noms — et sans eux il ne restait qu'à renommer
    // à la main (134 renommages pour le seul schéma d'Umami).
    {
      key: "table",
      label: "Nom SQL de la table (défaut : pluriel du nom de l'entité)",
      type: "string",
      default: "",
      advanced: true,
    },
    {
      key: "columnCase",
      label: "Casse des colonnes SQL",
      type: "choice",
      choices: [
        {
          value: "camel",
          label: "camelCase",
          hint: "la colonne porte le nom de la propriété (siteId)",
        },
        {
          value: "snake",
          label: "snake_case",
          hint: "convention SQL courante (site_id) — la propriété reste siteId",
        },
      ],
      default: "camel",
      advanced: true,
    },
    {
      key: "idName",
      label: "Nom SQL de la clé primaire (la propriété reste `id`)",
      type: "string",
      default: "id",
      advanced: true,
    },
    {
      key: "index",
      label:
        'Index de table, colonnes séparées par des virgules (ex. "siteId,createdAt")',
      type: "list",
      default: [],
      advanced: true,
    },
    {
      key: "uniqueIndex",
      label:
        'Contrainte d\'unicité sur plusieurs colonnes (ex. "siteId,visitId")',
      type: "list",
      default: [],
      advanced: true,
    },
  ],
};

const SPECS: Record<string, IScaffoldTypeSpec> = {
  app: APP_SPEC,
  module: MODULE_SPEC,
  controller: CONTROLLER_SPEC,
  service: SERVICE_SPEC,
  front: FRONT_SPEC,
  entity: ENTITY_SPEC,
  command: COMMAND_SPEC,
};

/**
 * La spec complète du scaffold — contrat des trois fronts (CLI rapide,
 * CLI interactif, Studio). Structure 100 % sérialisable en JSON.
 */
export function getScaffoldSpec(type?: string): IScaffoldTypeSpec[] {
  if (type) {
    const spec = SPECS[type];
    return spec ? [spec] : [];
  }
  return Object.values(SPECS);
}
