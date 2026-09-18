/**
 * Le PÉRIMÈTRE d'un projet, et l'environnement qu'il verrait — une seule fois.
 *
 * Trois questions reviennent dès qu'un outil veut dire quelque chose de vrai
 * sur une application sans la démarrer : quelles cibles porte-t-elle, quel
 * environnement liraient-elles, et qu'est-ce que son état contredit. Elles
 * vivaient dans le vérificateur (`runDoctor`), donc hors de portée de tout
 * autre appelant — et la commande qui MONTRE la configuration ne pouvait pas
 * s'en servir sans recopier la règle. Deux copies divergent en silence :
 * chacune passe ses propres tests.
 *
 * Ce module n'importe rien du CLI : le vérificateur, lui, en dépend déjà
 * (`cli/progress`, `cli/projectRoot`), donc l'inverse fermerait un cycle.
 *
 * @module
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveEnvCascade } from "../../runtime/loadEnv";
import { checkSurface } from "./surface";

/** Dossiers qui CONTIENNENT des cibles, par opposition à en être une. */
const TARGET_CONTAINERS = ["modules", "src/modules", "src/packages/@nodefony"];

/**
 * Cibles du contrôle de câblage : l'application elle-même, et chaque module.
 *
 * Ce n'est pas la même liste que celle des paquets : un contrôle de dépendances
 * s'intéresse à ce qui porte un `package.json`, un contrôle de câblage à ce qui
 * porte un `nodefony/`. Les confondre ferait chercher des entités à la racine
 * d'un dossier qui n'en contient que des modules.
 *
 * @param cwd - la racine d'où l'on regarde.
 * @returns les dossiers à explorer, la racine comprise.
 */
export function wiringTargets(cwd: string): string[] {
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
 * L'environnement que l'APPLICATION verrait, depuis ce poste.
 *
 * `process.env` ne porte que ce que le terminal a posé ; l'application, elle,
 * lit d'abord sa cascade `.env*`. Un diagnostic qui l'ignore accuse ce qu'il
 * n'a pas regardé — mesuré : une application Postgres voyait CHAQUE entité
 * accusée d'être écrite pour le mauvais moteur, parce que `NF_DATABASE_URL`
 * vit dans un `.env` que `process.env` ne porte pas.
 *
 * La cascade est celle d'ICI : viser un autre environnement ne fait pas
 * apparaître des fichiers qui ne sont pas sur cette machine.
 *
 * @param root - racine du projet (ou dossier de départ, hors projet).
 * @returns l'environnement effectif ; `process.env` n'est jamais modifié.
 */
export function appEnvironment(
  root: string,
): Record<string, string | undefined> {
  const runtimeEnv = process.env.NODE_ENV ?? "development";
  const rawAppEnv = process.env.APP_ENV ?? process.env.NF_ENV ?? "";
  return resolveEnvCascade(process.env, {
    cwd: root,
    runtimeEnv,
    ...(rawAppEnv && rawAppEnv !== runtimeEnv ? { appEnv: rawAppEnv } : {}),
  });
}

/**
 * Les divergences de dialecte que le projet ASSUME, déclarées dans son
 * `package.json` (`nodefony.doctor.entityDialect`).
 *
 * Elles se lisent ici parce que tout appelant doit les respecter : avertir là
 * où le vérificateur se tait donnerait deux verdicts contradictoires sur le
 * même état, et c'est le plus bavard qu'on finit par ignorer.
 *
 * @param cwd - la racine du projet.
 * @returns les chemins tolérés ; vide quand rien n'est déclaré ou lisible.
 */
export function declaredDialectExceptions(cwd: string): string[] {
  try {
    const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
    const doctor = (JSON.parse(raw) as { nodefony?: { doctor?: unknown } })
      .nodefony?.doctor as { entityDialect?: unknown } | undefined;
    const declared = doctor?.entityDialect;
    return Array.isArray(declared) ? declared.map(String) : [];
  } catch {
    // Pas de manifeste lisible : aucune exception, et ce n'est pas une erreur.
    return [];
  }
}

/** Une valeur effective que l'état du projet contredit. */
export interface IConfigInconsistency {
  /** La variable en cause, nommée telle qu'elle est LUE. */
  name: string;
  /** Ce qui se passera si rien n'est fait, en une phrase. */
  message: string;
}

/**
 * Les valeurs effectives que l'état du projet contredit.
 *
 * Une variable peut être posée au bon endroit, avec la bonne provenance, et
 * rendre l'application inexploitable. Le cas mesuré : `NF_DATABASE_URL` sur un
 * moteur que les entités ne parlent pas — l'outil de migration les écarte en
 * silence, la table n'est jamais créée, et la première requête répond 500.
 *
 * Le constat existe déjà, rendu par le vérificateur. Ce qui manquait n'est pas
 * le calcul : c'est de le servir là où l'on REGARDE après avoir configuré.
 *
 * @param options - la racine, le projet, et les divergences assumées.
 * @returns les incohérences, vides quand l'état se tient.
 */
export function configInconsistencies(options: {
  cwd: string;
  projectRoot?: string;
  dialectExceptions?: readonly string[];
}): IConfigInconsistency[] {
  const { cwd, projectRoot } = options;
  const dialectExceptions =
    options.dialectExceptions ?? declaredDialectExceptions(cwd);
  const surface = checkSurface({
    roots: wiringTargets(cwd),
    cwd,
    ...(projectRoot ? { projectRoot } : {}),
    env: appEnvironment(cwd),
    ...(dialectExceptions ? { dialectExceptions } : {}),
  });
  // `dialectFrom` NOMME la variable réellement lue — annoncer `NF_DATABASE_URL`
  // quand la valeur vient de l'alias de plateforme enverrait corriger une
  // variable qui n'existe pas sur ce poste.
  return surface.findings
    .filter((f) => f.kind === "entity-other-dialect")
    .map((f) => ({
      name: surface.dialectFrom,
      message: `${f.file} — ${f.message}`,
    }));
}
