import { expect } from "chai";
import https from "node:https";
import "mocha";
import supertest from "supertest";
import fs from "node:fs";
import path from "node:path";

const request = supertest("https://localhost:5152", { http2: true });

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
            `attachment; filename="tsconfig.json"`
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
    // oceans-clip.webm size
    const size = 14625011;
    const start = 0;
    const end = 999;
    const range = `bytes=${start}-${end}`;
    const expectedChunkSize = end - start + 1;
    request
      .get("/nodefony/test/html/media")
      .disableTLSCerts()
      .set("Range", range)
      .expect("Content-Range", `bytes ${start}-${end}/${size}`)
      .expect("Accept-Ranges", "bytes")
      .expect("Content-Length", expectedChunkSize.toString())
      .expect(206) // Status code for partial content
      .end((err: Error, res: any) => {
        if (err) return done(err);
        try {
          expect(res.status).to.equal(206);
          expect(res.headers["content-range"]).to.equal(
            `bytes ${start}-${end}/${size}`
          );
          expect(res.headers["accept-ranges"]).to.equal("bytes");
          expect(res.headers["content-length"]).to.equal(
            expectedChunkSize.toString()
          );
          done();
        } catch (e) {
          done(e);
        }
      });
  });
});
