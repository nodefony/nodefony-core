/**
 * La porte unique `ask()` (#538 lot 2b-1) : réponse fournie, terminal, refus
 * qui nomme le drapeau, annulation — et la double saisie d'un secret neuf.
 */
import { describe, it, expect } from "vitest";
import {
  ask,
  askSecretTwice,
  QuestionCancelledError,
  QuestionRefusedError,
} from "../cli/ask";
import type { IQuestion, ISecretQuestion } from "../cli/question";
import { FakeKeyboard, FakeScreen, readScreen, tick } from "./questionTerminal";

const roles: IQuestion = {
  kind: "checkbox",
  key: "roles",
  message: "Rôles",
  choices: [
    { value: "ROLE_USER", label: "Utilisateur" },
    { value: "ROLE_ADMIN", label: "Administrateur" },
  ],
};

function host(): { keyboard: FakeKeyboard; screen: FakeScreen; io: object } {
  const keyboard = new FakeKeyboard();
  const screen = new FakeScreen();
  return { keyboard, screen, io: { input: keyboard, output: screen } };
}

describe("ask — la réponse déjà fournie", () => {
  it("est rendue sans rien demander, terminal ou non", async () => {
    expect(
      await ask(roles, { answer: ["ROLE_ADMIN"], terminal: false }),
    ).toEqual(["ROLE_ADMIN"]);
  });

  it("refusée sans terminal : l'erreur nomme le drapeau et la raison", async () => {
    const error = await ask(roles, {
      answer: ["ROLE_X"],
      terminal: false,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuestionRefusedError);
    expect(String(error)).toContain("choix inconnu : ROLE_X");
    expect(String(error)).toContain("passe --roles <valeur>");
  });

  it("refusée devant un terminal : reposée, son refus affiché", async () => {
    const { keyboard, screen, io } = host();
    const pending = ask(
      { kind: "input", key: "name", message: "Nom", pattern: "^[a-z]+$" },
      { answer: "Bob", terminal: true, ...io },
    );
    await tick();
    expect((await readScreen(screen)).lines.at(-1)).toContain(
      "→ --name : doit satisfaire",
    );
    keyboard.press("bob", "\r");
    expect(await pending).toBe("bob");
  });
});

describe("ask — sans réponse", () => {
  it("sans terminal : refus qui nomme le drapeau, jamais une attente", async () => {
    const error = await ask(roles, { terminal: false }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(QuestionRefusedError);
    expect((error as QuestionRefusedError).flag).toBe("--roles");
    expect(String(error)).toContain("aucun terminal pour le demander");
  });

  it("`prompt: false` (sous --json) refuse même devant un terminal", async () => {
    const error = await ask(roles, { terminal: true, prompt: false }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(QuestionRefusedError);
  });

  it("devant un terminal : demande au pied", async () => {
    const { keyboard, io } = host();
    const pending = ask(roles, { terminal: true, ...io });
    await tick();
    keyboard.press(" ", "\r");
    expect(await pending).toEqual(["ROLE_USER"]);
  });

  it("annulée : QuestionCancelledError, avec la clé", async () => {
    const { keyboard, io } = host();
    const pending = ask(roles, { terminal: true, ...io }).catch(
      (e: unknown) => e,
    );
    await tick();
    keyboard.press("\x03");
    const error = await pending;
    expect(error).toBeInstanceOf(QuestionCancelledError);
    expect((error as QuestionCancelledError).key).toBe("roles");
  });
});

describe("askSecretTwice", () => {
  const password: ISecretQuestion = {
    kind: "secret",
    key: "password",
    message: "Mot de passe",
  };

  it("redemande tant que les deux saisies diffèrent", async () => {
    const { keyboard, screen, io } = host();
    const pending = askSecretTwice(password, "Confirmation", {
      terminal: true,
      ...io,
    });
    await tick();
    keyboard.press("abc", "\r");
    await tick();
    keyboard.press("abd", "\r");
    await tick();
    expect((await readScreen(screen)).lines).toContain(
      "  → les deux saisies diffèrent",
    );
    keyboard.press("abc", "\r");
    await tick();
    keyboard.press("abc", "\r");
    expect(await pending).toBe("abc");
    expect(screen.written.join("")).not.toContain("abc");
  });

  it("fourni par un drapeau : rendu sans confirmation", async () => {
    expect(
      await askSecretTwice(password, "Confirmation", {
        answer: "s3cr3t",
        terminal: false,
      }),
    ).toBe("s3cr3t");
  });
});
