/**
 * Unit — le data plane `create/spec` rend la matière du PROJET, et elle dépend de l'ORM.
 *
 * Deux applications réelles, générées par le moteur : une SQL (Drizzle) et une MongoDB
 * (Mongoose). Ce que l'écran « Créer » reçoit doit suivre leur base : le connecteur
 * proposé, les capacités qui taisent les questions SQL, et la table des types. Un
 * formulaire qui proposerait `default` sur MongoDB ferait générer une entité rattachée
 * à un ORM absent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expect } from "chai";
import {
  getScaffoldContext,
  getScaffoldSpec,
  hydrateQuestion,
  Nodefony,
  runScaffold,
} from "nodefony";
import { composeCreateSpec } from "../../src/createSpec";

describe("data plane create/spec — Drizzle puis Mongoose", () => {
  let tmp = "";
  let saved: string | undefined;
  const app = (name: string, database: string): string => {
    const dest = path.join(tmp, name);
    runScaffold(
      {
        type: "app",
        answers: { name, database, frontend: "none" },
        dir: dest,
        force: false,
      },
      Nodefony.version,
    );
    return dest;
  };
  const connectorQuestion = (dest: string) =>
    composeCreateSpec(dest)
      .specs.find((s) => s.type === "entity")
      ?.questions.find((q) => q.key === "connector");

  beforeAll(() => {
    // Le dialecte suit l'infra DÉCLARÉE : un `NF_DATABASE_URL` hérité du shell
    // ferait mesurer l'environnement du développeur, pas l'application.
    saved = process.env.NF_DATABASE_URL;
    delete process.env.NF_DATABASE_URL;
    tmp = mkdtempSync(path.join(os.tmpdir(), "nf-studio-create-"));
  });
  afterAll(() => {
    if (saved !== undefined) process.env.NF_DATABASE_URL = saved;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("Drizzle (SQLite) : connecteur `default` en sqlite, questions SQL posées", () => {
    const dest = app("sqlapp", "sqlite");
    const { caps, context } = composeCreateSpec(dest);
    expect(caps.hasSqlOrm).to.equal(true);
    expect(context?.connectors).to.deep.equal([
      { name: "default", dialect: "sqlite" },
    ]);
    const connector = connectorQuestion(dest);
    expect(connector?.type).to.equal("choice");
    expect(connector?.default).to.equal("default");
  });

  it("Mongoose : connecteur `nodefony` HYDRATÉ comme défaut, questions SQL tues", () => {
    const dest = app("mongoapp", "mongodb");
    const { caps, context } = composeCreateSpec(dest);
    expect(caps.hasSqlOrm).to.equal(false);
    expect(context?.connectors).to.deep.equal([
      { name: "nodefony", dialect: "mongodb" },
    ]);
    const connector = connectorQuestion(dest);
    expect(connector?.choices?.map((c) => c.value)).to.deep.equal(["nodefony"]);
    // Le défaut de la spec (`default`) n'existe pas ici : il retombe sur le choix réel.
    expect(connector?.default).to.equal("nodefony");
  });

  it("la table des types porte les quatre moteurs, dérivée du générateur", () => {
    const dest = app("typesapp", "sqlite");
    const types = composeCreateSpec(dest).context?.columnTypes ?? [];
    const ref = types.find((t) => t.type === "ref");
    expect(Object.keys(ref?.byDialect ?? {}).sort()).to.deep.equal([
      "mongodb",
      "mysql",
      "postgres",
      "sqlite",
    ]);
    expect(ref?.byDialect["mongodb"]).to.contain('"ObjectId"');
  });

  it("Studio et le terminal : la MÊME réponse — contexte et question du connecteur", () => {
    // Une source commune, ou deux fronts qui divergent : le terminal ne voyait pas
    // ce que Studio lisait sur le serveur démarré.
    for (const [name, database] of [
      ["samesql", "sqlite"],
      ["samemongo", "mongodb"],
    ] as const) {
      const dest = app(name, database);
      const terminal = getScaffoldContext(dest);
      const studio = composeCreateSpec(dest);
      expect(studio.context).to.deep.equal(terminal);
      const raw = getScaffoldSpec("entity")[0]?.questions.find(
        (q) => q.key === "connector",
      );
      expect(connectorQuestion(dest)).to.deep.equal(
        raw ? hydrateQuestion(raw, terminal) : undefined,
      );
      // Au premier plan, première question, et la source DITE.
      expect(connectorQuestion(dest)?.advanced).to.not.equal(true);
      expect(connectorQuestion(dest)?.note).to.contain(
        "DÉCLARÉS dans la configuration",
      );
    }
  });
});
