import { createContext, useContext, type Context } from "react";
import { RootStore } from "./RootStore";

export { RootStore };

// Contexte ÉPINGLÉ sur `globalThis` (singleton du realm), PAS une simple
// `const` de module. Pourquoi : en dev, Vite peut réévaluer ce module (HMR
// `?t=…`, ou duplication de graphe quand Studio est servi par le serveur Vite
// d'un autre bundle). Une `const createContext()` recréerait alors un NOUVEL
// objet de contexte : le `<StoreProvider>` monté tôt (App.tsx) garderait l'objet
// A tandis qu'une page lazy chargée APRÈS (TraceView) importerait l'objet B →
// `useContext(B)` ne voit pas le Provider de A → « useStore() outside provider »
// alors que l'arbre EST enveloppé. L'épingle garantit UN seul objet de contexte,
// réutilisé par toute réévaluation/duplication → l'erreur disparaît à la racine.
const STORE_CTX_KEY = "__nfStudioStoreContext__";
const g = globalThis as typeof globalThis & {
  [STORE_CTX_KEY]?: Context<RootStore | null>;
};
const StoreContext: Context<RootStore | null> =
  g[STORE_CTX_KEY] ??
  (g[STORE_CTX_KEY] = createContext<RootStore | null>(null));

export const StoreProvider = StoreContext.Provider;

export function useStore(): RootStore {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error(
      "useStore() called outside <StoreProvider>. Wrap your tree with StoreProvider.",
    );
  }
  return ctx;
}

export const useAuth = () => useStore().auth;
export const useUi = () => useStore().ui;
export const useConnection = () => useStore().connection;
export const useChat = () => useStore().chat;
export const useAdmin = () => useStore().admin;
export const useProfiler = () => useStore().profiler;
export const useNotifications = () => useStore().notifications;
export const useWorkspace = () => useStore().workspace;
