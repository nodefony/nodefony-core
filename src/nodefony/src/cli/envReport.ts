import {
  closestMatch,
  parseNfEnvOverrides,
  pathLooksSecret,
} from "../config/envOverride";
import type { NamedEnvVarMeta } from "../config/defineEnv";
import { isReservedEnv, reservedEnvRole } from "../config/reservedEnv";

/**
 * Calcul PUR du rapport d'environnement — aucune I/O, aucun `process.env` lu ici.
 *
 * Pourquoi ce module existe séparé de la commande : la question « d'où vient
 * cette valeur ? » ne se répond bien qu'en confrontant la cascade des fichiers à
 * l'environnement réel, et cette confrontation doit être TESTABLE sans écrire un
 * seul fichier sur disque. L'adaptateur (`cli/env.ts`) lit ; ce module conclut.
 *
 * Le calcul ne demande AUCUNE instrumentation de `loadEnv` : au moment où la
 * commande s'exécute, `process.env` est déjà peuplé et l'on a perdu la trace de
 * qui a posé quoi. On la reconstruit — pour chaque variable, le premier fichier
 * de la cascade qui la définit avec la valeur effective EST son origine ; si
 * aucun ne la définit ainsi, elle vient du shell, qui gagne toujours.
 */

/** Un niveau de la cascade — `process.env` ou un fichier `.env*`. */
export interface IEnvLevel {
  /** 1 = le plus prioritaire. */
  rank: number;
  /** `process.env` ou le nom du fichier (`.env.local`…). */
  source: string;
  /** Le niveau existe-t-il (fichier présent) ? */
  exists: boolean;
  /** Nombre de variables qu'il définit. */
  count: number;
  /** Pourquoi ce niveau ne s'applique pas (ex. environnement de déploiement non défini). */
  skipped?: string;
}

/** Une variable, telle que le rapport la restitue. */
export interface IEnvVarReport {
  name: string;
  /** Nature déclarée, ou `unknown` pour une variable présente hors catalogue. */
  kind: string;
  /** Déclarée par `env.ts` (catalogue `defineEnv`) ? */
  declared: boolean;
  /** Doit être présente (pas de défaut, non optionnelle). */
  required: boolean;
  /** Nom sensible → la valeur n'est jamais rendue. */
  secret: boolean;
  description?: string;
  /** Valeur effective, masquée si `secret`. `null` = absente. */
  value: string | null;
  /** D'où vient la valeur effective. `null` si absente. */
  origin: string | null;
  /** Défaut déclaré (si la variable est absente, c'est lui qui s'appliquera). */
  default?: unknown;
  /** Valeurs permises (énumération). */
  values?: readonly string[];
  /** Requise ET absente : l'application ne démarrera pas. */
  missing: boolean;
  /** Niveaux qui la définissent mais sont MASQUÉS par l'origine gagnante. */
  shadowed: { source: string; value: string }[];
}

/** Une surcharge directe de configuration de module (`NF__<MODULE>__<CHEMIN>`). */
export interface IEnvOverrideReport {
  envKey: string;
  module: string;
  path: string[];
  /** Masquée si le chemin porte un secret. */
  value: string;
  origin: string | null;
}

/** Rapport complet — la forme rendue par `--json`. */
export interface IEnvReport {
  /** Mode runtime (`NODE_ENV`). */
  runtimeEnv: string;
  /** Environnement de déploiement (`APP_ENV`/`NF_ENV`), s'il diffère. */
  appEnv: string | null;
  /** La cascade, du plus fort au plus faible. */
  levels: IEnvLevel[];
  /** Variables déclarées par l'application. */
  vars: IEnvVarReport[];
  /** Surcharges `NF__…` de configuration de module. */
  overrides: IEnvOverrideReport[];
  /** Variables présentes mais inconnues du catalogue (fautes de frappe probables). */
  unknown: { name: string; origin: string | null; suggestion?: string }[];
  /**
   * Variables posées par le FRAMEWORK lui-même (lanceur, mode de démarrage,
   * grappe, jeton MCP). Elles ne relèvent pas de la configuration de
   * l'application : les compter parmi les inconnues accusait l'utilisateur
   * d'une faute de frappe qu'il n'avait pas commise.
   */
  reserved: { name: string; origin: string | null; role: string }[];
  /** Le catalogue de l'application a-t-il pu être lu ? */
  catalogAvailable: boolean;
  /** Ce que le rapport n'a pas pu établir, et pourquoi. */
  notes: string[];
}

/** Un niveau de fichier tel que l'adaptateur le fournit (`vars: null` = absent). */
export interface IEnvFileInput {
  source: string;
  vars: Record<string, string> | null;
  skipped?: string;
}

/** Masque une valeur sensible sans mentir sur sa présence. */
function mask(value: string): string {
  return value === "" ? "(vide)" : `${"•".repeat(8)} (${value.length} car.)`;
}

/**
 * Variables présentes dans l'env mais qu'aucune déclaration n'explique.
 *
 * Restreint au préfixe `NF_` : le reste de `process.env` appartient au système
 * (PATH, HOME, les mille variables d'un shell) et le lister noierait le signal.
 * Une variable `NF_` inconnue, elle, est presque toujours une faute de frappe —
 * et une faute de frappe sur une variable d'environnement ne se voit JAMAIS :
 * la valeur est simplement ignorée, et le défaut s'applique en silence.
 */
function collectUnknown(
  processEnv: Record<string, string | undefined>,
  declared: Set<string>,
  originOf: (name: string) => string | null,
): IEnvReport["unknown"] {
  const known = [...declared];
  const out: IEnvReport["unknown"] = [];
  for (const name of Object.keys(processEnv)) {
    if (!name.startsWith("NF_") || name.startsWith("NF__")) continue;
    if (declared.has(name)) continue;
    // Posée par le framework, pas par l'utilisateur : elle a sa propre section.
    if (isReservedEnv(name)) continue;
    // `<KEY>_FILE` est une convention du framework (secret monté par Docker ou
    // Kubernetes) : c'est la variable de BASE qui doit être déclarée, pas elle.
    if (name.endsWith("_FILE") && declared.has(name.slice(0, -5))) continue;
    const suggestion = closestMatch(name, known);
    out.push({
      name,
      origin: originOf(name),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Les variables que le FRAMEWORK a posées lui-même dans l'environnement.
 *
 * Elles sont RENDUES, pas tues : une variable présente que le rapport passe
 * sous silence est le même défaut vu de l'autre côté — l'utilisateur cherche
 * alors pourquoi son environnement ne ressemble pas à ce qu'on lui montre.
 */
function collectReserved(
  processEnv: Record<string, string | undefined>,
  originOf: (name: string) => string | null,
): IEnvReport["reserved"] {
  const out: IEnvReport["reserved"] = [];
  for (const name of Object.keys(processEnv)) {
    const role = reservedEnvRole(name);
    if (role === null) continue;
    out.push({ name, origin: originOf(name), role });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Construit le rapport d'environnement.
 *
 * @param input.runtimeEnv - mode runtime (`NODE_ENV`).
 * @param input.appEnv - environnement de déploiement, s'il diffère du mode.
 * @param input.processEnv - l'environnement effectif, cascade déjà appliquée.
 * @param input.files - les niveaux de fichiers, du PLUS fort au PLUS faible.
 * @param input.catalog - les variables déclarées par l'app, ou `null` si illisible.
 * @returns le rapport, sérialisable tel quel.
 */
export function buildEnvReport(input: {
  runtimeEnv: string;
  appEnv?: string | null;
  processEnv: Record<string, string | undefined>;
  files: IEnvFileInput[];
  catalog: readonly NamedEnvVarMeta[] | null;
}): IEnvReport {
  const { runtimeEnv, processEnv, files, catalog } = input;
  const appEnv = input.appEnv ?? null;

  /**
   * Origine d'une clé : le premier fichier de la cascade qui la définit AVEC la
   * valeur effective. Aucun ne correspond → le shell l'a posée (ou l'a écrasée,
   * puisqu'il gagne toujours).
   */
  const originOf = (name: string): string | null => {
    const effective = processEnv[name];
    if (effective === undefined) return null;
    for (const level of files) {
      if (level.vars && level.vars[name] === effective) return level.source;
    }
    return "process.env";
  };

  /** Niveaux qui définissent la clé sans être son origine — donc ignorés. */
  const shadowsOf = (
    name: string,
    winner: string | null,
  ): { source: string; value: string }[] => {
    const out: { source: string; value: string }[] = [];
    let passedWinner = winner === "process.env";
    for (const level of files) {
      if (!level.vars || level.vars[name] === undefined) continue;
      if (!passedWinner && level.source === winner) {
        passedWinner = true;
        continue;
      }
      if (passedWinner)
        out.push({ source: level.source, value: level.vars[name] });
    }
    return out;
  };

  const levels: IEnvLevel[] = [
    {
      rank: 1,
      source: "process.env",
      exists: true,
      count: Object.keys(processEnv).length,
    },
    // oxlint-disable-next-line no-map-spread -- l'objet est CONSTRUIT champ par champ ; le seul spread est le littéral conditionnel, forme imposée par `exactOptionalPropertyTypes` pour ne pas poser une clé à `undefined`
    ...files.map((f, i) => ({
      rank: i + 2,
      source: f.source,
      exists: f.vars !== null,
      count: f.vars ? Object.keys(f.vars).length : 0,
      ...(f.skipped ? { skipped: f.skipped } : {}),
    })),
  ];

  const declared = new Set((catalog ?? []).map((v) => v.name));
  // oxlint-disable-next-line no-map-spread -- projection EXPLICITE champ par champ ; les seuls spreads sont des littéraux conditionnels (description, défaut, valeurs admises), forme imposée par `exactOptionalPropertyTypes`
  const vars: IEnvVarReport[] = (catalog ?? []).map((meta) => {
    const raw = processEnv[meta.name];
    const secret = pathLooksSecret([meta.name]);
    const origin = originOf(meta.name);
    const required = !meta.optional && meta.default === undefined;
    return {
      name: meta.name,
      kind: meta.kind,
      declared: true,
      required,
      secret,
      ...(meta.description ? { description: meta.description } : {}),
      value: raw === undefined ? null : secret ? mask(raw) : raw,
      origin,
      ...(meta.default !== undefined ? { default: meta.default } : {}),
      ...(meta.values ? { values: meta.values } : {}),
      missing: required && raw === undefined,
      shadowed: shadowsOf(meta.name, origin),
    };
  });

  const overrides: IEnvOverrideReport[] = parseNfEnvOverrides(
    processEnv as NodeJS.ProcessEnv,
  ).map((o) => ({
    envKey: o.envKey,
    module: o.moduleSeg,
    path: o.path,
    value: pathLooksSecret(o.path)
      ? mask(String(processEnv[o.envKey] ?? ""))
      : String(processEnv[o.envKey] ?? ""),
    origin: originOf(o.envKey),
  }));

  const notes: string[] = [];
  if (catalog === null) {
    notes.push(
      "catalogue des variables illisible — l'application n'est pas construite (`npm run build`) " +
        "ou n'exporte pas `env` : la cascade ci-dessus reste exacte, la liste des variables déclarées manque",
    );
  }

  return {
    runtimeEnv,
    appEnv,
    levels,
    vars,
    overrides,
    unknown: collectUnknown(processEnv, declared, originOf),
    reserved: collectReserved(processEnv, originOf),
    catalogAvailable: catalog !== null,
    notes,
  };
}
