import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { planSync, renderPlan, SKILLS_DIR } from "./aiSyncReport";
import type { IDiscoveredSkill } from "./aiSyncReport";

const USAGE = `Usage : nodefony ai:sync [--dry-run] [--json] [--cwd <path>]\n`;

/**
 * Les paquets d'où proviennent des skills.
 *
 * On scanne `node_modules/@nodefony/*` ET les modules LOCAUX de l'application
 * (`modules/<nom>`), pas seulement le devkit : rien dans la mécanique n'est
 * propre à un paquet, et un module tiers qui livre ses propres skills doit être
 * servi par la même commande. Coder `@nodefony/devkit` en dur aurait fait de
 * cette généralité un cas particulier, et obligé à toucher au cœur le jour où
 * quelqu'un d'autre en livre.
 */
function packageRoots(projectRoot: string): { dir: string; name: string }[] {
  const roots: { dir: string; name: string }[] = [];
  const scope = path.join(projectRoot, "node_modules", "@nodefony");
  for (const name of listDir(scope)) {
    if (name.startsWith(".")) continue;
    roots.push({ dir: path.join(scope, name), name: `@nodefony/${name}` });
  }
  const locaux = path.join(projectRoot, "modules");
  for (const name of listDir(locaux)) {
    if (name.startsWith(".")) continue;
    roots.push({ dir: path.join(locaux, name), name });
  }
  return roots;
}

/**
 * Le contenu d'un dossier, ou rien s'il n'existe pas.
 *
 * @param dir - chemin absolu.
 * @returns les entrées, ou `[]` — un dossier absent est un cas NORMAL ici.
 */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * La première phrase de la `description` d'un `SKILL.md`.
 *
 * Volontairement écrit à la main plutôt que par un analyseur YAML : le cœur ne
 * dépend d'aucune bibliothèque pour lire deux champs, et un `SKILL.md` non
 * conforme doit être IGNORÉ, pas faire échouer la commande — la synchronisation
 * ne juge pas la qualité des skills des autres.
 *
 * @param src - contenu complet du fichier.
 * @returns `{ name, summary }`, ou `null` si le frontmatter est inexploitable.
 */
export function readSkillHeader(
  src: string,
): { name: string; summary: string } | null {
  const bloc = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(src);
  if (bloc === null) return null;
  const fm = bloc[1] ?? "";
  const name = /^name:[ \t]*(\S.*)$/mu.exec(fm)?.[1]?.trim();
  if (name === undefined || name === "") return null;

  // La description peut être sur une ligne, ou en bloc replié (`>`) : les deux
  // formes sont valides et les deux sont employées. On ne garde que la première
  // PHRASE — le pointeur doit tenir dans les métadonnées chargées au démarrage.
  let desc = /^description:[ \t]*(\S.*)$/mu.exec(fm)?.[1]?.trim() ?? "";
  if (desc === "" || desc === ">" || desc === "|") {
    const replie =
      /^description:[ \t]*[>|][^\n]*\n((?:[ \t]+\S[^\n]*\n?)+)/mu.exec(fm)?.[1];
    desc = (replie ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  }
  const phrase = /^(.*?[.!?])(\s|$)/u.exec(desc)?.[1] ?? desc;
  return { name, summary: phrase.trim() };
}

/**
 * Découvre les skills livrés par les paquets installés.
 *
 * Un skill est un DOSSIER portant un `SKILL.md` — c'est la spécification, et
 * c'est le seul critère retenu : ni le nom du paquet, ni un champ maison.
 *
 * @param projectRoot - racine de l'application.
 * @returns les skills trouvés, dans l'ordre de découverte.
 */
export function discoverSkills(projectRoot: string): IDiscoveredSkill[] {
  const out: IDiscoveredSkill[] = [];
  for (const pkg of packageRoots(projectRoot)) {
    const skillsDir = path.join(pkg.dir, "skills");
    for (const entry of listDir(skillsDir)) {
      const md = path.join(skillsDir, entry, "SKILL.md");
      if (!existsSync(md)) continue;
      let header: { name: string; summary: string } | null = null;
      try {
        header = readSkillHeader(readFileSync(md, "utf8"));
      } catch {
        continue;
      }
      // Un `name` qui ne correspond pas à son dossier viole la spécification :
      // les clients l'écarteront. L'écarter ici aussi évite de poser un pointeur
      // vers un skill que personne n'activera.
      if (header === null || header.name !== entry) continue;
      out.push({
        name: header.name,
        packageName: pkg.name,
        summary: header.summary,
        // Le chemin VOYAGE — il est écrit dans un fichier que d'autres outils
        // liront, sur toutes les plateformes. Il s'écrit donc en `/`.
        source: path.relative(projectRoot, md).split(path.sep).join("/"),
      });
    }
  }
  return out;
}

/**
 * Ce que le dossier de découverte porte déjà : nom du skill → contenu.
 *
 * @param projectRoot - racine de l'application.
 * @returns la table, vide si le dossier n'existe pas encore.
 */
export function readExistingPointers(
  projectRoot: string,
): Record<string, string> {
  const dir = path.join(projectRoot, ...SKILLS_DIR.split("/"));
  const out: Record<string, string> = Object.create(null);
  for (const entry of listDir(dir)) {
    const md = path.join(dir, entry, "SKILL.md");
    try {
      out[entry] = readFileSync(md, "utf8");
    } catch {
      // Un dossier sans `SKILL.md` n'est pas un skill : il n'entre pas dans la
      // comparaison, et ne sera donc jamais compté comme orphelin.
    }
  }
  return out;
}

/**
 * Analyse les arguments de `ai:sync`.
 *
 * @param argv - `process.argv` complet.
 * @returns les options, ou une erreur d'usage.
 */
export function parseAiSyncArgv(
  argv: string[],
): { cwd: string; json: boolean; dryRun: boolean } | { error: string } {
  const args = argv.slice(2).filter((a) => a !== "ai:sync");
  let cwd = process.cwd();
  let json = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--cwd") {
      const v = args[i + 1];
      if (v === undefined) return { error: "--cwd attend un chemin" };
      cwd = path.resolve(v);
      i += 1;
    } else return { error: `option inconnue : ${a}` };
  }
  return { cwd, json, dryRun };
}

/**
 * Commande `nodefony ai:sync` — pose dans le projet les pointeurs vers les
 * skills livrés par les paquets installés.
 *
 * Standalone (0 boot), et il le FAUT : la commande doit répondre dans un
 * terminal qui n'a pas posé `NODE_ENV`. Portée par un module `policy: "dev"`,
 * elle n'aurait tout simplement pas existé là — c'est exactement le défaut qui a
 * fait remonter `card` dans le cœur, et il n'y a aucune raison de le repayer.
 *
 * ⚠️ Aucun `postinstall` ne l'appelle, volontairement : `--ignore-scripts` est
 * courant (intégration continue, politiques d'entreprise), les scripts
 * d'installation sont un vecteur d'attaque connu de l'écosystème npm, et écrire
 * dans un dossier VERSIONNÉ à chaque installation produirait des différences
 * surprises. Le scaffold pose les pointeurs à la création ; cette commande les
 * remet à jour quand on le demande.
 *
 * @param argv - `process.argv` complet.
 * @returns exit code sémantique (`OK`, `USAGE`, `NOINPUT` hors projet).
 */
export function runAiSyncCommand(argv: string[]): number {
  const parsed = parseAiSyncArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`ai:sync: ${parsed.error}\n${USAGE}`);
    return SysExit.USAGE;
  }
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      `ai:sync: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n` +
        `Pour en créer un :\n  npx nodefony create app mon-app\n`,
    );
    return SysExit.NOINPUT;
  }

  const plan = planSync(
    discoverSkills(projectRoot),
    readExistingPointers(projectRoot),
  );

  if (!parsed.dryRun) {
    for (const skill of plan.skills) {
      // Idempotence : un pointeur déjà identique n'est PAS réécrit. Sans ce
      // saut, chaque passage réécrirait le même contenu — invisible dans un
      // diff, mais l'horodatage change, les observateurs de fichiers se
      // réveillent, et les outils qui suivent le mtime voient un fichier
      // modifié. Une commande de synchronisation qui salit l'arbre est une
      // commande qu'on hésite à lancer.
      if (skill.action === "inchange") continue;
      const dest = path.join(projectRoot, ...skill.target.split("/"));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, skill.content, "utf8");
    }
  }

  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(plan, null, 2)}\n`
      : renderPlan(plan, !parsed.dryRun),
  );
  return SysExit.OK;
}
