import assert from "node:assert/strict";

import {
  InMemoryUserRepository,
  seedAccount,
  UserService,
  type IPasswordEncoder,
  type SeedLogSeverity,
} from "../../index";

/**
 * Banc du semis de compte au démarrage.
 *
 * Le cas qui a fait naître ce banc : un compte déjà en base, une variable de mot
 * de passe changée dans `.env`, et RIEN qui dise qu'elle est ignorée — on croit
 * avoir changé le mot de passe, la connexion échoue avec le nouveau.
 */

/** Encodeur lisible : le hash rend la valeur d'origine reconnaissable. */
const encoder: IPasswordEncoder = {
  supports: () => true,
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: (plain, hash) => Promise.resolve(hash === `hashed:${plain}`),
  needsRehash: () => false,
};

const ORIGINAL = "cheval-agrafe-batterie-91";
const CHANGED = "lanterne-ruisseau-octobre-57";

/** Un service dont le compte `user` existe déjà, avec {@link ORIGINAL}. */
const withExistingUser = async (): Promise<UserService> => {
  const users = new UserService(new InMemoryUserRepository([]), encoder);
  await users.createUser({
    identifier: "user",
    plainPassword: ORIGINAL,
    roles: ["ROLE_USER"],
  });
  return users;
};

/** Journal capturé. */
const capture = () => {
  const lines: Array<{ message: string; severity: SeedLogSeverity }> = [];
  return {
    lines,
    log: (message: string, severity: SeedLogSeverity) => {
      lines.push({ message, severity });
    },
  };
};

describe("seedAccount — un compte existant n'est jamais réécrit, et ça se dit", () => {
  it("variable POSÉE, compte existant : un NOTICE nomme la variable et le geste", async () => {
    const users = await withExistingUser();
    const { lines, log } = capture();

    const outcome = await seedAccount(
      users,
      {
        identifier: "user",
        roles: ["ROLE_USER"],
        envVar: "NF_USER_PASSWORD",
        envValue: CHANGED,
        fallbackPassword: "inutilise-ici-33",
      },
      log,
    );

    assert.equal(outcome, "exists");
    assert.equal(lines.length, 1, "un seul message par variable");
    const [line] = lines;
    assert.equal(
      line!.severity,
      "NOTICE",
      "le démarrage est sain : pas une erreur",
    );
    assert.match(
      line!.message,
      /NF_USER_PASSWORD/,
      "la variable n'est pas nommée",
    );
    assert.match(line!.message, /"user"/, "le compte n'est pas nommé");
    assert.match(
      line!.message,
      /npx nodefony security:user:password user/,
      "le geste qui change vraiment le mot de passe n'est pas donné",
    );
    assert.doesNotMatch(
      line!.message,
      new RegExp(CHANGED),
      "la valeur de la variable finirait dans le journal",
    );
  });

  it("variable posée : le mot de passe en base est INCHANGÉ", async () => {
    const users = await withExistingUser();
    const before = (await users.findByIdentifier("user"))?.password;

    await seedAccount(
      users,
      {
        identifier: "user",
        roles: ["ROLE_USER"],
        envVar: "NF_USER_PASSWORD",
        envValue: CHANGED,
        fallbackPassword: null,
      },
      capture().log,
    );

    const after = (await users.findByIdentifier("user"))?.password;
    assert.equal(after, before, "le semis a réécrit un compte existant");
    assert.ok(
      await users.authenticate("user", ORIGINAL),
      "l'ancien mot de passe ne passe plus",
    );
    assert.equal(
      await users.authenticate("user", CHANGED),
      null,
      "la variable a écrasé le mot de passe de l'utilisateur",
    );
  });

  it("variable ABSENTE, compte existant : aucun message", async () => {
    const users = await withExistingUser();
    const { lines, log } = capture();

    const outcome = await seedAccount(
      users,
      {
        identifier: "user",
        roles: ["ROLE_USER"],
        envVar: "NF_USER_PASSWORD",
        envValue: undefined,
        fallbackPassword: "defaut-du-code-48",
      },
      log,
    );

    assert.equal(outcome, "exists");
    assert.deepEqual(lines, []);
  });
});

describe("seedAccount — compte absent", () => {
  const fresh = () => new UserService(new InMemoryUserRepository([]), encoder);

  it("crée le compte avec la variable quand elle est posée", async () => {
    const users = fresh();
    const outcome = await seedAccount(
      users,
      {
        identifier: "admin",
        roles: ["ROLE_ADMIN"],
        envVar: "NF_ADMIN_PASSWORD",
        envValue: CHANGED,
        fallbackPassword: ORIGINAL,
      },
      capture().log,
    );
    assert.equal(outcome, "created");
    assert.ok(await users.authenticate("admin", CHANGED));
  });

  it("prend le défaut quand la variable n'est pas posée", async () => {
    const users = fresh();
    await seedAccount(
      users,
      {
        identifier: "admin",
        roles: ["ROLE_ADMIN"],
        envVar: "NF_ADMIN_PASSWORD",
        envValue: undefined,
        fallbackPassword: ORIGINAL,
      },
      capture().log,
    );
    assert.ok(await users.authenticate("admin", ORIGINAL));
  });

  it("ne crée rien sans variable ni défaut (règle de la production)", async () => {
    const users = fresh();
    const { lines, log } = capture();
    const outcome = await seedAccount(
      users,
      {
        identifier: "admin",
        roles: ["ROLE_ADMIN"],
        envVar: "NF_ADMIN_PASSWORD",
        envValue: undefined,
        fallbackPassword: null,
      },
      log,
    );
    assert.equal(outcome, "no-password");
    assert.equal(await users.findByIdentifier("admin"), null);
    assert.deepEqual(lines, [], "le message de ce cas appartient à l'appelant");
  });

  it("un refus de la politique part en ERROR sans lever", async () => {
    const users = fresh();
    const { lines, log } = capture();
    const outcome = await seedAccount(
      users,
      {
        identifier: "admin",
        roles: ["ROLE_ADMIN"],
        envVar: "NF_ADMIN_PASSWORD",
        envValue: "admin",
        fallbackPassword: null,
        admin: true,
      },
      log,
    );
    assert.equal(outcome, "failed");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.severity, "ERROR");
    assert.match(lines[0]!.message, /Corrige NF_ADMIN_PASSWORD/);
    assert.match(lines[0]!.message, /security:user:add admin --admin/);
  });
});
