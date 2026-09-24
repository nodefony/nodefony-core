import assert from "node:assert/strict";
import {
  describeOrphanEntities,
  findOrphanEntities,
} from "../../nodefony/src/orphanEntities";
import type { IEntity } from "../../nodefony/interfaces/index";

// Vécu : sur une infra MongoDB, le `User` de l'application restait une table SQL
// inscrite sur `default`, que Drizzle n'ouvre pas sur cette infra — et le boot
// n'en disait rien. Ces cas gardent la règle qui le DIT.
const entity = (name: string, connector: string, module = "app"): IEntity =>
  ({ name, connector, module, schema: {} }) as unknown as IEntity;

describe("entités orphelines — inscrites sur un connecteur qu'aucun ORM n'ouvre", () => {
  it("trouve celles dont le connecteur n'est pas ouvert, et elles seules", () => {
    const orphans = findOrphanEntities(
      [
        entity("User", "default"),
        entity("session", "nodefony", "http"),
        entity("Visit", "analytics", "stats"),
      ],
      ["nodefony", "analytics"],
    );
    assert.deepEqual(
      orphans.map((e) => `${e.name}@${e.connector}`),
      ["User@default"],
    );
  });

  it("aucun orphelin : aucun message", () => {
    assert.equal(
      describeOrphanEntities(
        findOrphanEntities([entity("User", "nodefony")], ["nodefony"]),
        ["nodefony"],
      ),
      null,
    );
  });

  it("le message NOMME l'entité, son connecteur, les connecteurs ouverts et le remède", () => {
    const message = describeOrphanEntities(
      [entity("User", "default")],
      ["nodefony"],
    );
    assert.ok(message);
    assert.match(message, /User@app → « default »/u);
    assert.match(message, /Connecteurs ouverts : nodefony/u);
    assert.match(message, /NF_DATABASE_URL/u);
    assert.match(message, /nodefony inspect entities/u);
  });
});
