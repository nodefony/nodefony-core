/// <reference types="node" />
/**
 * Integration — connexion OpenID Connect contre un VRAI Keycloak (#269).
 * Requires: server running on 5152 AND `docker compose --profile keycloak up -d`,
 * with `NF_KEYCLOAK_*` posées des DEUX côtés (cible `KEYCLOAK_GATE`).
 *
 * `oauth2-flow.test.ts` prouve le flux BFF contre un fournisseur qui n'échange
 * rien. Ce banc rencontre ce qu'aucun double ne montre : l'authentification
 * cliente telle que Keycloak la lit, ses métadonnées, les claims réels de son ID
 * token, ses cookies et sa page de connexion, et un refus PKCE qui vient du
 * serveur.
 *
 * Gates :
 *  1. flux BFF complet : authorize → page Keycloak → mot de passe → callback →
 *     session → compte provisionné ;
 *  2. le jeton d'accès de la MÊME personne ouvre l'API et désigne le MÊME compte
 *     local que la session (pas un second compte, pas un 401) ;
 *  3. un `code_verifier` faux → `invalid_grant` rendu PAR KEYCLOAK au client du
 *     framework.
 */
import { describe, expect, it } from "vitest";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDiscoveredOidcProvider,
  generateCodeVerifier,
  generateState,
  OAuth2RequestError,
} from "@nodefony/security";
import type { IOAuthProvider } from "@nodefony/security";

const ISSUER = process.env.NF_KEYCLOAK_ISSUER ?? "";
const CLIENT_ID = process.env.NF_KEYCLOAK_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.NF_KEYCLOAK_CLIENT_SECRET ?? "";

const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);
/** CA de développement : Keycloak sert le certificat de l'application. */
const CA_FILE = path.join(
  REPO_ROOT,
  "nodefony",
  "config",
  "certificates",
  "ca",
  "nodefony-root-ca.crt.pem",
);
const REALM_FILE = path.join(
  REPO_ROOT,
  "docker",
  "keycloak",
  "import",
  "realm-nodefony.json",
);

const APP = { hostname: "127.0.0.1", port: 5152 };
const OAUTH = "/nodefony/security/api/oauth2/keycloak";
const ME = "/nodefony/security/api/auth/me";
const LOGOUT = "/nodefony/security/api/auth/logout";
const API = "/nodefony/test/keycloak/whoami";
/** URL de redirection enregistrée sur le client du realm (jamais suivie ici). */
const REDIRECT_URI = `https://localhost:5152${OAUTH}/callback`;
const TIMEOUT = 15_000;

type Res = { status: number; headers: Record<string, unknown>; text: string };

interface IRequest {
  url: URL;
  method?: string;
  headers?: Record<string, string>;
  body?: string | undefined;
}

function send({
  url,
  method = "GET",
  headers = {},
  body,
}: IRequest): Promise<Res> {
  const toKeycloak = url.port !== String(APP.port);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: toKeycloak ? url.hostname : APP.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        // Keycloak : la vraie chaîne de confiance (CA de dev). L'application,
        // jointe par 127.0.0.1, garde la convention des autres bancs.
        ...(toKeycloak
          ? { ca: readFileSync(CA_FILE), servername: url.hostname }
          : { rejectUnauthorized: false }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
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
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const app = (p: string, headers: Record<string, string> = {}) =>
  send({ url: new URL(`https://localhost:${APP.port}${p}`), headers });

/**
 * `fetch` minimal sur `node:https` qui fait confiance à la CA de dev — passé au
 * client du framework par son option `fetch`, sans toucher au `fetch` global ni
 * désarmer TLS dans le processus.
 */
async function caFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => {
    headers[k] = v;
  });
  const res = await send({
    url,
    method: init?.method ?? "GET",
    headers,
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (typeof v === "string") out.set(k, v);
  }
  return new Response(res.text, { status: res.status, headers: out });
}

/** Les `Set-Cookie` d'une réponse, ajoutés à une jarre `nom → valeur`. */
function collectCookies(res: Res, jar: Map<string, string>): void {
  const raw = res.headers["set-cookie"];
  for (const line of Array.isArray(raw) ? raw : []) {
    if (typeof line !== "string") continue;
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function locationOf(res: Res): string {
  const loc = res.headers["location"];
  return typeof loc === "string" ? loc : "";
}

/** Le compte du realm importé — le fichier que Keycloak charge fait foi. */
function realmUser(): { username: string; password: string; email: string } {
  const realm = JSON.parse(readFileSync(REALM_FILE, "utf8")) as {
    users: Array<{
      username: string;
      email: string;
      credentials: Array<{ type: string; value: string }>;
    }>;
  };
  const u = realm.users[0];
  const password = u?.credentials.find((c) => c.type === "password")?.value;
  if (!u || !password) throw new Error("realm sans utilisateur à mot de passe");
  return { username: u.username, password, email: u.email };
}

/**
 * Joue la page de connexion de Keycloak comme un navigateur : GET de l'URL
 * d'autorisation, lecture du formulaire, POST des identifiants.
 *
 * @returns l'URL de redirection que Keycloak renvoie au client (code + state).
 */
async function loginAtKeycloak(
  authorizationUrl: string,
  jar = new Map<string, string>(),
): Promise<URL> {
  const page = await send({
    url: new URL(authorizationUrl),
    headers: jar.size > 0 ? { cookie: cookieHeader(jar) } : {},
  });
  expect(page.status, "page de connexion Keycloak").toBe(200);
  collectCookies(page, jar);
  const form = /<form\b[^>]*\bid="kc-form-login"[^>]*>/.exec(page.text)?.[0];
  const action = form ? /\baction="([^"]+)"/.exec(form)?.[1] : undefined;
  expect(action, "formulaire de connexion trouvé").toBeTypeOf("string");
  const { username, password } = realmUser();
  const posted = await send({
    url: new URL((action ?? "").replaceAll("&amp;", "&")),
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      username,
      password,
      credentialId: "",
    }).toString(),
  });
  expect(posted.status, "Keycloak renvoie au client (302)").toBe(302);
  // La session SSO de Keycloak naît ici : la garder, c'est ce qui permet de
  // voir une reconnexion SANS mot de passe.
  collectCookies(posted, jar);
  const back = new URL(locationOf(posted));
  expect(back.searchParams.get("code"), "code d'autorisation").toBeTruthy();
  return back;
}

/** Le client du framework, tel que l'application le construit — par découverte. */
function frameworkClient(): Promise<IOAuthProvider> {
  return createDiscoveredOidcProvider(
    "keycloak",
    {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      issuer: ISSUER,
    },
    { fetch: caFetch },
  );
}

/** Code d'autorisation obtenu pour `codeVerifier`, connexion jouée de bout en bout. */
async function codeFor(
  provider: IOAuthProvider,
  codeVerifier: string,
): Promise<string> {
  const url = provider.createAuthorizationURL({
    state: generateState(),
    codeVerifier,
    scopes: provider.defaultScopes,
  });
  const back = await loginAtKeycloak(url.toString());
  return back.searchParams.get("code") ?? "";
}

describe.skipIf(!ISSUER || !CLIENT_ID || !CLIENT_SECRET)(
  "OAuth2 — Keycloak réel (#269)",
  () => {
    it("flux BFF Keycloak : authorize → connexion → callback → session → compte provisionné", async () => {
      const start = await app(`${OAUTH}/authorize`);
      expect(start.status, "authorize redirige vers le realm").toBe(302);
      expect(locationOf(start).startsWith(ISSUER), "vers l'émetteur").toBe(
        true,
      );
      const jar = new Map<string, string>();
      collectCookies(start, jar);

      const back = await loginAtKeycloak(locationOf(start));
      const cb = await app(`${back.pathname}${back.search}`, {
        cookie: cookieHeader(jar),
      });
      expect(cb.status, "callback réussi").toBe(302);
      expect(locationOf(cb), "pas de retour en échec").not.toContain("error");
      collectCookies(cb, jar);

      const me = await app(ME, { cookie: cookieHeader(jar) });
      expect(me.status, "session BFF ouverte").toBe(200);
      const user = (JSON.parse(me.text) as { user?: { username?: string } })
        .user;
      expect(user?.username, "compte provisionné depuis l'ID token").toBe(
        realmUser().email,
      );
    });

    it("le jeton Keycloak de la MÊME personne désigne le MÊME compte que sa session", async () => {
      // Session BFF : le compte local tel que la connexion par navigateur l'a fait.
      const start = await app(`${OAUTH}/authorize`);
      const jar = new Map<string, string>();
      collectCookies(start, jar);
      const back = await loginAtKeycloak(locationOf(start));
      const cb = await app(`${back.pathname}${back.search}`, {
        cookie: cookieHeader(jar),
      });
      collectCookies(cb, jar);
      const me = await app(ME, { cookie: cookieHeader(jar) });
      const sessionUser = (
        JSON.parse(me.text) as { user?: { id?: unknown; username?: string } }
      ).user;
      expect(sessionUser?.id, "session ouverte").toBeDefined();

      // Jeton d'accès de la même personne, obtenu par le client du framework.
      const provider = await frameworkClient();
      const verifier = generateCodeVerifier();
      const tokens = await provider.validateAuthorizationCode({
        code: await codeFor(provider, verifier),
        codeVerifier: verifier,
      });
      const api = await app(API, {
        authorization: `Bearer ${tokens.accessToken()}`,
      });
      expect(api.status, `API ouverte par le jeton (${api.text})`).toBe(200);
      const apiUser = JSON.parse(api.text) as {
        id?: unknown;
        identifier?: string;
      };
      expect(apiUser.identifier, "même identifiant").toBe(
        sessionUser?.username,
      );
      expect(apiUser.id, "même compte local").toBe(sessionUser?.id);
    });

    it("déconnexion : la session Keycloak se ferme aussi, le clic suivant redemande le mot de passe (#517)", async () => {
      const kc = new Map<string, string>(); // cookies du navigateur chez Keycloak
      const jar = new Map<string, string>(); // cookies chez l'application
      const start = await app(`${OAUTH}/authorize`);
      collectCookies(start, jar);
      const back = await loginAtKeycloak(locationOf(start), kc);
      const cb = await app(`${back.pathname}${back.search}`, {
        cookie: cookieHeader(jar),
      });
      collectCookies(cb, jar);
      expect((await app(ME, { cookie: cookieHeader(jar) })).status).toBe(200);

      // Témoin : tant que la session Keycloak vit, un nouvel `authorize`
      // revient au client SANS page de connexion — c'est le défaut à fermer.
      const again = await app(`${OAUTH}/authorize`);
      const silent = await send({
        url: new URL(locationOf(again)),
        headers: { cookie: cookieHeader(kc) },
      });
      expect(silent.status, "témoin : reconnexion sans mot de passe").toBe(302);

      const out = await send({
        url: new URL(`https://localhost:${APP.port}${LOGOUT}`),
        method: "POST",
        headers: { cookie: cookieHeader(jar) },
      });
      expect(out.status, "logout").toBe(200);
      const { logoutUrl } = JSON.parse(out.text) as { logoutUrl?: string };
      expect(logoutUrl, "adresse de déconnexion du realm").toBeTypeOf("string");
      const end = new URL(logoutUrl ?? "");
      expect(end.href.startsWith(ISSUER), "vers l'émetteur").toBe(true);
      expect(end.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect((await app(ME, { cookie: cookieHeader(jar) })).status).toBe(401);

      const left = await send({
        url: end,
        headers: { cookie: cookieHeader(kc) },
      });
      // Sans `id_token_hint` reconnu, Keycloak demanderait une confirmation (200).
      expect(left.status, `aucune page de confirmation (${left.status})`).toBe(
        302,
      );
      expect(
        locationOf(left).startsWith(
          end.searchParams.get("post_logout_redirect_uri") ?? "∅",
        ),
        "retour sur l'application",
      ).toBe(true);
      collectCookies(left, kc);

      const after = await app(`${OAUTH}/authorize`);
      const page = await send({
        url: new URL(locationOf(after)),
        headers: { cookie: cookieHeader(kc) },
      });
      expect(page.status, "le mot de passe est redemandé").toBe(200);
      expect(page.text).toContain('id="kc-form-login"');
    });

    it("code_verifier faux → invalid_grant rendu PAR Keycloak", async () => {
      const provider = await frameworkClient();
      const code = await codeFor(provider, generateCodeVerifier());
      const refused = await provider
        .validateAuthorizationCode({
          code,
          codeVerifier: generateCodeVerifier(),
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(refused, "l'échange doit être refusé").toBeInstanceOf(
        OAuth2RequestError,
      );
      expect((refused as OAuth2RequestError).code).toBe("invalid_grant");
    });
  },
);
