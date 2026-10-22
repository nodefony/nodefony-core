import assert from "node:assert/strict";
import { Container, Event, ROLES_WITHIN } from "nodefony";
import type { IRolesWithin, Module } from "nodefony";
import type { IUser, IUserProvider } from "@nodefony/user";
import { Firewall } from "../../nodefony/service/firewall";
import { RoleHierarchyWalker } from "../../nodefony/src/RoleHierarchyWalker";
import { rolesWithin } from "../../nodefony/src/rolesWithin";

/**
 * `rolesWithin` — la règle « jouer un autre compte », unique, posée par le
 * pare-feu sous `ROLES_WITHIN` et lue par toute porte qui joue un compte
 * (outil MCP `nodefony_profile_route`, paramètre `as`).
 *
 * ⭐ **Ce que ce banc empêche, c'est la montée en droits par procuration** :
 * un compte qui en joue un autre aux rôles plus larges agirait avec des droits
 * qu'il n'a pas. Tout doute — annuaire absent, compte introuvable, lecture qui
 * échoue — se solde par un refus.
 */

const HIERARCHY = { ROLE_ADMIN: ["ROLE_USER"] };

const ACCOUNTS: Record<string, { roles: string[] }> = {
  admin: { roles: ["ROLE_ADMIN"] },
  alice: { roles: ["ROLE_USER"] },
  bob: { roles: ["ROLE_USER"] },
};

/** Annuaire factice : lève sur un compte inconnu, comme `UserService`. */
function directory(
  load: (id: string) => Promise<unknown> = async (id) => {
    const user = ACCOUNTS[id];
    if (!user) throw new Error("introuvable");
    return user;
  },
): IUserProvider {
  return {
    loadUserByIdentifier: load as (id: string) => Promise<IUser>,
  } as unknown as IUserProvider;
}

function rule(users: IUserProvider | null = directory()): IRolesWithin {
  return rolesWithin(() => users, new RoleHierarchyWalker(HIERARCHY));
}

describe("rolesWithin — jouer un compte ne monte jamais en droits", () => {
  it("contrôle positif : un admin joue un utilisateur (hiérarchie comprise)", async () => {
    assert.deepEqual(await rule()("admin", "alice"), { ok: true });
  });

  it("à rôles égaux, accordé", async () => {
    assert.deepEqual(await rule()("alice", "bob"), { ok: true });
  });

  it("🔴 un utilisateur ne joue pas un admin : les rôles en trop sont nommés", async () => {
    assert.deepEqual(await rule()("alice", "admin"), {
      ok: false,
      reason: "`admin` a des rôles que `alice` n'a pas : ROLE_ADMIN",
    });
  });

  it("🔴 compte visé introuvable → refus, qu'il lève ou rende null", async () => {
    assert.deepEqual(await rule()("alice", "ghost"), {
      ok: false,
      reason: "compte `ghost` introuvable",
    });
    // Un fournisseur qui rend `null` au lieu de lever : sans garde, le compte
    // visé aurait zéro rôle — donc « inclus » — et l'accord tomberait.
    const lenient = directory(async (id) => ACCOUNTS[id] ?? null);
    assert.equal((await rule(lenient)("alice", "ghost")).ok, false);
  });

  it("🔴 propriétaire sans compte local (sujet externe éphémère) → refus qui le dit", async () => {
    const verdict = await rule()("https://idp.example#42", "alice");
    assert.equal(verdict.ok, false);
    assert.match(
      verdict.ok ? "" : verdict.reason,
      /n'a pas de compte dans l'annuaire.*éphémère/,
    );
  });

  it("fail-closed : annuaire absent", async () => {
    assert.equal((await rule(null)("admin", "alice")).ok, false);
  });
});

describe("Firewall — pose la règle au conteneur", () => {
  it("ROLES_WITHIN lit la hiérarchie de la config et l'annuaire `users` posé APRÈS", async () => {
    const container = new Container();
    const bootCbs: Array<() => void> = [];
    container.set("kernel", {
      container,
      once(ev: string, cb: () => void) {
        if (ev === "onBoot") bootCbs.push(cb);
      },
    });
    const firewall = new Firewall({
      container,
      notificationsCenter: new Event(),
      options: { roleHierarchy: HIERARCHY },
    } as unknown as Module);
    container.set("firewall", firewall);
    bootCbs.forEach((cb) => cb());

    const posed = container.get<IRolesWithin>(ROLES_WITHIN);
    assert.equal(typeof posed, "function");
    // L'annuaire n'existe pas encore : refus, pas de crash.
    assert.equal((await (posed as IRolesWithin)("admin", "alice")).ok, false);
    container.set("users", directory());
    assert.deepEqual(await (posed as IRolesWithin)("admin", "alice"), {
      ok: true,
    });
    assert.equal((await (posed as IRolesWithin)("alice", "admin")).ok, false);
  });
});
