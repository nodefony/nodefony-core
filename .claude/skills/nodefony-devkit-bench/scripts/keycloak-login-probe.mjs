#!/usr/bin/env node
/**
 * Sonde — la connexion par Keycloak ouvre-t-elle une session dans CETTE
 * application ?
 *
 * Joue le parcours d'un navigateur, sans navigateur : `/authorize` de
 * l'application → page de connexion de Keycloak → identifiants → retour sur
 * le callback → `/me`. Chaque requête VÉRIFIE le certificat (jamais
 * `rejectUnauthorized: false`) : une autorité mal posée est un défaut que
 * l'utilisateur rencontrera, la sonde doit le voir aussi.
 *
 * @usage node keycloak-login-probe.mjs --app <origine https> --username <u> --password <p> [--ca <PEM>]
 * @option --app       origine https de l'application (ex. https://localhost:5362)
 * @option --username  compte du realm
 * @option --password  son mot de passe
 * @option --ca        autorité qui signe les deux certificats (sinon : magasin
 *                     du système, lancer Node avec `--use-system-ca`)
 *
 * Sortie : une ligne JSON `{ identifier, roles }` et code 0 ; sinon la raison
 * sur la sortie d'erreur et code 1.
 */
import https from "node:https";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const AUTHORIZE = "/nodefony/security/api/oauth2/keycloak/authorize";
const ME = "/nodefony/security/api/auth/me";
const TIMEOUT = 15_000;

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    username: { type: "string" },
    password: { type: "string" },
    ca: { type: "string" },
  },
  strict: true,
});
if (!values.app || !values.username || !values.password) {
  process.stderr.write("--app, --username et --password sont requis\n");
  process.exit(64);
}
const ca = values.ca ? readFileSync(values.ca) : undefined;

/** Une requête https vérifiée, sans suivre les redirections. */
function send(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      // `family: 4` : `localhost` peut se résoudre en `::1`, où ni le serveur
      // ni le port publié par docker n'écoutent forcément.
      { method, headers, family: 4, ...(ca ? { ca } : {}) },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`délai : ${url}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Range les `Set-Cookie` d'une réponse dans un bocal `nom → nom=valeur`. */
function collect(res, jar) {
  const set = res.headers["set-cookie"] ?? [];
  for (const line of set) {
    const pair = line.split(";")[0] ?? "";
    const name = pair.split("=")[0];
    if (name) jar.set(name, pair);
  }
}

const cookie = (jar) => [...jar.values()].join("; ");

function fail(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

const app = new Map();
const kc = new Map();

const start = await send(new URL(AUTHORIZE, values.app));
collect(start, app);
const toKeycloak = start.headers.location;
if (start.status !== 302 || !toKeycloak) {
  fail(
    `/authorize → ${start.status} sans redirection vers Keycloak : le fournisseur est-il déclaré ? ${start.text.slice(0, 300)}`,
  );
}

const page = await send(new URL(toKeycloak), {});
collect(page, kc);
const form = /<form\b[^>]*\bid="kc-form-login"[^>]*>/u.exec(page.text)?.[0];
const action = form ? /\baction="([^"]+)"/u.exec(form)?.[1] : undefined;
if (page.status !== 200 || !action) {
  fail(
    `page de connexion Keycloak → ${page.status}, formulaire absent : ${page.text.replace(/\s+/gu, " ").slice(0, 300)}`,
  );
}

const posted = await send(new URL(action.replaceAll("&amp;", "&")), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie: cookie(kc),
  },
  body: new URLSearchParams({
    username: values.username,
    password: values.password,
    credentialId: "",
  }).toString(),
});
const back = posted.headers.location;
if (posted.status !== 302 || !back) {
  fail(
    `identifiants refusés par Keycloak (${posted.status}) : ${posted.text.replace(/\s+/gu, " ").slice(0, 300)}`,
  );
}

const callback = await send(new URL(back), {
  headers: { cookie: cookie(app) },
});
collect(callback, app);
const landing = callback.headers.location ?? "";
if (callback.status !== 302 || /[?&](error|reason)=/u.test(landing)) {
  fail(
    `callback de l'application → ${callback.status} ${landing} ${callback.text.slice(0, 300)}`,
  );
}

const me = await send(new URL(ME, values.app), {
  headers: { cookie: cookie(app) },
});
const user = JSON.parse(me.text)?.user ?? null;
if (me.status !== 200 || user === null) {
  fail(
    `/me ne voit aucune session après le callback : ${me.text.slice(0, 300)}`,
  );
}
process.stdout.write(
  `${JSON.stringify({ identifier: user.identifier, roles: user.roles ?? [] })}\n`,
);
