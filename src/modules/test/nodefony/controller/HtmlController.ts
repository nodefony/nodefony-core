import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { resolve } from "node:path";
//import { inject, Error } from "nodefony";

@controller("/nodefony/test/html")
class HtmlController extends Controller {
  constructor(context: Context) {
    super("HtmlController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
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
    <title>Nodefony</title>
  </head>
  <body>
    <h1>Nodefony</h1>
  </body>
</html>`;
    return this.render(html);
  }

  @route("index-html-redirect", { path: "/redirect" })
  index2() {
    return this.redirect("https://google.fr");
  }

  @route("index-file-stream", { path: "/stream" })
  stream1() {
    const file = resolve(this.module?.path as string, "tsconfig.json");
    return this.streamFile(file);
  }

  @route("index-file-donwload", { path: "/download" })
  stream2() {
    const file = resolve(this.module?.path as string, "tsconfig.json");
    return this.renderFileDownload(file);
  }

  @route("index-file-media", { path: "/media" })
  stream3() {
    // const file = resolve(
    //   this.module?.path as string,
    //   "public",
    //   "test",
    //   "chico_buarque.mp3"
    // );
    //console.log(this.session?.id);
    const file = resolve(
      this.module?.path as string,
      "public",
      "test",
      "oceans-clip.webm"
    );
    return this.renderMediaStream(file);
  }
}

export default HtmlController;
