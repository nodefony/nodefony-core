#!/usr/bin/env node
/**
 * Auto-contrôle du juge « recevoir un fichier ».
 *
 * Trois choses à éprouver, et la dernière est celle qui compte :
 *
 *  1. les causes se DISTINGUENT — « la route n'existe pas », « elle refuse »,
 *     « elle accepte et ne range rien » appellent trois gestes différents ;
 *  2. l'ORDRE — la traversée de chemin passe devant tout ce qui relève du
 *     confort : une application qui range bien les fichiers honnêtes ET laisse
 *     un client écrire ailleurs est plus dangereuse qu'une qui ne marche pas ;
 *  3. la COMPOSITION du corps multipart et la RECHERCHE d'évasion, qui sont les
 *     deux endroits où ce juge peut mentir en silence — un nom échappé ne
 *     mesurerait qu'un client poli, et une recherche qui ne descend pas assez
 *     loin rendrait « conforme » sur une évasion réussie.
 *
 *   node gate-upload.selftest.mjs
 *   node gate-upload.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  judge,
  chercherHorsDepot,
  composerMultipart,
  CAUSES,
  DOSSIER_DEPOT,
  NOMS_HOSTILES,
} from "./gate-upload.mjs";

const PARFAIT = {
  statutDepot: 201,
  rangeSousDepot: true,
  reponseNomme: true,
  evasions: [],
};

const cas = [
  { nom: "conforme", attendu: "conforme", faits: PARFAIT },
  {
    nom: "route jamais montee",
    attendu: "route-absente",
    faits: { ...PARFAIT, statutDepot: 404 },
  },
  {
    nom: "envoi legitime refuse",
    attendu: "depot-refuse",
    faits: { ...PARFAIT, statutDepot: 500 },
  },
  {
    // Le refus le plus trompeur : 2xx, et rien sur le disque. L'appelant croit
    // avoir déposé.
    nom: "repond 2xx et ne range rien",
    attendu: "fichier-introuvable",
    faits: { ...PARFAIT, rangeSousDepot: false },
  },
  {
    nom: "range mais ne dit pas quoi",
    attendu: "reponse-muette",
    faits: { ...PARFAIT, reponseNomme: false },
  },
  {
    // 🔴 LE cas qui justifie la tâche. Tout est vert — la route répond, le
    // fichier honnête est rangé, la réponse le nomme — et un client a écrit
    // hors du dossier.
    nom: "tout marche ET le client ecrit ailleurs",
    attendu: "traversee-de-chemin",
    faits: { ...PARFAIT, evasions: ["/tmp/app/evade-nodefony-bench.txt"] },
  },
  {
    // L'évasion passe devant un dépôt en panne : le geste à faire n'est pas le
    // même, et l'un des deux est urgent.
    nom: "evasion malgre un depot en panne",
    attendu: "traversee-de-chemin",
    faits: {
      ...PARFAIT,
      statutDepot: 500,
      rangeSousDepot: false,
      evasions: ["/tmp/app/evade-windows-bench.txt"],
    },
  },
  {
    // …mais une route ABSENTE passe encore devant : sans route, il n'y a rien
    // eu à écrire, et une évasion trouvée là viendrait d'ailleurs.
    nom: "route absente prime sur tout",
    attendu: "route-absente",
    faits: { ...PARFAIT, statutDepot: 404, evasions: ["/tmp/x.txt"] },
  },
];

const PROVE = process.argv.includes("--prove");
let rouges = 0;
for (const c of cas) {
  const v = judge(c.faits);
  // La règle amputée : la traversée reléguée APRÈS le confort — exactement
  // l'ordre qu'on aurait écrit sans y penser.
  const ampute = c.nom === "tout marche ET le client ecrit ailleurs";
  const cause = PROVE && ampute ? "conforme" : v.cause;
  const ok = cause === c.attendu && v.code === CAUSES[cause];
  if (!ok) {
    rouges += 1;
    console.error(`✗ ${c.nom} : attendu « ${c.attendu} », obtenu « ${cause} »`);
  } else {
    console.log(`✓ ${c.nom} → ${cause} (${v.code})`);
  }
}

// ─── La COMPOSITION du corps : le nom hostile part TEL QUEL ──────────────────
// Un juge qui échapperait le nom mesurerait un client poli, et rendrait
// « conforme » sur une application vulnérable.
{
  const { corps, contentType } = composerMultipart(
    "file",
    NOMS_HOSTILES[0],
    "charge",
  );
  const texte = corps.toString("utf8");
  try {
    assert.ok(
      texte.includes(`filename="${NOMS_HOSTILES[0]}"`),
      "le nom hostile doit partir TEL QUEL, sans échappement",
    );
    assert.ok(texte.includes("charge"), "le contenu doit être dans le corps");
    assert.match(contentType, /^multipart\/form-data; boundary=/u);
    assert.ok(
      texte.includes(contentType.split("boundary=")[1]),
      "la frontière annoncée doit être celle du corps",
    );
    console.log("✓ multipart : nom hostile intact, frontière cohérente");
  } catch (e) {
    rouges += 1;
    console.error(`✗ multipart : ${e.message}`);
  }
}

// ─── La RECHERCHE d'évasion, sur un arbre RÉEL ───────────────────────────────
// Trois pièges, tous vécus dans cette famille de sondes : ne pas descendre
// assez loin, ne pas remonter au parent (là où `../..` atterrit), et compter
// pour une évasion le fichier légitimement rangé dans le dossier de dépôt.
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-upload-selftest-"));
  const app = path.join(tmp, "app");
  const cible = NOMS_HOSTILES.map((n) => n.split(/[/\\]/).pop());
  try {
    mkdirSync(path.join(app, DOSSIER_DEPOT), { recursive: true });
    mkdirSync(path.join(app, "nodefony", "controllers"), { recursive: true });

    // (a) rien nulle part → aucune évasion.
    assert.deepEqual(
      chercherHorsDepot(app, cible),
      [],
      "un arbre propre ne doit rendre aucune évasion",
    );

    // (b) le fichier RANGÉ au bon endroit n'est PAS une évasion, même s'il
    //     porte le nom hostile réduit à son dernier segment.
    writeFileSync(path.join(app, DOSSIER_DEPOT, cible[0]), "ok");
    assert.deepEqual(
      chercherHorsDepot(app, cible),
      [],
      "le dossier de dépôt est la destination : ce qui s'y trouve est légitime",
    );

    // (c) écrit à la racine de l'app → évasion vue.
    writeFileSync(path.join(app, cible[0]), "évadé");
    assert.equal(
      chercherHorsDepot(app, cible).length,
      1,
      "un fichier à la racine de l'app est une évasion",
    );

    // (d) écrit CHEZ LE PARENT — c'est là qu'un `../..` atterrit, et c'est le
    //     cas qu'une sonde bornée à l'application ne voit pas.
    writeFileSync(path.join(tmp, cible[1]), "évadé plus haut");
    assert.equal(
      chercherHorsDepot(app, cible).length,
      2,
      "le parent de l'application doit être inspecté",
    );
    console.log("✓ recherche d'évasion : dépôt épargné, racine et parent vus");
  } catch (e) {
    rouges += 1;
    console.error(`✗ recherche d'évasion : ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (PROVE) {
  if (rouges === 0) {
    console.error(
      "✗ la règle amputée n'a fait tomber AUCUN cas : le contrôle ne discrimine pas",
    );
    process.exit(1);
  }
  console.log(`✓ règle amputée → ${rouges} cas tombé(s), le contrôle mord`);
  process.exit(0);
}
process.exit(rouges === 0 ? 0 : 1);
