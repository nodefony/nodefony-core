import assert from "node:assert/strict";
import { vi } from "vitest";
import mongoose from "mongoose";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entity, ReferencedEntityError } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

/**
 * Suppression d'un parent encore référencé (#467) — la politique du SQL généré,
 * tenue par l'ORM là où MongoDB n'a pas de clé étrangère :
 * référence obligatoire → REFUS ; facultative → remise à `null`.
 *
 * Les schémas ont la forme exacte que `create entity … author:ref:Author` écrit
 * (`{ type: ObjectId, ref, required, index }`).
 */
const ORM = "mongo_refs";
const URI = mongoTestUri(ORM);

interface Author {
  id: string;
  name: string;
}
interface Post {
  id: string;
  title: string;
  author: unknown;
}
interface Note {
  id: string;
  text: string;
  author: unknown;
}

const { ObjectId } = mongoose.Schema.Types;

@entity({
  connector: ORM,
  name: "RefAuthor",
  schema: { name: { type: String, required: true } },
})
class RefAuthorEntity {}

@entity({
  connector: ORM,
  name: "RefPost",
  schema: {
    title: { type: String, required: true },
    author: { type: ObjectId, ref: "RefAuthor", required: true, index: true },
  },
})
class RefPostEntity {}

@entity({
  connector: ORM,
  name: "RefNote",
  schema: {
    text: { type: String, required: true },
    author: { type: ObjectId, ref: "RefAuthor", default: null, index: true },
  },
})
class RefNoteEntity {}

// Auto-référence OBLIGATOIRE : le cas où un enfant part dans le même lot que
// son parent.
@entity({
  connector: ORM,
  name: "RefStep",
  schema: {
    label: { type: String, required: true },
    parent: { type: ObjectId, ref: "RefStep", required: true, index: true },
  },
})
class RefStepEntity {}

// Référence écrite à la main SANS index — l'ORM doit le dire au connect().
@entity({
  connector: ORM,
  name: "RefDraft",
  schema: { author: { type: ObjectId, ref: "RefAuthor" } },
})
class RefDraftEntity {}

void RefAuthorEntity;
void RefPostEntity;
void RefNoteEntity;
void RefStepEntity;
void RefDraftEntity;

interface Step {
  id: string;
  label: string;
  parent: unknown;
}

describe.skipIf(!URI)("suppression d'un parent référencé (MongoDB)", () => {
  let orm: MongooseOrm;
  let authors: IRepository<Author>;
  let posts: IRepository<Post>;
  let notes: IRepository<Note>;
  let steps: IRepository<Step>;
  let warnings: string[];

  beforeAll(async () => {
    orm = new MongooseOrm(ORM, URI!);
    const log = vi.spyOn(orm, "log");
    await orm.connect();
    warnings = log.mock.calls
      .filter(([, severity]) => severity === "WARNING")
      .map(([message]) => String(message));
    log.mockRestore();
    steps = orm.getRepository<Step>("RefStep");
    authors = orm.getRepository<Author>("RefAuthor");
    posts = orm.getRepository<Post>("RefPost");
    notes = orm.getRepository<Note>("RefNote");
  });

  beforeEach(async () => {
    // Enfants d'abord : la garde refuserait l'inverse.
    await posts.delete({});
    await notes.delete({});
    await steps.delete({});
    await orm.getRepository("RefDraft").delete({});
    await authors.delete({});
  });

  afterAll(async () => {
    await orm?.disconnect();
  });

  it("référence OBLIGATOIRE : delete refuse, en nommant l'entité qui référence", async () => {
    const a = await authors.create({ name: "Ada" });
    await posts.create({ title: "p", author: a.id });
    await assert.rejects(
      () => authors.delete({ id: a.id }),
      (e: unknown) =>
        e instanceof ReferencedEntityError &&
        e.entity === "RefAuthor" &&
        e.referencedBy === "RefPost" &&
        e.field === "author",
    );
    assert.equal(await authors.count({ id: a.id }), 1, "le parent est resté");
  });

  it("deleteOne et findOneAndDelete tiennent la même garde", async () => {
    const a = await authors.create({ name: "Ada" });
    await posts.create({ title: "p", author: a.id });
    await assert.rejects(
      () => authors.deleteOne({ id: a.id }),
      ReferencedEntityError,
    );
    await assert.rejects(
      () => authors.findOneAndDelete({ id: a.id }),
      ReferencedEntityError,
    );
    assert.equal(await authors.count({ id: a.id }), 1);
  });

  it("delete en masse : un seul parent référencé bloque tout le lot", async () => {
    const a = await authors.create({ name: "Ada" });
    await authors.create({ name: "Bob" });
    await posts.create({ title: "p", author: a.id });
    await assert.rejects(() => authors.delete({}), ReferencedEntityError);
    assert.equal(await authors.count(), 2, "rien n'est parti");
  });

  it("référence FACULTATIVE : le parent part, l'enfant survit avec `null`", async () => {
    const a = await authors.create({ name: "Ada" });
    const n = await notes.create({ text: "n", author: a.id });
    assert.equal(await authors.delete({ id: a.id }), 1);
    const after = await notes.findOne({ id: n.id });
    assert.ok(after, "l'enfant survit");
    assert.equal(after.author, null);
  });

  it("une fois les enfants obligatoires partis, le parent se supprime", async () => {
    const a = await authors.create({ name: "Ada" });
    await posts.create({ title: "p", author: a.id });
    await posts.delete({ author: a.id });
    assert.equal(await authors.deleteOne({ id: a.id }), true);
  });

  it("un parent que rien ne désigne se supprime sans détour", async () => {
    const a = await authors.create({ name: "Ada" });
    const removed = await authors.findOneAndDelete({ id: a.id });
    assert.equal(removed?.name, "Ada");
  });

  it("aucun document visé : 0 / false / null, sans lever", async () => {
    const ghost = new mongoose.Types.ObjectId().toHexString();
    assert.equal(await authors.delete({ id: ghost }), 0);
    assert.equal(await authors.deleteOne({ id: ghost }), false);
    assert.equal(await authors.findOneAndDelete({ id: ghost }), null);
  });

  it("auto-référence : un enfant du MÊME lot ne retient pas son parent", async () => {
    // Insertion non gardée : la racine désigne un identifiant inventé.
    const root = await steps.create({
      label: "racine",
      parent: new mongoose.Types.ObjectId().toHexString(),
    });
    await steps.create({ label: "enfant", parent: root.id });
    // Seule, la racine reste retenue par son enfant…
    await assert.rejects(
      () => steps.delete({ id: root.id }),
      ReferencedEntityError,
    );
    // … mais l'arbre entier part d'un seul appel.
    assert.equal(await steps.delete({}), 2);
  });

  it("une référence SANS index est signalée au connect(), en nommant le champ", () => {
    const hits = warnings.filter((w) => w.includes("sans index"));
    assert.equal(hits.length, 1, hits.join("\n"));
    assert.ok(hits[0].includes("RefDraft.author"));
  });

  it("dans une transaction : la garde refuse, et le rollback garde le parent", async () => {
    const a = await authors.create({ name: "Ada" });
    await posts.create({ title: "p", author: a.id });
    await assert.rejects(
      () =>
        orm.transaction(async (tx) => {
          await authors.withTransaction(tx).delete({ id: a.id });
        }),
      ReferencedEntityError,
    );
    assert.equal(await authors.count({ id: a.id }), 1);
  });
});
