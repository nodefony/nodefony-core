import semver from "semver";

/**
 * Une entrée telle que `npm outdated --json` la rend, pour UN couple paquet/dépendant.
 *
 * Le champ `current` est absent quand le paquet n'est pas installé du tout.
 */
export interface INpmOutdatedEntry {
  current?: string;
  wanted: string;
  latest: string;
  dependent?: string;
  location?: string;
  type?: string;
}

/**
 * Le document rendu par `npm outdated --json`.
 *
 * Un paquet réclamé par plusieurs espaces de travail apparaît sous forme de TABLEAU —
 * c'est la source de la duplication massive quand on se contente de réafficher le brut.
 */
export type NpmOutdatedReport = Record<
  string,
  INpmOutdatedEntry | INpmOutdatedEntry[]
>;

/** Nature du saut de version qui sépare la version installée de la dernière publiée. */
export type OutdatedSeverity = "major" | "minor" | "patch" | "missing";

/**
 * Un paquet en retard, agrégé : une seule ligne quel que soit le nombre de dépendants.
 */
export interface IOutdatedPackage {
  /** Nom npm du paquet. */
  name: string;
  /** Version installée, ou `null` si le paquet est absent de `node_modules`. */
  current: string | null;
  /** Version que la plage de versions déclarée autorise déjà. */
  wanted: string;
  /** Dernière version publiée au registre. */
  latest: string;
  /** Nature du saut `current` → `latest`. */
  severity: OutdatedSeverity;
  /**
   * `true` quand la plage déclarée INTERDIT la montée (`wanted` === `current`) :
   * un `npm update` ne fera rien, il faut décider de changer la plage.
   */
  pinned: boolean;
  /** Espaces de travail qui réclament ce paquet, dédupliqués et triés. */
  dependents: string[];
  /** `dependencies` / `devDependencies` / `peerDependencies` si `npm` l'a rendu (`--long`). */
  type?: string;
}

/**
 * Résultat agrégé, prêt à afficher ou à sérialiser.
 */
export interface IOutdatedSummary {
  /** Paquets réellement en retard, triés du saut le plus grave au plus bénin. */
  packages: IOutdatedPackage[];
  /**
   * Paquets dont la version INSTALLÉE dépasse celle du registre — typiquement un
   * espace de travail local pas encore publié. Ce n'est pas un retard, c'est l'inverse.
   */
  ahead: IOutdatedPackage[];
  /** Comptes par catégorie, pour l'en-tête. */
  counts: {
    major: number;
    minor: number;
    patch: number;
    missing: number;
    ahead: number;
    /** Nombre de couples paquet/dépendant que `npm` a rendus, avant agrégation. */
    rawEntries: number;
  };
}

const SEVERITY_ORDER: Record<OutdatedSeverity, number> = {
  missing: 0,
  major: 1,
  minor: 2,
  patch: 3,
};

/**
 * Classe le saut qui sépare deux versions.
 *
 * Les variantes de préversion rendues par `semver.diff` (`premajor`, `preminor`…) sont
 * ramenées à leur saut de rang, faute de quoi elles échapperaient à tout regroupement.
 *
 * @param current - version installée, ou `null` si le paquet est absent.
 * @param latest - dernière version publiée.
 * @returns la sévérité du saut ; `"patch"` quand les versions sont illisibles (on ne suppose pas le pire).
 */
export function classifySeverity(
  current: string | null,
  latest: string,
): OutdatedSeverity {
  if (!current) {
    return "missing";
  }
  const from = semver.coerce(current);
  const to = semver.coerce(latest);
  if (!from || !to) {
    return "patch";
  }
  if (to.major > from.major) {
    return "major";
  }
  if (to.minor > from.minor) {
    return "minor";
  }
  return "patch";
}

/**
 * Agrège le document de `npm outdated --json` en une ligne par paquet.
 *
 * Deux corrections que le brut n'apporte pas : les dépendants sont regroupés au lieu
 * d'être répétés, et un paquet dont la version installée DÉPASSE celle du registre est
 * mis à part — c'est le cas d'un espace de travail local non publié, que `npm` présente
 * comme un retard alors que c'est une avance.
 *
 * @param report - le document rendu par `npm outdated --json` (objet vide si rien).
 * @returns le résumé trié, avec les comptes par catégorie.
 */
export function aggregateOutdated(report: NpmOutdatedReport): IOutdatedSummary {
  const packages: IOutdatedPackage[] = [];
  const ahead: IOutdatedPackage[] = [];
  let rawEntries = 0;

  for (const name of Object.keys(report)) {
    const raw = report[name];
    const entries = Array.isArray(raw) ? raw : [raw];
    if (!entries.length) {
      continue;
    }
    rawEntries += entries.length;

    const head = entries[0];
    const current = head.current ?? null;
    const dependents = [
      ...new Set(
        entries
          .map((e) => e.dependent)
          .filter((d): d is string => typeof d === "string" && d.length > 0),
      ),
    ].sort();

    const pkg: IOutdatedPackage = {
      name,
      current,
      wanted: head.wanted,
      latest: head.latest,
      severity: classifySeverity(current, head.latest),
      pinned: current !== null && head.wanted === current,
      dependents,
      ...(head.type ? { type: head.type } : {}),
    };

    const from = current ? semver.coerce(current) : null;
    const to = semver.coerce(head.latest);
    if (from && to && semver.gt(from, to)) {
      ahead.push(pkg);
    } else {
      packages.push(pkg);
    }
  }

  packages.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : a.name.localeCompare(b.name);
  });
  ahead.sort((a, b) => a.name.localeCompare(b.name));

  return {
    packages,
    ahead,
    counts: {
      major: packages.filter((p) => p.severity === "major").length,
      minor: packages.filter((p) => p.severity === "minor").length,
      patch: packages.filter((p) => p.severity === "patch").length,
      missing: packages.filter((p) => p.severity === "missing").length,
      ahead: ahead.length,
      rawEntries,
    },
  };
}

const SEVERITY_LABEL: Record<OutdatedSeverity, string> = {
  missing: "absent",
  major: "MAJEUR",
  minor: "mineur",
  patch: "correctif",
};

/**
 * Résume la liste des dépendants pour l'affichage.
 *
 * @param dependents - noms des espaces de travail qui réclament le paquet.
 * @param all - `true` pour tous les nommer, `false` pour n'en garder que le compte au-delà de trois.
 * @returns une chaîne courte, jamais une énumération de vingt lignes.
 */
export function formatDependents(dependents: string[], all: boolean): string {
  if (!dependents.length) {
    return "—";
  }
  if (all || dependents.length <= 3) {
    return dependents.join(", ");
  }
  return `${dependents.length} paquets`;
}

/**
 * Compose les lignes du tableau des paquets en retard.
 *
 * Rendu PUR : aucune écriture, aucune couleur — l'appelant décide de la sortie.
 *
 * @param summary - le résumé produit par {@link aggregateOutdated}.
 * @param all - `true` pour nommer tous les dépendants.
 * @returns une ligne par paquet : nom, saut, actuel, souhaité, dernier, dépendants.
 */
export function toTableRows(
  summary: IOutdatedSummary,
  all: boolean = false,
): string[][] {
  return summary.packages.map((p) => [
    p.name,
    SEVERITY_LABEL[p.severity],
    p.current ?? "—",
    p.pinned ? `${p.wanted} (épinglé)` : p.wanted,
    p.latest,
    formatDependents(p.dependents, all),
  ]);
}

/**
 * Compose la phrase d'en-tête qui dit ce qui a été trouvé — et ce qui a été agrégé.
 *
 * Nommer le nombre d'entrées brutes n'est pas décoratif : c'est ce qui explique
 * pourquoi la sortie tient en quelques lignes là où `npm` en rend des dizaines.
 *
 * @param summary - le résumé produit par {@link aggregateOutdated}.
 * @returns la phrase à afficher au-dessus du tableau.
 */
export function formatHeadline(summary: IOutdatedSummary): string {
  const { counts, packages } = summary;
  if (!packages.length && !counts.ahead) {
    return "Toutes les dépendances sont à jour.";
  }
  const parts: string[] = [];
  if (counts.major) {
    parts.push(`${counts.major} majeur${counts.major > 1 ? "s" : ""}`);
  }
  if (counts.minor) {
    parts.push(`${counts.minor} mineur${counts.minor > 1 ? "s" : ""}`);
  }
  if (counts.patch) {
    parts.push(`${counts.patch} correctif${counts.patch > 1 ? "s" : ""}`);
  }
  if (counts.missing) {
    parts.push(`${counts.missing} absent${counts.missing > 1 ? "s" : ""}`);
  }
  const detail = parts.length ? ` — ${parts.join(", ")}` : "";
  const shown = packages.length + counts.ahead;
  // Le compte brut n'est pas décoratif : c'est ce que `npm outdated` affiche,
  // et sans l'explication on croit à une divergence. Un paquet y revient
  // autant de fois qu'il compte de dépendants — d'où 25 lignes pour 8 paquets.
  const raw =
    counts.rawEntries > shown
      ? ` npm en affiche ${counts.rawEntries} lignes : il répète un paquet pour CHAQUE dépendant.`
      : "";
  return `${packages.length} paquet${packages.length > 1 ? "s" : ""} en retard${detail}.${raw}`;
}
