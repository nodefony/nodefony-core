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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { checkPackageDeps } from "./packageDeps";
import { checkWiring } from "./wiring";
import clc from "../../colors";

/** Dispositions explorées : une application (`modules/`) et ce dépôt. */
const CANDIDATE_ROOTS = [
  ".",
  "modules",
  "src/modules",
  "src/packages/@nodefony",
  "src/nodefony",
];

/** Dossiers qui CONTIENNENT des cibles, par opposition à en être une. */
const TARGET_CONTAINERS = ["modules", "src/modules", "src/packages/@nodefony"];

/**
 * Cibles du contrôle de câblage : l'application elle-même, et chaque module.
 *
 * Ce n'est pas la même liste que celle des paquets : un contrôle de dépendances
 * s'intéresse à ce qui porte un `package.json`, un contrôle de câblage à ce qui
 * porte un `nodefony/`. Les confondre ferait chercher des entités à la racine
 * d'un dossier qui n'en contient que des modules.
 */
function wiringTargets(cwd: string): string[] {
  const targets = [cwd];
  for (const container of TARGET_CONTAINERS) {
    const dir = path.join(cwd, container);
    if (!statSync(dir, { throwIfNoEntry: false })) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) targets.push(path.join(dir, entry.name));
      }
    } catch {
      // Un dossier illisible n'est pas un manquement de l'application.
    }
  }
  return targets;
}

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
  const wiring = checkWiring({
    roots: wiringTargets(cwd),
    cwd,
    // La racine du projet porte le manifeste : c'est lui qui dit quelles
    // briques seront CHARGÉES, information qu'aucune cible ne détient seule.
    projectRoot: cwd,
  });

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          scanned,
          findings,
          wiring: { scanned: wiring.scanned, findings: wiring.findings },
        },
        null,
        2,
      )}\n`,
    );
    return findings.length + wiring.findings.length > 0 ? 1 : 0;
  }

  if (findings.length === 0 && wiring.findings.length === 0) {
    const exceptions =
      Object.values(typeCycles ?? {}).flat().length +
      (typesUnreachable?.length ?? 0);
    process.stdout.write(
      clc.green(
        `✓ ${scanned} paquet(s), ${wiring.scanned} classe(s) câblée(s) — rien à signaler` +
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
  for (const f of wiring.findings) {
    process.stdout.write(clc.red(`✗ ${f.message}\n`));
    process.stdout.write(`  ${f.file}\n`);
  }
  const total = findings.length + wiring.findings.length;
  process.stdout.write(
    clc.red(
      `\n${total} manquement(s) sur ${scanned} paquet(s) et ${wiring.scanned} classe(s).\n`,
    ),
  );
  return 1;
}
