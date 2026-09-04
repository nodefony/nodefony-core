/**
 * Vérification de la surface d'un paquet : ce qu'il importe, ce qu'il publie.
 *
 * Deux fautes que rien n'attrape pendant le développement, parce qu'elles ne se
 * paient jamais là où on travaille :
 *
 *  1. **Importer sans déclarer.** Dans un dépôt à espaces de travail, npm hisse
 *     les paquets à la racine : `@nodefony/http` se résout depuis n'importe où,
 *     déclaré ou non. Ailleurs, deux choses cassent — l'ordre de construction
 *     (turbo n'ordonne que les dépendances DÉCLARÉES, et la sortie de la fois
 *     précédente masque la panne jusqu'au premier nettoyage) et l'installation
 *     réelle (`npm i` n'amène pas ce qui n'est pas déclaré).
 *  2. **Publier des types injoignables.** Un `exports["."].types` qui pointe un
 *     fichier absent du champ `files` donne un paquet sans aucun type après
 *     installation. Le dépôt d'origine ne le voit pas : la source y est.
 *
 * Cette logique est partagée par la commande `nodefony doctor` et par la garde
 * de pré-commit du dépôt du framework — une seule implémentation, sinon les
 * deux divergent (c'est exactement la faute qu'on cherche ici).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Un manquement relevé sur un paquet. */
export interface IPackageFinding {
  /** Nom npm du paquet fautif. */
  package: string;
  kind:
    | "undeclared-import"
    | "peer-only-sibling"
    | "unreachable-types"
    | "unresolvable-by-require"
    | "stale-exception";
  /** Phrase lisible, déjà orientée vers la correction. */
  message: string;
  /** Fichier qui porte le premier cas, relatif à la racine analysée. */
  file?: string;
}

export interface IPackageCheckOptions {
  /**
   * Dossiers à explorer. Chacun est soit un paquet (il porte un
   * `package.json`), soit un dossier de paquets (`src/packages/@nodefony`).
   */
  roots: string[];
  /** Racine servant à raccourcir les chemins affichés. */
  cwd?: string;
  /**
   * Cycles de types ASSUMÉS (`importeur → [importés]`). Un cycle de types est
   * effacé à la compilation, donc légal ; mais il interdit de déclarer la
   * réciproque, que npm et turbo refuseraient. Les nommer ici est ce qui
   * distingue « assumé » de « oublié » — et une entrée qui ne correspond plus
   * à aucun import est signalée, pour que la liste ne devienne pas un folklore.
   */
  typeCycles?: Record<string, string[]>;
  /**
   * Paquets dont on sait que les types publiés sont injoignables, en dette.
   * Même règle : une dette soldée qui reste inscrite est signalée.
   */
  typesUnreachable?: string[];
}

export interface IPackageCheckResult {
  findings: IPackageFinding[];
  /** Nombre de paquets réellement analysés. */
  scanned: number;
}

/**
 * Une VRAIE déclaration d'import, ancrée en début de ligne.
 *
 * L'ancre n'est pas cosmétique : un générateur de code écrit des `import … from
 * "@nodefony/…"` **dans des chaînes de gabarit**, destinés à une autre
 * application. Sans elle, on réclame une dépendance pour du texte.
 */
const IMPORT_RE =
  /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["'](@nodefony\/[a-z0-9-]+|nodefony)(?:\/[a-z0-9-]+)?["']/gm;

const DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

interface IScannedPackage {
  dir: string;
  manifest: Record<string, unknown>;
  name: string;
}

function readManifest(dir: string): IScannedPackage | null {
  const pj = path.join(dir, "package.json");
  try {
    // Pas de `statSync` avant la lecture : le fichier peut disparaître entre
    // les deux (TOCTOU), et `readFileSync` lève ENOENT — que le `catch`
    // ci-dessous rend déjà en `null`. Un appel système de moins par dossier,
    // sur un balayage qui parcourt tout le dépôt.
    const manifest = JSON.parse(readFileSync(pj, "utf8")) as Record<
      string,
      unknown
    >;
    const name = typeof manifest.name === "string" ? manifest.name : "";
    return name ? { dir, manifest, name } : null;
  } catch {
    return null;
  }
}

/**
 * Sous-chemins d'`exports` qui déclarent `import` sans `default`.
 *
 * **Ce n'est pas une concession au CommonJS.** Un seul artefact est publié, et
 * il est ESM ; `import` reste la première condition essayée. `default` ne dit
 * qu'une chose : quand un résolveur ne connaît AUCUNE de nos conditions, voici
 * le fichier — au lieu de « ce paquet n'exporte rien », qui est faux et
 * indébogable. Node sait charger un module ESM depuis un `require` depuis la 22.
 *
 * Le cas qui l'a fait écrire : un outil de génération de migrations résout en
 * CommonJS ; une entité d'application qui importait un paquet du framework
 * faisait échouer la génération sur une erreur de résolution sans rapport avec
 * la faute. Treize paquets sur quinze étaient concernés — c'était une dérive,
 * pas une décision : le cœur, lui, déclarait `default` depuis toujours.
 *
 * ⚠️ `default` doit être la DERNIÈRE condition : la résolution s'arrête à la
 * première qui correspond, et celle-ci correspond toujours. Placée avant
 * `import`, elle les court-circuiterait toutes.
 *
 * @param manifest - manifeste lu.
 * @returns les sous-chemins fautifs (`.`, `./testing`…), vide si tout va bien.
 */
function conditionsWithoutDefault(manifest: Record<string, unknown>): string[] {
  const exports = manifest.exports;
  if (typeof exports !== "object" || exports === null) {
    return [];
  }
  const out: string[] = [];
  for (const [sub, value] of Object.entries(
    exports as Record<string, unknown>,
  )) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const conditions = value as Record<string, unknown>;
    if (conditions.import !== undefined && conditions.default === undefined) {
      out.push(sub);
    }
  }
  return out;
}

/** Les paquets sous une racine : elle-même si c'en est un, sinon ses enfants. */
function collectPackages(roots: string[]): IScannedPackage[] {
  const out: IScannedPackage[] = [];
  for (const root of roots) {
    if (!statSync(root, { throwIfNoEntry: false })) {
      continue;
    }
    const self = readManifest(root);
    if (self) {
      out.push(self);
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pkg = readManifest(path.join(root, entry.name));
      if (pkg) {
        out.push(pkg);
      }
    }
  }
  return out;
}

/**
 * Sources qui ENGAGENT le consommateur : celles qui partent dans le paquet.
 *
 * Les tests sont écartés à dessein — `files` ne les embarque pas, donc leurs
 * imports n'obligent personne à installer quoi que ce soit. Les compter ferait
 * réclamer une dépendance pour un fichier que le consommateur ne reçoit jamais.
 */
function shippedSources(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === "tests" ||
        e.name.startsWith(".")
      ) {
        continue;
      }
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        found.push(p);
      }
    }
  };
  walk(dir);
  return found;
}

/**
 * Noms des paquets fournis par les ESPACES DE TRAVAIL d'un manifeste.
 *
 * Un manifeste qui déclare `workspaces` installe et relie ses membres lui-même :
 * c'est le rôle du champ. Exiger qu'il les redéclare en dépendances serait
 * exiger le contraire de ce que npm attend, et ferait crier l'outil sur la
 * racine de tout monorepo — donc lui apprendrait à être ignoré.
 *
 * Seule la forme `dossier/*` est développée (celle qu'utilisent npm et ce
 * dépôt) ; un motif plus exotique est simplement ignoré, jamais deviné.
 */
function workspaceMembers(
  dir: string,
  manifest: Record<string, unknown>,
): string[] {
  const globs = manifest.workspaces;
  if (!Array.isArray(globs)) {
    return [];
  }
  const names: string[] = [];
  for (const glob of globs) {
    if (typeof glob !== "string") {
      continue;
    }
    if (glob.endsWith("/*")) {
      const parent = path.join(dir, glob.slice(0, -2));
      let entries;
      try {
        entries = readdirSync(parent, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) {
          continue;
        }
        const pkg = readManifest(path.join(parent, e.name));
        if (pkg) {
          names.push(pkg.name);
        }
      }
    } else {
      const pkg = readManifest(path.join(dir, glob));
      if (pkg) {
        names.push(pkg.name);
      }
    }
  }
  return names;
}

/** Le chemin déclaré pour les types tombe-t-il dans ce que `files` embarque ? */
function typesAreShipped(manifest: Record<string, unknown>): boolean | null {
  const exports = manifest.exports as
    Record<string, { types?: string }> | undefined;
  const declared =
    exports?.["."]?.types ?? (manifest.types as string | undefined);
  if (!declared) {
    return null; // pas de surface de types : rien à vérifier
  }
  const files = (manifest.files as string[] | undefined) ?? [];
  const target = declared.replace(/^\.\//, "");
  return files.some((f) => target.startsWith(f.replace(/\/?\*+$/, "")));
}

/**
 * Analyse les paquets et rend les manquements trouvés.
 *
 * @param options - racines à explorer, exceptions assumées.
 * @returns les manquements et le nombre de paquets analysés.
 */
export function checkPackageDeps(
  options: IPackageCheckOptions,
): IPackageCheckResult {
  const cwd = options.cwd ?? process.cwd();
  const typeCycles = options.typeCycles ?? {};
  const typesUnreachable = options.typesUnreachable ?? [];
  const packages = collectPackages(options.roots);
  const findings: IPackageFinding[] = [];
  /**
   * Les paquets CONSTRUITS ici — ceux dont l'ordre de construction se décide.
   *
   * C'est le seul cas où `peerDependencies` ne suffit pas : un paquet venu de
   * `node_modules` arrive déjà construit, alors qu'un frère du dépôt doit
   * l'être AVANT. Dans une application, cet ensemble ne contient que ses
   * propres modules — la règle n'y mord donc jamais sur `nodefony`.
   */
  const siblings = new Set(packages.map((p) => p.name));

  for (const { dir, manifest, name } of packages) {
    const declared = new Set(
      DEP_FIELDS.flatMap((k) =>
        Object.keys((manifest[k] as Record<string, string> | undefined) ?? {}),
      ),
    );
    // Un manifeste qui déclare des ESPACES DE TRAVAIL fournit lui-même ses
    // membres : npm les installe et les relie, c'est le rôle du champ. Exiger
    // qu'il les redéclare en dépendances serait exiger le contraire de ce que
    // npm attend — et ferait crier l'outil sur la racine de tout monorepo, donc
    // lui apprendrait à être ignoré.
    // On lit la DÉCLARATION, pas les dossiers qu'on a explorés : un membre
    // peut être fourni sans avoir été scanné (la racine du framework déclare
    // `src/nodefony`, que la commande n'explore pas).
    const members = workspaceMembers(dir, manifest);
    for (const member of members) {
      declared.add(member);
    }
    const allowed = new Set(typeCycles[name] ?? []);
    /**
     * Déclaré, mais d'une façon qui n'ORDONNE rien.
     *
     * npm et turbo bâtissent le graphe sur `dependencies` et
     * `devDependencies` ; une `peerDependency` seule dit ce qu'il faut
     * fournir, jamais quand le construire. Vécu : `@nodefony/devkit` ne
     * déclarait ses frères qu'ainsi — son `rolldown.config.ts` importe
     * `nodefony/bundler`, donc il se construisait avant que ce fichier existe.
     * En local la sortie de la fois d'avant masquait la panne ; quatre
     * workflows sont tombés sur `Cannot find module … dist/node/bundler`.
     */
    const ordering = new Set(
      ["dependencies", "devDependencies", "optionalDependencies"].flatMap((k) =>
        Object.keys((manifest[k] as Record<string, string> | undefined) ?? {}),
      ),
    );
    // 🔴 **`workspaces` ORDONNE aussi.** La dispense ci-dessus n'avait été posée
    // que sur « déclaré » : un membre y échappait au verdict « non déclaré »
    // pour retomber dans « déclaré en peerDependencies SEULE », dont le message
    // prescrit précisément ce que le commentaire ci-dessus dit de ne pas exiger
    // — et l'annonce sur une racine qui n'a aucune peerDependency. C'est par ce
    // champ que npm installe et relie ses membres, et que turbo bâtit son
    // graphe : c'est la façon CORRECTE de l'écrire à la racine, pas une façon
    // au rabais. Une garde posée à un seul de deux endroits ne garde rien.
    for (const member of members) {
      ordering.add(member);
    }
    const peerOnly = new Map<string, string>();
    // On garde le PIRE cas avec SON fichier : citer un `import type` sous un
    // verdict « runtime » enverrait corriger au mauvais endroit.
    const missing = new Map<string, { file: string; typeOnly: boolean }>();

    for (const file of shippedSources(dir)) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const m of src.matchAll(IMPORT_RE)) {
        const typeOnly = Boolean(m[1]);
        const dep = m[2];
        // On ne restreint PAS aux paquets présents dans les racines explorées :
        // dans une application, tous les paquets Nodefony viennent de
        // `node_modules`, donc un tel filtre ne contrôlerait jamais rien — le
        // cas même pour lequel cette vérification existe.
        if (dep === name) {
          continue;
        }
        const rel = path.relative(cwd, file);
        if (declared.has(dep) || allowed.has(dep)) {
          // Un import de TYPE ne crée aucun ordre : il est effacé à la
          // compilation, et les paquets lus en source pointent leurs `types`
          // vers `./index.ts` justement pour ne pas exiger d'être construits.
          // Un cycle assumé non plus : y déclarer la réciproque est ce que npm
          // et turbo refusent — c'est la raison d'être de la liste.
          if (
            !typeOnly &&
            !allowed.has(dep) &&
            siblings.has(dep) &&
            !ordering.has(dep) &&
            !peerOnly.has(dep)
          ) {
            peerOnly.set(dep, rel);
          }
          continue;
        }
        const seen = missing.get(dep);
        if (!seen) {
          missing.set(dep, { file: rel, typeOnly });
        } else if (seen.typeOnly && !typeOnly) {
          missing.set(dep, { file: rel, typeOnly: false });
        }
      }
    }

    for (const [dep, { file, typeOnly }] of missing) {
      findings.push({
        package: name,
        kind: "undeclared-import",
        file,
        message: typeOnly
          ? `${name} importe ${dep} (type seul) sans le déclarer — soit peerDependencies, soit un cycle assumé si ${dep} déclare déjà ${name}`
          : `${name} importe ${dep} à l'exécution sans le déclarer — ajouter "${dep}": "*" en peerDependencies`,
      });
    }

    for (const [dep, file] of peerOnly) {
      findings.push({
        package: name,
        kind: "peer-only-sibling",
        file,
        message: `${name} importe ${dep}, construit dans ce dépôt, en ne le déclarant qu'en peerDependencies — rien n'ORDONNE les deux constructions : ajouter "${dep}": "*" en devDependencies`,
      });
    }

    if (manifest.private !== true) {
      for (const sub of conditionsWithoutDefault(manifest)) {
        findings.push({
          package: name,
          kind: "unresolvable-by-require",
          message: `${name} n'expose "${sub}" qu'en condition "import" — tout résolveur qui ne la connaît pas reçoit ERR_PACKAGE_PATH_NOT_EXPORTED : ajouter "default" (le MÊME fichier, en DERNIÈRE condition)`,
        });
      }
      const shipped = typesAreShipped(manifest);
      const known = typesUnreachable.includes(name);
      if (shipped === false && !known) {
        findings.push({
          package: name,
          kind: "unreachable-types",
          message: `${name} publie des types hors de "files" — après "npm i", le consommateur n'en a aucun`,
        });
      } else if (shipped === true && known) {
        findings.push({
          package: name,
          kind: "stale-exception",
          message: `${name} publie désormais ses types — le retirer de la liste des dettes`,
        });
      }
    }
  }

  // Une exception qui ne correspond plus à rien doit sortir de la liste, sinon
  // celle-ci devient un folklore que plus personne ne relit.
  for (const [pkgName, deps] of Object.entries(typeCycles)) {
    const pkg = packages.find((p) => p.name === pkgName);
    if (!pkg) {
      findings.push({
        package: pkgName,
        kind: "stale-exception",
        message: `un cycle est déclaré pour ${pkgName}, qui n'existe plus`,
      });
      continue;
    }
    const src = shippedSources(pkg.dir)
      .map((f) => {
        try {
          return readFileSync(f, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    for (const dep of deps) {
      if (!src.includes(`"${dep}"`) && !src.includes(`'${dep}'`)) {
        findings.push({
          package: pkgName,
          kind: "stale-exception",
          message: `${pkgName} n'importe plus ${dep} — retirer ce cycle de la liste`,
        });
      }
    }
  }

  return { findings, scanned: packages.length };
}
