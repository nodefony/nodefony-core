import { randomUUID } from "node:crypto";
import { adminLogin, csrfHeaders } from "nodefony/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CHAT_ATTACH_PATH,
  CHAT_FILE_PATH,
  CHAT_REALTIME_PATH,
  ROOM_CHANNEL,
  TYPING_CHANNEL,
  type ChatContract,
  type ChatMessage,
} from "../frontend/src/chat/chatContract";
import {
  closeAll,
  httpUrl,
  openSocket,
  startDemoServer,
  waitFor,
} from "./realtimeHarness";

/**
 * Le salon de bout en bout : des sockets ANONYMES qui écoutent, un compte
 * connecté qui écrit en HTTP — la page fait de même, sa session suit par le
 * cookie.
 *
 * Ce que les tests unitaires ne voient pas : une écriture qui atteint TOUS
 * les abonnés, l'auteur posé par le serveur et non par le client, la garde
 * des écritures, l'idempotence d'un envoi rejoué, et une pièce jointe servie
 * désarmée quoi que prétende son nom. Une ABSENCE (rien n'a été diffusé) se
 * prouve toujours par un message témoin envoyé APRÈS, sur le même fil :
 * jamais par une attente, qu'un runner lent ferait mentir.
 * Lancement : `npm run test:e2e`.
 */

let stop: () => Promise<void> = async () => undefined;
/** Les en-têtes d'une session `admin` : cookie et jeton anti-CSRF. */
let admin: Record<string, string> = {};
beforeAll(async () => {
  stop = await startDemoServer();
  const base = httpUrl("");
  admin = await csrfHeaders(base, await adminLogin(base));
});
afterEach(() => closeAll());
afterAll(async () => {
  await stop();
});

/** Un abonné anonyme du salon, et ce qu'il a reçu. */
async function listener() {
  const socket = await openSocket<ChatContract>(CHAT_REALTIME_PATH, {
    cbor: false,
  });
  const messages: ChatMessage[] = [];
  const typing: string[] = [];
  socket.on(ROOM_CHANNEL, (message) => messages.push(message));
  socket.on(TYPING_CHANNEL, ({ author }) => typing.push(author));
  socket.subscribe(ROOM_CHANNEL);
  socket.subscribe(TYPING_CHANNEL);
  // Le serveur ACQUITTE l'abonnement : sans cette attente, un message envoyé
  // aussitôt partirait avant que l'abonné soit inscrit.
  await Promise.all([
    socket.whenSubscribed(ROOM_CHANNEL),
    socket.whenSubscribed(TYPING_CHANNEL),
  ]);
  return { socket, messages, typing };
}

/** Envoie un message en HTTP, au nom de la session `admin`. */
function send(text: string, key = randomUUID(), extra: object = {}) {
  return fetch(httpUrl("/demo/chat/send"), {
    method: "POST",
    headers: {
      ...admin,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ text, ...extra }),
  });
}

/** Un texte unique : les cas partagent le salon, jamais leurs messages. */
const unique = (label: string) => `${label} ${randomUUID()}`;

describe("discussion — le salon", () => {
  // #region chat-broadcast-e2e
  it("un message écrit atteint TOUS les abonnés, signé par le serveur", async () => {
    const [alice, bob] = [await listener(), await listener()];
    const text = unique("bonjour");
    const res = await send(text);
    expect(res.status).toBe(200);

    const seen = (who: { messages: ChatMessage[] }) =>
      who.messages.find((m) => m.text === text);
    await waitFor(
      "le message chez les deux abonnés",
      () => seen(alice) !== undefined && seen(bob) !== undefined,
    );
    // L'auteur vient de la SESSION, jamais d'un champ du client.
    expect(seen(alice)?.author).toBe("admin");
  });
  // #endregion

  it("le client ne choisit pas l'auteur : un champ en trop est refusé", async () => {
    const res = await send(unique("usurpation"), randomUUID(), {
      author: "quelqu'un d'autre",
    });
    // 422 : le corps est lisible mais refusé par son schéma (`strictObject`).
    expect(res.status).toBe(422);
    await res.body?.cancel();
  });

  it("l'historique rend le message à qui arrive APRÈS", async () => {
    const text = unique("pour plus tard");
    expect((await send(text)).status).toBe(200);
    // Lecture libre, en HTTP : la même action que `socket.get(…)` de la page.
    const res = await fetch(httpUrl("/demo/chat/history?limit=200"));
    expect(res.status).toBe(200);
    const history = (await res.json()) as unknown;
    expect(Array.isArray(history)).toBe(true);
    expect(
      Array.isArray(history) &&
        history.some(
          (m: unknown) =>
            typeof m === "object" &&
            m !== null &&
            "text" in m &&
            m.text === text,
        ),
    ).toBe(true);
  });

  it("écrire exige une session : un anonyme est refusé, et rien n'est diffusé", async () => {
    const intruder = await listener();
    const text = unique("anonyme");
    await expect(
      intruder.socket.post("/demo/chat/send", { text }),
    ).rejects.toThrow();
    // Témoin : quand ce message arrive, celui de l'anonyme l'aurait précédé.
    const witness = unique("témoin");
    await send(witness);
    await waitFor("le témoin", () =>
      intruder.messages.some((m) => m.text === witness),
    );
    expect(intruder.messages.some((m) => m.text === text)).toBe(false);
  });

  it("un envoi rejoué avec la même clé ne publie qu'une fois", async () => {
    const watcher = await listener();
    const text = unique("une seule fois");
    const key = randomUUID();
    const [first, again] = [await send(text, key), await send(text, key)];
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    // La réponse rejouée est celle déjà calculée.
    expect(await again.json()).toEqual(await first.json());

    const witness = unique("témoin");
    await send(witness);
    await waitFor("le témoin", () =>
      watcher.messages.some((m) => m.text === witness),
    );
    expect(watcher.messages.filter((m) => m.text === text)).toHaveLength(1);
  });

  it("le signal de frappe est réservé aux connectés : un anonyme n'est pas diffusé", async () => {
    const [writer, watcher] = [await listener(), await listener()];
    // Le refus revient à l'émetteur (`realtime:denied`) : c'est la preuve
    // que le serveur a TRAITÉ la frappe — une diffusion serait partie avant.
    let denied = false;
    writer.socket.onDenied(() => {
      denied = true;
    });
    writer.socket.emit(TYPING_CHANNEL, {});
    await waitFor("le refus de la frappe anonyme", () => denied);
    const witness = unique("témoin");
    await send(witness);
    await waitFor("le témoin", () =>
      watcher.messages.some((m) => m.text === witness),
    );
    expect(watcher.typing).toEqual([]);
  });
});

describe("discussion — les pièces jointes", () => {
  // #region chat-attachment-e2e
  it("une pièce piégée (du HTML nommé .png) est jugée sur ses octets et servie désarmée", async () => {
    const watcher = await listener();
    const text = unique("pièce");
    const form = new FormData();
    form.append("text", text);
    form.append(
      "file",
      new Blob(["<script>alert('piège')</script>"], { type: "image/png" }),
      "photo.png",
    );
    const res = await fetch(httpUrl(CHAT_ATTACH_PATH), {
      method: "POST",
      headers: { ...admin, "idempotency-key": randomUUID() },
      body: form,
    });
    expect(res.status).toBe(200);

    await waitFor("le message et sa pièce", () =>
      watcher.messages.some((m) => m.text === text),
    );
    const piece = watcher.messages.find((m) => m.text === text)
      ?.attachments?.[0];
    // Le SERVEUR décide de la sorte, d'après le contenu : pas une image.
    expect(piece?.kind).not.toBe("image");

    const file = await fetch(httpUrl(`${CHAT_FILE_PATH}/${piece?.id ?? ""}`));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).not.toMatch(/^image\//u);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/u);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toBe("sandbox");
    await file.body?.cancel();
  });
  // #endregion

  it("un envoi multipart sans clé d'idempotence est refusé (formulaire forgé)", async () => {
    const form = new FormData();
    form.append("text", unique("forgé"));
    const res = await fetch(httpUrl(CHAT_ATTACH_PATH), {
      method: "POST",
      headers: admin,
      body: form,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await res.body?.cancel();
  });
});
