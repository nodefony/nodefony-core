import { expect } from "chai";
import {
  frameworkConfigSchema,
  frameworkConfigJsonSchema,
} from "../../config/schema.js";

describe("frameworkConfigSchema (config Zod)", () => {
  describe("défauts", () => {
    it("parse({}) → watch=true, router/adminBroker absents", () => {
      const c = frameworkConfigSchema.parse({});
      expect(c.watch).to.equal(true);
      expect(c).to.not.have.property("router");
      expect(c).to.not.have.property("adminBroker");
    });

    it("config.ts dérive du schéma (mêmes défauts)", async () => {
      const config = (await import("../../config/config.js")).default;
      expect(config).to.deep.equal(frameworkConfigSchema.parse({}));
    });
  });

  describe("watch (réservé HMR)", () => {
    it("watch=false accepté", () => {
      expect(frameworkConfigSchema.parse({ watch: false }).watch).to.equal(
        false,
      );
    });

    it("watch non-booléen → throw (validation au boot)", () => {
      expect(() => frameworkConfigSchema.parse({ watch: "yes" })).to.throw();
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
        watch: true,
        watsh: true, // typo
      } as Record<string, unknown>);
      expect(c).to.not.have.property("watsh");
    });
  });

  describe("frameworkConfigJsonSchema()", () => {
    it("retourne un JSON Schema introspectable (Studio)", () => {
      const json = frameworkConfigJsonSchema() as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      expect(json).to.be.an("object");
      expect(json.properties).to.have.property("watch");
    });
  });
});
