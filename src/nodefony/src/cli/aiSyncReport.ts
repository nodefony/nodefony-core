/**
 * Composition PURE de la synchronisation des skills d'agent.
 *
 * Reçoit un état déjà lu (les skills découverts, ce que le projet porte déjà) et
 * conclut : que poser, que remplacer, que laisser. Aucune lecture de disque,
 * aucune écriture — c'est ce qui la rend éprouvable sans projet ni paquet
 * installé, et ce qui garantit qu'elle ne peut rien inventer.
 *
 * La lecture et l'écriture vivent dans `aiSync.ts` ; la même séparation que
 * `cardReport.ts` / `card.ts` et `envReport.ts` / `env.ts`.
 */

/**
 * Un skill découvert dans un paquet installé.
 */
export interface IDiscoveredSkill {
  /** Nom du skill — identique au dossier qui le contient (contrainte de la spec). */
  name: string;
  /** Paquet qui le livre, tel qu'il s'écrit dans un `import` (`@nodefony/devkit`). */
  packageName: string;
  /** Première phrase de sa `description`, pour l'afficher sans charger le corps. */
  summary: string;
  /**
   * Chemin du `SKILL.md` source, RELATIF à la racine du projet et écrit en `/`.
   *
   * Il VOYAGE (il est écrit dans un fichier que d'autres outils liront) : il
   * s'écrit donc en séparateurs POSIX, jamais avec ceux de la plateforme.
   */
  source: string;
}

/** Ce qu'il faut faire d'un skill, une fois comparé à ce que le projet porte. */
export type SkillAction = "pose" | "remplace" | "inchange";

/**
 * Le geste décidé pour un skill, prêt à être exécuté ou affiché.
 */
export interface IPlannedSkill {
  name: string;
  packageName: string;
  action: SkillAction;
  /** Chemin du pointeur à écrire, relatif au projet, en `/`. */
  target: string;
  /**
   * Chemin du MIROIR Claude Code (`CLAUDE_SKILLS_DIR`), même contenu.
   *
   * L'idempotence du miroir se juge sur SON fichier au moment d'écrire (pas
   * sur `action`, qui ne parle que de la racine canonique) : un miroir absent
   * sous un canonique inchangé doit quand même être posé.
   */
  mirrorTarget: string;
  /** Contenu exact du pointeur — c'est lui qu'on écrit, tel quel. */
  content: string;
}

/**
 * Le plan complet, tel qu'il s'affiche et tel qu'il s'exécute.
 */
export interface IAiSyncPlan {
  /** Dossier de découverte visé, relatif au projet, en `/`. */
  directory: string;
  skills: IPlannedSkill[];
  /** Pointeurs présents dans le dossier que plus aucun paquet ne livre. */
  orphelins: string[];
}

/**
 * Le dossier de découverte INTEROPÉRABLE.
 *
 * La spécification Agent Skills ne mandate AUCUN emplacement — elle ne définit
 * que ce qu'un skill contient. La convention qui a émergé pour le partage entre
 * clients est `.agents/skills/` : c'est la racine CANONIQUE, celle où vivent
 * aussi la détection d'orphelins et l'inventaire.
 */
export const SKILLS_DIR = ".agents/skills";

/**
 * Le MIROIR pour Claude Code — parce que le pari « c'est aux clients d'ajouter
 * `.agents/skills/` » a été MESURÉ perdu.
 *
 * Constaté sur une application générée (claude-code 2.1.238, mode headless) :
 * les cinq pointeurs étaient posés dans `.agents/skills/`, et le champ `skills`
 * de la session n'en listait AUCUN ; les mêmes fichiers recopiés dans
 * `.claude/skills/` y apparaissaient tous. Un skill que le client dominant ne
 * charge jamais n'existe pas — même motif que la porte MCP câblée sans
 * `--mcp-config`. Le contenu reste rendu par `renderPointer`, en un seul
 * exemplaire : deux racines, un écrivain, aucune divergence possible.
 *
 * ⚠️ Cette racine appartient d'abord à l'UTILISATEUR (ses propres skills y
 * vivent) : la synchronisation n'y écrit QUE les pointeurs qu'elle livre, n'y
 * détecte aucun orphelin et n'y supprime jamais rien.
 */
export const CLAUDE_SKILLS_DIR = ".claude/skills";

/**
 * Le pointeur écrit dans le projet.
 *
 * Il ne COPIE pas le skill : il le désigne. C'est ce qui fait que le contenu se
 * met à jour par `npm update` sans qu'aucun fichier du projet ne soit réécrit —
 * une copie, elle, mentirait six mois plus tard. Le corps reste court à dessein :
 * l'agent charge d'abord les métadonnées de tous les skills, et seulement
 * ensuite le corps de celui qu'il active.
 *
 * @param skill - le skill découvert.
 * @returns le contenu complet du `SKILL.md` pointeur.
 */
export function renderPointer(skill: IDiscoveredSkill): string {
  return `---
name: ${skill.name}
description: >
  ${skill.summary}
metadata:
  nodefony-source-package: "${skill.packageName}"
---

# ${skill.name}

> Ce fichier est un **pointeur**, posé par \`nodefony ai:sync\`. Le contenu vit
> dans le paquet \`${skill.packageName}\` et se met à jour par \`npm update\` —
> ne l'édite pas ici, l'édition serait écrasée et ne profiterait à personne.

**Lis maintenant \`${skill.source}\`** : c'est la version qui correspond à la
version du framework installée dans ce projet.
`;
}

/**
 * Décide, pour chaque skill découvert, s'il faut poser, remplacer ou ne rien
 * faire — et relève les pointeurs devenus orphelins.
 *
 * Un pointeur déjà identique n'est PAS réécrit : sans cette comparaison, chaque
 * passage salirait l'arbre git de l'utilisateur avec des fichiers au contenu
 * inchangé, et `ai:sync` deviendrait une commande qu'on hésite à lancer.
 *
 * @param decouverts - les skills livrés par les paquets installés.
 * @param existants - ce que le dossier de découverte porte déjà : nom → contenu.
 * @returns le plan, trié par nom pour que deux exécutions se comparent.
 */
export function planSync(
  decouverts: IDiscoveredSkill[],
  existants: Record<string, string>,
): IAiSyncPlan {
  const skills: IPlannedSkill[] = [];
  const livres = new Set<string>();

  for (const skill of [...decouverts].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    livres.add(skill.name);
    const content = renderPointer(skill);
    const actuel = existants[skill.name];
    skills.push({
      name: skill.name,
      packageName: skill.packageName,
      action:
        actuel === undefined
          ? "pose"
          : actuel === content
            ? "inchange"
            : "remplace",
      target: `${SKILLS_DIR}/${skill.name}/SKILL.md`,
      mirrorTarget: `${CLAUDE_SKILLS_DIR}/${skill.name}/SKILL.md`,
      content,
    });
  }

  // Un skill retiré d'un paquet laisse son pointeur derrière lui : il désigne
  // alors un fichier qui n'existe plus, et l'agent suit un chemin mort. On le
  // NOMME sans le supprimer — l'utilisateur peut en avoir écrit un à la main
  // sous le même nom, et effacer le travail de quelqu'un n'est jamais le rôle
  // d'une commande de synchronisation.
  const orphelins = Object.keys(existants)
    .filter((name) => !livres.has(name))
    .sort();

  return { directory: SKILLS_DIR, skills, orphelins };
}

/**
 * Rend le plan pour un humain.
 *
 * @param plan - le plan calculé.
 * @param applique - `false` quand rien n'a été écrit (`--dry-run`).
 * @returns le texte à écrire sur la sortie standard.
 */
export function renderPlan(plan: IAiSyncPlan, applique: boolean): string {
  const lignes: string[] = [];
  const poses = plan.skills.filter((s) => s.action === "pose");
  const remplaces = plan.skills.filter((s) => s.action === "remplace");
  const inchanges = plan.skills.filter((s) => s.action === "inchange");

  lignes.push(
    `\n  Skills d'agent — ${plan.directory} (miroir Claude Code : ${CLAUDE_SKILLS_DIR})\n`,
  );

  if (plan.skills.length === 0) {
    lignes.push(
      `  Aucun skill trouvé dans les paquets installés.\n\n` +
        `  Les skills sont livrés par les paquets Nodefony (dossier skills/).\n` +
        `  Si tu attendais ceux du devkit :\n` +
        `    npm install --save-dev @nodefony/devkit\n`,
    );
    return lignes.join("");
  }

  for (const s of plan.skills) {
    const marque =
      s.action === "pose" ? "+" : s.action === "remplace" ? "~" : "=";
    lignes.push(`  ${marque} ${s.name.padEnd(24)} ${s.packageName}\n`);
  }

  for (const name of plan.orphelins) {
    lignes.push(
      `  ? ${name.padEnd(24)} plus livré par aucun paquet — à supprimer à la main\n`,
    );
  }

  lignes.push(
    `\n  ${poses.length} posé(s) · ${remplaces.length} mis à jour · ` +
      `${inchanges.length} inchangé(s)` +
      (plan.orphelins.length > 0
        ? ` · ${plan.orphelins.length} orphelin(s)`
        : "") +
      `\n`,
  );

  if (!applique) {
    lignes.push(`\n  Rien n'a été écrit (--dry-run).\n`);
  } else if (poses.length > 0 || remplaces.length > 0) {
    lignes.push(
      `\n  Ces fichiers sont faits pour être COMMITÉS : ton équipe et ton\n` +
        `  intégration continue disposeront des mêmes skills.\n`,
    );
  }

  return lignes.join("");
}
