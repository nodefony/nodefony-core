import { describe, it, expect, afterEach } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRepository } from "@nodefony/orm-core";
import <%= it.nameClass %> from "../nodefony/controllers/<%= it.nameClass %>";
import type { <%= it.entityPascal %>Row } from "../nodefony/entity/<%= it.entityPascal %>";
import { <%= it.entityPascal %>Service } from "../nodefony/service/<%= it.entityPascal %>Service";
import {
  <%= it.channelConst %>,
  relay<%= it.entityPascal %>Events,
} from "../nodefony/service/<%= it.relayClass %>";

/** Lit un champ d'une valeur reçue du réseau, sans présumer de sa forme. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}

/** Appelé par un test qui n'aurait pas dû toucher à cette méthode du dépôt. */
const unexpected = (method: string) => (): never => {
  throw new Error(`le dépôt factice n'attend pas d'appel à ${method}()`);
};

/**
 * Un dépôt qui ne sait QUE supprimer (une ligne) : la suppression est la seule
 * écriture qui ne demande pas de fabriquer une ligne complète, et elle traverse
 * le vrai `<%= it.entityPascal %>Service` jusqu'à son événement.
 */
class DeletingRepository implements IRepository<<%= it.entityPascal %>Row> {
  async delete(): Promise<number> {
    return 1;
  }

  find = unexpected("find");
  findOne = unexpected("findOne");
  create = unexpected("create");
  createMany = unexpected("createMany");
  updateOne = unexpected("updateOne");
  upsert = unexpected("upsert");
  updateMany = unexpected("updateMany");
  increment = unexpected("increment");
  deleteOne = unexpected("deleteOne");
  findOneAndDelete = unexpected("findOneAndDelete");
  count = unexpected("count");
  countDistinct = unexpected("countDistinct");
  exists = unexpected("exists");
  withTransaction = unexpected("withTransaction");
}

/**
 * La socket des écritures de `<%= it.entityPascal %>`, sans serveur, sans base et
 * sans navigateur : `createRealtimeHarness` monte le controller sur une fausse
 * connexion, et le service reçoit un dépôt factice par son constructeur.
 */
describe("<%= it.nameClass %> — écritures de <%= it.entityPascal %> en direct", () => {
  afterEach(() => getRealtimeHub().clear());

  it("annonce le canal <%= it.channel %> au client qui se connecte", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    const welcome = await h.connect();
    expect(field(welcome.params, "channels")).toContain(<%= it.channelConst %>);
    h.dispose();
  });

  it("une écriture du service part sur le canal, et plus rien une fois débranché", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    await h.connect();
    await h.subscribe(<%= it.channelConst %>);
    expect(h.denials()).toHaveLength(0);

    const service = new <%= it.entityPascal %>Service(new DeletingRepository());
    const stop = relay<%= it.entityPascal %>Events(service);
    // Le chemin réel : `delete` → dépôt → événement `onDeleted` → relais → canal.
    await service.delete({ id: <%= it.sampleId %> });
    const recus = h.messages(<%= it.channelConst %>);
    expect(recus).toMatchObject([
      { type: "deleted", criteria: { id: <%= it.sampleId %> }, count: 1 },
    ]);

    // Débranché : la même écriture ne publie plus rien.
    stop();
    await service.delete({ id: <%= it.sampleId %> });
    expect(h.messages(<%= it.channelConst %>)).toHaveLength(1);
    h.dispose();
  });
});
