import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";

/**
 * Garder une FAMILLE de canaux par un motif de nom.
 *
 * 🔴 Le défaut que ces cas ferment : une politique déclarée sur `chat:room` ne
 * couvrait pas `chat:room:1000`, servi par la fabrique dynamique. Le registre
 * indexait par nom EXACT, l'auteur croyait son canal gardé, et le seul filet
 * était un avertissement — qui dit le trou sans le fermer.
 *
 * Ce que ces cas verrouillent, au-delà du cas nominal : la précédence (un nom
 * exact l'emporte, puis le motif le plus spécifique), le fait qu'un motif n'est
 * PAS un canal souscriptible, et qu'un motif ne devient jamais une expression
 * régulière écrite par l'auteur.
 */
describe("RealtimeHub — politique de canal par MOTIF de nom", () => {
  it("un canal dynamique est couvert par le motif de sa famille", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_USER"] });

    expect(hub.resolveChannelPolicy("chat:room:1000")).to.deep.equal({
      roles: ["ROLE_USER"],
    });
    expect(hub.resolveChannelPolicy("chat:room:abc:12")).to.deep.equal({
      roles: ["ROLE_USER"],
    });
    // Hors famille : rien. Un motif garde ce qu'il nomme, pas le voisinage.
    expect(hub.resolveChannelPolicy("chat:lobby:1")).to.equal(null);
    expect(hub.resolveChannelPolicy("autre:room:1")).to.equal(null);
  });

  it("le nom EXACT l'emporte sur le motif", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_USER"] });
    hub.registerChannelPolicy("chat:room:public", { roles: [] });

    // Le cas nominal d'une exception : une salle publique dans une famille
    // gardée. Si le motif gagnait, on ne pourrait jamais ouvrir un membre.
    expect(hub.resolveChannelPolicy("chat:room:public")).to.deep.equal({
      roles: [],
    });
    expect(hub.resolveChannelPolicy("chat:room:1")).to.deep.equal({
      roles: ["ROLE_USER"],
    });
  });

  it("entre deux motifs, le plus SPÉCIFIQUE gagne — quel que soit l'ordre", () => {
    for (const ordre of [
      ["chat:*", "chat:room:*"],
      ["chat:room:*", "chat:*"],
    ]) {
      const hub = new RealtimeHub();
      const policies: Record<string, { roles: string[] }> = {
        "chat:*": { roles: ["ROLE_USER"] },
        "chat:room:*": { roles: ["ROLE_ADMIN"] },
      };
      for (const m of ordre) hub.registerChannelPolicy(m, policies[m]!);

      expect(
        hub.resolveChannelPolicy("chat:room:1"),
        `ordre de déclaration : ${ordre.join(" puis ")}`,
      ).to.deep.equal({ roles: ["ROLE_ADMIN"] });
      expect(hub.resolveChannelPolicy("chat:lobby")).to.deep.equal({
        roles: ["ROLE_USER"],
      });
    }
  });

  it("re-déclarer le MÊME motif écrase, comme la voie exacte", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_USER"] });
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_ADMIN"] });
    expect(hub.resolveChannelPolicy("chat:room:1")).to.deep.equal({
      roles: ["ROLE_ADMIN"],
    });
  });

  it("l'avertissement du canal dynamique se TAIT quand un motif couvre", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_USER"] });

    hub.noticeUnguardedDynamicChannel("chat:room:1000");
    expect(alertes).to.have.lengthOf(0);
    // …et parle toujours pour ce qu'aucun motif ne couvre.
    hub.noticeUnguardedDynamicChannel("autre:canal");
    expect(alertes).to.have.lengthOf(1);
  });

  it("un motif n'est PAS un canal : on ne s'y abonne pas", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room:*", { roles: ["ROLE_USER"] });

    // Sans ce refus, le nom littéral `chat:room:*` serait une porte à côté du
    // verrou : aucune politique EXACTE ne le couvre.
    const ok = hub.subscribeClient(
      "chat:room:*",
      () => {},
      () => ({ dispose: () => {} }) as never,
    );
    expect(ok).to.equal(false);
    expect(alertes.join(" ")).to.match(/\*/u);
  });

  it("le motif est ÉCHAPPÉ — il ne devient jamais une expression régulière", () => {
    const hub = new RealtimeHub();
    // Les métacaractères sont des caractères ordinaires dans un nom de canal.
    hub.registerChannelPolicy("a.b(c)+d:*", { roles: ["ROLE_USER"] });

    expect(hub.resolveChannelPolicy("a.b(c)+d:1")).to.deep.equal({
      roles: ["ROLE_USER"],
    });
    // `.` ne doit PAS matcher n'importe quel caractère : sans échappement,
    // « aXb(c)+d:1 » passerait, et la politique garderait autre chose que ce
    // que son auteur a écrit.
    expect(hub.resolveChannelPolicy("aXb(c)+d:1")).to.equal(null);
  });

  it("un motif trop large est REFUSÉ, et il le dit", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("a*b*c*d*e", { roles: ["ROLE_USER"] });

    // Refusé, donc AUCUNE garde — mais l'auteur est prévenu, ce qui vaut mieux
    // qu'un chemin coûteux exposé à des noms que le client choisit.
    expect(hub.resolveChannelPolicy("aXbYcZdWe")).to.equal(null);
    expect(alertes.join(" ")).to.contain("a*b*c*d*e");
  });

  it("aucun motif déclaré ⇒ la résolution exacte est intacte", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("chat:room", { roles: ["ROLE_USER"] });
    expect(hub.resolveChannelPolicy("chat:room")).to.deep.equal({
      roles: ["ROLE_USER"],
    });
    expect(hub.resolveChannelPolicy("chat:room:1")).to.equal(null);
    expect(hub.hasChannelPolicies()).to.equal(true);
  });

  it("un motif SEUL suffit à dire que le module déclare des politiques", () => {
    // `hasChannelPolicies` arme le fail-loud de l'autorisation non appliquée :
    // s'il ne comptait que la voie exacte, un module gardé uniquement par
    // motifs perdrait cette alerte.
    const hub = new RealtimeHub();
    expect(hub.hasChannelPolicies()).to.equal(false);
    hub.registerChannelPolicy("chat:*", { roles: ["ROLE_USER"] });
    expect(hub.hasChannelPolicies()).to.equal(true);
    expect(hub.hasUnenforcedChannelPolicies()).to.equal(true);
  });
});
