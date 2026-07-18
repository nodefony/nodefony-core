/// <reference types="node" />
import { expect } from "chai";
import {
  isMutationMethod,
  resolveIdempotencyKey,
  resolveIdentity,
  computeFingerprint,
  evaluateIdempotency,
  IDEMPOTENCY_KEY_MAX,
} from "../../src/idempotency.js";
import type {
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
} from "nodefony";
import { emptyIdempotencyPage } from "../support/idempotencyDoubles";

// Cœur normatif PARTAGÉ de l'idempotence (draft-ietf-httpapi-idempotency-key-header)
// — testé en isolation : la décision (verdict neutre) est prouvée ici, les deux
// call-sites (AdminApiController + seam Resolver) ne font que la traduire.

// Faux store déterministe : `begin` rend l'outcome voulu ; complete/abort no-op.
function fakeStore(outcome: IdempotencyOutcome): IIdempotencyStore {
  return {
    begin: () => outcome,
    complete() {},
    abort() {},
    listPage: emptyIdempotencyPage,
    size: 0,
  };
}

describe("idempotency — isMutationMethod", () => {
  it("treats POST/PUT/PATCH/DELETE (any case) as mutations", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post", "Patch"]) {
      expect(isMutationMethod(m), m).to.equal(true);
    }
  });
  it("treats safe methods, WEBSOCKET and nullish as non-mutations", () => {
    for (const m of [
      "GET",
      "HEAD",
      "OPTIONS",
      "TRACE",
      "WEBSOCKET",
      null,
      undefined,
    ]) {
      expect(isMutationMethod(m), String(m)).to.equal(false);
    }
  });
});

describe("idempotency — resolveIdempotencyKey", () => {
  it("prefers the ALS key over the header", () => {
    expect(resolveIdempotencyKey("als", "hdr")).to.equal("als");
  });
  it("falls back to a string header, then first of a repeated header", () => {
    expect(resolveIdempotencyKey(undefined, "hdr")).to.equal("hdr");
    expect(resolveIdempotencyKey(undefined, ["a", "b"])).to.equal("a");
  });
  it("treats an over-long key as absent (anti-DoS), accepts at the bound", () => {
    expect(
      resolveIdempotencyKey("x".repeat(IDEMPOTENCY_KEY_MAX + 1), undefined),
    ).to.equal(undefined);
    const max = "x".repeat(IDEMPOTENCY_KEY_MAX);
    expect(resolveIdempotencyKey(max, undefined)).to.equal(max);
  });
  it("returns undefined when nothing usable", () => {
    expect(resolveIdempotencyKey(undefined, undefined)).to.equal(undefined);
    expect(resolveIdempotencyKey("", "")).to.equal(undefined);
    expect(resolveIdempotencyKey(42, {})).to.equal(undefined);
  });
});

describe("idempotency — resolveIdentity", () => {
  it("derives from username > identifier > id", () => {
    expect(
      resolveIdentity({ username: "u", identifier: "i", id: "x" }),
    ).to.equal("u");
    expect(resolveIdentity({ identifier: "i", id: "x" })).to.equal("i");
    expect(resolveIdentity({ id: "x" })).to.equal("x");
  });
  it("returns null for a non-object / empty user (no ALS identity)", () => {
    expect(resolveIdentity(null)).to.equal(null);
    expect(resolveIdentity("nope")).to.equal(null);
    expect(resolveIdentity({})).to.equal(null);
  });
});

describe("idempotency — computeFingerprint", () => {
  it("is deterministic for identical payloads", () => {
    expect(computeFingerprint(["r", { id: "1" }, { x: 1 }])).to.equal(
      computeFingerprint(["r", { id: "1" }, { x: 1 }]),
    );
  });
  it("differs when the payload differs", () => {
    expect(computeFingerprint(["r", {}, { x: 1 }])).to.not.equal(
      computeFingerprint(["r", {}, { x: 2 }]),
    );
  });
});

describe("idempotency — evaluateIdempotency (verdict)", () => {
  const base = {
    identity: "alice" as string | null,
    clientKey: "k1" as string | undefined,
    fingerprint: "fp",
    isWs: false,
    required: false,
  };

  it("no key + strict (required) → reject 400 (HTTP message)", async () => {
    expect(
      await evaluateIdempotency({
        ...base,
        store: undefined,
        clientKey: undefined,
        required: true,
      }),
    ).to.deep.equal({
      kind: "reject",
      status: 400,
      message: "Idempotency-Key required",
    });
  });

  it("no key + WS → reject 400 (socket message), even in soft mode", async () => {
    const v = await evaluateIdempotency({
      ...base,
      store: undefined,
      clientKey: undefined,
      isWs: true,
      required: false,
    });
    expect(v.kind).to.equal("reject");
    if (v.kind === "reject") {
      expect(v.status).to.equal(400);
      expect(v.message).to.contain("socket");
    }
  });

  it("no key + soft HTTP → execute", async () => {
    expect(
      (
        await evaluateIdempotency({
          ...base,
          store: undefined,
          clientKey: undefined,
        })
      ).kind,
    ).to.equal("execute");
  });

  it("key but no store → execute (degrade, no cache)", async () => {
    expect(
      (await evaluateIdempotency({ ...base, store: undefined })).kind,
    ).to.equal("execute");
  });

  it("key but no identity → execute (never share cross-identity)", async () => {
    expect(
      (
        await evaluateIdempotency({
          ...base,
          store: fakeStore({ state: "fresh" }),
          identity: null,
        })
      ).kind,
    ).to.equal("execute");
  });

  it("fresh → guarded with scoped key [identity, clientKey]", async () => {
    expect(
      await evaluateIdempotency({
        ...base,
        store: fakeStore({ state: "fresh" }),
      }),
    ).to.deep.equal({ kind: "guarded", key: JSON.stringify(["alice", "k1"]) });
  });

  it("passes the scoped key + fingerprint to store.begin", async () => {
    const seen: [string, string][] = [];
    const store: IIdempotencyStore = {
      begin: (k, f) => {
        seen.push([k, f]);
        return { state: "fresh" };
      },
      complete() {},
      abort() {},
      listPage: emptyIdempotencyPage,
      size: 0,
    };
    await evaluateIdempotency({ ...base, store });
    expect(seen).to.deep.equal([[JSON.stringify(["alice", "k1"]), "fp"]]);
  });

  it("in-flight → reject 409", async () => {
    const v = await evaluateIdempotency({
      ...base,
      store: fakeStore({ state: "in-flight" }),
    });
    expect(v).to.include({ kind: "reject", status: 409 });
  });

  it("replayed → replay with the memorized response", async () => {
    const response: IdempotentResponse = { status: 201, body: { id: 7 } };
    expect(
      await evaluateIdempotency({
        ...base,
        store: fakeStore({ state: "replayed", response }),
      }),
    ).to.deep.equal({ kind: "replay", response });
  });

  it("mismatch → reject 422 with a detail (RFC 9110 §15.5.21)", async () => {
    const v = await evaluateIdempotency({
      ...base,
      store: fakeStore({ state: "mismatch" }),
    });
    expect(v.kind).to.equal("reject");
    if (v.kind === "reject") {
      expect(v.status).to.equal(422);
      expect(v.detail).to.be.a("string");
    }
  });
});
