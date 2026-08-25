/**
 * release-core.mjs — le RAISONNEMENT d'une release, sans aucune entrée/sortie.
 *
 * Tout ce qui décide vit ici : validation de version, lecture des messages de
 * commit, ordre de publication, audit des métadonnées, rendu du changelog,
 * détection de contenu suspect. `release.mjs` n'en est que l'orchestration —
 * git, npm, le disque.
 *
 * ── POURQUOI CETTE SÉPARATION ───────────────────────────────────────────────
 *
 * Une release ne se répète pas : la version est brûlée au premier `publish`. On
 * ne peut donc pas « essayer pour voir ». Ces fonctions étant PURES — mêmes
 * entrées, même sortie, aucun effet de bord — elles s'éprouvent exhaustivement,
 * y compris sur les cas que l'on n'aura peut-être jamais l'occasion de vivre :
 * un lot dépareillé, une rupture annoncée en pied de message, un tarball qui
 * emporte un secret.
 *
 * Là où une décision dépend du monde (un chemin existe-t-il ?), le verdict est
 * INJECTÉ plutôt que lu : c'est ce qui permet de tester « répertoire déclaré
 * mais absent » sans fabriquer l'absence sur le disque.
 */

/**
 * Expression régulière de la spécification semver 2.0.0 elle-même.
 *
 * Elle n'est pas recopiée par élégance : une regex maison laisse passer ce que
 * la spec interdit. `01.2.3` porte un zéro en tête (clause 2 — « MUST NOT
 * contain leading zeroes ») et serait accepté par un `\d+` naïf ; à l'inverse
 * `1.0.0+exp.sha.5114f85` est une version VALIDE avec métadonnées de build
 * (clause 10) qu'une regex sans le `+` refuserait à tort.
 */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Valide une version et en extrait la pré-release.
 *
 * @param {string} v
 * @returns {{ok: boolean, prerelease: string|null, build: string|null}}
 */
export function validerVersion(v) {
  const m = typeof v === "string" ? SEMVER.exec(v) : null;
  if (!m) return { ok: false, prerelease: null, build: null };
  return { ok: true, prerelease: m[4] ?? null, build: m[5] ?? null };
}

/**
 * Compare deux versions sur leurs seuls majeur/mineur/patch.
 *
 * Suffisant pour ce dont ce script se sert — les planchers de npm et de Node —
 * et volontairement pas davantage : la précédence complète de semver (clause
 * 11.4, comparaison identifiant par identifiant des pré-releases) n'est pas
 * nécessaire ici, et une demi-implémentation de cette règle serait pire que son
 * absence.
 *
 * @returns {number} négatif si a < b, 0 si égaux, positif si a > b
 */
export function comparerVersions(a, b) {
  const [pa, pb] = [a, b].map((v) =>
    String(v)
      .split(".")
      .map((n) => parseInt(n, 10) || 0),
  );
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Ordre de publication : les dépendances avant ceux qui en dépendent.
 *
 * npm ne publie pas par lot — chaque `publish` est indépendant. Publier un
 * paquet avant celui dont il dépend ouvre une fenêtre où un utilisateur
 * installe une version qui référence un paquet absent du registre.
 *
 * Les dépendances internes de ce dépôt sont déclarées en `peerDependencies`
 * autant qu'en `dependencies` : ne lire que les secondes rendrait un ordre faux
 * sans que rien ne le signale.
 *
 * @param {Array<{nom: string, pkg: object}>} paquets
 * @returns {{ordre: string[], cycles: string[][]}}
 */
export function ordreTopologique(paquets) {
  const noms = new Set(paquets.map((p) => p.nom));
  const arcs = new Map(
    paquets.map((p) => [
      p.nom,
      Object.keys({
        ...p.pkg.dependencies,
        ...p.pkg.peerDependencies,
      }).filter((d) => noms.has(d) && d !== p.nom),
    ]),
  );

  const ordre = [];
  const cycles = [];
  const etat = new Map();

  const visiter = (nom, pile) => {
    const e = etat.get(nom);
    if (e === "fini") return;
    if (e === "encours") {
      // Un cycle n'est pas fatal — ce dépôt en assume au niveau des types — mais
      // il doit être RENDU : l'ordre est alors arbitraire sur ces paquets-là, et
      // taire ce fait ferait croire à une garantie qui n'existe pas.
      cycles.push([...pile.slice(pile.indexOf(nom)), nom]);
      return;
    }
    etat.set(nom, "encours");
    for (const dep of arcs.get(nom) ?? []) visiter(dep, [...pile, nom]);
    etat.set(nom, "fini");
    ordre.push(nom);
  };

  for (const p of paquets) visiter(p.nom, []);
  return { ordre, cycles };
}

/**
 * Audite les métadonnées qui font REFUSER une publication.
 *
 * Aucun de ces défauts ne se voit dans le dépôt : ils ne se manifestent qu'au
 * `npm publish`, c'est-à-dire le jour J, au milieu d'un lot déjà partiellement
 * parti — donc au pire moment possible.
 *
 * @param {Array<{nom: string, pkg: object}>} paquets
 * @param {{depotAttendu: string, existe: (chemin: string) => boolean}} ctx
 *        `existe` est INJECTÉ : le verdict « ce répertoire est là » vient de
 *        l'appelant, ce qui rend l'audit éprouvable sans toucher au disque.
 * @returns {{bloquants: string[], avertissements: string[]}}
 */
export function auditerMetadonnees(paquets, { depotAttendu, existe }) {
  const bloquants = [];
  const avertissements = [];

  for (const p of paquets) {
    const r = p.pkg.repository;
    const url = typeof r === "string" ? r : r?.url;

    if (!url) {
      // La doc npm cite le `repository` discordant parmi les causes premières
      // d'ENEEDAUTH en trusted publishing — et npm ne valide RIEN à
      // l'enregistrement du publieur : l'erreur ne sort qu'à la publication.
      bloquants.push(`${p.nom} : \`repository\` absent ou vide`);
    } else {
      if (!url.includes(depotAttendu)) {
        bloquants.push(
          `${p.nom} : repository → ${url} (attendu ${depotAttendu})`,
        );
      }
      // GitHub ne sert plus `git://` depuis 2022 : l'URL est morte, et le lien
      // « Repository » de npmjs.com n'atteint rien.
      if (url.startsWith("git://")) {
        bloquants.push(
          `${p.nom} : protocole git:// mort depuis 2022 → git+https://`,
        );
      }
      const dir = typeof r === "object" ? r.directory : null;
      if (dir && !existe(dir)) {
        bloquants.push(
          `${p.nom} : repository.directory « ${dir} » n'existe pas`,
        );
      }
    }

    // Un paquet scopé est PRIVÉ par défaut : sans cette clé, la publication est
    // refusée faute de plan payant, ou réussit… en privé.
    if (p.nom.startsWith("@") && p.pkg.publishConfig?.access !== "public") {
      bloquants.push(
        `${p.nom} : publishConfig.access ≠ "public" (paquet scopé)`,
      );
    }

    // `files` en ALLOWLIST est ce qui empêche un `.env` de partir dans le
    // tarball. Son absence bascule npm en liste de REFUS, où tout ce qui n'est
    // pas explicitement exclu voyage.
    if (!Array.isArray(p.pkg.files) || p.pkg.files.length === 0) {
      bloquants.push(
        `${p.nom} : \`files\` absent — le tarball emporterait tout le dossier`,
      );
    }

    for (const s of ["prepack", "prepare", "prepublishOnly"]) {
      if (p.pkg.scripts?.[s]) {
        // Pas un défaut : un fait. Ce qui est empaqueté n'est alors plus ce
        // qu'on a bâti et mesuré, et le taire laisse croire le contraire.
        avertissements.push(
          `${p.nom} : \`${s}\` = « ${p.pkg.scripts[s]} » s'exécutera PENDANT le pack`,
        );
      }
    }
  }

  return { bloquants, avertissements };
}

/**
 * Références internes figées sur une autre version que celle publiée.
 *
 * La convention du dépôt est `*`. Si elle change un jour, publier un lot dont
 * les références pointent la version précédente produit des installations
 * incohérentes — et ce script doit le VOIR plutôt que le laisser passer.
 */
export function referencesFigees(paquets, version) {
  const noms = new Set(paquets.map((p) => p.nom));
  const figees = [];
  for (const p of paquets) {
    for (const champ of ["dependencies", "peerDependencies"]) {
      for (const [dep, plage] of Object.entries(p.pkg[champ] ?? {})) {
        if (noms.has(dep) && plage !== "*" && !plage.includes(version)) {
          figees.push(`${p.nom} → ${dep}@${plage} (${champ})`);
        }
      }
    }
  }
  return figees;
}

/** Pont Conventional Commits → sections Keep a Changelog. */
export const SECTIONS = {
  feat: "Ajouté",
  fix: "Corrigé",
  perf: "Modifié",
  refactor: "Modifié",
  revert: "Retiré",
  docs: "Documentation",
  build: "Interne",
  ci: "Interne",
  test: "Interne",
  chore: "Interne",
  style: "Interne",
};

export const ORDRE_SECTIONS = [
  "Ajouté",
  "Modifié",
  "Déprécié",
  "Retiré",
  "Corrigé",
  "Sécurité",
  "Documentation",
  "Interne",
];

/**
 * Lit des messages de commit ENTIERS et en tire les ruptures et les sections.
 *
 * ⚠️ Le message entier, pas le sujet. Conventional Commits 1.0.0 admet DEUX
 * façons de signaler une rupture : le `!` avant le deux-points (règle 1) et le
 * pied de message `BREAKING CHANGE:` (règle 12). Ne lire que les sujets rate la
 * seconde — c'est-à-dire rate précisément l'information la plus importante
 * d'une release majeure, celle qui casse la production d'un utilisateur.
 *
 * La spec exige les MAJUSCULES pour ce pied (« the uppercase text BREAKING
 * CHANGE ») et admet `BREAKING-CHANGE` comme synonyme. Une graphie en
 * minuscules n'est donc PAS une rupture — l'accepter reviendrait à inventer une
 * norme, et à signaler des ruptures là où l'auteur n'en annonçait aucune.
 *
 * @param {string[]} messages messages complets (sujet + corps)
 * @returns {{ruptures: Array<{portee: string, texte: string}>, groupes: Map<string, Array<{portee: string, texte: string}>>, horsConvention: number}}
 */
export function analyserCommits(messages) {
  const ruptures = [];
  const groupes = new Map();
  let horsConvention = 0;

  for (const brut of messages) {
    const texteBrut = String(brut).trim();
    if (!texteBrut) continue;
    const [sujet, ...reste] = texteBrut.split("\n");
    const corps = reste.join("\n");

    const m = /^(\w+)(?:\(([^)]*)\))?(!)?:[ \t]+(.+)$/.exec(sujet);
    if (!m || !SECTIONS[m[1]]) {
      horsConvention++;
      continue;
    }
    const [, type, portee, bang, texte] = m;

    const pied = /^BREAKING[ -]CHANGE:[ \t]*(.+)$/m.exec(corps);
    if (bang || pied) {
      // Quand les deux formes coexistent, le pied fait foi pour la DESCRIPTION :
      // la spec dit que le sujet ne sert de description de rupture que si le
      // pied est omis (« MAY be omitted … and the commit description SHALL be
      // used to describe the breaking change »).
      ruptures.push({
        portee: portee ?? "",
        texte: pied?.[1]?.trim() || texte,
      });
    }

    const section = SECTIONS[type];
    if (!groupes.has(section)) groupes.set(section, []);
    groupes.get(section).push({ portee: portee ?? "", texte });
  }

  return { ruptures, groupes, horsConvention };
}

/**
 * Rend la section de changelog d'une version.
 *
 * « Don't let your friends dump git logs into changelogs » — Keep a Changelog.
 * La critique est juste : un journal brut est écrit pour son auteur, pas pour
 * son lecteur. Ce qui sort d'ici est donc un BROUILLON, marqué comme tel dans
 * le fichier même, que l'auteur relit et réécrit. L'automate rassemble la
 * matière — sans lui on oublie des changements ; l'humain écrit — sans lui on
 * publie un mur que personne ne lit.
 */
export function rendreChangelog({ version, date, ruptures, groupes }) {
  const lignes = [
    `## [${version}] — ${date}`,
    "",
    "<!-- BROUILLON généré par scripts/release.mjs depuis les messages de commit.",
    "     À RELIRE ET RÉÉCRIRE avant publication : un journal git n'est pas un",
    "     changelog — il est écrit pour l'auteur, pas pour le lecteur. -->",
    "",
  ];

  // Les ruptures d'abord, toujours : c'est la seule information qui peut casser
  // la production de quelqu'un, et la première qu'il cherche.
  if (ruptures.length) {
    lignes.push(`### ⚠ Ruptures de compatibilité (${ruptures.length})`, "");
    for (const r of ruptures) {
      lignes.push(`- ${r.portee ? `**${r.portee}** — ` : ""}${r.texte}`);
    }
    lignes.push("");
  }

  for (const section of ORDRE_SECTIONS) {
    const entrees = groupes.get(section);
    if (!entrees?.length) continue;
    lignes.push(`### ${section}`, "");
    for (const e of [...entrees].sort((a, b) =>
      a.portee.localeCompare(b.portee),
    )) {
      lignes.push(`- ${e.portee ? `**${e.portee}** — ` : ""}${e.texte}`);
    }
    lignes.push("");
  }

  return lignes.join("\n");
}

export const ENTETE_CHANGELOG =
  "# Changelog\n\n" +
  "Format inspiré de [Keep a Changelog](https://keepachangelog.com/), versions selon\n" +
  "[Semantic Versioning](https://semver.org/). Les sections sont un BROUILLON généré\n" +
  "par `scripts/release.mjs` puis relu à la main.\n\n";

/**
 * Insère une section en tête du changelog, en antéchronologique.
 *
 * Refuse d'écraser une section existante : elle a peut-être déjà été relue et
 * réécrite à la main, et ce travail-là ne se retrouve nulle part ailleurs.
 *
 * @returns {{contenu: string}|{erreur: string}}
 */
export function fusionnerChangelog(ancien, section, version) {
  const texte = ancien ?? "";
  if (
    new RegExp(
      `^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`,
      "m",
    ).test(texte)
  ) {
    return {
      erreur:
        `CHANGELOG.md porte déjà une section « ${version} ».\n` +
        "  Réécrire par-dessus effacerait ce qui a peut-être déjà été relu et corrigé.",
    };
  }
  const i = texte.indexOf("\n## ");
  const corps = i >= 0 ? texte.slice(i + 1) : "";
  return { contenu: ENTETE_CHANGELOG + section + "\n" + corps };
}

/**
 * Fichiers qui n'ont rien à faire dans un tarball publié.
 *
 * `files` est une allowlist, donc la fuite est improbable — mais « improbable »
 * n'est pas « vérifié », et un secret publié est public pour toujours : npm
 * n'autorise le retrait que 72 heures, et un secret est compromis à la seconde
 * où il est en ligne.
 *
 * Le motif vise des noms de fichiers ENTIERS, pas des fragments : une page de
 * documentation nommée `environment.md` ou un module `keys.js` sont légitimes,
 * et les signaler entraînerait l'habitude d'ignorer cette alerte.
 */
export function detecterSuspects(fichiers) {
  const SUSPECT =
    /(^|\/)(\.env(\.[\w-]+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|[\w.-]+\.(pem|p12|pfx|key|keystore)|secrets?\.(json|ya?ml|toml))$/i;
  const GIT = /(^|\/)\.git\//;
  return fichiers.filter((f) => SUSPECT.test(f) || GIT.test(f));
}
