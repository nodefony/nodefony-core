import { describe, it, expect } from "vitest";
import { Container } from "nodefony";
import type { IBootNotice, Module } from "nodefony";
import {
  ISSUER_PORT_NOT_SERVED,
  issuerPortNotice,
  servedPortsOf,
} from "../../nodefony/src/boot/issuerPortNotice";
import { TokenService } from "../../nodefony/service/tokenService";

/**
 * Le point « l'émetteur nomme un port que l'application ne sert pas » (#830).
 *
 * En développement, l'émetteur par défaut se calcule sur le port CONFIGURÉ ;
 * un port déjà pris fait glisser le serveur, et jetons, découverte OAuth et
 * porte MCP visent alors un autre serveur sans que rien ne le dise.
 */
describe("issuerPortNotice", () => {
  it("émetteur local sur un port non servi → point JWT_ISSUER_PORT_NOT_SERVED, avec le geste", () => {
    const notice = issuerPortNotice("https://localhost:5152", [5154, 5155]);
    expect(notice?.code).toBe(ISSUER_PORT_NOT_SERVED);
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toContain("5152");
    expect(notice?.message).toContain("5154, 5155");
    expect(notice?.fix).toContain("servers.https.port");
    expect(notice?.fix).toContain("NF_JWT_ISSUER");
  });

  it("toute la boucle locale est jugée — 127.0.0.1 et [::1] comme localhost", () => {
    expect(issuerPortNotice("https://127.0.0.1:5152", [5155])).not.toBe(null);
    expect(issuerPortNotice("https://[::1]:5152", [5155])).not.toBe(null);
  });

  it("un port par défaut du schéma se compare aussi (443 absent de l'URL)", () => {
    expect(issuerPortNotice("https://localhost", [443])).toBe(null);
    expect(issuerPortNotice("https://localhost", [8443])).not.toBe(null);
  });

  it("émetteur qui concorde avec un port servi → silence", () => {
    expect(issuerPortNotice("https://localhost:5152", [5151, 5152])).toBe(null);
  });

  it("adresse publique → silence : derrière un relais, le port n'a pas à être celui du processus", () => {
    expect(issuerPortNotice("https://api.example.com", [5152])).toBe(null);
  });

  it("émetteur qui n'est pas une URL (défaut « nodefony ») ou rien n'écoute → silence", () => {
    expect(issuerPortNotice("nodefony", [5152])).toBe(null);
    expect(issuerPortNotice("https://localhost:5152", [])).toBe(null);
  });
});

describe("servedPortsOf", () => {
  it("lit les ports LIÉS que le noyau HTTP déclare", () => {
    expect(servedPortsOf({ httpPort: 5154, httpsPort: 5155 })).toEqual([
      5154, 5155,
    ]);
  });

  it("un serveur inactif (undefined) ou pas de noyau → rien", () => {
    expect(servedPortsOf({ httpPort: 5154, httpsPort: undefined })).toEqual([
      5154,
    ]);
    expect(servedPortsOf(undefined)).toEqual([]);
  });
});

/**
 * Le branchement : le constat part au bilan quand les serveurs écoutent
 * (`onServersReady`), jamais avant — les ports servis n'existent pas encore.
 */
describe("TokenService — émetteur et ports servis", () => {
  function boot(issuer: string, httpKernel: unknown): IBootNotice[] {
    const container = new Container();
    const handlers: Record<string, () => void> = {};
    const notices: IBootNotice[] = [];
    const kernel = {
      container,
      runProfile: { servers: true },
      once(ev: string, cb: () => void) {
        handlers[ev] = cb;
      },
      registerStoreResolution() {},
      reportBootNotice(notice: IBootNotice) {
        notices.push(notice);
      },
    };
    container.set("kernel", kernel);
    container.set("HttpKernel", httpKernel);
    const module = {
      container,
      notificationsCenter: false,
      options: {
        jwt: { enabled: true, issuer, audiences: [issuer] },
        tokenStore: { store: "memory", gcIntervalS: 0 },
      },
    } as unknown as Module;
    new TokenService(module);
    handlers["onBoot"]?.();
    handlers["onServersReady"]?.();
    return notices;
  }

  it("port TLS glissé → le bilan porte le point", () => {
    const notices = boot("https://localhost:5152", {
      httpPort: 5151,
      httpsPort: 5155,
    });
    expect(notices.map((n) => n.code)).toEqual([ISSUER_PORT_NOT_SERVED]);
  });

  it("ports servis = ports configurés → bilan muet", () => {
    expect(
      boot("https://localhost:5152", { httpPort: 5151, httpsPort: 5152 }),
    ).toEqual([]);
  });
});
