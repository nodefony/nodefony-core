import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { version } from "../../package.json";
import type { PackageManagerName } from "../Cli";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { npmChannelOf, packageSpec } from "./installCommand";
import {
  fetchDistTags,
  findNewerRelease,
  type INewerRelease,
} from "./cliFreshness";
import { runPostStep } from "./create";
import { portableSpawn } from "./execPortable";
import {
  packageManagerExecArgs,
  packageManagerUpdateInstallArgs,
} from "./packageManager";
import { appPackageManager } from "./scaffold/contribute";
import {
  parsePackageManifest,
  type IPackageManifest,
} from "./scaffold/packageManifest";
import { SCAFFOLD_VERSIONS } from "./scaffold/versions";
import {
  frameworkRangeChanges,
  toolingRangeChanges,
  type IRangeChange,
} from "./upgradeRanges";
import { stripGlobalCliFlags } from "./globalFlags";
import { syncSkillPointers } from "./aiSync";
import { syncEnvExample, type IEnvExampleSync } from "./env";
import type { IAiSyncPlan } from "./aiSyncReport";
import {
  runAppContributions,
  type IAppContributionReport,
} from "./contributions";
import {
  refreshAgentsGuide,
  type IAgentsGuideRefresh,
} from "./scaffold/engine";

/**
 * La page d'aide de `nodefony upgrade` pour une version du framework.
 *
 * Le canal s'y CALCULE (`packageSpec`) : écrit en dur, il affirmait encore
 * « `latest` sert la 7 » dans l'aide de la stable.
 *
 * @param frameworkVersion - version du framework qui affiche l'aide
 * @returns la page d'aide
 */
export function upgradeUsage(frameworkVersion: string): IUsagePage {
  const channel = npmChannelOf(frameworkVersion);
  const prerelease = channel !== null && channel !== "latest";
  return {
    command: "nodefony upgrade",
    tagline:
      "remet l'application au niveau de la version de Nodefony installée, " +
      "après une montée de version",
    sections: [
      {
        title: "MONTER DE VERSION",
        paragraph:
          "`nodefony upgrade --to <version|canal>` monte d'un geste tous les " +
          "paquets du framework, verrouillés ensemble : chaque plage " +
          "`nodefony` et `@nodefony/*` du `package.json` passe à la même " +
          "version — dépendances, dépendances de développement, `overrides`, " +
          "`resolutions`. L'outillage du gabarit que l'application déclare " +
          "sous son plancher est relevé (rien ne descend, rien ne s'ajoute, " +
          "`typescript` reste à l'application). Puis une seule installation, " +
          "par le gestionnaire de l'application, et la version installée " +
          "rejoue les gestes ci-dessous. Un canal npm (dist-tag) se résout " +
          "auprès du registre." +
          (prerelease
            ? ` Pour une préversion, le canal \`${channel}\` désigne la dernière publiée.`
            : ""),
      },
      {
        title: "CE QU'ELLE REJOUE",
        paragraph:
          "Quatre gestes que `npm install` ne fait pas : le bloc framework " +
          "d'`AGENTS.md` (entre ses marqueurs — le texte autour n'est pas " +
          "touché), les pointeurs des skills d'agent (`ai:sync`, nouveaux " +
          "skills compris), les copies livrées par les paquets restées " +
          "intactes (`scaffold:sync --update` ; une copie retouchée est gardée " +
          "et nommée), et `.env.example` (`env --example`). Elle ne démarre " +
          "pas l'application ; sans `--to`, elle n'installe rien et ne " +
          "touche pas au `package.json`.",
      },
      {
        title: "FICHIERS POSÉS",
        paragraph:
          "Un paquet ne pose ses fichiers que si l'application en déclare " +
          "l'usage : `@nodefony/security` pose le décor Keycloak " +
          "(`docker/keycloak/`) parce que le `compose.yaml` le monte — y compris " +
          "sous un profil jamais démarré. Retirer le service du compose suffit " +
          "à ne plus le recevoir ; le rapport range chaque fichier sous son " +
          "paquet, `+` créé, `~` rafraîchi.",
      },
    ],
    options: [
      {
        term: "--to <version|canal>",
        text: "monte tous les paquets du framework à cette version, installe, puis rejoue les gestes",
      },
      {
        term: "--check",
        text:
          "dit ce qui est en retard sans rien écrire — gestes, plages du " +
          "framework, outillage sous son plancher — et annonce une version " +
          "publiée plus récente ; sort en 1 si quelque chose est en retard",
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
        term: `nodefony upgrade --to ${prerelease ? channel : "<version>"}`,
        text: "monter tous les paquets, installer, remettre l'application au niveau",
      },
      {
        term: `npm install ${packageSpec("nodefony", frameworkVersion)} ${packageSpec("@nodefony/http", frameworkVersion)} … && nodefony upgrade`,
        text: "la même chose à la main : monter les paquets, puis l'application",
      },
      {
        term: "nodefony upgrade --check",
        text: "en intégration continue : refuser une app en retard sur ses paquets",
      },
    ],
    exitCodes: [
      {
        term: "1",
        text: "en retard (--check), version introuvable, installation ou contribution en échec",
      },
      { term: "66", text: "aucune application ici (EX_NOINPUT)" },
    ],
  };
}

/** La page d'aide — `nodefony upgrade --help`, et le rappel après un refus. */
export const UPGRADE_USAGE: IUsagePage = upgradeUsage(version);

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
  /** `.env.example`, dérivé du catalogue ET des modules installés. */
  envExample: IEnvExampleSync;
  /**
   * Plages du framework, surcharges comprises : sans `--to`, celles qui ne
   * visent pas la version installée ; avec `--to`, celles alignées (ou à
   * aligner) sur la cible.
   */
  ranges: IRangeChange[];
  /** Outillage du gabarit déclaré sous son plancher — relevé avec `--to`. */
  tooling: IRangeChange[];
  /** `--to` : la version visée ; `null` sans `--to`. */
  target: string | null;
  /** Version publiée plus récente (`--check`) ; `null` hors ligne, coupé ou à jour. */
  newer: INewerRelease | null;
}

/**
 * Lit le `package.json` d'une application.
 *
 * @param projectRoot - racine de l'application.
 * @returns le manifeste, ou `null` s'il n'existe pas.
 * @throws si le fichier n'est pas un objet JSON.
 */
function readAppManifest(projectRoot: string): IPackageManifest | null {
  const file = path.join(projectRoot, "package.json");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return parsePackageManifest(text, file);
}

/**
 * Le retard des plages de l'application sur la version installée, sans rien
 * écrire. Un manifeste absent ou illisible ne retarde rien : `npm` le dira
 * mieux que nous.
 */
function rangeDrift(projectRoot: string): {
  ranges: IRangeChange[];
  tooling: IRangeChange[];
} {
  let manifest: IPackageManifest | null;
  try {
    manifest = readAppManifest(projectRoot);
  } catch {
    return { ranges: [], tooling: [] };
  }
  if (manifest === null) return { ranges: [], tooling: [] };
  return {
    ranges: frameworkRangeChanges(manifest.data, version, false),
    tooling: toolingRangeChanges(manifest.data, SCAFFOLD_VERSIONS, false),
  };
}

/**
 * L'application est-elle en retard sur les paquets installés ?
 *
 * Une copie RETOUCHÉE (`modified`) ou un pointeur orphelin ne comptent pas :
 * aucun des deux ne se rafraîchit sans décision humaine, et un `--check` qui
 * rougirait pour eux ne passerait plus jamais.
 *
 * @param report - le rapport d'une passe `nodefony upgrade`.
 * @returns `true` si un des quatre gestes a (ou aurait) écrit quelque chose.
 */
export function isUpgradePending(report: IUpgradeReport): boolean {
  return (
    report.agents.status === "updated" ||
    report.envExample.status === "pending" ||
    report.envExample.status === "wrote" ||
    report.ranges.length > 0 ||
    report.tooling.length > 0 ||
    report.skills.skills.some((s) => s.action !== "inchange") ||
    report.contributions.some(
      (c) =>
        c.written.length > 0 || c.updated.length > 0 || c.outdated.length > 0,
    )
  );
}

/**
 * Rejoue, après une montée de version, les quatre gestes qui alignent une
 * application sur les paquets installés : bloc framework d'`AGENTS.md`,
 * pointeurs de skills, copies livrées intactes, `.env.example`.
 *
 * Une seule implémentation par geste, appelée telle quelle : c'est celle de
 * `create module` pour le bloc, d'`ai:sync` pour les pointeurs, de
 * `scaffold:sync --update` pour les copies, d'`env --example` pour le modèle.
 *
 * @param projectRoot - racine de l'application.
 * @param dryRun - `true` : juger sans rien écrire.
 * @returns le rapport des quatre gestes.
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
    envExample: await syncEnvExample(projectRoot, dryRun),
    ...rangeDrift(projectRoot),
    target: null,
    newer: null,
  };
}

/**
 * L'annonce d'une version publiée plus récente, avec la ligne qui y monte.
 *
 * @param newer - la version retenue par le contrôle de fraîcheur.
 * @returns le texte à écrire.
 */
export function renderNewerRelease(newer: INewerRelease): string {
  return (
    `\nNodefony ${newer.version} est publiée (installée : ${version}).\n` +
    `  nodefony upgrade --to ${newer.version}\n`
  );
}

/** Les lignes d'une liste de plages, sous la ligne qui les annonce. */
function rangeLines(changes: readonly IRangeChange[]): string[] {
  return changes.map((c) => `    ${c.field} ${c.name} : ${c.from} → ${c.to}`);
}

/**
 * Les plages du rapport : framework, puis outillage — en retard sans `--to`,
 * alignées (ou à aligner) avec.
 */
function renderRanges(report: IUpgradeReport): string[] {
  const lines: string[] = [];
  const target = report.target;
  const n = report.ranges.length;
  lines.push(
    `  ${"framework".padEnd(16)} ` +
      (n === 0
        ? `à jour (${target ?? report.version})`
        : target === null
          ? `${n} plage(s) en retard sur ${report.version}`
          : `${n} plage(s) ${report.dryRun ? "à aligner" : "alignée(s)"} sur ${target}`),
    ...rangeLines(report.ranges),
  );
  const t = report.tooling.length;
  lines.push(
    `  ${"outillage".padEnd(16)} ` +
      (t === 0
        ? "à jour"
        : target === null
          ? `${t} paquet(s) sous le plancher du gabarit`
          : `${t} paquet(s) ${report.dryRun ? "à relever" : "relevé(s)"} au plancher du gabarit`),
    ...rangeLines(report.tooling),
  );
  if (target === null && n + t > 0) {
    lines.push(
      `    → \`nodefony upgrade --to ${report.version}\` les aligne et installe`,
    );
  }
  if (target !== null && target !== report.version && report.dryRun) {
    lines.push(
      `    (une fois installée, la ${target} relève l'outillage à SON gabarit)`,
    );
  }
  return lines;
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
  lines.push(...renderRanges(report));
  const agentsLabel: Record<IAgentsGuideRefresh["status"], string> = {
    unchanged: "à jour",
    updated: `bloc framework ${verb}`,
    absent: "absent — non recréé (son absence peut être un choix)",
    skipped: "non touché (monorepo : il s'écrit à la main)",
  };
  lines.push(
    `  ${report.agents.file.padEnd(16)} ${agentsLabel[report.agents.status]}`,
  );
  const envLabel: Record<IEnvExampleSync["status"], string> = {
    synced: "à jour",
    wrote: "régénéré",
    pending: "à régénérer",
    // Catalogue illisible : le dire, plutôt qu'un « à jour » faux.
    unavailable:
      "non vérifié — catalogue illisible (`nodefony env --example` dit pourquoi)",
    // Un module illisible : régénérer retirerait ses variables, donc rien.
    incomplete:
      `non vérifié — module(s) illisible(s) : ` +
      `${report.envExample.unreadable.map((u) => u.module).join(", ")} ` +
      "(`nodefony env --example` dit pourquoi)",
  };
  lines.push(
    `  ${".env.example".padEnd(16)} ${envLabel[report.envExample.status]}`,
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

  // Un fichier CRÉÉ n'est pas un fichier RAFRAÎCHI : les confondre annonçait
  // « 41 rafraîchi(s) » pour un décor que l'application n'avait jamais eu. Et
  // chaque paquet se nomme — c'est lui qui décide de poser, sur ce que
  // l'application déclare (ex. `@nodefony/security` : un compose qui monte
  // `./docker/keycloak/`).
  const delivered = report.contributions
    .map((c) => ({
      name: c.packageName,
      created: c.written,
      // Avec `--update`, une copie intacte en retard est rendue sous `updated`,
      // simulation comprise ; `outdated` ne la porte que sans `--update` — lus
      // tous deux, comme le fait `doctor --live`, sans la compter deux fois.
      refreshed: [
        ...c.updated,
        ...c.outdated.filter((f) => !c.updated.includes(f)),
      ],
    }))
    .filter((c) => c.created.length + c.refreshed.length > 0);
  lines.push(
    `  ${"fichiers livrés".padEnd(16)} ` +
      (delivered.length === 0 ? "à jour" : `${delivered.length} paquet(s)`),
  );
  for (const c of delivered) {
    const counts = [
      c.created.length > 0
        ? `${c.created.length} ${report.dryRun ? "à poser" : "posé(s)"}`
        : null,
      c.refreshed.length > 0
        ? `${c.refreshed.length} ${report.dryRun ? "à rafraîchir" : "rafraîchi(s)"}`
        : null,
    ].filter((s) => s !== null);
    lines.push(`    ${c.name} — ${counts.join(", ")}`);
    const files = [
      ...c.created.map((f) => `      + ${f}`),
      ...c.refreshed.map((f) => `      ~ ${f}`),
    ];
    // Une app née avant qu'un paquet livre ses fichiers les reçoit d'un bloc
    // (41 pour le décor Keycloak) : l'écran en montre le début, `--json` le tout.
    lines.push(...files.slice(0, SHOWN_FILES));
    if (files.length > SHOWN_FILES) {
      lines.push(
        `      … et ${files.length - SHOWN_FILES} autre(s) — \`--json\` pour la liste`,
      );
    }
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
  const newer = report.newer === null ? "" : renderNewerRelease(report.newer);
  return `${lines.join("\n")}\n${newer}`;
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
      /** `--to` : version ou canal visé ; `null` sans `--to`. */
      to: string | null;
      /** Passe lancée par la précédente, une fois la cible installée. */
      afterInstall: boolean;
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
  let to: string | null = null;
  let afterInstall = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--check") check = true;
    else if (a === AFTER_INSTALL_FLAG) afterInstall = true;
    else if (a === "--cwd" || a === "--to") {
      const v = args.at(i + 1);
      if (v === undefined || v.startsWith("-")) {
        return {
          error:
            a === "--cwd"
              ? "--cwd attend un chemin"
              : "--to attend une version ou un canal",
        };
      }
      if (a === "--cwd") cwd = path.resolve(v);
      else to = v;
      i += 1;
    } else return { error: `option inconnue : ${String(a)}` };
  }
  if (afterInstall && to === null) {
    return { error: `${AFTER_INSTALL_FLAG} ne va pas sans --to` };
  }
  return { cwd, json, dryRun, check, help, to, afterInstall };
}

/**
 * Drapeau de la passe qui suit l'installation : posé par `upgrade --to` quand
 * il relance la version installée, jamais tapé à la main.
 */
const AFTER_INSTALL_FLAG = "--after-install";

/** Délai accordé au registre pour résoudre un canal DEMANDÉ — explicite, donc plus large que le contrôle de fraîcheur. */
const TARGET_LOOKUP_TIMEOUT_MS = 10_000;

/** Un nom de canal npm (dist-tag) : il ne commence pas par un chiffre. */
const DIST_TAG = /^[a-z][a-z0-9._-]*$/iu;

/**
 * La version visée par `--to` : exacte telle quelle, ou un canal résolu
 * auprès du registre.
 *
 * Une cible sous la MAJEURE installée est refusée : elle changerait de lignée
 * vers le bas — `latest` a longtemps servi la 7, l'ancien framework
 * JavaScript, qui n'a pas de commande `upgrade` pour finir le travail.
 *
 * @param spec - valeur de `--to`.
 * @param current - version installée.
 * @param lookup - les `dist-tags` de `nodefony`, `null` hors ligne.
 * @returns la version, ou l'erreur à rendre (`usage` : faute de syntaxe).
 */
export async function resolveUpgradeTarget(
  spec: string,
  current: string,
  lookup: () => Promise<Record<string, unknown> | null>,
): Promise<{ version: string } | { error: string; usage: boolean }> {
  let target = semver.valid(spec);
  if (target === null) {
    if (!DIST_TAG.test(spec)) {
      return {
        error: `--to attend une version exacte ou un canal npm, pas « ${spec} »`,
        usage: true,
      };
    }
    const tags = await lookup();
    if (tags === null) {
      return {
        error:
          `registre injoignable : le canal « ${spec} » ne se résout pas — ` +
          "donner la version exacte (`--to <version>`)",
        usage: false,
      };
    }
    const raw = tags[spec];
    target = typeof raw === "string" ? semver.valid(raw) : null;
    if (target === null) {
      return {
        error: `canal « ${spec} » inconnu du registre — publiés : ${Object.keys(tags).join(", ")}`,
        usage: false,
      };
    }
  }
  const installed = semver.parse(current);
  if (installed !== null && semver.major(target) < installed.major) {
    return {
      error:
        `${target} descend sous la majeure installée (${current}) : ` +
        "`upgrade` ne change pas de lignée vers le bas",
      usage: false,
    };
  }
  return { version: target };
}

/**
 * Ce que `upgrade` demande au système — injecté pour éprouver la commande
 * sans réseau ni installation réelle.
 */
export interface IUpgradeIo {
  /** Environnement lu : coupure du contrôle de fraîcheur, registre configuré par npm. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `fetch` du registre ; `undefined` : celui de Node. */
  readonly fetchImpl: typeof fetch | undefined;
  /**
   * Installe l'application par son gestionnaire.
   *
   * @returns `true` si l'outil a réussi.
   */
  install(
    projectRoot: string,
    manager: PackageManagerName,
    quiet: boolean,
  ): boolean;
  /**
   * Relance la commande par le `nodefony` INSTALLÉ dans l'application.
   *
   * @returns son code de sortie.
   */
  handOff(
    projectRoot: string,
    manager: PackageManagerName,
    args: readonly string[],
  ): number;
}

/** Le système réel. */
const PROCESS_IO: IUpgradeIo = {
  env: process.env,
  fetchImpl: undefined,
  install: (projectRoot, manager, quiet) =>
    runPostStep(
      projectRoot,
      portableSpawn(manager, packageManagerUpdateInstallArgs(manager)),
      quiet,
    ),
  handOff: (projectRoot, manager, args) => {
    const cmd = portableSpawn(
      manager,
      packageManagerExecArgs(manager, "nodefony", args),
    );
    const result = spawnSync(cmd.file, cmd.args, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsVerbatimArguments: cmd.windowsVerbatimArguments,
    });
    return result.status ?? 1;
  },
};

/** Le gestionnaire de l'application : son champ `packageManager`, sinon son verrou, sinon npm. */
function managerOf(projectRoot: string): PackageManagerName {
  return (
    appPackageManager({
      appRoot: projectRoot,
      read: (rel) => {
        try {
          return fs.readFileSync(path.join(projectRoot, rel), "utf8");
        } catch {
          return null;
        }
      },
    }) ?? "npm"
  );
}

/**
 * Aligne le manifeste sur `target`, installe, et passe la main à la version
 * installée quand ce n'est pas celle qui tourne.
 *
 * Le binaire qui tourne est l'ANCIEN : ses gabarits, son bloc d'`AGENTS.md`,
 * ses planchers d'outillage sont ceux de sa version. Il réécrit donc les
 * plages et installe, puis relance `nodefony upgrade --to <cible>` par le
 * binaire installé — qui relève l'outillage à SES planchers (une seconde
 * installation n'a lieu que s'ils ont bougé) et rejoue les gestes.
 *
 * @returns les plages écrites (ou à écrire, en simulation) quand les gestes
 *   se rejouent ici, sinon le code de sortie à rendre.
 */
function alignManifest(
  projectRoot: string,
  target: string,
  options: { dryRun: boolean; json: boolean; afterInstall: boolean },
  io: IUpgradeIo,
): { ranges: IRangeChange[]; tooling: IRangeChange[] } | number {
  if (options.afterInstall && version !== target) {
    process.stderr.write(
      `upgrade: l'installation n'a pas posé nodefony ${target} — ` +
        `l'application tourne en ${version}. Vérifier le verrou, puis relancer.\n`,
    );
    return 1;
  }
  let manifest: IPackageManifest | null;
  try {
    manifest = readAppManifest(projectRoot);
  } catch (error) {
    process.stderr.write(
      `upgrade: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  if (manifest === null) {
    process.stderr.write("upgrade: package.json introuvable.\n");
    return SysExit.NOINPUT;
  }
  const apply = !options.dryRun;
  const ranges = frameworkRangeChanges(manifest.data, target, apply);
  const tooling = toolingRangeChanges(manifest.data, SCAFFOLD_VERSIONS, apply);
  if (options.dryRun) return { ranges, tooling };
  const changed = ranges.length + tooling.length > 0;
  if (!changed && version === target) return { ranges, tooling };
  if (changed) {
    fs.writeFileSync(
      manifest.file,
      `${JSON.stringify(manifest.data, null, 2)}\n`,
    );
    process.stderr.write(
      `package.json : ${ranges.length} plage(s) du framework → ${target}, ` +
        `${tooling.length} outil(s) relevé(s).\n`,
    );
  }
  const manager = managerOf(projectRoot);
  if (!io.install(projectRoot, manager, options.json)) {
    process.stderr.write(
      `upgrade: \`${manager} install\` en échec — package.json est réécrit ; ` +
        "relancer l'installation, puis `nodefony upgrade`.\n",
    );
    return 1;
  }
  if (version === target) return { ranges, tooling };
  return io.handOff(projectRoot, manager, [
    "upgrade",
    "--to",
    target,
    AFTER_INSTALL_FLAG,
    ...(options.json ? ["--json"] : []),
  ]);
}

/**
 * Point d'entrée de `nodefony upgrade` — sans boot du kernel : elle sert
 * justement quand l'application n'a pas encore été reconstruite sur ses
 * nouveaux paquets.
 *
 * @param argv - `process.argv` complet.
 * @param io - le système ; injecté par les tests.
 * @returns exit code sémantique (`OK`, 1 en retard ou en échec, `USAGE`,
 *   `NOINPUT` hors projet).
 */
export async function runUpgradeCommand(
  argv: string[],
  io: IUpgradeIo = PROCESS_IO,
): Promise<number> {
  const parsed = parseUpgradeArgv(argv);
  if ("error" in parsed) return printUsageError(UPGRADE_USAGE, parsed.error);
  if (parsed.help) {
    const code = printUsage(UPGRADE_USAGE);
    const newer = await findNewerRelease(version, io.env, io.fetchImpl);
    if (newer !== null) process.stdout.write(renderNewerRelease(newer));
    return code;
  }
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      "upgrade: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n",
    );
    return SysExit.NOINPUT;
  }
  const dryRun = parsed.dryRun || parsed.check;
  // Le registre se consulte pendant que les gestes se jugent.
  const newer = parsed.check
    ? findNewerRelease(version, io.env, io.fetchImpl)
    : Promise.resolve(null);
  let aligned: { ranges: IRangeChange[]; tooling: IRangeChange[] } | null =
    null;
  let target: string | null = null;
  if (parsed.to !== null) {
    const resolved = await resolveUpgradeTarget(parsed.to, version, () =>
      fetchDistTags("nodefony", {
        registry: io.env.npm_config_registry,
        timeoutMs: TARGET_LOOKUP_TIMEOUT_MS,
        ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
      }),
    );
    if ("error" in resolved) {
      if (resolved.usage) return printUsageError(UPGRADE_USAGE, resolved.error);
      process.stderr.write(`upgrade: ${resolved.error}\n`);
      return 1;
    }
    target = resolved.version;
    const step = alignManifest(projectRoot, target, { ...parsed, dryRun }, io);
    if (typeof step === "number") return step;
    aligned = step;
  }
  const report: IUpgradeReport = {
    ...(await runUpgrade(projectRoot, dryRun)),
    ...aligned,
    target,
    newer: await newer,
  };
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderUpgrade(report),
  );
  if (report.contributions.some((c) => c.error !== null)) return 1;
  return parsed.check && isUpgradePending(report) ? 1 : SysExit.OK;
}
