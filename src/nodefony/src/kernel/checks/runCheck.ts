/**
 * Exécution STANDALONE de `nodefony check` — zéro boot, zéro Kernel.
 *
 * Ce contrôle ne lit que des fichiers : des `package.json` et des sources. Le
 * faire passer par un boot d'application coûtait un démarrage complet (modules
 * instanciés, environnement résolu, journal du Kernel par-dessus le rapport)
 * pour une réponse qui n'en dépend pas — et rendait la commande inutilisable là
 * où elle sert le plus : hors d'une application, ou sur une application qui ne
 * démarre justement plus.
 *
 * Même famille que `status`, `stop`, `create` et `--version`.
 */
import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import { checkPackageDeps } from "./packageDeps";
import clc from "../../colors";

/** Dispositions explorées : une application (`modules/`) et ce dépôt. */
const CANDIDATE_ROOTS = [
  ".",
  "modules",
  "src/modules",
  "src/packages/@nodefony",
  "src/nodefony",
];

/**
 * Exceptions déclarées par le projet dans son `package.json` :
 *
 * ```json
 * "nodefony": { "check": { "typeCycles": {…}, "typesUnreachable": [...] } }
 * ```
 *
 * Sans cette porte, un projet portant un cycle de types légitime ne peut jamais
 * être vert — et un contrôle qu'on ne peut pas satisfaire est un contrôle qu'on
 * apprend à ignorer.
 */
function readExceptions(cwd: string): {
  typeCycles?: Record<string, string[]>;
  typesUnreachable?: string[];
} {
  try {
    const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
    const check = (JSON.parse(raw) as { nodefony?: { check?: unknown } })
      .nodefony?.check;
    return (check ?? {}) as {
      typeCycles?: Record<string, string[]>;
      typesUnreachable?: string[];
    };
  } catch {
    return {};
  }
}

/**
 * Lance le contrôle et écrit le rapport.
 *
 * @param argv - ligne de commande complète (seul `--json` est lu).
 * @returns le code de sortie : 0 si rien à signaler, 1 sinon.
 */
export function runCheckCommand(argv: string[]): number {
  const cwd = process.cwd();
  const json = argv.includes("--json");
  const roots = CANDIDATE_ROOTS.map((r) => path.join(cwd, r)).filter((r) =>
    statSync(r, { throwIfNoEntry: false }),
  );
  const { typeCycles, typesUnreachable } = readExceptions(cwd);
  const { findings, scanned } = checkPackageDeps({
    roots,
    cwd,
    typeCycles,
    typesUnreachable,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify({ scanned, findings }, null, 2)}\n`);
    return findings.length > 0 ? 1 : 0;
  }

  if (findings.length === 0) {
    const exceptions =
      Object.values(typeCycles ?? {}).flat().length +
      (typesUnreachable?.length ?? 0);
    process.stdout.write(
      clc.green(
        `✓ ${scanned} paquet(s) — rien à signaler` +
          (exceptions > 0 ? ` (${exceptions} exception(s) déclarée(s))` : "") +
          ".\n",
      ),
    );
    return 0;
  }

  for (const f of findings) {
    process.stdout.write(clc.red(`✗ ${f.message}\n`));
    if (f.file) {
      process.stdout.write(`  premier usage : ${f.file}\n`);
    }
  }
  process.stdout.write(
    clc.red(`\n${findings.length} manquement(s) sur ${scanned} paquet(s).\n`),
  );
  return 1;
}
