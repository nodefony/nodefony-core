import { describe, it, expect } from "vitest";
import {
  buildSystemRules,
  DEFAULT_SYSTEM_RULES,
  SECURITY_CHANNEL_POLICY,
  SYSTEM_CHANNEL_POLICY,
  RESERVED_FLOOR_PREFIXES,
} from "../../nodefony/src/realtime/frameAuthorizer";

/**
 * **La liste des namespaces réservés appartient au hub realtime ; la politique
 * appartient à la sécurité.**
 *
 * Avant, chacun tenait son propre inventaire. Le jour où le hub réserve un
 * nouveau namespace, la sécurité l'ignorait : le canal restait sans politique, et
 * rien ne le signalait — un trou qui n'apparaît qu'en production. Le firewall lit
 * donc la liste du hub (`reservedSystemPrefixes()`) et se contente d'y accrocher
 * ses règles.
 */
describe("Règles système dérivées de la liste du hub", () => {
  it("un namespace INCONNU de la sécurité reçoit quand même une politique", () => {
    // Le hub d'une version future réserve un namespace que ce paquet n'a jamais vu.
    const rules = buildSystemRules(["security:", "syslog:", "quantum:"]);
    const quantum = rules.find((r) => r.prefix === "quantum:");
    expect(quantum).to.not.equal(undefined);
    expect(quantum?.policy).to.deep.equal(SYSTEM_CHANNEL_POLICY);
  });

  it("`security:` passe EN TÊTE, avec son plancher propre (premier match gagnant)", () => {
    const rules = buildSystemRules(["syslog:", "orm:", "security:"]);
    expect(rules[0]?.prefix).to.equal("security:");
    expect(rules[0]?.policy).to.deep.equal(SECURITY_CHANNEL_POLICY);
  });

  it("liste sans `security:` : aucune règle inventée", () => {
    const rules = buildSystemRules(["syslog:"]);
    expect(rules.map((r) => r.prefix)).to.deep.equal(["syslog:"]);
  });

  it("les règles par défaut restent celles de la liste locale (repli hub ancien)", () => {
    expect(DEFAULT_SYSTEM_RULES).to.deep.equal(
      buildSystemRules(RESERVED_FLOOR_PREFIXES),
    );
  });
});
