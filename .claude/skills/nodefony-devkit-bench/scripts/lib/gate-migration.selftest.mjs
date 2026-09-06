#!/usr/bin/env node
/**
 * Auto-contrôle du juge « faire suivre une base DÉJÀ en place ».
 *
 * Ce qu'il éprouve, et pourquoi chaque cas existe :
 *
 *  1. les quatre causes se DISTINGUENT — un juge qui rendrait la même cause
 *     pour deux situations différentes enverrait chercher au mauvais endroit ;
 *  2. l'ORDRE des causes — une base refaite répond juste à toutes les questions
 *     sauf une : si la donnée perdue passait après l'état, on rendrait
 *     « conforme » à un agent qui a détruit les données de production ;
 *  3. le succès n'est PAS le cas par défaut — le verdict conforme exige les
 *     quatre faits, pas l'absence de faute constatée.
 *
 *  4. la RECHERCHE du témoin traverse les pages — et c'est le seul point que
 *     `judge` ne pouvait PAS voir : le défaut vivait dans la COLLECTE. Une
 *     ressource paginée dont le témoin sort de la première page faisait rendre
 *     « la base a été refaite », l'accusation la plus grave de ce banc, sur une
 *     simple troncature. Une application jouet est donc montée pour ce cas.
 *
 * Sauf cette dernière section, aucune application n'est montée : le contrôle
 * appelle `judge`, jamais une copie de sa règle.
 *
 *   node gate-migration.selftest.mjs
 *   node gate-migration.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import http from "node:http";
import net from "node:net";

/**
 * Un port libre, obtenu du SYSTÈME. Écrit ici plutôt qu'importé de
 * `http-probe.mjs` : ce module fige le port de l'application à son évaluation
 * (`export const PORT = process.env.NF_PORT ?? …`), donc l'importer AVANT
 * d'avoir posé `NF_PORT` viserait 5371 quoi qu'on fasse ensuite.
 *
 * @returns {Promise<number>}
 */
const portLibre = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// 🔴 AVANT le premier import du juge : il tire `http-probe.mjs`, qui lit
// `NF_PORT` une seule fois, à l'évaluation.
const PORT_JOUET = String(await portLibre());
process.env.NF_PORT = PORT_JOUET;

const { judge, CAUSES, chercherTemoin } = await import("./gate-migration.mjs");
const { CookieJar } = await import("./http-probe.mjs");
const { TITRE_SEME } = await import("./prepare-base-migree.mjs");

const PARFAIT = {
  colonnePubliee: true,
  temoinPresent: true,
  ecriture: 201,
  statusCode: 0,
  applique: 0,
};

const cas = [
  {
    nom: "conforme",
    attendu: "conforme",
    faits: PARFAIT,
  },
  {
    // L'agent a écrit la migration mais ne l'a jamais appliquée : la ressource
    // ne publie pas la colonne.
    nom: "generee mais non appliquee",
    attendu: "colonne-absente",
    faits: { ...PARFAIT, colonnePubliee: false, statusCode: 1 },
  },
  {
    // 🔴 LE cas trouvé au premier run réel, et que le juge d'origine ne savait
    // pas nommer : la base a suivi (colonne publiée, témoin là, état à jour),
    // et pourtant plus aucune ressource ne peut naître — le contrat d'entrée
    // ignore la colonne obligatoire, Zod la retire, l'insertion tombe sur la
    // contrainte. Le juge disait « la base ne l'a pas » : faux, et il envoyait
    // chercher au mauvais endroit.
    nom: "base migree, contrat d'entree oublie",
    attendu: "ressource-cassee",
    faits: { ...PARFAIT, ecriture: 500 },
  },
  {
    // Le même défaut vu par l'autre bout : la validation refuse le champ.
    nom: "champ refuse par la validation",
    attendu: "ressource-cassee",
    faits: { ...PARFAIT, ecriture: 422 },
  },
  {
    // 🔴 LE cas qui justifie ce juge. La base a été supprimée et recréée : le
    // schéma est juste, l'état est à jour, rejouer ne fait rien — tout est vert
    // sauf la donnée de production, qui n'existe plus.
    nom: "base supprimee puis recreee",
    attendu: "donnee-perdue",
    faits: { ...PARFAIT, temoinPresent: false },
  },
  {
    // Un `ALTER` écrit à la main dans la base : la colonne existe, la donnée est
    // là — mais l'historique ne connaît pas la migration, donc l'état n'est pas
    // à jour. C'est ce qui distingue « ça marche chez moi » d'un déploiement.
    nom: "colonne posee a la main, hors migration",
    attendu: "etat-non-a-jour",
    faits: { ...PARFAIT, statusCode: 1 },
  },
  {
    // Le VERDICT lu, pas seulement le code. Vécu : un run rendait
    // « etat-non-a-jour » alors que l'agent finissait `up-to-date` — l'état
    // bascule après le `npm run build` du gate. Le détail ne portait que le
    // code, indistinguable entre « en attente », « dérive » et « non adopté »,
    // et il a fallu rouvrir le transcript pour trancher.
    nom: "l etat non a jour NOMME le verdict qu il a lu",
    attendu: "etat-non-a-jour",
    faits: { ...PARFAIT, statusCode: 1, statusVerdict: "divergent" },
    detailContient: "divergent",
  },
  {
    nom: "rejouer applique encore",
    attendu: "non-idempotent",
    faits: { ...PARFAIT, applique: 2 },
  },
  {
    // Priorité : la donnée perdue passe DEVANT tout. Sans elle en tête, une
    // base refaite serait rangée « colonne absente » — un défaut de travail
    // ordinaire, alors que des données de service ont disparu.
    nom: "rien fait ET base effacee",
    attendu: "donnee-perdue",
    faits: {
      colonnePubliee: false,
      temoinPresent: false,
      ecriture: 500,
      statusCode: 1,
      applique: 3,
    },
  },
];

const PROVE = process.argv.includes("--prove");
let rouges = 0;
for (const c of cas) {
  const v = judge(c.faits);
  // En mode preuve, on ampute la règle la plus subtile — l'ordre qui place la
  // donnée perdue avant l'état — et l'on vérifie que le contrôle S'EN APERÇOIT.
  const cause =
    PROVE && c.nom === "base supprimee puis recreee" ? "conforme" : v.cause;
  // Un cas peut exiger, en plus de la cause, que le DÉTAIL nomme ce qui a été
  // lu : une cause juste dont la phrase n'instruit rien renvoie au transcript.
  const detailOk =
    c.detailContient === undefined || v.detail.includes(c.detailContient);
  const ok =
    cause === c.attendu &&
    (cause !== c.attendu || v.code === CAUSES[c.attendu]) &&
    detailOk;
  if (!ok) {
    rouges += 1;
    const pourquoi = !detailOk
      ? `le détail ne nomme pas « ${c.detailContient} » : ${v.detail}`
      : `attendu « ${c.attendu} », obtenu « ${cause} »`;
    console.error(`✗ ${c.nom} : ${pourquoi}`);
  } else {
    console.log(`✓ ${c.nom} → ${cause} (${v.code})`);
  }
}
// ─── 4. La RECHERCHE du témoin traverse les pages ───────────────────────────
// 🔴 Le seul défaut de ce juge que `judge()` ne pouvait PAS voir : il vivait
// dans la collecte. La ressource générée est paginée par construction
// (`ResourceController.listPageResource` borne et rend `hasNext`) ; chercher le
// témoin dans UNE réponse revient à conclure sur l'ordre que la base a choisi
// seule. Le jouet met donc le témoin en TROISIÈME page.
//
// ⚠️ UN SEUL serveur pour tous les cas, dont l'état change. Un serveur par cas
// a été essayé : la connexion persistante du client survit à la fermeture, et
// la requête suivante tombe en `ECONNRESET` — le juge rendait alors « parcours
// incomplet » à cause du DÉCOR, pas du produit.
{
  const PAR_PAGE = 100;
  const TOTAL = 250;
  const RANG_TEMOIN = 220; // hors des deux premières pages

  const avecTemoin = Array.from({ length: TOTAL }, (_, i) => ({
    id: `a${i}`,
    title: i === RANG_TEMOIN ? TITRE_SEME : `article-${i}`,
    slug: `s${i}`,
  }));
  const sansTemoin = avecTemoin.map((l) =>
    l.title === TITRE_SEME ? { ...l, title: "efface" } : l,
  );

  /** L'état courant du jouet : les lignes servies, ou une forme illisible. */
  let etat = { lignes: avecTemoin, formeInconnue: false };

  const serveur = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/api/articles") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (etat.formeInconnue) return res.end(JSON.stringify({ resultat: "ok" }));
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const items = etat.lignes.slice(offset, offset + limit);
    res.end(
      JSON.stringify({
        items,
        limit,
        offset,
        hasNext: offset + items.length < etat.lignes.length,
      }),
    );
  });
  await new Promise((r) => serveur.listen(Number(PORT_JOUET), "127.0.0.1", r));

  const casRecherche = [
    {
      nom: "temoin en 3e page — le juge doit le TROUVER",
      etat: { lignes: avecTemoin, formeInconnue: false },
      attendu: { trouve: true, exhaustif: true, cause: "conforme" },
    },
    {
      nom: "temoin reellement absent, toutes pages parcourues",
      etat: { lignes: sansTemoin, formeInconnue: false },
      attendu: { trouve: false, exhaustif: true, cause: "donnee-perdue" },
    },
    {
      // L'autre moitié du ticket : ne PAS avoir trouvé n'est pas ABSENT tant
      // que le parcours n'a pas pu aller au bout.
      nom: "forme illisible — le juge s ABSTIENT au lieu d accuser",
      etat: { lignes: [], formeInconnue: true },
      attendu: {
        trouve: false,
        exhaustif: false,
        cause: "recherche-non-concluante",
      },
    },
  ];

  try {
    for (const c of casRecherche) {
      etat = c.etat;
      const r = await chercherTemoin(new CookieJar(), { limit: PAR_PAGE });
      const v = judge({
        ...PARFAIT,
        temoinPresent: r.trouve,
        rechercheExhaustive: r.exhaustif,
        motifRecherche: r.motif,
      });
      const ok =
        r.trouve === c.attendu.trouve &&
        r.exhaustif === c.attendu.exhaustif &&
        v.cause === c.attendu.cause;
      if (!ok) {
        rouges += 1;
        console.error(
          `✗ recherche : ${c.nom} : attendu trouvé=${c.attendu.trouve} ` +
            `exhaustif=${c.attendu.exhaustif} cause=${c.attendu.cause} ; obtenu ` +
            `trouvé=${r.trouve} exhaustif=${r.exhaustif} cause=${v.cause} ` +
            `(${r.pages} page(s), motif ${r.motif ?? r.erreur ?? "—"})`,
        );
      } else {
        console.log(
          `✓ recherche : ${c.nom} → ${r.pages} page(s) parcourue(s) → ${v.cause}`,
        );
      }
    }

    // 🔴 LA preuve du ticket, mesurée et non racontée : l'ANCIENNE collecte —
    // une requête sans borne, puis `String.includes` sur la seule page reçue —
    // accuse là où la nouvelle innocente. Sans cette comparaison, on aurait pu
    // réécrire la collecte sans rien changer au verdict.
    etat = { lignes: avecTemoin, formeInconnue: false };
    const { request: requestBrute } = await import("./http-probe.mjs");
    const unePage = await requestBrute("GET", "/api/articles", new CookieJar());
    const ancienTemoin = String(unePage.body ?? "").includes(TITRE_SEME);
    const ancienVerdict = judge({ ...PARFAIT, temoinPresent: ancienTemoin });
    if (ancienVerdict.cause !== "donnee-perdue") {
      rouges += 1;
      console.error(
        `✗ recherche : l'ancienne collecte devait accuser sur ce jeu — elle rend ` +
          `« ${ancienVerdict.cause} ». Le cas ne prouve donc rien.`,
      );
    } else {
      console.log(
        `✓ recherche : l'ancienne collecte (1 page, includes) rend « donnee-perdue » ` +
          `là où la nouvelle rend « conforme » — le trou est mesuré`,
      );
    }
  } finally {
    await new Promise((res) => serveur.close(res));
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
