/**
 * Le contrôle qui refuse une image porteuse d'un secret, éprouvé SANS docker.
 *
 * Les archives sont fabriquées ici, octet par octet, et c'est délibéré : passer
 * par le `tar` du système ferait dépendre le test de la grammaire d'un binaire
 * qui diffère entre bsdtar et GNU tar — or ce qu'on veut éprouver est justement
 * la lecture des TROIS façons d'écrire un nom long. Une seule non gérée ne lève
 * aucune erreur : le chemin manque, simplement, et un secret au nom long
 * devient invisible.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { cheminsDeLImage } from "./image-gate.mjs";

const BLOC = 512;
const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ICI, "image-gate.mjs");

/** Un en-tête tar de 512 octets, checksum comprise. */
function entete(nom, taille, type = "0", prefixe = "") {
  const bloc = Buffer.alloc(BLOC);
  bloc.write(nom.slice(0, 100), 0, "latin1");
  bloc.write("000644 \0", 100, "latin1");
  bloc.write("000000 \0", 108, "latin1");
  bloc.write("000000 \0", 116, "latin1");
  bloc.write(`${taille.toString(8).padStart(11, "0")} `, 124, "latin1");
  bloc.write("00000000000 ", 136, "latin1");
  bloc.write(type, 156, "latin1");
  bloc.write("ustar\x0000", 257, "latin1");
  if (prefixe) bloc.write(prefixe, 345, "latin1");
  // La somme se calcule le champ rempli d'espaces, puis s'écrit à sa place.
  bloc.write("        ", 148, "latin1");
  let somme = 0;
  for (const octet of bloc) somme += octet;
  bloc.write(`${somme.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return bloc;
}

/** Une archive tar à partir d'entrées `{ nom, contenu?, type?, prefixe? }`. */
function tar(entrees) {
  const morceaux = [];
  for (const e of entrees) {
    const contenu = Buffer.from(e.contenu ?? "", "utf8");
    morceaux.push(entete(e.nom, contenu.length, e.type ?? "0", e.prefixe));
    if (contenu.length > 0) {
      const rempli = Buffer.alloc(Math.ceil(contenu.length / BLOC) * BLOC);
      contenu.copy(rempli);
      morceaux.push(rempli);
    }
  }
  // Deux blocs nuls terminent l'archive.
  morceaux.push(Buffer.alloc(BLOC * 2));
  return Buffer.concat(morceaux);
}

/**
 * Un `docker save` synthétique : des couches gzippées, plus le manifeste qui
 * les déclare — c'est lui qui distingue « ce n'est pas une couche » de « cette
 * couche est illisible ».
 */
function dockerSave(couches, { manifeste = true, compresser = true } = {}) {
  const entrees = [];
  const noms = [];
  couches.forEach((entrees_couche, i) => {
    const nom = `blobs/sha256/${String(i).repeat(64).slice(0, 64)}`;
    const brut = tar(entrees_couche);
    noms.push(nom);
    entrees.push({
      nom,
      contenu: (compresser ? zlib.gzipSync(brut) : brut).toString("latin1"),
    });
  });
  if (manifeste) {
    entrees.push({
      nom: "manifest.json",
      contenu: JSON.stringify([{ Config: "c", RepoTags: ["t"], Layers: noms }]),
    });
  }
  // `latin1` préserve les octets un à un : le contenu binaire traverse `tar()`
  // sans être réinterprété en UTF-8, ce qui corromprait les couches gzippées.
  const morceaux = [];
  for (const e of entrees) {
    const contenu = Buffer.from(e.contenu, "latin1");
    morceaux.push(entete(e.nom, contenu.length));
    const rempli = Buffer.alloc(Math.ceil(contenu.length / BLOC) * BLOC);
    contenu.copy(rempli);
    morceaux.push(rempli);
  }
  morceaux.push(Buffer.alloc(BLOC * 2));
  return Buffer.concat(morceaux);
}

/** Écrit une archive dans un fichier jetable et rend son chemin. */
function fichierJetable(contenu) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "nf-gate-test-"));
  const chemin = path.join(dossier, "image.tar");
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

describe("cheminsDeLImage — lire TOUTES les couches, pas l'arborescence finale", () => {
  it("rend les chemins de plusieurs couches, dédoublonnés", async () => {
    const archive = fichierJetable(
      dockerSave([
        [{ nom: "app/index.js" }, { nom: "app/package.json" }],
        [{ nom: "app/index.js" }, { nom: "app/autre.js" }],
      ]),
    );
    const { chemins, couches } = await cheminsDeLImage(archive);
    expect(couches).toBe(2);
    expect([...chemins].sort()).toEqual([
      "app/autre.js",
      "app/index.js",
      "app/package.json",
    ]);
  });

  it("🔴 VOIT un fichier qu'une couche suivante EFFACE", async () => {
    // C'est la raison d'être du scan par couches : `docker export` rend
    // l'arborescence aplatie, où ce fichier n'existe plus — alors qu'il reste
    // lisible par quiconque télécharge l'image.
    const archive = fichierJetable(
      dockerSave([
        [{ nom: "app/privkey.pem" }],
        [{ nom: "app/.wh.privkey.pem" }, { nom: "app/index.js" }],
      ]),
    );
    const { chemins } = await cheminsDeLImage(archive);
    expect(chemins).toContain("app/privkey.pem");
    // Le marqueur d'effacement n'est pas un fichier de l'image.
    expect(chemins.some((c) => c.includes(".wh."))).toBe(false);
  });

  it.each([
    [
      "le préfixe ustar",
      [{ nom: "serveur.key", prefixe: "app/tres/long/chemin" }],
      "app/tres/long/chemin/serveur.key",
    ],
    [
      "l'en-tête long de GNU",
      [
        {
          nom: "././@LongLink",
          type: "L",
          contenu: `app/${"x".repeat(120)}.pem`,
        },
        { nom: "app/tronque.pem" },
      ],
      `app/${"x".repeat(120)}.pem`,
    ],
    [
      "l'en-tête étendu PAX",
      [
        {
          nom: "PaxHeader",
          type: "x",
          contenu: `${`30 path=app/${"y".repeat(110)}.key\n`.length} path=app/${"y".repeat(110)}.key\n`,
        },
        { nom: "app/tronque.key" },
      ],
      `app/${"y".repeat(110)}.key`,
    ],
  ])("lit un nom long écrit avec %s", async (_forme, entrees, attendu) => {
    const archive = fichierJetable(dockerSave([entrees]));
    const { chemins } = await cheminsDeLImage(archive);
    expect(chemins).toContain(attendu);
  });

  it("lit une couche NON compressée", async () => {
    const archive = fichierJetable(
      dockerSave([[{ nom: "app/privkey.pem" }]], { compresser: false }),
    );
    const { chemins } = await cheminsDeLImage(archive);
    expect(chemins).toContain("app/privkey.pem");
  });

  it("🔴 REFUSE de conclure sans manifeste, au lieu de ne voir aucune couche", async () => {
    // Sans manifeste, un contrôle qui devinerait les couches ne saurait pas
    // distinguer un blob de configuration d'une couche corrompue — et rendrait
    // « rien de suspect » sur une image qu'il n'a pas lue.
    const archive = fichierJetable(
      dockerSave([[{ nom: "app/privkey.pem" }]], { manifeste: false }),
    );
    await expect(cheminsDeLImage(archive)).rejects.toThrow(/manifest\.json/);
  });

  it("🔴 REFUSE quand une couche déclarée est absente", async () => {
    const brut = dockerSave([[{ nom: "app/index.js" }]]);
    const altere = Buffer.from(
      brut.toString("latin1").replace("0".repeat(64), "9".repeat(64)),
      "latin1",
    );
    await expect(cheminsDeLImage(fichierJetable(altere))).rejects.toThrow(
      /couche déclarée mais absente/,
    );
  });
});

describe("image-gate — le verdict rendu en ligne de commande", () => {
  const lancer = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  /** Un inventaire dans un fichier — le point d'injection sans docker. */
  const inventaire = (lignes) => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "nf-gate-inv-"));
    const chemin = path.join(dossier, "fichiers.txt");
    fs.writeFileSync(chemin, lignes.join("\n"));
    return chemin;
  };

  it("REFUSE en nommant le fichier, code 1", () => {
    const r = lancer([
      "--files",
      inventaire([
        "app/index.js",
        "app/nodefony/config/certificates/server/privkey.pem",
      ]),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("privkey.pem");
    expect(r.stderr).toContain("REFUS");
  });

  it("ACCEPTE une image saine, code 0", () => {
    const r = lancer([
      "--files",
      inventaire(["app/index.js", "app/package.json", "usr/bin/node"]),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rien de suspect");
  });

  it("distingue « aveugle » (code 2) de « favorable » (code 0)", () => {
    // Un appelant qui teste `!== 0` refuse dans les deux cas : c'est voulu.
    // Ce qui compte est qu'un journal ne puisse pas lire l'un pour l'autre.
    const r = lancer(["--files", path.join(os.tmpdir(), "nf-absent-xyz.txt")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("CONTRÔLE AVEUGLE");
  });
});
