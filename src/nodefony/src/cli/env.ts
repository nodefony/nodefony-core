import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { envFileOrder } from "../runtime/loadEnv";
import { getEnvCatalog, type NamedEnvVarMeta } from "../config/defineEnv";
import {
  buildEnvReport,
  type IEnvFileInput,
  type IEnvReport,
  type IEnvVarReport,
} from "./envReport";

/**
 * `nodefony env [--json]` — dit TOUT de l'environnement d'une application :
 * quels fichiers sont lus et dans quel ordre, quelles variables sont déclarées,
 * quelle valeur est effective, d'OÙ elle vient, et ce qui est ignoré.
 *
 * Pourquoi une commande à part, et non un sujet d'`inspect` : `inspect`
 * interroge une application BOOTÉE (routes, services, configuration résolue).
 * Or on cherche une variable d'environnement précisément quand l'application
 * NE démarre pas — variable requise manquante, valeur qui ne prend pas, fichier
 * qu'on croit lu. Cette commande est donc standalone, comme `status` et `check` :
 * elle ne lit que des fichiers, et répond même sur une application cassée.
 *
 * Ce qu'elle répare : la cascade `loadEnv` est correcte mais INVISIBLE — elle
 * n'était écrite que dans un commentaire du framework. Un agent, comme un
 * humain, ne pouvait que la deviner, et deviner produit toujours la même erreur :
 * poser la variable dans un fichier de rang inférieur à celui qui la définit
 * déjà, puis conclure que « ça ne marche pas ».
 */

/** Ce que la ligne de commande demande. */
interface IEnvRequest {
  json: boolean;
  /** Racine de recherche (défaut : le cwd). */
  cwd: string;
}

/** Parse l'argv après le mot `env`. */
export function parseEnvArgv(argv: string[]): IEnvRequest | { error: string } {
  const at = argv.indexOf("env");
  const rest = at === -1 ? [] : argv.slice(at + 1);
  let json = false;
  let cwd = process.cwd();
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--json" || word === "-j") {
      json = true;
    } else if (word === "--cwd") {
      cwd = path.resolve(rest[++i] ?? "");
    } else {
      return { error: `option inconnue : ${word}` };
    }
  }
  return { json, cwd };
}

const USAGE =
  `usage : nodefony env [--json] [--cwd <path>]\n` +
  `  Montre la cascade des fichiers .env, les variables déclarées par l'app,\n` +
  `  la valeur effective de chacune et SA PROVENANCE, puis ce qui est ignoré.\n`;

/**
 * Lit les niveaux de fichiers de la cascade — l'ORDRE vient de `envFileOrder`,
 * jamais d'une copie locale : afficher un ordre qui différerait de celui
 * réellement appliqué tromperait sur le seul point qu'on vient vérifier.
 */
function readLevels(
  cwd: string,
  runtimeEnv: string,
  appEnv: string | null,
): IEnvFileInput[] {
  const wanted = envFileOrder({
    runtimeEnv,
    ...(appEnv ? { appEnv } : {}),
  });
  return wanted.map((source) => {
    try {
      return {
        source,
        vars: parseEnv(readFileSync(path.join(cwd, source), "utf8")) as Record<
          string,
          string
        >,
      };
    } catch {
      return { source, vars: null };
    }
  });
}

/**
 * Catalogue des variables déclarées par l'application.
 *
 * Il vit dans `env.ts`, réexporté par l'`index.ts` de l'app — donc lisible en
 * important son build. Pas de build, pas d'export `env` : on rend `null` plutôt
 * que d'échouer, et le rapport le DIT. Une commande de diagnostic qui refuse de
 * répondre quand le projet va mal est une commande inutile.
 */
async function readCatalog(
  projectRoot: string,
): Promise<readonly NamedEnvVarMeta[] | null> {
  try {
    const entry = pathToFileURL(
      path.join(projectRoot, "dist", "index.js"),
    ).href;
    const mod = (await import(entry)) as { env?: unknown };
    if (mod.env === undefined) return null;
    const catalog = getEnvCatalog(mod.env);
    return catalog.length > 0 ? catalog : null;
  } catch {
    return null;
  }
}

/** Colonne alignée, sans dépendance de mise en forme. */
const pad = (s: string, n: number): string =>
  s.length >= n ? s : s + " ".repeat(n - s.length);

/** Rend une variable : valeur, provenance, et ce qui la rend suspecte. */
function renderVar(v: IEnvVarReport): string {
  const value = v.value === null ? "(absente)" : v.value;
  const origin = v.origin === null ? "" : `← ${v.origin}`;
  const flags: string[] = [];
  if (v.missing) flags.push("REQUISE ET ABSENTE");
  if (v.value === null && v.default !== undefined) {
    flags.push(`défaut ${JSON.stringify(v.default)}`);
  }
  if (v.secret) flags.push("secret");
  if (v.values) flags.push(v.values.join("|"));
  for (const s of v.shadowed) flags.push(`ignoré dans ${s.source}`);
  return (
    `  ${pad(v.name, 24)} ${pad(v.kind, 8)} ${pad(value, 24)} ${pad(origin, 22)}` +
    (flags.length ? `  ${flags.join(" · ")}` : "")
  ).trimEnd();
}

/** Rendu humain — l'ordre des sections suit l'ordre des questions qu'on se pose. */
function render(report: IEnvReport, projectRoot: string | null): string {
  const out: string[] = [];
  out.push(
    `\nEnvironnement — mode ${report.runtimeEnv}` +
      (report.appEnv ? ` · déploiement ${report.appEnv}` : "") +
      (projectRoot ? `\n${projectRoot}` : ""),
  );
  out.push(`\nCascade — du plus FORT au plus faible (le premier posé gagne)`);
  for (const l of report.levels) {
    const state = !l.exists
      ? "absent"
      : `${l.count} variable${l.count > 1 ? "s" : ""}`;
    out.push(
      (
        `  ${l.rank}. ${pad(l.source, 28)} ${pad(state, 16)}` +
        (l.rank === 1 ? "  ← shell / orchestrateur : gagne TOUJOURS" : "") +
        (l.skipped ? `  (${l.skipped})` : "")
      ).trimEnd(),
    );
  }
  if (report.vars.length > 0) {
    out.push(`\nVariables déclarées par l'application (env.ts)`);
    for (const v of report.vars) out.push(renderVar(v));
  }
  if (report.overrides.length > 0) {
    out.push(
      `\nSurcharges de configuration (NF__<MODULE>__<CHEMIN>) — visent une clé de module,` +
        `\nsans passer par env.ts`,
    );
    for (const o of report.overrides) {
      out.push(
        `  ${pad(o.envKey, 34)} → ${o.module}.${o.path.join(".")} = ${o.value}` +
          (o.origin ? `  ← ${o.origin}` : ""),
      );
    }
  }
  if (report.unknown.length > 0) {
    out.push(
      `\nVariables NF_ présentes mais NON déclarées — sans effet (une faute de frappe` +
        `\nsur une variable ne se voit jamais : le défaut s'applique en silence)`,
    );
    for (const u of report.unknown) {
      out.push(
        `  ${pad(u.name, 34)}${u.origin ? `← ${pad(u.origin, 20)}` : ""}` +
          (u.suggestion ? `  vouliez-vous dire ${u.suggestion} ?` : ""),
      );
    }
  }
  const missing = report.vars.filter((v) => v.missing);
  if (missing.length > 0) {
    out.push(
      `\n⚠ ${missing.length} variable(s) REQUISE(S) manquante(s) — l'application ne démarrera pas :` +
        `\n  ${missing.map((v) => v.name).join(", ")}`,
    );
  }
  for (const note of report.notes) out.push(`\n⚠ ${note}`);
  out.push("");
  return out.join("\n");
}

/**
 * Commande `nodefony env` — orchestre : résout le projet, lit la cascade et le
 * catalogue, délègue le calcul au module pur, rend.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CONFIG` si une requise manque)
 */
/**
 * Compose le rapport d'environnement d'un projet — la MÊME donnée pour tous ses
 * lecteurs.
 *
 * Extraite de {@link runEnvCommand} pour que `nodefony check` puisse dire « il
 * manque une variable REQUISE » sans réimplémenter la cascade : deux définitions
 * de « quelle valeur est effective » divergeraient, et chacune passerait ses
 * propres tests. Le second lecteur ne rend d'ailleurs pas le rapport, il n'en
 * lit que les manquantes — raison de plus pour qu'il ne le RECALCULE pas.
 *
 * @param projectRoot - racine de l'application, ou `null` hors projet (le
 *   catalogue des variables déclarées est alors inconnu : il se lit dans le
 *   `dist/` de l'application).
 * @param cwd - dossier de départ, utilisé comme racine hors projet.
 * @returns le rapport complet (fichiers lus, variables, provenance, notes).
 */
export async function buildProjectEnvReport(
  projectRoot: string | null,
  cwd: string,
): Promise<IEnvReport> {
  const runtimeEnv = process.env.NODE_ENV ?? "development";
  const rawAppEnv = process.env.APP_ENV ?? process.env.NODEFONY_ENV ?? null;
  const appEnv = rawAppEnv && rawAppEnv !== runtimeEnv ? rawAppEnv : null;
  const root = projectRoot ?? cwd;
  return buildEnvReport({
    runtimeEnv,
    appEnv,
    processEnv: process.env,
    files: readLevels(root, runtimeEnv, appEnv),
    catalog: projectRoot ? await readCatalog(projectRoot) : null,
  });
}

export async function runEnvCommand(argv: string[]): Promise<number> {
  const parsed = parseEnvArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`env: ${parsed.error}\n${USAGE}`);
    return SysExit.USAGE;
  }
  const projectRoot = findProjectRoot(parsed.cwd);
  const report = await buildProjectEnvReport(projectRoot, parsed.cwd);
  if (projectRoot === null) {
    report.notes.push(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "seul l'environnement du shell est décrit",
    );
  }
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : render(report, projectRoot),
  );
  // Une variable requise absente n'est pas un avis : l'application ne démarrera
  // pas. Le code de sortie le dit, pour qu'un script s'arrête là.
  return report.vars.some((v) => v.missing) ? SysExit.CONFIG : SysExit.OK;
}
