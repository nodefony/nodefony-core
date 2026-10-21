// Témoin du banc h2c-vs-h1.sh : Node NU, sans framework — le coût de HTTP/2
// lui-même. HTTP/1.1 et h2c sur deux ports, même réponse triviale.
//
// Mode `headers` : la MÊME réponse que la route de banc de Nodefony en
// production — ses dix en-têtes, dont trois valeurs neuves à chaque requête
// (nonce de la CSP, `x-request-id`, `traceparent`), et un corps de même taille.
// Il dit ce que ce jeu d'en-têtes coûte à HTTP/2 sans aucun framework : si
// l'écart h2c − h1 du témoin rejoint celui de Nodefony, le surcoût propre est
// celui des EN-TÊTES (HPACK, validation de `respond()`), pas de notre code.
//
// Usage : node h2c-vs-h1-bare.mjs [port HTTP/1.1=5161] [port h2c=5163] [plain|headers=plain]
import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import http2 from "node:http2";

const [h1Port = "5161", h2cPort = "5163", mode = "plain"] =
  process.argv.slice(2);

const CSP_HEAD = "default-src 'self'; script-src 'self' 'nonce-";
const CSP_TAIL =
  "'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: " +
  "https://www.gravatar.com https://*.googleusercontent.com " +
  "https://avatars.githubusercontent.com; font-src 'self' data:; " +
  "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'";
const BODY = JSON.stringify({ status: "ok", pad: "x".repeat(140) });

const plain = (_req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end("ok");
};
const withHeaders = (_req, res) => {
  res.setHeader("x-status-message", "OK");
  res.setHeader("server", "nodefony");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "content-security-policy",
    CSP_HEAD + randomBytes(16).toString("base64") + CSP_TAIL,
  );
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(BODY));
  res.setHeader("x-request-id", randomUUID());
  res.setHeader(
    "traceparent",
    `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  );
  res.end(BODY);
};
const handler = mode === "headers" ? withHeaders : plain;
http.createServer(handler).listen(Number(h1Port), "127.0.0.1");
http2.createServer(handler).listen(Number(h2cPort), "127.0.0.1");
