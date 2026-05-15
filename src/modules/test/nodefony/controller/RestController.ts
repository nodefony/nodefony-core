import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";

@controller("/nodefony/test/rest")
class RestController extends Controller {
  constructor(context: Context) {
    super("RestController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @route("index-rest", { path: "" })
  index() {
    return this.renderJson({});
  }

  @route("rest-session-info", { path: "/session" })
  sessionInfo() {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({
      id: session.id,
      name: session.name,
      status: session.status,
      strategy: session.strategy,
    });
  }

  @route("rest-session-set", {
    path: "/session/set/{key}/{value}",
    requirements: { methods: "GET" },
  })
  sessionSet(key: string, value: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    session.set(key, value);
    return this.renderJson({ id: session.id, key, value });
  }

  @route("rest-session-get", {
    path: "/session/get/{key}",
    requirements: { methods: "GET" },
  })
  sessionGet(key: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({ id: session.id, key, value: session.get(key) });
  }

  @route("rest-session-flash-set", {
    path: "/session/flash/{key}/{value}",
    requirements: { methods: "GET" },
  })
  flashSet(key: string, value: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    session.setFlashBag(key, value);
    return this.renderJson({ id: session.id, key, value });
  }

  @route("rest-session-flash-get", {
    path: "/session/flash/{key}",
    requirements: { methods: "GET" },
  })
  flashGet(key: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({ id: session.id, key, value: session.getFlashBag(key) });
  }

  @route("rest-session-destroy", {
    path: "/session",
    requirements: { methods: "DELETE" },
  })
  async sessionDestroy() {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    const id = session.id;
    await session.destroy(true);
    return this.renderJson({ destroyed: id });
  }
}

export default RestController;
