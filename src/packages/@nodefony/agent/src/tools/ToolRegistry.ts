// @nodefony/agent — src/tools/ToolRegistry.ts

import type { ITool, IAgentContext } from "../interfaces/IAgent.js";
import {
  ToolNotFoundError,
  ToolExecutionError,
} from "../errors/AgentErrors.js";

const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]*$/;
const MAX_TOOLS = 256;

export class ToolRegistry {
  private tools = new Map<string, ITool>();

  register(tool: ITool): void {
    if (!TOOL_NAME_REGEX.test(tool.name)) {
      throw new Error(
        `Invalid tool name "${tool.name}". Must match ${TOOL_NAME_REGEX}`,
      );
    }
    if (this.tools.size >= MAX_TOOLS) {
      throw new Error(`Cannot register more than ${MAX_TOOLS} tools`);
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ITool {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ITool[] {
    return [...this.tools.values()];
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: IAgentContext,
  ): Promise<unknown> {
    const tool = this.get(name);
    try {
      return await tool.execute(input, context);
    } catch (err) {
      throw new ToolExecutionError(name, err as Error);
    }
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}
