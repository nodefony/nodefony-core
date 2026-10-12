import { BootConfigurationError } from "../kernel/BootConfigurationError";
import { isSensitiveEnvVar, resolveFileEnv } from "./defineEnv";
import { flattenConfigSchema } from "./schemaCatalog";
import { applyResolvedPath, coerceEnvValue } from "./envOverride";

/**
 * Les raccourcis d'environnement d'un module, lus dans le JSON Schema de sa
 * configuration — `host: z.string().meta({ env: "NF_REDIS_HOST" })` y devient
 * `"env": "NF_REDIS_HOST"` sur le nœud du champ.
 *
 * ## Pourquoi
 *
 * Un module lisait ses variables à la main dans son builder
 * (`if (env.NF_REDIS_HOST) config.….host = …`), et le cœur en recopiait la liste
 * pour que `nodefony env` ne les déclare pas « sans effet ». Trois écritures
 * d'un même nom, que rien ne confrontait : l'oubli de la troisième faisait
 * mentir le rapport. Ici le nom vit sur le champ qu'il règle ; le Kernel
 * (application), `nodefony env` (rapport) et `.env.example` (notice) le LISENT.
 *
 * Le cœur n'importe pas zod : la lecture ne navigue que le JSON Schema que
 * chaque module publie — `Module.configSchema()` au démarrage, et sans
 * démarrer le fichier que son `package.json` déclare (`nodefony.configSchema`).
 */

/** Un raccourci déclaré sur un champ de configuration. */
export interface IEnvShortcut {
  /** Nom de la variable (`NF_REDIS_HOST`). */
  env: string;
  /** Chemin du champ dans la configuration du module. */
  path: string[];
  /** Type JSON Schema du champ (`string`, `integer`, `boolean`), `enum` pour une énumération. */
  kind: string;
  /** La description du champ (`.describe()`), si le schéma en porte une. */
  description?: string;
  /** Défaut du schéma, s'il en porte un. */
  default?: unknown;
  /** Valeurs admises (énumération). */
  values?: readonly string[];
  /** La valeur ne doit jamais être rendue en clair. */
  secret: boolean;
}

/**
 * Les raccourcis d'environnement que déclare un JSON Schema de configuration.
 *
 * Un FILTRE sur {@link flattenConfigSchema}, jamais un second parcours : le
 * catalogue des réglages et celui des raccourcis ne peuvent pas diverger sur ce
 * qu'est une feuille. Conséquence voulue : un `env` posé sur une SECTION (un
 * objet) n'est pas un raccourci — une variable porte une valeur, pas un
 * sous-arbre.
 *
 * Secret : le schéma DÉCIDE (`.meta({ secret })`, y compris `false`), le nom
 * supplée — la règle unique de {@link isSensitiveEnvVar}.
 *
 * @param schema - le JSON Schema du module (`Module.configSchema()`), ou `null`.
 * @returns un raccourci par champ portant `env`, dans l'ordre du schéma.
 */
export function collectEnvShortcuts(schema: unknown): IEnvShortcut[] {
  const out: IEnvShortcut[] = [];
  for (const leaf of flattenConfigSchema(schema)) {
    if (leaf.env === undefined) continue;
    out.push({
      env: leaf.env,
      path: leaf.path,
      kind: leaf.values ? "enum" : leaf.type,
      ...(leaf.description ? { description: leaf.description } : {}),
      ...(leaf.default !== undefined ? { default: leaf.default } : {}),
      ...(leaf.values ? { values: leaf.values } : {}),
      secret: isSensitiveEnvVar({ name: leaf.env, sensitive: leaf.secret }),
    });
  }
  return out;
}

/** Un raccourci appliqué, pour le journal du démarrage. */
export interface IAppliedEnvShortcut {
  env: string;
  path: string[];
  secret: boolean;
}

/**
 * Pose sur les options d'un module la valeur de chaque raccourci présent dans
 * l'environnement — AVANT la validation Zod du module, qui reste seule juge :
 * une valeur fausse y est refusée et arrête le démarrage.
 *
 * Même pose que la surcharge `NF__<MODULE>__<CHEMIN>` (`applyResolvedPath`,
 * conversion guidée par le type déclaré) : un raccourci n'est qu'un nom court
 * pour ce chemin. Une variable VIDE vaut absente (la ligne `NF_X=` d'un `.env`).
 *
 * Un secret se monte aussi en FICHIER (`NF_REDIS_PASSWORD_FILE=/run/secrets/x`,
 * Docker, Kubernetes) : même résolveur que les variables de l'application
 * (`resolveFileEnv`), donc mêmes refus — les deux posées, ou fichier illisible.
 *
 * @param options - les options du module, mutées en place.
 * @param schema - son JSON Schema (`Module.configSchema()`), ou `undefined`.
 * @param env - l'environnement à lire (injecté).
 * @returns les raccourcis effectivement posés, dans l'ordre du schéma.
 * @throws BootConfigurationError si `X` et `X_FILE` sont posées ensemble, ou
 *   si le fichier est illisible — un secret attendu qui manque ne se remplace
 *   pas par un défaut.
 */
export function applyEnvShortcuts(
  options: Record<string, unknown>,
  schema: unknown,
  env: Record<string, string | undefined>,
): IAppliedEnvShortcut[] {
  const applied: IAppliedEnvShortcut[] = [];
  for (const s of collectEnvShortcuts(schema)) {
    let raw: string | undefined;
    try {
      raw = resolveFileEnv(s.env, env);
    } catch (e) {
      throw new BootConfigurationError(
        e instanceof Error ? e.message : String(e),
        { cause: e },
      );
    }
    if (raw === undefined || raw === "") continue;
    if (applyResolvedPath(options, s.path, coerceEnvValue(raw), raw, schema)) {
      const fromFile =
        env[`${s.env}_FILE`] !== undefined && env[`${s.env}_FILE`] !== "";
      applied.push({
        env: fromFile ? `${s.env}_FILE` : s.env,
        path: s.path,
        secret: s.secret,
      });
    }
  }
  return applied;
}
