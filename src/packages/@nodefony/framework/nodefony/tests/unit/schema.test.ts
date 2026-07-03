import { expect } from "chai";
import {
  frameworkConfigSchema,
  frameworkConfigJsonSchema,
} from "../../config/schema.js";

describe("frameworkConfigSchema (config Zod)", () => {
  describe("défauts", () => {
    it("parse({}) → router/adminBroker absents", () => {
      const c = frameworkConfigSchema.parse({});
      expect(c).to.not.have.property("router");
      expect(c).to.not.have.property("adminBroker");
    });

    it("config.ts dérive du schéma (mêmes défauts) + porte l'aire data plane (P6 J3b)", async () => {
      const config = (await import("../../config/config.js")).default as Record<
        string,
        unknown
      >;
      // L'override inter-module « module-security » (aire data plane portée par le
      // framework, cf config.ts) n'est PAS un défaut de schema : on l'isole avant
      // de comparer le reste aux défauts dérivés.
      const { "module-security": moduleSecurity, ...defaults } = config;
      expect(defaults).to.deep.equal(frameworkConfigSchema.parse({}));
      const ms = moduleSecurity as {
        areas?: Record<string, { pattern?: string }>;
      };
      expect(ms.areas?.["nodefony-admin"]?.pattern).to.equal(
        "^/nodefony/[^/]+/api(/|$)",
      );
    });
  });

  describe("validation au boot", () => {
    it("idempotency.store non-string → throw", () => {
      expect(() =>
        frameworkConfigSchema.parse({ idempotency: { store: 42 } }),
      ).to.throw();
    });
  });

  describe("router / adminBroker (bags d'options Service, loose)", () => {
    it("router loose — clés inconnues PRÉSERVÉES (transmises au Service)", () => {
      const c = frameworkConfigSchema.parse({
        router: { logger: "pretty", custom: 42 },
      });
      expect(c.router).to.deep.equal({ logger: "pretty", custom: 42 });
    });

    it("adminBroker loose — clés inconnues préservées", () => {
      const c = frameworkConfigSchema.parse({
        adminBroker: { foo: "bar" },
      });
      expect(c.adminBroker).to.deep.equal({ foo: "bar" });
    });
  });

  describe("racine stricte", () => {
    it("clé inconnue au niveau racine → strippée (attrape les typos)", () => {
      const c = frameworkConfigSchema.parse({
        idempotensy: {}, // typo
      } as Record<string, unknown>);
      expect(c).to.not.have.property("idempotensy");
    });
  });

  describe("frameworkConfigJsonSchema()", () => {
    it("retourne un JSON Schema introspectable (Studio)", () => {
      const json = frameworkConfigJsonSchema() as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      expect(json).to.be.an("object");
      expect(json.properties).to.have.property("idempotency");
    });
  });
});
