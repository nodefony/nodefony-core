import { expect } from "chai";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "mocha";

// Dossier où le service d'upload dépose les fichiers reçus (uploadDir défaut =
// « tmp » résolu sous la racine projet). Les tests d'upload y créent des fichiers
// temporaires `<uuid>.<ext>` ; un test ne doit JAMAIS laisser de résidu → on les
// nettoie en fin de suite (diff de snapshot, sans toucher au préexistant).
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
);
const UPLOAD_DIR = path.join(REPO_ROOT, "tmp");

function postMultipart(
  urlPath: string,
  filePath: string,
  fieldName: string,
): Promise<{ statusCode: number; body: unknown }> {
  const boundary = `----NodeFormBoundary${Date.now()}`;
  const fileContent = fs.readFileSync(filePath);
  const filename = path.basename(filePath);

  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
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
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** POST multipart générique : N parts fichier (+ champs texte optionnels). */
function postParts(
  urlPath: string,
  parts: Array<
    | { field: string; filename: string; contentType: string; content: Buffer }
    | { field: string; value: string }
  >,
): Promise<{ statusCode: number; body: unknown }> {
  const boundary = `----NodeFormBoundary${Date.now()}${Math.random()
    .toString(36)
    .slice(2)}`;
  const buffers: Buffer[] = [];
  for (const p of parts) {
    if ("value" in p) {
      buffers.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"\r\n\r\n${p.value}\r\n`,
        ),
      );
    } else {
      buffers.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType}\r\n\r\n`,
        ),
        p.content,
        Buffer.from(`\r\n`),
      );
    }
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(buffers);
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
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode!, body: data });
          }
        });
      },
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
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("File Upload Tests", () => {
  // Hygiène : un test ne laisse JAMAIS de résidu. On photographie le dossier
  // d'upload avant la suite et on supprime UNIQUEMENT les fichiers qu'elle a
  // créés (diff de snapshot) — sans toucher au préexistant.
  let preexisting: Set<string>;
  before(async () => {
    preexisting = new Set(await fsp.readdir(UPLOAD_DIR).catch(() => []));
  });
  after(async () => {
    const entries = await fsp
      .readdir(UPLOAD_DIR, { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    await Promise.all(
      entries
        .filter((d) => d.isFile() && !preexisting.has(d.name))
        .map((d) => fsp.unlink(path.join(UPLOAD_DIR, d.name)).catch(() => {})),
    );
  });

  it("should upload a file successfully", async () => {
    const filePath = path.resolve("nodefony", "config", "config.ts");
    const { statusCode, body } = await postMultipart(
      "/nodefony/test/html/upload",
      filePath,
      "file",
    );
    expect(statusCode).to.equal(200);
    expect(body).to.be.an("array").that.is.not.empty;
    const uploadedFile = (body as Array<Record<string, unknown>>)[0];
    expect(uploadedFile).to.have.property("filename", "config.ts");
    expect(uploadedFile)
      .to.have.property("size")
      .that.is.a("number")
      .and.greaterThan(0);
    expect(["video/mp2t", "application/octet-stream"]).to.include(
      uploadedFile["mimeType"],
    );
  });

  it("should return an error if no file is uploaded", async () => {
    const { statusCode } = await postEmpty("/nodefony/test/html/uploaderror");
    expect(statusCode).to.equal(400);
  });

  // ── busboy : multi-fichiers, mime non-octet, champs texte, limites 413 ──────

  it("uploads multiple files in one request (busboy streaming)", async () => {
    const { statusCode, body } = await postParts("/nodefony/test/html/upload", [
      {
        field: "file",
        filename: "a.txt",
        contentType: "text/plain",
        content: Buffer.from("alpha"),
      },
      {
        field: "file",
        filename: "b.txt",
        contentType: "text/plain",
        content: Buffer.from("bravo!!"),
      },
    ]);
    expect(statusCode).to.equal(200);
    const files = body as Array<Record<string, unknown>>;
    expect(files).to.be.an("array").with.lengthOf(2);
    const names = files.map((f) => f.filename).sort();
    expect(names).to.deep.equal(["a.txt", "b.txt"]);
  });

  it("preserves a non-octet mime type (image/png)", async () => {
    const { statusCode, body } = await postParts("/nodefony/test/html/upload", [
      {
        field: "file",
        filename: "pixel.png",
        contentType: "image/png",
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ]);
    expect(statusCode).to.equal(200);
    const f = (body as Array<Record<string, unknown>>)[0];
    expect(f).to.have.property("mimeType", "image/png");
    expect(f).to.have.property("filename", "pixel.png");
  });

  it("accepts a file field alongside text fields", async () => {
    const { statusCode, body } = await postParts("/nodefony/test/html/upload", [
      { field: "title", value: "hello" },
      {
        field: "file",
        filename: "doc.txt",
        contentType: "text/plain",
        content: Buffer.from("data"),
      },
    ]);
    expect(statusCode).to.equal(200);
    expect(body as unknown[])
      .to.be.an("array")
      .with.lengthOf(1);
  });

  it("rejects a file exceeding maxFileSize with 413", async () => {
    // limite fixture = 1 MB/fichier → 2 MB doit être refusé en streaming.
    const big = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const { statusCode } = await postParts("/nodefony/test/html/upload", [
      {
        field: "file",
        filename: "big.bin",
        contentType: "application/octet-stream",
        content: big,
      },
    ]);
    expect(statusCode).to.equal(413);
  });

  it("rejects when cumulative size exceeds maxTotalFileSize with 413", async () => {
    // limite fixture = 1,5 MB cumulé ; 2×800 Ko = 1,6 MB (chaque < 1 MB) → 413.
    const chunk = Buffer.alloc(800 * 1024, 0x62);
    const { statusCode } = await postParts("/nodefony/test/html/upload", [
      {
        field: "file",
        filename: "p1.bin",
        contentType: "application/octet-stream",
        content: chunk,
      },
      {
        field: "file",
        filename: "p2.bin",
        contentType: "application/octet-stream",
        content: chunk,
      },
    ]);
    expect(statusCode).to.equal(413);
  });
});
