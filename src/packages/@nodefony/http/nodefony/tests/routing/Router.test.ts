import http from "node:http";

import { expect } from "chai";
import https from "node:https";

describe("ROUTER TESTS", function () {
  //this.timeout(10000); // 10 seconds timeout for all tests

  const makeRequest = (options: https.RequestOptions, postData?: string) => {
    return new Promise<{ data: string; res: http.IncomingMessage }>(
      (resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ data, res });
          });
        });
        req.on("error", reject);
        if (postData) {
          req.write(postData);
        }
        req.end();
      },
    );
  };

  it("GET /nodefony/test/route/ejs/cci", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/ejs/cci",
        method: "GET",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(data).to.include("cci"); // Vérifier que la vue contient le nom "cci"
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("POST /nodefony/test/route/ejs/cci", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/ejs/cci",
        method: "POST",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(data).to.include("cci"); // Vérifier que la vue contient le nom "cci"
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("DELETE /nodefony/test/route", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/1234/move",
        method: "DELETE",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("application/json");
            const jsonData = JSON.parse(data);
            expect(jsonData).to.be.an("object");
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("POST /nodefony/test/route/add", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/add",
        method: "POST",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("application/json");
            const jsonData = JSON.parse(data);
            expect(jsonData).to.deep.equal({ foo: "bar" });
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("GET /nodefony/test/route/ele/{metier}/{format}/add", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/ele/anyMetier/cci/add",
        method: "GET",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("application/json");
            const jsonData = JSON.parse(data);
            expect(jsonData).to.deep.equal({
              metier: "anyMetier",
              format: "cci",
            });
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("GET /nodefony/test/route/ele/{metier}/{format}/{method}/add", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/ele/anyMetier/cci/anyMethod/add",
        method: "GET",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(data).to.include("anyMetier");
            expect(data).to.include("cci");
            expect(data).to.include("anyMethod");
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));

  it("GET /nodefony/test/route/*", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/route/anyRoute",
        method: "GET",
        rejectUnauthorized: false,
      };

      makeRequest(options)
        .then(({ data, res }) => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.include("application/json");
            const jsonData = JSON.parse(data);
            expect(jsonData).to.be.an("object");
            done();
          } catch (err) {
            done(err);
          }
        })
        .catch(done);
    }));
});
