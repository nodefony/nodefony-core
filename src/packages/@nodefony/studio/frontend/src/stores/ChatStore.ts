import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient } from "nodefony";

/**
 * ChatStore — prépare l'UI du chat IA temps réel.
 *
 * Pipeline cible (P12 — couche IA agentic + P13.7 streaming) :
 *  - user envoie un message → `client.stream("chat:send", { msg }, onToken)`
 *  - serveur stream les tokens LLM → mis à jour dans `currentResponse`
 *  - à la fin → flush dans `messages` + clear `currentResponse`
 *
 * Pour le POC, on garde la structure de données + un mock "echo" local.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  streaming?: boolean;
}

export class ChatStore {
  messages: ChatMessage[] = [];
  /** Buffer en cours de streaming pour le message assistant courant. */
  currentResponse = "";
  isStreaming = false;
  error: string | null = null;

  constructor(private readonly client: RealtimeClient) {
    makeAutoObservable(this);
  }

  clear(): void {
    this.messages = [];
    this.currentResponse = "";
    this.error = null;
  }

  /**
   * Envoie un message + reçoit la réponse streamée.
   * POC : mock local. À remplacer par `client.stream("chat:send", ...)` en P12.
   */
  async send(content: string): Promise<void> {
    if (!content.trim() || this.isStreaming) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
      ts: Date.now(),
    };
    runInAction(() => {
      this.messages.push(userMsg);
      this.isStreaming = true;
      this.currentResponse = "";
      this.error = null;
    });

    try {
      if (this.client.state === "connected") {
        // Vraie API future :
        await this.client.stream<{ token: string }>(
          "chat:send",
          { message: content },
          (chunk) => {
            runInAction(() => {
              this.currentResponse += chunk.token;
            });
          },
        );
      } else {
        // Mock local — simule un streaming token-by-token.
        await this.mockStream(content);
      }
      runInAction(() => {
        this.messages.push({
          id: `a-${Date.now()}`,
          role: "assistant",
          content: this.currentResponse,
          ts: Date.now(),
        });
        this.currentResponse = "";
        this.isStreaming = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.isStreaming = false;
      });
    }
  }

  private async mockStream(input: string): Promise<void> {
    const echo = `[mock] Reçu "${input}". Le pipeline @nodefony/agent (P12) répondra ici en streaming via RealtimeClient + JSON-RPC 2.0.`;
    for (const ch of echo.split("")) {
      await new Promise((r) => setTimeout(r, 15));
      runInAction(() => (this.currentResponse += ch));
    }
  }
}
