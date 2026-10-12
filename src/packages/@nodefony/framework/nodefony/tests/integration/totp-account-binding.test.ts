/**
 * Integration — le second facteur TOTP suit le COMPTE, de bout en bout (#589).
 *
 * Le secret est rangé sous `IUser.identifier` ; le plan d'administration
 * adresse les comptes par `IUser.id`. Deux pannes en découlaient, constatées
 * sur une application générée :
 *  1. la remise à zéro « appareil perdu » par un administrateur répondait
 *     `{ok:true}` sans rien retirer — la personne restait bloquée ;
 *  2. un compte supprimé puis recréé sous le même identifiant héritait du
 *     second facteur de l'ancien titulaire.
 *
 * Le code TOTP est calculé ICI, en Node pur (RFC 6238) : le banc éprouve le
 * protocole, pas notre propre implémentation.
 *
 * Requires: server on 5152 (HTTPS) + users `admin/secret-de-dev-42` (module test).
 */
import { expect } from "vitest";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const HTTPS_BASE = {
  hostname: "localhost",
  port: 5152,
  rejectUnauthorized: false,
};
const USERS = "/nodefony/user/api/users";
// …/framework/nodefony/tests/integration → racine du dépôt (= l'application).
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
);
const BIN = path.join(REPO_ROOT, "src", "nodefony", "bin", "nodefony");
const CLI_TIMEOUT_MS = 120_000;
const SECURITY = "/nodefony/security/api";

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const r = https.request(
      {
        ...HTTPS_BASE,
        method,
        path,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* corps brut */
          }
          resolve({ status: res.statusCode!, headers: res.headers, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Cookie de session d'une réponse de login, ou chaîne vide. */
function sessionCookie(res: Res): string {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return typeof first === "string" ? (first.split(";")[0] ?? "") : "";
}

function login(username: string, password: string): Promise<Res> {
  return req("POST", `${SECURITY}/auth/login`, {}, { username, password });
}

/** Décodage base32 RFC 4648 (alphabet A-Z2-7, sans remplissage). */
function base32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Code TOTP courant — RFC 6238, HMAC-SHA1, 6 chiffres, période 30 s. */
function totp(secretBase32: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", base32(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Lance la vraie CLI de l'application ; rend le code de sortie et les sorties. */
function runCli(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`runCli timeout : ${args.join(" ")}`));
    }, CLI_TIMEOUT_MS);
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

let admin = "";
const auth = (): Record<string, string> => ({ cookie: admin });

// Une sonde PAR test : chacun prouve sa propre affirmation, jamais l'héritage
// laissé par le précédent.
const PROBES = {
  reset: "totp-binding-reset",
  status: "totp-binding-status",
  recreate: "totp-binding-recreate",
  cli: "totp-binding-cli",
  handle: "totp-binding-handle@example.com",
} as const;
const PASSWORD = "totp-binding-secret-1";

/** Id d'un compte sonde, ou `null` s'il n'existe pas. */
async function probeId(probe: string): Promise<string | null> {
  const list = await req(
    "GET",
    `${USERS}?q=${encodeURIComponent(probe)}`,
    auth(),
  );
  const items =
    (list.body as { items?: Array<{ id: string; identifier: string }> })
      .items ?? [];
  return items.find((u) => u.identifier === probe)?.id ?? null;
}

/** Crée un compte sonde, sans rien nettoyer d'autre. */
async function createAccount(probe: string): Promise<string> {
  const created = await req("POST", USERS, auth(), {
    identifier: probe,
    plainPassword: PASSWORD,
    roles: ["ROLE_USER"],
  });
  expect(created.status, "création du compte sonde").to.equal(201);
  return (created.body as { id: string }).id;
}

/**
 * Décor PROPRE : supprime le compte s'il survit à un run interrompu, le recrée,
 * puis retire par l'admin tout secret resté sous cet identifiant — un run sur
 * le code d'avant le correctif laisse des secrets orphelins derrière lui.
 */
async function freshProbe(probe: string): Promise<string> {
  const stale = await probeId(probe);
  if (stale) await req("DELETE", `${USERS}/${stale}`, auth());
  const id = await createAccount(probe);
  await req("POST", `${SECURITY}/users/${id}/totp/disable`, auth());
  return id;
}

/** Enrôle ET confirme le TOTP d'un compte sonde, par le libre-service. */
async function enrollProbe(probe: string): Promise<void> {
  const res = await login(probe, PASSWORD);
  expect(res.status, "login sans second facteur").to.equal(200);
  const cookie = sessionCookie(res);
  const enroll = await req("POST", `${SECURITY}/totp/enroll`, { cookie });
  expect(enroll.status, "enrôlement").to.equal(200);
  const { secretBase32 } = enroll.body as { secretBase32: string };
  const confirm = await req(
    "POST",
    `${SECURITY}/totp/confirm`,
    { cookie },
    { code: totp(secretBase32) },
  );
  expect(confirm.status, "confirmation par un premier code").to.equal(200);
  // Le second facteur est désormais exigé : le mot de passe seul ne suffit plus.
  const challenged = await login(probe, PASSWORD);
  expect(challenged.status, "second facteur exigé").to.equal(202);
}

/** Un compte sonde figure-t-il parmi les enrôlements 2FA ? */
async function enrolled(probe: string): Promise<boolean> {
  const list = await req(
    "GET",
    `${SECURITY}/totp/list?q=${encodeURIComponent(probe)}`,
    auth(),
  );
  expect(list.status).to.equal(200);
  const items = (list.body as { items: Array<{ userId: string }> }).items;
  return items.some((i) => i.userId === probe);
}

beforeAll(async () => {
  admin = sessionCookie(await login("admin", "secret-de-dev-42"));
  if (!admin) {
    throw new Error(
      "login admin a échoué — user admin/secret-de-dev-42 requis (module test)",
    );
  }
});

afterAll(async () => {
  for (const probe of Object.values(PROBES)) {
    const id = await probeId(probe);
    if (id) await req("DELETE", `${USERS}/${id}`, auth());
  }
});

describe("TOTP — le second facteur suit le compte (#589)", () => {
  it("🔴 reset admin « appareil perdu » : le compte se reconnecte au mot de passe seul", async () => {
    const probe = PROBES.reset;
    const id = await freshProbe(probe);
    await enrollProbe(probe);

    const reset = await req(
      "POST",
      `${SECURITY}/users/${id}/totp/disable`,
      auth(),
    );
    expect(reset.status).to.equal(200);

    expect(await enrolled(probe), "secret retiré du store").to.equal(false);
    const res = await login(probe, PASSWORD);
    expect(res.status, "mot de passe seul, plus de défi").to.equal(200);
  });

  it("🔴 l'état 2FA vu par l'admin est celui du compte, pas une clé vide", async () => {
    const probe = PROBES.status;
    const id = await freshProbe(probe);
    await enrollProbe(probe);

    const status = await req("GET", `${SECURITY}/users/${id}/totp`, auth());
    expect(status.status).to.equal(200);
    expect((status.body as { enabled: boolean }).enabled).to.equal(true);
  });

  it("🔴 compte supprimé puis recréé : le nouveau titulaire n'hérite pas du second facteur", async () => {
    const probe = PROBES.recreate;
    const id = await freshProbe(probe);
    await enrollProbe(probe);

    const deleted = await req("DELETE", `${USERS}/${id}`, auth());
    expect(deleted.status).to.equal(200);
    expect(await enrolled(probe), "secret retiré avec le compte").to.equal(
      false,
    );

    // Recréation NUE (pas `freshProbe`) : rien ne doit nettoyer à sa place.
    await createAccount(probe);
    const res = await login(probe, PASSWORD);
    expect(res.status, "nouveau compte : aucun défi hérité").to.equal(200);
  });

  it(
    "🔴 suppression par `security:user:delete` : la commande retire aussi le second facteur",
    { timeout: CLI_TIMEOUT_MS + 30_000 },
    async () => {
      // La commande affichait « sessions et jetons révoqués » sans jamais
      // émettre l'événement ; et un `fire` non attendu laisserait le process
      // finir avant le nettoyage.
      const probe = PROBES.cli;
      await freshProbe(probe);
      await enrollProbe(probe);

      const r = await runCli(["security:user:delete", probe, "--yes"]);
      expect(
        r.code,
        `sortie de la commande\n${r.stdout}\n${r.stderr}`,
      ).to.equal(0);
      expect(await enrolled(probe), "secret retiré avec le compte").to.equal(
        false,
      );

      await createAccount(probe);
      const res = await login(probe, PASSWORD);
      expect(res.status, "nouveau compte : aucun défi hérité").to.equal(200);
    },
  );

  it("🔴 passkey : le userHandle est l'UUID du compte, jamais l'identifiant (WebAuthn L3 §4)", async () => {
    // Le handle est stocké DANS l'authenticator ; la spec le veut opaque et
    // « MUST NOT contain personally identifying information ». L'identifiant
    // de cette sonde est un email, exprès.
    const probe = PROBES.handle;
    const id = await freshProbe(probe);
    const res = await login(probe, PASSWORD);
    expect(res.status).to.equal(200);
    const options = await req("POST", `${SECURITY}/webauthn/register/options`, {
      cookie: sessionCookie(res),
    });
    expect(options.status).to.equal(200);
    const handle = Buffer.from(
      (options.body as { user: { id: string } }).user.id,
      "base64url",
    ).toString("utf8");
    expect(handle, "le handle est l'UUID du compte").to.equal(id);
    expect(handle).not.to.include(probe);
  });
});
