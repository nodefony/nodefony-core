/// <reference types="node" />
import { expect } from "chai";
import {
  browserReachableHost,
  isValidOriginTemplate,
  resolveOriginTemplate,
  allowedHostPatternForTemplate,
  viteAllowedHostFromPattern,
  detectRemoteDev,
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
      expect(r!.hmr).to.deep.equal({
        host: "host.docker.internal",
        clientPort: 5174,
        protocol: "wss",
      });
    });
    it("substitue {port} dans l'HÔTE (Codespaces) — WS sur 443 implicite", () => {
      const r = resolveOriginTemplate(
        "https://mona-{port}.app.github.dev",
        5173,
      );
      expect(r!.origin).to.equal("https://mona-5173.app.github.dev");
      // Pas de port écrit → 443 implicite : le forwarder TLS termine, le WS
      // HMR doit suivre le MÊME chemin que les assets.
      expect(r!.hmr).to.deep.equal({
        host: "mona-5173.app.github.dev",
        clientPort: 443,
        protocol: "wss",
      });
    });
    it("origine http sans port → clientPort 80, protocole ws", () => {
      const r = resolveOriginTemplate("http://proxy.lan", 5173);
      expect(r!.origin).to.equal("http://proxy.lan");
      expect(r!.hmr).to.deep.equal({
        host: "proxy.lan",
        clientPort: 80,
        protocol: "ws",
      });
    });
    it("origine FIGÉE : le port réel ne s'y invite pas", () => {
      const r = resolveOriginTemplate(
        "https://host.docker.internal:5173",
        5174,
      );
      expect(r!.origin).to.equal("https://host.docker.internal:5173");
      expect(r!.hmr.clientPort).to.equal(5173);
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
});
