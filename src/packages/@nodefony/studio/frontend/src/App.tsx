import { lazy, useEffect } from "react";
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
import { buildStudioTheme } from "./theme";
import { AuthGuard } from "./components/AuthGuard";
import { AuthLayout } from "./layouts/AuthLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { Login } from "./routes/Login";

// Lazy-load des pages (code-splitting) : le bundle initial ne charge que le
// shell + Login ; chaque page arrive à la demande. Exports nommés → on remappe
// vers `default` (contrat React.lazy). Le fallback Suspense vit dans AdminLayout.
const Dashboard = lazy(() =>
  import("./routes/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Chat = lazy(() =>
  import("./routes/Chat").then((m) => ({ default: m.Chat })),
);
const Logs = lazy(() =>
  import("./routes/Logs").then((m) => ({ default: m.Logs })),
);
const System = lazy(() =>
  import("./routes/System").then((m) => ({ default: m.System })),
);
const Modules = lazy(() =>
  import("./routes/Modules").then((m) => ({ default: m.Modules })),
);
const ModuleDetail = lazy(() =>
  import("./routes/ModuleDetail").then((m) => ({ default: m.ModuleDetail })),
);
const RoutesView = lazy(() =>
  import("./routes/RoutesView").then((m) => ({ default: m.RoutesView })),
);

import {
  Sessions,
  Users,
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
          { path: "routes", element: <RoutesView /> },
          { path: "logs", element: <Logs /> },
          { path: "system", element: <System /> },
          { path: "firewall", element: <Firewall /> },
          { path: "databases", element: <Databases /> },
          { path: "migrate", element: <Migrate /> },
          { path: "services", element: <Services /> },
          { path: "modules", element: <Modules /> },
          { path: "modules/:name", element: <ModuleDetail /> },
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

/**
 * Le thème Mantine dépend de `ui.palette` (réversible à chaud). Le
 * `MantineProvider` étant au-dessus du `StoreProvider`, on lit le `rootStore`
 * singleton directement ; `observer` re-render le provider au toggle de palette.
 */
export const App = observer(() => {
  const theme = buildStudioTheme(rootStore.ui.palette);
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
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
});

export default App;
