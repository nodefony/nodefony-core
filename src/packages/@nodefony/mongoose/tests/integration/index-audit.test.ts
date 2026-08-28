import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { Pdu, Severity } from "nodefony";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import type { IIndexAudit } from "../../nodefony/src/orm-core/index";

/**
 * Un index unique qui ne se construit PAS — le sait-on ?
 *
 * Mongoose construit les index en tâche de fond à la compilation des modèles,
 * et l'issue n'était écoutée par personne. Reproduit sur un serveur réel avant
 * correction : une collection portant déjà des doublons fait échouer la
 * construction de l'index unique, et le process continue — code de sortie 0,
 * aucun message, la collection n'ayant plus que son index `_id_`. La contrainte
 * d'unicité dont dépend l'authentification n'existait pas, et rien ne le disait.
 *
 * Le banc reproduit exactement cette situation : des doublons posés AVANT que
 * l'ORM se connecte, puis le constat. Il vérifie deux choses distinctes — que
 * l'écart est VU (`verifyIndexes`), et qu'il est DIT (journal `CRITIC`). La
 * seconde compte autant : un verdict que personne ne lit ne vaut pas mieux
 * qu'un silence.
 */
const ORM = "mongo_index_audit";
const URI = mongoTestUri(ORM);

const ENTITY = "IdxProbe";
const COLLECTION = "idxprobes";

/** Accès natif à la base pour préparer le terrain avant connexion. */
interface NativeDb {
  db?: {
    collection(name: string): {
      insertMany(docs: object[]): Promise<unknown>;
      drop(): Promise<unknown>;
    };
    dropCollection(name: string): Promise<unknown>;
  };
}

/**
 * Enregistre l'entité de sonde pour cet ORM — schéma minimal portant UNE
 * contrainte d'unicité, qui est tout ce que ce banc a besoin d'éprouver.
 */
function registerProbeEntity(): void {
  entityRegistry.register({
    connector: ORM,
    name: ENTITY,
    schema: {
      identifier: { type: String, required: true, unique: true },
    },
  } as Parameters<typeof entityRegistry.register>[0]);
}

/** Retire l'entité et l'ORM du registre process-wide (isolation entre bancs). */
function unregisterProbe(): void {
  entityRegistry.unregister(ENTITY, ORM);
  ormRegistry.unregister(ORM);
}

/** Collecte les messages journalisés à une sévérité donnée. */
function captureLog(orm: MongooseOrm, wanted: Severity): string[] {
  const captured: string[] = [];
  const original = orm.log.bind(orm);
  orm.log = ((pci: unknown, severity?: Severity, ...rest: unknown[]): Pdu => {
    if (severity === wanted) {
      captured.push(String(pci));
    }
    return original(
      pci as Parameters<typeof original>[0],
      severity,
      ...(rest as []),
    );
  }) as typeof orm.log;
  return captured;
}

/**
 * Vide la collection de sonde AVEC ses index — l'inverse exact de ce que font
 * les autres bancs. Ici on VEUT repartir d'une collection sans contrainte, pour
 * que la construction ait quelque chose à échouer.
 */
async function dropProbeCollection(orm: MongooseOrm): Promise<void> {
  const connection = orm.getNativeConnection<NativeDb>();
  await connection.db?.dropCollection(COLLECTION).catch(() => undefined);
}

/** Insère les documents dont la présence rendra l'index unique impossible. */
async function seedDuplicates(orm: MongooseOrm): Promise<void> {
  const connection = orm.getNativeConnection<NativeDb>();
  await connection.db
    ?.collection(COLLECTION)
    .insertMany([{ identifier: "dup" }, { identifier: "dup" }]);
}

describe.skipIf(!URI)("MongooseOrm — constat des index au démarrage", () => {
  afterEach(() => {
    // Chaque cas ouvre son propre ORM : le registre process-wide ne doit rien
    // garder d'un cas à l'autre, sinon le suivant hérite d'une entité fantôme.
    try {
      unregisterProbe();
    } catch {
      // déjà retirée par le cas lui-même
    }
  });

  it("un index unique impossible à construire est CONSTATÉ et journalisé en CRITIC", async () => {
    // 1) Terrain : une collection qui porte déjà des doublons, sans index.
    const setup = new MongooseOrm(`${ORM}_setup`, URI as string);
    await setup.connect();
    await dropProbeCollection(setup);
    await seedDuplicates(setup);
    await setup.disconnect();
    ormRegistry.unregister(`${ORM}_setup`);

    // 2) L'ORM se connecte et compile son modèle — mongoose tente l'index.
    registerProbeEntity();
    const orm = new MongooseOrm(ORM, URI as string);
    const critics = captureLog(orm, "CRITIC");
    await orm.connect();

    // 3) Le constat court en tâche de fond ; le banc, lui, l'attend.
    const audits = await (orm.pendingIndexAudit as Promise<IIndexAudit[]>);
    const audit = audits.find((entry) => entry.entity === ENTITY);
    assert.ok(audit, "un verdict par entité");
    assert.deepEqual(
      audit.missing,
      ["identifier_1"],
      "l'index unique déclaré est ABSENT de la base",
    );
    assert.equal(audit.collection, COLLECTION);

    // 4) Et surtout : quelqu'un l'a DIT.
    assert.ok(
      critics.some(
        (message) =>
          message.includes(COLLECTION) && message.includes("identifier_1"),
      ),
      `un CRITIC doit nommer la collection ET l'index — obtenu : ${JSON.stringify(critics)}`,
    );

    await orm.disconnect();
  });

  it("sans doublon, l'index se construit et le constat ne signale rien", async () => {
    const setup = new MongooseOrm(`${ORM}_setup`, URI as string);
    await setup.connect();
    await dropProbeCollection(setup);
    await setup.disconnect();
    ormRegistry.unregister(`${ORM}_setup`);

    registerProbeEntity();
    const orm = new MongooseOrm(ORM, URI as string);
    const critics = captureLog(orm, "CRITIC");
    await orm.connect();

    const audits = await (orm.pendingIndexAudit as Promise<IIndexAudit[]>);
    const audit = audits.find((entry) => entry.entity === ENTITY);
    assert.deepEqual(audit?.missing, [], "rien ne manque sur un terrain sain");
    assert.equal(audit?.error, undefined);
    assert.deepEqual(
      critics,
      [],
      "un banc sain ne doit produire AUCUN CRITIC — sinon l'alerte devient du bruit",
    );

    await orm.disconnect();
  });

  it("`autoIndex: false` ne tente aucune construction, mais dit ce qui manque", async () => {
    const setup = new MongooseOrm(`${ORM}_setup`, URI as string);
    await setup.connect();
    await dropProbeCollection(setup);
    await setup.disconnect();
    ormRegistry.unregister(`${ORM}_setup`);

    registerProbeEntity();
    const orm = new MongooseOrm(ORM, URI as string, { autoIndex: false });
    const critics = captureLog(orm, "CRITIC");
    await orm.connect();

    const audits = await (orm.pendingIndexAudit as Promise<IIndexAudit[]>);
    const audit = audits.find((entry) => entry.entity === ENTITY);
    assert.deepEqual(
      audit?.missing,
      ["identifier_1"],
      "aucune construction tentée : l'index déclaré reste absent",
    );
    assert.equal(
      audit?.error,
      undefined,
      "ne rien construire n'est pas une ERREUR — c'est le mode demandé",
    );
    assert.ok(
      critics.some((message) => message.includes("identifier_1")),
      "le manque reste dit : c'est précisément l'intérêt du mode",
    );

    await orm.disconnect();
  });
});
