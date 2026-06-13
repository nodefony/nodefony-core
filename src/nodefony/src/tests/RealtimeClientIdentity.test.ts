import { expect } from "chai";
import { RealtimeClient } from "../client/realtime/RealtimeClient";

/**
 * Le client ingère le `realtime:welcome` (1ʳᵉ frame serveur) : il en extrait
 * l'identité résolue + les capabilities annoncées et les expose (`identity`,
 * `serverChannels`, `serverMethods`) + notifie `onIdentity`. On exerce
 * `handleMessage` (point d'arrivée des frames) sans vrai WebSocket.
 */
interface Internals {
  handleMessage(raw: string): void;
}

function newClient(): { client: RealtimeClient; internal: Internals } {
  const client = new RealtimeClient({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  return { client, internal: client as unknown as Internals };
}

const anon = {
  type: "anonymous",
  authenticated: false,
  userIdentifier: "anonymous",
  roles: ["ROLE_ANONYMOUS"],
  scopes: [],
};
const admin = {
  type: "session",
  authenticated: true,
  userIdentifier: "admin",
  roles: ["ROLE_ADMIN"],
  scopes: [],
};

const welcome = (
  identity: unknown,
  channels: string[] = [],
  methods: string[] = [],
): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "realtime:welcome",
    params: { ts: 1, protocol: "jsonrpc-2.0", channels, methods, identity },
  });

describe("RealtimeClient — identité au welcome", () => {
  it("avant tout welcome → identity/serverChannels/serverMethods = null", () => {
    const { client } = newClient();
    expect(client.identity).to.equal(null);
    expect(client.serverChannels).to.equal(null);
    expect(client.serverMethods).to.equal(null);
    client.disconnect();
  });

  it("welcome ANONYME → identité + capabilities exposées", () => {
    const { client, internal } = newClient();
    internal.handleMessage(welcome(anon, ["dashboard:stats"], ["kernel:ping"]));
    expect(client.identity).to.deep.equal(anon);
    expect(client.serverChannels).to.deep.equal(["dashboard:stats"]);
    expect(client.serverMethods).to.deep.equal(["kernel:ping"]);
    client.disconnect();
  });

  it("welcome AUTHENTIFIÉ → authenticated:true + roles", () => {
    const { client, internal } = newClient();
    internal.handleMessage(welcome(admin));
    expect(client.identity?.authenticated).to.equal(true);
    expect(client.identity?.roles).to.deep.equal(["ROLE_ADMIN"]);
    client.disconnect();
  });

  it("onIdentity() notifié à chaque (re)welcome (anonyme → authentifié)", () => {
    const { client, internal } = newClient();
    const seen: Array<{ authenticated: boolean } | null> = [];
    const dispose = client.onIdentity((id) =>
      seen.push(id as { authenticated: boolean } | null),
    );
    internal.handleMessage(welcome(anon));
    internal.handleMessage(welcome(admin));
    expect(seen).to.have.length(2);
    expect(seen[0]!.authenticated).to.equal(false);
    expect(seen[1]!.authenticated).to.equal(true);
    dispose();
    client.disconnect();
  });

  it("disconnect() (logout) → identity remis à null + notifie null", () => {
    const { client, internal } = newClient();
    internal.handleMessage(welcome(admin));
    const seen: unknown[] = [];
    client.onIdentity((id) => seen.push(id));
    client.disconnect();
    expect(client.identity).to.equal(null);
    expect(seen).to.deep.equal([null]);
  });

  it("welcome PARTIEL/legacy (sans identity) → identity null, pas de crash", () => {
    const { client, internal } = newClient();
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: { ts: 1, protocol: "jsonrpc-2.0" },
      }),
    );
    expect(client.identity).to.equal(null);
    client.disconnect();
  });

  it("le welcome reste dispatché aux handlers on() (rétro-compat)", () => {
    const { client, internal } = newClient();
    const received: unknown[] = [];
    client.on("realtime:welcome", (p) => received.push(p));
    internal.handleMessage(welcome(anon));
    expect(received).to.have.length(1);
    client.disconnect();
  });
});
