/**
 * Exécution STANDALONE de `nodefony doctor` — zéro boot, zéro Kernel.
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
import { readLastBoot } from "./lastBoot";
import { findProjectRoot } from "../../cli/projectRoot";
import {
  checkReadiness,
  type IPortProbe,
  type IReadinessResult,
} from "./readiness";
import { checkFreshness, type IFreshnessResult } from "./freshness";
import {
  defaultDevPorts,
  probePorts,
  readRuntimeState,
} from "../../service/dev/devProcess";
import {
  controlesSautes,
  creerPalette,
  doitColorer,
  largeurUtile,
  type IPalette,
  type CheckFamily,
  type IExecution,
} from "./report";
import { rendreRapport } from "./renderReport";

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
 * Sonde les ports de développement et CONSTATE qui les tient.
 *
 * Le verdict `ownedByUs` vient de `readRuntimeState`, qui invalide de lui-même
 * un état dont le processus est mort : un serveur Nodefony en marche est l'état
 * sain le plus courant, et l'accuser d'occuper « son » port ferait de `check` un
 * outil qu'on apprend à ignorer.
 *
 * @param projectRoot - racine de l'application.
 * @returns le verdict à injecter dans la règle, jamais la mesure elle-même.
 */
async function probeLocalPorts(projectRoot: string): Promise<IPortProbe> {
  const ports = defaultDevPorts(projectRoot);
  const states = await probePorts(ports);
  return {
    probed: ports,
    busy: states.filter((s) => s.listening).map((s) => s.port),
    ownedByUs: readRuntimeState(projectRoot) !== null,
  };
}

/** Ce que la ligne de commande demande. */
interface ICheckRequest {
  json: boolean;
  /** Dossier de DÉPART de la remontée vers la racine (défaut : le cwd). */
  cwd: string;
  /**
   * `true` si un contrôle SAUTÉ doit faire échouer la commande.
   *
   * Même doctrine que les gates de test du dépôt (`vitest.gates.ts`) : devant
   * un humain, un contrôle sauté est une information — il lit la section et
   * décide. Dans une chaîne automatisée, personne ne lit : un angle mort
   * silencieux y devient un quitus, et c'est ainsi qu'une passe « verte »
   * n'exerce plus rien.
   */
  strict: boolean;
  /** `true` si l'on demande seulement l'usage. */
  help: boolean;
}

/**
 * L'usage, rendu avec le même soin que le rapport.
 *
 * Il se lit dans deux situations opposées : on découvre la commande, ou on
 * vient de se tromper de drapeau. Il porte donc les deux réponses — ce que la
 * commande FAIT, et ce que chaque option change — plus les codes de sortie,
 * qu'aucune autre page ne donne et qu'un script doit connaître.
 *
 * @param p - la peinture en vigueur.
 * @returns le texte complet, retour chariot final compris.
 */
function usage(p: IPalette): string {
  const opt = (drapeau: string, quoi: string): string =>
    `  ${p.geste(drapeau.padEnd(20, " "))} ${quoi}\n`;
  return (
    `\n  ${p.fort("nodefony doctor")} — diagnostic statique de l'application\n\n` +
    `  usage : nodefony doctor [options]` +
    p.discret(`        (alias : nodefony check)\n\n`) +
    `  Contrôle ce qui est ÉCRIT — fraîcheur du build, état d'installation,\n` +
    `  dépendances déclarées, câblage — et rapporte le dernier démarrage.\n` +
    `  N'exécute rien : il répond même sur une application qui ne démarre plus.\n\n` +
    opt("--json", "le même rapport, exploitable par un script") +
    opt("--strict", "un contrôle SAUTÉ fait échouer (d'office sous `CI`)") +
    opt("--no-strict", "tolère un contrôle sauté, même sous `CI`") +
    opt(
      "--cwd <chemin>",
      "point de départ (la racine est résolue en remontant)",
    ) +
    p.discret(
      `\n  code de sortie : 0 rien à signaler · 1 manquement · 64 option inconnue\n\n`,
    )
  );
}

/**
 * La sévérité d'un contrôle sauté, décidée hors de la ligne de commande.
 *
 * Un drapeau explicite gagne toujours — dans les deux sens : `--no-strict`
 * existe pour qu'une absence VOULUE puisse s'énoncer en intégration continue,
 * plutôt que de se contourner en désarmant la commande entière.
 *
 * @param mot - `--strict`, `--no-strict`, ou rien.
 * @param env - l'environnement, injecté (une fonction qui lit `process.env` ne
 *   s'éprouve que dans l'environnement où elle tourne).
 * @returns `true` si un contrôle sauté doit peser sur le code de sortie.
 */
export function resoudreStrict(
  mot: boolean | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (mot !== undefined) return mot;
  return Boolean(env.CI);
}

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
  let strict: boolean | undefined;
  let help = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « option inconnue : --help » apprend au lecteur
      // qu'elle n'est pas finie — et c'est le premier mot qu'on tape.
      help = true;
    } else if (word === "--json" || word === "-j") {
      json = true;
    } else if (word === "--strict") {
      strict = true;
    } else if (word === "--no-strict") {
      strict = false;
    } else if (word === "--cwd") {
      cwd = path.resolve(rest[++i] ?? "");
    } else {
      return { error: `option inconnue : ${word}` };
    }
  }
  return { json, cwd, help, strict: resoudreStrict(strict, process.env) };
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
/**
 * Rapport de diagnostic statique, tel que toutes les portes le lisent.
 *
 * C'est exactement le document que `check --json` imprime : la commande n'en
 * possède aucune version privée. Ce qui compte, c'est qu'une deuxième porte
 * (le serveur MCP) rende le MÊME objet — un diagnostic qui différerait selon
 * l'outil qui le demande serait pire qu'aucun diagnostic.
 */
export interface ICheckReport {
  /** Racine de l'application effectivement contrôlée. */
  root: string;
  /** `nom version` tel que le manifeste le déclare — vide s'il ne dit rien. */
  appName: string;
  /** Nombre de paquets parcourus. */
  scanned: number;
  /** Manquements de dépendances. */
  findings: ReturnType<typeof checkPackageDeps>["findings"];
  /** Manquements de câblage, avec le nombre de classes contrôlées. */
  wiring: {
    scanned: number;
    findings: ReturnType<typeof checkWiring>["findings"];
  };
  /** Ce qui manque ICI et maintenant (env, modules, deps, ports). */
  readiness: IReadinessResult;
  /** Écarts entre ce qui est ÉCRIT et ce qui s'EXÉCUTERA (build, plancher Node). */
  freshness: IFreshnessResult;
  /** Bilan du dernier démarrage, s'il y en a un. */
  lastBoot: ReturnType<typeof readLastBoot>;
  /** Exceptions déclarées, comptées dans le rendu humain. */
  exceptions: number;
  /**
   * Ce que chaque famille a pu — ou n'a PAS pu — regarder.
   *
   * Porté par le rapport lui-même, donc identique dans toutes les portes : un
   * agent qui lit ce document par MCP voit les mêmes angles morts que l'humain
   * devant son terminal. C'est la moitié du diagnostic que l'absence de
   * manquements ne dit pas.
   */
  execution: Record<CheckFamily, IExecution>;
}

/**
 * Collecte le diagnostic — sans rien imprimer.
 *
 * Séparé du rendu pour la même raison que la table des sujets d'`inspect` :
 * dès qu'une deuxième porte existe, une collecte enfouie dans une fonction qui
 * écrit sur la sortie standard oblige à la réécrire, et les deux divergent.
 *
 * ⚠️ **La cible est l'APPLICATION, pas le dossier où l'on a tapé** : on remonte
 * au premier dossier portant `nodefony.config.ts`. Hors projet, le dossier de
 * départ reste la cible, et l'état d'installation n'est pas contrôlé (sans
 * manifeste ni environnement, une sonde accuserait le premier serveur venu).
 *
 * @param start - dossier de départ de la remontée
 * @returns le rapport complet, sans verdict ni code de sortie
 */
export async function collectCheckReport(start: string): Promise<ICheckReport> {
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

  // L'état d'installation ne se contrôle QUE dans une application : hors projet
  // (ce dépôt, un dossier de paquets) il n'y a ni manifeste, ni environnement,
  // ni port à défendre — et une sonde y accuserait le premier serveur venu.
  //
  // ⚠️ Cette abstention se DIT (`execution.readiness`). Rendre une liste de
  // manquements vide sans un mot faisait afficher « ✓ Prêt à démarrer » à un
  // contrôle qui n'avait rien ouvert : le pire rendu possible pour un outil de
  // diagnostic — silencieux, et rassurant à tort.
  const readiness: IReadinessResult = projectRoot
    ? await checkReadiness({
        projectRoot,
        probe: await probeLocalPorts(projectRoot),
      })
    : { findings: [], catalogUnreadable: false, portsProbed: [] };

  // La fraîcheur ne se contrôle QUE dans une application : hors projet, il n'y
  // a pas de `dist/` à comparer, et le plancher de Node est celui du dépôt.
  const freshness: IFreshnessResult = projectRoot
    ? checkFreshness(projectRoot)
    : { findings: [], notComparable: true };

  // Hors d'une application, les quatre familles sont sautées pour UNE seule
  // cause. Leur donner chacune une raison différente (« aucun package.json »,
  // « aucune classe ») décrirait les CONSÉQUENCES et ferait croire à quatre
  // problèmes distincts, là où il n'y en a qu'un — et le geste « lance depuis
  // une application » n'aurait aucun sens sous une raison qui n'en parle pas.
  const horsProjet: IExecution = {
    ran: false,
    reason: "aucune application ici (pas de `nodefony.config.ts` en remontant)",
    short: "hors application",
    unlock: "lance `nodefony doctor` depuis une application",
  };

  return {
    root: cwd,
    appName: appName(cwd),
    scanned,
    findings,
    freshness,
    wiring: { scanned: wiring.scanned, findings: wiring.findings },
    readiness,
    lastBoot,
    exceptions:
      Object.values(typeCycles ?? {}).flat().length +
      (typesUnreachable?.length ?? 0),
    execution: {
      freshness: !projectRoot
        ? horsProjet
        : freshness.notComparable
          ? {
              ran: false,
              reason:
                "ni sources ni `dist/` à comparer sous cette racine — il n'y " +
                "a rien à confronter",
              short: "rien à comparer",
              unlock: "construis l'application (`npm run build`)",
            }
          : { ran: true },
      readiness: projectRoot ? { ran: true } : horsProjet,
      // Sous-règle de `readiness` : le catalogue des variables déclarées se lit
      // dans le `dist/`. Sur une application non construite il est illisible, et
      // le silence de la règle « variable requise » ne vaut alors pas quitus.
      envCatalog: !projectRoot
        ? horsProjet
        : readiness.catalogUnreadable
          ? {
              ran: false,
              reason:
                "le catalogue des variables déclarées se lit dans le `dist/` " +
                "de l'application, qui n'est pas construite : le silence de la " +
                "règle « variable requise » ne vaut pas quitus",
              short: "catalogue illisible",
              unlock: "`npm run build`",
            }
          : { ran: true },
      deps: !projectRoot
        ? horsProjet
        : scanned > 0
          ? { ran: true }
          : {
              ran: false,
              reason: "aucun `package.json` sous les racines explorées",
              short: "aucun paquet",
              unlock: "vérifie la racine visée (`--cwd`)",
            },
      wiring: !projectRoot
        ? horsProjet
        : wiring.scanned > 0
          ? { ran: true }
          : {
              ran: false,
              reason:
                "aucune classe déclarée (`@controller`, `@entity`, " +
                "`@injectable`) n'a été trouvée : il n'y a rien à confronter " +
                "au manifeste",
              short: "aucune classe",
              unlock: "`nodefony create controller <Nom>`",
            },
    },
  };
}

/** Nombre total de manquements d'un rapport — le verdict, en un endroit. */
export function countCheckFindings(report: ICheckReport): number {
  return (
    report.findings.length +
    report.wiring.findings.length +
    report.readiness.findings.length +
    report.freshness.findings.length
  );
}

export async function runCheckCommand(argv: string[]): Promise<number> {
  const parsed = parseCheckArgv(argv);
  if ("error" in parsed) {
    // Un drapeau mal tapé ne doit JAMAIS se confondre avec un diagnostic : il
    // part sur la sortie d'erreur, avec l'usage, et un code distinct de celui
    // d'un manquement.
    const p = creerPalette(
      doitColorer(process.env, Boolean(process.stderr.isTTY)),
    );
    process.stderr.write(`  ${p.echec(`doctor : ${parsed.error}`)}\n`);
    process.stderr.write(usage(p));
    return 64;
  }
  if (parsed.help) {
    process.stdout.write(
      usage(
        creerPalette(doitColorer(process.env, Boolean(process.stdout.isTTY))),
      ),
    );
    return 0;
  }
  const { json, strict } = parsed;
  const start = parsed.cwd;
  const report = await collectCheckReport(start);
  const sautes = controlesSautes(report.execution);

  // Le verdict, en UN endroit : les trois portes (humain, JSON, MCP) doivent
  // sortir le même code — un rapport qui affiche un angle mort mais rend 0 là
  // où le JSON rend 1 apprendrait à ne croire ni l'un ni l'autre.
  const code = (): number => {
    if (countCheckFindings(report) > 0) return 1;
    return strict && sautes.length > 0 ? 1 : 0;
  };

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, skipped: sautes, strict }, null, 2)}\n`,
    );
    return code();
  }

  const out = process.stdout;
  const lignes = rendreRapport(report, {
    largeur: largeurUtile(out.columns),
    couleur: doitColorer(process.env, Boolean(out.isTTY)),
    now: Date.now(),
    lanceDepuis: start,
    strict,
  });
  out.write(`${lignes.join("\n")}\n`);
  return code();
}

/**
 * Le nom de l'application, tel que son manifeste le déclare.
 *
 * @param racine - racine du projet.
 * @returns `nom@version`, ou une chaîne vide si le manifeste ne dit rien.
 */
function appName(racine: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(racine, "package.json"), "utf8"),
    ) as { name?: string; version?: string };
    if (!pkg.name) return "";
    return pkg.version ? `${pkg.name} ${pkg.version}` : pkg.name;
  } catch {
    return "";
  }
}
