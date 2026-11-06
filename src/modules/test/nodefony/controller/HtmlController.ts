import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
//import { Inject, Error } from "nodefony";

@controller("/nodefony/test/html")
@UseSession()
class HtmlController extends Controller {
  constructor(context: Context) {
    super("HtmlController", context);
  }

  @route("index-html", { path: "" })
  index() {
    this.setContextHtml();
    const html = `<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="content-type" content="text/html; charset=UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="generator" content="Nodefony (https://nodefony.net)" />
    <meta
      name="keywords"
      content="web,Framework,realtime,node.js,symfony,javascript,npm,linux"
    />
    <meta
      name="description"
      content="Node.js full-stack web framework Symfony Like"
    />
    <title>Nodefony sinple text</title>
  </head>
  <body>
    <h1>Nodefony sinple text</h1>
  </body>
</html>`;
    return this.render(html);
  }

  @route("index-html-redirect", { path: "/redirect" })
  index2() {
    this.redirect("https://google.fr");
  }

  @route("index-file-stream", { path: "/stream" })
  stream1() {
    const file = resolve(this.module?.path as string, "tsconfig.json");
    return this.streamFile(file, { "content-type": "application/json" });
  }

  @route("index-file-donwload", { path: "/download" })
  stream2() {
    const file = resolve(this.module?.path as string, "tsconfig.json");
    return this.renderFileDownload(file);
  }

  @route("index-file-media", { path: "/media" })
  stream3() {
    // Fichiers à la racine de `public/` (auto-montés sous `/test/`).
    const file = resolve(
      this.module?.path as string,
      "public",
      "oceans-clip.webm",
    );
    return this.renderMediaStream(file);
  }

  /**
   * Média ABSENT — éprouve le 404 sur le chemin RÉEL du pipeline.
   *
   * Le test unitaire de `getFileAsync` prouve que l'erreur porte le code 404 ;
   * lui seul ne dit rien de ce que reçoit le client. C'est précisément le maillon
   * qui manquait : un fichier introuvable rendait **500** au client, alors que la
   * RFC 9110 §15.5.5 réserve le 404 à l'absence de représentation courante.
   */
  @route("index-file-media-missing", { path: "/media-missing" })
  stream4() {
    return this.renderMediaStream(
      resolve(this.module?.path as string, "public", "aucun-media-ici.webm"),
    );
  }

  /**
   * Fichier présent mais ILLISIBLE (`EACCES` à l'ouverture) : la page d'erreur
   * ordinaire, 500 — l'erreur tombe avant le premier octet. La route fabrique
   * son fichier en mode 000 et le supprime ensuite. La capacité se CONSTATE :
   * sous Windows ou en root, le mode ne retire pas la lecture — 501, et le banc
   * se saute.
   */
  @route("index-file-unreadable", { path: "/unreadable" })
  async stream5() {
    const dir = await mkdtemp(join(tmpdir(), "nf-stream-eacces-"));
    const file = join(dir, "illisible.bin");
    try {
      await writeFile(file, "secret");
      await chmod(file, 0o000);
      const readable = await access(file, constants.R_OK).then(
        () => true,
        () => false,
      );
      if (readable) {
        return await this.renderJson({ supported: false }, 501);
      }
      return await this.streamFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  @route("index-upload1", {
    path: "/upload",
    requirements: { methods: ["POST", "PUT"] },
  })
  upload() {
    return this.renderJson(this.files);
  }

  @route("index-upload-error", {
    path: "/uploaderror",
    requirements: { methods: ["POST", "PUT"] },
  })
  upload2() {
    // console.log(this.files);
    // console.log({
    //   result: this.files,
    //   ...this.context?.metaData,
    // });
    throw new HttpError(undefined, 400, this.context);
  }
}

export default HtmlController;
