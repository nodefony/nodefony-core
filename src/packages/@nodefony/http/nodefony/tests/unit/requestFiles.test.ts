/// <reference types="node" />
import { expect } from "vitest";
import type http from "node:http";
import { describe, it } from "vitest";
import HttpRequest from "../../src/context/http/Request.js";
import type HttpContext from "../../src/context/http/HttpContext.js";
import type { IParsedUploadFile } from "../../interfaces/IUpload.js";

/**
 * `request.files` — les fichiers d'un corps multipart. Presque aucune requête
 * n'en porte : la règle perf du dépôt (lazy alloc sous 20 % d'usage) veut
 * qu'une requête SANS upload n'alloue aucun tableau. Elle lit un vide partagé
 * et gelé ; le premier fichier reçu alloue le sien, sans jamais écrire dans le
 * vide partagé — sinon la requête suivante hériterait du fichier d'une autre.
 */

function makeRequest(): HttpRequest {
  const nodeReq = {
    headers: { host: "127.0.0.1" },
    url: "/upload",
    method: "POST",
    socket: { remoteAddress: "192.0.2.1", encrypted: false },
  } as unknown as http.IncomingMessage;
  const context = {
    httpKernel: null,
    type: "http",
    log: () => undefined,
    uploadService: {
      createUploadFile: async (_file: unknown, name: string) => ({ name }),
    },
  };
  return new HttpRequest(nodeReq, context as unknown as HttpContext);
}

const parsed = {} as IParsedUploadFile;

describe("HttpRequest.files — aucune allocation sans upload", () => {
  it("deux requêtes sans upload lisent le MÊME vide, gelé", () => {
    const a = makeRequest();
    const b = makeRequest();
    expect(a.files).to.have.length(0);
    expect(a.files).to.equal(b.files);
    expect(Object.isFrozen(a.files)).to.equal(true);
  });

  it("le premier fichier alloue le tableau de SA requête, le vide partagé reste vide", async () => {
    const withUpload = makeRequest();
    await withUpload.createFileUpload("doc", parsed);
    await withUpload.createFileUpload("photo", parsed);
    expect(withUpload.files.map((f) => f.name)).to.deep.equal(["doc", "photo"]);
    const other = makeRequest();
    expect(other.files).to.have.length(0);
    expect(other.files).to.not.equal(withUpload.files);
  });
});
