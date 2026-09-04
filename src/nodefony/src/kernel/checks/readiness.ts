/**
 * Ce qui empêchera l'application de DÉMARRER — la troisième famille de `check`.
 *
 * Les deux autres regardent le CODE (câblage, dépendances déclarées) : elles
 * répondent « ce que tu as écrit tient-il debout ? ». Celle-ci regarde l'ÉTAT DE
 * L'INSTALLATION et répond à une autre question, celle qu'on se pose quand rien
 * ne démarre : « qu'est-ce qui manque ICI, sur cette machine, maintenant ? ».
 *
 * Cinq manquements, tous constatés au moins une fois en session :
 *
 * - une **variable requise absente** — l'application refuse de démarrer, et le
 *   message natif arrive au milieu d'un journal de boot ; requise ICI, ou
 *   requise LÀ OÙ L'ON VA (`requiredIn`, cf `--env production`) ;
 * - un **fichier `.env*.local` suivi par git** — il porte les secrets de la
 *   machine, et l'historique les garde après suppression ;
 * - un **module du manifeste non installé** — `use("@acme/blog")` déclaré,
 *   paquet absent : le Kernel échoue à l'import, très loin de la cause ;
 * - une **dépendance déclarée non installée** — un `npm install` oublié après un
 *   changement de branche ; l'erreur ne parle que du premier import rencontré ;
 * - un **port déjà tenu** par un processus tiers.
 *
 * ## Deux principes que ces règles ne doivent JAMAIS enfreindre
 *
 * 1. **Ne jamais accuser une situation NORMALE.** Un serveur de développement
 *    qui tourne tient ses ports : c'est l'état sain le plus courant. La règle
 *    des ports distingue donc « tenu par NOUS » (silence) de « tenu par un
 *    tiers » (manquement) — un contrôle qui crie sur le cas nominal est un
 *    contrôle qu'on apprend à ignorer, et il emporte les vrais signaux avec lui.
 * 2. **Ne rien affirmer qu'on ne puisse constater.** Le catalogue des variables
 *    déclarées se lit dans le `dist/` de l'application : sur une application non
 *    construite il est ILLISIBLE, et l'absence de manquement ne prouve alors
 *    rien. Ce cas se DIT (`catalogUnreadable`), il ne se tait pas.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { buildProjectEnvReport } from "../../cli/env";

/** Un manquement qui empêche — ou empêchera — l'application de démarrer. */
export interface IReadinessFinding {
  kind:
    | "env-required-missing"
    | "env-file-tracked"
    | "module-not-installed"
    | "dep-not-installed"
    | "port-busy";
  /** Phrase actionnable : ce qui manque, et le geste qui le répare. */
  message: string;
  /** Fichier qui porte la déclaration, relatif à la racine (si pertinent). */
  file?: string;
}

/** Ce que le contrôle a pu regarder — et ce qu'il n'a PAS pu. */
export interface IReadinessResult {
  findings: IReadinessFinding[];
  /**
   * `true` si le catalogue des variables déclarées n'a pas pu être lu (typique
   * d'une application non construite). Le silence de la règle `env` ne vaut
   * alors pas quitus, et le rapport doit le dire.
   */
  catalogUnreadable: boolean;
  /** Ports effectivement sondés (vide si aucune sonde n'a été fournie). */
  portsProbed: number[];
  /**
   * Pourquoi le contrôle « fichier d'environnement suivi par git » n'a PAS eu
   * lieu — `null` quand il a regardé.
   *
   * Sans dépôt git, l'absence de trouvaille ne prouve rien : c'est le cas
   * qu'un outil de diagnostic doit ÉNONCER plutôt qu'afficher en vert.
   */
  trackedUnknown: string | null;
}

/**
 * Le VERDICT d'une sonde de port, injecté — jamais mesuré ici.
 *
 * Une capacité se CONSTATE et se transmet ; la faire mesurer par la règle
 * l'aurait rendue inéprouvable sans ouvrir de vrais ports, donc non testée sur
 * la seule branche qui compte (le port tenu par un tiers).
 */
export interface IPortProbe {
  /** Ports effectivement sondés par l'appelant. */
  probed: readonly number[];
  /** Ceux qui sont TENUS. */
  busy: readonly number[];
  /**
   * `true` si ce qui tient ces ports est NOTRE runtime (superviseur de
   * développement, serveur lancé par `nodefony`). C'est l'état sain le plus
   * courant : la règle se tait alors.
   */
  ownedByUs: boolean;
}

/**
 * Le VERDICT de git sur les fichiers d'environnement — injecté, jamais mesuré ici.
 *
 * Même raison que la sonde de ports : une capacité se CONSTATE et se transmet.
 * Lancer `git` depuis la règle la rendrait inéprouvable sans dépôt, donc non
 * testée sur la seule branche qui compte — celle où un secret est versionné.
 */
export interface ITrackedEnvProbe {
  /**
   * `false` si git n'a rien pu dire (pas un dépôt, binaire absent). Le contrôle
   * est alors SAUTÉ — pas vert.
   */
  supported: boolean;
  /** Fichiers d'environnement LOCAUX effectivement suivis, relatifs à la racine. */
  tracked: readonly string[];
  /** Ce qui a empêché de constater — présent seulement si `supported` est faux. */
  reason?: string;
}

/** Retire les commentaires pour qu'un exemple commenté ne compte pas. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

/**
 * Noms des briques déclarées dans le manifeste `modules` de `nodefony.config.ts`.
 *
 * Lecture TEXTUELLE, et c'est un choix : le manifeste est du TypeScript, il ne
 * s'évalue pas sans construire l'application — or c'est précisément une
 * application qui ne démarre pas qu'on veut diagnostiquer. On y perd les appels
 * construits dynamiquement ; on y gagne de répondre quand rien d'autre ne
 * répond. Un nom non littéral est simplement ignoré, jamais deviné.
 *
 * @param source - contenu de `nodefony.config.ts`.
 * @returns les noms passés à `use("…")`, dédoublonnés, dans l'ordre de lecture.
 */
export function declaredModules(source: string): string[] {
  const noms = new Set<string>();
  for (const [, nom] of sansCommentaires(source).matchAll(
    /\buse\(\s*["'`]([^"'`]+)["'`]/gu,
  )) {
    noms.add(nom);
  }
  return [...noms];
}

/**
 * `true` si le paquet est résolvable depuis l'application.
 *
 * Deux façons de l'être, toutes deux légitimes : présent dans `node_modules`
 * (installé ou lié par npm), ou porté par un espace de travail local
 * (`modules/<nom-court>` — ce que produit `nodefony create module`, avant même
 * que `npm install` n'ait posé le lien).
 */
function isModuleResolvable(projectRoot: string, name: string): boolean {
  if (existsSync(path.join(projectRoot, "node_modules", name))) return true;
  const court = name.includes("/")
    ? name.slice(name.lastIndexOf("/") + 1)
    : name;
  return existsSync(path.join(projectRoot, "modules", court));
}

/**
 * Contrôle l'état d'installation et l'environnement d'une application.
 *
 * @param input.projectRoot - racine de l'application (porte `nodefony.config.ts`).
 * @param input.probe - sonde de ports, ou `null` pour ne pas sonder (le contrôle
 *   reste alors purement fichiers).
 * @returns les manquements, et ce qui n'a pas pu être contrôlé.
 */
export async function checkReadiness(input: {
  projectRoot: string;
  probe?: IPortProbe | null;
  /**
   * Environnement à ÉVALUER, s'il n'est pas celui d'ici (`doctor --env
   * production`). Les valeurs restent celles de la machine.
   */
  targetEnv?: string | null;
  /** Verdict de git sur les fichiers d'environnement, ou `null` pour ne pas regarder. */
  tracked?: ITrackedEnvProbe | null;
}): Promise<IReadinessResult> {
  const { projectRoot } = input;
  const targetEnv = input.targetEnv ?? null;
  const findings: IReadinessFinding[] = [];

  // ─── 1. Variables d'environnement REQUISES ────────────────────────────────
  // Déléguée à la brique de `nodefony env` : une seconde définition de « quelle
  // valeur est effective » divergerait de la première sans que rien ne le dise.
  const env = await buildProjectEnvReport(projectRoot, projectRoot, targetEnv);
  const catalogUnreadable = env.vars.length === 0;
  for (const v of env.vars.filter((x) => x.missing)) {
    // Une variable requise ICI et une variable requise LÀ-BAS n'appellent pas
    // le même geste : la première empêche de démarrer maintenant, la seconde
    // attend le déploiement. Un message unique enverrait chercher une panne
    // locale qui n'existe pas.
    const ailleurs = targetEnv !== null;
    findings.push({
      kind: "env-required-missing",
      message: ailleurs
        ? `la variable ${v.name} est REQUISE en ${targetEnv} et n'a aucune valeur ici — ` +
          `le déploiement refusera de démarrer : la poser dans l'environnement ` +
          `du conteneur (Secret k8s, vault), jamais en git`
        : `la variable REQUISE ${v.name} n'a aucune valeur — l'application ne démarrera pas : ` +
          `la poser dans .env (ou dans l'environnement du conteneur)`,
      file: ".env",
    });
  }

  // ─── 1 bis. Un secret local SUIVI par git ─────────────────────────────────
  // Les fichiers `.env*.local` portent les secrets de la machine — c'est la
  // convention que le framework écrit lui-même dans `.env.example`. Versionné,
  // un tel fichier met ses secrets dans l'historique, d'où ils ne partent plus :
  // le retirer de l'index ne réécrit pas les commits déjà poussés.
  const trackedUnknown =
    input.tracked && !input.tracked.supported
      ? (input.tracked.reason ?? "git n'a rien pu dire de ce dossier")
      : input.tracked
        ? null
        : "aucun verdict git n'a été fourni à ce contrôle";
  for (const file of input.tracked?.supported ? input.tracked.tracked : []) {
    findings.push({
      kind: "env-file-tracked",
      // Le geste se sépare par la flèche — c'est la convention que le rendu
      // lit pour le poser seul sur sa ligne et le reprendre dans « à faire
      // ensuite ». Noyé dans la phrase, il ne se copie pas.
      message:
        `${file} est SUIVI par git — il porte les secrets de la machine, et ` +
        `l'historique les garde même après suppression : tout secret déjà ` +
        `poussé est COMPROMIS, il faut le faire tourner. Puis ajouter le ` +
        `fichier à .gitignore. → git rm --cached ${file}`,
      file,
    });
  }

  // ─── 2 & 3. Ce qui est DÉCLARÉ est-il INSTALLÉ ? ──────────────────────────
  const manifeste = path.join(projectRoot, "nodefony.config.ts");
  if (existsSync(manifeste)) {
    let source = "";
    try {
      source = readFileSync(manifeste, "utf8");
    } catch {
      source = "";
    }
    for (const nom of declaredModules(source)) {
      if (isModuleResolvable(projectRoot, nom)) continue;
      findings.push({
        kind: "module-not-installed",
        // Ce message a dit le CONTRAIRE de ce que fait le framework, et c'est
        // pire qu'un silence : il annonçait « le démarrage échouera à l'import »,
        // envoyant chercher un crash qui n'existe pas. Mesuré : le Kernel charge
        // les modules en fail-soft, l'application démarre, et le bilan dit
        // « BOOT dégradé — 1 en échec ». C'est exactement le cas que `check` est
        // seul à savoir redire APRÈS coup — encore faut-il qu'il le décrive.
        message:
          `le manifeste charge "${nom}" mais le paquet est INTROUVABLE ` +
          `(ni dans node_modules, ni dans modules/) — le boot ne s'arrêtera PAS : ` +
          `le module est écarté (fail-soft) et l'application démarre AMPUTÉE de ` +
          `ce qu'il apporte, sans erreur au point d'usage : ` +
          `npm install ${nom}, ou retirer la ligne du manifeste`,
        file: "nodefony.config.ts",
      });
    }
  }

  const pkgFile = path.join(projectRoot, "package.json");
  if (existsSync(pkgFile)) {
    let pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } = {};
    try {
      pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as typeof pkg;
    } catch {
      pkg = {};
    }
    // Les `devDependencies` comptent AUSSI : une application qui ne démarre pas
    // en développement est très exactement le cas qu'on diagnostique. En
    // revanche l'absence totale de `node_modules` ne se rapporte pas paquet par
    // paquet — ce serait cent lignes pour dire « npm install ».
    if (existsSync(path.join(projectRoot, "node_modules"))) {
      const declared = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const nom of Object.keys(declared)) {
        // Une plage `file:`/`link:` non installée reste un défaut d'install,
        // mais le chemin de résolution est le même : présence du dossier.
        if (existsSync(path.join(projectRoot, "node_modules", nom))) continue;
        findings.push({
          kind: "dep-not-installed",
          message:
            `${nom} est déclaré dans package.json mais ABSENT de node_modules — ` +
            `l'erreur au démarrage ne nommera que le premier import rencontré : npm install`,
          file: "package.json",
        });
      }
    }
  }

  // ─── 4. Ports déjà tenus ──────────────────────────────────────────────────
  const portsProbed = [...(input.probe?.probed ?? [])];
  if (input.probe && !input.probe.ownedByUs) {
    for (const port of input.probe.busy) {
      findings.push({
        kind: "port-busy",
        message:
          `le port ${port} est déjà tenu par un autre processus — le démarrage ` +
          `échouera en EADDRINUSE : nodefony status pour voir ce qui tourne, ` +
          `nodefony stop pour un runtime Nodefony`,
      });
    }
  }

  return { findings, catalogUnreadable, portsProbed, trackedUnknown };
}
