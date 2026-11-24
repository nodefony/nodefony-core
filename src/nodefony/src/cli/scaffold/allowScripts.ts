/**
 * Le bloc `allowScripts` du `package.json` d'une application npm : les paquets
 * dont le gabarit tranche les scripts d'installation, et la valeur qu'il pose.
 *
 * Une règle, deux lecteurs : `create app` la rend dans le gabarit
 * (`templates/app/base/package.json.tpl`), `nodefony upgrade` y complète une
 * application née avant qu'une entrée existe. Recopiée de part et d'autre,
 * la liste divergerait au premier ajout — et l'avertissement d'npm resterait
 * pour toujours sur les applications anciennes.
 *
 * npm seul lit ce champ : pnpm, yarn et bun ont leur propre mécanisme, et le
 * gabarit ne le rend que pour npm.
 */
import { isPlainObject } from "../../runtime/isPlainObject";

/** Une entrée du bloc `allowScripts`. */
export interface IAllowScriptEntry {
  /** Nom npm du paquet. */
  readonly name: string;
  /** `true` : ses scripts d'installation tournent ; `false` : bloqués sans avertissement. */
  readonly allow: boolean;
}

/** Une entrée du gabarit, et la condition qui la fait déclarer. */
interface IAllowScriptRule extends IAllowScriptEntry {
  /**
   * `true` : déclarée seulement si l'application déclare le paquet lui-même ;
   * `false` : toujours (dépendance transitive de l'outillage du gabarit).
   */
  readonly whenDeclared: boolean;
}

/**
 * Les entrées du gabarit, dans l'ordre du rendu.
 *
 * `esbuild` arrive par `drizzle-kit` et `vite`, `fsevents` par l'outillage de
 * surveillance de fichiers sous macOS : aucun des deux n'a besoin de ses
 * scripts, et npm avertit à chaque installation tant qu'ils ne sont pas
 * tranchés.
 */
const APP_ALLOW_SCRIPTS: readonly IAllowScriptRule[] = [
  { name: "better-sqlite3", allow: false, whenDeclared: true },
  { name: "esbuild", allow: false, whenDeclared: false },
  { name: "fsevents", allow: false, whenDeclared: false },
];

/** Les blocs où l'application déclare ce qu'elle installe. */
const DECLARED_BLOCKS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

/**
 * Les entrées `allowScripts` que le gabarit déclare pour une application.
 *
 * @param declares - l'application déclare-t-elle ce paquet (dépendance de
 *   n'importe quel bloc) ?
 * @returns les entrées, dans l'ordre du gabarit.
 */
export function appAllowScripts(
  declares: (name: string) => boolean,
): IAllowScriptEntry[] {
  const entries: IAllowScriptEntry[] = [];
  for (const rule of APP_ALLOW_SCRIPTS) {
    if (rule.whenDeclared && !declares(rule.name)) continue;
    entries.push({ name: rule.name, allow: rule.allow });
  }
  return entries;
}

/**
 * Le manifeste déclare-t-il ce paquet, dans un de ses blocs de dépendances ?
 *
 * @param data - contenu parsé du `package.json`.
 * @param name - nom npm du paquet.
 */
function manifestDeclares(
  data: Record<string, unknown>,
  name: string,
): boolean {
  return DECLARED_BLOCKS.some((block) => {
    const record = data[block];
    return isPlainObject(record) && Object.hasOwn(record, name);
  });
}

/**
 * Les entrées du gabarit absentes du bloc `allowScripts` d'une application —
 * ajoutées en place si `apply`.
 *
 * Une entrée PRÉSENTE n'est jamais modifiée, quelle que soit sa valeur : c'est
 * la décision de l'application. Un bloc absent est créé juste avant `scripts`,
 * à la place où le gabarit le rend ; un bloc qui n'est pas un objet n'est pas
 * touché (rien n'est rendu) — l'écraser détruirait ce que l'application y a mis.
 *
 * @param data - contenu parsé du `package.json`, réécrit en place si `apply`.
 * @param apply - `true` : écrire les entrées manquantes dans `data`.
 * @returns les entrées manquantes (ou ajoutées), dans l'ordre du gabarit.
 */
export function missingAllowScripts(
  data: Record<string, unknown>,
  apply: boolean,
): IAllowScriptEntry[] {
  const current = data.allowScripts;
  let declared: Record<string, unknown> | null = null;
  if (current !== undefined) {
    if (!isPlainObject(current)) return [];
    declared = current;
  }
  const missing = appAllowScripts((name) =>
    manifestDeclares(data, name),
  ).filter(
    (entry) => declared === null || !Object.hasOwn(declared, entry.name),
  );
  if (!apply || missing.length === 0) return missing;
  const block = declared ?? {};
  for (const entry of missing) block[entry.name] = entry.allow;
  if (declared === null) insertBeforeScripts(data, block);
  return missing;
}

/**
 * Pose `allowScripts` juste avant `scripts` — en fin de manifeste s'il n'y a
 * pas de `scripts`. L'ordre des clés d'un objet JavaScript est celui de leur
 * insertion : on réinsère donc celles qui suivent.
 */
function insertBeforeScripts(
  data: Record<string, unknown>,
  block: Record<string, unknown>,
): void {
  const keys = Object.keys(data);
  const at = keys.indexOf("scripts");
  if (at === -1) {
    data.allowScripts = block;
    return;
  }
  const tail = keys.slice(at);
  const moved = tail.map((key) => [key, data[key]] as const);
  for (const key of tail) Reflect.deleteProperty(data, key);
  data.allowScripts = block;
  for (const [key, value] of moved) data[key] = value;
}
