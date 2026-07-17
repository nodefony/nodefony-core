import assert from "node:assert/strict";
import type { IPasswordAuthenticatedUser } from "../../index";
import { InMemoryUserRepository } from "../../nodefony/src/InMemoryUserRepository";
import {
  ADMIN_ROLE,
  runUserPaginationContract,
  type UserSeedRow,
} from "../support/userPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose (le seed
// vit dans le banc). Une `Map` unique persiste entre insert/clear du harness.
const store = new InMemoryUserRepository();
runUserPaginationContract({
  users: () => store,
  insert: async (rows: UserSeedRow[]) => {
    for (const row of rows) {
      // `enabled` = champ d'entité hors du contrat credential (le `create`
      // le lit défensivement, comme les backends réels).
      await store.create(row as unknown as Partial<IPasswordAuthenticatedUser>);
    }
  },
  clear: async () => {
    await store.delete({});
  },
});

// Cas spécifiques au store mémoire (hors banc partagé).
describe("InMemoryUserRepository.listPage — cas propres au store mémoire", () => {
  it("limit/offset invalides normalisés (limit ≥ 1, offset ≥ 0)", async () => {
    const repo = new InMemoryUserRepository([
      { id: "u1", identifier: "a@x", roles: [], enabled: true },
    ]);
    const page = await repo.listPage({ limit: 0, offset: -3 });
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 0);
    assert.equal(page.items.length, 1);
  });

  it("countActiveAdmins = 0 si aucun admin", async () => {
    const repo = new InMemoryUserRepository([
      { id: "m1", identifier: "m@x", roles: ["ROLE_USER"], enabled: true },
    ]);
    assert.equal(await repo.countActiveAdmins(ADMIN_ROLE), 0);
  });
});
