/// <reference types="node" />
import { expect } from "chai";
import {
  browserReachableHost,
  isValidOriginTemplate,
  resolveOriginTemplate,
  allowedHostPatternForTemplate,
  viteAllowedHostFromPattern,
  detectRemoteDev,
  originWithHostname,
  isLoopbackHostname,
} from "../../src/remoteDev.js";

/**
 * Dev déporté (P14.17) — calculs purs d'origine publique.
 *
 * Formats VÉRIFIÉS aux docs officielles (pas inventés) :
 *  - Codespaces : `https://CODESPACE_NAME-PORT.app.github.dev` (TLS 443).
 *  - Gitpod : `https://PORT-<hôte du workspace>`.
 *  - Vite `allowedHosts` : `.suffixe` = domaine + sous-domaines ; IP et
 *    localhost toujours acceptés (source Vite 8, `isHostAllowedInternal`).
 */
describe("remoteDev — origine publique du dev server", () => {
  describe("browserReachableHost", () => {
    it("une adresse d'écoute wildcard devient loopback", () => {
      expect(browserReachableHost("0.0.0.0")).to.equal("127.0.0.1");
      expect(browserReachableHost("::")).to.equal("127.0.0.1");
      expect(browserReachableHost("[::]")).to.equal("127.0.0.1");
      expect(browserReachableHost("")).to.equal("127.0.0.1");
    });
    it("une adresse joignable passe telle quelle", () => {
      expect(browserReachableHost("127.0.0.1")).to.equal("127.0.0.1");
      expect(browserReachableHost("nodefony.local")).to.equal("nodefony.local");
    });
  });

  describe("isValidOriginTemplate", () => {
    it("accepte origine fixe, port {port}, {port} dans l'hôte", () => {
      expect(isValidOriginTemplate("https://host.docker.internal:5173")).to.be
        .true;
      expect(isValidOriginTemplate("https://host.docker.internal:{port}")).to.be
        .true;
      expect(isValidOriginTemplate("https://name-{port}.app.github.dev")).to.be
        .true;
      expect(isValidOriginTemplate("http://127.0.0.1:5173")).to.be.true;
      expect(isValidOriginTemplate("https://xxx-5173.app.github.dev")).to.be
        .true;
    });
    it("refuse chemin, scheme exotique, chaîne vide", () => {
      expect(isValidOriginTemplate("https://host/path")).to.be.false;
      expect(isValidOriginTemplate("ws://host:1")).to.be.false;
      expect(isValidOriginTemplate("host.docker.internal:5173")).to.be.false;
      expect(isValidOriginTemplate("")).to.be.false;
    });
  });

  describe("resolveOriginTemplate", () => {
    it("substitue {port} en position de PORT (conteneur Docker)", () => {
      const r = resolveOriginTemplate(
        "https://host.docker.internal:{port}",
        5174,
      );
      expect(r).to.not.be.null;
      expect(r!.origin).to.equal("https://host.docker.internal:5174");
    });
    it("substitue {port} dans l'HÔTE (Codespaces) — port implicite conservé", () => {
      const r = resolveOriginTemplate(
        "https://mona-{port}.app.github.dev",
        5173,
      );
      // Pas de port écrit → aucun port ajouté : le forwarder TLS termine sur
      // 443, et le port d'ÉCOUTE ne doit pas fuiter dans l'URL publique.
      expect(r!.origin).to.equal("https://mona-5173.app.github.dev");
    });
    it("origine http sans port → origine nue", () => {
      const r = resolveOriginTemplate("http://proxy.lan", 5173);
      expect(r!.origin).to.equal("http://proxy.lan");
    });
    it("origine FIGÉE : le port réel ne s'y invite pas", () => {
      const r = resolveOriginTemplate(
        "https://host.docker.internal:5173",
        5174,
      );
      expect(r!.origin).to.equal("https://host.docker.internal:5173");
    });
    it("ne rend AUCUNE config HMR — le socket se déduit côté client", () => {
      // Régression gardée : ce module a produit `hmr: {host, clientPort,
      // protocol}`, écrit tel quel dans la config Vite. Une valeur écrite est
      // la MÊME pour tous les clients, alors qu'une seule instance sert en
      // même temps l'origine publique d'une plateforme et un tunnel local.
      // Le client Vite déduit son socket de l'URL par laquelle il a été chargé
      // (`client.mjs` : `__HMR_HOSTNAME__ || importMetaUrl.hostname`) — donc
      // rien à rendre, et surtout rien à figer.
      const r = resolveOriginTemplate(
        "https://mona-{port}.app.github.dev",
        5173,
      );
      expect(r).to.not.be.null;
      expect(Object.keys(r!)).to.deep.equal(["origin"]);
    });
    it("template invalide → null (l'appelant annonce et dérive localement)", () => {
      expect(resolveOriginTemplate("n'importe quoi", 5173)).to.be.null;
      expect(resolveOriginTemplate("https://host/path", 5173)).to.be.null;
    });
  });

  describe("allowedHostPatternForTemplate", () => {
    it("hôte fixe → verbatim", () => {
      expect(
        allowedHostPatternForTemplate("https://host.docker.internal:{port}"),
      ).to.equal("host.docker.internal");
    });
    it("{port} dans un sous-domaine → wildcard .suffixe (sémantique Vite)", () => {
      expect(
        allowedHostPatternForTemplate("https://mona-{port}.app.github.dev"),
      ).to.equal(".app.github.dev");
      expect(
        allowedHostPatternForTemplate("https://{port}-ws.ws-eu45.gitpod.io"),
      ).to.equal(".ws-eu45.gitpod.io");
    });
    it("{port} dans le DERNIER label → pas de suffixe wildcardable → null", () => {
      expect(allowedHostPatternForTemplate("https://host-{port}")).to.be.null;
    });
    it("template invalide → null", () => {
      expect(allowedHostPatternForTemplate("zzz")).to.be.null;
    });
  });

  describe("viteAllowedHostFromPattern (pont trustedHosts → allowedHosts)", () => {
    it("hôte exact → verbatim", () => {
      expect(viteAllowedHostFromPattern("host.docker.internal")).to.equal(
        "host.docker.internal",
      );
    });
    it("wildcard un-label de la barrière Host → wildcard Vite", () => {
      expect(viteAllowedHostFromPattern("*.nodefony.com")).to.equal(
        ".nodefony.com",
      );
    });
    it("wildcard non exprimable chez Vite → null (annoncé par l'appelant)", () => {
      expect(viteAllowedHostFromPattern("api-*.nodefony.com")).to.be.null;
      expect(viteAllowedHostFromPattern("*.a.*.b")).to.be.null;
    });
  });

  describe("detectRemoteDev", () => {
    it("Codespaces : template depuis les variables documentées GitHub", () => {
      const d = detectRemoteDev({
        CODESPACE_NAME: "mona-hot-potato-x7",
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
      });
      expect(d).to.deep.equal({
        provider: "codespaces",
        originTemplate: "https://mona-hot-potato-x7-{port}.app.github.dev",
      });
    });
    it("Gitpod : port en PRÉFIXE de l'hôte du workspace", () => {
      const d = detectRemoteDev({
        GITPOD_WORKSPACE_URL: "https://tomato.ws-eu45.gitpod.io",
      });
      expect(d).to.deep.equal({
        provider: "gitpod",
        originTemplate: "https://{port}-tomato.ws-eu45.gitpod.io",
      });
    });
    it("Codespaces gagne si les deux jeux de variables sont posés", () => {
      const d = detectRemoteDev({
        CODESPACE_NAME: "x",
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
        GITPOD_WORKSPACE_URL: "https://y.ws-eu45.gitpod.io",
      });
      expect(d!.provider).to.equal("codespaces");
    });
    it("Codespaces INCOMPLET (un seul des deux) → pas de détection", () => {
      expect(detectRemoteDev({ CODESPACE_NAME: "x" })).to.be.null;
      expect(
        detectRemoteDev({
          GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
        }),
      ).to.be.null;
    });
    it("GITPOD_WORKSPACE_URL malformée → pas de détection (pas de crash)", () => {
      expect(detectRemoteDev({ GITPOD_WORKSPACE_URL: "::bad::" })).to.be.null;
    });
    it("environnement local (VS Code Remote/WSL2 inclus) → null", () => {
      expect(detectRemoteDev({})).to.be.null;
      expect(detectRemoteDev({ TERM_PROGRAM: "vscode" })).to.be.null;
    });
  });

  describe("originWithHostname — dérivation par Host de la requête", () => {
    it("remplace le NOM, garde le scheme et le port", () => {
      expect(
        originWithHostname("https://127.0.0.1:5173", "host.docker.internal"),
      ).to.equal("https://host.docker.internal:5173");
      expect(
        originWithHostname("http://127.0.0.1:5173", "poste.local"),
      ).to.equal("http://poste.local:5173");
      // Famille non-primaire (Angular sur son propre port) : le port de CETTE
      // instance suit, pas celui de la famille par défaut.
      expect(originWithHostname("https://127.0.0.1:5177", "autre")).to.equal(
        "https://autre:5177",
      );
    });

    it("origine SANS port (forwarder TLS) : aucun port inventé", () => {
      expect(
        originWithHostname("https://mona-5173.app.github.dev", "autre.dev"),
      ).to.equal("https://autre.dev");
    });

    it("IPv6 : forme canonique entre crochets, des deux côtés", () => {
      // `Context.domain` sérialise toute IPv6 loopback en `[::1]` (WHATWG).
      expect(originWithHostname("https://127.0.0.1:5173", "[::1]")).to.equal(
        "https://[::1]:5173",
      );
      expect(originWithHostname("http://[::1]:5173", "127.0.0.1")).to.equal(
        "http://127.0.0.1:5173",
      );
    });

    it("REJETTE tout nom qui n'est pas un hôte nu (Host est une donnée CLIENTE)", () => {
      // Un `Host:` forgé ne doit JAMAIS pouvoir fabriquer l'URL d'un script :
      // la page rendue chargerait du code depuis un serveur tiers. La barrière
      // `trustedHosts` filtre déjà en amont — ceci est la seconde ceinture,
      // celle qui tient même quand la barrière est déléguée.
      for (const forged of [
        "evil.com/x", //   chemin
        "evil.com:1", //   port injecté
        "a@b", //          userinfo
        "a b", //          espace
        "", //             vide
        "//evil.com", //   origine relative au protocole
        "https://evil.com", // origine complète
        "x\nHost: y", //   injection d'en-tête
      ]) {
        expect(originWithHostname("https://127.0.0.1:5173", forged), forged).to
          .be.null;
      }
    });

    it("REJETTE une origine qui n'est pas une origine http(s) nue", () => {
      for (const bad of [
        "ftp://x:5173",
        "https://a/b", //     chemin
        "127.0.0.1:5173", //  sans scheme
        "https://a:5173/", // slash final
        "",
      ]) {
        expect(originWithHostname(bad, "autre"), bad).to.be.null;
      }
    });
  });
  describe("isLoopbackHostname — le client vient-il de la machine qui sert ?", () => {
    it("reconnaît les formes qui désignent la boucle locale", () => {
      // Tout `127.0.0.0/8` compte (RFC 1122 § 3.2.1.3), pas seulement
      // `127.0.0.1` : un forwarder peut présenter une autre adresse du bloc.
      for (const h of [
        "localhost",
        "127.0.0.1",
        "127.0.0.2",
        "127.1.2.3",
        "127.255.255.255",
        "::1",
        "[::1]",
      ]) {
        expect(isLoopbackHostname(h), h).to.equal(true);
      }
    });

    it("refuse tout le reste — la liste est FERMÉE", () => {
      // Ce test porte une garantie de SÉCURITÉ : le `Host` est une donnée
      // cliente, et un « oui » ici autorise à servir une origine locale.
      // Les trois derniers sont les tentatives qui ressemblent le plus à un
      // loopback sans en être un.
      for (const h of [
        "example.com",
        "192.168.1.1",
        "10.0.0.1",
        "0.0.0.0",
        "::",
        "mona-5173.app.github.dev",
        "127.999.1.1", //  pas une adresse : octet hors bornes
        "127.0.0.1.evil.com", //  suffixe greffé
        "evil-127.0.0.1", //  préfixe greffé
        "127.0.0.1:5173", //  port collé — un hôte NU est attendu
        "",
      ]) {
        expect(isLoopbackHostname(h), h).to.equal(false);
      }
    });
  });
});
