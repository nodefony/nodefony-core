/*
 *   Unit — une commande n'attend JAMAIS sans fin.
 *
 *   Le cas est vécu : `nodefony inspect config` restait suspendu, sans un mot,
 *   sans reprendre la main. Aucun driver ne borne l'établissement par défaut —
 *   `pg-pool` lit son `connectionTimeoutMillis` à 0 comme « attendre
 *   indéfiniment » — et un serveur qui accepte le socket sans répondre laisse
 *   l'appelant pendu. Une commande de diagnostic qui se bloque est pire qu'une
 *   commande qui échoue : l'échec nomme une cause, le blocage fait douter de
 *   l'outil plutôt que de l'infrastructure.
 *
 *   Ce banc éprouve les trois comportements qui font la garantie : la borne
 *   MORD sur une attente sans fin, elle ne mord PAS sur une réponse normale, et
 *   elle laisse passer l'erreur du driver quand il y en a une — sans quoi le
 *   délai de garde masquerait le diagnostic qu'on cherchait.
 */

import { describe, it } from "vitest";
import assert from "node:assert";
import {
  CONNECT_TIMEOUT_MS,
  withConnectDeadline,
} from "../../nodefony/src/connectDeadline";

describe("withConnectDeadline — le blocage devient une erreur qui se lit", () => {
  it("🔴 une attente SANS FIN est rejetée, et le message dit qui on attendait", async () => {
    // La promesse ne se résout jamais : c'est exactement le serveur qui accepte
    // la connexion puis se tait.
    const jamais = new Promise<never>(() => {});
    await assert.rejects(
      withConnectDeadline(jamais, "la réponse de postgres 127.0.0.1:5432", 40),
      (e: Error) => {
        assert.match(e.message, /délai dépassé \(40 ms\)/u);
        assert.match(e.message, /postgres 127\.0\.0\.1:5432/u);
        return true;
      },
    );
  });

  it("une réponse normale passe — la borne ne coûte rien au cas sain", async () => {
    const valeur = await withConnectDeadline(
      Promise.resolve("pong"),
      "la réponse de la base",
      1_000,
    );
    assert.equal(valeur, "pong");
  });

  it("🔴 l'erreur du DRIVER n'est pas masquée par la garde", async () => {
    // Ce qui compte le plus : le refus authentique doit arriver tel quel, sinon
    // le délai de garde remplacerait « mot de passe refusé » par « délai
    // dépassé » et enverrait chercher au mauvais endroit.
    const refus = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });
    await assert.rejects(
      withConnectDeadline(
        Promise.reject(refus),
        "la réponse de postgres",
        1_000,
      ),
      (e: Error & { code?: string }) => {
        assert.equal(e.code, "28P01");
        assert.match(e.message, /password authentication failed/u);
        return true;
      },
    );
  });

  it("la borne par défaut est FINIE — c'est toute la garantie", () => {
    assert.ok(
      Number.isFinite(CONNECT_TIMEOUT_MS) && CONNECT_TIMEOUT_MS > 0,
      "une borne infinie ou nulle ne garantit rien",
    );
  });
});
