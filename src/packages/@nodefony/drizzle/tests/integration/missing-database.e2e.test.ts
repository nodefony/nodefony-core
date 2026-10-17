import assert from "node:assert/strict";
import { ormRegistry } from "@nodefony/orm-core";
import type { Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * **Une base ABSENTE n'est pas un refus d'identifiants** (#609).
 *
 * Le serveur répond, le compte est le bon, mais la base nommée dans l'URL n'a
 * jamais été créée — l'application ne la crée pas, et ne le doit pas
 * (`CREATE DATABASE` est un privilège d'administration). Le message rangeait
 * ce cas avec les mauvais identifiants : l'utilisateur partait vérifier un mot
 * de passe juste. Ce banc rejoue le cas sur de VRAIS serveurs — le code rendu
 * par chaque moteur se constate, il ne se suppose pas.
 *
 * GATES : `NF_PG_URL`, `NF_MYSQL_URL` (MariaDB ou MySQL Community — rejouer
 * les deux, `npm run test:all -- --dialects`).
 */

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;
const BASE_ABSENTE = `nf_absente_${process.pid}`;

/** L'URL du banc, pointée sur une base qui n'existe pas. */
function versBaseAbsente(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${BASE_ABSENTE}`;
  return parsed.toString();
}

/** Démarre un connecteur sur `url` et rend le message de refus. */
async function messageDeRefus(
  connecteur: string,
  dialect: "postgres" | "mysql",
  url: string,
): Promise<string> {
  const service = new DrizzleService({
    config: {
      connectors: { [connecteur]: { dialect, url, ddl: "auto" } },
    },
    hookKernel: () => undefined,
  } as unknown as Module);
  try {
    await service.connectAll();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    ormRegistry.unregister(connecteur);
  }
  return "";
}

/** Ce que tout message « base absente » doit dire, quel que soit le moteur. */
function assertBaseAbsenteNommee(message: string, url: string): void {
  assert.ok(message.length > 0, "le démarrage aurait dû être refusé");
  const { hostname, port, username, password } = new URL(url);
  assert.ok(message.includes(`« ${BASE_ABSENTE} »`), message);
  assert.ok(message.includes("n'existe pas"), message);
  assert.ok(message.includes("accepté"), message);
  assert.ok(message.includes(`${hostname}:${port}`), message);
  assert.ok(message.includes("CREATE DATABASE"), message);
  assert.ok(message.includes(decodeURIComponent(username)), message);
  // Pas un problème d'identifiants, ni un autre serveur sur le port.
  assert.ok(!message.includes("AUTRE SERVEUR"), message);
  // Le secret de l'URL ne sort jamais dans un message.
  if (password) assert.ok(!message.includes(password), "mot de passe divulgué");
}

describe.skipIf(!PG_URL)("DrizzleService — base absente sur PostgreSQL", () => {
  it("🔴 nomme la base, le serveur, et la commande qui la crée", async () => {
    const url = versBaseAbsente(PG_URL as string);
    const message = await messageDeRefus("base_absente_pg", "postgres", url);
    assertBaseAbsenteNommee(message, url);
    assert.ok(message.includes("3D000"), message);
    assert.ok(
      message.includes(`CREATE DATABASE "${BASE_ABSENTE}" OWNER`),
      message,
    );
  });
});

describe.skipIf(!MYSQL_URL)(
  "DrizzleService — base absente sur MySQL / MariaDB",
  () => {
    it("🔴 nomme la base, le serveur, et les commandes qui la créent", async () => {
      const url = versBaseAbsente(MYSQL_URL as string);
      const message = await messageDeRefus("base_absente_my", "mysql", url);
      assertBaseAbsenteNommee(message, url);
      assert.ok(
        message.includes(`CREATE DATABASE IF NOT EXISTS \`${BASE_ABSENTE}\``),
        message,
      );
      assert.ok(message.includes("GRANT ALL PRIVILEGES ON"), message);
    });
  },
);
