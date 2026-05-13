import { expect } from "chai";
import "mocha";
import { Container, Nodefony } from "../index";

describe("Index", () => {
  it("named exports — Container importable", () => {
    const inst = new Container();
    expect(inst).to.be.instanceOf(Container);
  });

  it("Nodefony.version défini", () => {
    expect(Nodefony.version).to.be.a("string").and.not.empty;
  });

  it("Nodefony.getKernel() retourne null avant boot", () => {
    expect(Nodefony.getKernel()).to.be.null;
  });

  it("Nodefony.generateId() retourne un uuid", () => {
    const id = Nodefony.generateId();
    expect(id).to.match(/^[0-9a-f-]{36}$/);
  });
});
