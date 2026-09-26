/// <reference types="node" />
/**
 * Integration — le CYCLE DE VIE COMPLET des briques durables, par leurs VRAIES
 * routes, contre le backend sélectionné au boot.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * 🔴 POURQUOI CE FICHIER EXISTE. La preuve « une application tourne sur ce
 * backend » reposait sur un boot propre et des routes qui répondent — mais
 * trois briques durables n'avaient JAMAIS été écrites par HTTP : le compte de
 * leurs tables restait à zéro après une passe complète, sur Drizzle comme sur
 * MongoDB. Un magasin qu'on n'écrit jamais ne prouve rien du backend.
 *
 * ⚠️ Et la lecture qui précédait ce fichier était fausse : on avait conclu
 * « inatteignable par HTTP » en regardant le data plane d'administration, qui
 * n'expose en effet que des lectures. Les routes d'enrôlement existent, elles
 * vivent ailleurs — `nodefony inspect routes` les nomme. D'où la règle : on ne
 * déduit pas la surface d'une application de ce qu'un module en montre.
 *
 * Ce que ces cas prouvent, et que la création seule ne prouvait pas :
 *  - le cycle ENTIER (créer → relire → modifier → supprimer → constater
 *    l'absence), donc que le store n'est pas qu'un puits en écriture ;
 *  - le LIEN avec l'utilisateur : le second facteur est enrôlé par une session
 *    réelle, et l'administration le retrouve rattaché à CE compte ;
 *  - le refus anonyme, qui dit que les routes sont bien dans la zone protégée.
 *
 * Ils tournent sous les DEUX passes — c'est le même serveur, avec une base
 * différente : `npm run test:all` (Drizzle) et `npm run test:all -- --mongo`.
 */
import { beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import https from "node:https";
import { totpCode, base32Decode } from "@nodefony/security";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const ENROLL = "/nodefony/security/api/totp/enroll";
const CONFIRM = "/nodefony/security/api/totp/confirm";
const DISABLE = "/nodefony/security/api/totp/disable";
const STATUS = "/nodefony/security/api/totp/status";
const TOTP_LIST = "/nodefony/security/api/totp/list";
const WEBHOOKS = "/nodefony/security/api/webhooks";
// Cible des endpoints webhook. Elle n'est JAMAIS jointe par ces cas : on y
// éprouve le MAGASIN (créer, relire, modifier, supprimer), pas la livraison.
// Mais elle traverse le garde anti-SSRF, dont la politique CHANGE avec le
// régime (`nodefony/config/security.ts:194-195`) : l'application de
// développement autorise `http://` et les IP privées pour le récepteur local ;
// en production les deux sont refusés par un 422 — et c'est le comportement
// qu'on veut GARDER, pas contourner. La cible de production est donc une IP
// publique LITTÉRALE : littérale pour n'appeler aucun DNS dans un test,
// publique pour passer la politique stricte (les plages de documentation sont
// elles-mêmes bloquées, `ssrfGuard.ts:22-40`). Rien n'y est jamais envoyé.
const SINK = IS_PROD_TARGET
  ? "https://1.1.1.1/nodefony/test/webhooks/sink"
  : "http://127.0.0.1:5152/nodefony/test/webhooks/sink";
const TIMEOUT = 15_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut / vide */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const get = (p: string, c?: string) =>
  request("GET", p, c ? { cookie: c } : {});
const post = (p: string, c: string | undefined, b?: unknown) =>
  request("POST", p, c ? { cookie: c } : {}, b);
const patch = (p: string, c: string, b: unknown) =>
  request("PATCH", p, { cookie: c }, b);
const del = (p: string, c: string) => request("DELETE", p, { cookie: c });

function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await post(LOGIN, undefined, { username, password });
  expect(
    res.status,
    `login ${username} : ${JSON.stringify(res.body)}`,
  ).to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "le login pose un cookie de session").to.be.a("string");
  return cookie!;
}

/** L'état 2FA du porteur de ce cookie, tel que le serveur le relit. */
async function totpStatus(cookie: string): Promise<{
  enabled?: boolean;
  pending?: boolean;
  recoveryCodesRemaining?: number;
}> {
  const res = await get(STATUS, cookie);
  expect(res.status, JSON.stringify(res.body)).to.equal(200);
  return res.body as { enabled?: boolean };
}

describe("briques durables — le cycle ENTIER par les vraies routes", () => {
  let admin = "";

  beforeAll(async () => {
    admin = await loginAs("admin", "secret-de-dev-42");
  });

  afterAll(async () => {
    // Le décor se rend comme on l'a trouvé : un 2FA laissé actif sur le compte
    // d'administration ferait échouer les passes suivantes au login.
    if (admin) await post(DISABLE, admin);
  });

  describe("2FA — créer, relire, supprimer, constater l'absence", () => {
    it("refuse l'enrôlement anonyme : la route est dans la zone protégée", async () => {
      const res = await post(ENROLL, undefined);
      // 401 attendu ; un 404 dirait que la route n'est pas montée, ce qui
      // rendrait tout le reste de ce fichier vert sans rien exercer.
      expect(res.status, JSON.stringify(res.body)).to.equal(401);
    });

    it("déroule le cycle complet et la relecture suit chaque étape", async () => {
      // ── Départ : aucun second facteur. Sans ce témoin, un compte déjà enrôlé
      //    rendrait la suite verte sans qu'on ait rien écrit.
      const avant = await totpStatus(admin);
      expect(
        avant.enabled,
        "décor sale : le compte porte déjà un 2FA",
      ).to.equal(false);

      // ── CRÉER : le secret n'est rendu qu'une fois.
      const enrolled = await post(ENROLL, admin);
      expect(enrolled.status, JSON.stringify(enrolled.body)).to.equal(200);
      const { secretBase32, otpauthUri } = enrolled.body as {
        secretBase32?: string;
        otpauthUri?: string;
      };
      expect(secretBase32, "secret absent de l'enrôlement").to.be.a("string");
      expect(otpauthUri).to.contain("otpauth://");

      // Tant qu'il n'est pas confirmé, le secret est EN ATTENTE : il ne doit
      // pas compter comme un facteur actif.
      const pending = await totpStatus(admin);
      expect(
        pending.enabled,
        "un secret non confirmé ne doit pas activer",
      ).to.equal(false);

      // ── CONFIRMER : le code se calcule depuis le secret, comme le ferait une
      //    application d'authentification.
      const code = totpCode(base32Decode(secretBase32!));
      const confirmed = await post(CONFIRM, admin, { code });
      expect(confirmed.status, JSON.stringify(confirmed.body)).to.equal(200);
      const { recoveryCodes } = confirmed.body as { recoveryCodes?: string[] };
      expect(recoveryCodes, "codes de récupération absents").to.be.an("array");
      expect(recoveryCodes!.length).to.be.greaterThan(0);

      // ── RELIRE : c'est ici, et seulement ici, que la persistance se prouve.
      const actif = await totpStatus(admin);
      expect(actif.enabled, "secret non relu après écriture").to.equal(true);
      expect(actif.recoveryCodesRemaining).to.equal(recoveryCodes!.length);

      // ── LE LIEN AVEC LE COMPTE : l'administration doit retrouver
      //    l'enrôlement RATTACHÉ à cet utilisateur, pas une ligne orpheline.
      const listed = await get(`${TOTP_LIST}?limit=50`, admin);
      expect(listed.status, JSON.stringify(listed.body)).to.equal(200);
      const items = ((listed.body as { result?: { items?: unknown[] } }).result
        ?.items ??
        (listed.body as { items?: unknown[] }).items ??
        []) as Array<Record<string, unknown>>;
      expect(
        items.length,
        "le journal 2FA est vide après une activation",
      ).to.be.greaterThan(0);
      const mine = items.find((i) => {
        const who = i.userId ?? i.subject ?? i.user ?? "";
        return typeof who === "string" && who.includes("admin");
      });
      expect(
        mine,
        `enrôlement non rattaché au compte : ${JSON.stringify(items.slice(0, 3))}`,
      ).to.not.equal(undefined);

      // ── SUPPRIMER.
      const disabled = await post(DISABLE, admin);
      expect(disabled.status, JSON.stringify(disabled.body)).to.equal(200);

      // ── CONSTATER L'ABSENCE : un store qui ne supprime pas rendrait ce
      //    dernier appel identique au précédent.
      const apres = await totpStatus(admin);
      expect(apres.enabled, "le secret survit à sa suppression").to.equal(
        false,
      );
      expect(apres.recoveryCodesRemaining ?? 0).to.equal(0);
    });

    it("refuse un code faux, sans dire lequel des deux motifs", async () => {
      const enrolled = await post(ENROLL, admin);
      expect(enrolled.status).to.equal(200);
      const res = await post(CONFIRM, admin, { code: "000000" });
      expect(res.status, JSON.stringify(res.body)).to.equal(400);
      // Et l'échec ne laisse RIEN d'actif derrière lui.
      expect((await totpStatus(admin)).enabled).to.equal(false);
      await post(DISABLE, admin);
    });
  });

  describe("webhooks — créer, relire, modifier, supprimer", () => {
    it("déroule le cycle complet sur un endpoint", async () => {
      // ── CRÉER.
      const created = await post(WEBHOOKS, admin, {
        url: SINK,
        events: ["*"],
        description: "banc de cycle de vie",
      });
      expect([200, 201], JSON.stringify(created.body)).to.include(
        created.status,
      );
      const payload = created.body as {
        result?: { endpoint?: { id?: string } };
        endpoint?: { id?: string };
        id?: string;
      };
      const id =
        payload.result?.endpoint?.id ?? payload.endpoint?.id ?? payload.id;
      expect(
        id,
        `identifiant absent : ${JSON.stringify(created.body)}`,
      ).to.be.a("string");

      // ── RELIRE.
      const read = await get(`${WEBHOOKS}/${id}`, admin);
      expect(read.status, JSON.stringify(read.body)).to.equal(200);
      expect(JSON.stringify(read.body)).to.contain(id!);

      // ── MODIFIER, puis relire : une écriture qui ne se relit pas n'est pas
      //    une écriture.
      const renamed = "banc de cycle de vie — modifié";
      const updated = await patch(`${WEBHOOKS}/${id}`, admin, {
        description: renamed,
      });
      expect(updated.status, JSON.stringify(updated.body)).to.equal(200);
      const relu = await get(`${WEBHOOKS}/${id}`, admin);
      expect(JSON.stringify(relu.body)).to.contain(renamed);

      // ── SUPPRIMER, puis constater l'absence.
      const removed = await del(`${WEBHOOKS}/${id}`, admin);
      expect([200, 204], JSON.stringify(removed.body)).to.include(
        removed.status,
      );
      const gone = await get(`${WEBHOOKS}/${id}`, admin);
      expect(
        gone.status,
        `endpoint encore lisible : ${JSON.stringify(gone.body)}`,
      ).to.equal(404);
    });

    it("refuse la création anonyme", async () => {
      const res = await post(WEBHOOKS, undefined, { url: SINK, events: ["*"] });
      expect(res.status, JSON.stringify(res.body)).to.equal(401);
    });
  });
});
