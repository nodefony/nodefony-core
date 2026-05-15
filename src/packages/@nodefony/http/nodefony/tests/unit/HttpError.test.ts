import { expect } from "chai";
import "mocha";
import HttpError from "../../src/errors/httpError.js";

describe("HttpError — unit tests", () => {
  describe("constructor(message, code)", () => {
    it("stores message and code", () => {
      const err = new HttpError("Not Found", 404);
      expect(err.message).to.equal("Not Found");
      expect(err.code).to.equal(404);
    });

    it("stores 400", () => {
      const err = new HttpError("Bad Request", 400);
      expect(err.code).to.equal(400);
    });

    it("stores 500", () => {
      const err = new HttpError("Internal Error", 500);
      expect(err.code).to.equal(500);
    });

    it("stores 401", () => {
      const err = new HttpError("Unauthorized", 401);
      expect(err.code).to.equal(401);
    });

    it("stores 403", () => {
      const err = new HttpError("Forbidden", 403);
      expect(err.code).to.equal(403);
    });
  });

  describe("constructor(Error, code)", () => {
    it("wraps a native Error", () => {
      const original = new Error("original");
      const err = new HttpError(original, 500);
      expect(err.code).to.equal(500);
    });

    it("preserves the message from the wrapped Error", () => {
      const original = new Error("db connection failed");
      const err = new HttpError(original, 503);
      expect(err.message).to.include("db connection failed");
    });
  });

  describe("instanceof checks", () => {
    it("is instanceof Error", () => {
      expect(new HttpError("test", 400)).to.be.instanceof(Error);
    });

    it("is instanceof HttpError", () => {
      expect(new HttpError("test", 400)).to.be.instanceof(HttpError);
    });
  });

  describe("name property", () => {
    it("has a name string", () => {
      const err = new HttpError("test", 400);
      expect(err.name).to.be.a("string").and.have.length.greaterThan(0);
    });
  });

  describe("toString()", () => {
    it("includes the code", () => {
      const err = new HttpError("Not Found", 404);
      expect(err.toString()).to.include("404");
    });

    it("includes the message", () => {
      const err = new HttpError("Not Found", 404);
      expect(err.toString()).to.include("Not Found");
    });

    it("includes the code and message for 500", () => {
      const err = new HttpError("Internal Server Error", 500);
      const str = err.toString();
      expect(str).to.include("500");
      expect(str).to.include("Internal Server Error");
    });
  });

  describe("stack trace", () => {
    it("has a stack property", () => {
      const err = new HttpError("test", 400);
      expect(err.stack).to.be.a("string");
    });

    it("stack includes HttpError", () => {
      const err = new HttpError("test", 400);
      expect(err.stack).to.include("HttpError");
    });
  });

  describe("context (optional)", () => {
    it("context is undefined when not provided", () => {
      const err = new HttpError("test", 400);
      expect(err.context).to.be.undefined;
    });
  });
});
