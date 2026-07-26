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

  it("GET /nodefony/test/route/ejs/cci", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/ejs/cci",
      method: "GET",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("text/html");
    expect(data).to.include("cci"); // Vérifier que la vue contient le nom "cci"
  });

  it("POST /nodefony/test/route/ejs/cci", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/ejs/cci",
      method: "POST",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("text/html");
    expect(data).to.include("cci"); // Vérifier que la vue contient le nom "cci"
  });

  it("DELETE /nodefony/test/route", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/1234/move",
      method: "DELETE",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("application/json");
    const jsonData = JSON.parse(data);
    expect(jsonData).to.be.an("object");
  });

  it("POST /nodefony/test/route/add", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/add",
      method: "POST",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("application/json");
    const jsonData = JSON.parse(data);
    expect(jsonData).to.deep.equal({ foo: "bar" });
  });

  it("GET /nodefony/test/route/ele/{metier}/{format}/add", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/ele/anyMetier/cci/add",
      method: "GET",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("application/json");
    const jsonData = JSON.parse(data);
    expect(jsonData).to.deep.equal({
      metier: "anyMetier",
      format: "cci",
    });
  });

  it("GET /nodefony/test/route/ele/{metier}/{format}/{method}/add", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/ele/anyMetier/cci/anyMethod/add",
      method: "GET",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("text/html");
    expect(data).to.include("anyMetier");
    expect(data).to.include("cci");
    expect(data).to.include("anyMethod");
  });

  it("GET /nodefony/test/route/*", async () => {
    const { data, res } = await makeRequest({
      hostname: "localhost",
      port: 5152,
      path: "/nodefony/test/route/anyRoute",
      method: "GET",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).to.equal(200);
    expect(res.headers["content-type"]).to.include("application/json");
    const jsonData = JSON.parse(data);
    expect(jsonData).to.be.an("object");
  });
});
