import { Controller, DefineRoute, DefineController } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { inject, Error } from "nodefony";

@DefineController("html", {})
class HtmlController extends Controller {
  static override basepath = "/nodefony/test";
  constructor(context: Context) {
    super("HtmlController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    this.setContextHtml();
    return this;
  }

  @DefineRoute("index-html", { path: "/html" })
  index() {
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

  @DefineRoute("index-html-redirect", { path: "/html/redirect" })
  index2() {
    return this.redirect("https://google.fr");
  }
}

export default HtmlController;
