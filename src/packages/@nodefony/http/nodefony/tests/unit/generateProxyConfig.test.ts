/// <reference types="node" />
import { expect } from "chai";
import {
  generateNginxConfig,
  generateHaproxyConfig,
  defaultIntrospection,
  type ProxyIntrospection,
} from "../../src/proxy/generateProxyConfig.js";

function intro(over: Partial<ProxyIntrospection> = {}): ProxyIntrospection {
  return { ...defaultIntrospection, ...over };
}

describe("generateProxyConfig — nginx", () => {
  it("server_name exclut les IP et 0.0.0.0", () => {
    const c = generateNginxConfig(
      intro({ domains: ["nodefony.com", "localhost", "127.0.0.1", "0.0.0.0"] }),
    );
    expect(c).to.match(/server_name nodefony\.com localhost;/);
    expect(c).to.not.include("127.0.0.1;");
  });

  it("sans domaine → catch-all `_`", () => {
    expect(generateNginxConfig(intro({ domains: [] }))).to.include(
      "server_name _;",
    );
  });

  it("upstream vise backendHost:httpPort (clair)", () => {
    const c = generateNginxConfig(
      intro({ backendHost: "host.docker.internal", httpPort: 5151 }),
    );
    expect(c).to.include("server host.docker.internal:5151;");
    expect(c).to.include("proxy_pass http://nodefony;");
  });

  it("reencrypt → backend httpsPort + proxy_pass https", () => {
    const c = generateNginxConfig(intro({ httpsPort: 5152, reencrypt: true }));
    expect(c).to.include(":5152;");
    expect(c).to.include("proxy_pass https://nodefony;");
  });

  it("mount préfixé → location alias propre", () => {
    const c = generateNginxConfig(
      intro({ mounts: [{ prefix: "/_assets/studio/", dir: "/abs/out" }] }),
    );
    expect(c).to.include("location /_assets/studio/ {");
    expect(c).to.include("alias /abs/out/;");
  });

  it("statiques multi-racines → chaîne try_files + fallback @nodefony", () => {
    const c = generateNginxConfig(
      intro({ staticRoots: ["/app/public", "/mod/test/public"] }),
    );
    expect(c).to.include("root /app/public;");
    expect(c).to.include("try_files $uri @r1;");
    expect(c).to.include("location @r1 {");
    expect(c).to.include("root /mod/test/public;");
    expect(c).to.include("try_files $uri @nodefony;");
  });

  it("aucune racine statique → location / proxifie directement", () => {
    const c = generateNginxConfig(intro({ staticRoots: [] }));
    expect(c).to.match(/location \/ \{\s*\n\s*proxy_pass/);
  });

  it("inclut l'upgrade WebSocket", () => {
    const c = generateNginxConfig(intro());
    expect(c).to.include("$connection_upgrade");
    expect(c).to.include("proxy_set_header Upgrade           $http_upgrade;");
  });

  it("edge : X-Forwarded-For = $remote_addr (écrase, pas append)", () => {
    expect(generateNginxConfig(intro())).to.include(
      "proxy_set_header X-Forwarded-For   $remote_addr;",
    );
  });
});

describe("generateProxyConfig — haproxy", () => {
  it("frontend/backend + Forwarded RFC 7239 (proto=http en clair)", () => {
    const c = generateHaproxyConfig(
      intro({ backendHost: "127.0.0.1", httpPort: 5151 }),
    );
    expect(c).to.include("frontend fe_nodefony");
    expect(c).to.include("backend be_nodefony");
    expect(c).to.include("http-request del-header Forwarded");
    expect(c).to.include("proto=http");
    expect(c).to.include("server nodefony 127.0.0.1:5151 check");
  });

  it("reencrypt → ssl verify required + verifyhost + sni sur le 1er domaine", () => {
    const c = generateHaproxyConfig(
      intro({ domains: ["nodefony.com"], httpsPort: 5152, reencrypt: true }),
    );
    expect(c).to.include("127.0.0.1:5152"); // backendHost défaut
    expect(c).to.include(
      "ssl ca-file /etc/haproxy/certs/ca.pem verify required",
    );
    expect(c).to.include("verifyhost nodefony.com");
    expect(c).to.include("sni str(nodefony.com)");
    expect(c).to.include("proto=https");
  });

  it("note l'absence d'offload statique si des statiques existent", () => {
    const c = generateHaproxyConfig(intro({ staticRoots: ["/app/public"] }));
    expect(c).to.match(/haproxy ne sert pas de fichiers/i);
  });
});
