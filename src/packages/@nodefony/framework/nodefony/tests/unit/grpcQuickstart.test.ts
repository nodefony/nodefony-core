//
// ─── Le « Démarrage rapide » de docs/grpc.md est le code exécuté ici ───
//
// La page montre un contrat et un contrôleur ; ce test exige qu'ils soient,
// octet pour octet, les fichiers de `fixtures/grpc` (contrat → code généré par
// `buf generate`, gardé par le gate de dérive ; contrôleur → compilé par le
// typecheck du module). Il importe le contrôleur PAR LE NOM DU PAQUET, comme
// l'application : c'est la surface publiée qui monte la route.
//
// Débrancher : modifier une ligne du bloc de la page, ou retirer
// `@GrpcService` du fichier — un cas tombe.
//
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { Router } from "@nodefony/framework";
import { expect } from "vitest";
import { GreetController } from "../fixtures/grpc/controllers/GreetController.js";
import { GreetRequestSchema } from "../fixtures/grpc/gen/greet/v1/greet_pb.js";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../../../docs/grpc.md");
const quickstart = page.slice(
  page.indexOf("## 🚀 Démarrage rapide"),
  page.indexOf("\n## ", page.indexOf("## 🚀 Démarrage rapide") + 1),
);

/** Le premier bloc de `fence` qui suit `marker` dans le Démarrage rapide. */
function blockAfter(marker: string, fence: string): string {
  const at = quickstart.indexOf(marker);
  expect(at, `repère « ${marker} » absent du Démarrage rapide`).to.be.above(-1);
  const open = quickstart.indexOf(`\`\`\`${fence}\n`, at);
  const start = open + fence.length + 4;
  return quickstart.slice(start, quickstart.indexOf("```", start));
}

describe("docs/grpc.md — le Démarrage rapide est le code exécuté", () => {
  it("le contrat de la page est le fichier `proto/greet/v1/greet.proto`", () => {
    expect(blockAfter("**2. Le contrat**", "proto")).to.equal(
      read("../fixtures/grpc/proto/greet/v1/greet.proto"),
    );
  });

  it("le contrôleur de la page est le fichier `GreetController.ts`", () => {
    expect(blockAfter("<!-- example: GreetController.ts -->", "ts")).to.equal(
      read("../fixtures/grpc/controllers/GreetController.ts"),
    );
  });

  it("le contrôleur démarre et monte POST /greet.v1.GreetService/Greet", () => {
    GreetController.assertScope();
    const routes = Router.getRoutesForController(GreetController);
    expect(routes.map((r) => r.name)).to.deep.equal(["GreetController::greet"]);
    const route = routes[0];
    if (route === undefined) throw new Error("route Greet absente");
    const pattern = route.pattern;
    if (pattern === undefined) throw new Error("route Greet non compilée");
    expect(pattern.test("/greet.v1.GreetService/Greet")).to.equal(true);
    expect(pattern.test("/greet.v1.GreetService/Other")).to.equal(false);
    expect(route.method).to.equal("POST");
    expect(route.classMethod).to.equal("serveGrpc");
    expect(route.bodyStream).to.equal(true);
  });

  it("la méthode rend le message annoncé par la page", () => {
    const reply = GreetController.prototype.greet(
      create(GreetRequestSchema, { name: "Ada" }),
    );
    expect(reply).to.deep.equal({ greeting: "Bonjour, Ada !" });
  });
});
