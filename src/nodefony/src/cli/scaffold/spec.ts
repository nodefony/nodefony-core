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

const SPECS: Record<string, IScaffoldTypeSpec> = { app: APP_SPEC };

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
