import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_API_BASE,
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  OAUTH2_API_BASE,
  OAUTH2_PROVIDERS_PATH,
  WEBAUTHN_API_BASE,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
  oauth2AuthorizePath,
} from "nodefony";

/**
 * Ce que ce contrôle garde : les routes MONTÉES sont celles que le cœur nomme.
 *
 * Les constantes du cœur (`runtime/authRoutes.ts`) sont citées par le déroulé
 * de connexion du navigateur, la commande qui crée un compte, `nodefony/testing`
 * et les tests générés d'une application. Les routes, elles, sont MONTÉES dans
 * un autre paquet (module framework). Si les deux divergent, chaque côté passe
 * ses propres tests pendant que tout ce qui cite la constante tombe sur un 404.
 *
 * Le contrôle lit le SOURCE des monteurs plutôt que de les importer : les
 * importer exécuterait le module framework pour lire une chaîne, et le montage
 * est de toute façon conditionné à des services qu'aucun test unitaire ne pose.
 */
const controleur = (fichier: string): string =>
  readFileSync(
    path.join(
      path.resolve(import.meta.dirname, "../../../../.."),
      "packages",
      "@nodefony",
      "framework",
      "nodefony",
      "controller",
      fichier,
    ),
    "utf8",
  );

/** Un monteur, la constante qui DOIT lui donner sa base, et les routes à recomposer. */
const MONTEURS: {
  fichier: string;
  monteur: string;
  constante: string;
  base: string;
  routes: [suffixe: string, attendu: string][];
}[] = [
  {
    fichier: "SessionAuthController.ts",
    monteur: "mountSessionAuthRoutes",
    constante: "AUTH_API_BASE",
    base: AUTH_API_BASE,
    routes: [
      ["/login", AUTH_LOGIN_PATH],
      ["/login/totp", AUTH_LOGIN_TOTP_PATH],
      ["/logout", AUTH_LOGOUT_PATH],
      ["/me", AUTH_ME_PATH],
    ],
  },
  {
    fichier: "WebAuthnController.ts",
    monteur: "mountWebAuthnRoutes",
    constante: "WEBAUTHN_API_BASE",
    base: WEBAUTHN_API_BASE,
    routes: [
      ["/login/options", WEBAUTHN_LOGIN_OPTIONS_PATH],
      ["/login/verify", WEBAUTHN_LOGIN_VERIFY_PATH],
    ],
  },
  {
    fichier: "OAuth2Controller.ts",
    monteur: "mountOAuth2Routes",
    constante: "OAUTH2_API_BASE",
    base: OAUTH2_API_BASE,
    routes: [["/providers", OAUTH2_PROVIDERS_PATH]],
  },
];

describe("les routes de connexion montées sont celles que le cœur nomme", () => {
  for (const m of MONTEURS) {
    describe(m.monteur, () => {
      it("le monteur est lisible, et tire sa base de la constante du cœur", () => {
        const source = controleur(m.fichier);
        // Un contrôle dont la source est vide passerait sur n'importe quoi.
        expect(source).toContain(m.monteur);
        expect(source).toContain(`const base = ${m.constante};`);
        // Aucune base recopiée en littéral à côté.
        expect(source).not.toContain(`"${m.base}"`);
      });

      for (const [suffixe, attendu] of m.routes) {
        it(`la table écrit \`\${base}${suffixe}\`, qui compose ${attendu}`, () => {
          expect(controleur(m.fichier)).toContain(`\`\${base}${suffixe}\``);
          expect(`${m.base}${suffixe}`).toBe(attendu);
        });
      }
    });
  }

  it("mountOAuth2Routes : le motif `{provider}/authorize` est celui que compose oauth2AuthorizePath", () => {
    expect(controleur("OAuth2Controller.ts")).toContain(
      "`${base}/{provider}/authorize`",
    );
    expect(oauth2AuthorizePath("keycloak")).toBe(
      `${OAUTH2_API_BASE}/keycloak/authorize`,
    );
  });
});
