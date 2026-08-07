/// <reference types="node" />
/**
 * Unit — POLITIQUE de dérivation de l'origine par le `Host` de la requête.
 *
 * Le rendu (quelles URLs sortent) est couvert par `templateHelperOrigin` ; ici
 * on verrouille la DÉCISION, qui vit dans le service : quand a-t-on le droit de
 * suivre le `Host`, et quand doit-on garder l'origine résolue au démarrage.
 *
 * Trois listes doivent rester la MÊME liste, sinon la page part en silence :
 *  - hôtes DÉRIVABLES (ce que le rendu accepte de suivre) ;
 *  - `server.allowedHosts` de Vite — le check HTTP est sauté en HTTPS, mais le
 *    **WebSocket HMR l'applique toujours** (source Vite 8 : `shouldHandle` →
 *    `isHostAllowed`). Un hôte dérivable absent de cette liste donne une page
 *    qui s'affiche et un HMR muet : le pire des symptômes, celui qu'on croit
 *    être un caprice du navigateur ;
 *  - origines déclarées au CSP (`registerCspOrigins`) — un hôte dérivable non
 *    déclaré donne des `<script>` bloqués, donc une page blanche.
 *
 * Le service est instancié SANS kernel booté (module factice) : tout ce qui est
 * testé ici est synchrone et local. Les membres privés sont atteints par
 * notation crochet — assumé : la politique n'a pas de surface publique, et un
 * renommage doit casser ce banc BRUYAMMENT plutôt que le rendre complaisant.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { Container } from "nodefony";
import FrontendService from "../../service/FrontendService";

type FakeHttpKernel = {
  trustedHosts?: unknown;
  isTrustedHostname?: (h: string) => boolean;
  /** Motifs réellement compilés par la barrière — sert de règle unique ici. */
};

/**
 * Module factice. Le conteneur doit être un VRAI `Container` : `Service` ignore
 * tout objet qui n'en est pas une instance et s'en fabrique un vide — un double
 * en littéral d'objet rendait ce banc vert pour la mauvaise raison (le service
 * ne trouvait aucun `HttpKernel`, donc ne dérivait jamais rien).
 */
function fakeModule(httpKernel?: FakeHttpKernel, options: object = {}) {
  const noop = () => undefined;
  const container = new Container();
  container.set("kernel", {
    environment: "development",
    domain: "nodefony.com",
  });
  if (httpKernel) container.set("HttpKernel", httpKernel);
  return {
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options,
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0];
}

/**
 * Faux `HttpKernel` dont `isTrustedHostname` applique la MÊME sémantique que la
 * barrière réelle (exact, ou wildcard un-label `*.suffixe`) — recopier la
 * politique serait tricher, on la réduit à ce que le service en OBSERVE.
 */
function httpKernelWith(trustedHosts: unknown): FakeHttpKernel {
  const patterns = Array.isArray(trustedHosts)
    ? (trustedHosts as string[])
    : typeof trustedHosts === "string"
      ? [trustedHosts as string]
      : [];
  const all = ["nodefony.com", "localhost", "127.0.0.1", "[::1]", ...patterns];
  return {
    trustedHosts,
    isTrustedHostname: (h: string) =>
      all.some((p) =>
        p.startsWith("*.")
          ? h.endsWith(p.slice(1)) &&
            !h.slice(0, -p.slice(1).length).includes(".")
          : p === h,
      ),
  };
}

const derivable = (svc: FrontendService, host?: string): string | undefined =>
  (
    svc as unknown as {
      derivableHost(h?: string): string | undefined;
    }
  ).derivableHost(host);

describe("FrontendService — politique de dérivation par Host", () => {
  it("hôte de confiance → dérivation autorisée", () => {
    const svc = new FrontendService(
      fakeModule(httpKernelWith(["host.docker.internal"])),
    );
    expect(derivable(svc, "host.docker.internal")).to.equal(
      "host.docker.internal",
    );
    expect(derivable(svc, "127.0.0.1")).to.equal("127.0.0.1");
  });

  it("hôte INCONNU de la barrière → pas de dérivation", () => {
    // Le `Host` est fourni par le client. Sans ce filtre, une requête forgée
    // ferait émettre `<script src="https://attaquant:5173/…">` dans une page
    // de développement — le navigateur exécuterait du code tiers.
    const svc = new FrontendService(fakeModule(httpKernelWith([])));
    expect(derivable(svc, "attaquant.example.com")).to.be.undefined;
  });

  it("barrière DÉLÉGUÉE (`trustedHosts: true`) → pas de dérivation", () => {
    // `true` compile en `/^.*$/` : la barrière ne dit plus rien de la
    // légitimité d'un nom. Et le CSP émis ne couvre alors que loopback +
    // domaine canonique — dériver ailleurs rendrait une page dont tous les
    // scripts sont bloqués. On garde l'origine résolue.
    const svc = new FrontendService(fakeModule({ trustedHosts: true }));
    expect(derivable(svc, "n-importe-quoi.example.com")).to.be.undefined;
  });

  it("sans module http (app sans serveur) → pas de dérivation", () => {
    const svc = new FrontendService(fakeModule(undefined));
    expect(derivable(svc, "127.0.0.1")).to.be.undefined;
  });

  it("origine ÉPINGLÉE (publicOrigin / plateforme détectée) → pas de dérivation", () => {
    // Un réglage explicite de l'auteur gagne toujours sur une déduction :
    // c'est l'ordre de priorité documenté (config > Host > plateforme).
    const svc = new FrontendService(
      fakeModule(httpKernelWith(["host.docker.internal"])),
    );
    (svc as unknown as { originPinned: boolean }).originPinned = true;
    expect(derivable(svc, "host.docker.internal")).to.be.undefined;
  });

  it("aucun Host fourni (rendu hors requête) → pas de dérivation", () => {
    const svc = new FrontendService(
      fakeModule(httpKernelWith(["host.docker.internal"])),
    );
    expect(derivable(svc, undefined)).to.be.undefined;
    expect(derivable(svc, "")).to.be.undefined;
  });

  it("COHÉRENCE : tout hôte dérivable est accepté par Vite (WS HMR compris)", () => {
    // C'est l'invariant qui évite le symptôme le plus trompeur du lot : une
    // page qui s'affiche pendant que le rechargement à chaud ne parle plus.
    const trusted = ["host.docker.internal", "*.nodefony.com"];
    const svc = new FrontendService(fakeModule(httpKernelWith(trusted)));
    const allowed = (
      svc as unknown as {
        viteAllowedHosts(t?: string): true | string[] | undefined;
      }
    ).viteAllowedHosts(undefined);
    expect(allowed, "allowedHosts doit être une liste explicite").to.be.an(
      "array",
    );
    const list = allowed as string[];
    /** Sémantique Vite : `.suffixe` couvre le domaine ET ses sous-domaines. */
    const viteAccepts = (h: string) =>
      /^[0-9.]+$/.test(h) || // IP : toujours acceptée
      h === "localhost" ||
      h.endsWith(".localhost") ||
      list.some((p) =>
        p.startsWith(".") ? p.slice(1) === h || h.endsWith(p) : p === h,
      );

    for (const host of [
      "host.docker.internal",
      "img.nodefony.com",
      "nodefony.com",
      "127.0.0.1",
      "localhost",
    ]) {
      if (derivable(svc, host)) {
        expect(viteAccepts(host), `Vite doit accepter « ${host} »`).to.equal(
          true,
        );
      }
    }
  });

  it("COHÉRENCE : la dérivation ne sort JAMAIS de l'ensemble déclaré au CSP", () => {
    // Un hôte suivi par le rendu mais absent du CSP = scripts bloqués, page
    // blanche, aucune erreur serveur. Le fragment CSP (`#viteCspFragment`) est
    // un privé NATIF, illisible d'ici : ce banc verrouille donc l'ENSEMBLE
    // qu'il consomme — loopback + domaine canonique + `trustedHosts` — et rien
    // au-delà. La couverture du header lui-même se prouve en exécution (deux
    // requêtes, deux `Host`, le CSP rendu contient les deux origines).
    const svc = new FrontendService(
      fakeModule(httpKernelWith(["host.docker.internal"])),
    );
    for (const declared of [
      "127.0.0.1",
      "localhost",
      "nodefony.com",
      "host.docker.internal",
    ]) {
      expect(derivable(svc, declared), `${declared} est déclaré`).to.equal(
        declared,
      );
    }
    for (const outside of [
      "hors-liste.example.com",
      "autre.nodefony.com.evil.tld",
    ]) {
      expect(derivable(svc, outside), `${outside} est hors liste`).to.be
        .undefined;
    }
  });
});
