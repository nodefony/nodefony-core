import { observer } from "mobx-react-lite";
import { useState } from "react";
import { Alert, Button, PasswordInput, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle, IconLogin } from "@tabler/icons-react";
import { useNavigate, useLocation } from "react-router-dom";
import { AuthLayout } from "../layouts/AuthLayout";
import {
  ConnectionStepper,
  type ConnectionStep,
  type StepStatus,
} from "../components/ConnectionStepper";
import { useAuth, useConnection, useStore } from "../stores";

/**
 * Page Login — orchestre le flow 4 étapes :
 *   ping → auth → user → realtime → redirect.
 *
 * Pendant le flow, le formulaire est masqué et le `ConnectionStepper`
 * occupe la carte. En cas d'erreur sur une étape, on remet le formulaire
 * avec l'erreur affichée.
 */
export const Login = observer(() => {
  const navigate = useNavigate();
  const loc = useLocation();
  const auth = useAuth();
  const conn = useConnection();
  const store = useStore();

  const [step, setStep] = useState<ConnectionStep>("ping");
  const [status, setStatus] = useState<StepStatus>("idle");
  const [completed, setCompleted] = useState<ConnectionStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    // Auth RÉELLE (session BFF P6 J3) : plus de mock « accepte tout » — en dev,
    // les comptes viennent du banc du module test (admin/secret, user/secret).
    // Jamais de password pré-rempli en dur dans le code.
    initialValues: { username: "admin", password: "" },
    validate: {
      username: (v) => (v.trim().length === 0 ? "Username requis" : null),
      password: (v) => (v.length === 0 ? "Password requis" : null),
    },
  });

  const runFlow = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    setCompleted([]);

    try {
      // 1. Ping
      setStep("ping");
      setStatus("active");
      await store.api.get("/health");
      setCompleted((c) => [...c, "ping"]);

      // 2. Auth
      setStep("auth");
      setStatus("active");
      await auth.login(values);
      setCompleted((c) => [...c, "auth"]);

      // 3. Me (auth.login récupère déjà le user, mais on simule l'étape)
      setStep("user");
      setStatus("active");
      await new Promise((r) => setTimeout(r, 200));
      setCompleted((c) => [...c, "user"]);

      // 4. Realtime
      setStep("realtime");
      setStatus("active");
      await conn.connect();
      setCompleted((c) => [...c, "realtime"]);

      setStep("done");
      setStatus("ok");
      // Accueil LIÉ AU RÔLE : on honore un vrai deep-link (`from`) mais on retombe
      // sur le dashboard du rôle (`homePath`) pour une connexion normale — jamais
      // l'index générique. `auth.homePath` est valide ici (user chargé par login).
      const from = (loc.state as { from?: string } | null)?.from;
      const deepLink =
        from && from !== "/nodefony" && from !== "/nodefony/login";
      navigate(deepLink ? from : auth.homePath, { replace: true });
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      {busy || status === "error" ? (
        <Stack gap="md">
          <ConnectionStepper
            active={step}
            status={status}
            completed={completed}
          />
          {error && (
            <Alert
              color="red"
              icon={<IconAlertCircle size={16} />}
              title="Connexion échouée"
            >
              {error}
            </Alert>
          )}
          {status === "error" && (
            <Button
              variant="default"
              onClick={() => {
                setStatus("idle");
                setError(null);
              }}
            >
              Réessayer
            </Button>
          )}
        </Stack>
      ) : (
        <form onSubmit={form.onSubmit(runFlow)}>
          <Stack gap="md">
            <TextInput
              label="Username"
              placeholder="admin"
              autoComplete="username"
              {...form.getInputProps("username")}
            />
            <PasswordInput
              label="Password"
              placeholder="••••••••"
              autoComplete="current-password"
              {...form.getInputProps("password")}
            />
            <Button
              type="submit"
              leftSection={<IconLogin size={16} />}
              fullWidth
            >
              Connexion
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
});
