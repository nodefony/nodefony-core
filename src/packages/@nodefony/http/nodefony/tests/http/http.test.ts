import { expect } from "chai";
import https from "node:https";
import "mocha";

describe("HTTP UNIT TESTS ", () => {
  it("Simple Request ", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/",
      method: "GET",
      rejectUnauthorized: false, // Allow self-signed certificates for testing
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(200);
          expect(res.headers["content-type"]).to.equal(
            "text/html; charset=utf-8"
          );
          done();
        } catch (e) {
          done(e);
        }
      });
    });
    req.on("error", (e) => {
      done(e);
    });
    req.end();
  });

  it("GET Request to Non-Existent Route", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/nonexistent",
      method: "GET",
      rejectUnauthorized: false, // Permettre les certificats auto-signés pour les tests
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(404);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    req.on("error", (e) => {
      done(e);
    });
    req.end();
  });
  it("GET Request Returning JSON", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/index4",
      method: "GET",
      rejectUnauthorized: false, // Permettre les certificats auto-signés pour les tests
    };
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(200);
          expect(res.headers["content-type"]).to.equal(
            "application/json; charset=utf-8"
          );
          const responseData = JSON.parse(data);
          expect(responseData).to.be.an("object");
          expect(responseData).to.have.property("route");
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    req.on("error", (e) => {
      done(e);
    });

    req.end();
  });

  it("Simple route", (done) => {
    done();
  });
});
