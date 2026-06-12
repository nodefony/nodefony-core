import {
  Controller,
  route,
  controller,
  Get,
  Session,
  UseSession,
} from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import type { ISession } from "@nodefony/http";

@controller("/nodefony/test/rest")
@UseSession()
class RestController extends Controller {
  constructor(context: Context) {
    super("RestController", context);
  }

  @route("index-rest", { path: "" })
  index() {
    return this.renderJson({});
  }

  // Retour BRUT d'un objet (PAS de renderJson) → auto-JSON par le Resolver.
  @route("rest-auto-object", {
    path: "/auto/object",
    requirements: { methods: "GET" },
  })
  autoObject() {
    return { ok: true, n: 42, nested: { a: [1, 2, 3] } };
  }

  // Retour BRUT d'un array → auto-JSON (array) par le Resolver.
  @route("rest-auto-array", {
    path: "/auto/array",
    requirements: { methods: "GET" },
  })
  autoArray() {
    return [1, "two", { three: 3 }];
  }

  // Scalaires JSON (RFC 8259 §2) — `return 42` / `return true` → auto-JSON.
  @route("rest-auto-number", {
    path: "/auto/number",
    requirements: { methods: "GET" },
  })
  autoNumber() {
    return 42;
  }

  @route("rest-auto-boolean", {
    path: "/auto/boolean",
    requirements: { methods: "GET" },
  })
  autoBoolean() {
    return true;
  }

  // Buffer brut → envoi binaire direct par le Resolver (case "buffer").
  @route("rest-auto-buffer", {
    path: "/auto/buffer",
    requirements: { methods: "GET" },
  })
  autoBuffer() {
    return Buffer.from([0x00, 0x01, 0xfe, 0xff]);
  }

  // Corps VIDE légal — `return ""` ne doit pas produire un 500
  // (ERR_STREAM_NULL_VALUES sur res.write(null)).
  @route("rest-auto-empty", {
    path: "/auto/empty",
    requirements: { methods: "GET" },
  })
  autoEmpty() {
    return "";
  }

  @route("rest-session-info", {
    path: "/session",
    requirements: { methods: "GET" },
  })
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
    return this.renderJson({
      id: session.id,
      key,
      value: session.getFlashBag(key),
    });
  }

  // @Session() → l'objet Session live injecté (preuve : id présent après start).
  @Get("/session/deco")
  sessionDeco(@Session() session: ISession | null) {
    return this.renderJson({
      hasSession: session != null,
      id: session?.id ?? null,
    });
  }

  // @Session("foo") → session.get("foo") (set via /session/set/foo/<v> au préalable).
  @Get("/session/deco-key")
  sessionDecoKey(@Session("foo") foo: unknown) {
    return this.renderJson({ foo: foo ?? null });
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
