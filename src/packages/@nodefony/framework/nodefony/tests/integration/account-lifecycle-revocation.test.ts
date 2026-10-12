/**
 * Integration — un geste sur le COMPTE coupe ses accès en cours, quel que soit
 * le transport qui le porte (#589).
 *
 * Matrice : transports {reset admin, `me/password`, CLI password, désactivation
 * admin, suppression admin} × effets {session ouverte, clé d'API}. Chaque effet
 * se constate par une requête RÉELLE du porteur (cookie, Bearer), jamais par le
 * `{ok:true}` du transport.
 *
 * Avant l'option (C) — « le service émet, le kernel transporte » — chaque
 * transport réécrivait son émission, et les deux portes HTTP de changement de
 * mot de passe l'avaient oubliée : après un reset admin d'un compte compromis,
 * l'attaquant restait connecté. Le TOTP et les passkeys retirés à la
 * suppression sont éprouvés par `totp-account-binding.test.ts`.
 *
 * Une socket ouverte avant le geste n'est pas rejouée ici : la cascade détruit
 * les sessions (constaté ci-dessous), et une socket dont la session meurt se
 * ferme en 4001 au tick suivant (`REVOCATION_REVALIDATE_MS`, 30 s), constaté
 * par `http/…/oauth2-keycloak.test.ts` ; `invalidBefore` des jetons porteurs
 * par `security/…/realtimeIdentityRevalidation.test.ts`. Le rejouer coûterait
 * 30 s par cas sans rien prouver de neuf.
 *
 * Requires: server on 5152 (HTTPS) + users `admin/secret-de-dev-42` (module test).
 */
import { expect } from "vitest";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const HTTPS_BASE = {
  hostname: "localhost",
  port: 5152,
  rejectUnauthorized: false,
};
const USERS = "/nodefony/user/api/users";
const ME = "/nodefony/user/api/me";
const SECURITY = "/nodefony/security/api";
const KEYS = `${SECURITY}/keys`;
const WHOAMI = "/nodefony/test/m2m/whoami";
// Socket de la console d'administration : identité de session, figée au handshake.
const STUDIO_SOCKET = "/nodefony/studio/api/realtime";
/** Code privé « droits mis à jour, reconnecte-toi » (`IDENTITY_REFRESH_CLOSE_CODE`). */
const IDENTITY_REFRESH = 4005;
// …/framework/nodefony/tests/integration → racine du dépôt (= l'application).
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
);
const BIN = path.join(REPO_ROOT, "src", "nodefony", "bin", "nodefony");
const CLI_TIMEOUT_MS = 120_000;

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

// Une sonde PAR transport : chacun prouve sa propre affirmation.
const PROBES = {
  adminPassword: "lifecycle-admin-password",
  selfPassword: "lifecycle-self-password",
  cliPassword: "lifecycle-cli-password",
  disabled: "lifecycle-disabled",
  locked: "lifecycle-locked",
  demoted: "lifecycle-demoted",
  witness: "lifecycle-witness",
  deleted: "lifecycle-deleted",
} as const;
const PASSWORD = "lifecycle-secret-ancien-1";
const NEW_PASSWORD = "lifecycle-secret-neuf-2";

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

/** Les accès en cours d'un porteur : une session ouverte et une clé d'API. */
interface IAccess {
  id: string;
  cookie: string;
  bearer: string;
}

/**
 * Décor PROPRE : recrée le compte sonde, ouvre une session, émet une clé
 * d'API — et prouve que les deux ouvrent AVANT le geste (sinon un 401 final
 * ne prouverait rien).
 */
async function openAccess(probe: string): Promise<IAccess> {
  const stale = await probeId(probe);
  if (stale) await req("DELETE", `${USERS}/${stale}`, auth());
  const created = await req("POST", USERS, auth(), {
    identifier: probe,
    plainPassword: PASSWORD,
    roles: ["ROLE_USER"],
  });
  expect(created.status, "création du compte sonde").to.equal(201);
  const id = (created.body as { id: string }).id;

  const logged = await login(probe, PASSWORD);
  expect(logged.status, "login de la sonde").to.equal(200);
  const cookie = sessionCookie(logged);
  const key = await req("POST", KEYS, { cookie }, { name: probe });
  expect(key.status, "émission d'une clé d'API").to.equal(201);
  const bearer = (key.body as { token: string }).token;

  expect((await req("GET", ME, { cookie })).status, "session ouverte").to.equal(
    200,
  );
  expect(
    (await req("GET", WHOAMI, { authorization: `Bearer ${bearer}` })).status,
    "clé d'API valide",
  ).to.equal(200);
  return { id, cookie, bearer };
}

/** Constate que la session ET la clé du porteur sont refusées. */
async function expectAccessCut(access: IAccess, what: string): Promise<void> {
  expect(
    (await req("GET", ME, { cookie: access.cookie })).status,
    `${what} : l'ancienne session est refusée`,
  ).to.equal(401);
  expect(
    (await req("GET", WHOAMI, { authorization: `Bearer ${access.bearer}` }))
      .status,
    `${what} : la clé d'API est refusée`,
  ).to.equal(401);
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

describe("Cycle de vie du compte — les accès en cours suivent le geste (#589)", () => {
  it("🔴 reset admin du mot de passe : la session et la clé du compte sont coupées", async () => {
    const access = await openAccess(PROBES.adminPassword);
    const reset = await req("POST", `${USERS}/${access.id}/password`, auth(), {
      plainPassword: NEW_PASSWORD,
    });
    expect(reset.status).to.equal(200);
    await expectAccessCut(access, "reset admin");
    // Le compte, lui, reste actif sous son nouveau mot de passe.
    expect((await login(PROBES.adminPassword, NEW_PASSWORD)).status).to.equal(
      200,
    );
  });

  it("🔴 `me/password` : les AUTRES sessions et les clés du titulaire sont coupées", async () => {
    const access = await openAccess(PROBES.selfPassword);
    // Le titulaire change son mot de passe depuis une AUTRE session : celle de
    // `access` est celle que l'attaquant aurait volée.
    const current = sessionCookie(await login(PROBES.selfPassword, PASSWORD));
    const changed = await req(
      "POST",
      `${ME}/password`,
      { cookie: current },
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    );
    expect(changed.status, JSON.stringify(changed.body)).to.equal(200);
    await expectAccessCut(access, "me/password");
    // Décision : la session courante tombe aussi — le service ne connaît pas
    // le transport, il révoque TOUT (ASVS demande au moins les autres).
    expect(
      (await req("GET", ME, { cookie: current })).status,
      "la session qui a fait le changement est fermée aussi",
    ).to.equal(401);
  });

  it(
    "🔴 `security:user:password` : la session et la clé du compte sont coupées",
    { timeout: CLI_TIMEOUT_MS + 30_000 },
    async () => {
      const access = await openAccess(PROBES.cliPassword);
      const r = await runCli([
        "security:user:password",
        PROBES.cliPassword,
        "--password",
        NEW_PASSWORD,
      ]);
      expect(
        r.code,
        `sortie de la commande\n${r.stdout}\n${r.stderr}`,
      ).to.equal(0);
      await expectAccessCut(access, "CLI password");
    },
  );

  it("🔴 désactivation admin : la session et la clé du compte sont coupées", async () => {
    const access = await openAccess(PROBES.disabled);
    const patched = await req("PATCH", `${USERS}/${access.id}`, auth(), {
      enabled: false,
    });
    expect(patched.status).to.equal(200);
    await expectAccessCut(access, "désactivation");
  });

  it("verrouillage admin : la session et la clé du compte sont coupées", async () => {
    const access = await openAccess(PROBES.locked);
    const patched = await req("PATCH", `${USERS}/${access.id}`, auth(), {
      locked: true,
    });
    expect(patched.status).to.equal(200);
    await expectAccessCut(access, "verrouillage");
  });

  it("🔴 suppression admin : la session et la clé du compte sont coupées", async () => {
    const access = await openAccess(PROBES.deleted);
    const deleted = await req("DELETE", `${USERS}/${access.id}`, auth());
    expect(deleted.status).to.equal(200);
    await expectAccessCut(access, "suppression");
  });
});

/** Une socket de Studio ouverte : attend l'accueil, expose sa fermeture. */
interface ISocketProbe {
  closed: Promise<number>;
  isOpen: () => boolean;
  close: () => void;
}

function openStudioSocket(cookie: string): Promise<ISocketProbe> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://localhost:5152${STUDIO_SOCKET}`, {
      rejectUnauthorized: false,
      headers: { cookie, origin: "https://localhost:5152" },
    });
    let welcomed = false;
    const closed = new Promise<number>((done) => {
      ws.once("close", (code: number) => done(code));
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("accueil de la socket : rien après 10 s"));
    }, 10_000);
    ws.on("error", (e) => {
      clearTimeout(timer);
      if (!welcomed) reject(e);
    });
    void closed.then((code) => {
      clearTimeout(timer);
      if (!welcomed) reject(new Error(`fermée avant l'accueil (code ${code})`));
    });
    ws.on("message", (data: Buffer) => {
      if (welcomed) return;
      const frame = JSON.parse(String(data)) as { method?: unknown };
      if (frame.method !== "realtime:welcome") return;
      welcomed = true;
      clearTimeout(timer);
      resolve({
        closed,
        isOpen: () => ws.readyState === WebSocket.OPEN,
        close: () => ws.close(),
      });
    });
  });
}

/** `p`, ou un rejet qui nomme ce qui n'est pas arrivé dans les `ms` impartis. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () => fail(new Error(`${what} : rien après ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

describe("Rôles retirés — la socket qui les a figés se reconnecte à jour (#591)", () => {
  /** Compte sonde administrateur, connecté : rend son id et son cookie. */
  async function adminProbe(
    probe: string,
  ): Promise<{ id: string; cookie: string }> {
    const stale = await probeId(probe);
    if (stale) await req("DELETE", `${USERS}/${stale}`, auth());
    const created = await req("POST", USERS, auth(), {
      identifier: probe,
      plainPassword: PASSWORD,
      roles: ["ROLE_USER", "ROLE_NODEFONY_ADMIN"],
    });
    expect(created.status, "création du compte sonde").to.equal(201);
    const logged = await login(probe, PASSWORD);
    expect(logged.status, "login de la sonde").to.equal(200);
    return {
      id: (created.body as { id: string }).id,
      cookie: sessionCookie(logged),
    };
  }

  it("🔴 l'admin retire un rôle → la socket du compte se ferme en 4005 SANS attendre le tick ; celle d'un autre survit", async () => {
    const demoted = await adminProbe(PROBES.demoted);
    const witness = await adminProbe(PROBES.witness);
    const doomed = await openStudioSocket(demoted.cookie);
    const kept = await openStudioSocket(witness.cookie);
    try {
      const patched = await req("PATCH", `${USERS}/${demoted.id}`, auth(), {
        roles: ["ROLE_USER"],
      });
      expect(patched.status).to.equal(200);
      // Bien en deçà du tick de revalidation (30 s) : c'est l'événement qui
      // ferme, pas le minuteur.
      const code = await within(doomed.closed, 5_000, "fermeture de la socket");
      expect(code, "reconnectable, pas 4001").to.equal(IDENTITY_REFRESH);
      expect(kept.isOpen(), "la socket d'un autre compte survit").to.equal(
        true,
      );
    } finally {
      doomed.close();
      kept.close();
    }
  });
});
