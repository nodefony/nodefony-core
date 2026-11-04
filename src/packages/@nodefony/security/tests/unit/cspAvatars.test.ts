import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { OAuth2Service } from "../../nodefony/service/oauth2";
import { securityConfigSchema } from "../../nodefony/config/config";

/**
 * #699 lot 4 (ADR-0024 §C4) — les hôtes d'avatars tiers sortent du défaut ;
 * chaque fournisseur OAuth CONFIGURÉ déclare le sien dans `img-src`.
 */

const AVATAR_HOSTS = [
  "https://www.gravatar.com",
  "https://*.googleusercontent.com",
  "https://avatars.githubusercontent.com",
];

const provider = {
  clientId: "id",
  clientSecret: "sec",
  redirectUri: "https://app.example/cb",
};

/** `img-src` de la CSP qu'un pare-feu réel pose sur une page. */
function imgSrcOf(fw: Firewall): string[] {
  const headers: Record<string, string> = {};
  fw.applySecurityHeaders({
    cspNonce: "N0nce==",
    cspDirectives: null,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType);
  const csp = headers["Content-Security-Policy"] ?? "";
  // Première directive `img-src` : celle que le navigateur retient.
  for (const raw of csp.split(";")) {
    const [name, ...sources] = raw.trim().split(/\s+/);
    if (name === "img-src") return sources;
  }
  return [];
}

/**
 * Pare-feu et service OAuth réels, sur un même noyau ; `oauthFirst` place
 * l'écouteur `onBoot` d'OAuth AVANT celui du pare-feu.
 */
function boot(options: unknown, oauthFirst: boolean): Firewall {
  const container = new Container();
  const kernel = Object.assign(new EventEmitter(), {
    container,
    runProfile: { servers: false },
  });
  container.set("kernel", kernel);
  const module = {
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module;
  let fw: Firewall;
  if (oauthFirst) {
    new OAuth2Service(module);
    fw = new Firewall(module);
  } else {
    fw = new Firewall(module);
    new OAuth2Service(module);
  }
  container.set("firewall", fw);
  kernel.emit("onBoot");
  return fw;
}

describe("CSP — avatars tiers : déclarés par le fournisseur configuré, jamais par défaut (#699 lot 4)", () => {
  it("la politique par défaut n'autorise aucun hôte d'avatars", () => {
    const csp = securityConfigSchema.parse({}).headers.csp;
    for (const host of AVATAR_HOSTS) {
      assert.ok(!csp.includes(host), `${host} dans le défaut : ${csp}`);
    }
  });

  it("sans connexion sociale, img-src reste 'self' data: blob:", () => {
    const img = imgSrcOf(boot({}, false));
    assert.deepEqual(img, ["'self'", "data:", "blob:"]);
  });

  for (const oauthFirst of [false, true]) {
    const order = oauthFirst ? "OAuth avant le pare-feu" : "pare-feu d'abord";
    it(`google configuré → googleusercontent.com seul (${order})`, () => {
      const img = imgSrcOf(
        boot(
          { oauth2: { enabled: true, providers: { google: provider } } },
          oauthFirst,
        ),
      );
      assert.ok(img.includes("https://*.googleusercontent.com"), img.join(" "));
      assert.ok(!img.includes("https://avatars.githubusercontent.com"));
      assert.ok(!img.includes("https://www.gravatar.com"));
    });
  }

  it("google et github configurés → leurs deux hôtes", () => {
    const img = imgSrcOf(
      boot(
        {
          oauth2: {
            enabled: true,
            providers: { google: provider, github: provider },
          },
        },
        false,
      ),
    );
    assert.ok(img.includes("https://*.googleusercontent.com"), img.join(" "));
    assert.ok(img.includes("https://avatars.githubusercontent.com"));
  });

  it("connexion sociale désactivée (enabled:false) → aucun hôte, même avec des fournisseurs écrits", () => {
    const img = imgSrcOf(
      boot(
        { oauth2: { enabled: false, providers: { google: provider } } },
        false,
      ),
    );
    assert.ok(!img.includes("https://*.googleusercontent.com"), img.join(" "));
  });
});
