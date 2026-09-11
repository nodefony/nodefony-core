#!/usr/bin/env node
/**
 * **Refuse de publier une image dont les étiquettes OCI ne disent pas d'où elle vient.**
 *
 * Les étiquettes `org.opencontainers.image.*` servent à une seule chose qui
 * compte : remonter d'une image qui tourne en production au commit qui l'a
 * produite. La `10.0.0-alpha.4` est partie sur Docker Hub avec
 * `version="0.1.0"`, `revision=""` et `created=""` — le gabarit déclarait bien
 * les `ARG`, mais la forge ne passait aucun `--build-arg`.
 *
 * ## Pourquoi une étiquette FAUSSE est pire qu'une étiquette absente
 *
 * `revision=""` empêche la remontée ; `version="0.1.0"` sur une image nommée
 * `10.0.0-alpha.5` la fait ÉCHOUER SILENCIEUSEMENT : un outil de supervision
 * affiche la mauvaise version, et personne ne cherche plus loin. C'est la même
 * famille de défaut qu'un verdict plausible et faux — on préférerait ne rien
 * savoir.
 *
 * ## Ce que ce script n'est pas
 *
 * Ce n'est pas le contrôle de matière sensible : c'est `image-gate.mjs`, qui lit
 * les COUCHES. Les deux gardent la même publication mais n'ont ni le même
 * verdict ni le même coût — les mélanger rendrait le refus illisible
 * (« image refusée », pour quoi ?) et obligerait à lire un `docker save` de
 * plusieurs centaines de mégaoctets pour contrôler trois chaînes.
 *
 * ## Codes de sortie
 *
 * - `0` — les étiquettes disent vrai.
 * - `1` — au moins une étiquette manque, est vide ou contredit l'attendu.
 * - `2` — **on n'a PAS PU regarder** (docker muet, image absente, JSON illisible).
 *   Ne pas savoir regarder n'est pas un verdict favorable : l'appelant refuse
 *   sur `!= 0`, donc dans les deux cas.
 *
 * @example
 * ```bash
 * node scripts/release/image-labels-gate.mjs nodefony/nodefony:10.0.0-alpha.5 \
 *   --version 10.0.0-alpha.5 --revision "$GITHUB_SHA"
 * ```
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Préfixe des étiquettes normées par l'Open Container Initiative. */
const OCI = "org.opencontainers.image";

/**
 * Une révision est un SHA-1 de commit complet — 40 hexadécimaux.
 *
 * La forme COURTE est refusée délibérément : `git rev-parse --short` est
 * ambigu par construction (sa longueur dépend de la taille du dépôt), et une
 * remontée automatique qui doit deviner combien de caractères comparer n'est
 * pas une remontée.
 */
const REVISION = /^[0-9a-f]{40}$/;

/**
 * Valeurs que le gabarit porte en DÉFAUT : les voir dans une image publiée
 * signifie exactement que la chaîne de construction n'a rien passé.
 *
 * `0.1.0` est le défaut d'`ARG VERSION` du `Dockerfile.tpl`. Le contrôle ne
 * l'interdit pas dans l'absolu — une application peut légitimement en être à sa
 * `0.1.0` — il le refuse quand l'attendu dit autre chose, ce qui est le seul cas
 * où il ment.
 */
const ATTENDUS_REQUIS = ["version", "revision", "created"];

/**
 * Confronte les étiquettes d'une image à ce que la chaîne de construction
 * prétend y avoir mis.
 *
 * Fonction PURE : elle ne connaît ni docker ni le réseau, pour être éprouvable
 * sans image — c'est ce qui permet de la voir mordre sur chaque famille d'écart
 * en quelques millisecondes.
 *
 * @param labels - Les étiquettes lues sur l'image (`Config.Labels`), telles quelles.
 * @param attendu - Ce que l'appelant a passé au build : `version`, `revision`, et `title` interdits.
 * @returns La liste des écarts, vide quand tout dit vrai.
 */
function controlerEtiquettes(labels, attendu = {}) {
  const ecarts = [];
  const lu = (cle) => (labels ?? {})[`${OCI}.${cle}`];

  for (const cle of ATTENDUS_REQUIS) {
    const valeur = lu(cle);
    if (valeur === undefined) {
      ecarts.push(`${OCI}.${cle} : étiquette ABSENTE de l'image`);
    } else if (String(valeur).trim() === "") {
      ecarts.push(`${OCI}.${cle} : étiquette VIDE — aucun --build-arg passé ?`);
    }
  }

  const version = lu("version");
  if (attendu.version && version && version !== attendu.version) {
    ecarts.push(
      `${OCI}.version = « ${version} » alors que la construction publie ` +
        `« ${attendu.version} » — une supervision afficherait la mauvaise version`,
    );
  }

  const revision = lu("revision");
  if (revision && revision.trim() !== "" && !REVISION.test(revision)) {
    ecarts.push(
      `${OCI}.revision = « ${revision} » : ce n'est pas un SHA de commit ` +
        `complet (40 hexadécimaux) — la remontée vers le code échouerait`,
    );
  }
  if (attendu.revision && revision && revision !== attendu.revision) {
    ecarts.push(
      `${OCI}.revision = « ${revision} » alors que la construction est faite ` +
        `sur « ${attendu.revision} »`,
    );
  }

  const created = lu("created");
  if (created && created.trim() !== "" && Number.isNaN(Date.parse(created))) {
    ecarts.push(
      `${OCI}.created = « ${created} » : date illisible (ISO 8601 attendu)`,
    );
  }

  const title = lu("title");
  if (attendu.titreInterdit && title === attendu.titreInterdit) {
    ecarts.push(
      `${OCI}.title = « ${title} » : c'est le nom de l'application TÉMOIN, ` +
        `pas celui de l'image publiée`,
    );
  }

  return ecarts;
}

/**
 * Lit les étiquettes d'une image locale.
 *
 * @param image - Le nom complet de l'image, tag compris.
 * @returns Les étiquettes, ou `null` si l'on n'a pas pu regarder.
 */
function etiquettesDeLImage(image) {
  const r = spawnSync(
    "docker",
    ["inspect", "--format", "{{json .Config.Labels}}", image],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0) return null;
  try {
    const json = JSON.parse(r.stdout.trim());
    // `docker inspect` rend `null` — pas `{}` — quand l'image ne porte aucune
    // étiquette. C'est un CONSTAT, pas une panne de lecture : on rend un objet
    // vide pour que le contrôle nomme les trois absentes au lieu de sortir en 2.
    return json === null ? {} : json;
  } catch {
    return null;
  }
}

/**
 * Point d'entrée.
 *
 * @param argv - Arguments, sans `node` ni le chemin du script.
 * @returns Le code de sortie.
 */
function principal(argv) {
  const image = argv.find((a) => !a.startsWith("--"));
  const option = (nom) => {
    const i = argv.indexOf(`--${nom}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (!image) {
    console.error(
      "usage : image-labels-gate.mjs <image> [--version V] [--revision SHA] [--titre-interdit NOM]",
    );
    return 2;
  }

  const labels = etiquettesDeLImage(image);
  if (labels === null) {
    console.error(
      `✗ étiquettes illisibles sur « ${image} » — docker muet ou image absente. ` +
        `Ne pas savoir regarder n'est pas un verdict favorable.`,
    );
    return 2;
  }

  const ecarts = controlerEtiquettes(labels, {
    version: option("version"),
    revision: option("revision"),
    titreInterdit: option("titre-interdit"),
  });

  if (ecarts.length > 0) {
    console.error(`✗ étiquettes OCI fausses sur « ${image} » :`);
    for (const e of ecarts) console.error(`   · ${e}`);
    return 1;
  }

  console.log(
    `✓ étiquettes OCI : version=${labels[`${OCI}.version`]} ` +
      `revision=${labels[`${OCI}.revision`]} ` +
      `created=${labels[`${OCI}.created`]}`,
  );
  return 0;
}

// Axiome de portabilité : on compare des URL, jamais des chemins — sous Windows
// `D:\…` se lit comme un protocole, et la comparaison serait faussée sans erreur.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  try {
    process.exitCode = principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(`\n✗ CONTRÔLE AVEUGLE — ${erreur.message}\n`);
    process.exitCode = 2;
  }
}

export { controlerEtiquettes, etiquettesDeLImage };
