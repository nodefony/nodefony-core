import { expect } from "vitest";
import {
  MAX_CHANNEL_PATTERN_WILDCARDS,
  compileChannelPattern,
  countWildcards,
} from "../realtime/channelPattern";

/**
 * Grammaire des motifs commune aux canaux de la socket et aux abonnements webhook
 * (ADR-0023 W2) : `*` = n'importe quelle suite, le reste LITTÉRAL, ancré, 3 `*` au plus.
 */
describe("realtime / compileChannelPattern (grammaire commune)", () => {
  const matches = (pattern: string, name: string): boolean =>
    compileChannelPattern(pattern)?.test(name) ?? false;

  it("`*` désigne n'importe quelle suite, y compris vide", () => {
    expect(matches("*", "login.success")).to.equal(true);
    expect(matches("commande:*", "commande:42")).to.equal(true);
    expect(matches("commande:*", "commande:")).to.equal(true);
    expect(matches("*:créée", "commande:créée")).to.equal(true);
  });

  it("échappe `.`, `(`, `+` : ils restent littéraux", () => {
    expect(matches("login.success", "loginXsuccess")).to.equal(false);
    expect(matches("a(b)", "a(b)")).to.equal(true);
    expect(matches("a(b)", "ab")).to.equal(false);
    expect(matches("a+b", "a+b")).to.equal(true);
    expect(matches("a+b", "aab")).to.equal(false);
  });

  it("est ancré aux deux bouts", () => {
    expect(matches("login", "login.success")).to.equal(false);
    expect(matches("success", "login.success")).to.equal(false);
    expect(matches("login.*", "xlogin.success")).to.equal(false);
  });

  it(`refuse au-delà de ${MAX_CHANNEL_PATTERN_WILDCARDS} étoiles`, () => {
    expect(compileChannelPattern("*:*:*")).to.be.instanceOf(RegExp);
    expect(compileChannelPattern("*:*:*:*")).to.equal(null);
    expect(countWildcards("*:*:*:*")).to.equal(4);
  });
});
