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
import { Spinner } from "../../cli/progress";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkPackageDeps } from "./packageDeps";
import { checkWiring } from "./wiring";
import { readLastBoots } from "./lastBoot";
import { findProjectRoot } from "../../cli/projectRoot";
import { resolveEnvCascade } from "../../runtime/loadEnv";
import type { ILastBoot } from "./lastBoot";
import {
  checkReadiness,
  type IPortProbe,
  type IReadinessResult,
  type ITrackedEnvProbe,
} from "./readiness";
import { checkFreshness, type IFreshnessResult } from "./freshness";
import { checkSurface, type ISurfaceResult } from "./surface";
import { checkGuards, VERIFY_STEPS, type IGuardResult } from "./guards";
import {
  readOutdated,
  runVerifySteps,
  type DeepReporter,
  type IDeepProgress,
  type IDeepResult,
} from "./deep";
import { liveNotRun, LIVE_FAMILIES, type ILiveResult } from "./live";
import {
  defaultDevPorts,
  probePorts,
  readRuntimeState,
} from "../../service/dev/devProcess";
import {
  preventedChecks,
  skippedChecks,
  wrap,
  sectionTitle,
  isSubrule,
  TITLES,
  FAMILIES,
  countFindings,
  createPalette,
  wrapList,
  shouldColorize,
  usableWidth,
  type IPalette,
  type DoctorFamily,
  type IExecution,
} from "./report";
import { renderReport } from "./renderReport";
import { stripGlobalCliFlags } from "../../cli/globalFlags";

/**
 * L'environnement que l'APPLICATION verrait, depuis ce poste.
 *
 * `process.env` ne porte que ce que le terminal a posé ; l'application, elle,
 * lit d'abord sa cascade `.env*`. Un diagnostic qui l'ignore accuse ce qu'il
 * n'a pas regardé. La cascade est celle d'ICI (mode runtime et environnement de
 * déploiement du poste) — viser un autre environnement ne fait pas apparaître
 * des fichiers qui ne sont pas sur cette machine.
 *
 * @param root - racine du projet (ou dossier de départ, hors projet).
 * @returns l'environnement effectif ; `process.env` n'est jamais modifié.
 */
function appEnvironment(root: string): Record<string, string | undefined> {
  const runtimeEnv = process.env.NODE_ENV ?? "development";
  const rawAppEnv = process.env.APP_ENV ?? process.env.NF_ENV ?? "";
  return resolveEnvCascade(process.env, {
    cwd: root,
    runtimeEnv,
    ...(rawAppEnv && rawAppEnv !== runtimeEnv ? { appEnv: rawAppEnv } : {}),
  });
}

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
 * "nodefony": { "doctor": { "typeCycles": {…}, "typesUnreachable": [...] } }
 * ```
 *
 * Sans cette porte, un projet portant un cycle de types légitime ne peut jamais
 * être vert — et un contrôle qu'on ne peut pas satisfaire est un contrôle qu'on
 * apprend à ignorer.
 */
function readExceptions(cwd: string): {
  typeCycles?: Record<string, string[]>;
  typesUnreachable?: string[];
  entityDialect?: string[];
} {
  try {
    const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
    const check = (JSON.parse(raw) as { nodefony?: { doctor?: unknown } })
      .nodefony?.doctor;
    return (check ?? {}) as {
      typeCycles?: Record<string, string[]>;
      typesUnreachable?: string[];
      entityDialect?: string[];
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

/**
 * Les fichiers d'environnement LOCAUX que git suit — CONSTATÉ, jamais déduit.
 *
 * Trois choses peuvent manquer et ne se déduisent d'aucune autre : le binaire
 * `git`, un dépôt, et le droit de lire son index. Le verdict porte donc
 * `supported`, et la règle SAUTE au lieu d'afficher vert — un contrôle de
 * secrets qui se tait sur un dossier non versionné est le pire des deux mondes.
 *
 * `git ls-files` reçoit ses motifs en ARGUMENTS, jamais par un shell : c'est
 * git qui les développe, à l'identique sur les trois plateformes.
 *
 * @param projectRoot - racine de l'application.
 * @returns le verdict à injecter dans la règle.
 */
function probeTrackedEnvFiles(projectRoot: string): ITrackedEnvProbe {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "-z", "--", ".env.local", ".env.*.local"],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { supported: true, tracked: out.split("\0").filter(Boolean) };
  } catch (e) {
    return {
      supported: false,
      tracked: [],
      reason:
        `git n'a pas pu dire ce qu'il suit ici — ${(e as Error).message.split("\n")[0]} ` +
        `(dossier non versionné, ou binaire git absent)`,
    };
  }
}

/** Ce que la ligne de commande demande. */
export interface ICheckRequest {
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
  /**
   * `true` si l'on veut DEMANDER à l'application, pas seulement à ses fichiers.
   *
   * Coûteux (un boot console, sans le moindre port ouvert) et pas toujours
   * possible — c'est pourquoi il se demande. Le rapport statique reste rendu
   * quoi qu'il arrive : un étage 2 en échec devient un constat lisible, jamais
   * une exception qui emporterait le diagnostic dont on a précisément besoin
   * quand l'application va mal.
   */
  live: boolean;
  /**
   * `true` si l'on veut LANCER ce que le projet déclare — étage 3.
   *
   * Les autres étages LISENT ; celui-ci exécute les scripts du projet
   * (`typecheck`, `lint`, `test`) et interroge le registre npm. Il coûte donc
   * des dizaines de secondes là où `doctor` en coûte moins d'une, et c'est
   * exactement pourquoi il se demande : un diagnostic qui coûte une minute
   * cesse d'être lancé, et un contrôle qu'on ne lance plus ne garde rien.
   */
  deep: boolean;
  /** `true` si l'on demande seulement l'usage. */
  help: boolean;
  /**
   * L'environnement dont on veut connaître les manques, s'il n'est pas celui
   * d'ici (`--env production`).
   *
   * C'est la question qu'on se pose AVANT de déployer, et à laquelle rien ne
   * répondait : une variable requise en production seulement est invisible sur
   * un poste de développement, où elle est légitimement absente. Les valeurs
   * restent celles de la machine — on ne simule pas un déploiement.
   */
  targetEnv: string | null;
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
export function usage(p: IPalette, largeur: number = usableWidth(80)): string {
  // Une description qui déborde se replie sur la marge du terminal et se lit
  // comme une ligne d'option de plus. La colonne des drapeaux fait 20 : la
  // suite s'aligne dessous, pas sur la marge.
  const colonne = 20;
  const marge = " ".repeat(colonne + 3);
  const opt = (drapeau: string, quoi: string): string => {
    const [premiere, ...suite] = wrap(quoi, largeur - marge.length, "");
    return (
      `  ${p.action(drapeau.padEnd(colonne, " "))} ${premiere ?? ""}\n` +
      suite.map((l) => `${marge}${l}\n`).join("")
    );
  };
  /** Un titre de section, prolongé par son filet — la forme du rapport. */
  const section = (nom: string): string => {
    const { title: titre, divider: filet } = sectionTitle(nom, largeur);
    return `\n${p.strong(titre)}${p.dim(filet)}\n\n`;
  };
  /**
   * Les exemples : la commande, puis ce qu'elle répond.
   *
   * La colonne se DÉRIVE du plus long : figée, elle saute dès qu'un exemple
   * la dépasse, et l'aide se met à ressembler à une sortie cassée.
   */
  const exemples: ReadonlyArray<readonly [string, string]> = [
    [
      "nodefony doctor",
      "l'état d'ici : build, installation, dépendances, câblage",
    ],
    [
      "nodefony doctor --live",
      "et en plus ce que seule l'application démarrée sait : migrations, zones",
    ],
    [
      "nodefony doctor --env production",
      "ce qui manquera dans cet environnement — variables requises en " +
        "production, secrets versionnés",
    ],
    [
      "nodefony doctor --json | jq .",
      "le même document, pour un script ou un agent",
    ],
    [
      "nodefony doctor --cwd modules/blog",
      "depuis un sous-dossier : la racine de l'application est retrouvée seule",
    ],
  ];
  const largeurExemple = Math.max(...exemples.map(([c]) => c.length));
  const rendreExemples = (): string => {
    // Une glose qui n'a plus la place de tenir passe SOUS sa commande : deux
    // colonnes serrées à quinze caractères se lisent moins bien qu'une seule.
    const enColonnes = largeur - largeurExemple - 4 >= 24;
    return exemples
      .map(([commande, quoi]) => {
        if (!enColonnes) {
          return (
            `  ${p.action(commande)}\n` +
            wrap(quoi, largeur - 6, "      ")
              .map((l) => p.dim(l) + "\n")
              .join("")
          );
        }
        const retrait = " ".repeat(largeurExemple + 4);
        const suite = wrap(quoi, largeur - retrait.length, "");
        return (
          `  ${p.action(commande.padEnd(largeurExemple, " "))}  ${p.dim(suite[0] ?? "")}\n` +
          suite
            .slice(1)
            .map((l) => `${retrait}${p.dim(l)}\n`)
            .join("")
        );
      })
      .join("");
  };
  // Les familles sont DÉRIVÉES, jamais réécrites : une liste en dur ici
  // vieillirait au premier contrôle ajouté, et l'aide décrirait un outil qui
  // n'existe plus. C'est déjà arrivé sur le compteur du bilan.
  // 🔴 Repliée sur les SÉPARATEURS, jamais sur les espaces : `replier` coupe
  // aux espaces, et « Surface ouverte » se retrouvait à cheval sur deux lignes,
  // où plus personne ne reconnaît le nom d'un contrôle.
  const familles = wrapList(
    FAMILIES.filter((f) => !isSubrule(f)).map((f) => TITLES[f]),
    largeur - 4,
  );

  return (
    `\n  ${p.strong("nodefony doctor")}\n` +
    // La baseline se replie comme le reste : sur un terminal étroit, un titre
    // qui déborde est la PREMIÈRE chose que le lecteur voit casser.
    wrap(
      "ce qui ne va pas dans cette application, et quoi taper",
      largeur - 4,
      "  ",
    )
      .map((l) => p.dim(l) + "\n")
      .join("") +
    // Plus d'alias à annoncer : « check » a été retiré. Une aide qui nomme un
    // second nom oblige le lecteur à choisir entre deux mots pour un seul
    // geste, et fait vivre dans les scripts d'autrui celui qu'on veut voir
    // disparaître.
    `\n  usage : nodefony doctor [options]\n` +
    section("CE QU'IL REGARDE") +
    familles.map((l) => `  ${l}\n`).join("") +
    "\n" +
    wrap(
      "Il ne DÉMARRE pas l'application : il lit des fichiers, interroge git " +
        "sur ce qu'il suit, et sonde les ports du poste. Il répond donc même " +
        "sur une application qui ne démarre plus — c'est le moment où l'on en " +
        `a le plus besoin. Les ${LIVE_FAMILIES.length} derniers contrôles font ` +
        "exception : ils exigent un démarrage, et ne jouent qu'avec `--live`.",
      largeur - 4,
      "  ",
    )
      .map((l) => `${l}\n`)
      .join("") +
    section("OPTIONS") +
    opt(
      "--json",
      "le même rapport, exploitable par un script — et AUCUNE progression, " +
        "sur aucun canal : un harnais qui capture les deux flux (`2>&1`) " +
        "recevrait sinon du décor au milieu de ses données",
    ) +
    opt(
      "--strict",
      "un contrôle SAUTÉ fait échouer — armé tout seul quand la variable " +
        "d'environnement `CI` est posée, ce que fait toute forge",
    ) +
    opt(
      "--no-strict",
      "tolère un contrôle sauté, y compris sur une forge : une absence VOULUE " +
        "s'énonce, elle ne se contourne pas en désarmant la commande",
    ) +
    opt(
      "--live",
      "DEMANDE à l'application : migrations, cohérence des zones (boot console, aucun port ouvert)",
    ) +
    opt("--no-live", "s'en tient aux fichiers, quoi qu'un script demande") +
    opt(
      "--deep",
      "tout : LANCE ce que le projet déclare (`typecheck`, `lint`, `test`), " +
        "interroge npm sur les paquets en retard, et DEMANDE à l'application " +
        "(implique `--live` ; `--no-live` le refuse). Des dizaines de secondes. " +
        "N'annonce sa progression que hors `--json`",
    ) +
    opt(
      "--env <e>",
      "dit ce qui manquera dans CET environnement (`production`, `staging`…) sans y aller",
    ) +
    opt(
      "--cwd <chemin>",
      "point de départ (la racine de l'app est résolue en remontant)",
    ) +
    section("EXEMPLES") +
    rendreExemples() +
    section("CODES DE SORTIE") +
    opt("0", "rien à signaler") +
    opt(
      "1",
      "au moins un manquement — ou, en mode strict, un contrôle EMPÊCHÉ",
    ) +
    opt("64", "option inconnue (EX_USAGE)") +
    "\n" +
    wrap(
      "Un contrôle qui n'a PAS pu regarder est toujours annoncé : son silence " +
        "ne vaut jamais quitus. Un contrôle non DEMANDÉ (`--live`) est affiché " +
        "de même, mais ne pèse pas sur le code de sortie.",
      largeur - 4,
      "  ",
    )
      .map((l) => p.dim(l) + "\n")
      .join("") +
    "\n"
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
/**
 * Les MODES d'exécution connus — ceux que le moteur distingue vraiment.
 *
 * La liste des environnements de DÉPLOIEMENT, elle, est ouverte (`staging`,
 * `preprod`, `qa`… sont des chaînes libres, cf `NF_ENV`) : la fermer refuserait
 * des environnements parfaitement légitimes. C'est pourquoi la garde
 * ci-dessous ne refuse PAS l'inconnu — elle refuse ce qui RESSEMBLE à une
 * faute de frappe sur l'un de ces mots.
 */
const KNOWN_MODES = ["production", "development", "dev", "prod", "test"];

/**
 * La distance d'édition entre deux mots, bornée.
 *
 * Bornée parce qu'on ne cherche pas à mesurer : on cherche à savoir si deux
 * mots sont à une ou deux frappes l'un de l'autre. Au-delà, la réponse est
 * « non » et le calcul ne sert plus à rien.
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/**
 * Le mode connu dont cet environnement est visiblement une faute de frappe.
 *
 * 🔴 Vécu, et c'est le pire mode de défaillance d'un diagnostic : `doctor --env
 * produntion` rendait un rapport COMPLET et plausible, verdict compris, sur un
 * environnement qui n'existe nulle part — le mot inventé s'affichait tel quel
 * dans chaque phrase. Un outil dont le rôle est de dire la vérité ne doit pas
 * être le seul à ne pas la vérifier sur sa propre entrée.
 *
 * On ne refuse PAS tout inconnu : un environnement de déploiement est une
 * chaîne libre, et refuser `preprod` rendrait l'option inutilisable là où elle
 * sert. On refuse ce qui est à une ou deux frappes d'un mode connu, sans en
 * être un — c'est la signature d'une faute, pas d'un choix.
 *
 * @param env - l'environnement demandé.
 * @returns le mode dont il est probablement une coquille, sinon `null`.
 */
export function likelyTypo(env: string): string | null {
  const lower = env.toLowerCase();
  if (KNOWN_MODES.includes(lower)) return null;
  for (const mode of KNOWN_MODES) {
    // Un seuil relatif au mot : sur « dev » (3 lettres), deux frappes d'écart
    // en font un autre mot ; sur « production », non.
    const seuil = mode.length <= 5 ? 1 : 2;
    if (editDistance(lower, mode) <= seuil) return mode;
  }
  return null;
}

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
export function parseDoctorArgv(
  argv: string[],
): ICheckRequest | { error: string } {
  const at = argv.findIndex((w) => w === "doctor");
  const rest = stripGlobalCliFlags(at === -1 ? argv : argv.slice(at + 1));
  let json = false;
  let cwd = process.cwd();
  let strict: boolean | undefined;
  let live = false;
  let deep = false;
  // `--no-live` doit pouvoir gagner contre l'implication de `--deep`, quel que
  // soit l'ORDRE des drapeaux : un booléen `live` seul ne le permet pas, car
  // `--no-live --deep` le rallumerait. On mémorise donc le REFUS, pas l'état.
  let liveRefuse = false;
  let help = false;
  let targetEnv: string | null = null;
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
    } else if (word === "--deep") {
      deep = true;
    } else if (word === "--live") {
      live = true;
    } else if (word === "--no-live") {
      // Explicite, pour qu'un script puisse REFUSER le boot sans dépendre du
      // défaut — le même raisonnement que `--no-strict`. Il gagne aussi contre
      // l'implication de `--deep` : c'est la seule façon de demander « tout,
      // sauf démarrer l'application ».
      live = false;
      liveRefuse = true;
    } else if (word === "--cwd") {
      cwd = path.resolve(rest[++i] ?? "");
    } else if (word === "--env") {
      const value = rest[++i];
      // Un `--env` sans valeur avalerait l'option suivante et diagnostiquerait
      // un environnement nommé « --json ». Le refus nomme la forme attendue :
      // une option mal comprise doit apprendre à s'en servir, pas seulement
      // dire non.
      if (value === undefined || value.startsWith("-")) {
        return {
          error: "--env attend un environnement (ex. --env production)",
        };
      }
      const coquille = likelyTypo(value);
      if (coquille)
        return {
          error:
            `environnement inconnu : ${value} — voulais-tu dire ` +
            `${coquille} ? (un environnement de déploiement libre, comme ` +
            `preprod ou qa, est accepté tel quel)`,
        };
      targetEnv = value;
    } else {
      return { error: `option inconnue : ${word}` };
    }
  }
  return {
    json,
    cwd,
    help,
    // 🔴 `--deep` IMPLIQUE `--live`. Le premier veut dire « dis-moi tout, je
    // paie le temps » ; obliger à composer les deux force à connaître deux
    // drapeaux et à deviner lequel apporte quoi. Le risque est nul : quand
    // l'application ne démarre pas, l'étage 2 rend un CONSTAT lisible — jamais
    // une exception qui emporterait le rapport statique, dont on a précisément
    // besoin à ce moment-là.
    live: live || (deep && !liveRefuse),
    deep,
    targetEnv,
    strict: resoudreStrict(strict, process.env),
  };
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
export interface IDoctorReport {
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
  /**
   * Ce qui est atteignable SANS authentification, et les entités hors dialecte.
   *
   * L'inventaire des ouvertures est une INFORMATION : chacune est légitime
   * prise isolément, et c'est de ne les voir jamais ENSEMBLE qu'une route de
   * mise au point reste ouverte en production.
   */
  surface: ISurfaceResult;
  /**
   * Les filets du projet — sont-ils ARMÉS ?
   *
   * Aucune occurrence de code n'est signalée ici : le linter le fait déjà, et
   * mieux. Ce qui manquait, c'est de constater que la garde EXISTE — un filet
   * décroché ne fait pas de bruit.
   */
  guards: IGuardResult;
  /**
   * Étage 3 — ce que le projet DÉCLARE, réellement lancé (`--deep`).
   *
   * `null` quand l'étage n'a pas été demandé : l'absence de résultat et un
   * résultat vide ne se confondent pas, et c'est l'état d'exécution qui le dit
   * au lecteur plutôt qu'un silence.
   *
   * ## Ce qu'un appelant de `--json` y trouve
   *
   * ```json
   * "deep": {
   *   "steps": [
   *     { "step": "typecheck", "outcome": "passed", "ms": 809 },
   *     { "step": "lint", "outcome": "failed", "ms": 784,
   *       "detail": "src/a.ts:1:1: warning no-unused-vars" }
   *   ],
   *   "outdated": { "packages": [], "ahead": [], "counts": { "major": 0, … } },
   *   "outdatedReason": ""
   * }
   * ```
   *
   * - `outcome` vaut `passed` · `failed` · `timeout` · `absent`. **`absent`
   *   n'est pas un échec** : le script n'est pas déclaré par le projet, et
   *   c'est la famille `guards` qui en répond. **`timeout` non plus n'est pas
   *   un succès** : le script a été tué par la borne de temps, et le lire
   *   comme un `passed` est l'erreur que ce champ existe pour empêcher.
   * - `detail` porte la PREMIÈRE LIGNE UTILE de la sortie, l'annonce de npm
   *   sautée. Absent quand le script s'est tu.
   * - `outdated` vaut `null` quand le registre n'a pas répondu ; `outdatedReason`
   *   dit alors pourquoi. Un registre muet n'est PAS un défaut de
   *   l'application, et rien n'en est déduit.
   * - En `--json`, **aucune progression n'est émise sur aucun canal** : stdout
   *   ne porte que ce document, stderr reste vide.
   */
  deep: IDeepResult | null;
  /**
   * Les bilans de démarrage disponibles — serveur d'abord, console ensuite.
   *
   * DEUX, et pas un : un `nodefony inspect` lancé POUR diagnostiquer une panne
   * de serveur écrasait le bilan qu'il venait lire. Chacun dit désormais QUI a
   * démarré (`profile`) et par quelle commande.
   */
  lastBoots: ILastBoot[];
  /** Exceptions déclarées, comptées dans le rendu humain. */
  exceptions: number;
  /**
   * Ce que l'application DÉMARRÉE a dit d'elle-même — absent sans `--live`.
   *
   * Séparé du reste parce qu'il n'a pas la même nature : tout ce qui précède
   * se lit sur des fichiers et répond donc même quand l'application ne démarre
   * plus. Ceci exige un boot, et son absence est ÉNONCÉE dans `execution`
   * plutôt que devinée d'un champ manquant.
   */
  live?: ILiveResult;
  /**
   * Ce que chaque famille a pu — ou n'a PAS pu — regarder.
   *
   * Porté par le rapport lui-même, donc identique dans toutes les portes : un
   * agent qui lit ce document par MCP voit les mêmes angles morts que l'humain
   * devant son terminal. C'est la moitié du diagnostic que l'absence de
   * manquements ne dit pas.
   */
  execution: Record<DoctorFamily, IExecution>;
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
export async function collectDoctorReport(
  start: string,
  targetEnv: string | null = null,
  deepRequested = false,
  report?: DeepReporter,
): Promise<IDoctorReport> {
  const projectRoot = findProjectRoot(start);
  const cwd = projectRoot ?? start;
  // Étage 3 : il LANCE des commandes, donc il ne s'exécute que sur demande, et
  // seulement dans une application — hors projet il n'y a aucun manifeste à
  // lire, donc aucun script à lancer.
  const deep: IDeepResult | null =
    deepRequested && projectRoot
      ? await (async () => {
          const steps = await runVerifySteps(
            projectRoot,
            VERIFY_STEPS,
            undefined,
            report,
          );
          const { summary, reason } = await readOutdated(
            projectRoot,
            undefined,
            report,
          );
          return { steps, outdated: summary, outdatedReason: reason };
        })()
      : null;
  const lastBoots = readLastBoots(cwd);
  const roots = CANDIDATE_ROOTS.map((r) => path.join(cwd, r)).filter((r) =>
    statSync(r, { throwIfNoEntry: false }),
  );
  const { typeCycles, typesUnreachable, entityDialect } = readExceptions(cwd);
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
        targetEnv,
        tracked: probeTrackedEnvFiles(projectRoot),
      })
    : {
        findings: [],
        catalogUnreadable: false,
        portsProbed: [],
        trackedUnknown: null,
      };

  // La surface s'analyse sur les MÊMES cibles que le câblage : ce qui compte
  // est ce que l'application et ses modules déclarent, pas ce que les paquets
  // installés portent.
  const surface = checkSurface({
    roots: wiringTargets(cwd),
    cwd,
    ...(projectRoot ? { projectRoot } : {}),
    // L'environnement est INJECTÉ : l'infrastructure déclarée décide du
    // dialecte, et une fonction qui lirait `process.env` elle-même ne
    // s'éprouverait que dans l'environnement où elle tourne.
    //
    // 🔴 Et c'est l'environnement de l'APPLICATION, pas celui du terminal :
    // `process.env` nu ignore la cascade `.env*`, où le gabarit PRESCRIT
    // justement de poser `NF_DATABASE_URL`. Sans elle, une application
    // Postgres voyait CHAQUE entité accusée d'être écrite pour le mauvais
    // moteur — le contrôle qu'on finit par désactiver.
    env: appEnvironment(cwd),
    ...(entityDialect ? { dialectExceptions: entityDialect } : {}),
  });

  // Les gardes appartiennent au PROJET : hors d'une application, il n'y a ni
  // manifeste ni configuration de linter dont on pourrait dire quoi que ce soit.
  const guards: IGuardResult = projectRoot
    ? checkGuards({ projectRoot })
    : {
        findings: [],
        armed: 0,
        armedNames: [],
        linterUnreadable: true,
        manifestUnreadable: true,
      };

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
    surface,
    guards,
    wiring: { scanned: wiring.scanned, findings: wiring.findings },
    readiness,
    deep,
    lastBoots,
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
      // Sous-règle de `readiness` : sans dépôt git, personne ne peut dire si un
      // `.env.local` est versionné — et le silence de la règle ne vaut alors
      // pas quitus. C'est exactement le mode de défaillance qu'`envCatalog` a
      // appris à énoncer.
      envTracked: !projectRoot
        ? horsProjet
        : readiness.trackedUnknown
          ? {
              ran: false,
              reason: `${readiness.trackedUnknown} : impossible de dire si un fichier .env*.local est versionné`,
              short: "git muet",
              unlock: "lance depuis un dépôt git (`git init`)",
            }
          : { ran: true },
      guards: !projectRoot
        ? horsProjet
        : guards.manifestUnreadable || guards.linterUnreadable
          ? {
              ran: false,
              reason:
                "le manifeste ou la configuration du linter n'a pas pu être " +
                "lu : impossible de dire si les gardes du projet sont armées",
              short: "config illisible",
              unlock: "vérifie `package.json` et `.oxlintrc.json`",
            }
          : { ran: true },
      // Étage 3 — il ne s'exécute que sur demande, et son absence se DIT :
      // afficher « rien à signaler » sur un contrôle qu'on n'a pas lancé est
      // le seul mensonge que ce rapport ne doit jamais faire.
      verify: !projectRoot
        ? horsProjet
        : deep === null
          ? {
              ran: false,
              reason:
                "les gardes du projet n'ont pas été LANCÉES — seule leur " +
                "présence a été constatée",
              short: "non demandé",
              // NON DEMANDÉ n'est pas EMPÊCHÉ. Sans ce champ, le rendu écrit
              // « non demandé » pendant que `preventedChecks` compte un
              // empêchement : le texte et le verdict divergent, et `--strict`
              // (que `CI` arme) condamne une application saine. C'est le
              // défaut de l'étage 2, resté ouvert sur l'étage 3.
              onDemand: true,
              unlock: "nodefony doctor --deep",
            }
          : { ran: true },
      outdated: !projectRoot
        ? horsProjet
        : deep === null
          ? {
              ran: false,
              reason:
                "le registre npm n'a pas été interrogé — c'est du réseau, et " +
                "il ne se paie que sur demande",
              short: "non demandé",
              // Idem : ne pas AVOIR DEMANDÉ le réseau n'est pas un
              // empêchement. Le registre qui ne répond pas, si — c'est le cas
              // juste en dessous, et lui reste condamnable.
              onDemand: true,
              unlock: "nodefony doctor --deep",
            }
          : deep.outdated === null
            ? {
                ran: false,
                reason: deep.outdatedReason,
                short: "registre muet",
                // Le registre qui ne répond pas n'est pas un défaut de
                // l'application : le contrôle est EMPÊCHÉ, il n'a pas
                // « regardé et rien trouvé ».
                unlock: "réessaie quand le réseau répond",
              }
            : { ran: true },
      // La surface se lit sur les SOURCES : elle répond donc même sur une
      // application qui ne compile plus. Son seul empêchement est de n'avoir
      // rien à lire.
      surface:
        surface.scanned > 0
          ? { ran: true }
          : {
              ran: false,
              reason:
                "aucune source TypeScript sous les racines explorées : il n'y " +
                "a rien où chercher une route ouverte",
              short: "aucune source",
              notApplicable: true,
              unlock: "vérifie la racine visée (`--cwd`)",
            },
      // Le dialecte n'a de sens que s'il y a des entités : une application sans
      // ORM SQL n'a rien à contredire, et l'annoncer en angle mort ferait
      // crier `doctor` sur une architecture parfaitement saine.
      dialect:
        surface.entitiesScanned > 0
          ? { ran: true }
          : {
              ran: false,
              reason:
                "aucune entité Drizzle dans cette application — il n'y a pas " +
                "de dialecte à confronter",
              short: "aucune entité",
              notApplicable: true,
              // Un contrôle sauté SANS geste laisse le lecteur devant un
              // manque qu'il ne sait pas combler. Ici le geste n'est pas une
              // réparation : c'est ce qui rendrait le contrôle applicable.
              unlock: "`nodefony create entity <Nom>`",
            },
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
      // L'étage 2 n'a pas eu lieu : `collectDoctorReport` ne boote JAMAIS, c'est
      // ce qui lui permet de répondre sur une application cassée. La commande
      // remplace ces deux entrées quand `--live` a effectivement démarré.
      ...liveNotRun(
        "l'état de la base, la cohérence des zones et ce qu'un autre " +
          "environnement retirerait ne se lisent dans aucun fichier : il faut " +
          "démarrer l'application pour les constater",
        // Le geste REPREND la cible qu'on vient de demander : rendre
        // `--live` tout court ferait retaper `--env production`, et le
        // deuxième rapport ne dirait toujours pas ce qu'on cherchait.
        targetEnv
          ? `\`nodefony doctor --live --env ${targetEnv}\``
          : "`nodefony doctor --live`",
        // NON DEMANDÉ, et non pas empêché : sans ce drapeau, `--strict` (donc
        // toute chaîne automatisée, `CI` l'armant d'office) condamnait `doctor`
        // tant qu'on n'ajoutait pas un démarrage complet à la commande.
        true,
      ).execution,
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
              notApplicable: true,
              unlock: "`nodefony create controller <Nom>`",
            },
    },
  };
}

/**
 * Nombre total de manquements d'un rapport — le verdict, en un endroit.
 *
 * Délègue à {@link countFindings} : le rendu compte par la même fonction, et
 * le bilan chiffré ne peut donc plus contredire le sommaire qui le surmonte.
 * Ce nom reste parce qu'il a voyagé (le serveur MCP le lit).
 */
export function countCheckFindings(report: IDoctorReport): number {
  return countFindings(report);
}

/**
 * La ligne d'annonce d'un évènement de l'étage profond, ou `null` s'il n'y a
 * rien à dire.
 *
 * Fonction PURE, pour que ce qui s'affiche pendant une attente de plusieurs
 * minutes s'éprouve sans attendre quoi que ce soit.
 *
 * @param e - l'évènement annoncé par l'étage profond.
 * @param p - la palette (couleur ou non, selon le terminal).
 * @returns la ligne à écrire, sans retour chariot, ou `null`.
 */
export function ligneProgression(e: IDeepProgress, p: IPalette): string | null {
  const quoi = e.step === "outdated" ? "npm outdated" : `npm run ${e.step}`;
  if (e.phase === "start") return p.dim(`  … ${quoi}`);
  const secondes = e.ms === undefined ? "" : ` (${(e.ms / 1000).toFixed(1)} s)`;
  switch (e.outcome) {
    case "passed":
    case "ok":
      return `  ${p.ok("✓")} ${quoi}${p.dim(secondes)}`;
    case "failed":
      return `  ${p.failure("✗")} ${quoi}${p.dim(secondes)}`;
    case "timeout":
      return `  ${p.failure("⏱")} ${quoi}${p.dim(`${secondes} — interrompu`)}`;
    case "unavailable":
      return `  ${p.warning("—")} ${quoi}${p.dim(`${secondes} — sans réponse`)}`;
    default:
      return null;
  }
}

/**
 * Le reporter à donner à l'étage profond — ou `undefined` quand personne ne lit.
 *
 * 🔴 **Deux décisions, et elles ne sont pas cosmétiques.**
 *
 * *Le canal* : la progression part sur la sortie d'ERREUR, jamais sur la sortie
 * standard. Celle-ci porte le RAPPORT, que l'on redirige couramment vers un
 * fichier (`nodefony doctor > diagnostic.txt`) ; une progression éphémère qui
 * s'y glisserait salirait un document qu'on relit plus tard, et rendrait le
 * `--json` inexploitable. C'est aussi la convention des outils qui annoncent
 * leur travail — npm, cargo, docker écrivent tous leur progression sur stderr.
 *
 * *Le silence en `--json`* : rien n'est émis du tout, sur aucun canal. Un agent
 * qui capture les deux flux (`2>&1`, ce que font la plupart des harnais) verrait
 * sinon des lignes de décor tomber au milieu de son JSON. La règle est donc
 * simple à documenter et sans exception : **`--json` n'émet aucune
 * progression**.
 *
 * @param json - `true` si le rapport est demandé en JSON.
 * @param ecrire - où écrire (injecté : une fonction qui touche `process.stderr`
 *   en dur ne s'éprouve que par capture globale, donc mal).
 * @returns le reporter, ou `undefined` s'il ne faut rien annoncer.
 */
export function reporterProgression(
  json: boolean,
  ecrire: (ligne: string) => void = (l) => process.stderr.write(`${l}\n`),
  stream: NodeJS.WriteStream = process.stderr,
): DeepReporter | undefined {
  if (json) return undefined;
  const p = createPalette(
    shouldColorize(process.env, Boolean(process.stderr.isTTY)),
  );
  // Sur un terminal, l'attente est ANIMÉE. Sans cela, `--deep` écrivait
  // « … npm run typecheck » puis se taisait trente-huit secondes : un point
  // fixe n'est pas une progression, et l'utilisateur ne peut pas distinguer
  // « ça travaille » de « c'est planté » — il interrompt, puis cesse de s'en
  // servir. Hors terminal (forge, redirection), le comportement ne bouge pas
  // d'un octet : une ligne par évènement, écrite par `ecrire`.
  const animated = Boolean(stream.isTTY);
  const spinner = animated
    ? new Spinner({
        stream,
        render: (frame, label) => `  ${p.ok(frame)} ${p.dim(label)}`,
      })
    : null;
  return (e) => {
    const label = e.step === "outdated" ? "npm outdated" : `npm run ${e.step}`;
    if (spinner !== null) {
      // La ligne figée par `stop()` est celle-là même qu'écrit le mode non
      // animé : les deux rendus disent le MÊME verdict, seule l'attente diffère.
      if (e.phase === "start") spinner.start(label);
      else spinner.stop(ligneProgression(e, p) ?? undefined);
      return;
    }
    const ligne = ligneProgression(e, p);
    if (ligne !== null) ecrire(ligne);
  };
}

export async function runDoctorCommand(argv: string[]): Promise<number> {
  const parsed = parseDoctorArgv(argv);
  if ("error" in parsed) {
    // Un drapeau mal tapé ne doit JAMAIS se confondre avec un diagnostic : il
    // part sur la sortie d'erreur, avec l'usage, et un code distinct de celui
    // d'un manquement.
    const p = createPalette(
      shouldColorize(process.env, Boolean(process.stderr.isTTY)),
    );
    // Replié comme le reste : un refus qui déborde du terminal est le premier
    // texte que le lecteur voit casser, et il le voit au pire moment.
    const largeur = usableWidth(process.stderr.columns);
    for (const l of wrap(`doctor : ${parsed.error}`, largeur, "  ")) {
      process.stderr.write(`${p.failure(l)}\n`);
    }
    process.stderr.write(usage(p, usableWidth(process.stderr.columns)));
    return 64;
  }
  if (parsed.help) {
    process.stdout.write(
      usage(
        createPalette(
          shouldColorize(process.env, Boolean(process.stdout.isTTY)),
        ),
        usableWidth(process.stdout.columns),
      ),
    );
    return 0;
  }
  // Mesurée ICI, autour de la collecte seule : le rendu ne coûte rien, et un
  // chiffre qui l'inclurait mesurerait la vitesse du terminal.
  const debut = Date.now();
  const report = await collectDoctorReport(
    parsed.cwd,
    parsed.targetEnv,
    parsed.deep,
    // Sans ce reporter, l'étage profond travaille en SILENCE pendant des
    // minutes et la commande paraît bloquée. La brique était écrite et
    // éprouvée ; c'est la CHAÎNE qui ne l'appelait pas — le défaut que ce
    // dépôt a déjà payé deux fois, et qui ne se voit dans aucun test unitaire.
    reporterProgression(parsed.json),
  );
  return renderDoctorReport(report, parsed, Date.now() - debut);
}

/**
 * Greffe l'étage 2 sur un rapport statique.
 *
 * En UN endroit, parce que la fusion porte une règle : les deux familles de
 * l'étage 2 sont REMPLACÉES, jamais complétées. `collectDoctorReport` les a
 * posées à « non demandé » — les laisser à côté du vrai résultat afficherait
 * deux états pour un seul contrôle, et le sommaire cesserait de dire la vérité.
 *
 * @param report - le rapport statique, tel que la lecture pure l'a produit
 * @param live - ce que l'application démarrée a dit d'elle-même
 * @returns un rapport neuf ; l'entrée n'est pas modifiée
 */
export function attachLive(
  report: IDoctorReport,
  live: ILiveResult,
): IDoctorReport {
  return {
    ...report,
    live,
    execution: { ...report.execution, ...live.execution },
  };
}

/**
 * Rend le rapport et décide du code de sortie.
 *
 * Séparé de la collecte pour une raison précise : `doctor --live` boote, donc
 * il compose son rapport en DEUX temps (les fichiers, puis l'application) et
 * doit rendre le tout par le même chemin. Deux rendus pour un même document
 * finiraient par diverger — et c'est le rendu qui porte la doctrine du verdict.
 *
 * @param report - le rapport complet, étage 2 greffé ou non
 * @param parsed - la demande, telle que la ligne de commande l'a exprimée
 * @returns le code de sortie : 0 si rien à signaler, 1 sinon
 */
export function renderDoctorReport(
  report: IDoctorReport,
  parsed: ICheckRequest,
  dureeMs?: number,
): number {
  const { json, strict } = parsed;
  const start = parsed.cwd;
  const sautes = skippedChecks(report.execution);

  // Le verdict, en UN endroit : les trois portes (humain, JSON, MCP) doivent
  // sortir le même code — un rapport qui affiche un angle mort mais rend 0 là
  // où le JSON rend 1 apprendrait à ne croire ni l'un ni l'autre.
  // Ce qui CONDAMNE en mode strict : les contrôles EMPÊCHÉS, jamais ceux
  // qu'on n'a pas demandés. Les seconds restent rapportés — ils ne valent pas
  // quitus — mais exiger un boot pour qu'une CI passe reviendrait à faire
  // désarmer la commande entière, ce que `--no-strict` existe pour éviter.
  const empeches = preventedChecks(sautes);
  const code = (): number => {
    if (countCheckFindings(report) > 0) return 1;
    return strict && empeches.length > 0 ? 1 : 0;
  };

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, skipped: sautes, strict }, null, 2)}\n`,
    );
    return code();
  }

  const out = process.stdout;
  const lignes = renderReport(report, {
    width: usableWidth(out.columns),
    color: shouldColorize(process.env, Boolean(out.isTTY)),
    now: Date.now(),
    launchedFrom: start,
    strict,
    targetEnv: parsed.targetEnv,
    ...(dureeMs === undefined ? {} : { durationMs: dureeMs }),
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

/**
 * La commande demandée est-elle `doctor` ?
 *
 * L'alias historique `check` a été RETIRÉ : il ne disait pas ce qu'il vérifie,
 * et il entrait en collision de sens avec les scripts `typecheck` et
 * `format:check` d'une application. Aucun paquet `@nodefony/*` n'étant publié
 * (#175), ce nom n'a jamais atteint une application installée.
 *
 * @param requested - le nom de commande lu sur la ligne de commande.
 * @returns `true` pour `doctor`.
 */
export function isDoctorCommand(requested: string | null): boolean {
  return requested === "doctor";
}

/**
 * L'invocation demande-t-elle l'étage 2 — celui qui exige un boot ?
 *
 * Une SEULE implémentation de la règle, parce qu'elle sert à deux endroits qui
 * doivent s'accorder : le fast-path standalone (qui ne se prend PAS quand
 * l'étage 2 est demandé) et le rattrapage d'un boot mort. Écrite deux fois,
 * elle divergerait au premier drapeau ajouté — `--no-live` en est déjà un, que
 * la lecture naïve de `argv` ignorait.
 *
 * @param requested - le nom de commande lu sur la ligne de commande.
 * @param argv - la ligne de commande complète.
 * @returns `true` si l'application doit être démarrée puis interrogée.
 */
export function wantsLiveDoctor(
  requested: string | null,
  argv: readonly string[],
): boolean {
  if (!isDoctorCommand(requested)) return false;
  const parsed = parseDoctorArgv([...argv]);
  // Un argv que la commande refuse (ou un `--help`) n'a pas à booter : le
  // fast-path rendra le refus ou l'usage, sans démarrer quoi que ce soit.
  return "error" in parsed ? false : parsed.live && !parsed.help;
}

/**
 * Rend le rapport de `doctor` alors que l'application vient d'échouer à démarrer.
 *
 * 🔴 C'est le cas POUR lequel la commande existe. `--live` sort du fast-path et
 * demande un boot : sans ce chemin, une application qui ne démarre plus rendait
 * une pile brute et RIEN d'autre — moins que `doctor` nu. L'étage 2 devient
 * alors un état d'exécution lisible (ce qui a manqué, et le geste), et l'étage
 * 1 est rendu comme d'habitude, code de sortie compris.
 *
 * @param argv - la ligne de commande telle qu'elle a été tapée.
 * @param reason - pourquoi l'application n'a pas pu répondre.
 * @param unlock - le geste qui la rendrait interrogeable.
 * @returns le code de sortie du rapport.
 */
export async function runDoctorWithoutLive(
  argv: string[],
  reason: string,
  unlock?: string,
): Promise<number> {
  const parsed = parseDoctorArgv(argv);
  // Un argv que la commande elle-même refuse : c'est le refus qui prime, et
  // `runDoctorCommand` porte déjà sa mise en forme et son code distinct.
  if ("error" in parsed || parsed.help) return runDoctorCommand(argv);
  const start = Date.now();
  const report = await collectDoctorReport(
    parsed.cwd,
    parsed.targetEnv,
    parsed.deep,
    // Sans ce reporter, l'étage profond travaille en SILENCE pendant des
    // minutes et la commande paraît bloquée. La brique était écrite et
    // éprouvée ; c'est la CHAÎNE qui ne l'appelait pas — le défaut que ce
    // dépôt a déjà payé deux fois, et qui ne se voit dans aucun test unitaire.
    reporterProgression(parsed.json),
  );
  return renderDoctorReport(
    attachLive(report, liveNotRun(reason, unlock)),
    parsed,
    Date.now() - start,
  );
}
