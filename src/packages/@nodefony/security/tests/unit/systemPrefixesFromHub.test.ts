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
    const rules = buildSystemRules(["nodefony:", "quantum:"]);
    const quantum = rules.find((r) => r.prefix === "quantum:");
    expect(quantum).to.not.equal(undefined);
    expect(quantum?.policy).to.deep.equal(SYSTEM_CHANNEL_POLICY);
  });

  it("le canal d'AUDIT passe EN TÊTE, avec son plancher propre (premier match gagnant)", () => {
    const rules = buildSystemRules(["nodefony:", "quantum:"]);
    expect(rules[0]?.prefix).to.equal("nodefony:audit");
    expect(rules[0]?.policy).to.deep.equal(SECURITY_CHANNEL_POLICY);
    // …et le namespace générique reste derrière, avec le plancher d'observabilité.
    expect(rules[1]?.prefix).to.equal("nodefony:");
    expect(rules[1]?.policy).to.deep.equal(SYSTEM_CHANNEL_POLICY);
  });

  it("liste qui ne COUVRE PAS l'audit : aucune règle inventée", () => {
    // Le hub ne réserve plus le territoire du journal d'audit → la sécurité cesse
    // de prétendre l'arbitrer, au lieu de garder une règle orpheline qui parlerait
    // d'un canal que plus personne ne protège.
    const rules = buildSystemRules(["quantum:"]);
    expect(rules.map((r) => r.prefix)).to.deep.equal(["quantum:"]);
  });

  it("les règles par défaut restent celles de la liste locale (repli hub ancien)", () => {
    expect(DEFAULT_SYSTEM_RULES).to.deep.equal(
      buildSystemRules(RESERVED_FLOOR_PREFIXES),
    );
  });
});
