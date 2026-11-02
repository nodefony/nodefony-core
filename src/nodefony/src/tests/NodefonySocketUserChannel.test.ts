import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { isOwnUserChannel, userChannel } from "../realtime/userChannel";

/**
 * #710 — `onUser` côté navigateur : l'onglet s'abonne à SON canal personnel,
 * dont l'`id` vient du `realtime:welcome`, et suit l'identité (welcome tardif,
 * changement de compte, déconnexion). On exerce `handleMessage` sans WebSocket.
 */
interface Internals {
  handleMessage(raw: string): void;
}

function newClient(): { client: NodefonySocket; internal: Internals } {
  const client = new NodefonySocket({
    url: "ws://localhost/realtime",
    autoReconnect: false,
  });
  return { client, internal: client as unknown as Internals };
}

const account = (id: string) => ({
  type: "session",
  authenticated: true,
  id,
  userIdentifier: `login-${id}`,
  roles: ["ROLE_USER"],
  scopes: [],
});
const anon = {
  ...account("x"),
  type: "anonymous",
  authenticated: false,
  id: null,
};

const welcome = (identity: unknown): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "realtime:welcome",
    params: {
      ts: 1,
      protocol: "jsonrpc-2.0",
      channels: [],
      methods: [],
      identity,
    },
  });
const push = (channel: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", method: channel, params });

describe("NodefonySocket.onUser — canal personnel", () => {
  it("abonne au welcome, reçoit ses messages, et rien de ceux d'un autre", () => {
    const { client, internal } = newClient();
    const got: unknown[] = [];
    const off = client.onUser((m) => got.push(m));
    // Avant le welcome : l'identité est inconnue, aucun canal n'est demandé.
    expect(
      client.subscribedChannels.filter((c) => c.startsWith("user:")),
    ).to.deep.equal([]);

    internal.handleMessage(welcome(account("42")));
    expect(client.subscribedChannels).to.include("user:42");

    internal.handleMessage(push("user:42", { text: "salut" }));
    internal.handleMessage(push("user:43", { text: "pas pour toi" }));
    expect(got).to.deep.equal([{ text: "salut" }]);
    off();
    client.disconnect();
  });

  it("un autre compte à la reconnexion change de canal ; la fonction rendue désabonne", () => {
    const { client, internal } = newClient();
    const got: unknown[] = [];
    const off = client.onUser((m) => got.push(m));
    internal.handleMessage(welcome(account("42")));
    internal.handleMessage(welcome(account("43")));
    expect(client.subscribedChannels).to.include("user:43");
    expect(client.subscribedChannels).not.to.include("user:42");

    internal.handleMessage(push("user:42", { old: true }));
    internal.handleMessage(push("user:43", { now: true }));
    expect(got).to.deep.equal([{ now: true }]);

    off();
    expect(client.subscribedChannels).not.to.include("user:43");
    internal.handleMessage(push("user:43", { after: true }));
    expect(got).to.deep.equal([{ now: true }]);
    client.disconnect();
  });

  it("accueil d'un serveur ANTÉRIEUR à l'identité d'admission (sans `id`) : identité lue, `id: null`, aucun canal personnel", () => {
    // Le nouveau client face à un pod pas encore remplacé (déploiement
    // progressif) : vu au banc `release:compat` contre la 10.0.0-beta.5.
    const { client, internal } = newClient();
    client.onUser(() => {});
    const { id: _absent, ...legacy } = account("acc-1");
    internal.handleMessage(welcome(legacy));
    expect(client.identity?.authenticated).to.equal(true);
    expect(client.identity?.id).to.equal(null);
    expect(
      client.subscribedChannels.filter((c) => c.startsWith("user:")),
    ).to.deep.equal([]);
    client.disconnect();
  });

  it("un `id` PRÉSENT mais mal typé refuse l'identité entière", () => {
    const { client, internal } = newClient();
    internal.handleMessage(welcome({ ...account("acc-1"), id: 42 }));
    expect(client.identity).to.equal(null);
    client.disconnect();
  });

  it("un anonyme ne tient aucun canal personnel", () => {
    const { client, internal } = newClient();
    client.onUser(() => {});
    internal.handleMessage(welcome(anon));
    expect(
      client.subscribedChannels.filter((c) => c.startsWith("user:")),
    ).to.deep.equal([]);
    client.disconnect();
  });
});

describe("règle pure du canal personnel (cœur, isomorphe)", () => {
  const who = (id: string | null, authenticated = id !== null) => ({
    ...account(id ?? "x"),
    id,
    authenticated,
    issuer: null,
    account: authenticated,
  });

  it("égalité de chaîne avec user:<id> — jamais un découpage", () => {
    expect(userChannel("42")).to.equal("user:42");
    expect(isOwnUserChannel("user:42", who("42"))).to.equal(true);
    expect(isOwnUserChannel("user:43", who("42"))).to.equal(false);
    // Le piège du préfixe : l'identité « 4 » n'entre pas sur le canal de 42.
    expect(isOwnUserChannel("user:42", who("4"))).to.equal(false);
    // Un `:` dans l'identifiant ne trompe pas : `iss#sub:x` reste lui-même.
    expect(isOwnUserChannel("user:iss#a:b", who("iss#a:b"))).to.equal(true);
    expect(isOwnUserChannel("user:iss#a", who("iss#a:b"))).to.equal(false);
  });

  it("l'anonyme n'a jamais de canal, pas même user:null", () => {
    expect(isOwnUserChannel("user:null", who(null))).to.equal(false);
    expect(isOwnUserChannel("user:42", who("42", false))).to.equal(false);
  });
});
