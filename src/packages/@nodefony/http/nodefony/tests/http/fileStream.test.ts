import { expect } from "chai";
import https from "node:https";
import "mocha";

describe("STREAM FILE UNIT TESTS ", () => {
  it("Simple Request ", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/app",
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

  it("Simple stream file", (done) => {
    done();
  });
});
