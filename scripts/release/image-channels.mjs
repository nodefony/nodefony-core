#!/usr/bin/env node
/**
 * Recale les étiquettes de préversion d'une image (`alpha`, `beta`, `rc`) restées
 * DERRIÈRE la version qui vient d'être publiée.
 *
 * C'est la règle des dist-tags npm ({@link canauxEnArriere}), appliquée au
 * registre d'images : un canal moins mûr promet d'être au moins aussi récent
 * qu'un canal plus mûr. Sans elle, la 10.0.0 aurait déplacé `:latest` et laissé
 * `:beta` sur la `10.0.0-beta.9` — `docker pull nodefony/nodefony:beta` aurait
 * servi une préversion plus VIEILLE que la stable, quand `npm create
 * nodefony@beta` sert la stable une fois les dist-tags recalés.
 *
 * La version servie par chaque étiquette se LIT dans le registre (étiquette OCI
 * `org.opencontainers.image.version`, gardée par `image-labels-gate.mjs`), elle
 * ne se suppose pas : une étiquette déjà en avance (une `11.0.0-beta.1` pendant
 * qu'on publie une `10.0.1`) n'est pas ramenée en arrière. Une étiquette absente
 * n'est pas créée.
 *
 * Chaque étiquette déplacée est une copie conforme de l'index `<version>` déjà
 * relu — même digest, CONSTATÉ dans le registre après coup.
 *
 * @usage node scripts/release/image-channels.mjs --depot <dépôt> --version <v> --mobile <étiquette> [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";
import {
  CANAUX_DE_PREVERSION,
  canauxEnArriere,
  imageVersionFromInspect,
} from "./release-core.mjs";

/**
 * La configuration d'une référence telle que le registre la sert.
 *
 * @param ref - `<dépôt>:<étiquette>`
 * @returns la sortie JSON d'`imagetools inspect`, ou `null` si l'étiquette n'existe pas
 * @throws Sur toute autre erreur du registre — un registre injoignable ne vaut pas absence
 */
function inspectImage(ref) {
  const r = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}"],
    { encoding: "utf8" },
  );
  if (r.status === 0) return JSON.parse(r.stdout);
  if (/: not found\s*$/m.test(r.stderr)) return null;
  throw new Error(`${ref} : ${r.stderr.trim() || `code ${r.status}`}`);
}

/**
 * L'empreinte d'une référence telle que le registre la sert.
 *
 * @param ref - `<dépôt>:<étiquette>`
 * @returns le digest de l'index, ou `""` s'il n'a pas pu être lu
 */
function digestOf(ref) {
  const r = spawnSync("docker", ["buildx", "imagetools", "inspect", ref], {
    encoding: "utf8",
  });
  return /^Digest:\s+(\S+)/m.exec(r.stdout)?.[1] ?? "";
}

/**
 * Lit les étiquettes de préversion d'un dépôt et recale celles qui sont en retard.
 *
 * @param options - dépôt, version publiée, étiquette mobile qu'elle vient de recevoir
 * @returns le code de sortie : 0, ou 1 si une étiquette déplacée ne sert pas l'index attendu
 */
export function recaleImageChannels({ depot, version, mobile, dryRun }) {
  const distTags = { [mobile]: version };
  for (const canal of CANAUX_DE_PREVERSION) {
    if (canal === mobile) continue;
    const image = inspectImage(`${depot}:${canal}`);
    if (image === null) continue;
    const servie = imageVersionFromInspect(image);
    if (servie === null || semver.valid(servie) === null) {
      console.log(
        `::warning::${depot}:${canal} ne porte pas de version lisible (« ${servie ?? "absente"} ») — laissée en place`,
      );
      continue;
    }
    distTags[canal] = servie;
  }

  const aRecaler = canauxEnArriere([{ nom: depot, distTags }], (a, b) =>
    semver.gt(a, b),
  );
  if (aRecaler.length === 0) {
    console.log(`✓ ${depot} : aucun canal de préversion en retard`);
    return 0;
  }
  for (const { tag, de, vers, devant } of aRecaler) {
    const ligne = `${depot}:${tag} ${de} → ${vers} (dépassé par :${devant})`;
    if (dryRun) {
      console.log(`(--dry-run) ${ligne}`);
      continue;
    }
    const r = spawnSync(
      "docker",
      [
        "buildx",
        "imagetools",
        "create",
        "-t",
        `${depot}:${tag}`,
        `${depot}:${vers}`,
      ],
      { stdio: "inherit" },
    );
    const attendu = digestOf(`${depot}:${vers}`);
    const obtenu = digestOf(`${depot}:${tag}`);
    if (r.status !== 0 || attendu === "" || obtenu !== attendu) {
      console.log(
        `::error::${depot}:${tag} (${obtenu || "?"}) n'est pas ${depot}:${vers} (${attendu || "?"})`,
      );
      return 1;
    }
    console.log(`::notice::${ligne} — ${attendu}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      depot: { type: "string" },
      version: { type: "string" },
      mobile: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const { depot, version, mobile } = values;
  if (!depot || !version || !mobile || semver.valid(version) === null) {
    console.error(
      "usage : image-channels.mjs --depot <dépôt> --version <semver> --mobile <étiquette> [--dry-run]",
    );
    process.exit(64);
  }
  process.exit(
    recaleImageChannels({ depot, version, mobile, dryRun: values["dry-run"] }),
  );
}
