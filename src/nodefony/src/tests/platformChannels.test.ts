import { describe, it, expect } from "vitest";
import {
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_CHANNELS,
  PLATFORM_METHODS,
  PLATFORM_EVENTS,
  isPlatformChannel,
  startsWithCI,
} from "../realtime/platformChannels";
import { rateChannel, parseRate, isRateChannel } from "../realtime/channelRate";

/**
 * **Le contrat de nommage des surfaces de plateforme.**
 *
 * Ces noms sont lus par le navigateur autant que par le pod : les figer ici, en
 * toutes lettres, est délibéré. Un test qui lirait la table pour se comparer à
 * elle-même suivrait n'importe quel renommage sans broncher — or c'est justement
 * un renommage silencieux que l'on veut rendre impossible avant la release.
 */
describe("Espace de nommage des surfaces de plateforme", () => {
  it("porte la marque `nodefony:`, en toutes lettres", () => {
    expect(NODEFONY_CHANNEL_NAMESPACE).to.equal("nodefony:");
  });

  it("les canaux ont les noms attendus (contrat public du client)", () => {
    expect(PLATFORM_CHANNELS).to.deep.equal({
      syslog: "nodefony:syslog",
      audit: "nodefony:audit",
      dashboard: "nodefony:dashboard",
      supervision: "nodefony:supervision",
      debugbar: "nodefony:debugbar",
      socket: "nodefony:socket",
      ormHealth: "nodefony:orm:health",
      ormFlow: "nodefony:orm:flow",
      ormRich: "nodefony:orm:rich",
      scaffoldJob: "nodefony:scaffold:job",
    });
  });

  it("les méthodes RPC ont les noms attendus", () => {
    expect(PLATFORM_METHODS).to.deep.equal({
      ping: "nodefony:kernel:ping",
      gc: "nodefony:kernel:gc",
      scaffoldRun: "nodefony:scaffold:run",
      scaffoldCancel: "nodefony:scaffold:cancel",
    });
  });

  it("les événements DOM aussi (window est un espace partagé avec l'app)", () => {
    expect(PLATFORM_EVENTS).to.deep.equal({
      hmr: "nodefony:hmr",
      debugbarSelect: "nodefony:debugbar:select",
    });
  });

  it("TOUTE surface de la table est reconnue comme plateforme", () => {
    // Le filet : ajouter une entrée sans la marque casserait le plancher de
    // sécurité en silence — le canal serait servi comme un canal applicatif.
    for (const name of [
      ...Object.values(PLATFORM_CHANNELS),
      ...Object.values(PLATFORM_METHODS),
      ...Object.values(PLATFORM_EVENTS),
    ]) {
      expect(isPlatformChannel(name), name).to.equal(true);
    }
  });
});

describe("Reconnaissance d'une surface de plateforme", () => {
  it("un canal applicatif n'en est pas une", () => {
    expect(isPlatformChannel("chat:room1")).to.equal(false);
    expect(isPlatformChannel("syslog:commandes")).to.equal(false);
    expect(isPlatformChannel("")).to.equal(false);
  });

  it("la casse ne contourne pas la reconnaissance", () => {
    expect(isPlatformChannel("NODEFONY:syslog")).to.equal(true);
    expect(isPlatformChannel("NoDeFoNy:socket")).to.equal(true);
  });

  it("un nom qui COMMENCE par la marque sans être connu en est une quand même", () => {
    // Volontaire : le plancher couvre le territoire, pas une liste de noms — un
    // canal ajouté demain par un module hérite de la protection sans inscription.
    expect(isPlatformChannel("nodefony:module-du-futur")).to.equal(true);
  });

  it("un nom qui CONTIENT la marque ailleurs qu'au début n'en est pas une", () => {
    expect(isPlatformChannel("app:nodefony:faux")).to.equal(false);
  });
});

describe("startsWithCI", () => {
  it("compare sans tenir compte de la casse ASCII", () => {
    expect(startsWithCI("ABCdef", "abc")).to.equal(true);
    expect(startsWithCI("abcDEF", "ABC")).to.equal(true);
    expect(startsWithCI("ab", "abc")).to.equal(false);
    expect(startsWithCI("xbc", "abc")).to.equal(false);
  });

  it("un préfixe vide matche toujours (aucune contrainte)", () => {
    expect(startsWithCI("", "")).to.equal(true);
    expect(startsWithCI("quoi que ce soit", "")).to.equal(true);
  });
});

describe("Composition avec la cadence et le forage", () => {
  it("le suffixe de cadence se pose par-dessus la marque", () => {
    const c = rateChannel(PLATFORM_CHANNELS.ormHealth, 5000, 2000);
    expect(c).to.equal("nodefony:orm:health:5000");
    expect(isPlatformChannel(c)).to.equal(true);
    expect(isRateChannel(c, PLATFORM_CHANNELS.ormHealth)).to.equal(true);
    expect(
      parseRate(c, PLATFORM_CHANNELS.ormHealth, {
        default: 2000,
        min: 500,
        max: 60000,
      }),
    ).to.equal(5000);
  });

  it("le segment ajouté par la marque ne perturbe pas la lecture de la cadence", () => {
    // Le nom porte désormais DEUX `:` avant le suffixe (`nodefony:orm:health:5000`).
    // La cadence se lit depuis la longueur de la base, jamais en comptant les
    // segments — c'est ce qui rend le préfixe indolore.
    const bounds = { default: 1000, min: 200, max: 30000 };
    const base = PLATFORM_CHANNELS.supervision;
    expect(parseRate(base, base, bounds)).to.equal(1000);
    expect(parseRate(`${base}:250`, base, bounds)).to.equal(250);
    expect(parseRate(`${base}:1`, base, bounds)).to.equal(200); // borné
  });

  it("le forage par process reste reconnu comme plateforme", () => {
    expect(isPlatformChannel(`${PLATFORM_CHANNELS.supervision}@4242`)).to.equal(
      true,
    );
    expect(isPlatformChannel(`${PLATFORM_CHANNELS.ormRich}@4242`)).to.equal(
      true,
    );
  });
});
