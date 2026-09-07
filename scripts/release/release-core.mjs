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
/**
 * Plafond de sortie des commandes git de la release, en octets.
 *
 * `execSync` tronque à 1 Mio par défaut — et échoue en `ENOBUFS`, pas
 * silencieusement. Le journal complet de ce dépôt en pèse déjà plus de trois :
 * comme AUCUN tag `v*` n'existe encore, la release repart du premier commit et
 * lit TOUT. La publication réelle serait donc morte là, après quarante minutes
 * d'épreuve, sur un message qui ne parle que de tampon.
 *
 * La valeur n'est pas un chiffre rond posé au hasard : un test la confronte à la
 * taille RÉELLE du journal, pour qu'elle redevienne rouge avant de redevenir
 * bloquante.
 */
export const MAX_BUFFER_GIT = 64 * 1024 * 1024;

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
/**
 * Noms sous lesquels npm inclut d'office un fichier de licence à la racine d'un
 * paquet. La liste est celle du registre, pas une préférence : un fichier nommé
 * autrement ne voyagerait que s'il figure dans `files`.
 */
export const FICHIERS_LICENCE = [
  "LICENSE",
  "LICENSE.txt",
  "LICENSE.md",
  "LICENCE",
  "LICENCE.txt",
  "LICENCE.md",
];

/**
 * Longueur minimale d'une `description` de paquet publiable.
 *
 * Calibré sur le terrain : les six descriptions fautives du dépôt tenaient
 * entre 13 et 34 caractères (« nodefony http », « Nodefony Framework Module
 * Mongoose »), les correctes entre 56 et 165. Le seuil sépare « le nom du
 * paquet répété » d'« une phrase qui dit ce qu'il fait ».
 */
export const LONGUEUR_MIN_DESCRIPTION = 40;

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

    // ── La LICENCE doit VOYAGER dans le tarball ────────────────────────────
    //
    // Un dépôt monolithique a UN fichier de licence, à sa racine — et npm
    // n'inclut d'office que les fichiers de licence posés à la racine du
    // PAQUET. Les deux ne sont pas au même endroit, et rien ne le signale :
    // mesuré sur l'artefact reçu, le tarball `@nodefony/http@10.0.0` porte
    // 154 fichiers et ZÉRO licence, tout en déclarant `license: "CECILL-B"`.
    // Les licences libres — CeCILL-B comme MIT ou BSD — exigent que leur texte
    // accompagne la distribution : le paquet publié ne remplit donc pas la
    // condition sous laquelle il autorise sa propre réutilisation.
    //
    // Le champ SEUL ne suffit pas, et le fichier SEUL non plus : npmjs.com
    // affiche « UNLICENSED » sans le champ — ce qui suffit à faire refuser une
    // dépendance par l'inventaire de conformité d'une entreprise — et un champ
    // sans texte laisse l'installeur sans les termes qu'il est censé accepter.
    if (!p.pkg.license) {
      bloquants.push(
        `${p.nom} : champ \`license\` absent — npmjs.com affichera « UNLICENSED »`,
      );
    }
    // `location` peut manquer chez un appelant qui ne le fournit pas : on
    // CONSTATE alors qu'on ne peut pas vérifier, au lieu de conclure au vert.
    if (p.location === undefined) {
      avertissements.push(
        `${p.nom} : \`location\` non fournie — présence du texte de licence NON vérifiée`,
      );
    } else if (!FICHIERS_LICENCE.some((f) => existe(`${p.location}/${f}`))) {
      bloquants.push(
        `${p.nom} : aucun texte de licence dans le paquet` +
          ` (attendu ${FICHIERS_LICENCE.join(" ou ")} dans ${p.location})` +
          ` — le tarball déclarerait « ${p.pkg.license ?? "?"} » sans en fournir les termes`,
      );
    }

    // ── Ce que npm et les moteurs INDEXENT ────────────────────────────────
    //
    // La page npm d'une version est FIGÉE : une description ratée ne se
    // rattrape qu'en publiant une version de plus. C'est la seule métadonnée
    // dont l'erreur est irrattrapable sans brûler un numéro — d'où le
    // bloquant, alors que npm, lui, publierait sans broncher.
    //
    // Le seuil dit « une phrase », pas « deux mots » : « nodefony http » (13)
    // et « Nodefony Framework » (18) ne disent pas ce que le paquet FAIT.
    const description = (p.pkg.description ?? "").trim();
    if (description.length < LONGUEUR_MIN_DESCRIPTION) {
      bloquants.push(
        `${p.nom} : description de ${description.length} caractère(s)` +
          ` — « ${description || "∅"} » ne dit pas ce que le paquet fait` +
          ` (minimum ${LONGUEUR_MIN_DESCRIPTION} ; la page npm d'une version est figée)`,
      );
    }

    // Ni l'un ni l'autre n'empêche une publication — d'où l'avertissement.
    if (!Array.isArray(p.pkg.keywords) || p.pkg.keywords.length === 0) {
      avertissements.push(
        `${p.nom} : \`keywords\` vide — le paquet ne remonte sur aucune recherche npm`,
      );
    } else if (p.pkg.keywords.includes("javascript")) {
      avertissements.push(
        `${p.nom} : mot-clé « javascript » sur un projet TypeScript strict`,
      );
    }
    if (!p.pkg.homepage) {
      avertissements.push(`${p.nom} : \`homepage\` absent`);
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
 * Les champs qu'un INSTALLEUR résout — donc les seuls où une référence interne
 * désalignée atteint l'utilisateur.
 *
 * Partagé par la détection (`referencesFigees`) et par la correction
 * (`alignerReferencesInternes`) : deux périmètres qui divergeraient laisseraient
 * passer exactement ce que le premier prétend voir.
 */
export const CHAMPS_DEPENDANCES = ["dependencies", "peerDependencies"];

/**
 * Aligne sur la version publiée les références internes ÉPINGLÉES d'un manifeste.
 *
 * ## Pourquoi la correction ne peut pas rester un avertissement
 *
 * En lockstep, un paquet qui épingle un frère sur une AUTRE version publie une
 * dépendance absente du registre : l'installation échoue en `ETARGET` chez le
 * premier utilisateur, et la version est brûlée. Le cas vécu est le pire
 * possible — `create-nodefony` épinglait `nodefony@10.0.0` à la veille d'une
 * `10.0.0-alpha.1` : la PORTE D'ENTRÉE du framework (`npm create nodefony`),
 * cassée pour tout le monde, sans qu'aucun test du dépôt ne puisse le voir
 * (l'épreuve d'installation vierge substitue des tarballs locaux, elle ne
 * résout jamais depuis le registre).
 *
 * ## Pourquoi l'étoile ne peut plus rester
 *
 * `*` était la convention du dépôt pour les dépendances de pair. Confrontée au
 * registre, elle produit l'inverse de ce qu'elle promet : `*` accepte TOUT,
 * donc npm prend `latest`. Mesuré sur l'alpha.1 publiée, dans un dossier vide,
 * `npm i @nodefony/http@10.0.0-alpha.1` installait `nodefony@7.0.2` et quatorze
 * `*-bundle@7.0.2` — un framework d'une autre ère, en silence. Rien ne pouvait
 * le voir ici : une application générée épingle le cœur, ce qui contraint le
 * pair, et l'épreuve d'installation vierge ne passe que par là.
 *
 * D'où la distinction, qui n'est pas cosmétique :
 *
 * - une **dépendance** interne est verrouillée par le lockstep → version EXACTE ;
 * - un **pair** interne exprime une compatibilité → `^version`, qui refuse la
 *   7.x, accepte les préversions suivantes du même tuple puis les 10.x stables.
 *
 * Un pair EXTERNE en `*` n'est pas touché : on ne possède pas sa cadence.
 *
 * La réécriture est TEXTUELLE et ciblée, jamais un `JSON.stringify` global :
 * celui-ci réordonnerait les clés et gonflerait le diff jusqu'à le rendre
 * illisible — or ce diff est exactement ce que l'auteur relit avant de taguer.
 *
 * @param brut - le texte du `package.json`, tel qu'il est sur le disque
 * @param noms - les noms des paquets du lot (tout le reste est externe)
 * @param version - la version publiée par ce lot
 * @returns le contenu réécrit, les références alignées, et celles dont la
 *   plage n'a PAS été retrouvée dans le texte — un remplacement muet
 *   publierait la référence d'origine, donc il se dit.
 */
export function alignerReferencesInternes(brut, noms, version) {
  const internes = noms instanceof Set ? noms : new Set(noms);
  const pkg = JSON.parse(brut);
  const alignees = [];
  const introuvables = [];
  let contenu = brut;

  for (const champ of CHAMPS_DEPENDANCES) {
    // Un pair exprime une COMPATIBILITÉ, une dépendance une version du lot.
    const cible = champ === "peerDependencies" ? `^${version}` : version;
    for (const [dep, plage] of Object.entries(pkg[champ] ?? {})) {
      if (!internes.has(dep) || plage === cible) continue;
      const motif = new RegExp(
        `("${echapperRegex(dep)}"\\s*:\\s*")${echapperRegex(plage)}(")`,
        "g",
      );
      const remplace = contenu.replace(motif, `$1${cible}$2`);
      if (remplace === contenu) {
        if (!introuvables.includes(`${dep}@${plage}`)) {
          introuvables.push(`${dep}@${plage}`);
        }
        continue;
      }
      contenu = remplace;
      const trace = `${dep}@${plage} → ${cible}`;
      if (!alignees.includes(trace)) alignees.push(trace);
    }
  }

  return { contenu, alignees, introuvables };
}

/** Neutralise les métacaractères d'un littéral inséré dans une expression. */
function echapperRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    for (const champ of CHAMPS_DEPENDANCES) {
      for (const [dep, plage] of Object.entries(p.pkg[champ] ?? {})) {
        if (noms.has(dep) && plage !== "*" && !plage.includes(version)) {
          figees.push(`${p.nom} → ${dep}@${plage} (${champ})`);
        }
      }
    }
  }
  return figees;
}

/**
 * Les paquets dont le `package.json` ne porte PAS la version demandée.
 *
 * ## Pourquoi cette vérification existe séparément de l'estampillage
 *
 * Préparer et publier sont deux gestes, à deux moments, sur deux machines. La
 * préparation écrit (versions, changelog) et se relit ; la publication, elle,
 * part d'un tag et **ne doit RIEN écrire** — ce qui est publié doit être
 * exactement ce qui a été commité et relu.
 *
 * Sans cette garde, le mode publication n'a que deux issues, toutes deux
 * mauvaises : estampiller lui-même — et publier alors du code qui n'existe dans
 * aucun commit —, ou publier des tarballs dont la version ne correspond pas au
 * tag qui les a déclenchés.
 *
 * @param paquets - `{ nom, pkg }` de chaque publiable.
 * @param version - celle que le tag exige.
 * @returns `["nom@versionTrouvée", …]` — vide si le lot est cohérent.
 */
export function paquetsNonEstampilles(paquets, version) {
  return paquets
    .filter((p) => p.pkg?.version !== version)
    .map((p) => `${p.nom}@${p.pkg?.version ?? "(version absente)"}`);
}

/**
 * Pont Conventional Commits → catégories **Common Changelog**.
 *
 * ## Pourquoi Common Changelog plutôt que Keep a Changelog
 *
 * Keep a Changelog donne des CONSEILS ; Common Changelog pose des règles
 * normatives (MUST/SHOULD), et c'est ce qui le rend exploitable par une
 * machine : ensemble de catégories FERMÉ, ordre imposé, une entrée par ligne,
 * référence de commit obligatoire, rupture préfixée. Un outil peut alors lire
 * ce fichier sans le deviner.
 *
 * ## Pourquoi les titres restent en ANGLAIS dans un projet francophone
 *
 * Les quatre catégories sont un ensemble fermé de la spécification. Les
 * traduire romprait la conformité — aucun lecteur automatique ne reconnaîtrait
 * « Ajouté » — sans rien apporter à l'humain, qui lit les ENTRÉES, écrites dans
 * la langue du projet.
 *
 * ## Les types ABSENTS de cette table, et pourquoi
 *
 * `docs`, `build`, `ci`, `test`, `chore`, `style` ne produisent aucune entrée :
 * la spécification demande d'écarter les changements sans effet pour celui qui
 * met à jour (« skip no-op changes »). Ils sont COMPTÉS et annoncés par le
 * script, jamais écrits en silence — l'auteur reste libre d'en remonter un à la
 * main s'il change quelque chose pour l'utilisateur.
 */
export const SECTIONS = {
  perf: "Changed",
  refactor: "Changed",
  feat: "Added",
  revert: "Removed",
  fix: "Fixed",
};

/**
 * L'ordre des catégories est NORMATIF (« must be in the following order »).
 * Il n'est pas arbitraire : ce qui CHANGE sous les pieds de l'utilisateur vient
 * avant ce qui s'ajoute, et les corrections ferment la marche.
 */
export const ORDRE_SECTIONS = ["Changed", "Added", "Removed", "Fixed"];

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
 * ## La RÉFÉRENCE de commit est normative
 *
 * Common Changelog : « changes must reference relevant commits ». Une entrée
 * sans référence est une affirmation invérifiable — celui qui lit le changelog
 * pour comprendre une régression ne peut plus remonter au code. Chaque message
 * arrive donc accompagné de son empreinte.
 *
 * @param {Array<{sha?: string, message: string}>|string[]} commits — messages
 *        complets (sujet + corps), avec leur empreinte quand elle est connue.
 *        La forme « tableau de chaînes » reste acceptée : elle produit des
 *        entrées sans référence, ce que le script signale.
 * @returns {{ruptures: Array<{portee: string, texte: string, sha: string}>, groupes: Map<string, Array<{portee: string, texte: string, sha: string}>>, horsConvention: number, ecartes: number}}
 */
export function analyserCommits(commits) {
  const ruptures = [];
  const groupes = new Map();
  let horsConvention = 0;
  let ecartes = 0;

  for (const entree of commits) {
    const brut = typeof entree === "string" ? entree : entree?.message;
    const sha = typeof entree === "string" ? "" : (entree?.sha ?? "");
    const texteBrut = String(brut ?? "").trim();
    if (!texteBrut) continue;
    const [sujet, ...reste] = texteBrut.split("\n");
    const corps = reste.join("\n");

    const m = /^(\w+)(?:\(([^)]*)\))?(!)?:[ \t]+(.+)$/.exec(sujet);
    if (!m) {
      horsConvention++;
      continue;
    }
    // Un type CONVENTIONNEL mais sans effet pour l'utilisateur (`docs`, `ci`,
    // `chore`…) n'est pas « hors convention » : il est délibérément ÉCARTÉ.
    // Confondre les deux comptes donnerait à l'auteur un chiffre qui ne veut
    // rien dire — et lui ferait chercher des commits mal écrits qui n'existent pas.
    if (!SECTIONS[m[1]]) {
      ecartes++;
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
        sha,
      });
    }

    const section = SECTIONS[type];
    if (!groupes.has(section)) groupes.set(section, []);
    groupes.get(section).push({
      portee: portee ?? "",
      texte,
      sha,
      rupture: Boolean(bang || pied),
    });
  }

  return { ruptures, groupes, horsConvention, ecartes };
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
export function rendreChangelog({ version, date, groupes }) {
  // Titre NORMATIF : `## VERSION - DATE`. Ni crochets (Common Changelog n'a pas
  // de lien de comparaison à ancrer), ni tiret cadratin — un lecteur automatique
  // attend cette forme exacte, et la date en ISO 8601.
  const lignes = [
    `## ${version} - ${date}`,
    "",
    "<!-- BROUILLON — structure conforme à Common Changelog, FORMULATION à réécrire.",
    "     La spec exige des entrées à l'IMPÉRATIF, d'UNE ligne, et AUTO-DESCRIPTIVES",
    "     (compréhensibles hors de leur catégorie). Les sujets de commit de ce dépôt",
    "     sont narratifs : ils font une matière première, pas un changelog.",
    "     « Don't take the easy way out with full automation. » -->",
    "",
  ];

  for (const section of ORDRE_SECTIONS) {
    const entrees = groupes.get(section);
    if (!entrees?.length) continue;
    lignes.push(`### ${section}`, "");

    // « Breaking changes should be listed before other changes (per category) » :
    // c'est la seule information qui peut casser la production de quelqu'un.
    // Tri stable ensuite par portée, pour qu'un même sous-système se lise d'un bloc.
    const triees = [...entrees].sort(
      (a, b) =>
        Number(b.rupture) - Number(a.rupture) ||
        a.portee.localeCompare(b.portee),
    );
    for (const e of triees) lignes.push(`- ${rendreEntree(e)}`);
    lignes.push("");
  }

  return lignes.join("\n");
}

/**
 * Une entrée, à la forme normative de Common Changelog.
 *
 * `- **Breaking:** texte (sha)` · `- **portée (breaking):** texte (sha)`
 *
 * La spec veut le préfixe en GRAS et, pour un sous-système, la forme
 * `**<subsystem> (breaking):** ` — une seule paire de parenthèses pour les
 * références, jamais `(#1) (#2)`.
 */
function rendreEntree(e) {
  const ref = e.sha ? ` (${e.sha})` : "";
  if (e.rupture) {
    return e.portee
      ? `**${e.portee} (breaking):** ${e.texte}${ref}`
      : `**Breaking:** ${e.texte}${ref}`;
  }
  return e.portee ? `**${e.portee}:** ${e.texte}${ref}` : `${e.texte}${ref}`;
}

export const ENTETE_CHANGELOG =
  "# Changelog\n\n" +
  "Format : [Common Changelog](https://common-changelog.org/) — catégories fermées et\n" +
  "ordonnées, une entrée par ligne, à l'impératif, chacune référençant son commit.\n" +
  "Versions selon [Semantic Versioning](https://semver.org/).\n\n" +
  "Les sections naissent d'un BROUILLON rendu par `npm run release` depuis les messages\n" +
  "de commit, puis sont RÉÉCRITES à la main : un journal git est écrit pour l'auteur,\n" +
  "un changelog pour celui qui met à jour.\n\n";

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

/**
 * Ce que la passe fait vraiment, à partir des seuls drapeaux.
 *
 * 🔴 PUBLIER N'IMPLIQUE PAS ÉCRIRE. Préparer et publier sont deux gestes, à
 * deux moments : la préparation écrit (versions, changelog) et se relit ; la
 * publication part d'un TAG et ne doit RIEN écrire — ce qui part doit être
 * exactement ce qui a été commité et relu.
 *
 * La règle vit ICI, pure, parce qu'elle s'est déjà trompée en restant inline :
 * une sortie « répétition » gardée par le seul `!ecrire` rendait `--publish`
 * INERTE — et sortait en 0. Sur la seule commande du dépôt qui ne se rattrape
 * pas, « rien n'a été publié » se lisait comme « tout est publié ». Une
 * condition de mode ne se relit pas ; elle s'éprouve.
 *
 * @param options - drapeaux de la ligne de commande
 * @returns les phases à exécuter
 */
export function phasesDeLaPasse({
  ecrire = false,
  publier = false,
  pack = false,
} = {}) {
  const empaqueter = pack || publier;
  return {
    // La répétition n'est le mode par défaut que si RIEN d'autre n'est demandé.
    repetition: !ecrire && !empaqueter,
    estampiller: ecrire,
    changelog: ecrire,
    empaqueter,
    publier,
  };
}

/**
 * Pairs INTERNES dont la plage n'est bornée par rien.
 *
 * `*` accepte tout, donc npm sert `latest` — c'est-à-dire, pour ce dépôt, la
 * 7.0.2 d'une autre ère. La garde existe parce que la convention est revenue
 * une fois : une règle retirée du code mais absente des gardes se réécrit toute
 * seule au paquet suivant, et personne ne le voit avant le registre.
 *
 * Les pairs EXTERNES sont laissés : leur cadence ne nous appartient pas.
 *
 * @param paquets - les publiables, `{ nom, pkg }`
 * @returns les pairs internes non bornés, nommés `paquet → dep@plage (champ)`
 */
export function pairsTropLarges(paquets) {
  const noms = new Set(paquets.map((p) => p.nom));
  const trop = [];
  for (const p of paquets) {
    for (const [dep, plage] of Object.entries(p.pkg.peerDependencies ?? {})) {
      if (noms.has(dep) && (plage === "*" || plage === "x")) {
        trop.push(`${p.nom} → ${dep}@${plage} (peerDependencies)`);
      }
    }
  }
  return trop;
}

/**
 * La version qu'ANNONCE une page de manuel roff, ou `null` si elle est illisible.
 *
 * `man/nodefony.1` est GÉNÉRÉE puis commitée, et elle embarque la version. Rien
 * ne la régénérait à l'estampillage : elle a annoncé `nodefony 10.0.0` dans le
 * tarball d'une `10.0.0-alpha.1`, et le gate de fraîcheur du cœur en est resté
 * rouge sur les trois plateformes — un échec qui ne nommait pas la release.
 *
 * La ligne `.TH` porte la version échappée à la mode roff (`10.0.0\-alpha.1`) :
 * le tiret y est protégé pour ne pas être pris pour une césure. On le retire
 * pour comparer à une version semver.
 *
 * Rend `null` plutôt que de deviner : une page qu'on ne sait pas lire ne doit
 * jamais se faire passer pour une page à jour.
 *
 * @param page - le contenu de la page de manuel
 * @returns la version annoncée, ou `null`
 */
export function versionDeLaPageMan(page) {
  const m = /^\.TH\s+\S+\s+\d+\s+"[^"]*"\s+"nodefony\s+([^"]+)"/m.exec(
    page ?? "",
  );
  return m ? m[1].replace(/\\-/g, "-").trim() : null;
}

/**
 * Les paquets de l'ère « Bundle », et ce qui les remplace en 10.
 *
 * Cette table est la SOURCE de la dépréciation : `docs/release/nodefony-10.md`
 * §7.3ter la commente, il ne la duplique pas. Une liste tenue à la main dans un
 * document et une autre dans un script divergent en silence — chacune paraît
 * juste à qui ne lit que l'une des deux.
 *
 * `successeur: null` n'est PAS un oubli : c'est une fin de vie assumée, dont le
 * message doit le dire clairement plutôt que renvoyer vers rien.
 */
export const PAQUETS_HISTORIQUES = [
  {
    nom: "@nodefony/http-bundle",
    successeur: "@nodefony/http",
    nature: "renommage",
  },
  {
    nom: "@nodefony/framework-bundle",
    successeur: "@nodefony/framework",
    nature: "renommage",
  },
  {
    nom: "@nodefony/security-bundle",
    successeur: "@nodefony/security",
    nature: "renommage",
  },
  {
    nom: "@nodefony/realtime-bundle",
    successeur: "@nodefony/realtime",
    nature: "renommage",
  },
  {
    nom: "@nodefony/redis-bundle",
    successeur: "@nodefony/redis",
    nature: "renommage",
  },
  {
    nom: "@nodefony/mongoose-bundle",
    successeur: "@nodefony/mongoose",
    nature: "renommage",
  },
  {
    nom: "@nodefony/documentation-bundle",
    successeur: "@nodefony/documentation",
    nature: "renommage",
  },
  {
    nom: "@nodefony/mongo-bundle",
    successeur: "@nodefony/mongoose",
    nature: "fusion",
  },
  {
    nom: "@nodefony/passport-wrapper",
    successeur: "@nodefony/security",
    nature: "fusion",
  },
  {
    nom: "@nodefony/sequelize-bundle",
    successeur: "@nodefony/drizzle",
    nature: "moteur",
  },
  {
    nom: "@nodefony/unittests-bundle",
    successeur: null,
    nature: "fin-de-vie",
    note: "les tests passent par vitest",
  },
  { nom: "@nodefony/mail-bundle", successeur: null, nature: "fin-de-vie" },
  { nom: "@nodefony/elastic-bundle", successeur: null, nature: "fin-de-vie" },
  {
    nom: "@nodefony/monitoring-bundle",
    successeur: null,
    nature: "fin-de-vie",
  },
  {
    nom: "@nodefony/demo-bundle",
    successeur: null,
    nature: "fin-de-vie",
    note: "une application se crée par `nodefony create app`",
  },
  { nom: "@nodefony/stage", successeur: null, nature: "fin-de-vie" },
];

/**
 * Les deux paquets qu'il ne faut JAMAIS déprécier, et pourquoi.
 *
 * Ils sont énumérés ICI plutôt que simplement absents de la table : une absence
 * ne dit pas si elle est voulue, et la question se reposerait à chaque release.
 */
export const EXCLUS_DE_LA_DEPRECIATION = [
  {
    nom: "nodefony",
    motif:
      "même nom, nouvelle majeure — déprécier le paquet déprécierait AUSSI la 10",
  },
  {
    nom: "nodefony-client",
    motif:
      "en production sur du télécom (SIP + médias), trajectoire propre — ce n'est pas un vestige",
  },
];

/**
 * Le message affiché à qui installe un paquet historique.
 *
 * Il NOMME où aller et ne promet aucune commande d'installation : le successeur
 * peut n'exister qu'en préversion, où `npm i <successeur>` servirait la 7. Un
 * message qui vieillit mal est pire qu'un message absent — il se lit comme une
 * instruction.
 *
 * @param entree - une entrée de {@link PAQUETS_HISTORIQUES}
 * @param depot - l'URL du dépôt à citer
 * @returns le message, prêt pour `npm deprecate`
 */
export function messageDeDepreciation(entree, depot) {
  const ou = `voir ${depot}`;
  const suffixe = entree.note ? ` — ${entree.note}` : "";
  switch (entree.nature) {
    case "renommage":
      return `Nodefony 10 : ce paquet devient ${entree.successeur} (${ou})${suffixe}`;
    case "fusion":
      return `Nodefony 10 : ce paquet est repris par ${entree.successeur} (${ou})${suffixe}`;
    case "moteur":
      return `Nodefony 10 : ce paquet est remplacé par ${entree.successeur}, qui change de moteur de base de données (${ou})${suffixe}`;
    case "fin-de-vie":
      return `Nodefony 10 : ce paquet n'a pas de successeur (${ou})${suffixe}`;
    default:
      throw new Error(`nature inconnue : ${entree.nature}`);
  }
}

/**
 * Refuse une publication dont le commit n'appartient pas à la branche de
 * publication — ou rend `null` si tout est en ordre.
 *
 * 🔴 La branche de publication n'est pas une convention de rangement : c'est
 * elle que décrivent le site public, les README publiés et les liens
 * `/blob/<branche>/` que reçoit l'installeur. Publier depuis une autre branche
 * met en ligne un code que rien de ce qui est publié ne décrit — et le défaut
 * ne se voit qu'après, chez celui qui suit un lien.
 *
 * Le verdict est INJECTÉ plutôt que lu : à la publication, la forge travaille
 * sur un HEAD détaché (checkout d'un tag), où `git branch --show-current` rend
 * une chaîne vide. Seule l'APPARTENANCE du commit à la branche se constate — et
 * une fonction pure la rend éprouvable sans fabriquer un dépôt.
 *
 * Une branche introuvable REFUSE, elle ne passe pas : une garde qui se désarme
 * quand elle ne sait pas ne garde rien. Le message nomme alors le geste.
 *
 * @param branche - la branche qui porte les publications (`main`)
 * @param brancheTrouvee - la référence existe-t-elle dans ce checkout ?
 * @param contenue - le commit publié appartient-il à cette branche ?
 * @returns le motif du refus, ou `null` si la publication peut se faire
 */
export function refusDePublicationHorsBranche({
  branche,
  brancheTrouvee,
  contenue,
}) {
  if (!brancheTrouvee) {
    return (
      `la branche de publication « ${branche} » est introuvable dans ce checkout.\n` +
      "  Impossible de vérifier que le tag est bien posé dessus — et l'on ne publie pas\n" +
      "  sur une question ouverte. Dans la forge : `fetch-depth: 0` sur actions/checkout.\n" +
      `  En local : git fetch origin ${branche}`
    );
  }
  if (!contenue) {
    return (
      `le commit publié n'appartient PAS à « ${branche} ».\n` +
      "  C'est cette branche que décrivent le site public, les README publiés et les\n" +
      "  liens `/blob/` que reçoit l'installeur : publier d'ailleurs met en ligne un code\n" +
      "  que rien de ce qui est publié ne décrit.\n" +
      `  Fusionner dans ${branche}, PUIS poser le tag sur ${branche}.`
    );
  }
  return null;
}

/**
 * Les paquets dont le dist-tag `latest` est resté sur une préversion PÉRIMÉE.
 *
 * 🔴 Le piège qu'elle nomme, constaté sur la `10.0.0-alpha.2` : npm pose
 * `latest` à la PREMIÈRE publication d'un paquet, quel que soit `--tag`. Les
 * treize paquets nés en `alpha.1` ont donc gardé `latest = 10.0.0-alpha.1` —
 * la version défectueuse — pendant que `alpha` avançait. `npm i @nodefony/http`
 * sans nommer de canal servait encore le défaut que la publication corrigeait.
 *
 * La règle est asymétrique, et c'est ce qui la rend sûre : on ne déplace
 * `latest` QUE s'il pointe déjà une préversion. S'il porte une version stable
 * — `nodefony` en `7.0.2` — y toucher servirait une alpha à tout `npm i` de
 * la terre, ce qu'aucune fenêtre de retrait ne rattrape.
 *
 * @param etats - un état par paquet : `{ nom, latest, publiee }`
 * @param estPreversion - dit si une version porte une étiquette de préversion
 * @returns les paquets à recaler, chacun avec le motif
 */
export function latestsRestesEnArriere(etats, estPreversion) {
  const aRecaler = [];
  for (const { nom, latest, publiee } of etats) {
    if (!latest || latest === publiee) continue;
    // `latest` stable : intouchable. C'est le cas qui protège `nodefony@7.0.2`.
    if (!estPreversion(latest)) continue;
    aRecaler.push({ nom, de: latest, vers: publiee });
  }
  return aRecaler;
}

/**
 * Trie les paquets avant un recalage de `latest` : ce qui est recalable, et ce
 * qui ne l'est PAS parce que la version visée n'existe pas au registre.
 *
 * 🔴 La garde que cette fonction ajoute à {@link latestsRestesEnArriere} : le
 * dépôt peut être EN AVANCE sur le registre — versions estampillées par
 * `--write` mais pas encore publiées, ou paquet neuf jamais sorti. Recaler
 * `latest` vers une version absente échoue paquet par paquet, au milieu d'un
 * lot, avec un message de npm qui ne dit pas la cause. On le CONSTATE avant de
 * toucher quoi que ce soit, et on le nomme.
 *
 * La décision de recalage elle-même n'est pas réécrite ici : elle est déléguée
 * à {@link latestsRestesEnArriere}, seule porteuse de la règle asymétrique qui
 * protège un `latest` stable.
 *
 * @param etats - un état par paquet : `{ nom, latest, publiee, versions }`,
 *   où `versions` liste les versions connues du registre (absent = non vérifié)
 * @param estPreversion - dit si une version porte une étiquette de préversion
 * @returns `{ aRecaler, absentes }` — les recalages à faire, et les paquets
 *   dont la version visée manque au registre
 */
export function trierPourRecalage(etats, estPreversion) {
  const absentes = [];
  const candidats = [];
  for (const etat of etats) {
    const { versions, nom, publiee } = etat;
    if (Array.isArray(versions) && !versions.includes(publiee)) {
      absentes.push({ nom, vers: publiee });
      continue;
    }
    candidats.push(etat);
  }
  return {
    aRecaler: latestsRestesEnArriere(candidats, estPreversion),
    absentes,
  };
}

/**
 * Lit la sortie de `npm view <nom> dist-tags versions --json`.
 *
 * 🔴 Le piège, vécu : npm ENVELOPPE sa réponse dans un tableau dès que le
 * spécificateur peut correspondre à plusieurs versions — ce qui est le cas d'un
 * nom nu. Lire `doc["dist-tags"]` sur ce tableau rend `undefined` en silence,
 * et le mode `--dist-tags` a annoncé « rien à recaler » sur quatorze paquets
 * qui l'étaient tous. Une sortie muette ne dit jamais qu'elle est mal lue.
 *
 * `dist-tags` est un champ du document racine, identique dans chaque élément de
 * l'enveloppe : le premier fait foi. Les listes de versions, elles, se
 * concatènent sans dommage — on ne fait qu'y chercher une appartenance.
 *
 * @param brut - la sortie standard de npm, telle quelle
 * @returns `{ latest, versions }`, ou `null` si la sortie est illisible
 */
export function lireVueNpm(brut) {
  let doc;
  try {
    doc = JSON.parse(brut ?? "");
  } catch {
    return null;
  }
  const vues = [doc].flat().filter((v) => v && typeof v === "object");
  if (vues.length === 0) return null;
  return {
    latest: vues[0]["dist-tags"]?.latest ?? null,
    versions: vues.flatMap((v) => [v.versions ?? []].flat()),
  };
}
