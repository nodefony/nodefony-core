// @nodefony/agent — tests/ToolRegistry.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import { ToolNotFoundError, ToolExecutionError } from "../src/errors/AgentErrors.js";
import type { ITool } from "../src/interfaces/IAgent.js";

const makeTool = (name: string, execute = mock(async () => "ok")): ITool => ({
  name,
  description: `tool ${name}`,
  inputSchema: { type: "object" },
  execute,
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("registers a valid tool", () => {
      registry.register(makeTool("search_doc"));
      expect(registry.has("search_doc")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("rejects invalid name (uppercase)", () => {
      expect(() => registry.register(makeTool("SearchDoc"))).toThrow();
    });

    it("rejects invalid name (special chars)", () => {
      expect(() => registry.register(makeTool("search-doc"))).toThrow();
      expect(() => registry.register(makeTool("search.doc"))).toThrow();
    });

    it("rejects name starting with digit", () => {
      expect(() => registry.register(makeTool("1tool"))).toThrow();
    });

    it("rejects duplicate", () => {
      registry.register(makeTool("a"));
      expect(() => registry.register(makeTool("a"))).toThrow();
    });
  });

  describe("execute", () => {
    it("calls tool execute", async () => {
      const exec = mock(async () => ({ result: "data" }));
      registry.register(makeTool("search", exec));
      const result = await registry.execute("search", { q: "x" }, { sessionId: "s" });
      expect(result).toEqual({ result: "data" });
      expect(exec).toHaveBeenCalled();
    });

    it("throws ToolNotFoundError", async () => {
      await expect(registry.execute("missing", {}, { sessionId: "s" }))
        .rejects.toThrow(ToolNotFoundError);
    });

    it("wraps errors in ToolExecutionError", async () => {
      const exec = mock(async () => { throw new Error("boom"); });
      registry.register(makeTool("failing", exec));
      await expect(registry.execute("failing", {}, { sessionId: "s" }))
        .rejects.toThrow(ToolExecutionError);
    });
  });

  describe("management", () => {
    it("unregisters", () => {
      registry.register(makeTool("a"));
      expect(registry.unregister("a")).toBe(true);
      expect(registry.has("a")).toBe(false);
    });

    it("lists all tools", () => {
      registry.register(makeTool("a"));
      registry.register(makeTool("b"));
      expect(registry.list().length).toBe(2);
    });

    it("clears all tools (memory safety)", () => {
      registry.register(makeTool("a"));
      registry.register(makeTool("b"));
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });
});
