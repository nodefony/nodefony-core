import fs from "node:fs";
import path from "node:path";

/**
 * Un script `npm` du projet courant, tel que l'aide le rend.
 */
export interface IProjectScript {
  /** Nom du script, celui qu'on tape après `npm run`. */
  readonly name: string;
  /** La commande exécutée, telle quelle. */
  readonly command: string;
  /** Ce qu'il fait, en une phrase — `null` si le projet ne l'a pas déclaré. */
  readonly description: string | null;
}

/**
 * Forme attendue d'un `package.json`, réduite à ce qu'on y lit.
 *
 * `nodefony.scripts` est un objet `{ nom: "description" }`. Le préfixe dit à qui
 * appartient la donnée : `package.json` est un terrain partagé, et un champ nu
 * comme `scriptsInfo` est revendiqué par d'autres outils.
 */
interface IPackageManifest {
  // Manifeste lu du disque : `null` y est une valeur JSON légitime.
  scripts?: Record<string, string> | null;
  nodefony?: { scripts?: Record<string, string> };
}

/**
 * Apparie les scripts d'un manifeste avec leurs descriptions.
 *
 * Fonction **pure** : elle ne touche pas au disque, ce qui la rend éprouvable
 * sans monter un projet. Les scripts sortent dans l'ordre du manifeste — c'est
 * celui que l'auteur a choisi, et le trier masquerait ses regroupements.
 *
 * @param manifest - le contenu d'un `package.json` déjà analysé.
 * @returns un descripteur par script, description à `null` quand elle manque.
 */
export function readProjectScripts(manifest: unknown): IProjectScript[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const { scripts, nodefony } = manifest as IPackageManifest;
  if (typeof scripts !== "object" || scripts === null) return [];
  const described = nodefony?.scripts ?? {};
  return Object.entries(scripts).map(([name, command]) => ({
    name,
    command,
    description:
      typeof described[name] === "string" && described[name].trim()
        ? described[name].trim()
        : null,
  }));
}

/**
 * Lit les scripts du `package.json` d'un dossier.
 *
 * Ne lève **jamais** : un projet sans manifeste, illisible ou mal formé rend une
 * liste vide. Cette fonction sert à enrichir une aide — une aide qui plante parce
 * qu'un fichier voisin est cassé serait pire que l'absence de la section.
 *
 * @param dir - la racine du projet (par défaut, le dossier courant).
 * @returns les scripts déclarés, ou une liste vide.
 */
export function loadProjectScripts(
  dir: string = process.cwd(),
): IProjectScript[] {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    return readProjectScripts(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Rend les scripts en texte aligné, pour la fin d'une aide de commande.
 *
 * Rend une chaîne **vide** quand aucun script ne porte de description : une
 * section vide, ou une liste de noms sans explication, n'apprendrait rien et
 * encombrerait l'aide de tous les projets qui n'ont rien déclaré.
 *
 * @param scripts - ce que rend {@link readProjectScripts}.
 * @returns le bloc prêt à afficher, ou `""`.
 */
export function formatProjectScripts(
  scripts: readonly IProjectScript[],
): string {
  const documented = scripts.filter((s) => s.description !== null);
  if (!documented.length) return "";
  const width = Math.max(...documented.map((s) => s.name.length));
  const lines = documented.map(
    (s) => `  ${s.name.padEnd(width)}  ${s.description ?? ""}`,
  );
  const undocumented = scripts.length - documented.length;
  const note = undocumented
    ? `\n  (+ ${undocumented} script${undocumented > 1 ? "s" : ""} sans description — ` +
      `les décrire dans « nodefony.scripts » du package.json)`
    : "";
  return `\nScripts npm de ce projet (npm run <nom>) :\n${lines.join("\n")}${note}\n`;
}

/**
 * Les familles de scripts, **dans l'ordre où on s'en sert** — du geste quotidien
 * au geste rare.
 *
 * L'ordre du `package.json` est celui de l'écriture, pas celui de l'usage : il
 * met « board:snapshot » avant « build » parce qu'un jour on l'y a ajouté. Une
 * aide qui le recopie fait chercher.
 */
const SCRIPT_GROUPS = [
  "DÉVELOPPER",
  "ÉPROUVER",
  "CONTRÔLER",
  "DOCUMENTER",
  "PILOTER",
  "PUBLIER",
  "AUTRES",
] as const;

/** Une famille de scripts, telle que l'aide la rend. */
export interface IProjectScriptGroup {
  readonly title: string;
  readonly scripts: readonly IProjectScript[];
}

/**
 * Règles d'appartenance, **essayées dans l'ordre** : la première qui mord gagne.
 *
 * Elles vivent ici, et non dans le manifeste : un rangement écrit à la main se
 * périme au premier script ajouté — celui-ci tomberait en fin de liste, et
 * personne ne le verrait. Dérivé, le classement s'applique aussi aux scripts
 * d'une application qui vient de naître, sans qu'elle ait rien à déclarer.
 *
 * Les noms exacts passent AVANT les préfixes : `test:pilotage` éprouve les
 * automates de pilotage, il appartient au pilotage et non aux tests.
 */
const SCRIPT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(test:pilotage|retex:seuil|lessons:carriers)$/u, "PILOTER"],
  [/^(board|ticket):/u, "PILOTER"],
  [/^(release|readme:gate|test:release)/u, "PUBLIER"],
  [/^(doc|skills|generate-symbols|env:snapshot)/u, "DOCUMENTER"],
  [/^(devkit|selftest)/u, "ÉPROUVER"],
  // `dev` est ancré : sans le `\b`, il avalait `devkit:selftest`, qui éprouve.
  // Un préfixe trop large range au mauvais endroit SANS rien dire — et c'est
  // précisément ce qu'un classement dérivé doit éviter.
  [/^(dev|start|nodefony|build|clean)(\b|:|$)/u, "DÉVELOPPER"],
  [/^(test|coverage|verify)/u, "ÉPROUVER"],
  [
    /^(check|lint|format|typecheck|deps|externals|size|refs:check)/u,
    "CONTRÔLER",
  ],
];

/**
 * Range un script dans sa famille.
 *
 * @param name - le nom du script.
 * @returns le titre de sa famille — `AUTRES` quand aucune règle ne mord, ce qui
 *   le laisse VISIBLE plutôt que de le perdre.
 */
export function groupOfScript(name: string): string {
  for (const [pattern, group] of SCRIPT_RULES) {
    if (pattern.test(name)) return group;
  }
  return "AUTRES";
}

/**
 * Groupe les scripts décrits, familles vides retirées.
 *
 * Dans une famille, l'ordre est **alphabétique** : il est stable, et il place
 * naturellement `build` avant `build:core`, `test` avant `test:all`.
 *
 * @param scripts - ce que rend {@link readProjectScripts}.
 * @returns les familles non vides, dans l'ordre d'usage.
 */
export function groupProjectScripts(
  scripts: readonly IProjectScript[],
): IProjectScriptGroup[] {
  const documented = scripts.filter((s) => s.description !== null);
  return SCRIPT_GROUPS.map((title) => ({
    title,
    scripts: documented
      .filter((s) => groupOfScript(s.name) === title)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.scripts.length > 0);
}
