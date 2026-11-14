import { describe, expect, expectTypeOf, it } from "vitest";
import {
  nextTyping,
  type ChatMessage,
} from "../frontend/src/chat/chatContract";
import {
  EditBody,
  MessageParams,
  ReactBody,
  SendBody,
} from "../frontend/src/chat/chatSchemas";
import {
  QUICK_REACTIONS,
  REACTIONS_PER_PERSON_MAX,
  REPLY_EXCERPT_MAX,
  editProblem,
  isReaction,
  liveQuote,
  mergeMessages,
  myReactions,
  reactionSetProblem,
  replyExcerpt,
  replyRefOf,
  retractRight,
  summarizeReactions,
  toggleReaction,
  withReactions,
} from "../frontend/src/chat/messages";
import { LOBBY_ROOM_ID, roomChannel } from "../frontend/src/chat/rooms";
import ChatService from "../nodefony/service/ChatService";
import { RoomRefusal } from "../nodefony/service/RoomService";
import { memoryArchive } from "./memoryArchive";

/** Un message de salon, réduit à ce que le test regarde. */
const msg = (id: string, sentAt: number, extra: Partial<ChatMessage> = {}) => ({
  id,
  author: "admin",
  text: `texte ${id}`,
  sentAt,
  ...extra,
});

describe("chat — une réaction est UN emoji (XEP-0444)", () => {
  it("un graphème qui porte un pictogramme : séquences, drapeaux et touches compris", () => {
    for (const emoji of ["👍", "❤️", "👨‍👩‍👧‍👦", "🇫🇷", "1️⃣", "👍🏽"])
      expect(isReaction(emoji), emoji).toBe(true);
  });

  it("refusés : un mot, une lettre, deux emojis, un espace en tête, le vide", () => {
    for (const value of ["bravo", "a", "👍👍", " 👍", "", "1"])
      expect(isReaction(value), JSON.stringify(value)).toBe(false);
  });

  it("l'ensemble d'une personne : borné, sans doublon, que des emojis", () => {
    expect(reactionSetProblem(["👍", "🎉"])).toBeNull();
    expect(reactionSetProblem([])).toBeNull();
    expect(reactionSetProblem(["👍", "👍"])).toBe("réaction en double");
    expect(reactionSetProblem(["👍", "ok"])).toMatch(/un seul emoji/u);
    const many = QUICK_REACTIONS.map((item) => item.char);
    expect(many).toHaveLength(6);
    expect(
      reactionSetProblem(
        Array.from({ length: REACTIONS_PER_PERSON_MAX + 1 }, (_, i) =>
          String.fromCodePoint(0x1f600 + i),
        ),
      ),
    ).toMatch(/au plus/u);
  });

  it("le schéma rejoue la règle : un mot ne passe pas jusqu'au service", () => {
    expect(ReactBody.safeParse({ emojis: ["👍"] }).success).toBe(true);
    expect(ReactBody.safeParse({ emojis: ["bravo"] }).success).toBe(false);
    expect(ReactBody.safeParse({ emojis: ["👍"], userId: "x" }).success).toBe(
      false,
    );
  });

  it("regroupées par emoji, dans l'ordre d'ARRIVÉE ; chacun reconnaît les siennes à son nom", () => {
    const reactions = summarizeReactions([
      { emoji: "🎉", name: "user" },
      { emoji: "👍", name: "admin" },
      { emoji: "🎉", name: "admin" },
    ]);
    expect(reactions).toEqual([
      { emoji: "🎉", names: ["user", "admin"] },
      { emoji: "👍", names: ["admin"] },
    ]);
    expect(myReactions(reactions, "admin")).toEqual(["🎉", "👍"]);
    expect(myReactions(undefined, "admin")).toEqual([]);
    expect(toggleReaction(["🎉", "👍"], "🎉")).toEqual(["👍"]);
    expect(toggleReaction(["👍"], "🎉")).toEqual(["👍", "🎉"]);
  });
});

describe("chat — la citation d'une réponse (XEP-0461)", () => {
  it("la première ligne PARLANTE : une clôture de bloc ne dit rien", () => {
    expect(replyExcerpt("```js\nfunction hello(name) {\n```")).toBe(
      "function hello(name) {",
    );
    expect(replyExcerpt("$$\n\\frac{a+b}{c^2}\n$$")).toBe("\\frac{a+b}{c^2}");
    expect(replyExcerpt("  un   deux \n trois")).toBe("un deux");
  });

  it("coupée en graphèmes, jamais au milieu d'un emoji", () => {
    const long = "👨‍👩‍👧‍👦".repeat(REPLY_EXCERPT_MAX + 5);
    const excerpt = replyExcerpt(long);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.slice(0, -1)).toBe("👨‍👩‍👧‍👦".repeat(REPLY_EXCERPT_MAX - 1));
  });

  it("un message de pièces seules se cite par leur nombre", () => {
    expect(replyExcerpt("", 2)).toBe("📎 2 pièces jointes");
    expect(replyExcerpt("", 1)).toBe("📎 1 pièce jointe");
    expect(replyExcerpt("")).toBe("");
  });

  it("un message retiré ou disparu n'est jamais cité", () => {
    expect(replyRefOf("m1", msg("m1", 1, { retracted: "author" }))).toEqual({
      id: "m1",
      state: "retracted",
      author: "admin",
      excerpt: "",
    });
    expect(replyRefOf("m9", null).state).toBe("missing");
  });

  it("la citation affichée suit le message cité s'il est dans la page", () => {
    const old = replyRefOf("m1", msg("m1", 1));
    const loaded = new Map([
      ["m1", msg("m1", 1, { text: "corrigé", editedAt: 5 })],
    ]);
    expect(liveQuote(old, loaded).excerpt).toBe("corrigé");
    expect(liveQuote(old, new Map())).toBe(old);
  });

  it("le corps d'envoi accepte une cible, jamais une forme d'adresse", () => {
    expect(SendBody.safeParse({ text: "oui", replyTo: "abc-1" }).success).toBe(
      true,
    );
    expect(
      SendBody.safeParse({ text: "oui", replyTo: "../../x" }).success,
    ).toBe(false);
    expect(
      MessageParams.safeParse({ room: "salon", message: "a:b" }).success,
    ).toBe(false);
  });
});

describe("chat — la page remplace un message par sa version reçue", () => {
  it("modifié ou retiré : remplacé ; neuf : ajouté, dans l'ordre d'envoi", () => {
    const known = [msg("a", 1), msg("b", 2)];
    const merged = mergeMessages(known, [
      msg("b", 2, { text: "corrigé", editedAt: 9 }),
      msg("c", 3),
    ]);
    expect(merged.map((m) => [m.id, m.text])).toEqual([
      ["a", "texte a"],
      ["b", "corrigé"],
      ["c", "texte c"],
    ]);
  });

  it("une relecture EN RETARD ne ressuscite ni un retrait ni un texte corrigé", () => {
    const retracted = msg("a", 1, { text: "", retracted: "moderation" });
    expect(mergeMessages([retracted], [msg("a", 1)])).toEqual([retracted]);
    const fixed = msg("b", 2, { text: "v2", editedAt: 7 });
    expect(
      mergeMessages([fixed], [msg("b", 2, { text: "v1", editedAt: 3 })]),
    ).toEqual([fixed]);
  });

  it("les réactions d'UN message sont remplacées en entier ; vides, elles disparaissent", () => {
    const list = [msg("a", 1), msg("b", 2)];
    const set = withReactions(list, "a", [{ emoji: "👍", names: ["user"] }]);
    expect(set.find((m) => m.id === "a")?.reactions).toEqual([
      { emoji: "👍", names: ["user"] },
    ]);
    expect(set.find((m) => m.id === "b")).toBe(list.find((m) => m.id === "b"));
    expect(
      withReactions(set, "a", []).find((m) => m.id === "a"),
    ).not.toHaveProperty("reactions");
  });

  it("le canal d'un salon garde le type de sa FAMILLE : la page reçoit une RoomFrame typée", () => {
    // Rendu en `string`, le contrat ne typait plus ni `socket.on` ni le hub,
    // et chaque trame se vérifiait à la main — une garde à tenir par trame.
    expectTypeOf(roomChannel("salon")).toEqualTypeOf<`chat:room:${string}`>();
    expect(roomChannel("salon")).toBe("chat:room:salon");
  });

  it("une trame de réactions ne touche pas à « écrit… »", () => {
    expect(
      nextTyping(
        "user",
        { kind: "reactions", messageId: "a", reactions: [] },
        "admin",
      ),
    ).toBe("user");
  });
});

describe("chat — qui modifie, qui retire (XEP-0308, 0424, 0425)", () => {
  it("retirer : l'auteur, sinon le propriétaire ou un modérateur", () => {
    expect(retractRight(true, null)).toBe("author");
    expect(retractRight(true, "owner")).toBe("author");
    expect(retractRight(false, "moderator")).toBe("moderation");
    expect(retractRight(false, "owner")).toBe("moderation");
    expect(retractRight(false, "member")).toBeNull();
    expect(retractRight(false, null)).toBeNull();
  });

  it("modifier : un message sans pièce ne devient pas vide ; même borne que l'envoi", () => {
    expect(editProblem("", false)).toMatch(/se retire/u);
    expect(editProblem("", true)).toBeNull();
    expect(editProblem("ok", false)).toBeNull();
    expect(editProblem("x".repeat(70_000), false)).not.toBeNull();
    expect(EditBody.safeParse({ text: "" }).success).toBe(true);
  });
});

describe("chat — les gestes passent par l'archive, puis le salon", () => {
  const author = { authorId: "u1", author: "admin" };

  it("une réponse à un message d'un AUTRE salon est refusée, et rien n'est archivé", async () => {
    const chat = new ChatService(undefined, undefined, memoryArchive());
    const secret = await chat.publish("equipe", { ...author, text: "secret" });
    await expect(
      chat.publish(LOBBY_ROOM_ID, {
        ...author,
        text: "curieux",
        replyTo: secret.id,
      }),
    ).rejects.toBeInstanceOf(RoomRefusal);
    expect(await chat.recent(LOBBY_ROOM_ID, 10)).toEqual([]);
    const reply = await chat.publish("equipe", {
      ...author,
      text: "oui",
      replyTo: secret.id,
    });
    expect(reply.replyTo).toEqual({
      id: secret.id,
      state: "present",
      author: "admin",
      excerpt: "secret",
    });
  });

  it("modifier : l'auteur seul ; retirer : l'auteur ou la modération, une fois", async () => {
    const roles = new Map([[`${LOBBY_ROOM_ID}:mod`, "moderator" as const]]);
    const chat = new ChatService(undefined, undefined, memoryArchive(roles));
    const sent = await chat.publish(LOBBY_ROOM_ID, { ...author, text: "v1" });
    await expect(
      chat.edit(LOBBY_ROOM_ID, sent.id, "intrus", "v2"),
    ).rejects.toMatchObject({ reason: "forbidden" });
    const edited = await chat.edit(LOBBY_ROOM_ID, sent.id, "u1", "v2");
    expect(edited).toMatchObject({ id: sent.id, text: "v2" });
    expect(typeof edited.editedAt).toBe("number");
    await expect(
      chat.retract(LOBBY_ROOM_ID, sent.id, "intrus"),
    ).rejects.toMatchObject({ reason: "forbidden" });
    const gone = await chat.retract(LOBBY_ROOM_ID, sent.id, "mod");
    expect(gone).toMatchObject({ text: "", retracted: "moderation" });
    await expect(
      chat.retract(LOBBY_ROOM_ID, sent.id, "u1"),
    ).rejects.toMatchObject({ reason: "not-found" });
  });

  it("réagir : l'ensemble d'une personne remplace le sien, l'agrégat compte tout le monde", async () => {
    const chat = new ChatService(undefined, undefined, memoryArchive());
    const sent = await chat.publish(LOBBY_ROOM_ID, { ...author, text: "vote" });
    const user = { id: "u2", name: "user" };
    const admin = { id: "u1", name: "admin" };
    await chat.react(LOBBY_ROOM_ID, sent.id, user, ["👍"]);
    expect(
      await chat.react(LOBBY_ROOM_ID, sent.id, admin, ["👍", "🎉"]),
    ).toEqual([
      { emoji: "👍", names: ["user", "admin"] },
      { emoji: "🎉", names: ["admin"] },
    ]);
    expect(await chat.react(LOBBY_ROOM_ID, sent.id, admin, ["🎉"])).toEqual([
      { emoji: "👍", names: ["user"] },
      { emoji: "🎉", names: ["admin"] },
    ]);
  });
});
