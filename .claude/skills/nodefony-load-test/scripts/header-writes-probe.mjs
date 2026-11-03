// ─────────────────────────────────────────────────────────────────────────────
// Sonde de DIAGNOSTIC — compte, par réponse servie, les `setHeader` NATIFS
// posés AVANT le `writeHead`, et la forme sous laquelle `writeHead` reçoit ses
// en-têtes (rien, objet, liste plate). Un seul `setHeader` natif avant le
// `writeHead` fait retomber Node sur son chemin lent pour TOUTE la réponse
// (`micro/micro-write-head.mjs`, ligne « mixte ») : c'est ce que cette sonde
// rend visible, couche appelante comprise. Né de #727.
//
// Jamais en production. Préchargée dans le SERVEUR par NODE_OPTIONS :
//
//   NODE_OPTIONS="--import $PWD/.claude/skills/nodefony-load-test/scripts/header-writes-probe.mjs" \
//     bash .claude/skills/nodefony-start-server/start.sh
//
// Puis jouer des requêtes (ex. `header-snapshot.mjs`) et lire :
//   tmp/runs/header-writes.jsonl  — une ligne par réponse :
//   { url, beforeWriteHead: [{ name, by }], writeHead: "none|object|list", listLength, afterWriteHead }
//
// Résumé : node .claude/skills/nodefony-load-test/scripts/header-writes-probe.mjs --summary
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "tmp", "runs", "header-writes.jsonl");

if (process.argv.includes("--summary")) {
  const rows = fs
    .readFileSync(OUT, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (const r of rows) {
    const by = [...new Set(r.beforeWriteHead.map((w) => w.by))].join(" | ");
    console.log(
      `${String(r.beforeWriteHead.length).padStart(2)} avant · writeHead=${r.writeHead}` +
        `${r.listLength ? `(${r.listLength / 2})` : ""} · ${r.url}${by ? `  ← ${by}` : ""}`,
    );
  }
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const records = new WeakMap();

/** Premier cadre de la pile hors Node et hors sonde : la couche qui écrit. */
const caller = () => {
  const lines = new Error().stack?.split("\n") ?? [];
  for (const l of lines.slice(3)) {
    if (l.includes("node:") || l.includes("header-writes-probe")) continue;
    const m = l.match(
      /(@nodefony\/[^/]+|src\/nodefony|modules\/[^/]+|node_modules\/[^/]+)[^:]*\/([^/:]+):(\d+)/,
    );
    return m ? `${m[1]}/${m[2]}:${m[3]}` : l.trim().slice(0, 120);
  }
  return "?";
};

const rec = (res) => {
  let r = records.get(res);
  if (!r) {
    r = {
      beforeWriteHead: [],
      writeHead: "none",
      listLength: 0,
      afterWriteHead: 0,
      headed: false,
    };
    records.set(res, r);
  }
  return r;
};

// `ServerResponse` REDÉFINIT `writeHead` par-dessus `OutgoingMessage` (qui
// porte `setHeader` et `end`) : chaque méthode se crochète là où elle vit,
// sinon le `writeHead` HTTP/1.1 passe inaperçu.
const targets = [
  { set: http.OutgoingMessage.prototype, head: http.ServerResponse.prototype },
  {
    set: http2.Http2ServerResponse.prototype,
    head: http2.Http2ServerResponse.prototype,
  },
];
for (const { set: proto, head } of targets) {
  const setHeader = proto.setHeader;
  proto.setHeader = function (name, value) {
    const r = rec(this);
    if (r.headed) r.afterWriteHead++;
    else
      r.beforeWriteHead.push({
        name: name.toLowerCase(),
        by: caller(),
      });
    return setHeader.call(this, name, value);
  };
  const writeHead = head.writeHead;
  head.writeHead = function (status, ...rest) {
    const r = rec(this);
    if (!r.headed) {
      const arg = rest.find((x) => x && typeof x === "object");
      r.writeHead =
        arg === undefined ? "none" : Array.isArray(arg) ? "list" : "object";
      r.listLength = Array.isArray(arg) ? arg.length : 0;
    }
    // Le `writeHead` natif rappelle parfois `setHeader` (chemin lent) : ces
    // écritures-là sont comptées APRÈS, elles ne sont pas de l'appelant.
    r.headed = true;
    return writeHead.call(this, status, ...rest);
  };
  const end = proto.end;
  proto.end = function (...args) {
    flush(this);
    return end.apply(this, args);
  };
}

/** Écrit la ligne d'une réponse, une fois. */
function flush(res) {
  const r = records.get(res);
  if (r && !r.done) {
    r.done = true;
    const url = res.req?.url ?? "?";
    const { headed: _h, done: _d, ...row } = r;
    fs.appendFileSync(OUT, JSON.stringify({ url, ...row }) + "\n");
  }
}

// HTTP/2 : `Http2Response` répond par `stream.respond()` (en-têtes en OBJET,
// la seule forme du protocole) et termine par `stream.end()` — jamais par la
// réponse de compatibilité. Le flux n'est pas exporté par `node:http2` : on
// l'attrape au premier accès de `res.stream`, que `Http2Response` lit toujours.
const streamDesc = Object.getOwnPropertyDescriptor(
  http2.Http2ServerResponse.prototype,
  "stream",
);
const hooked = new WeakSet();
Object.defineProperty(http2.Http2ServerResponse.prototype, "stream", {
  configurable: true,
  get() {
    const stream = streamDesc.get.call(this);
    if (stream && !hooked.has(stream)) {
      hooked.add(stream);
      const res = this;
      const respond = stream.respond;
      stream.respond = function (headers, options) {
        const r = rec(res);
        if (!r.headed) {
          r.writeHead = "respond";
          r.listLength = headers ? Object.keys(headers).length * 2 : 0;
          r.headed = true;
        }
        flush(res);
        return respond.call(this, headers, options);
      };
    }
    return stream;
  },
});
