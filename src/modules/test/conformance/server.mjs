// Lanceur du serveur testé par `connectconformance` (#695) — protocole :
// https://github.com/connectrpc/conformance/blob/v1.0.7/docs/testing_servers.md
//
// Lit un `ServerCompatRequest` (taille sur 4 octets big-endian, puis le
// message) sur l'entrée standard et répond un `ServerCompatResponse` qui
// désigne le serveur de DÉVELOPPEMENT déjà démarré : le port qui sert la
// version HTTP et le TLS demandés, et son certificat. Reste vivant jusqu'au
// SIGTERM du runner.
//
// Usage (par run.mjs) : node server.mjs --cert <fullchain.pem>
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { HTTPVersion } from "../dist/nodefony/gen/connectrpc/conformance/v1/config_pb.js";
import {
  ServerCompatRequestSchema,
  ServerCompatResponseSchema,
} from "../dist/nodefony/gen/connectrpc/conformance/v1/server_compat_pb.js";

const { values } = parseArgs({
  options: {
    cert: { type: "string" },
    http1: { type: "string", default: "5151" },
    tls: { type: "string", default: "5152" },
    h2c: { type: "string", default: "5153" },
  },
});

const input = readFileSync(process.stdin.fd);
const size = new DataView(input.buffer, input.byteOffset, 4).getUint32(0);
const request = fromBinary(
  ServerCompatRequestSchema,
  input.subarray(4, 4 + size),
);

// Certificat client : déclaré non supporté dans la configuration — le runner
// ne doit pas en envoyer ; s'il le fait, on le dit au lieu de servir sans.
if (request.clientTlsCert.length > 0) {
  process.stderr.write(
    "server.mjs : certificat client demandé — déclaré non supporté\n",
  );
  process.exit(78);
}
// La limite de réception, elle, accompagne CHAQUE lancement (le serveur de
// référence la pose toujours en `readMaxBytes`) ; seuls les cas qui l'éprouvent
// dépendent de `supportsMessageReceiveLimit`. Le serveur de développement ne la
// règle pas par lancement (bornes de taille : lot 4) : elle est ignorée ici, et
// les cas qui l'éprouvent ne sont pas lancés (capacité déclarée absente).
if (process.env.NF_GRPC_CONFORMANCE_DEBUG === "1") {
  process.stderr.write(
    `server.mjs : http=${request.httpVersion} tls=${request.useTls} ` +
      `protocole=${request.protocol} limite=${request.messageReceiveLimit}\n`,
  );
}
if (request.httpVersion === HTTPVersion.HTTP_VERSION_3) {
  process.stderr.write("server.mjs : HTTP/3 non supporté\n");
  process.exit(78);
}
if (request.useTls && values.cert === undefined) {
  process.stderr.write("server.mjs : --cert requis pour un cas TLS\n");
  process.exit(78);
}

const port = request.useTls
  ? values.tls
  : request.httpVersion === HTTPVersion.HTTP_VERSION_1
    ? values.http1
    : values.h2c;
const response = create(ServerCompatResponseSchema, {
  host: "127.0.0.1",
  port: Number(port),
  ...(request.useTls && values.cert !== undefined
    ? { pemCert: readFileSync(values.cert) }
    : {}),
});
const bytes = toBinary(ServerCompatResponseSchema, response);
const out = new Uint8Array(4 + bytes.byteLength);
new DataView(out.buffer).setUint32(0, bytes.byteLength);
out.set(bytes, 4);
process.stdout.write(out);

// Le serveur vit ailleurs : on attend seulement la fin de la passe.
const keepAlive = setInterval(() => undefined, 1 << 30);
process.once("SIGTERM", () => {
  clearInterval(keepAlive);
  process.exit(0);
});
