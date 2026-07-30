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
import {
  readLastBoot,
  formatAge,
  LAST_BOOT_FILE,
  type ILastBoot,
} from "./lastBoot";
import { findProjectRoot } from "../../cli/projectRoot";
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
 * Un bilan mérite d'être rapporté quand il porte une MAUVAISE nouvelle.
 *
 * Un démarrage abouti, complet et sans brique manquante ne se commente pas :
 * l'afficher à chaque contrôle serait du bruit, et le bruit finit par masquer
 * le signal. Les avertissements seuls ne suffisent pas non plus à déclencher —
 * un boot de développement en produit régulièrement.
 *
 * @param entry - le bilan lu.
 * @returns `true` s'il y a quelque chose à dire.
 */
function worthReporting(entry: ILastBoot): boolean {
  return (
    entry.status === "failed" ||
    entry.healthy === false ||
    Boolean(entry.bricksSkipped?.length) ||
    Boolean(entry.errors)
  );
}

/**
 * Écrit en TÊTE du rapport le bilan du dernier démarrage, quand il a une
 * mauvaise nouvelle à donner.
 *
 * En tête, parce que c'est l'information la plus utile de tout le rapport quand
 * elle existe : celui qui lance `check` sur une application qui ne démarre plus
 * — ou qui démarre sans que ses briques répondent — cherche exactement ça, et
 * la faire suivre une liste de manquements de câblage reviendrait à la cacher.
 *
 * Elle n'entre PAS dans le code de sortie. `check` contrôle le CODE ; l'état
 * d'un démarrage est un fait d'exécution, souvent déjà réparé au moment où on
 * lit. Faire échouer une intégration continue sur le boot local d'avant-hier
 * apprendrait surtout à ignorer le contrôle.
 *
 * @param entry - le bilan lu, ou `null`.
 * @param now - instant de référence, injecté (fonction pure, donc éprouvable).
 */
function reportLastBoot(entry: ILastBoot | null, now: number): void {
  if (!entry || !worthReporting(entry)) return;
  const out = process.stdout;
  const age = formatAge(entry.timestamp, now);

  if (entry.status === "failed") {
    out.write(clc.red(`\n✖ Le dernier démarrage a ÉCHOUÉ (${age})\n`));
    out.write(`  phase atteinte : ${entry.phase ?? "inconnue"}\n`);
    out.write(`  environnement  : ${entry.environment}\n`);
    if (entry.error) {
      out.write(
        `  cause          : ${entry.error.name}: ${entry.error.message}\n`,
      );
      if (entry.error.exitCode !== undefined) {
        out.write(`  code de sortie : ${entry.error.exitCode}\n`);
      }
    }
  } else {
    // Le cas que personne ne diagnostique : ça DÉMARRE, donc ça a l'air sain.
    out.write(
      clc.yellow(
        `\n⚠ Le dernier démarrage a abouti mais il MANQUE des briques (${age})\n`,
      ),
    );
    out.write(`  environnement  : ${entry.environment}\n`);
    if (entry.healthy === false) {
      out.write(
        clc.red(
          `  verdict        : un profil serveur a fini SANS aucun serveur en écoute\n`,
        ),
      );
    }
  }

  if (entry.bricksSkipped?.length) {
    out.write(`  ${entry.bricksSkipped.length} brique(s) ignorée(s) :\n`);
    for (const b of entry.bricksSkipped) {
      out.write(
        `    · ${b.module}${b.phase ? ` (${b.phase})` : ""} — ${b.reason}\n`,
      );
    }
  }
  if (entry.bricksGated?.length) {
    // VOLONTAIRE — mais un module écarté en silence se diagnostique comme un
    // module perdu, et on cherche longtemps un défaut qui n'existe pas.
    out.write(
      `  ${entry.bricksGated.length} brique(s) écartée(s) VOLONTAIREMENT :\n`,
    );
    for (const b of entry.bricksGated) {
      out.write(`    · ${b.module} — ${b.reason}\n`);
    }
  }
  if (entry.warnings || entry.errors) {
    out.write(
      `  journal du boot : ${entry.warnings ?? 0} avertissement(s), ${entry.errors ?? 0} erreur(s)\n`,
    );
  }
  if (entry.remediation) {
    out.write(clc.green(`  → ${entry.remediation}\n`));
  }
  out.write(`  bilan complet  : ${LAST_BOOT_FILE}\n\n`);
}

/** Ce que la ligne de commande demande. */
interface ICheckRequest {
  json: boolean;
  /** Dossier de DÉPART de la remontée vers la racine (défaut : le cwd). */
  cwd: string;
}

const USAGE =
  `usage : nodefony check [--json] [--cwd <path>]  (alias : doctor)\n` +
  `  Contrôle STATIQUE de l'application — dépendances déclarées, câblage,\n` +
  `  et le bilan du dernier démarrage. N'exécute rien.\n`;

/**
 * Parse l'argv après le mot `check` (ou son alias `doctor`).
 *
 * La borne est le mot de commande, pas la position : le fast-path passe
 * `process.argv` entier (`node`, chemin du binaire, `check`, …) tandis que le
 * filet de {@link Check.generate} ne passe que les options. Sans mot de
 * commande, tout l'argv reçu est donc considéré comme des options.
 */
export function parseCheckArgv(
  argv: string[],
): ICheckRequest | { error: string } {
  const at = argv.findIndex((w) => w === "check" || w === "doctor");
  const rest = at === -1 ? argv : argv.slice(at + 1);
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

/**
 * Lance le contrôle et écrit le rapport.
 *
 * **La cible est l'APPLICATION, pas le dossier courant.** On remonte donc au
 * premier dossier qui porte `nodefony.config.ts` (`findProjectRoot`, la même
 * définition de « où commence l'app » que le lanceur et les scaffolds). Sans
 * cette remontée, un `check` lancé dans `modules/blog/` ne trouvait ni le
 * manifeste, ni le bilan du dernier démarrage, et concluait « rien à
 * signaler » — le pire mode de défaillance pour un outil de diagnostic :
 * silencieux, et rassurant à tort.
 *
 * Hors de tout projet, on retombe sur le dossier de départ : ce dépôt-ci et
 * n'importe quel dossier de paquets restent contrôlables tels quels.
 *
 * @param argv - ligne de commande (`--json`, `--cwd <path>`).
 * @returns le code de sortie : 0 si rien à signaler, 1 sinon, 64 (`EX_USAGE`)
 *          sur une option inconnue. La trace d'un démarrage échoué est
 *          RAPPORTÉE mais ne pèse pas sur ce code.
 */
export function runCheckCommand(argv: string[]): number {
  const parsed = parseCheckArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`check: ${parsed.error}\n${USAGE}`);
    return 64;
  }
  const { json } = parsed;
  const start = parsed.cwd;
  const projectRoot = findProjectRoot(start);
  const cwd = projectRoot ?? start;
  const lastBoot = readLastBoot(cwd);
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
          root: cwd,
          scanned,
          findings,
          wiring: { scanned: wiring.scanned, findings: wiring.findings },
          lastBoot,
        },
        null,
        2,
      )}\n`,
    );
    return findings.length + wiring.findings.length > 0 ? 1 : 0;
  }

  // Dire QUOI a été contrôlé quand ce n'est pas là où on a tapé : un rapport
  // qui porte sur un autre dossier que celui qu'on croit se lit de travers,
  // dans les deux sens (« il n'a rien vu » comme « ça ne me concerne pas »).
  if (path.resolve(cwd) !== path.resolve(start)) {
    process.stdout.write(`application : ${cwd}\n  (lancé depuis ${start})\n`);
  }

  reportLastBoot(lastBoot, Date.now());

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
