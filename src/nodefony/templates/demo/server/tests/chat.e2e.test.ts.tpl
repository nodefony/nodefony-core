import { randomUUID } from "node:crypto";
import { adminLogin, csrfHeaders } from "nodefony/testing";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  CHAT_ATTACH_PATH,
  CHAT_FILE_PATH,
  CHAT_REALTIME_PATH,
  MESSAGE_MAX_BYTES,
  isRoomFrame,
  type ChatContract,
  type ChatMessage,
} from "../frontend/src/chat/chatContract";
import {
  LOBBY_ROOM_ID,
  roomChannel,
  type IRoomView,
} from "../frontend/src/chat/rooms";
import {
  closeAll,
  demoDescribe,
  httpUrl,
  openSocket,
  startDemoServer,
  waitFor,
} from "./realtimeHarness";

/**
 * Les salons de bout en bout : des sockets ANONYMES qui écoutent, un compte
 * connecté qui écrit en HTTP — la page fait de même, sa session suit par le
 * cookie.
 *
 * Ce que les tests unitaires ne voient pas : une écriture qui atteint TOUS
 * les abonnés d'un salon, l'auteur posé par le serveur, la garde d'un salon
 * privé (la MÊME règle sur la socket et sur les routes), la frappe qui ne
 * quitte pas son salon, la présence, l'idempotence d'un envoi rejoué, et une
 * pièce jointe servie désarmée quoi que prétende son nom. Une ABSENCE (rien
 * n'a été diffusé) se prouve toujours par un message témoin envoyé APRÈS, sur
 * le même fil : jamais par une attente, qu'un runner lent ferait mentir.
 * Lancement : `npm run test:e2e`.
 */

/** Le salon privé que la démo sème : membre = `admin`, événement en cours. */
const TEAM_ROOM_ID = "equipe";

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

/** Un abonné anonyme d'un salon, et ce qu'il a reçu. */
async function listener(roomId = LOBBY_ROOM_ID) {
  const socket = await openSocket<ChatContract>(CHAT_REALTIME_PATH, {
    cbor: false,
  });
  const channel = roomChannel(roomId);
  const messages: ChatMessage[] = [];
  const typing: string[] = [];
  socket.on(channel, (frame) => {
    if (!isRoomFrame(frame)) return;
    if (frame.kind === "message") messages.push(frame.message);
    else typing.push(frame.author);
  });
  socket.subscribe(channel);
  // Le serveur ACQUITTE l'abonnement : sans cette attente, un message envoyé
  // aussitôt partirait avant que l'abonné soit inscrit.
  await socket.whenSubscribed(channel);
  return { socket, messages, typing };
}

/** Une route d'un salon. */
const roomPath = (roomId: string, tail: string) =>
  httpUrl(`/demo/chat/rooms/${roomId}/${tail}`);

/** Envoie un message en HTTP, au nom de la session `admin`. */
function send(
  text: string,
  key = randomUUID(),
  extra: object = {},
  roomId = LOBBY_ROOM_ID,
) {
  return fetch(roomPath(roomId, "send"), {
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

demoDescribe("discussion — le salon public", () => {
  // #region chat-broadcast-e2e
  it("un message écrit atteint TOUS les abonnés du salon, signé par le serveur", async () => {
    const [alice, bob] = [await listener(), await listener()];
    const text = unique("bonjour");
    const res = await send(text);
    expect(res.status).toBe(200);
    const sent: unknown = await res.json();
    const id =
      typeof sent === "object" && sent !== null
        ? Reflect.get(sent, "id")
        : null;

    const seen = (who: { messages: ChatMessage[] }) =>
      who.messages.find((m) => m.text === text);
    await waitFor(
      "le message chez les deux abonnés",
      () => seen(alice) !== undefined && seen(bob) !== undefined,
    );
    // L'auteur vient de la SESSION, jamais d'un champ du client.
    expect(seen(alice)?.author).toBe("admin");
    // L'`id` stable tiré par la base : le MÊME pour l'écrivain et les abonnés.
    expect(typeof id).toBe("string");
    expect(seen(alice)?.id).toBe(id);
    expect(seen(bob)?.id).toBe(id);
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

  it("l'historique rend le message à qui arrive APRÈS, lu en base sous le même id", async () => {
    const text = unique("pour plus tard");
    const res0 = await send(text);
    expect(res0.status).toBe(200);
    const sent: unknown = await res0.json();
    const id =
      typeof sent === "object" && sent !== null
        ? Reflect.get(sent, "id")
        : null;
    // Lecture libre, en HTTP : la même action que `socket.get(…)` de la page.
    const res = await fetch(roomPath(LOBBY_ROOM_ID, "history?limit=200"));
    expect(res.status).toBe(200);
    const history: unknown = await res.json();
    const found = Array.isArray(history)
      ? history.find(
          (m: unknown) =>
            typeof m === "object" &&
            m !== null &&
            Reflect.get(m, "text") === text,
        )
      : undefined;
    expect(found).toBeDefined();
    expect(Reflect.get(found ?? {}, "id")).toBe(id);
  });

  it("un message de 64 Kio passe ; un octet de plus est refusé, rien n'est diffusé", async () => {
    const watcher = await listener();
    const full = unique("x").padEnd(MESSAGE_MAX_BYTES, "a");
    expect((await send(full)).status).toBe(200);
    const over = await send(`${full}a`);
    expect(over.status).toBe(422);
    await over.body?.cancel();
    const witness = unique("témoin");
    await send(witness);
    await waitFor("le témoin", () =>
      watcher.messages.some((m) => m.text === witness),
    );
    expect(watcher.messages.some((m) => m.text === full)).toBe(true);
    expect(watcher.messages.some((m) => m.text === `${full}a`)).toBe(false);
  });

  it("écrire exige une session : un anonyme est refusé, et rien n'est diffusé", async () => {
    const intruder = await listener();
    const text = unique("anonyme");
    await expect(
      intruder.socket.post(
        "/demo/chat/rooms/{room}/send",
        { text },
        { params: { room: LOBBY_ROOM_ID } },
      ),
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

  it("la frappe d'un connecté atteint le salon ; celle d'un anonyme est refusée", async () => {
    const watcher = await listener();
    const anonymous = await fetch(roomPath(LOBBY_ROOM_ID, "typing"), {
      method: "POST",
    });
    expect(anonymous.status).toBe(403);
    await anonymous.body?.cancel();
    const res = await fetch(roomPath(LOBBY_ROOM_ID, "typing"), {
      method: "POST",
      headers: admin,
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    await waitFor("la frappe d'admin", () => watcher.typing.includes("admin"));
    expect(watcher.typing).toEqual(["admin"]);
  });

  it("la présence compte l'anonyme sans le nommer", async () => {
    // L'écoute AVANT la demande, comme une page : la liste suit l'acquittement
    // de près, et quand les deux trames arrivent dans le même paquet, un
    // écouteur posé après `whenSubscribed` l'a déjà manquée — et un second
    // `subscribe` ne repart pas au serveur (ref-compté). Le test qui faisait
    // ainsi ne passait que si un départ voisin venait le réveiller.
    const socket = await openSocket<ChatContract>(CHAT_REALTIME_PATH, {
      cbor: false,
    });
    const channel = roomChannel(LOBBY_ROOM_ID);
    const seen: { count: number; unnamed: number }[] = [];
    socket.onPresence(channel, (view) => {
      if (view.ready) seen.push({ count: view.count, unnamed: view.unnamed });
    });
    socket.subscribe(channel);
    await waitFor("une vue de présence", () => seen.length > 0);
    expect(seen.at(-1)?.unnamed).toBeGreaterThanOrEqual(1);
  });

  it("l'annuaire ne nomme jamais un compte absent du salon", async () => {
    const res = await fetch(
      roomPath(LOBBY_ROOM_ID, `people?ids=${randomUUID()},${randomUUID()}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

demoDescribe("discussion — le salon privé", () => {
  it("un anonyme voit la liste publique, pas le salon privé ; son membre le voit, avec l'événement en cours", async () => {
    const anonymous: IRoomView[] = await (
      await fetch(httpUrl("/demo/chat/rooms"))
    ).json();
    expect(anonymous.some((room) => room.id === LOBBY_ROOM_ID)).toBe(true);
    expect(anonymous.some((room) => room.id === TEAM_ROOM_ID)).toBe(false);

    const mine: IRoomView[] = await (
      await fetch(httpUrl("/demo/chat/rooms"), { headers: admin })
    ).json();
    const team = mine.find((room) => room.id === TEAM_ROOM_ID);
    expect(team?.role).toBe("owner");
    expect(team?.event?.title).toBe("Point d'équipe");
  });

  it("la socket refuse le salon privé à un anonyme", async () => {
    const socket = await openSocket<ChatContract>(CHAT_REALTIME_PATH, {
      cbor: false,
    });
    const refused: string[] = [];
    socket.onDenied((denied) => {
      if (denied.channel === roomChannel(TEAM_ROOM_ID))
        refused.push(denied.reason);
    });
    socket.subscribe(roomChannel(TEAM_ROOM_ID));
    await waitFor("le refus du salon privé", () => refused.length > 0);
    expect(refused).toEqual(["forbidden"]);
  });

  it("les routes appliquent la MÊME règle : 403 à l'anonyme, 200 au membre, 404 au salon inconnu", async () => {
    const outsider = await fetch(roomPath(TEAM_ROOM_ID, "history"));
    expect(outsider.status).toBe(403);
    await outsider.body?.cancel();
    const member = await fetch(roomPath(TEAM_ROOM_ID, "history"), {
      headers: admin,
    });
    expect(member.status).toBe(200);
    await member.body?.cancel();
    const nowhere = await fetch(roomPath("inexistant", "history"));
    expect(nowhere.status).toBe(404);
    await nowhere.body?.cancel();
  });

  it("un message du salon privé ne fuit pas dans le salon public", async () => {
    const lobby = await listener();
    const secret = unique("secret");
    expect((await send(secret, randomUUID(), {}, TEAM_ROOM_ID)).status).toBe(
      200,
    );
    const witness = unique("témoin");
    await send(witness);
    await waitFor("le témoin", () =>
      lobby.messages.some((m) => m.text === witness),
    );
    expect(lobby.messages.some((m) => m.text === secret)).toBe(false);
  });
});

demoDescribe("discussion — les pièces jointes", () => {
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
    const res = await fetch(
      httpUrl(CHAT_ATTACH_PATH.replace("{room}", LOBBY_ROOM_ID)),
      {
        method: "POST",
        headers: { ...admin, "idempotency-key": randomUUID() },
        body: form,
      },
    );
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
    const res = await fetch(
      httpUrl(CHAT_ATTACH_PATH.replace("{room}", LOBBY_ROOM_ID)),
      { method: "POST", headers: admin, body: form },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    await res.body?.cancel();
  });
});
