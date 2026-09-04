/**
 * `doctor` — les GARDES du projet sont-elles armées ?
 *
 * 🔴 Ce contrôle ne signale JAMAIS une occurrence de code. Le linter et le
 * vérificateur de types détectent déjà `any` explicite et `@ts-ignore`, et ils
 * le font correctement : un contrôle recopié en expression régulière se
 * tromperait sur les commentaires et les chaînes, et divergerait de la règle au
 * premier cas particulier. C'est écrit ici en toutes lettres pour que personne
 * ne l'ajoute plus tard.
 *
 * Ce que `doctor` apporte, et que personne ne fait : vérifier que la garde
 * EXISTE. Une application où quelqu'un a mis `"no-explicit-any": "off"`, retiré
 * `--deny-warnings`, ou cassé la chaîne `verify` n'a plus de filet — et rien ne
 * le signale, puisque le lint passe. Un filet décroché ne fait pas de bruit ;
 * c'est toute la difficulté.
 *
 * ⚠️ La désactivation SOUS les tests, la configuration et les scripts est
 * VOULUE : un décor écrit `any` à dessein. C'est ce qui rend un `off` global
 * difficile à repérer à l'œil — il ressemble à ceux-là.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Une garde décrochée. */
export interface IGuardFinding {
  kind:
    | "lint-not-blocking"
    | "rule-disabled"
    | "typecheck-missing"
    | "verify-broken";
  message: string;
  file: string;
}

/** Ce que le contrôle a pu constater. */
export interface IGuardResult {
  findings: IGuardFinding[];
  /** Les gardes effectivement CONSTATÉES en place — le compte du sommaire. */
  armed: number;
  /** `true` si la configuration du linter n'a pas pu être lue. */
  linterUnreadable: boolean;
  /** `true` si le manifeste n'a pas pu être lu. */
  manifestUnreadable: boolean;
}

/**
 * Les règles dont la désactivation retire un filet, et pourquoi.
 *
 * Nommées ici plutôt que devinées : ce sont celles que le projet a choisies et
 * que sa doctrine cite (« 0 `any`, 0 `@ts-ignore` »). Une liste dérivée de la
 * configuration ne dirait rien — c'est justement l'absence qu'on cherche.
 */
export const REQUIRED_RULES: readonly { name: string; why: string }[] = [
  {
    name: "typescript/no-explicit-any",
    why: "un `any` explicite éteint le typage là où il compte le plus",
  },
  {
    name: "typescript/ban-ts-comment",
    why: "`@ts-ignore` fait taire le compilateur sans laisser de trace",
  },
];

/**
 * Les chemins où la désactivation d'une règle est VOULUE.
 *
 * Un décor de test écrit `any` à dessein, une configuration d'outil aussi. Un
 * `off` qui ne vise que ces chemins n'est pas un filet décroché — le confondre
 * avec un `off` global ferait crier `doctor` sur une configuration saine.
 */
const ALLOWED_OFF = ["test", "spec", "config", "scripts", "skills"];

/** Ce que la chaîne `verify` doit enchaîner pour mériter son nom. */
export const VERIFY_STEPS: readonly string[] = ["typecheck", "lint", "test"];

/** Une valeur de règle qui NE garde plus rien. */
function isOff(value: unknown): boolean {
  if (value === "off" || value === 0) return true;
  if (Array.isArray(value)) return value[0] === "off" || value[0] === 0;
  return false;
}

/** `true` si ce motif de fichiers ne vise que des zones où le `off` est voulu. */
function isAllowedScope(files: unknown): boolean {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) return false;
  return list.every(
    (f) =>
      typeof f === "string" &&
      ALLOWED_OFF.some((mot) => f.toLowerCase().includes(mot)),
  );
}

/** Lit un JSON qui tolère les commentaires — la configuration du linter en a. */
function readJsonc(file: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(file, "utf8")
      // Les commentaires de ligne, hors de toute chaîne : la configuration du
      // linter en porte, et `JSON.parse` les refuse.
      .replace(/^\s*\/\/[^\n]*$/gmu, "");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface IGuardCheckOptions {
  /** Racine du projet — c'est elle qui porte le manifeste et la configuration. */
  projectRoot: string;
}

/**
 * Constate que les gardes du projet sont armées.
 *
 * @param options - la racine du projet.
 * @returns les gardes décrochées, et le nombre de celles qui tiennent.
 */
export function checkGuards(options: IGuardCheckOptions): IGuardResult {
  const findings: IGuardFinding[] = [];
  let armed = 0;

  const manifestPath = path.join(options.projectRoot, "package.json");
  const linterPath = path.join(options.projectRoot, ".oxlintrc.json");
  const manifest = readJsonc(manifestPath);
  const linter = readJsonc(linterPath);
  const manifestFile = "package.json";
  const linterFile = ".oxlintrc.json";

  if (manifest) {
    const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
    const lint = typeof scripts.lint === "string" ? scripts.lint : "";
    const typecheck =
      typeof scripts.typecheck === "string" ? scripts.typecheck : "";
    const verify = typeof scripts.verify === "string" ? scripts.verify : "";

    // Un linter qui rend 0 sur un avertissement ne garde rien : les règles du
    // projet sont en `warn`, et c'est `--deny-warnings` qui les rend bloquantes.
    if (lint && !lint.includes("--deny-warnings")) {
      findings.push({
        kind: "lint-not-blocking",
        file: manifestFile,
        message:
          "le script `lint` ne porte pas `--deny-warnings` : les règles du " +
          "projet sont en `warn`, donc le linter passe même quand elles " +
          "mordent — la garde est là, mais elle ne retient rien",
      });
    } else if (lint) armed++;

    if (!typecheck) {
      findings.push({
        kind: "typecheck-missing",
        file: manifestFile,
        message:
          "aucun script `typecheck` : le bundler ne vérifie PAS les types, " +
          "et rien d'autre ne le fait — du code qui ne compile pas peut " +
          "être publié sans qu'aucune barrière ne s'y oppose",
      });
    } else armed++;

    const manquantes = VERIFY_STEPS.filter((e) => !verify.includes(e));
    if (verify && manquantes.length > 0) {
      findings.push({
        kind: "verify-broken",
        file: manifestFile,
        message:
          `la chaîne \`verify\` n'enchaîne plus ${manquantes.join(", ")} : ` +
          "elle passe donc en ignorant ce qu'elle est censée contrôler, et " +
          "c'est elle qu'une forge appelle",
      });
    } else if (verify) armed++;
  }

  if (linter) {
    const rules = (linter.rules ?? {}) as Record<string, unknown>;
    const overrides = Array.isArray(linter.overrides) ? linter.overrides : [];
    for (const { name, why } of REQUIRED_RULES) {
      if (isOff(rules[name])) {
        findings.push({
          kind: "rule-disabled",
          file: linterFile,
          message: `la règle \`${name}\` est désactivée GLOBALEMENT — ${why}`,
        });
        continue;
      }
      // Une exception large est un `off` global qui n'en a pas l'air : elle se
      // lit comme les exceptions VOULUES (tests, config, scripts) et personne
      // ne la distingue à l'œil.
      const large = overrides.find((o) => {
        const bag = (o ?? {}) as Record<string, unknown>;
        const r = (bag.rules ?? {}) as Record<string, unknown>;
        return isOff(r[name]) && !isAllowedScope(bag.files);
      });
      if (large) {
        const cible = (large as { files?: unknown }).files;
        findings.push({
          kind: "rule-disabled",
          file: linterFile,
          message:
            `la règle \`${name}\` est désactivée sur ${JSON.stringify(cible)} — ` +
            `hors des zones où c'est voulu (tests, configuration, scripts). ${why}`,
        });
        continue;
      }
      armed++;
    }
  }

  return {
    findings,
    armed,
    linterUnreadable: linter === null,
    manifestUnreadable: manifest === null,
  };
}
