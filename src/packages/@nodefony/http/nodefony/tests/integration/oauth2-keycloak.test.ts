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
 *     framework ;
 *  4. canal arrière (#517) : Keycloak ferme la session SSO → il appelle
 *     l'application, qui détruit la session ; un jeton forgé est refusé ;
 *  5. rôles (#519) : `bob`, porteur du rôle client `admin`, obtient ROLE_ADMIN
 *     par session ET par jeton ; le rôle retiré dans le realm disparaît au
 *     login suivant ; un rôle donné à la main dans l'application survit.
 */
import { describe, expect, it } from "vitest";
import https from "node:https";
import { isIP } from "node:net";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDiscoveredOidcProvider,
  diagnoseOAuthProvider,
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
          ? {
              ca: readFileSync(CA_FILE),
              // Le SNI refuse une adresse IP (RFC 6066 §3) : Node lève.
              ...(isIP(url.hostname) === 0 ? { servername: url.hostname } : {}),
            }
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

/**
 * Un compte du realm importé — le fichier que Keycloak charge fait foi.
 *
 * @param username - compte voulu ; omis = le premier du fichier.
 */
function realmUser(username?: string): {
  username: string;
  password: string;
  email: string;
} {
  const realm = JSON.parse(readFileSync(REALM_FILE, "utf8")) as {
    users: Array<{
      username: string;
      email: string;
      credentials: Array<{ type: string; value: string }>;
    }>;
  };
  const u =
    username === undefined
      ? realm.users[0]
      : realm.users.find((x) => x.username === username);
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
  who?: string,
): Promise<URL> {
  const page = await send({
    url: new URL(authorizationUrl),
    headers: jar.size > 0 ? { cookie: cookieHeader(jar) } : {},
  });
  expect(
    page.status,
    `page de connexion Keycloak (${page.text.replace(/\s+/g, " ").slice(0, 300)})`,
  ).toBe(200);
  collectCookies(page, jar);
  const form = /<form\b[^>]*\bid="kc-form-login"[^>]*>/.exec(page.text)?.[0];
  const action = form ? /\baction="([^"]+)"/.exec(form)?.[1] : undefined;
  expect(action, "formulaire de connexion trouvé").toBeTypeOf("string");
  const { username, password } = realmUser(who);
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

/** Origine du serveur Keycloak, déduite de l'émetteur (`…/realms/<nom>`). */
const keycloakOrigin = (): string => new URL(ISSUER).origin;
const realmName = (): string => ISSUER.split("/realms/")[1] ?? "";

/**
 * Jeton de l'administrateur de Keycloak — identifiants par DÉFAUT du compose
 * (`KC_BOOTSTRAP_ADMIN_*` de `docker/docker-compose.yml`), ceux du décor.
 */
async function adminToken(): Promise<string> {
  const res = await send({
    url: new URL(
      `${keycloakOrigin()}/realms/master/protocol/openid-connect/token`,
    ),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "nodefony-dev",
    }).toString(),
  });
  expect(res.status, `jeton d'administration (${res.text})`).toBe(200);
  return (JSON.parse(res.text) as { access_token: string }).access_token;
}

/**
 * Keycloak peut-il APPELER l'application ? Constaté depuis le conteneur, par
 * l'adresse que le realm déclare pour le canal arrière.
 *
 * @returns `null` si oui ; sinon la raison, pour l'énoncer.
 */
function keycloakReachesApp(): string | null {
  const realm = JSON.parse(readFileSync(REALM_FILE, "utf8")) as {
    clients: Array<{ clientId: string; attributes?: Record<string, string> }>;
  };
  const target = realm.clients.find((c) => c.clientId === CLIENT_ID)
    ?.attributes?.["backchannel.logout.url"];
  if (target === undefined) return "aucune backchannel.logout.url au realm";
  const { hostname, port } = new URL(target);
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "nodefony-keycloak",
        "bash",
        "-c",
        `exec 3<>/dev/tcp/${hostname}/${port}`,
      ],
      { stdio: "ignore", timeout: 10_000 },
    );
    return null;
  } catch {
    return `le conteneur nodefony-keycloak ne joint pas ${hostname}:${port} (serveur à l'écoute de la seule boucle locale ?)`;
  }
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
  who?: string,
): Promise<string> {
  const url = provider.createAuthorizationURL({
    state: generateState(),
    codeVerifier,
    scopes: provider.defaultScopes,
  });
  const back = await loginAtKeycloak(url.toString(), new Map(), who);
  return back.searchParams.get("code") ?? "";
}

/** Appel à l'API d'administration de Keycloak, jeton d'administrateur joint. */
async function kcAdmin(
  admin: string,
  method: string,
  pathAndQuery: string,
  body?: unknown,
): Promise<Res> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return send({
    url: new URL(
      `${keycloakOrigin()}/admin/realms/${realmName()}${pathAndQuery}`,
    ),
    method,
    headers: {
      authorization: `Bearer ${admin}`,
      // Un DELETE à corps (retrait d'un rôle) reçoit son 204 sans que
      // Keycloak lise le corps : sur une connexion gardée ouverte, ces octets
      // deviennent le début de la requête SUIVANTE, refusée en 400 sans un
      // mot. Connexion fermée après chaque appel d'administration.
      connection: "close",
      ...(payload === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload)),
          }),
    },
    body: payload,
  });
}

/**
 * Met le realm EN SERVICE au niveau du fichier, sans le détruire.
 *
 * Keycloak n'importe un realm qu'à sa CRÉATION : un décor monté avant que le
 * fichier gagne `bob` et le rôle `admin` ne les connaît pas, et `down -v`
 * effacerait ce que le développeur a réglé dans la console. L'import PARTIEL
 * du même fichier ajoute ce qui manque et saute ce qui existe — le fichier
 * reste la seule source.
 */
async function syncRealmFromFile(admin: string): Promise<void> {
  const realm = JSON.parse(readFileSync(REALM_FILE, "utf8")) as Record<
    string,
    unknown
  >;
  const res = await kcAdmin(admin, "POST", "/partialImport", {
    ifResourceExists: "SKIP",
    roles: realm.roles,
    users: realm.users,
  });
  expect(res.status, `import partiel du realm (${res.text})`).toBe(200);
}

/** Donne (`true`) ou retire (`false`) à `username` le rôle client `role`. */
async function setClientRole(
  admin: string,
  username: string,
  role: string,
  granted: boolean,
): Promise<void> {
  const users = await kcAdmin(
    admin,
    "GET",
    `/users?exact=true&username=${encodeURIComponent(username)}`,
  );
  const userId = (JSON.parse(users.text) as { id: string }[])[0]?.id;
  expect(userId, `utilisateur ${username} au realm`).toBeTypeOf("string");
  const clients = await kcAdmin(
    admin,
    "GET",
    `/clients?clientId=${encodeURIComponent(CLIENT_ID)}`,
  );
  const clientUuid = (JSON.parse(clients.text) as { id: string }[])[0]?.id;
  expect(clientUuid, `client ${CLIENT_ID} au realm`).toBeTypeOf("string");
  const roleRes = await kcAdmin(
    admin,
    "GET",
    `/clients/${clientUuid ?? ""}/roles/${encodeURIComponent(role)}`,
  );
  expect(roleRes.status, `rôle client ${role} (${roleRes.text})`).toBe(200);
  const changed = await kcAdmin(
    admin,
    granted ? "POST" : "DELETE",
    `/users/${userId ?? ""}/role-mappings/clients/${clientUuid ?? ""}`,
    [JSON.parse(roleRes.text) as unknown],
  );
  expect(changed.status, `rôle ${granted ? "accordé" : "retiré"}`).toBe(204);
}

/** Connexion complète par navigateur → jarre de cookies de la session BFF. */
async function browserLogin(who: string): Promise<Map<string, string>> {
  const start = await app(`${OAUTH}/authorize`);
  expect(
    locationOf(start).startsWith(ISSUER),
    `authorize → realm (${start.status} ${locationOf(start)})`,
  ).toBe(true);
  const jar = new Map<string, string>();
  collectCookies(start, jar);
  const back = await loginAtKeycloak(locationOf(start), new Map(), who);
  const cb = await app(`${back.pathname}${back.search}`, {
    cookie: cookieHeader(jar),
  });
  expect(locationOf(cb), "callback sans erreur").not.toContain("error");
  collectCookies(cb, jar);
  return jar;
}

/** Identité de la session : id + rôles effectifs. */
async function sessionOf(
  jar: Map<string, string>,
): Promise<{ id: string; roles: string[] }> {
  const me = await app(ME, { cookie: cookieHeader(jar) });
  expect(me.status, "session ouverte").toBe(200);
  const user = (
    JSON.parse(me.text) as { user: { id: string; roles: string[] } }
  ).user;
  return user;
}

/** Rôles que l'API voit pour le jeton d'accès frais de `who`. */
async function apiRolesOf(who: string): Promise<string[]> {
  const provider = await frameworkClient();
  const verifier = generateCodeVerifier();
  const tokens = await provider.validateAuthorizationCode({
    code: await codeFor(provider, verifier, who),
    codeVerifier: verifier,
  });
  const api = await app(API, {
    authorization: `Bearer ${tokens.accessToken()}`,
  });
  expect(api.status, `API ouverte par le jeton (${api.text})`).toBe(200);
  return (JSON.parse(api.text) as { roles: string[] }).roles;
}

/** Remplace les rôles LOCAUX d'un compte, par la console d'administration. */
async function setLocalRoles(userId: string, roles: string[]): Promise<void> {
  const login = await send({
    url: new URL(
      `https://localhost:${APP.port}/nodefony/security/api/auth/login`,
    ),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "secret-de-dev-42" }),
  });
  expect(login.status, `connexion admin de l'application (${login.text})`).toBe(
    200,
  );
  const jar = new Map<string, string>();
  collectCookies(login, jar);
  const patched = await send({
    url: new URL(
      `https://localhost:${APP.port}/nodefony/user/api/users/${encodeURIComponent(userId)}`,
    ),
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({ roles }),
  });
  expect(patched.status, `rôles locaux posés (${patched.text})`).toBe(200);
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

    it("canal arrière : Keycloak ferme la session SSO → la session de l'application meurt (#517)", async (ctx) => {
      // Capacité CONSTATÉE, jamais déduite de la plateforme : Keycloak doit
      // pouvoir APPELER l'application. Un serveur de dev n'écoute que la boucle
      // locale ; sous Linux, le conteneur ne la voit pas (Docker Desktop, si).
      const reach = keycloakReachesApp();
      if (reach !== null) {
        console.warn(`[oauth2-keycloak] canal arrière NON éprouvé : ${reach}`);
        ctx.skip();
        return;
      }
      const jar = new Map<string, string>();
      const start = await app(`${OAUTH}/authorize`);
      collectCookies(start, jar);
      const back = await loginAtKeycloak(locationOf(start));
      const cb = await app(`${back.pathname}${back.search}`, {
        cookie: cookieHeader(jar),
      });
      collectCookies(cb, jar);
      expect((await app(ME, { cookie: cookieHeader(jar) })).status).toBe(200);

      // L'utilisateur est déconnecté CHEZ Keycloak, sans que l'application n'y
      // soit pour rien (console d'administration, autre application du SSO…).
      const admin = await adminToken();
      const { username } = realmUser();
      const found = await send({
        url: new URL(
          `${keycloakOrigin()}/admin/realms/${realmName()}/users?exact=true&username=${encodeURIComponent(username)}`,
        ),
        headers: { authorization: `Bearer ${admin}` },
      });
      const userId = (JSON.parse(found.text) as Array<{ id: string }>)[0]?.id;
      expect(userId, "compte du realm").toBeTypeOf("string");
      const out = await send({
        url: new URL(
          `${keycloakOrigin()}/admin/realms/${realmName()}/users/${userId ?? ""}/logout`,
        ),
        method: "POST",
        headers: { authorization: `Bearer ${admin}` },
      });
      expect(out.status, "déconnexion côté Keycloak").toBe(204);

      // Le jeton de déconnexion arrive par le canal arrière : la session de
      // l'application doit être détruite, sans aucune action du navigateur.
      let status = 0;
      for (let i = 0; i < 50 && status !== 401; i += 1) {
        status = (await app(ME, { cookie: cookieHeader(jar) })).status;
        if (status !== 401) await new Promise((r) => setTimeout(r, 100));
      }
      expect(status, "session de l'application fermée par Keycloak").toBe(401);
    });

    it("canal arrière : un jeton de déconnexion forgé est refusé (400), la session survit", async () => {
      const jar = new Map<string, string>();
      const start = await app(`${OAUTH}/authorize`);
      collectCookies(start, jar);
      const back = await loginAtKeycloak(locationOf(start));
      const cb = await app(`${back.pathname}${back.search}`, {
        cookie: cookieHeader(jar),
      });
      collectCookies(cb, jar);
      // Claims plausibles, signature absente : n'importe qui peut fabriquer ça.
      const part = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const forged = `${part({ alg: "RS256", typ: "logout+jwt" })}.${part({
        iss: ISSUER,
        aud: CLIENT_ID,
        iat: now,
        exp: now + 60,
        jti: `forge-${now}`,
        sub: "x",
        events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      })}.AAAA`;
      const res = await send({
        url: new URL(
          `https://localhost:${APP.port}${OAUTH}/backchannel-logout`,
        ),
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token: forged }).toString(),
      });
      expect(res.status, res.text).toBe(400);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(
        res.headers["set-cookie"],
        "aucune session ouverte",
      ).toBeUndefined();
      expect((await app(ME, { cookie: cookieHeader(jar) })).status).toBe(200);
    });

    it("rôles (#519) : le rôle client `admin` devient ROLE_ADMIN, suit le realm, et un rôle local survit", async () => {
      const admin = await adminToken();
      await syncRealmFromFile(admin);
      // État connu au départ, quel que soit le run précédent.
      await setClientRole(admin, "bob", "admin", true);
      // Dernier état connu du compte local — pour le rendre propre à la fin.
      let bob: { id: string; roles: string[] } | null = null;
      try {
        const first = await sessionOf(await browserLogin("bob"));
        bob = first;
        expect(first.roles, "ROLE_ADMIN par la session").toContain(
          "ROLE_ADMIN",
        );
        expect(await apiRolesOf("bob"), "ROLE_ADMIN par le jeton").toContain(
          "ROLE_ADMIN",
        );

        // Un rôle donné à la main, dans l'application.
        await setLocalRoles(first.id, [...first.roles, "ROLE_DEV"]);

        await setClientRole(admin, "bob", "admin", false);
        const after = await sessionOf(await browserLogin("bob"));
        bob = after;
        expect(after.id, "même compte").toBe(first.id);
        expect(after.roles, "retiré dans le realm → retiré ici").not.toContain(
          "ROLE_ADMIN",
        );
        expect(after.roles, "le rôle local survit").toContain("ROLE_DEV");
        expect(
          await apiRolesOf("bob"),
          "retiré aussi pour le jeton",
        ).not.toContain("ROLE_ADMIN");
      } finally {
        // Le realm et le compte reviennent à l'état du fichier : aucun rôle
        // local ne reste dans la base de développement.
        await setClientRole(admin, "bob", "admin", true);
        if (bob !== null) {
          await setLocalRoles(
            bob.id,
            bob.roles.filter((r) => r !== "ROLE_DEV"),
          );
        }
      }
    });

    it("rôle de plateforme ouvert par `allowPlatformRoles` : `admin-nodefony` → ROLE_NODEFONY_ADMIN, puis retiré", async () => {
      // L'app de dev ÉCRIT l'ouverture (`nodefony/config/security.ts`) ; sans
      // elle, la table refuserait le démarrage. Le rôle est prêté à `bob` le
      // temps du cas : un compte réel (second facteur exigé, rôles choisis)
      // ne doit pas porter le banc.
      const admin = await adminToken();
      await syncRealmFromFile(admin);
      await setClientRole(admin, "bob", "admin-nodefony", true);
      try {
        const bob = await sessionOf(await browserLogin("bob"));
        expect(bob.roles).toContain("ROLE_NODEFONY_ADMIN");
        expect(bob.roles).toContain("ROLE_ADMIN");
      } finally {
        // Retiré du realm, puis du compte local par un login de recalcul.
        await setClientRole(admin, "bob", "admin-nodefony", false);
        const after = await sessionOf(await browserLogin("bob"));
        expect(after.roles).not.toContain("ROLE_NODEFONY_ADMIN");
      }
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

    describe("diagnostic sans connexion (#520) — les verdicts que Keycloak rend VRAIMENT", () => {
      /** Le diagnostic du framework, sur le client du login à un détail près. */
      const diagnose = (
        over: { secret?: string; redirectUri?: string; issuer?: string } = {},
      ) =>
        diagnoseOAuthProvider({
          name: "keycloak",
          clientId: CLIENT_ID,
          redirectUri: over.redirectUri ?? REDIRECT_URI,
          fetch: caFetch,
          build: () =>
            createDiscoveredOidcProvider(
              "keycloak",
              {
                clientId: CLIENT_ID,
                clientSecret: over.secret ?? CLIENT_SECRET,
                redirectUri: over.redirectUri ?? REDIRECT_URI,
                issuer: over.issuer ?? ISSUER,
              },
              { fetch: caFetch },
            ),
        });
      const kindOf = (d: Awaited<ReturnType<typeof diagnose>>, name: string) =>
        d.checks.find((c) => c.name === name);

      it("le branchement du dépôt : trois sondes vertes", async () => {
        const d = await diagnose();
        expect(
          d.checks.map((c) => `${c.name}:${c.status}`),
          JSON.stringify(d.checks),
        ).toEqual(["discovery:ok", "authorization:ok", "token:ok"]);
      });

      it("secret faux → secret-rejected (Keycloak : unauthorized_client en 401)", async () => {
        const d = await diagnose({ secret: "pas-le-bon-secret" });
        expect(kindOf(d, "authorization")?.status).toBe("ok");
        expect(kindOf(d, "token")?.kind).toBe("secret-rejected");
      });

      it("URL de retour non enregistrée → redirect-uri-rejected, le secret reste bon", async () => {
        const d = await diagnose({
          redirectUri:
            "https://inconnue.example/nodefony/security/api/oauth2/keycloak/callback",
        });
        expect(kindOf(d, "authorization")?.kind).toBe("redirect-uri-rejected");
        expect(kindOf(d, "token")?.status).toBe("ok");
      });

      it("émetteur écrit autrement que Keycloak ne l'annonce → issuer-mismatch", async () => {
        // `KC_HOSTNAME` fige l'émetteur sur `localhost` : l'interroger par
        // `127.0.0.1` rend un document qui se déclare d'un autre émetteur.
        const other = ISSUER.replace("//localhost:", "//127.0.0.1:");
        expect(other, "émetteur du décor attendu sur localhost").not.toBe(
          ISSUER,
        );
        const d = await diagnose({ issuer: other });
        expect(
          kindOf(d, "discovery")?.kind,
          kindOf(d, "discovery")?.message,
        ).toBe("issuer-mismatch");
        expect(kindOf(d, "token")?.status).toBe("skipped");
      });
    });
  },
);
