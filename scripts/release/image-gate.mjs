#!/usr/bin/env node
/**
 * **Refuse de publier une image de conteneur qui embarque un secret.**
 *
 * La `10.0.0-alpha.4` a été publiée sur Docker Hub avec
 * `/app/nodefony/config/certificates/server/privkey.pem` — une clé RSA 2048 que
 * TOUS ses déploiements auraient partagée. Le chemin qui l'y a mise est fermé
 * depuis (`.dockerignore` généré, plus aucun certificat fabriqué en production),
 * mais rien ne REGARDAIT l'image : le défaut pouvait revenir par un gabarit
 * enrichi ou un `.dockerignore` amputé, sans qu'aucun signal existe.
 *
 * ## Pourquoi les COUCHES, et pas le système de fichiers final
 *
 * `docker export` rend l'arborescence APLATIE. Or une couche reste lisible par
 * qui télécharge l'image, même quand une couche suivante efface le fichier :
 * `COPY secret .` puis `RUN rm secret` produit une image où le secret est
 * absent de l'export et **présent dans le dépôt d'images**. Un contrôle bâti
 * sur l'export serait donc vert précisément dans le cas le plus fautif — la
 * définition même d'une garde qui ne peut rien voir.
 *
 * On lit donc `docker save`, et l'on parcourt CHAQUE couche. Une couche qu'on ne
 * sait pas décoder fait ÉCHOUER la passe : ne pas savoir regarder n'est pas un
 * verdict favorable.
 *
 * ## Ce que ce script n'est pas
 *
 * Ce n'est pas un scanner de secrets par contenu — c'est le métier de
 * `gitleaks`, que la forge lance sur l'arbre et son historique (`secrets.yml`).
 * Ici la règle porte sur les NOMS, et c'est la même que pour les tarballs npm :
 * `detecterSuspectsImage` n'est qu'un filtre devant `detecterSuspects`.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/release/image-gate.mjs nodefony/nodefony:10.0.0-alpha.5
 * node scripts/release/image-gate.mjs --files inventaire.txt   # sans docker
 * ```
 *
 * Sortie 0 = rien de suspect. Sortie 1 = refus, chaque fichier nommé.
 * Sortie 2 = le contrôle n'a pas pu regarder (à traiter comme un refus).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

import { detecterSuspectsImage } from "./release-core.mjs";

const TAILLE_BLOC = 512;

/** Le contrôle n'a pas pu regarder — distinct d'un verdict défavorable. */
class ControleAveugle extends Error {}

/**
 * Décode un en-tête tar de 512 octets.
 *
 * @param bloc - les 512 octets
 * @returns `null` sur un bloc de fin, sinon `{ nom, taille, type }`
 */
function lireEntete(bloc) {
  // Un bloc entièrement nul marque la fin de l'archive.
  if (bloc.every((octet) => octet === 0)) return null;

  const champ = (debut, longueur) => {
    const brut = bloc.subarray(debut, debut + longueur);
    const fin = brut.indexOf(0);
    return brut.subarray(0, fin === -1 ? brut.length : fin).toString("latin1");
  };

  // La taille est en octal ASCII, sauf au-delà de 8 Go où GNU pose le bit haut
  // et écrit en base 256. Deviner l'un pour l'autre rendrait une taille absurde,
  // donc un saut faux, donc une archive lue de travers SANS erreur.
  let taille;
  if (bloc[124] & 0x80) {
    taille = 0;
    for (let i = 125; i < 136; i += 1) taille = taille * 256 + bloc[i];
  } else {
    const octal = champ(124, 12).trim();
    taille = octal ? Number.parseInt(octal, 8) : 0;
  }
  if (!Number.isFinite(taille) || taille < 0) {
    throw new ControleAveugle("en-tête tar illisible : taille invalide");
  }

  const nom = champ(0, 100);
  const prefixe = champ(345, 155);
  return {
    nom: prefixe ? `${prefixe}/${nom}` : nom,
    taille,
    type: String.fromCharCode(bloc[156] || 0x30),
  };
}

/** Taille occupée par des données, padding de bloc compris. */
const aligne = (taille) => Math.ceil(taille / TAILLE_BLOC) * TAILLE_BLOC;

/**
 * Parcourt une archive tar NON compressée depuis un descripteur, sans charger
 * les données : on saute d'en-tête en en-tête.
 *
 * Sert à la première passe, sur le `docker save` lui-même — dont les entrées
 * (`blobs/sha256/<hex>`) sont de noms courts, mais dont les contenus pèsent des
 * centaines de mégaoctets.
 *
 * @param fd - descripteur ouvert en lecture
 * @returns les entrées avec la position de leurs données
 */
function inventairePeuProfond(fd) {
  const entrees = [];
  const bloc = Buffer.alloc(TAILLE_BLOC);
  let position = 0;
  for (;;) {
    const lus = fs.readSync(fd, bloc, 0, TAILLE_BLOC, position);
    if (lus === 0) break;
    if (lus < TAILLE_BLOC) {
      throw new ControleAveugle("archive tronquée dans un en-tête");
    }
    const entete = lireEntete(bloc);
    if (!entete) break;
    position += TAILLE_BLOC;
    entrees.push({ ...entete, position });
    position += aligne(entete.taille);
  }
  return entrees;
}

/**
 * Rend tous les chemins d'une archive tar lue en FLUX, mémoire bornée.
 *
 * Gère les trois façons d'écrire un nom long, parce que les couches d'image en
 * sont pleines (`node_modules/...`) : le champ `prefix` de ustar, l'entrée
 * `typeflag L` de GNU, et l'en-tête étendu PAX (`typeflag x`). En ignorer un
 * ne lèverait aucune erreur — le chemin manquerait, simplement, et un secret
 * au nom long deviendrait invisible.
 *
 * @param flux - le contenu de l'archive, déjà décompressé
 * @returns les chemins, sans `/` initial
 */
async function cheminsDuFlux(flux) {
  const chemins = [];
  let reste = Buffer.alloc(0);
  // Ce qu'il reste à traverser des données de l'entrée courante.
  let aTraverser = 0;
  let capture = null;
  // Nom imposé à l'entrée SUIVANTE par un en-tête de nom long.
  let nomImpose = null;

  const finirCapture = () => {
    const contenu = Buffer.concat(capture.morceaux).subarray(0, capture.taille);
    if (capture.genre === "gnu") {
      nomImpose = contenu.toString("utf8").replace(/\0+$/, "");
    } else {
      // PAX : une suite d'enregistrements « <longueur> clé=valeur\n ».
      const texte = contenu.toString("utf8");
      const trouve = /(?:^|\n)\d+ path=([^\n]*)/.exec(texte);
      if (trouve) nomImpose = trouve[1];
    }
    capture = null;
  };

  for await (const morceau of flux) {
    reste = reste.length ? Buffer.concat([reste, morceau]) : morceau;
    for (;;) {
      if (aTraverser > 0) {
        const n = Math.min(aTraverser, reste.length);
        if (capture) capture.morceaux.push(Buffer.from(reste.subarray(0, n)));
        reste = reste.subarray(n);
        aTraverser -= n;
        if (aTraverser > 0) break;
        if (capture) finirCapture();
        continue;
      }
      if (reste.length < TAILLE_BLOC) break;
      const entete = lireEntete(reste.subarray(0, TAILLE_BLOC));
      reste = reste.subarray(TAILLE_BLOC);
      if (!entete) return chemins;

      if (entete.type === "L" || entete.type === "K") {
        // 'K' porte un nom de LIEN long : capturé pour être traversé
        // proprement, mais il ne renomme pas l'entrée suivante.
        capture =
          entete.type === "L"
            ? { genre: "gnu", taille: entete.taille, morceaux: [] }
            : null;
        aTraverser = aligne(entete.taille);
        continue;
      }
      if (entete.type === "x" || entete.type === "X") {
        capture = { genre: "pax", taille: entete.taille, morceaux: [] };
        aTraverser = aligne(entete.taille);
        continue;
      }

      const nom = nomImpose ?? entete.nom;
      nomImpose = null;
      // Un whiteout `.wh.<nom>` dit qu'une couche EFFACE un fichier des couches
      // précédentes. Le fichier effacé reste lisible dans la couche qui le
      // porte, et c'est elle qui nous intéresse : le marqueur, lui, n'est pas
      // un fichier de l'image.
      if (!/(^|\/)\.wh\./.test(nom)) chemins.push(nom.replace(/^\.?\//, ""));
      aTraverser = aligne(entete.taille);
    }
  }
  if (aTraverser > 0) throw new ControleAveugle("archive tronquée");
  return chemins;
}

/** Un flux décompressé pour la couche, choisi sur le MAGIC et non sur le nom. */
function fluxDecompresse(archive, entree) {
  const magic = Buffer.alloc(4);
  const fd = fs.openSync(archive, "r");
  try {
    fs.readSync(fd, magic, 0, 4, entree.position);
  } finally {
    fs.closeSync(fd);
  }
  const brut = fs.createReadStream(archive, {
    start: entree.position,
    end: entree.position + entree.taille - 1,
  });
  if (magic[0] === 0x1f && magic[1] === 0x8b)
    return brut.pipe(zlib.createGunzip());
  if (magic.equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    if (typeof zlib.createZstdDecompress !== "function") {
      throw new ControleAveugle(
        "couche compressée en zstd et ce Node ne sait pas la lire — " +
          "le contrôle serait aveugle, pas favorable",
      );
    }
    return brut.pipe(zlib.createZstdDecompress());
  }
  // Ni gzip ni zstd : une couche peut être un tar nu.
  return brut;
}

/** Lit le contenu d'une entrée du tar externe (petits fichiers de métadonnées). */
function lireEntree(archive, entree) {
  const tampon = Buffer.alloc(entree.taille);
  const fd = fs.openSync(archive, "r");
  try {
    fs.readSync(fd, tampon, 0, entree.taille, entree.position);
  } finally {
    fs.closeSync(fd);
  }
  return tampon;
}

/**
 * Les couches DÉCLARÉES par le manifeste du `docker save`.
 *
 * Les reconnaître en tentant de les lire serait plus court, et faux : un blob de
 * configuration n'est pas une archive, si bien que « ce n'est pas une couche » et
 * « cette couche est illisible » deviendraient le même événement — et le second
 * passerait en silence. Le manifeste tranche ; son absence est un refus, pas une
 * absence de couches.
 *
 * @param archive - le fichier produit par `docker save`
 * @param entrees - l'inventaire de premier niveau
 * @returns les entrées qui sont des couches, dans l'ordre du manifeste
 */
function couchesDeclarees(archive, entrees) {
  const parNom = new Map(entrees.map((e) => [e.nom, e]));
  const manifeste = parNom.get("manifest.json");
  if (!manifeste) {
    throw new ControleAveugle(
      "pas de manifest.json — ce n'est pas un `docker save`, " +
        "ou son format a changé et le contrôle ne sait plus quoi lire",
    );
  }
  let declarees;
  try {
    declarees = JSON.parse(lireEntree(archive, manifeste).toString("utf8"));
  } catch (erreur) {
    throw new ControleAveugle(`manifest.json illisible : ${erreur.message}`);
  }

  const couches = [];
  const vues = new Set();
  // Une image multi-architecture porte plusieurs manifestes : chacun apporte ses
  // couches, et il faut TOUTES les regarder — c'est l'image entière qui est
  // publiée sous un tag, pas la seule variante de la machine qui construit.
  for (const image of Array.isArray(declarees) ? declarees : []) {
    for (const nom of image?.Layers ?? []) {
      if (vues.has(nom)) continue;
      const entree = parNom.get(nom);
      if (!entree) {
        throw new ControleAveugle(
          `couche déclarée mais absente de l'archive : ${nom}`,
        );
      }
      vues.add(nom);
      couches.push(entree);
    }
  }
  if (couches.length === 0) {
    throw new ControleAveugle("manifest.json ne déclare aucune couche");
  }
  return couches;
}

/**
 * Tous les chemins de toutes les couches d'une image, dédoublonnés.
 *
 * @param archive - le fichier produit par `docker save`
 * @returns `{ chemins, couches }`
 */
async function cheminsDeLImage(archive) {
  const fd = fs.openSync(archive, "r");
  let entrees;
  try {
    entrees = inventairePeuProfond(fd);
  } finally {
    fs.closeSync(fd);
  }

  const chemins = new Set();
  const couches = couchesDeclarees(archive, entrees);
  for (const entree of couches) {
    let lus;
    try {
      lus = await cheminsDuFlux(fluxDecompresse(archive, entree));
    } catch (erreur) {
      // Une couche déclarée qu'on ne sait pas lire rend le contrôle aveugle :
      // c'est un refus, jamais un silence.
      throw erreur instanceof ControleAveugle
        ? erreur
        : new ControleAveugle(
            `couche ${entree.nom} illisible : ${erreur.message}`,
          );
    }
    for (const chemin of lus) chemins.add(chemin);
  }
  return { chemins: [...chemins], couches: couches.length };
}

/** `docker save` dans un fichier temporaire, supprimé par l'appelant. */
function sauverImage(image) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "nf-image-gate-"));
  const archive = path.join(dossier, "image.tar");
  const passe = spawnSync("docker", ["save", image, "-o", archive], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (passe.error || passe.status !== 0) {
    fs.rmSync(dossier, { recursive: true, force: true });
    throw new ControleAveugle(
      `\`docker save ${image}\` a échoué — image absente, ou démon injoignable`,
    );
  }
  return { dossier, archive };
}

async function principal(argv) {
  const drapeauFichiers = argv.indexOf("--files");
  let chemins;
  let origine;
  let nettoyer = () => {};

  if (drapeauFichiers !== -1) {
    // Point d'injection : l'inventaire vient d'un fichier, donc la règle
    // s'éprouve sans démon docker — c'est la partie qu'on veut voir mordre en
    // test, pas la lecture d'un tar.
    const liste = argv[drapeauFichiers + 1];
    if (!liste) throw new ControleAveugle("--files attend un chemin");
    chemins = fs
      .readFileSync(liste, "utf8")
      .split("\n")
      .map((ligne) => ligne.trim().replace(/^\.?\//, ""))
      .filter(Boolean);
    origine = `${chemins.length} chemin(s) depuis ${liste}`;
  } else {
    const image = argv.find((a) => !a.startsWith("--"));
    if (!image) {
      throw new ControleAveugle(
        "usage : image-gate.mjs <image[:tag]> | --files <inventaire>",
      );
    }
    const { dossier, archive } = sauverImage(image);
    nettoyer = () => fs.rmSync(dossier, { recursive: true, force: true });
    try {
      const lu = await cheminsDeLImage(archive);
      chemins = lu.chemins;
      origine = `${image} — ${lu.couches} couche(s), ${chemins.length} chemin(s)`;
    } finally {
      nettoyer();
    }
  }

  const suspects = detecterSuspectsImage(chemins);
  if (suspects.length > 0) {
    console.error(`\n✗ REFUS — matière sensible dans l'image (${origine})\n`);
    for (const suspect of suspects) console.error(`    ${suspect}`);
    console.error(
      "\n  Une couche reste lisible par qui télécharge l'image, même effacée\n" +
        "  par une couche suivante : ces fichiers seraient PUBLICS, et un secret\n" +
        "  publié est compromis à la seconde où il est en ligne.\n" +
        "  → exclure du contexte de construction (`.dockerignore` de l'app),\n" +
        "    puis reconstruire. Ne pas se contenter d'un `rm` dans le Dockerfile.\n",
    );
    return 1;
  }
  console.log(`✓ image — rien de suspect (${origine})`);
  return 0;
}

// Axiome de portabilité : on compare des URL, jamais des chemins — sous Windows
// `D:\…` se lit comme un protocole, et la comparaison serait faussée sans erreur.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (erreur) {
    // Un contrôle qui ne peut pas regarder se distingue d'un contrôle
    // favorable : code 2, et un appelant qui teste `!== 0` refuse quand même.
    console.error(`\n✗ CONTRÔLE AVEUGLE — ${erreur.message}\n`);
    process.exitCode = 2;
  }
}

export { cheminsDeLImage, cheminsDuFlux, lireEntete };
