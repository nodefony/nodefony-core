import { expect } from "chai";
import {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  RoleSet,
  RoleRegistry,
  ROLE_MASK_CAPACITY,
} from "../client/roles/index";

const DEV = "ROLE_DEV";
const SUP = "ROLE_SUPERVISOR";
const ADMIN = "ROLE_NODEFONY_ADMIN";

describe("roles — helpers chaînes", () => {
  it("hasRole", () => {
    expect(hasRole([DEV, SUP], DEV)).to.equal(true);
    expect(hasRole([DEV], SUP)).to.equal(false);
    expect(hasRole(null, DEV)).to.equal(false);
    expect(hasRole(undefined, DEV)).to.equal(false);
  });

  it("hasAnyRole (OR)", () => {
    expect(hasAnyRole([DEV], [DEV, SUP])).to.equal(true);
    expect(hasAnyRole([ADMIN], [DEV, SUP])).to.equal(false);
    expect(hasAnyRole([DEV], [])).to.equal(false); // aucune exigence satisfiable
    expect(hasAnyRole(null, [DEV])).to.equal(false);
  });

  it("hasAllRoles (AND)", () => {
    expect(hasAllRoles([DEV, SUP], [DEV, SUP])).to.equal(true);
    expect(hasAllRoles([DEV], [DEV, SUP])).to.equal(false);
    expect(hasAllRoles([DEV], [])).to.equal(true); // convention every([])
    expect(hasAllRoles(null, [])).to.equal(true);
    expect(hasAllRoles(null, [DEV])).to.equal(false);
  });
});

describe("roles — RoleSet (O(1) répété)", () => {
  it("has / hasAny / hasAll", () => {
    const set = new RoleSet([DEV, SUP, DEV]); // doublon dédupliqué
    expect(set.size).to.equal(2);
    expect(set.has(DEV)).to.equal(true);
    expect(set.has(ADMIN)).to.equal(false);
    expect(set.hasAny([ADMIN, SUP])).to.equal(true);
    expect(set.hasAll([DEV, SUP])).to.equal(true);
    expect(set.hasAll([DEV, ADMIN])).to.equal(false);
  });

  it("toArray trié", () => {
    expect(new RoleSet([SUP, DEV]).toArray()).to.deep.equal([DEV, SUP]);
  });

  it("constructeur null/vide", () => {
    expect(new RoleSet(null).size).to.equal(0);
    expect(new RoleSet().size).to.equal(0);
  });
});

describe("roles — RoleRegistry (bitmask)", () => {
  it("define assigne des bits distincts (puissances de 2)", () => {
    const reg = new RoleRegistry().define(DEV, SUP, ADMIN);
    expect(reg.bit(DEV)).to.equal(1);
    expect(reg.bit(SUP)).to.equal(2);
    expect(reg.bit(ADMIN)).to.equal(4);
    expect(reg.bit("ROLE_UNKNOWN")).to.equal(0);
  });

  it("define idempotent", () => {
    const reg = new RoleRegistry().define(DEV);
    const bit = reg.bit(DEV);
    reg.define(DEV, SUP);
    expect(reg.bit(DEV)).to.equal(bit); // inchangé
    expect(reg.bit(SUP)).to.equal(2);
  });

  it("mask / roles round-trip", () => {
    const reg = new RoleRegistry().define(DEV, SUP, ADMIN);
    const m = reg.mask([DEV, ADMIN]);
    expect(m).to.equal(1 | 4);
    expect(reg.roles(m).sort()).to.deep.equal([ADMIN, DEV].sort());
    expect(reg.mask(["ROLE_UNKNOWN"])).to.equal(0); // inconnu ignoré
  });

  it("hasAny / hasAll sur masques", () => {
    const reg = new RoleRegistry().define(DEV, SUP, ADMIN);
    const user = reg.mask([DEV]);
    expect(RoleRegistry.hasAny(user, reg.mask([DEV, SUP]))).to.equal(true);
    expect(RoleRegistry.hasAny(user, reg.mask([SUP, ADMIN]))).to.equal(false);
    expect(RoleRegistry.hasAll(reg.mask([DEV, SUP]), reg.mask([DEV, SUP]))).to.equal(true);
    expect(RoleRegistry.hasAll(user, reg.mask([DEV, SUP]))).to.equal(false);
  });

  it("capacité 32 bits respectée", () => {
    const reg = new RoleRegistry();
    for (let i = 0; i < ROLE_MASK_CAPACITY; i++) reg.define(`ROLE_${i}`);
    expect(reg.bit(`ROLE_${ROLE_MASK_CAPACITY - 1}`)).to.be.greaterThan(0);
    expect(() => reg.define("ROLE_OVERFLOW")).to.throw(RangeError);
  });
});
