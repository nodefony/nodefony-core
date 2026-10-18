/**
 * Le mot de passe admin de DÉVELOPPEMENT annoncé par `create app` est celui que
 * l'application sème.
 *
 * Une seule source : `DEV_ADMIN_PASSWORD` du gabarit `provisionUsers.ts.tpl`.
 * Le message de fin de `create app` annonçait « admin/admin en dev » alors que
 * le compte semé porte `nodefony-dev-42` — la politique de mots de passe refuse
 * `admin`, qui contient l'identifiant. Le premier geste de l'utilisateur, se
 * connecter à la console d'administration, échouait sur un 401 sans explication.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, "..", "..");

const provision = readFileSync(
  path.join(
    core,
    "templates",
    "app",
    "complete",
    "nodefony",
    "security",
    "provisionUsers.ts.tpl",
  ),
  "utf8",
);
const createSource = readFileSync(
  path.join(core, "src", "cli", "create.ts"),
  "utf8",
);

describe("mot de passe admin de développement — une seule valeur", () => {
  const seeded = /export const DEV_ADMIN_PASSWORD = "([^"]+)"/.exec(
    provision,
  )?.[1];

  it("le gabarit du semis déclare la valeur", () => {
    assert.ok(
      seeded,
      "DEV_ADMIN_PASSWORD introuvable dans provisionUsers.ts.tpl",
    );
  });

  it("create app annonce le mot de passe réellement semé", () => {
    assert.ok(
      !createSource.includes("admin/admin"),
      "create.ts annonce encore admin/admin : ce compte n'existe pas",
    );
    assert.ok(
      createSource.includes(`admin / ${seeded}`),
      `create.ts doit annoncer « admin / ${seeded} »`,
    );
  });
});
