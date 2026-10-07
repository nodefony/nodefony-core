import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient } from "nodefony";
import {
  AGENTS,
  planChatReply,
  type IChatCitation,
  type IChatStep,
  type IPreviewAgent,
} from "../routes/ai/aiPreviewModel";

/**
 * ChatStore — l'UI du chat IA temps réel, sur une réponse SIMULÉE.
 *
 * Pipeline cible (couche IA), motif « travail + canal » :
 *  - l'utilisateur envoie un message → une action accuse réception ;
 *  - les événements de l'agent (réflexion, appels d'outils, jetons) arrivent
 *    sur un canal abonné ;
 *  - à la fin → le message rejoint `messages`, avec ses citations et son usage.
 *
 * Aujourd'hui, l'agent est simulé (`planChatReply`) : il interroge VRAIMENT un
 * petit corpus, puis répond en citant ce qu'il a trouvé. Le rythme et la forme
 * sont ceux du flux visé, pour que le vrai canal se branche sans redessiner
 * l'écran.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  streaming?: boolean;
  /** Ce que l'agent a fait avant de répondre : réflexion, outils, résultats. */
  steps?: IChatStep[];
  citations?: IChatCitation[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costEur: number;
    model: string;
  };
  /** Réponse interrompue par l'utilisateur avant la fin. */
  aborted?: boolean;
  /** L'agent qui a répondu — la conversation peut en changer en cours de route. */
  agent?: string;
}

/** Délai entre deux étapes visibles, puis entre deux mots de la réponse. */
const STEP_MS = 450;
const WORD_MS = 28;

export class ChatStore {
  messages: ChatMessage[] = [];
  /** Buffer en cours de streaming pour le message assistant courant. */
  currentResponse = "";
  /** Étapes déjà reçues pour la réponse en cours. */
  currentSteps: IChatStep[] = [];
  isStreaming = false;
  error: string | null = null;
  /** L'agent interrogé : il porte le modèle, les collections, les outils et la zone. */
  agentName: string = (AGENTS[0] as IPreviewAgent).name;
  /** Levé par `abort()` : la boucle de flux s'arrête au prochain mot. */
  private abortRequested = false;

  constructor(private readonly client: RealtimeClient) {
    makeAutoObservable<ChatStore, "client" | "abortRequested">(this, {
      client: false,
      abortRequested: false,
    });
  }

  clear(): void {
    if (this.isStreaming) return;
    this.messages = [];
    this.currentResponse = "";
    this.currentSteps = [];
    this.error = null;
  }

  get agent(): IPreviewAgent {
    return (
      AGENTS.find((a) => a.name === this.agentName) ??
      (AGENTS[0] as IPreviewAgent)
    );
  }

  setAgent(name: string): void {
    if (!this.isStreaming) this.agentName = name;
  }

  /** Interrompt la réponse en cours ; ce qui a déjà été reçu est conservé. */
  abort(): void {
    if (this.isStreaming) this.abortRequested = true;
  }

  /** Envoie un message, puis reçoit la réponse de l'agent étape par étape. */
  async send(content: string): Promise<void> {
    if (!content.trim() || this.isStreaming) return;

    runInAction(() => {
      this.messages.push({
        id: `u-${Date.now()}`,
        role: "user",
        content,
        ts: Date.now(),
      });
      this.isStreaming = true;
      this.currentResponse = "";
      this.currentSteps = [];
      this.error = null;
      this.abortRequested = false;
    });

    try {
      const agent = this.agent;
      const plan = planChatReply(content, agent);
      for (const step of plan.steps) {
        if (this.abortRequested) break;
        await sleep(STEP_MS);
        runInAction(() => this.currentSteps.push(step));
      }
      const words = plan.answer.split(" ");
      for (let i = 0; i < words.length && !this.abortRequested; i++) {
        await sleep(WORD_MS);
        runInAction(() => {
          this.currentResponse += (i === 0 ? "" : " ") + words[i];
        });
      }
      runInAction(() => {
        const aborted = this.abortRequested;
        this.messages.push({
          id: `a-${Date.now()}`,
          role: "assistant",
          content: this.currentResponse,
          ts: Date.now(),
          steps: [...this.currentSteps],
          agent: agent.name,
          ...(aborted
            ? { aborted: true }
            : { citations: plan.citations, usage: plan.usage }),
        });
        this.currentResponse = "";
        this.currentSteps = [];
        this.isStreaming = false;
        this.abortRequested = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.isStreaming = false;
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
