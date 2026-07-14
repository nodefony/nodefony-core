import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { defineEntity } from "../../nodefony/src/defineEntity";
import { entities } from "../../nodefony/src/decorators/entitiesDecorator";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";

/**
 * Le décorateur `@entities([...])` est le point de déclaration des entités d'une
 * application. Ces tests figent ses deux garanties : il inscrit à la phase
 * **onRegister** (avant que l'ORM ne se connecte et ne crée les tables), et il
 * résout le connecteur au boot au lieu de le figer à l'import.
 */

/** Kernel factice : seuls les événements de cycle de vie comptent ici. */
class FakeKernel extends EventEmitter {}

/** Module factice : la surface minimale que le mixin utilise (`kernel`, `log`). */
class FakeModule {
  kernel: FakeKernel;
  logs: string[] = [];
  constructor(kernel: FakeKernel) {
    this.kernel = kernel;
  }
  log(message: unknown, _severity?: string): void {
    this.logs.push(String(message));
  }
}

const PostEntity = defineEntity({ name: "Post", module: "blog", schema: {} });
const CommentEntity = defineEntity({
  name: "Comment",
  module: "blog",
  schema: {},
});

/** Applique le décorateur sur le module factice (le mixin n'exige qu'un Module-like). */
const decorate = (
  list: Parameters<typeof entities>[0],
  options?: Parameters<typeof entities>[1],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => entities(list, options)(FakeModule as any);

describe("orm-core — décorateur @entities", () => {
  let kernel: FakeKernel;

  beforeEach(() => {
    kernel = new FakeKernel();
    for (const e of entityRegistry.list()) {
      entityRegistry.unregister(e.name, e.orm);
    }
  });

  it("n'inscrit RIEN à l'instanciation — l'inscription attend onRegister", () => {
    const Decorated = decorate([PostEntity]);
    new Decorated(kernel);

    assert.equal(
      entityRegistry.has("Post", "default"),
      false,
      "l'entité ne doit pas être inscrite avant la phase onRegister",
    );

    kernel.emit("onRegister");
    assert.equal(entityRegistry.has("Post", "default"), true);
  });

  it("inscrit à onRegister — donc AVANT le connect() de l'ORM (onBoot)", () => {
    const Decorated = decorate([PostEntity, CommentEntity]);
    new Decorated(kernel);

    const seen: string[] = [];
    // L'ORM se branche à onBoot : à cet instant, les entités doivent déjà être là.
    kernel.once("onBoot", () => {
      seen.push(...entityRegistry.list().map((e) => e.name));
    });

    kernel.emit("onRegister");
    kernel.emit("onBoot");

    assert.deepEqual(seen.sort(), ["Comment", "Post"]);
  });

  it("résout le connecteur au boot : défaut « default »", () => {
    const Decorated = decorate([PostEntity]);
    new Decorated(kernel);
    kernel.emit("onRegister");

    assert.equal(entityRegistry.get("Post").orm, "default");
  });

  it("le connecteur du décorateur s'applique à toute la liste", () => {
    const Decorated = decorate([PostEntity, CommentEntity], {
      orm: "analytics",
    });
    new Decorated(kernel);
    kernel.emit("onRegister");

    assert.equal(entityRegistry.get("Post", "analytics").orm, "analytics");
    assert.equal(entityRegistry.get("Comment", "analytics").orm, "analytics");
    assert.equal(entityRegistry.has("Post", "default"), false);
  });

  it("une entité qui nomme SON connecteur garde le sien (base secondaire)", () => {
    const AuditEntity = defineEntity({
      name: "AuditTrail",
      schema: {},
      orm: "warehouse",
    });
    const Decorated = decorate([PostEntity, AuditEntity], { orm: "analytics" });
    new Decorated(kernel);
    kernel.emit("onRegister");

    assert.equal(entityRegistry.get("Post", "analytics").orm, "analytics");
    assert.equal(
      entityRegistry.get("AuditTrail", "warehouse").orm,
      "warehouse",
    );
  });

  it("idempotent : deux instances du module ne font pas double inscription", () => {
    const Decorated = decorate([PostEntity]);
    new Decorated(kernel);
    new Decorated(kernel);

    // `emit` (pas `once` côté test) : les deux instances ont posé leur écouteur.
    assert.doesNotThrow(() => kernel.emit("onRegister"));
    assert.equal(
      entityRegistry.list().filter((e) => e.name === "Post").length,
      1,
    );
  });

  it("accepte un descripteur seul (pas seulement un tableau)", () => {
    const Decorated = decorate(PostEntity);
    new Decorated(kernel);
    kernel.emit("onRegister");

    assert.equal(entityRegistry.has("Post", "default"), true);
  });

  it("defineEntity n'a AUCUN effet de bord — importer une entité ne l'inscrit pas", () => {
    defineEntity({ name: "Orphan", schema: {} });
    assert.equal(entityRegistry.has("Orphan", "default"), false);
  });
});
