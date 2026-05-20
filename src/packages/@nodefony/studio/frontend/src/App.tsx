import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";

import { StoreProvider, RootStore, useAuth } from "./stores";
import { studioTheme } from "./theme";
import { AuthGuard } from "./components/AuthGuard";
import { AuthLayout } from "./layouts/AuthLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { Login } from "./routes/Login";
import { Dashboard } from "./routes/Dashboard";
import { Chat } from "./routes/Chat";
import { Logs } from "./routes/Logs";
import { System } from "./routes/System";
import { Modules } from "./routes/Modules";
import {
  Sessions,
  Users,
  Routes,
  Firewall,
  Databases,
  Services,
  Npm,
  Pm2,
  Profiling,
  Migrate,
  Settings,
  NotFound,
} from "./routes/stubs";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";

// Singleton — partagé par tout le sous-arbre via le StoreProvider context.
const rootStore = new RootStore();

const router = createBrowserRouter([
  {
    path: "/nodefony/login",
    element: <Login />,
  },
  {
    path: "/nodefony",
    element: <AuthGuard />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "chat", element: <Chat /> },
          { path: "sessions", element: <Sessions /> },
          { path: "users", element: <Users /> },
          { path: "routes", element: <Routes /> },
          { path: "logs", element: <Logs /> },
          { path: "system", element: <System /> },
          { path: "firewall", element: <Firewall /> },
          { path: "databases", element: <Databases /> },
          { path: "migrate", element: <Migrate /> },
          { path: "services", element: <Services /> },
          { path: "modules", element: <Modules /> },
          { path: "npm", element: <Npm /> },
          { path: "pm2", element: <Pm2 /> },
          { path: "profiling", element: <Profiling /> },
          { path: "settings", element: <Settings /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
  { path: "/", element: <Navigate to="/nodefony" replace /> },
  { path: "*", element: <Navigate to="/nodefony" replace /> },
]);

/**
 * SessionBootstrap — au mount, tente un GET /me silencieux si un token
 * traîne en localStorage. Doit être dans le sous-arbre du StoreProvider.
 */
const SessionBootstrap = observer(
  ({ children }: { children: React.ReactNode }) => {
    const auth = useAuth();
    useEffect(() => {
      void auth.checkSession();
    }, [auth]);
    return <>{children}</>;
  },
);

export function App() {
  return (
    <MantineProvider theme={studioTheme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <ModalsProvider>
        <StoreProvider value={rootStore}>
          <SessionBootstrap>
            <RouterProvider router={router} />
          </SessionBootstrap>
        </StoreProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default App;
