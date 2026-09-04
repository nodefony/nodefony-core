/**
 * Composition PURE de `nodefony git:hooks` — hooks git natifs, zéro dépendance.
 *
 * Reçoit un état déjà lu (contenu actuel des hooks, valeur de `core.hooksPath`)
 * et conclut : que poser, que laisser, que REFUSER. Aucune lecture de disque,
 * aucun `git config` — même séparation que `aiSyncReport.ts` / `aiSync.ts`.
 *
 * ## Pourquoi natif, et pas husky
 *
 * Depuis sa v9, husky n'est plus qu'un habillage de `git config core.hooksPath` :
 * la fonctionnalité est dans git lui-même. Une dépendance + un script `prepare`
 * pour ce que deux fichiers sh et une ligne de config font déjà, c'est une
 * surface en trop — et un `postinstall` est exactement ce que `ai:sync` a
 * refusé (`--ignore-scripts` courant, vecteur d'attaque connu). La pose est un
 * GESTE EXPLICITE : cette commande, jamais un script d'installation.
 *
 * ## Pourquoi les hooks générés sont LÉGERS
 *
 * Le filet complet appartient à l'intégration continue — un hook local bloquant
 * est un doublon qui ralentit chaque commit et se contourne d'un `--no-verify`.
 * Qui opte pour les hooks reçoit donc le strict utile : typecheck + lint au
 * commit (rapide), `verify` complet au push (le dernier rempart avant de
 * partager).
 */

/** Dossier des hooks, relatif à la racine de l'application, écrit en `/`. */
export const GIT_HOOKS_DIR = ".githooks";

/**
 * Marqueur d'APPARTENANCE, présent dans chaque hook généré.
 *
 * C'est lui qui sépare « à nous, remplaçable » de « écrit par quelqu'un » : un
 * hook existant qui ne le porte pas n'est JAMAIS écrasé — effacer le travail
 * d'un utilisateur n'est pas le rôle d'une commande de pose.
 */
export const GIT_HOOKS_MARKER = "posé par `nodefony git:hooks`";

/** Les hooks que la commande sait poser, dans l'ordre d'affichage. */
export const GIT_HOOK_NAMES = ["pre-commit", "pre-push"] as const;
export type GitHookName = (typeof GIT_HOOK_NAMES)[number];

/**
 * Le contenu d'un hook.
 *
 * Sh POSIX strict : sous Windows, git exécute les hooks via le `sh.exe` de Git
 * for Windows — un script simple passe partout, un bashisme non. Le `npx` est
 * nécessaire : un hook git n'a pas `node_modules/.bin` dans son PATH.
 *
 * @param name - lequel des deux.
 * @returns le script complet, marqueur compris.
 */
export function renderGitHook(name: GitHookName): string {
  const body =
    name === "pre-commit"
      ? `# Léger VOLONTAIREMENT (typecheck + lint, pas de tests) : le filet complet
# est l'intégration continue — un commit doit rester rapide.
npm run typecheck && npm run lint`
      : `# Le dernier rempart avant de partager : \`verify\` enchaîne typecheck,
# lint, tests et \`nodefony doctor\`.
npm run verify`;
  return `#!/usr/bin/env sh
# ${GIT_HOOKS_MARKER} — se met à jour en la relançant.
# Bypass d'urgence : git commit/push --no-verify.
# Désactiver : git config --unset core.hooksPath

${body}
`;
}

/** Ce qu'il faut faire d'un hook, une fois comparé à l'existant. */
export type GitHookAction = "pose" | "remplace" | "inchange" | "refus-etranger";

/** Le geste décidé pour un hook. */
export interface IPlannedGitHook {
  name: GitHookName;
  action: GitHookAction;
  /** Chemin du hook, relatif à la racine de l'application, en `/`. */
  target: string;
  /** Contenu à écrire — celui de `renderGitHook`, tel quel. */
  content: string;
}

/** Ce qu'il faut faire de `core.hooksPath`. */
export type HooksPathAction = "pose" | "inchange" | "refus-autre";

/**
 * Le plan complet — hooks ET configuration, jugés ensemble.
 *
 * Un seul refus suffit à tout arrêter : poser la moitié d'un jeu de hooks
 * laisse un état qu'il faut comprendre avant de corriger, alors qu'un refus
 * franc se corrige d'un geste.
 */
export interface IGitHooksPlan {
  directory: string;
  hooks: IPlannedGitHook[];
  hooksPath: {
    /** Valeur actuelle de `core.hooksPath`, `null` si absente. */
    current: string | null;
    /** Valeur à poser (relative au TOPLEVEL git, en `/`). */
    wanted: string;
    action: HooksPathAction;
  };
  /** `true` dès qu'un refus interdit d'appliquer quoi que ce soit. */
  refused: boolean;
}

/**
 * Décide, pour chaque hook et pour `core.hooksPath`, le geste à faire.
 *
 * @param existants - contenu actuel de chaque hook, `null` si absent.
 * @param currentHooksPath - valeur actuelle de `core.hooksPath`, `null` si absente.
 * @param wantedHooksPath - valeur cible (relative au toplevel git, en `/`) —
 *   l'appelant la calcule, car SEUL lui sait où est le toplevel : un chemin
 *   relatif dans `core.hooksPath` se résout depuis la racine du dépôt git, pas
 *   depuis l'application (cas réel : app dans un sous-dossier d'un monorepo).
 * @returns le plan, applicable ou refusé.
 */
export function planGitHooks(
  existants: Record<string, string | null>,
  currentHooksPath: string | null,
  wantedHooksPath: string,
): IGitHooksPlan {
  const hooks: IPlannedGitHook[] = GIT_HOOK_NAMES.map((name) => {
    const content = renderGitHook(name);
    const actuel = existants[name] ?? null;
    const action: GitHookAction =
      actuel === null
        ? "pose"
        : actuel === content
          ? "inchange"
          : actuel.includes(GIT_HOOKS_MARKER)
            ? "remplace"
            : "refus-etranger";
    return { name, action, target: `${GIT_HOOKS_DIR}/${name}`, content };
  });

  const hooksPath: IGitHooksPlan["hooksPath"] = {
    current: currentHooksPath,
    wanted: wantedHooksPath,
    action:
      currentHooksPath === null || currentHooksPath === ""
        ? "pose"
        : currentHooksPath === wantedHooksPath
          ? "inchange"
          : "refus-autre",
  };

  return {
    directory: GIT_HOOKS_DIR,
    hooks,
    hooksPath,
    refused:
      hooksPath.action === "refus-autre" ||
      hooks.some((h) => h.action === "refus-etranger"),
  };
}

/**
 * Rend le plan pour un humain.
 *
 * @param plan - le plan calculé.
 * @param applique - `false` quand rien n'a été écrit (`--dry-run` ou refus).
 * @returns le texte à écrire sur la sortie standard.
 */
export function renderGitHooksPlan(
  plan: IGitHooksPlan,
  applique: boolean,
): string {
  const lignes: string[] = [`\n  Hooks git natifs — ${plan.directory}\n`];

  for (const h of plan.hooks) {
    const marque =
      h.action === "pose"
        ? "+"
        : h.action === "remplace"
          ? "~"
          : h.action === "inchange"
            ? "="
            : "✗";
    lignes.push(`  ${marque} ${h.name.padEnd(12)}`);
    if (h.action === "refus-etranger") {
      lignes.push(
        ` un hook ÉTRANGER occupe ce nom — rien n'est écrasé.\n` +
          `      → le déplacer, ou le fusionner à la main avec ${h.target}`,
      );
    }
    lignes.push(`\n`);
  }

  const hp = plan.hooksPath;
  if (hp.action === "refus-autre") {
    lignes.push(
      `  ✗ core.hooksPath vaut déjà « ${hp.current ?? ""} » — tes hooks sont gérés\n` +
        `    autrement, rien n'est touché. Pour adopter ceux-ci :\n` +
        `      git config --unset core.hooksPath   puis relancer\n`,
    );
  } else {
    lignes.push(
      `  ${hp.action === "pose" ? "+" : "="} core.hooksPath → ${hp.wanted}\n`,
    );
  }

  if (plan.refused) {
    lignes.push(`\n  REFUS — rien n'a été écrit ni configuré.\n`);
  } else if (!applique) {
    lignes.push(`\n  Rien n'a été écrit (--dry-run).\n`);
  } else {
    lignes.push(
      `\n  Bypass ponctuel : --no-verify · désactiver :\n` +
        `    git config --unset core.hooksPath\n`,
    );
  }
  return lignes.join("");
}
