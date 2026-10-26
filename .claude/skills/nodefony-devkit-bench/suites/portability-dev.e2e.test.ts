/**
 * Sonde de la base de DÉVELOPPEMENT — injectée par `scripts/bench-portability.mjs`.
 *
 * La sonde principale joue sur la base e2e, que son démarrage remet à zéro.
 * Celle-ci vise le serveur de DÉVELOPPEMENT déjà lancé par le banc, sur la base
 * que `NF_DATABASE_URL` désigne dans le `.env` — celle que l'utilisateur a
 * réellement fait basculer. Deux modes :
 *
 *  - `write` : crée une ligne, et en garde le corps relu ;
 *  - `read`  : après un redémarrage (ou un aller-retour vers un autre moteur),
 *    la relit et exige le MÊME corps, à l'octet ;
 *  - `evolved` : après l'ajout de champs et leur migration, la relit et exige
 *    le même corps AUGMENTÉ des défauts de ces champs, puis les écrit et les
 *    relit. Les champs viennent du banc (`NF_PORTABILITY_DEV_ADDED`) : la sonde
 *    ne connaît aucun nom de colonne qu'elle n'a pas reçu.
 *
 * Aucun import d'ORM : HTTP seulement.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { adminLogin, csrfHeaders, runningAppPort } from "nodefony/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const MODE = process.env.NF_PORTABILITY_DEV_MODE;
const FILE = process.env.NF_PORTABILITY_DEV_FILE;
const ENGINE = process.env.NF_PORTABILITY_DEV_ENGINE ?? "inconnu";
const PASSWORD = process.env.NF_ADMIN_PASSWORD;

/** Le corps tel qu'il est relu — seule base de comparaison. */
async function reread(
  base: string,
  auth: Record<string, string>,
  id: string,
): Promise<unknown> {
  const res = await fetch(`${base}/api/authors/${id}`, { headers: auth });
  expect(
    res.status,
    `GET /api/authors/${id} sur la base de développement`,
  ).toBe(200);
  return res.json();
}

describe(`base de développement (${ENGINE}) — ${MODE}`, () => {
  it("écrit puis relit sur la base que NF_DATABASE_URL désigne", async () => {
    if (
      !FILE ||
      !PASSWORD ||
      (MODE !== "write" && MODE !== "read" && MODE !== "evolved")
    ) {
      throw new Error(
        "sonde lancée hors du banc : NF_PORTABILITY_DEV_* ou NF_ADMIN_PASSWORD absent",
      );
    }
    const base = `http://127.0.0.1:${runningAppPort()}`;
    const auth = {
      "content-type": "application/json",
      ...(await csrfHeaders(base, await adminLogin(base, PASSWORD))),
    };
    if (MODE === "write") {
      const res = await fetch(`${base}/api/authors`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          email: `durable-${ENGINE}@example.org`,
          name: `Durable ${ENGINE} — é 😀`,
          country: "FR",
          balance: "42.1",
          born: "2001-09-09T01:46:40.123Z",
          profile: { engine: ENGINE, list: [1, "2", null] },
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const created = z.object({ id: z.string() }).parse(await res.json());
      const body = await reread(base, auth, created.id);
      writeFileSync(
        FILE,
        `${JSON.stringify({ id: created.id, body }, null, 2)}\n`,
      );
      return;
    }
    const saved = z
      .object({ id: z.string(), body: z.unknown() })
      .parse(JSON.parse(readFileSync(FILE, "utf8")));
    if (MODE === "read") {
      expect(await reread(base, auth, saved.id)).toEqual(saved.body);
      return;
    }
    const added = z
      .object({
        defaults: z.record(z.string(), z.unknown()),
        update: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse(process.env.NF_PORTABILITY_DEV_ADDED ?? "null"));
    const body = z.record(z.string(), z.unknown()).parse(saved.body);
    expect(
      await reread(base, auth, saved.id),
      "ligne écrite AVANT la migration : mêmes valeurs, champs ajoutés à leur défaut",
    ).toEqual({ ...body, ...added.defaults });
    const res = await fetch(`${base}/api/authors/${saved.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify(added.update),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await reread(base, auth, saved.id)).toMatchObject(added.update);
  });
});
