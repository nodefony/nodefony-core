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
import {
  composeCreateSpec,
  connectorsFromOrmSummaries,
} from "../../src/createSpec";

// Deux tests écrivent une application ENTIÈRE sur disque : sous Windows
// (antivirus sur chaque écriture), 6 s mesurées en CI — le délai par défaut de
// 5 s les faisait tomber. Même budget que les autres tests de génération.
describe(
  "data plane create/spec — Drizzle puis Mongoose",
  { timeout: 60_000 },
  () => {
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
      expect(connector?.choices?.map((c) => c.value)).to.deep.equal([
        "nodefony",
      ]);
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

    it("Hors serveur (aucun registre) : la MÊME réponse que le terminal", () => {
      // Sans registre ORM à interroger, Studio n'a que la lecture du terminal : les
      // deux fronts doivent alors rendre exactement la même chose.
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
        // Au premier plan, première question.
        expect(connectorQuestion(dest)?.advanced).to.not.equal(true);
      }
    });

    // Vu sur l'app de ce dépôt bootée sur MongoDB : la page ORM montrait
    // `default`, un secondaire ET `nodefony`, « Créer » les deux premiers seulement
    // — il relisait le texte de la configuration au lieu du registre en mémoire.
    describe("serveur démarré : le registre ORM en MÉMOIRE fait foi", () => {
      // `default` n'a que son nom : c'est `nodefony` qui porte les stores.
      const summaries = [
        { name: "default", default: false, connection: { driver: "sqlite" } },
        { name: "analytics", default: false, connection: { driver: "sqlite" } },
        { name: "nodefony", default: true, connection: { driver: "mongodb" } },
      ];

      it("traduit `orm/orms` en connecteurs du générateur", () => {
        expect(
          connectorsFromOrmSummaries([
            ...summaries,
            { name: "maria", connection: { driver: "MariaDB" } },
            // Moteur non publié, ou que le générateur n'écrit pas : écarté.
            { name: "sans-connexion" },
            { name: "redis", connection: { driver: "redis" } },
            null,
          ]),
        ).to.deep.equal({
          connectors: [
            { name: "default", dialect: "sqlite" },
            { name: "analytics", dialect: "sqlite" },
            { name: "nodefony", dialect: "mongodb" },
            { name: "maria", dialect: "mysql" },
          ],
          preferred: "nodefony",
        });
        expect(connectorsFromOrmSummaries(null)).to.equal(null);
        expect(connectorsFromOrmSummaries({ name: "x" })).to.equal(null);
      });

      it("propose TOUS les connecteurs chargés, dont celui que la configuration ne dit pas", () => {
        const dest = app("liveapp", "sqlite");
        const live = connectorsFromOrmSummaries(summaries);
        const { context, specs } = composeCreateSpec(dest, live);
        expect(context?.connectors.map((c) => c.name)).to.deep.equal([
          "default",
          "analytics",
          "nodefony",
        ]);
        const question = specs
          .find((s) => s.type === "entity")
          ?.questions.find((q) => q.key === "connector");
        expect(question?.choices?.map((c) => c.value)).to.deep.equal([
          "default",
          "analytics",
          "nodefony",
        ]);
        // Présélectionné : celui qui porte les stores, pas celui qui s'appelle `default`.
        expect(question?.default).to.equal("nodefony");
      });

      it("aucun ORM chargé : aucun connecteur — pas un `default` relu dans la configuration", () => {
        const dest = app("noormapp", "sqlite");
        expect(
          composeCreateSpec(dest, { connectors: [] }).context?.connectors,
        ).to.deep.equal([]);
      });
    });
  },
);
