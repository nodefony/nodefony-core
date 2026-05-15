import { expect } from "chai";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";
import "mocha";

function postMultipart(
  urlPath: string,
  filePath: string,
  fieldName: string
): Promise<{ statusCode: number; body: unknown }> {
  const boundary = `----NodeFormBoundary${Date.now()}`;
  const fileContent = fs.readFileSync(filePath);
  const filename = path.basename(filePath);

  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ),
    fileContent,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path: urlPath,
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode!, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function postEmpty(urlPath: string): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path: urlPath,
        method: "POST",
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ statusCode: res.statusCode! }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("File Upload Tests", () => {
  it("should upload a file successfully", async () => {
    const filePath = path.resolve("nodefony", "config", "config.ts");
    const { statusCode, body } = await postMultipart(
      "/nodefony/test/html/upload",
      filePath,
      "file"
    );
    expect(statusCode).to.equal(200);
    expect(body).to.be.an("array").that.is.not.empty;
    const uploadedFile = (body as Array<Record<string, unknown>>)[0];
    expect(uploadedFile).to.have.property("filename", "config.ts");
    expect(uploadedFile).to.have.property("size").that.is.a("number").and.greaterThan(0);
    expect(uploadedFile).to.have.property("mimeType", "video/mp2t");
  });

  it("should return an error if no file is uploaded", async () => {
    const { statusCode } = await postEmpty("/nodefony/test/html/uploaderror");
    expect(statusCode).to.equal(400);
  });
});
