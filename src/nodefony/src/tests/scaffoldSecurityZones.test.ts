/**
 * **Une application complète générée avec Keycloak ne démarre pas sur un
 * avertissement de sécurité.**
 *
 * Sa zone `secure` n'exige qu'une session, et la connexion Keycloak crée les
 * comptes à la volée : sans rôle déclaré, le pare-feu la signalerait « ouverte
 * à tout compte que keycloak délivre » dès le premier démarrage (#552). Le
 * gabarit DÉCLARE donc `roles: ["ROLE_USER"]` — l'intention écrite, qui éteint
 * le constat sans changer le comportement.
 *
 * Lit l'application RENDUE, pas le gabarit : la configuration est importée et
 * évaluée avec les variables qui branchent Keycloak.
 */
import { assert } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

describe("create app complete — la zone `secure` déclare son rôle (#552)", () => {
  it("🔴 avec Keycloak branché, `secure` exige ROLE_USER et l'inscription reste active", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nf-zones-"));
    try {
      runScaffold(
        {
          type: "app",
          answers: { name: "zones", preset: "complete" },
          dir,
          force: false,
        },
        version,
      );
      const file = path.join(dir, "nodefony", "config", "security.ts");
      const mod = (await import(pathToFileURL(file).href)) as {
        securityConfig: (ctx: { env: Record<string, string> }) => {
          areas: Record<
            string,
            { authenticators?: string[]; roles?: string[] }
          >;
          oauth2?: {
            providers?: Record<string, unknown>;
            allowSignup?: boolean;
          };
        };
      };
      const config = mod.securityConfig({
        env: {
          NF_KEYCLOAK_ISSUER: "https://idp.example/realms/app",
          NF_KEYCLOAK_CLIENT_ID: "app",
          NF_KEYCLOAK_CLIENT_SECRET: "s",
        },
      });
      // Le décor qui ALLUMERAIT le constat : Keycloak, inscription par défaut,
      // zone de session…
      assert.property(config.oauth2?.providers ?? {}, "keycloak");
      assert.notStrictEqual(config.oauth2?.allowSignup, false);
      assert.include(config.areas.secure?.authenticators ?? [], "session");
      // …et la déclaration qui l'éteint.
      assert.deepEqual(config.areas.secure?.roles, ["ROLE_USER"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
