import { expect } from "chai";
import https from "node:https";
import "mocha";
import fs from "node:fs";
import path from "node:path";

describe("HTTP STREAM", () => {
  it("GET /stream", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/html/stream",
      method: "GET",
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(200);
          expect(res.headers["content-type"]).to.equal("application/json");
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

  it("GET /download", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/html/download",
      method: "GET",
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(200);
          expect(res.headers["content-disposition"]).to.include(
            `attachment; filename="tsconfig.json"`,
          );
          expect(res.headers["content-length"]).to.be.a("string");
          expect(res.headers["content-type"]).to.equal("application/json");
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

  it("GET /media", (done) => {
    const options = {
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/html/media",
      method: "GET",
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(200);
          expect(res.headers["content-type"]).to.equal("video/webm");
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
});

describe("HTTP STREAM  with Range", () => {
  it("GET /media with Range header", (done) => {
    const size = 14625011;
    const start = 0;
    const end = 999;
    const range = `bytes=${start}-${end}`;
    const expectedChunkSize = end - start + 1;

    const options: https.RequestOptions = {
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/html/media",
      method: "GET",
      rejectUnauthorized: false,
      headers: { Range: range },
    };

    const req = https.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        try {
          expect(res.statusCode).to.equal(206);
          expect(res.headers["content-range"]).to.equal(
            `bytes ${start}-${end}/${size}`,
          );
          expect(res.headers["accept-ranges"]).to.equal("bytes");
          expect(res.headers["content-length"]).to.equal(
            expectedChunkSize.toString(),
          );
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    req.on("error", (e) => done(e));
    req.end();
  });
});
