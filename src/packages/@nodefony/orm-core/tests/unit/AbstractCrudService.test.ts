import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AbstractCrudService } from "../../index";
import type { Criteria, IRepository, RepositoryReadOptions } from "../../index";

interface Widget {
  id: string;
  name: string;
  qty: number;
}

/** Repository Widget en mémoire — couvre la surface IRepository. */
class MemoryRepo implements IRepository<Widget> {
  readonly store = new Map<string, Widget>();

  private match(w: Widget, criteria?: Criteria<Widget>) {
    if (!criteria) return true;
    return Object.entries(criteria).every(
      ([k, v]) => (w as unknown as Record<string, unknown>)[k] === v,
    );
  }

  find(criteria?: Criteria<Widget>, _o?: RepositoryReadOptions) {
    return Promise.resolve(
      [...this.store.values()].filter((w) => this.match(w, criteria)),
    );
  }

  findOne(criteria: Criteria<Widget>, _o?: RepositoryReadOptions) {
    return Promise.resolve(
      [...this.store.values()].find((w) => this.match(w, criteria)) ?? null,
    );
  }

  create(data: Partial<Widget>) {
    const w: Widget = {
      id: randomUUID(),
      name: data.name ?? "",
      qty: data.qty ?? 0,
    };
    this.store.set(w.id, w);
    return Promise.resolve(w);
  }

  update(criteria: Criteria<Widget>, data: Partial<Widget>) {
    const w = [...this.store.values()].find((x) => this.match(x, criteria));
    if (!w) return Promise.resolve(null);
    Object.assign(w, data);
    return Promise.resolve(w);
  }

  delete(criteria: Criteria<Widget>) {
    let n = 0;
    for (const [id, w] of this.store) {
      if (this.match(w, criteria)) {
        this.store.delete(id);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  count(criteria?: Criteria<Widget>) {
    return this.find(criteria).then((r) => r.length);
  }

  withTransaction() {
    return this;
  }
}

/** Service concret minimal (aucun hook surchargé). */
class WidgetService extends AbstractCrudService<Widget> {
  constructor(repo: IRepository<Widget>) {
    super("widgets", repo);
  }
}

/** Service avec hooks surchargés — vérifie le template-method. */
class HookedWidgetService extends AbstractCrudService<Widget> {
  readonly calls: string[] = [];
  constructor(repo: IRepository<Widget>) {
    super("widgets-hooked", repo);
  }
  protected override beforeCreate(data: Partial<Widget>) {
    this.calls.push("beforeCreate");
    return { ...data, name: (data.name ?? "").toUpperCase() };
  }
  protected override afterCreate() {
    this.calls.push("afterCreate");
  }
  protected override beforeDelete() {
    this.calls.push("beforeDelete");
  }
  protected override afterDelete(_c: Criteria<Widget>, removed: number) {
    this.calls.push(`afterDelete:${removed}`);
  }
}

describe("AbstractCrudService (générique CRUD)", () => {
  describe("create", () => {
    it("persiste et émet onCreated avec l'entité", async () => {
      const svc = new WidgetService(new MemoryRepo());
      let fired: Widget | null = null;
      svc.on("onCreated", (w) => {
        fired = w as Widget;
      });
      const w = await svc.create({ name: "bolt", qty: 5 });
      assert.equal(w.name, "bolt");
      assert.ok(w.id.length > 0);
      assert.equal(fired, w);
    });
  });

  describe("lectures (délégation pure, aucun event)", () => {
    it("find / findOne / findById / count", async () => {
      const repo = new MemoryRepo();
      const svc = new WidgetService(repo);
      const a = await svc.create({ name: "a", qty: 1 });
      await svc.create({ name: "b", qty: 2 });

      assert.equal((await svc.find()).length, 2);
      assert.equal((await svc.findOne({ name: "a" }))?.id, a.id);
      assert.equal((await svc.findById(a.id))?.name, "a");
      assert.equal(await svc.findById("ghost"), null);
      assert.equal(await svc.count(), 2);
      assert.equal(await svc.count({ name: "a" }), 1);
    });

    it("aucun event n'est émis sur une lecture", async () => {
      const svc = new WidgetService(new MemoryRepo());
      await svc.create({ name: "a", qty: 1 });
      let fired = false;
      svc.on("onCreated", () => (fired = true));
      svc.on("onUpdated", () => (fired = true));
      svc.on("onDeleted", () => (fired = true));
      await svc.find();
      await svc.findOne({ name: "a" });
      await svc.count();
      assert.equal(fired, false);
    });
  });

  describe("update", () => {
    it("met à jour et émet onUpdated", async () => {
      const svc = new WidgetService(new MemoryRepo());
      const w = await svc.create({ name: "a", qty: 1 });
      let fired = false;
      svc.on("onUpdated", () => (fired = true));
      const updated = await svc.update({ id: w.id }, { qty: 9 });
      assert.equal(updated?.qty, 9);
      assert.equal(fired, true);
    });

    it("retourne null et n'émet rien si rien ne correspond", async () => {
      const svc = new WidgetService(new MemoryRepo());
      let fired = false;
      svc.on("onUpdated", () => (fired = true));
      assert.equal(await svc.update({ id: "ghost" }, { qty: 9 }), null);
      assert.equal(fired, false);
    });
  });

  describe("delete", () => {
    it("supprime et émet onDeleted (criteria, count)", async () => {
      const svc = new WidgetService(new MemoryRepo());
      const w = await svc.create({ name: "a", qty: 1 });
      let count = -1;
      svc.on("onDeleted", (_criteria, n) => {
        count = n as number;
      });
      assert.equal(await svc.delete({ id: w.id }), 1);
      assert.equal(count, 1);
    });

    it("retourne 0 et n'émet rien si rien ne correspond", async () => {
      const svc = new WidgetService(new MemoryRepo());
      let fired = false;
      svc.on("onDeleted", () => (fired = true));
      assert.equal(await svc.delete({ id: "ghost" }), 0);
      assert.equal(fired, false);
    });
  });

  describe("hooks (template method)", () => {
    it("beforeCreate transforme la donnée, afterCreate suit", async () => {
      const repo = new MemoryRepo();
      const svc = new HookedWidgetService(repo);
      const w = await svc.create({ name: "bolt", qty: 1 });
      assert.equal(w.name, "BOLT"); // transformé par beforeCreate
      assert.deepEqual(svc.calls, ["beforeCreate", "afterCreate"]);
    });

    it("beforeDelete / afterDelete encadrent la suppression effective", async () => {
      const svc = new HookedWidgetService(new MemoryRepo());
      const w = await svc.create({ name: "x", qty: 1 });
      svc.calls.length = 0;
      await svc.delete({ id: w.id });
      assert.deepEqual(svc.calls, ["beforeDelete", "afterDelete:1"]);
    });
  });
});
