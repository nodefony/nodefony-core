import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  RealtimeHub,
  type IRevocableConnection,
} from "../../src/server/RealtimeHub";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

/**
 * Phase 0.6 — REVUE TOTALE realtime, F4 : révocation asymétrique (blue « B »).
 *
 * FAILLE (prouvée en session) : le verrou de frame est SYNC (identité figée au
 * handshake) → `subscribe` ne re-lit JAMAIS la session, contrairement à `api.request`
 * (`isValid()` par requête). Un socket survivait à sa session : un admin déconnecté
 * gardait ses flux `syslog:` / `nodefony:audit` tant que la socket vivait.
 *
 * FIX (B, validé) : re-validation PÉRIODIQUE hors-frame. Le hub inscrit les connexions
 * à identité RÉVOCABLE (session BFF portant `isValid`) et ferme (`4001`) celles dont
 * la session est morte au tick suivant. Ces tests prouvent le mécanisme du hub.
 */

// Token de session (révocable) : `isValid` pilotable (booléen, ou fabrique async).
function sessionToken(
  valid: boolean | (() => Promise<boolean>),
): IRealtimeToken {
  return {
    type: "session",
    getUserIdentifier: () => "boss",
    isAuthenticated: () => true,
    getRoles: () => ["ROLE_NODEFONY_ADMIN"],
    getScopes: () => [],
    getAttribute: () => undefined,
    isValid: typeof valid === "function" ? valid : async () => valid,
  };
}

describe("0.6 F4 — hub : re-validation périodique des sockets révocables (blue B)", () => {
  let hub: RealtimeHub | null = null;
  const registered: IRevocableConnection[] = [];

  // Nettoyage : retire toute entrée encore inscrite → arrête le timer `unref` du hub
  // (pas de setInterval qui traîne d'un test à l'autre).
  afterEach(() => {
    if (hub) for (const e of registered) hub.unregisterRevocable(e);
    registered.length = 0;
    hub = null;
  });

  // Inscrit une connexion espionnée ; renvoie le journal de ses `close`.
  function watch(
    h: RealtimeHub,
    valid: boolean | (() => Promise<boolean>),
  ): { readonly closes: Array<{ code: number; reason: string }> } {
    const closes: Array<{ code: number; reason: string }> = [];
    const entry: IRevocableConnection = {
      token: sessionToken(valid),
      close: (code, reason) => closes.push({ code, reason }),
    };
    h.registerRevocable(entry);
    registered.push(entry);
    return { closes };
  }

  it("session RÉVOQUÉE (isValid=false) → socket fermée au tick (code 4001)", async () => {
    hub = new RealtimeHub();
    const conn = watch(hub, false);
    await hub.revalidateRevocable();
    assert.deepEqual(conn.closes, [{ code: 4001, reason: "session revoked" }]);
  });

  it("contrôle positif : session VIVANTE (isValid=true) → socket INTACTE", async () => {
    hub = new RealtimeHub();
    const conn = watch(hub, true);
    await hub.revalidateRevocable();
    assert.equal(conn.closes.length, 0);
  });

  it("fail-closed : isValid() qui THROW → socket fermée (parité invokeApiRequest)", async () => {
    hub = new RealtimeHub();
    const conn = watch(hub, async () => {
      throw new Error("session store down");
    });
    await hub.revalidateRevocable();
    assert.equal(conn.closes.length, 1);
    assert.equal(conn.closes[0]!.code, 4001);
  });

  it("révoqué retiré du registre après close → pas de RE-close au tick suivant", async () => {
    hub = new RealtimeHub();
    const conn = watch(hub, false);
    await hub.revalidateRevocable();
    await hub.revalidateRevocable(); // 2ᵉ tick : l'entrée doit avoir disparu
    assert.equal(conn.closes.length, 1);
  });

  it("déconnexion propre (unregister) → l'entrée n'est plus re-validée", async () => {
    hub = new RealtimeHub();
    const closes: Array<{ code: number; reason: string }> = [];
    const entry: IRevocableConnection = {
      token: sessionToken(false),
      close: (code, reason) => closes.push({ code, reason }),
    };
    hub.registerRevocable(entry);
    hub.unregisterRevocable(entry); // simule onFinish (close normal AVANT le tick)
    await hub.revalidateRevocable();
    assert.equal(closes.length, 0);
  });

  it("hub sans connexion révocable → revalidate no-op (lazy, 0 crash)", async () => {
    hub = new RealtimeHub();
    await assert.doesNotReject(() => hub!.revalidateRevocable());
  });

  it("plusieurs connexions : seules les révoquées sont fermées", async () => {
    hub = new RealtimeHub();
    const live = watch(hub, true);
    const dead = watch(hub, false);
    await hub.revalidateRevocable();
    assert.equal(live.closes.length, 0);
    assert.equal(dead.closes.length, 1);
  });
});
