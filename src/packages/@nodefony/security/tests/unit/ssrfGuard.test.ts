import assert from "node:assert/strict";
import {
  assertPublicUrl,
  isBlockedAddress,
} from "../../nodefony/src/net/ssrfGuard";
import { SsrfError } from "../../nodefony/errors/SsrfError";

/**
 * Protection SSRF des URL sortantes. On prouve : classification d'IP (privées /
 * loopback / link-local / métadonnées cloud / IPv4-mapped), politique de
 * protocole et d'identifiants, et la résolution DNS (resolver injecté) — une
 * **seule** IP non publique dans la résolution suffit à rejeter (multi-A rebind).
 */

const BLOCKED = [
  "127.0.0.1",
  "10.0.0.1",
  "172.16.5.4",
  "192.168.1.1",
  "169.254.169.254", // métadonnées cloud
  "0.0.0.0",
  "100.64.0.1", // CGNAT
  "198.18.0.1", // benchmark
  "224.0.0.1", // multicast
  "192.88.99.1", // 6to4 relay
  "::1",
  "::",
  "fc00::1", // ULA
  "fe80::1", // link-local
  "::ffff:169.254.169.254", // IPv4-mapped (bypass)
  "::ffff:127.0.0.1",
];
const PUBLIC = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"];

describe("ssrfGuard — isBlockedAddress", () => {
  for (const ip of BLOCKED) {
    it(`bloque ${ip}`, () => assert.equal(isBlockedAddress(ip), true));
  }
  for (const ip of PUBLIC) {
    it(`autorise ${ip}`, () => assert.equal(isBlockedAddress(ip), false));
  }
  it("IP invalide → bloquée (fail-closed)", () =>
    assert.equal(isBlockedAddress("pas-une-ip"), true));
});

describe("ssrfGuard — assertPublicUrl (IP littérale, sans DNS)", () => {
  it("IP publique littérale → OK + pin", async () => {
    const r = await assertPublicUrl("https://1.1.1.1/hook");
    assert.deepEqual(r.addresses, ["1.1.1.1"]);
  });
  it("loopback littéral → SsrfError", () =>
    assert.rejects(() => assertPublicUrl("https://127.0.0.1/x"), SsrfError));
  it("métadonnées cloud littéral → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("http://169.254.169.254/", { allowHttp: true }),
      SsrfError,
    ));
  it("IPv6 loopback [::1] → SsrfError", () =>
    assert.rejects(() => assertPublicUrl("https://[::1]/x"), SsrfError));
  it("IPv4-mapped [::ffff:169.254.169.254] → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://[::ffff:169.254.169.254]/x"),
      SsrfError,
    ));
});

describe("ssrfGuard — protocole & identifiants", () => {
  it("http refusé par défaut", () =>
    assert.rejects(() => assertPublicUrl("http://1.1.1.1/x"), SsrfError));
  it("http autorisé si allowHttp", async () => {
    const r = await assertPublicUrl("http://1.1.1.1/x", { allowHttp: true });
    assert.ok(r.url);
  });
  it("identifiants embarqués → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://user:pass@1.1.1.1/x"),
      SsrfError,
    ));
  it("URL malformée → SsrfError", () =>
    assert.rejects(() => assertPublicUrl("pas une url"), SsrfError));
  it("protocole non-http (file/gopher) → SsrfError", async () => {
    await assert.rejects(
      () => assertPublicUrl("file:///etc/passwd"),
      SsrfError,
    );
    await assert.rejects(
      () => assertPublicUrl("gopher://1.1.1.1/x"),
      SsrfError,
    );
  });
});

describe("ssrfGuard — résolution DNS (resolver injecté)", () => {
  const toPrivate = async () => ["10.0.0.5"];
  const toPublic = async () => ["93.184.216.34"];
  const mixed = async () => ["93.184.216.34", "127.0.0.1"];

  it("hôte → IP privée → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://evil.example/x", { resolver: toPrivate }),
      SsrfError,
    ));
  it("hôte → IP publique → OK", async () => {
    const r = await assertPublicUrl("https://good.example/x", {
      resolver: toPublic,
    });
    assert.deepEqual(r.addresses, ["93.184.216.34"]);
  });
  it("UNE IP privée parmi plusieurs → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://mixed.example/x", { resolver: mixed }),
      SsrfError,
    ));
  it("allowPrivate=true → saute le contrôle (dev)", async () => {
    const r = await assertPublicUrl("https://127.0.0.1/x", {
      allowPrivate: true,
    });
    assert.ok(r.url);
  });
  it("hôte non résolvable → SsrfError", () =>
    assert.rejects(
      () =>
        assertPublicUrl("https://nope.example/x", {
          resolver: async () => {
            throw new Error("ENOTFOUND");
          },
        }),
      SsrfError,
    ));
  it("hôte sans adresse → SsrfError", () =>
    assert.rejects(
      () =>
        assertPublicUrl("https://empty.example/x", {
          resolver: async () => [],
        }),
      SsrfError,
    ));
});
