import path from "node:path";
import { version } from "../../package.json";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { stripGlobalCliFlags } from "./globalFlags";
import { syncSkillPointers } from "./aiSync";
import type { IAiSyncPlan } from "./aiSyncReport";
import {
  runAppContributions,
  type IAppContributionReport,
} from "./contributions";
import {
  refreshAgentsGuide,
  type IAgentsGuideRefresh,
} from "./scaffold/engine";

/** La page d'aide — `nodefony upgrade --help`, et le rappel après un refus. */
export const UPGRADE_USAGE: IUsagePage = {
  command: "nodefony upgrade",
  tagline:
    "remet l'application au niveau de la version de Nodefony installée, " +
    "après une montée de version",
  sections: [
    {
      title: "AVANT",
      paragraph:
        "Monter d'abord les paquets, TOUS à la même version — ils sont " +
        "verrouillés ensemble : `npm install nodefony@<version> " +
        "@nodefony/<paquet>@<version>…`. Pendant la série 10, le tag `beta` " +
        "désigne la dernière préversion ; `latest` sert encore l'ancienne " +
        "lignée 7.",
    },
    {
      title: "CE QU'ELLE REJOUE",
      paragraph:
        "Trois gestes que `npm install` ne fait pas : le bloc framework " +
        "d'`AGENTS.md` (entre ses marqueurs — le texte autour n'est pas " +
        "touché), les pointeurs des skills d'agent (`ai:sync`, nouveaux " +
        "skills compris), et les copies livrées par les paquets restées " +
        "intactes (`scaffold:sync --update` ; une copie retouchée est gardée " +
        "et nommée). Elle ne démarre pas l'application et n'installe rien.",
    },
  ],
  options: [
    {
      term: "--check",
      text: "dit ce qui est en retard sans rien écrire ; sort en 1 si quelque chose l'est",
    },
    { term: "--dry-run", text: "le plan, sans rien écrire (sort en 0)" },
    { term: "--json", text: "le même rapport, exploitable par un script" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    {
      term: "npm install nodefony@beta @nodefony/http@beta … && nodefony upgrade",
      text: "monter de version, puis remettre l'application au niveau",
    },
    {
      term: "nodefony upgrade --check",
      text: "en intégration continue : refuser une app en retard sur ses paquets",
    },
  ],
  exitCodes: [
    { term: "1", text: "en retard (--check), ou une contribution a échoué" },
    { term: "66", text: "aucune application ici (EX_NOINPUT)" },
  ],
};

/** Fichiers livrés listés à l'écran avant de résumer le reste. */
const SHOWN_FILES = 8;

/** Ce que `nodefony upgrade` a fait — ou ferait, en `--check`/`--dry-run`. */
export interface IUpgradeReport {
  /** Version de `nodefony` installée, celle qui rend le bloc. */
  version: string;
  /** `true` : rien n'a été écrit. */
  dryRun: boolean;
  agents: IAgentsGuideRefresh;
  skills: IAiSyncPlan;
  contributions: IAppContributionReport[];
}

/**
 * L'application est-elle en retard sur les paquets installés ?
 *
 * Une copie RETOUCHÉE (`modified`) ou un pointeur orphelin ne comptent pas :
 * aucun des deux ne se rafraîchit sans décision humaine, et un `--check` qui
 * rougirait pour eux ne passerait plus jamais.
 *
 * @param report - le rapport d'une passe `nodefony upgrade`.
 * @returns `true` si un des trois gestes a (ou aurait) écrit quelque chose.
 */
export function isUpgradePending(report: IUpgradeReport): boolean {
  return (
    report.agents.status === "updated" ||
    report.skills.skills.some((s) => s.action !== "inchange") ||
    report.contributions.some(
      (c) =>
        c.written.length > 0 || c.updated.length > 0 || c.outdated.length > 0,
    )
  );
}

/**
 * Rejoue, après une montée de version, les trois gestes qui alignent une
 * application sur les paquets installés : bloc framework d'`AGENTS.md`,
 * pointeurs de skills, copies livrées intactes.
 *
 * Une seule implémentation par geste, appelée telle quelle : c'est celle de
 * `create module` pour le bloc, d'`ai:sync` pour les pointeurs, de
 * `scaffold:sync --update` pour les copies.
 *
 * @param projectRoot - racine de l'application.
 * @param dryRun - `true` : juger sans rien écrire.
 * @returns le rapport des trois gestes.
 */
export async function runUpgrade(
  projectRoot: string,
  dryRun: boolean,
): Promise<IUpgradeReport> {
  return {
    version,
    dryRun,
    agents: refreshAgentsGuide(projectRoot, version, dryRun),
    skills: syncSkillPointers(projectRoot, dryRun),
    contributions: await runAppContributions(projectRoot, dryRun, true),
  };
}

/**
 * Le rapport, lisible : ce qui a bougé (ou bougerait), puis ce qui reste à
 * trancher à la main.
 *
 * @param report - le rapport d'une passe.
 * @returns le texte à écrire sur la sortie standard.
 */
export function renderUpgrade(report: IUpgradeReport): string {
  const verb = report.dryRun ? "à réécrire" : "réécrit";
  const lines: string[] = [`Nodefony ${report.version} installé.`, ""];
  const agentsLabel: Record<IAgentsGuideRefresh["status"], string> = {
    unchanged: "à jour",
    updated: `bloc framework ${verb}`,
    absent: "absent — non recréé (son absence peut être un choix)",
    skipped: "non touché (monorepo : il s'écrit à la main)",
  };
  lines.push(
    `  ${report.agents.file.padEnd(16)} ${agentsLabel[report.agents.status]}`,
  );

  const posed = report.skills.skills.filter((s) => s.action === "pose");
  const replaced = report.skills.skills.filter((s) => s.action === "remplace");
  lines.push(
    `  ${"skills".padEnd(16)} ` +
      (posed.length + replaced.length === 0
        ? `à jour (${report.skills.skills.length})`
        : `${posed.length} ${report.dryRun ? "à poser" : "posé(s)"}, ` +
          `${replaced.length} ${report.dryRun ? "à remplacer" : "remplacé(s)"}`),
  );
  for (const s of posed) lines.push(`    + ${s.name}`);
  for (const s of replaced) lines.push(`    ~ ${s.name}`);

  const refreshed = report.contributions.flatMap((c) => [
    ...c.written.map((f) => `    + ${f}`),
    ...c.updated.map((f) => `    ~ ${f}`),
    // Avec `--update`, une copie intacte en retard est rendue sous `updated`,
    // simulation comprise ; `outdated` ne la porte que sans `--update` — lus
    // tous deux, comme le fait `doctor --live`, sans la compter deux fois.
    ...c.outdated
      .filter((f) => !c.updated.includes(f))
      .map((f) => `    ~ ${f}`),
  ]);
  lines.push(
    `  ${"fichiers livrés".padEnd(16)} ` +
      (refreshed.length === 0
        ? "à jour"
        : `${refreshed.length} ${report.dryRun ? "à rafraîchir" : "rafraîchi(s)"}`),
  );
  // Une app née avant qu'un paquet livre ses fichiers les reçoit d'un bloc
  // (41 pour le décor Keycloak) : l'écran en montre le début, `--json` le tout.
  lines.push(...refreshed.slice(0, SHOWN_FILES));
  if (refreshed.length > SHOWN_FILES) {
    lines.push(
      `    … et ${refreshed.length - SHOWN_FILES} autre(s) — \`--json\` pour la liste`,
    );
  }

  // Ce que la commande ne tranche pas : nommé, jamais tu.
  const kept = report.contributions.flatMap((c) => c.modified);
  const failed = report.contributions.filter((c) => c.error !== null);
  if (
    kept.length +
      report.skills.preserves.length +
      report.skills.orphelins.length +
      failed.length >
    0
  ) {
    lines.push("", "À trancher à la main :");
    for (const f of kept) {
      lines.push(`  ${f} — retouché par l'application, gardé tel quel`);
    }
    for (const f of report.skills.preserves) {
      lines.push(`  ${f} — écrit à la main, pas remplacé par un pointeur`);
    }
    for (const f of report.skills.orphelins) {
      lines.push(`  ${f} — plus aucun paquet ne livre ce skill`);
    }
    for (const c of failed) {
      lines.push(
        `  ${c.packageName} — contribution en échec : ${String(c.error)}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Lit les options de `nodefony upgrade`.
 *
 * @param argv - `process.argv` complet.
 * @returns les options, ou l'erreur d'usage à rendre.
 */
export function parseUpgradeArgv(argv: string[]):
  | {
      cwd: string;
      json: boolean;
      dryRun: boolean;
      check: boolean;
      help: boolean;
    }
  | { error: string } {
  const args = stripGlobalCliFlags(
    argv.slice(2).filter((a) => a !== "upgrade"),
  );
  let cwd = process.cwd();
  let json = false;
  let dryRun = false;
  let check = false;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--check") check = true;
    else if (a === "--cwd") {
      const v = args.at(i + 1);
      if (v === undefined) return { error: "--cwd attend un chemin" };
      cwd = path.resolve(v);
      i += 1;
    } else return { error: `option inconnue : ${String(a)}` };
  }
  return { cwd, json, dryRun, check, help };
}

/**
 * Point d'entrée de `nodefony upgrade` — sans boot du kernel : elle sert
 * justement quand l'application n'a pas encore été reconstruite sur ses
 * nouveaux paquets.
 *
 * @param argv - `process.argv` complet.
 * @returns exit code sémantique (`OK`, 1 en retard ou en échec, `USAGE`,
 *   `NOINPUT` hors projet).
 */
export async function runUpgradeCommand(argv: string[]): Promise<number> {
  const parsed = parseUpgradeArgv(argv);
  if ("error" in parsed) return printUsageError(UPGRADE_USAGE, parsed.error);
  if (parsed.help) return printUsage(UPGRADE_USAGE);
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      "upgrade: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n",
    );
    return SysExit.NOINPUT;
  }
  const report = await runUpgrade(projectRoot, parsed.dryRun || parsed.check);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderUpgrade(report),
  );
  if (report.contributions.some((c) => c.error !== null)) return 1;
  return parsed.check && isUpgradePending(report) ? 1 : SysExit.OK;
}
