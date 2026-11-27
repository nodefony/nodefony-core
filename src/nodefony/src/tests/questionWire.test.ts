/**
 * Une question qui VOYAGE d'un processus à l'autre (#538, lot 2b-2) : ce que
 * le superviseur accepte de dessiner, et ce qu'il refuse avant d'y toucher.
 */
import { describe, expect, it } from "vitest";
import {
  isWireAnswer,
  isWireQuestion,
  MAX_WIRE_ANSWER,
  MAX_WIRE_ITEMS,
} from "../cli/questionWire";
import { DEV_CHANNEL, isDevChannelMessage } from "../service/dev/devChannel";

const choices = [
  { value: "ROLE_USER", label: "ROLE_USER", checked: true },
  { value: "ROLE_ADMIN", label: "ROLE_ADMIN", disabled: "réservé" },
];

describe("isWireQuestion — la question reçue d'une commande", () => {
  it("accepte les six formes telles que les commandes les posent", () => {
    for (const question of [
      {
        kind: "input",
        key: "name",
        message: "Nom",
        required: true,
        pattern: "^[a-z]+$",
      },
      {
        kind: "secret",
        key: "password",
        message: "Mot de passe",
        note: "8 caractères\nau moins",
      },
      { kind: "confirm", key: "go", message: "On y va ?", default: true },
      {
        kind: "select",
        key: "db",
        message: "Base",
        choices,
        default: "ROLE_USER",
      },
      {
        kind: "checkbox",
        key: "roles",
        message: "Rôles",
        choices,
        required: true,
      },
      {
        kind: "list",
        key: "index",
        message: "Index",
        default: ["a,b"],
        error: "déjà pris",
      },
    ]) {
      expect(isWireQuestion(question), question.kind).to.equal(true);
    }
  });

  it("refuse ce qui repeindrait l'écran, ne compilerait pas ou déborderait", () => {
    const base = { kind: "input", key: "name", message: "Nom" };
    expect(isWireQuestion({ ...base, message: "\u001b[2JNom" })).to.equal(
      false,
    );
    expect(
      isWireQuestion({
        ...base,
        kind: "select",
        choices: [{ value: "a", label: "\u009b31m" }],
      }),
    ).to.equal(false);
    expect(isWireQuestion({ ...base, pattern: "([a-z" })).to.equal(false);
    expect(
      isWireQuestion({ ...base, kind: "secret", default: "en clair" }),
    ).to.equal(false);
    expect(isWireQuestion({ ...base, kind: "prompt" })).to.equal(false);
    expect(isWireQuestion({ ...base, key: "" })).to.equal(false);
    const many = Array.from({ length: MAX_WIRE_ITEMS + 1 }, (_, i) => ({
      value: String(i),
      label: String(i),
    }));
    expect(
      isWireQuestion({ ...base, kind: "checkbox", choices: many }),
    ).to.equal(false);
  });
});

describe("isWireAnswer — la réponse du superviseur", () => {
  it("un texte, un booléen ou une liste de textes, bornés", () => {
    expect(isWireAnswer("alice")).to.equal(true);
    expect(isWireAnswer(false)).to.equal(true);
    expect(isWireAnswer(["a", "b"])).to.equal(true);
    expect(isWireAnswer("x".repeat(MAX_WIRE_ANSWER + 1))).to.equal(false);
    expect(isWireAnswer([1])).to.equal(false);
    expect(isWireAnswer({ value: "a" })).to.equal(false);
  });
});

describe("canal nf-dev — question et réponse", () => {
  it("un message bien formé passe le garde unique ; une forme fausse, non", () => {
    const question = { kind: "confirm", key: "go", message: "On y va ?" };
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "question",
        id: 1,
        question,
      }),
    ).to.equal(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "answer",
        id: 1,
        value: true,
      }),
    ).to.equal(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "answer",
        id: 1,
        value: null,
      }),
    ).to.equal(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "question",
        id: -1,
        question,
      }),
    ).to.equal(false);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "question",
        id: 2,
        question: { ...question, kind: "x" },
      }),
    ).to.equal(false);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "answer",
        id: 3,
        value: { a: 1 },
      }),
    ).to.equal(false);
  });
});
