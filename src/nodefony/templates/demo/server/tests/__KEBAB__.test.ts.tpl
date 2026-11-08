import { describe, it, expect, vi, afterEach } from "vitest";
import { defineSecurityConfig } from "@nodefony/security";
import {
  defineDemoConfig,
  demoConfigJsonSchema,
} from "../nodefony/config/defineModuleConfig";
import { demoSecurity, PARTNER_AREA } from "../nodefony/config/security";
import DemoModule from "../index";
import DemoPulseService, {
  PULSE_MIN_INTERVAL_MS,
} from "../nodefony/service/DemoPulseService";
import type { IDemoPulse } from "../frontend/src/pulse";

/**
 * Ce que ce test prouve, sans serveur :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur ;
 *  2. sa config refuse ce qu'elle ne connaît pas, et publie le nom court du
 *     secret machine ;
 *  3. la zone qu'il apporte à `@nodefony/security` est VALIDE pour lui, et sa
 *     ressource suit l'adresse publique de l'application ;
 *  4. le pouls de l'accueil publie au plus une fois par seconde, et se tait
 *     quand personne n'écoute.
 */
describe("demo", () => {
  it("s'importe sans kernel", () => {
    expect(DemoModule).toBeTypeOf("function");
  });

  it("le secret machine est absent par défaut, et se règle par NF_KEYCLOAK_MACHINE_SECRET", () => {
    expect(defineDemoConfig({}).machineSecret).toBeUndefined();
    const schema = JSON.stringify(demoConfigJsonSchema());
    expect(schema).toContain('"env":"NF_KEYCLOAK_MACHINE_SECRET"');
    expect(schema).toContain('"secret":true');
  });

  it("refuse une clé INCONNUE plutôt que de l'ignorer", () => {
    expect(() => defineDemoConfig({ machineSecert: "faute" })).toThrow(
      /machineSecert/u,
    );
  });

  it("sa zone est acceptée par security, et sa ressource suit jwt.issuer", () => {
    const config = defineSecurityConfig({
      jwt: { issuer: "https://exemple.test" },
      ...demoSecurity,
    });
    expect(config.areas[PARTNER_AREA]?.resource).toBe(
      "https://exemple.test/demo/api/partner",
    );
  });
});

describe("demo — le pouls de l'accueil (demo:pulse)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesce une rafale en UNE trame, puis au plus une par seconde", () => {
    vi.useFakeTimers();
    const pulse = new DemoPulseService();
    const sent: IDemoPulse[] = [];
    pulse.attach((value) => sent.push(value));
    for (let i = 0; i < 100; i += 1) pulse.recordPartnerCall();
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ partner: { calls: 100 } }]);
    pulse.recordPartnerCall();
    vi.advanceTimersByTime(PULSE_MIN_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)).toEqual({ partner: { calls: 101 } });
  });

  it("se tait sans abonné, et compte quand même", () => {
    vi.useFakeTimers();
    const pulse = new DemoPulseService();
    const sent: IDemoPulse[] = [];
    const detach = pulse.attach((value) => sent.push(value));
    pulse.recordPartnerCall();
    detach();
    vi.advanceTimersByTime(PULSE_MIN_INTERVAL_MS * 3);
    expect(sent).toEqual([]);
    expect(pulse.snapshot()).toEqual({ partner: { calls: 1 } });
  });
});
