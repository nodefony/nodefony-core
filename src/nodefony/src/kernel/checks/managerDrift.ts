/**
 * Le projet est-il cohérent avec SON gestionnaire de paquets ? — règle de
 * `readiness`.
 *
 * Le cas visé : une application née sous npm, passée à pnpm ou bun (ou
 * l'inverse) sans être régénérée. Chaque gestionnaire ne lit que SES fichiers,
 * et aucun ne prévient de ce qu'il ignore : un override posé au mauvais endroit
 * ne s'applique pas, un module local non déclaré n'est pas lié — et l'erreur
 * arrive au démarrage, sur « Cannot find package », loin de la cause.
 *
 * Tout se CONSTATE sur des fichiers, rien n'est exécuté. Le gestionnaire est
 * celui de la décision unique du framework ({@link resolvePackageManager}), et
 * le contrôle ne parle que lorsqu'elle repose sur un fait du projet — un verrou
 * ou la configuration : sans eux, ce serait juger le projet sur l'outil qui a
 * lancé `doctor`.
 *
 * La réparation reste hors d'ici : chaque constat NOMME le geste.
 */
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  LOCKFILES,
  isPackageManagerName,
  needsWorkspaceProtocol,
  packageManagerCommandLines,
  resolvePackageManager,
} from "../../cli/packageManager";
import type { PackageManagerName } from "../../Cli";

/** Un écart entre le projet et son gestionnaire de paquets. */
export interface IManagerDriftFinding {
  /** Phrase actionnable : ce qui est ignoré ou cassé, et le geste. */
  message: string;
  /** Fichier à corriger, relatif à la racine. */
  file: string;
}

/** Accès disque, injectables pour l'épreuve. */
export interface IManagerDriftFs {
  exists: (file: string) => boolean;
  read: (file: string) => string;
  listDir: (dir: string) => string[];
}

const diskFs: IManagerDriftFs = {
  exists: existsSync,
  read: (file) => readFileSync(file, "utf8"),
  listDir: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/**
 * Ce qu'un `node_modules` garde de l'outil qui l'a installé.
 *
 * Seuls des marqueurs documentés : bun n'en laisse aucun de stable, il n'est
 * donc jamais désigné ici — une capacité se constate, elle ne se devine pas.
 */
const INSTALL_MARKERS: readonly (readonly [string, PackageManagerName])[] = [
  [".modules.yaml", "pnpm"],
  [".package-lock.json", "npm"],
  [".yarn-integrity", "yarn"],
];

interface IRootManifest {
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: unknown;
  resolutions?: unknown;
  allowScripts?: unknown;
}

/**
 * Noms des paquets locaux du projet, lus dans les dossiers `<dir>/*` que
 * déclarent ses workspaces.
 */
function localPackages(
  root: string,
  manifest: IRootManifest,
  fs: IManagerDriftFs,
): string[] {
  const declared = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const names: string[] = [];
  for (const pattern of declared) {
    if (!pattern.endsWith("/*")) continue;
    const dir = path.join(root, ...pattern.slice(0, -2).split("/"));
    for (const entry of fs.listDir(dir)) {
      const file = path.join(dir, entry, "package.json");
      if (!fs.exists(file)) continue;
      try {
        const name = (JSON.parse(fs.read(file)) as { name?: unknown }).name;
        if (typeof name === "string") names.push(name);
      } catch {
        // Un manifeste illisible est l'affaire d'un autre contrôle.
      }
    }
  }
  return names;
}

/**
 * Confronte le projet à son gestionnaire de paquets.
 *
 * @param input.projectRoot - racine de l'application
 * @param input.configured - `packageManager` déclaré dans la configuration
 * @param input.fs - accès disque (défaut : le disque)
 * @returns les écarts constatés, vides quand le gestionnaire n'est pas établi
 */
export function checkManagerDrift(input: {
  projectRoot: string;
  configured?: PackageManagerName | null;
  fs?: IManagerDriftFs;
}): IManagerDriftFinding[] {
  const { projectRoot: root } = input;
  const fs = input.fs ?? diskFs;
  const findings: IManagerDriftFinding[] = [];
  const at = (file: string): string => path.join(root, file);

  const resolved = resolvePackageManager({
    configured: input.configured ?? undefined,
    dir: root,
    exists: fs.exists,
  });
  const locked = [
    ...new Set(
      LOCKFILES.filter(([file]) => fs.exists(at(file))).map(([, pm]) => pm),
    ),
  ];
  // Sans verrou ni configuration, la décision vient de l'outil qui a LANCÉ
  // doctor : rien du projet ne permet de juger.
  if (resolved.source !== "config" && resolved.source !== "lockfile") {
    return findings;
  }
  const pm = resolved.name;
  const cmd = packageManagerCommandLines(pm);

  // ─── Verrous ──────────────────────────────────────────────────────────────
  if (locked.length > 1) {
    findings.push({
      message:
        `deux gestionnaires ont laissé leur verrou (${locked.join(", ")}) — ` +
        `${pm} est retenu, et installer avec un autre mélange deux arbres dans ` +
        `node_modules : supprime le verrou de l'outil abandonné, puis ${cmd.install}`,
      file: LOCKFILES.find(([, name]) => name === pm)?.[0] ?? "package.json",
    });
  }
  if (
    resolved.source === "config" &&
    locked.length > 0 &&
    !locked.includes(pm)
  ) {
    findings.push({
      message:
        `la configuration désigne ${pm}, mais le verrou est celui de ` +
        `${locked.join(", ")} — l'arbre installé n'est pas celui que ` +
        `\`nodefony install\` produira : retire l'ancien verrou puis ${cmd.install}`,
      file: "nodefony.config.ts",
    });
  }
  const installer = INSTALL_MARKERS.find(([marker]) =>
    fs.exists(path.join(root, "node_modules", marker)),
  )?.[1];
  if (installer !== undefined && installer !== pm) {
    findings.push({
      message:
        `node_modules a été installé par ${installer}, le projet est sous ${pm} — ` +
        `les liens et le hissage diffèrent d'un outil à l'autre : supprime ` +
        `node_modules puis ${cmd.install}`,
      file: "package.json",
    });
  }

  // ─── Manifeste ────────────────────────────────────────────────────────────
  if (!fs.exists(at("package.json"))) return findings;
  let manifest: IRootManifest;
  try {
    manifest = JSON.parse(fs.read(at("package.json"))) as IRootManifest;
  } catch {
    return findings;
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const locals = localPackages(root, manifest, fs);
  // yarn ≥ 2 comprend `workspace:` ; yarn 1 non. Son fichier de réglages le dit.
  const yarnBerry = pm === "yarn" && fs.exists(at(".yarnrc.yml"));

  if (needsWorkspaceProtocol(pm)) {
    for (const name of locals.filter((n) => deps[n] === undefined)) {
      findings.push({
        message:
          `${pm} ne lie à la racine que les modules qu'elle déclare : "${name}" ` +
          `n'y est pas, son import échouera au démarrage — ajoute ` +
          `"${name}": "workspace:*" aux dependencies, puis ${cmd.install}`,
        file: "package.json",
      });
    }
  } else if (!yarnBerry) {
    const protocol = Object.entries(deps).filter(([, v]) =>
      v.startsWith("workspace:"),
    );
    for (const [name] of protocol) {
      findings.push({
        message:
          `"${name}" est déclaré en workspace:, que ${pm} refuse ` +
          `(l'installation s'arrête) — ${pm} lie ses workspaces d'office : ` +
          `retire la ligne, puis ${cmd.install}`,
        file: "package.json",
      });
    }
  }

  if (pm === "pnpm") {
    const yamlFile = at("pnpm-workspace.yaml");
    const yaml = fs.exists(yamlFile) ? fs.read(yamlFile) : null;
    if (
      locals.length > 0 &&
      (yaml === null || !/^\s*packages\s*:/mu.test(yaml))
    ) {
      findings.push({
        message:
          `pnpm ne lit pas le champ workspaces du package.json : sans ` +
          `\`packages\` dans pnpm-workspace.yaml, ${locals.join(", ")} ne ` +
          `sont pas liés — déclare-y les dossiers de modules (\`- "modules/*"\`), ` +
          `puis ${cmd.install}`,
        file: "pnpm-workspace.yaml",
      });
    }
    if (manifest.overrides !== undefined) {
      findings.push({
        message:
          `pnpm ignore les \`overrides\` du package.json : ils ne s'appliquent ` +
          `pas — déplace-les sous \`overrides:\` dans pnpm-workspace.yaml ` +
          `(forme \`"parent>dep": "version"\`)`,
        file: "package.json",
      });
    }
    if (
      manifest.allowScripts !== undefined &&
      (yaml === null || !/^\s*allowBuilds\s*:/mu.test(yaml))
    ) {
      findings.push({
        message:
          `\`allowScripts\` n'est lu que par npm : sous pnpm, une dépendance qui ` +
          `a un script d'installation arrête \`pnpm install\` ` +
          `(ERR_PNPM_IGNORED_BUILDS) — reporte ces décisions sous ` +
          `\`allowBuilds:\` dans pnpm-workspace.yaml`,
        file: "pnpm-workspace.yaml",
      });
    }
  }
  if (
    pm === "yarn" &&
    manifest.overrides !== undefined &&
    manifest.resolutions === undefined
  ) {
    findings.push({
      message:
        `yarn ignore \`overrides\` : ils ne s'appliquent pas — réécris-les ` +
        `en \`resolutions\` (forme \`"parent/dep": "version"\`)`,
      file: "package.json",
    });
  }
  if (
    pm === "npm" &&
    manifest.resolutions !== undefined &&
    manifest.overrides === undefined
  ) {
    findings.push({
      message:
        `npm ignore \`resolutions\` : ils ne s'appliquent pas — réécris-les ` +
        `en \`overrides\``,
      file: "package.json",
    });
  }
  return findings;
}

/**
 * Lit le `packageManager` déclaré dans le code du manifeste de configuration.
 *
 * @param manifestCode - source de `nodefony.config.ts` et de ses fragments
 * @returns le gestionnaire déclaré, ou `null`
 */
export function declaredPackageManager(
  manifestCode: string,
): PackageManagerName | null {
  const value = /\bpackageManager\s*:\s*["']([a-z]+)["']/u.exec(
    manifestCode,
  )?.[1];
  return isPackageManagerName(value) ? value : null;
}
