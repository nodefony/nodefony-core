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
    | "lint-missing"
    | "rule-disabled"
    | "rule-missing"
    | "typecheck-missing"
    | "verify-missing"
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
export const REQUIRED_RULES: readonly {
  name: string;
  why: string;
  /**
   * La catégorie oxlint qui l'active SANS déclaration — constatée en exécutant
   * `oxlint` catégorie par catégorie, jamais déduite d'une documentation. Un
   * projet qui active cette catégorie a la garde, même sans nommer la règle :
   * l'ignorer ferait crier `doctor` sur une configuration saine.
   */
  category: string;
}[] = [
  {
    name: "typescript/no-explicit-any",
    why: "un `any` explicite éteint le typage là où il compte le plus",
    category: "restriction",
  },
  {
    name: "typescript/ban-ts-comment",
    why: "`@ts-ignore` fait taire le compilateur sans laisser de trace",
    category: "pedantic",
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

/** Les sévérités qui n'arment RIEN. `allow` est le mot d'oxlint pour `off`. */
const SILENT_SEVERITIES = new Set<unknown>(["off", "allow", 0]);

/** Une valeur de règle qui NE garde plus rien. */
function isOff(value: unknown): boolean {
  if (SILENT_SEVERITIES.has(value)) return true;
  if (Array.isArray(value)) return SILENT_SEVERITIES.has(value[0]);
  return false;
}

/**
 * Le nom d'une règle réduit à ce qui l'identifie vraiment.
 *
 * `typescript/no-explicit-any`, `@typescript-eslint/no-explicit-any` et
 * `no-explicit-any` désignent la MÊME règle — oxlint accepte les trois formes
 * (constaté en l'exécutant). Comparer les chaînes brutes faisait donc déclarer
 * « absente » une règle écrite sous un autre de ses noms.
 *
 * @param name - le nom tel que la configuration l'écrit.
 * @returns le segment qui suit le dernier `/`.
 */
function ruleKey(name: string): string {
  const at = name.lastIndexOf("/");
  return at === -1 ? name : name.slice(at + 1);
}

/**
 * La valeur déclarée pour une règle, quel que soit l'alias employé.
 *
 * @param rules - le bloc `rules` de la configuration.
 * @param name - la règle cherchée.
 * @returns la valeur déclarée, ou `undefined` si la règle n'est pas nommée.
 */
function declaredRule(
  rules: Record<string, unknown>,
  name: string,
): unknown | undefined {
  const wanted = ruleKey(name);
  let found: unknown | undefined;
  // La DERNIÈRE déclaration gagne, comme dans l'objet JSON lui-même.
  for (const key of Object.keys(rules)) {
    if (ruleKey(key) === wanted) found = rules[key];
  }
  return found;
}

/**
 * La catégorie qui armerait la règle est-elle activée ?
 *
 * @param linter - la configuration du linter.
 * @param category - la catégorie oxlint de la règle.
 * @returns `true` si la catégorie est déclarée avec une sévérité qui mord.
 */
function categoryArms(
  linter: Record<string, unknown>,
  category: string,
): boolean {
  const categories = (linter.categories ?? {}) as Record<string, unknown>;
  const severity = categories[category];
  return severity !== undefined && !isOff(severity);
}

/** `true` si ce motif de fichiers ne vise que des zones où le `off` est voulu. */
function isAllowedScope(files: unknown): boolean {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) return false;
  return list.every(
    (f) =>
      typeof f === "string" &&
      ALLOWED_OFF.some((word) => f.toLowerCase().includes(word)),
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
    if (!lint) {
      // Une garde ABSENTE ne doit jamais compter comme armée : c'est le mode
      // de défaillance que ce contrôle existe pour attraper, et il l'a
      // reproduit sur lui-même — un projet sans `lint` affichait « gardes
      // armées » sans qu'aucun linter n'ait jamais tourné.
      findings.push({
        kind: "lint-missing",
        file: manifestFile,
        message:
          "aucun script `lint` : les règles du projet ne sont exécutées par " +
          "personne — ni en local, ni dans une forge, et leur configuration " +
          "ne garde alors plus rien. " +
          '→ `npm pkg set scripts.lint="oxlint --deny-warnings"`',
      });
    } else if (!lint.includes("--deny-warnings")) {
      findings.push({
        kind: "lint-not-blocking",
        file: manifestFile,
        message:
          "le script `lint` ne porte pas `--deny-warnings` : les règles du " +
          "projet sont en `warn`, donc le linter passe même quand elles " +
          "mordent — la garde est là, mais elle ne retient rien",
      });
    } else armed++;

    if (!typecheck) {
      findings.push({
        kind: "typecheck-missing",
        file: manifestFile,
        message:
          "aucun script `typecheck` : le bundler ne vérifie PAS les types, " +
          "et rien d'autre ne le fait — du code qui ne compile pas peut " +
          "être publié sans qu'aucune barrière ne s'y oppose. " +
          '→ `npm pkg set scripts.typecheck="tsgo --noEmit"`',
      });
    } else armed++;

    const missing = VERIFY_STEPS.filter((step) => !verify.includes(step));
    if (!verify) {
      findings.push({
        kind: "verify-missing",
        file: manifestFile,
        message:
          "aucune chaîne `verify` : rien n'enchaîne " +
          `${VERIFY_STEPS.join(", ")} en une seule commande — c'est celle ` +
          "qu'une forge appelle, et celle qu'on tape avant de publier. " +
          `→ \`npm pkg set scripts.verify="${VERIFY_STEPS.map((e) => `npm run ${e}`).join(" && ")}"\``,
      });
    } else if (missing.length > 0) {
      findings.push({
        kind: "verify-broken",
        file: manifestFile,
        message:
          `la chaîne \`verify\` n'enchaîne plus ${missing.join(", ")} : ` +
          "elle passe donc en ignorant ce qu'elle est censée contrôler, et " +
          "c'est elle qu'une forge appelle",
      });
    } else if (verify) armed++;
  }

  if (linter) {
    const rules = (linter.rules ?? {}) as Record<string, unknown>;
    const overrides = Array.isArray(linter.overrides) ? linter.overrides : [];
    for (const { name, why, category } of REQUIRED_RULES) {
      if (isOff(declaredRule(rules, name))) {
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
        return isOff(declaredRule(r, name)) && !isAllowedScope(bag.files);
      });
      if (large) {
        const target = (large as { files?: unknown }).files;
        findings.push({
          kind: "rule-disabled",
          file: linterFile,
          message:
            `la règle \`${name}\` est désactivée sur ${JSON.stringify(target)} — ` +
            `hors des zones où c'est voulu (tests, configuration, scripts). ${why}`,
        });
        continue;
      }
      // 🔴 Une règle qu'on ne trouve NULLE PART n'est pas armée. Elle n'est
      // active par défaut dans aucune catégorie que ce projet déclare : la
      // compter faisait rendre « 3 gardes armées » sur une configuration vide.
      if (
        declaredRule(rules, name) === undefined &&
        !categoryArms(linter, category)
      ) {
        findings.push({
          kind: "rule-missing",
          file: linterFile,
          message:
            `la règle \`${name}\` n'est déclarée nulle part, et la catégorie ` +
            `\`${category}\` qui l'activerait n'est pas retenue : elle ne dit ` +
            `donc rien. ${why}`,
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
