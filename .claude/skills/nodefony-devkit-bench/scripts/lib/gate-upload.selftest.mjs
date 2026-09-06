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
 *     loin rendrait « conforme » sur une évasion réussie ;
 *  4. la COLLECTE face à une route protégée contre le rejeu — le seul niveau où
 *     le défaut le plus grave de ce juge était visible. Éprouver `judge()` sur
 *     des faits déjà collectés ne pouvait PAS le voir : le juge partait sans
 *     jeton, toute route `@CsrfProtect` lui rendait 403, et il concluait « le
 *     dépôt ne fonctionne pas » — mettant en défaut l'agent qui a suivi
 *     l'`AGENTS.md` du produit, pendant qu'il validait la route non protégée.
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
  lireFaitDeLaReponse,
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

// ─── 4. La COLLECTE face à une route protégée contre le rejeu ───────────────
// Deux applications jouets, et c'est le premier cas qui aurait attrapé le
// défaut : avant le semis du jeton, le juge y rendait « depot-refuse » (2).
{
  const http = await import("node:http");
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const ICI = path.dirname(fileURLToPath(import.meta.url));
  const JUGE = path.join(ICI, "gate-upload.mjs");
  // Obtenu du SYSTÈME : un port en dur est un état partagé, et ce fichier
  // tombait en `EADDRINUSE` dès qu'un autre lot tournait en même temps.
  const { portLibre } = await import("./http-probe.mjs");
  const PORT_JOUET = String(await portLibre());
  const LOGIN = "/nodefony/security/api/auth/login";
  const MOI = "/nodefony/security/api/auth/me";
  const DEPOT = "/api/depot";

  const corpsDe = (req) =>
    new Promise((r) => {
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => {
        try {
          r(JSON.parse(d || "{}"));
        } catch {
          r({});
        }
      });
    });
  const repondre = (res, status, objet) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(objet === null ? "" : JSON.stringify(objet));
  };

  /**
   * Application jouet : le dépôt exige le jeton anti-rejeu ; `seme` dit si la
   * requête SÛRE le dépose, comme le framework le fait sur `@CsrfProtect`.
   *
   * @param {{seme: boolean, racine: string}} opts
   */
  const app =
    ({ seme, racine }) =>
    async (req, res) => {
      const url = (req.url ?? "").split("?")[0];
      if (url === LOGIN && req.method === "POST") {
        const { username } = await corpsDe(req);
        res.setHeader(
          "set-cookie",
          `nodefony=sess-${username}; Path=/; HttpOnly`,
        );
        return repondre(res, 200, { user: { username, roles: [] } });
      }
      if (url === MOI) {
        const cookie = req.headers.cookie ?? "";
        return cookie.includes("nodefony=sess-")
          ? repondre(res, 200, { user: { username: "admin" } })
          : repondre(res, 401, { error: "no session" });
      }
      if (url === DEPOT && req.method === "GET") {
        if (seme)
          res.setHeader("set-cookie", `csrf-token=jeton-de-test; Path=/`);
        return repondre(res, 200, { data: [] });
      }
      if (url === DEPOT && req.method === "POST") {
        if (req.headers["x-csrf-token"] !== "jeton-de-test") {
          return repondre(res, 403, { error: "csrf" });
        }
        await corpsDe(req);
        // Ranger POUR DE VRAI : le juge lit le disque, pas la réponse seule.
        const depot = path.join(racine, DOSSIER_DEPOT);
        mkdirSync(depot, { recursive: true });
        writeFileSync(path.join(depot, "range-par-le-jouet.txt"), "ok");
        return repondre(res, 201, {
          nom: "range-par-le-jouet.txt",
          size: 2,
        });
      }
      return repondre(res, 404, { error: "not found" });
    };

  const lancerJuge = (racine) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [JUGE], {
        cwd: racine,
        env: { ...process.env, NF_PORT: PORT_JOUET },
        encoding: "utf8",
      });
      let out = "";
      p.stdout.on("data", (c) => (out += c));
      p.stderr.on("data", (c) => (out += c));
      p.on("close", (status) => resolve({ status, out }));
    });

  const CAS_COLLECTE = [
    // 🔴 Le cas qui aurait attrapé le défaut. La route est protégée comme le
    // produit le PRESCRIT : le juge doit s'en munir, pas la recaler.
    { nom: "route protegee, jeton seme", seme: true, attendu: 0 },
    // Le jeton n'arrive jamais : le juge ne peut RIEN dire du dépôt, et doit
    // s'abstenir en nommant son propre manque — jamais accuser l'agent.
    {
      nom: "protegee sans semis",
      seme: false,
      attendu: CAUSES["jeton-csrf-absent"],
    },
  ];

  for (const c of CAS_COLLECTE) {
    const racine = mkdtempSync(path.join(os.tmpdir(), "gate-upload-collecte-"));
    const srv = http.createServer(app({ seme: c.seme, racine }));
    await new Promise((r) => srv.listen(Number(PORT_JOUET), "127.0.0.1", r));
    const { status, out } = await lancerJuge(racine);
    await new Promise((r) => srv.close(r));
    rmSync(racine, { recursive: true, force: true });
    const ligne =
      out
        .trim()
        .split("\n")
        .find((l) => l.includes("CAUSE=")) ?? "";
    if (status === c.attendu) {
      console.log(`✓ collecte : ${c.nom} → ${status}`);
    } else {
      rouges += 1;
      console.error(
        `✗ collecte : ${c.nom} : attendu ${c.attendu}, obtenu ${status} — ${ligne.slice(0, 110)}`,
      );
    }
  }
}

// ─── La RÉPONSE se lit comme un FAIT, jamais comme un vocabulaire ───────────
// L'ancienne sonde testait `/rapport-bench|stored|size|taille|nom/iu` sur le
// texte brut : sans frontière de mot et sans casse, tout JSON contenant
// « anonymous », « nombre » ou « size » passait. Ces cas fixent la différence —
// et le premier est celui que l'énoncé du ticket demande de voir rougir.
{
  /** L'ancienne règle, gardée ICI pour que la comparaison soit mesurée et non racontée. */
  const ANCIENNE = (corps) =>
    /rapport-bench|stored|size|taille|nom/iu.test(corps);
  const RANGE = { nomsRanges: ["a1b2c3.txt"], tailles: [29, 2] };

  // ⚠️ `ancienneDisait` est ASSERTÉ, jamais décoratif. Écrit à la main d'après
  // l'énoncé, il portait deux valeurs FAUSSES — dont « anonymous », que le
  // ticket donne comme faux vert alors que la chaîne ne contient pas « nom »
  // (a-n-o-n-y-m…). Une annotation qu'aucun contrôle ne relit est exactement
  // l'instrument qui affirme plus qu'il ne mesure.
  const casReponse = [
    {
      nom: "« nommé » — le mot NOM à l'intérieur d'un autre, aucun fait",
      corps: JSON.stringify({ message: "fichier bien nommé", ok: true }),
      attendu: false,
      ancienneDisait: true, // le faux vert réel de l'ancienne règle
    },
    {
      nom: "« nombre » et « size » sans le nom rangé",
      corps: JSON.stringify({ nombre: 3, size: 4096 }),
      attendu: false,
      ancienneDisait: true,
    },
    {
      nom: "le fait complet — nom rangé ET taille",
      corps: JSON.stringify({ stored: { file: "a1b2c3.txt", bytes: 29 } }),
      attendu: true,
      ancienneDisait: true,
    },
    {
      nom: "le fait complet sous des clés qu'aucun mot-clé ne devine",
      corps: JSON.stringify({ d: [{ x: "var/depots/a1b2c3.txt", y: "2" }] }),
      attendu: true,
      ancienneDisait: false, // l'ancienne était AUSSI borgne dans l'autre sens
    },
    {
      nom: "le nom rangé sans la taille",
      corps: JSON.stringify({ file: "a1b2c3.txt" }),
      attendu: false,
      ancienneDisait: false,
    },
    {
      nom: "un corps qui n'est pas du JSON",
      corps: "fichier a1b2c3.txt (29 octets) rangé",
      attendu: false,
      ancienneDisait: false,
    },
  ];

  let vuMordre = 0;
  for (const c of casReponse) {
    const lu = lireFaitDeLaReponse(c.corps, RANGE);
    const obtenu = lu.nomTrouve && lu.tailleTrouvee;
    const ancienne = ANCIENNE(c.corps);
    if (obtenu !== c.attendu) {
      rouges += 1;
      console.error(
        `✗ réponse-fait : ${c.nom} : attendu ${c.attendu}, obtenu ${obtenu}`,
      );
      continue;
    }
    if (ancienne !== c.ancienneDisait) {
      rouges += 1;
      console.error(
        `✗ réponse-fait : ${c.nom} : l'ancienne règle est annoncée ${c.ancienneDisait} ` +
          `et rend ${ancienne} — l'annotation ment sur ce qu'on prétend avoir corrigé`,
      );
      continue;
    }
    // La divergence avec l'ancienne règle est la PREUVE que la sonde a changé
    // de nature. Sans elle, on aurait pu réécrire le même verdict autrement.
    if (ancienne !== obtenu) vuMordre += 1;
    console.log(`✓ réponse-fait : ${c.nom} → fait ${obtenu} · mot ${ancienne}`);
  }
  if (vuMordre === 0) {
    rouges += 1;
    console.error(
      "✗ réponse-fait : AUCUN cas ne distingue la nouvelle règle de l'ancienne — " +
        "le juge mesure peut-être encore un vocabulaire",
    );
  } else {
    console.log(
      `✓ réponse-fait : ${vuMordre} cas où le mot et le fait divergent`,
    );
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
