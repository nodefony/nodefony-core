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
  type: "string" | "boolean" | "choice";
  /** Choix ordonnés (type "choice") — le premier N'est PAS forcément le défaut. */
  choices?: { value: string; label: string; hint?: string }[];
  default: string | boolean;
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
export const CONTROLLER_KIND_CHOICES = ["hello", "realtime", "rest"] as const;
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
          hint: "GET JSON + echo WS dans la MÊME classe — le différenciateur Nodefony",
        },
        {
          value: "realtime",
          label: "Realtime (socket Nodefony)",
          hint: "canaux pub/sub + actions RPC via RealtimeController (@nodefony/realtime)",
        },
        {
          value: "rest",
          label: "REST resource",
          hint: "squelette CRUD (list/get/create/update/delete) + echo WS",
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

const SPECS: Record<string, IScaffoldTypeSpec> = {
  app: APP_SPEC,
  controller: CONTROLLER_SPEC,
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
