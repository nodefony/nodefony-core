import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { count, inArray, lte, sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import type { DrizzleDb } from "../../nodefony/src/orm-core/index";

/**
 * **Ce que ce banc éprouve, et que les autres ne touchent pas : l'ÉCHELLE.**
 *
 * `complex-join.test.ts` prouve déjà que l'adaptateur porte le SQL avancé — CTE,
 * fonction fenêtre, sous-requêtes corrélées. Il le fait sur trois tables et dix
 * lignes, ce qui est exactement ce qu'il faut pour prouver une GRAMMAIRE, et
 * rigoureusement insuffisant pour prouver qu'elle tient à la taille d'un vrai
 * logiciel de gestion.
 *
 * Deux dimensions manquaient, et ce sont deux choses différentes :
 *
 *   · la LARGEUR du schéma — deux cents tables déclarées, pas trois ;
 *   · le VOLUME des données — des dizaines de milliers de lignes, pas dix.
 *
 * Elles étaient éprouvées, mais par un banc adossé au schéma d'un ERP tiers sous
 * GPLv3, que ce dépôt (CeCILL-B) exclut de son suivi de version : il ne pouvait
 * donc tourner que sur la machine qui possède la fixture. Rien de ce qui est
 * mesuré ici n'exigeait ce schéma. Un modèle de facturation générique — un tiers,
 * ses factures, leurs lignes, leurs règlements — porte la même requête et le même
 * volume, sans rien emprunter à personne.
 *
 * **Déterminisme** : le tirage passe par un générateur SEMÉ, jamais `Math.random`.
 * Un banc de volume dont les données changent à chaque exécution ne peut asserter
 * que des inégalités molles ; semé, il asserte des comptes EXACTS, et le même
 * défaut y produit toujours le même rouge.
 *
 * **Aucun seuil absolu dans la passe par défaut.** Les deux cas qui mesurent un
 * temps ou un tas vivent derrière `NF_RUN_PERF` : sur un exécuteur partagé, un
 * seuil absolu ne mesure pas le code, il mesure la contention du moment — et un
 * banc qui rougit une fois sur cinq sans que rien n'ait changé cesse d'être lu,
 * ce qui est la façon la plus sûre de laisser passer un vrai rouge.
 *
 * Réglages : `NF_BILL_PARTIES`, `NF_BILL_INVOICES`, `NF_BILL_LINES`,
 * `NF_WIDE_TABLES`. Mesures : `NF_RUN_PERF=1 npx vitest run`.
 */

/** Les cas à SEUIL ne tournent que sur demande — cf l'en-tête. */
const mesures = process.env.NF_RUN_PERF ? it : it.skip;

/**
 * Générateur congruentiel semé — reproductible d'une exécution à l'autre.
 *
 * `Math.random()` rendrait chaque passage unique : les comptes ne seraient plus
 * assertables, et un rouge ne serait pas rejouable.
 */
function tirage(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1103515245) + 12345) >>> 0;
    return (etat & 0x7fffffff) / 0x7fffffff;
  };
}

/** Entier de configuration, borné : un réglage absurde ne doit pas figer la passe. */
function reglage(cle: string, defaut: number, max: number): number {
  const v = Number(process.env[cle]);
  if (!Number.isFinite(v) || v <= 0) return defaut;
  return Math.min(Math.floor(v), max);
}

// ─── A. VOLUME — modèle de facturation générique ─────────────────────────────

const ORM_VOL = "db_echelle_volume";

const paysTable = sqliteTable("BillCountry", {
  id: integer("id").primaryKey(),
  label: text("label").notNull(),
});
const tiersTable = sqliteTable("BillParty", {
  id: integer("id").primaryKey(),
  nom: text("nom").notNull(),
  client: integer("client").notNull(),
  paysId: integer("paysId").notNull(),
});
const factureTable = sqliteTable("BillInvoice", {
  id: integer("id").primaryKey(),
  ref: text("ref").notNull(),
  tiersId: integer("tiersId").notNull(),
  emiseLe: text("emiseLe").notNull(),
  totalHt: real("totalHt").notNull(),
});
const ligneTable = sqliteTable("BillLine", {
  id: integer("id").primaryKey(),
  factureId: integer("factureId").notNull(),
  montantHt: real("montantHt").notNull(),
  quantite: integer("quantite").notNull(),
});
const reglementTable = sqliteTable("BillPayment", {
  id: integer("id").primaryKey(),
  factureId: integer("factureId").notNull(),
  montant: real("montant").notNull(),
});

@entity({ connector: ORM_VOL, name: "BillCountry", schema: paysTable })
class BillCountryEntity {}
@entity({ connector: ORM_VOL, name: "BillParty", schema: tiersTable })
class BillPartyEntity {}
@entity({ connector: ORM_VOL, name: "BillInvoice", schema: factureTable })
class BillInvoiceEntity {}
@entity({ connector: ORM_VOL, name: "BillLine", schema: ligneTable })
class BillLineEntity {}
@entity({ connector: ORM_VOL, name: "BillPayment", schema: reglementTable })
class BillPaymentEntity {}

void BillCountryEntity;
void BillPartyEntity;
void BillInvoiceEntity;
void BillLineEntity;
void BillPaymentEntity;

/** Ce que le semis a RÉELLEMENT écrit — la référence des assertions de comptage. */
interface Semis {
  tiers: number;
  factures: number;
  lignes: number;
  reglements: number;
  facturesMax: number;
  caTotal: number;
  regleTotal: number;
  ms: number;
}

/**
 * La requête que ce banc existe pour éprouver : deux expressions de table, une
 * jointure sur cinq tables, des agrégats, une sous-requête corrélée, un filtre
 * d'agrégat et une fonction fenêtre — le tout à l'échelle.
 */
function requeteRapport(limite: number, seuil = 100): string {
  return `
    WITH lignes_agg AS (
      SELECT l."factureId" AS fid, SUM(l."montantHt") AS ca
      FROM "BillLine" l GROUP BY l."factureId"
    ),
    reglements_agg AS (
      SELECT r."factureId" AS fid, SUM(r."montant") AS regle
      FROM "BillPayment" r GROUP BY r."factureId"
    )
    SELECT
      t.id                                                    AS tiers_id,
      t.nom                                                   AS tiers,
      p.label                                                 AS pays,
      COUNT(DISTINCT f.id)                                    AS nb_factures,
      COALESCE(SUM(la.ca), 0)                                 AS ca,
      COALESCE(SUM(ra.regle), 0)                              AS regle,
      COALESCE(SUM(la.ca), 0) - COALESCE(SUM(ra.regle), 0)    AS reste,
      (SELECT MAX(f2."emiseLe") FROM "BillInvoice" f2 WHERE f2."tiersId" = t.id) AS derniere,
      RANK() OVER (ORDER BY COALESCE(SUM(la.ca), 0) DESC)     AS rang
    FROM "BillParty" t
    JOIN "BillInvoice" f            ON f."tiersId" = t.id
    LEFT JOIN lignes_agg la         ON la.fid = f.id
    LEFT JOIN reglements_agg ra     ON ra.fid = f.id
    LEFT JOIN "BillCountry" p       ON p.id = t."paysId"
    WHERE t.client >= 1
    GROUP BY t.id, t.nom, p.label
    HAVING COALESCE(SUM(la.ca), 0) > ${seuil}
    ORDER BY ca DESC, tiers_id ASC
    LIMIT ${limite}
  `;
}

interface LigneRapport {
  tiers_id: number;
  tiers: string;
  pays: string | null;
  nb_factures: number;
  ca: number;
  regle: number;
  reste: number;
  derniere: string;
  rang: number;
}

describe("Échelle — volume sur un modèle de facturation", () => {
  let orm: DrizzleOrm;
  let db: DrizzleDb;
  let semis: Semis;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM_VOL, { filename: ":memory:" });
    await orm.connect();
    db = orm.getNativeConnection<DrizzleDb>();

    const nbTiers = reglage("NF_BILL_PARTIES", 2000, 200_000);
    const maxFactures = reglage("NF_BILL_INVOICES", 6, 100);
    const maxLignes = reglage("NF_BILL_LINES", 3, 50);
    const rnd = tirage(20260825);

    const pays = ["France", "Belgique", "Suisse", "Canada"];
    const t0 = performance.now();

    // Une seule transaction : sans elle, better-sqlite3 valide à chaque insert et
    // le semis prend des minutes là où il prend des millisecondes.
    db.run(sql`BEGIN`);
    for (let i = 0; i < pays.length; i++) {
      db.insert(paysTable)
        .values({ id: i + 1, label: pays[i] })
        .run();
    }

    let idFacture = 0;
    let idLigne = 0;
    let idReglement = 0;
    let caTotal = 0;
    let regleTotal = 0;
    let facturesMax = 0;

    for (let t = 1; t <= nbTiers; t++) {
      db.insert(tiersTable)
        .values({
          id: t,
          nom: `Tiers ${t}`,
          // Un dixième de non-clients : le `WHERE t.client >= 1` du rapport doit
          // les exclure, et sans eux ce filtre ne serait jamais mis à l'épreuve.
          client: rnd() < 0.9 ? 1 : 0,
          paysId: 1 + Math.floor(rnd() * pays.length),
        })
        .run();

      const nbFactures = 1 + Math.floor(rnd() * maxFactures);
      if (nbFactures > facturesMax) facturesMax = nbFactures;

      for (let f = 0; f < nbFactures; f++) {
        idFacture++;
        const mois = 1 + Math.floor(rnd() * 12);
        const jour = 1 + Math.floor(rnd() * 28);
        const nbLignes = 1 + Math.floor(rnd() * maxLignes);
        let ht = 0;
        for (let l = 0; l < nbLignes; l++) {
          idLigne++;
          const montant = Math.round((10 + rnd() * 990) * 100) / 100;
          ht += montant;
          db.insert(ligneTable)
            .values({
              id: idLigne,
              factureId: idFacture,
              montantHt: montant,
              quantite: 1 + Math.floor(rnd() * 5),
            })
            .run();
        }
        ht = Math.round(ht * 100) / 100;
        caTotal += ht;
        db.insert(factureTable)
          .values({
            id: idFacture,
            ref: `FA-${idFacture}`,
            tiersId: t,
            emiseLe: `2026-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`,
            totalHt: ht,
          })
          .run();

        const regle = rnd() < 0.7 ? ht : Math.round(ht * rnd() * 100) / 100;
        if (regle > 0) {
          idReglement++;
          regleTotal += regle;
          db.insert(reglementTable)
            .values({ id: idReglement, factureId: idFacture, montant: regle })
            .run();
        }
      }
    }
    db.run(sql`COMMIT`);

    semis = {
      tiers: nbTiers,
      factures: idFacture,
      lignes: idLigne,
      reglements: idReglement,
      facturesMax,
      caTotal: Math.round(caTotal * 100) / 100,
      regleTotal: Math.round(regleTotal * 100) / 100,
      ms: performance.now() - t0,
    };
    console.log(
      `[semis] ${(semis.tiers + semis.factures + semis.lignes + semis.reglements).toLocaleString()} lignes ` +
        `(${semis.tiers} tiers / ${semis.factures} factures / ${semis.lignes} lignes / ${semis.reglements} règlements) ` +
        `en ${semis.ms.toFixed(0)} ms`,
    );
  });

  afterAll(async () => {
    await orm.disconnect();
    for (const nom of [
      "BillCountry",
      "BillParty",
      "BillInvoice",
      "BillLine",
      "BillPayment",
    ]) {
      entityRegistry.unregister(nom);
    }
    ormRegistry.unregister(ORM_VOL);
  });

  it("tout ce qui a été semé est PERSISTÉ (comptes exacts, deux comptages indépendants)", () => {
    const compte = (table: string): number =>
      (
        db.all(sql.raw(`SELECT COUNT(*) AS n FROM "${table}"`))[0] as {
          n: number;
        }
      ).n;

    assert.equal(compte("BillParty"), semis.tiers);
    assert.equal(compte("BillInvoice"), semis.factures);
    assert.equal(compte("BillLine"), semis.lignes);
    assert.equal(compte("BillPayment"), semis.reglements);
    // Le semis est SEMÉ : ces volumes ne sont pas approximatifs, ils sont dus.
    assert.ok(
      semis.factures >= semis.tiers,
      "chaque tiers porte au moins une facture",
    );
    assert.ok(
      semis.lignes >= semis.factures,
      "chaque facture porte au moins une ligne",
    );
  });

  it("le rapport analytique tient à l'échelle (2 CTE, corrélée, RANK, HAVING)", () => {
    const lignes = db.all(sql.raw(requeteRapport(50))) as LigneRapport[];

    assert.ok(lignes.length > 0, "le rapport ne rend rien");
    assert.equal(lignes[0].rang, 1, "la première ligne doit porter le rang 1");

    const centimes = (n: number): number => Math.round(n * 100);
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      // Garde-fou de cohérence seulement : sur un tri décroissant tronqué, cette
      // ligne ne peut pas tomber. Le HAVING est éprouvé par le cas dédié.
      assert.ok(l.ca > 100, `HAVING franchi : tiers ${l.tiers_id} à ${l.ca}`);
      // Cohérence arithmétique de la colonne dérivée, au centime.
      assert.equal(
        centimes(l.reste),
        centimes(l.ca) - centimes(l.regle),
        `reste incohérent pour le tiers ${l.tiers_id}`,
      );
      assert.ok(l.nb_factures >= 1);
      assert.ok(
        /^2026-\d{2}-\d{2}$/.test(l.derniere),
        `date corrélée mal formée : ${l.derniere}`,
      );
      if (i > 0) {
        assert.ok(
          lignes[i - 1].ca >= l.ca,
          "le tri par chiffre d'affaires décroissant est cassé",
        );
      }
    }

    // Les non-clients sont EXCLUS — sans cette vérification, le `WHERE` du
    // rapport pourrait disparaître sans qu'aucun cas ne tombe.
    const nonClients = new Set(
      (
        db.all(
          sql.raw(`SELECT id FROM "BillParty" WHERE client = 0`),
        ) as Array<{ id: number }>
      ).map((r) => r.id),
    );
    assert.ok(nonClients.size > 0, "le semis n'a produit aucun non-client");
    for (const l of lignes) {
      assert.ok(
        !nonClients.has(l.tiers_id),
        `un non-client (${l.tiers_id}) est sorti du rapport`,
      );
    }
  });

  it("le filtre d'agrégat AGIT (deux seuils, deux populations)", () => {
    // `ca > 100` vérifié sur les 50 premières lignes d'un tri DÉCROISSANT est
    // toujours vrai : cette forme ne pouvait pas démentir la disparition du
    // HAVING. Ce qui le prouve, c'est qu'en RELEVANT le seuil la population
    // rétrécisse — et qu'au seuil zéro elle soit strictement plus grande.
    const sansSeuil = (
      db.all(sql.raw(requeteRapport(100_000, 0))) as LigneRapport[]
    ).length;
    const avecSeuil = (
      db.all(sql.raw(requeteRapport(100_000, 100))) as LigneRapport[]
    ).length;
    const seuilHaut = (
      db.all(sql.raw(requeteRapport(100_000, 5000))) as LigneRapport[]
    ).length;

    assert.ok(sansSeuil > 0, "le rapport sans seuil ne rend rien");
    assert.ok(
      avecSeuil <= sansSeuil,
      `seuil 100 (${avecSeuil}) devrait exclure par rapport au seuil 0 (${sansSeuil})`,
    );
    assert.ok(
      seuilHaut < sansSeuil,
      `seuil 5000 (${seuilHaut}) n'exclut personne — le HAVING ne mord pas`,
    );
    // Et ce qui SORT au seuil haut le franchit vraiment.
    for (const l of db.all(
      sql.raw(requeteRapport(20, 5000)),
    ) as LigneRapport[]) {
      assert.ok(
        l.ca > 5000,
        `tiers ${l.tiers_id} à ${l.ca} sous le seuil 5000`,
      );
    }
  });

  it("balayage complet agrégé — la somme des lignes est celle du semis", () => {
    const r = db.all(
      sql.raw(`SELECT COUNT(*) AS n, SUM("montantHt") AS s FROM "BillLine"`),
    )[0] as { n: number; s: number };
    assert.equal(r.n, semis.lignes);
    // Le total des lignes est celui des factures : deux chemins d'agrégation.
    const parFactures = (
      db.all(sql.raw(`SELECT SUM("totalHt") AS s FROM "BillInvoice"`))[0] as {
        s: number;
      }
    ).s;
    assert.equal(
      Math.round(r.s * 100),
      Math.round(semis.caTotal * 100),
      "la somme des lignes diverge du semis",
    );
    assert.ok(
      Math.abs(r.s - parFactures) < 1,
      `somme par lignes (${r.s}) et par factures (${parFactures}) divergent`,
    );
  });

  it("liaison massive — 1000 paramètres rendent le même ensemble qu'un intervalle", () => {
    const cible = Math.min(1000, semis.tiers);
    const ids = Array.from({ length: cible }, (_, i) => i + 1);

    // `inArray` du query builder : ce sont de VRAIS paramètres liés, mille d'un
    // coup. Les écrire en SQL brut ne lierait rien et n'éprouverait donc pas ce
    // que ce cas prétend éprouver.
    const parLiaison = db
      .select({ n: count() })
      .from(factureTable)
      .where(inArray(factureTable.tiersId, ids))
      .all()[0].n;
    // Le MÊME ensemble par un autre chemin d'exécution. Un `COUNT(*) >= 0` ne
    // pourrait pas démentir une liaison qui tronque ses paramètres — celui-ci si.
    const parIntervalle = db
      .select({ n: count() })
      .from(factureTable)
      .where(lte(factureTable.tiersId, cible))
      .all()[0].n;

    assert.equal(parLiaison, parIntervalle);
    assert.ok(
      parLiaison >= cible && parLiaison <= cible * semis.facturesMax,
      `${parLiaison} factures hors des bornes du semis [${cible}, ${cible * semis.facturesMax}]`,
    );
  });

  mesures("mesure — latence du rapport à l'échelle", () => {
    const t0 = performance.now();
    const lignes = db.all(sql.raw(requeteRapport(50))) as LigneRapport[];
    const ms = performance.now() - t0;
    console.log(
      `[rapport] ${lignes.length} lignes en ${ms.toFixed(1)} ms ` +
        `sur ${semis.factures.toLocaleString()} factures / ${semis.lignes.toLocaleString()} lignes`,
    );
    assert.ok(ms < 5000, `rapport trop lent : ${ms.toFixed(0)} ms`);
  });

  mesures("mesure — 50 rapports consécutifs, tas borné", () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const tas = (): number => {
      gc?.();
      return process.memoryUsage().heapUsed / (1024 * 1024);
    };
    db.all(sql.raw(requeteRapport(50))); // chauffe
    const avant = tas();
    for (let i = 0; i < 50; i++) db.all(sql.raw(requeteRapport(50)));
    const delta = tas() - avant;
    console.log(`[tas] 50 rapports · heapΔ ${delta.toFixed(1)} MB`);
    assert.ok(delta < 25, `tas suspect : ${delta.toFixed(1)} MB`);
  });
});

// ─── B. LARGEUR — un schéma de la taille d'un logiciel de gestion ────────────

const ORM_LARGE = "db_echelle_largeur";

/**
 * Le nombre de tables se GÉNÈRE plutôt que de s'emprunter.
 *
 * Ce que la largeur éprouve — l'adaptateur tient-il un schéma qui ne se lit pas
 * d'un écran — ne dépend en rien de ce que les tables représentent. Un schéma
 * tiers figé apporterait ici une contrainte de licence et un chiffre qu'on ne
 * peut plus régler ; généré, il se pousse d'une variable le jour où l'on veut
 * savoir où ça casse.
 */
const LARGEUR = reglage("NF_WIDE_TABLES", 200, 2000);

const tablesLarges = Array.from({ length: LARGEUR }, (_, i) =>
  sqliteTable(`Wide${i}`, {
    id: integer("id").primaryKey(),
    // Une clé vers la table précédente : sans elle, ce ne serait pas un SCHÉMA
    // large mais deux cents tables sans rapport, et aucune jointure ne pourrait
    // le traverser.
    parentId: integer("parentId").notNull(),
    label: text("label").notNull(),
    montant: real("montant").notNull(),
  }),
);

for (let i = 0; i < LARGEUR; i++) {
  entity({ connector: ORM_LARGE, name: `Wide${i}`, schema: tablesLarges[i] })(
    class {},
  );
}

describe("Échelle — largeur du schéma", () => {
  let orm: DrizzleOrm;
  let db: DrizzleDb;

  beforeAll(async () => {
    const t0 = performance.now();
    orm = new DrizzleOrm(ORM_LARGE, { filename: ":memory:" });
    await orm.connect();
    db = orm.getNativeConnection<DrizzleDb>();
    console.log(
      `[largeur] ${LARGEUR} tables déclarées et créées en ${(performance.now() - t0).toFixed(0)} ms`,
    );
  });

  afterAll(async () => {
    await orm.disconnect();
    for (let i = 0; i < LARGEUR; i++) entityRegistry.unregister(`Wide${i}`);
    ormRegistry.unregister(ORM_LARGE);
  });

  it("les N tables déclarées existent VRAIMENT dans la base", () => {
    const noms = new Set(
      (
        db.all(
          sql.raw(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'Wide%'`,
          ),
        ) as Array<{ name: string }>
      ).map((r) => r.name),
    );
    assert.equal(
      noms.size,
      LARGEUR,
      `${noms.size} tables créées pour ${LARGEUR} déclarées`,
    );
    // Les extrémités et le milieu, nommément : un compte juste ne dirait pas
    // qu'aucune n'a été renommée en route.
    for (const i of [0, Math.floor(LARGEUR / 2), LARGEUR - 1]) {
      assert.ok(noms.has(`Wide${i}`), `table Wide${i} absente`);
    }
  });

  it("chaque extrémité du schéma s'écrit et se relit", async () => {
    for (const i of [0, Math.floor(LARGEUR / 2), LARGEUR - 1]) {
      const depot = orm.getRepository<{
        id: number;
        parentId: number;
        label: string;
        montant: number;
      }>(`Wide${i}`);
      await depot.create({
        id: 1,
        parentId: 0,
        label: `ligne ${i}`,
        montant: i + 0.5,
      });
      const relu = await depot.findOne({ id: 1 });
      assert.equal(relu?.label, `ligne ${i}`, `Wide${i} relue incorrectement`);
      assert.equal(relu?.montant, i + 0.5);
    }
  });

  it("une jointure TRAVERSE le schéma large (5 tables chaînées)", () => {
    // Les cinq premières, chaînées par `parentId`. Semées ici, pas au cas
    // précédent : une jointure sur des tables vides rendrait zéro ligne et
    // passerait pour un succès.
    db.run(sql`BEGIN`);
    for (let i = 0; i < 5; i++) {
      db.insert(tablesLarges[i])
        .values({ id: 100, parentId: 99, label: `chaîne ${i}`, montant: i })
        .run();
    }
    db.run(sql`COMMIT`);

    const lignes = db.all(
      sql.raw(`
        SELECT t0.label AS l0, t4.label AS l4, (t0.montant + t4.montant) AS somme
        FROM "Wide0" t0
        JOIN "Wide1" t1 ON t1.id = t0.id
        JOIN "Wide2" t2 ON t2.id = t1.id
        JOIN "Wide3" t3 ON t3.id = t2.id
        JOIN "Wide4" t4 ON t4.id = t3.id
        WHERE t0.id = 100
      `),
    ) as Array<{ l0: string; l4: string; somme: number }>;

    assert.equal(lignes.length, 1, "la jointure à cinq tables ne rend rien");
    assert.equal(lignes[0].l0, "chaîne 0");
    assert.equal(lignes[0].l4, "chaîne 4");
    assert.equal(lignes[0].somme, 4); // 0 + 4
  });
});
