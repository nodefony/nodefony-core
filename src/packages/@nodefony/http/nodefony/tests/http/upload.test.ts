import { expect } from "vitest";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";
import {
  UPLOAD_DIRS,
  listUploadResidue,
  snapshotUploadDirs,
  purgeUploadResidue,
  type UploadSnapshot,
} from "../helpers/uploadResidue.js";

// Un test ne laisse JAMAIS de résidu. Le dossier de dépôt et le garde vivent
// dans un helper unique — viser le mauvais dossier est un nettoyage qui n'en
// est pas un (cf `helpers/uploadResidue.ts`).

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
  let snapshot: UploadSnapshot;
  beforeAll(async () => {
    snapshot = await snapshotUploadDirs();
  });
  afterAll(async () => {
    // Le SERVEUR efface les temporaires que l'action n'a pas déplacés : la
    // suite ne doit plus rien trouver. Que ce dossier soit bien celui où il
    // écrit, le test « lu sans être déplacé » le prouve par le chemin rendu.
    const removed = await purgeUploadResidue(snapshot);
    expect(removed, "le serveur a laissé des temporaires d'upload").to.equal(0);
  });

  /** Attend que le démontage de la requête ait fait son ménage. */
  const settled = async (snap: UploadSnapshot): Promise<string[]> => {
    for (let i = 0; i < 40; i += 1) {
      const left = await listUploadResidue(snap);
      if (left.length === 0) return left;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return listUploadResidue(snap);
  };

  it("🔴 un fichier lu SANS être déplacé est effacé à la fin de la requête", async () => {
    const filePath = path.resolve("nodefony", "config", "config.ts");
    const { statusCode, body } = await postMultipart(
      "/nodefony/test/html/upload",
      filePath,
      "file",
    );
    expect(statusCode).to.equal(200);
    const temp = (body as Array<Record<string, unknown>>)[0]?.["path"];
    expect(temp, "la route rend le chemin du temporaire").to.be.a("string");
    // Le fichier a existé LÀ où l'on regarde : le zéro qui suit n'est pas vide.
    expect(UPLOAD_DIRS).to.include(path.dirname(String(temp)));
    for (let i = 0; i < 40 && fs.existsSync(String(temp)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(fs.existsSync(String(temp)), String(temp)).to.equal(false);
  });

  it("🔴 un envoi REFUSÉ par l'action (400) ne laisse aucun fichier", async () => {
    const snap = await snapshotUploadDirs();
    const filePath = path.resolve("nodefony", "config", "config.ts");
    const { statusCode } = await postMultipart(
      "/nodefony/test/html/uploaderror",
      filePath,
      "file",
    );
    expect(statusCode).to.equal(400);
    expect(await settled(snap)).to.deep.equal([]);
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
      uploadedFile!["mimeType"],
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
    // Sans tri : l'ordre d'envoi est garanti (le test suivant le prouve).
    const names = files.map((f) => f.filename);
    expect(names).to.deep.equal(["a.txt", "b.txt"]);
  });

  it("🔴 rend les fichiers dans l'ORDRE D'ENVOI, quel que soit leur temps d'écriture", async () => {
    // Chaque fichier s'écrit sur le disque à son rythme : rangés à la fin de
    // leur écriture, un petit doublait un plus gros envoyé avant lui. Vingt
    // pièces de tailles alternées rendent la course systématique, sous les
    // seuils du banc (1 Mo par fichier, 1,5 Mo cumulés).
    const parts = Array.from({ length: 20 }, (_, i) => ({
      field: "file",
      filename: `${String(i).padStart(2, "0")}.bin`,
      contentType: "application/octet-stream",
      content: Buffer.alloc(i % 2 === 0 ? 120 * 1024 : 1, i),
    }));
    const { statusCode, body } = await postParts(
      "/nodefony/test/html/upload",
      parts,
    );
    expect(statusCode).to.equal(200);
    const files = body as Array<Record<string, unknown>>;
    expect(files.map((f) => f.filename)).to.deep.equal(
      parts.map((p) => p.filename),
    );
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
    expect(body).to.be.an("array").with.lengthOf(1);
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
