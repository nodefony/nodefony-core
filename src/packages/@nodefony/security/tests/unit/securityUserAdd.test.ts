import { describe, it, expect, vi } from "vitest";
import SecurityUserAdd from "../../nodefony/command/security-user-add";

/**
 * Ce que cette suite garde : le mot de passe d'un compte neuf est jugé par la
 * politique SUR PLACE (#538) — refusé, la question est reposée. Sans le juge,
 * le refus tombait à `createUser`, après la question des rôles, et la commande
 * s'arrêtait au lieu de redemander.
 *
 * Même patron que `securityUserPassword.test.ts` : la commande est éprouvée par
 * proxy de prototype, la porte des questions remplacée.
 */

/** Le juge que la commande confie à `askSecretTwice` — relevé pour l'éprouver. */
const judges: ((secret: string) => unknown)[] = [];

vi.mock("nodefony", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nodefony")>()),
  askSecretTwice: async (
    _question: unknown,
    _confirm: string,
    options: { answer?: string },
    validate?: (secret: string) => unknown,
  ): Promise<string> => {
    if (validate !== undefined) judges.push(validate);
    return options.answer ?? "";
  },
}));

const makeCommand = (created: string[]): SecurityUserAdd => {
  const users = {
    findByIdentifier: async (): Promise<null> => null,
    passwordViolation: async (
      plain: string,
      identifier?: string,
    ): Promise<string | null> =>
      plain.length < 8 ? `trop court pour ${identifier ?? "?"}` : null,
    createUser: async (input: {
      identifier: string;
    }): Promise<{ id: string; identifier: string }> => {
      created.push(input.identifier);
      return { id: "u-1", identifier: input.identifier };
    },
  };
  const command = Object.create(SecurityUserAdd.prototype) as SecurityUserAdd;
  Object.defineProperty(command, "kernel", {
    value: {
      container: { get: (name: string) => (name === "users" ? users : null) },
    },
    writable: true,
  });
  (command as unknown as { log: (m: string) => void }).log = () => {};
  (
    command as unknown as {
      askArgument: (v: string | undefined) => Promise<string>;
    }
  ).askArgument = async (v: string | undefined) => v ?? "";
  return command;
};

describe("security:user:add — le mot de passe jugé à la saisie", () => {
  it("la politique de l'annuaire juge la saisie SUR PLACE, pour CE compte", async () => {
    judges.length = 0;
    const created: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await makeCommand(created).generate("alice", {
        password: "un-mot-de-passe-long",
        roles: "ROLE_USER",
      });
    } finally {
      write.mockRestore();
    }
    expect(created).toEqual(["alice"]);
    const judge = judges[0];
    expect(judge).toBeTypeOf("function");
    expect(await judge?.("abc")).toBe("trop court pour alice");
    expect(await judge?.("un-mot-de-passe-long")).toBe(null);
  });
});
