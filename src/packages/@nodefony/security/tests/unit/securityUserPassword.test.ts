import { describe, it, expect } from "vitest";
import SecurityUserPassword from "../../nodefony/command/security-user-password";

/**
 * Ce que cette suite garde : changer un mot de passe COUPE les accès en cours.
 *
 * C'est la moitié du geste qu'on oublie. Changer le hachage suffit à se
 * reconnecter ; il ne suffit PAS à déconnecter celui qui détient déjà une
 * session ou un jeton — or on change un mot de passe précisément parce qu'il
 * est perdu ou compromis. Sans la cascade, la commande rendrait un « ✓ » en
 * laissant la porte ouverte.
 *
 * La commande est éprouvée par PROXY de prototype (même patron que
 * `securityEnforcement` côté framework) : son vrai constructeur exige un
 * `CliKernel` et enregistre la commande dans commander, ce qui n'apprend rien
 * sur le comportement qu'on veut tenir ici.
 */

/** Ce que le faux service `users` a reçu et rendu. */
interface IUsersSpy {
  changePassword: { id: string; plain: string }[];
  found: { id: string; identifier: string } | null;
  throwOnChange?: Error;
}

/** Les événements que la commande a émis sur le bus du kernel. */
interface IFiredEvent {
  name: string;
  payload: unknown;
}

const makeCommand = (
  spy: IUsersSpy,
  fired: IFiredEvent[],
  logs: string[],
): SecurityUserPassword => {
  const users = {
    findByIdentifier: async (): Promise<typeof spy.found> => spy.found,
    changePassword: async (
      id: string,
      plain: string,
    ): Promise<{ id: string } | null> => {
      if (spy.throwOnChange) throw spy.throwOnChange;
      spy.changePassword.push({ id, plain });
      return { id };
    },
  };
  const command = Object.create(
    SecurityUserPassword.prototype,
  ) as SecurityUserPassword;
  Object.defineProperty(command, "kernel", {
    value: {
      container: { get: (name: string) => (name === "users" ? users : null) },
      fire: (name: string, payload: unknown): void => {
        fired.push({ name, payload });
      },
    },
    writable: true,
  });
  // `log` et `askArgument` viennent de `Command` : on les remplace, le décor
  // n'a ni terminal ni syslog.
  (command as unknown as { log: (m: string) => void }).log = (m: string) => {
    logs.push(m);
  };
  (
    command as unknown as {
      askArgument: (v: string | undefined) => Promise<string>;
    }
  ).askArgument = async (v: string | undefined) => v ?? "";
  return command;
};

describe("security:user:password — changer le mot de passe coupe les accès", () => {
  it("vise l'identifiant INTERNE, pas l'identifiant de connexion", async () => {
    const spy: IUsersSpy = {
      changePassword: [],
      found: { id: "u-42", identifier: "bob" },
    };
    const command = makeCommand(spy, [], []);
    await command.generate("bob", { password: "un-mot-de-passe-long" });
    // Deux comptes peuvent porter le même identifiant fonctionnel selon le
    // dépôt ; viser par `id` évite de changer le mot de passe du mauvais.
    expect(spy.changePassword).toEqual([
      { id: "u-42", plain: "un-mot-de-passe-long" },
    ]);
  });

  it("émet la révocation — sessions et jetons tombent", async () => {
    const fired: IFiredEvent[] = [];
    const spy: IUsersSpy = {
      changePassword: [],
      found: { id: "u-42", identifier: "bob" },
    };
    await makeCommand(spy, fired, []).generate("bob", {
      password: "s3cr3t-long",
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.name).toBe("onUserRevoked");
    expect(fired[0]!.payload).toMatchObject({
      id: "u-42",
      identifier: "bob",
      reason: "password_changed",
    });
  });

  it("compte inconnu : rien n'est changé, rien n'est révoqué", async () => {
    const fired: IFiredEvent[] = [];
    const logs: string[] = [];
    const spy: IUsersSpy = { changePassword: [], found: null };
    await makeCommand(spy, fired, logs).generate("fantome", {
      password: "peu-importe",
    });
    expect(spy.changePassword).toHaveLength(0);
    expect(fired).toHaveLength(0);
    // Le message dit où chercher, plutôt que de constater l'absence.
    expect(logs.join("\n")).toContain("security:user:list");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("mot de passe refusé par le service : message, et AUCUNE révocation", async () => {
    const fired: IFiredEvent[] = [];
    const logs: string[] = [];
    const spy: IUsersSpy = {
      changePassword: [],
      found: { id: "u-42", identifier: "bob" },
      throwOnChange: new Error("mot de passe trop commun"),
    };
    await makeCommand(spy, fired, logs).generate("bob", { password: "azerty" });
    // Révoquer alors que le mot de passe n'a PAS changé déconnecterait tout le
    // monde sans rien avoir réparé.
    expect(fired).toHaveLength(0);
    expect(logs.join("\n")).toContain("mot de passe trop commun");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
