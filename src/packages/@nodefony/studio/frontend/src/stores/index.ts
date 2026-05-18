import { createContext, useContext } from "react";
import { RootStore } from "./RootStore";

export { RootStore };

const StoreContext = createContext<RootStore | null>(null);

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
