import { randomUUID } from "node:crypto";
import {
  route,
  controller,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  HttpCode,
  Param,
  Body,
} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";

/** Forme d'un item — remplace par ton entité (`nodefony create entity`). */
interface IItem {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * <%= it.nameClass %> — resource REST (CRUD) + echo WebSocket dans la MÊME
 * classe (un seul pipeline : firewall, audit, logs).
 *
 * Généré par `nodefony create controller --kind rest`. Le store est un stub EN
 * MÉMOIRE (perdu au restart, par process) : branche un repository dès que tu
 * crées ton entité — `nodefony create entity <nom>`.
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  /** Stub volontairement naïf — PAS un store de production. */
  static readonly items = new Map<string, IItem>();

  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  @Get("")
  list() {
    return this.renderJson([...<%= it.nameClass %>.items.values()]);
  }

  @Get("/{id}")
  read(@Param("id") id: string) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    return this.renderJson(item);
  }

  @Post("")
  @HttpCode(201)
  create(@Body() payload: { name?: string }) {
    const item: IItem = {
      id: randomUUID(),
      name: payload?.name ?? "sans nom",
      createdAt: Date.now(),
    };
    <%= it.nameClass %>.items.set(item.id, item);
    return this.renderJson(item);
  }

  @Put("/{id}")
  update(@Param("id") id: string, @Body() payload: { name?: string }) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    if (payload?.name !== undefined) {
      item.name = payload.name;
    }
    return this.renderJson(item);
  }

  @Delete("/{id}")
  remove(@Param("id") id: string) {
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    return this.renderJson({ deleted: id });
  }

  /** Echo WS — même controller, même pipeline que le CRUD. */
  @route("<%= it.kebab %>-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default <%= it.nameClass %>;
