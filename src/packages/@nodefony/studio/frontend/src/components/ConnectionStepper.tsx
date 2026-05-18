import { Stepper, ThemeIcon } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";

export type ConnectionStep = "ping" | "auth" | "user" | "realtime" | "done";
export type StepStatus = "idle" | "active" | "ok" | "error";

const ORDER: ConnectionStep[] = ["ping", "auth", "user", "realtime"];
const LABELS: Record<ConnectionStep, string> = {
  ping: "Serveur",
  auth: "Authentification",
  user: "Profil",
  realtime: "Realtime",
  done: "Prêt",
};

interface Props {
  /** L'étape actuellement en cours OU la dernière effectuée. */
  active: ConnectionStep;
  /** Statut de l'étape active : `error` = échec, sinon `active` ou `ok`. */
  status: StepStatus;
  /** Sous-étapes déjà terminées avec succès. */
  completed: ConnectionStep[];
}

/**
 * ConnectionStepper — visualise les 4 étapes du login Studio.
 *  1. Ping serveur (`GET /api/health`)
 *  2. Authentification (`POST /api/auth/login`)
 *  3. Chargement profil (`GET /api/auth/me`)
 *  4. Connexion realtime (WS via `RealtimeClient` — stub P13)
 */
export function ConnectionStepper({ active, status, completed }: Props) {
  const idx = ORDER.indexOf(active);
  return (
    <Stepper active={idx < 0 ? 0 : idx} size="sm" allowNextStepsSelect={false}>
      {ORDER.map((step) => {
        const isCompleted = completed.includes(step);
        const isActive = step === active;
        const isError = isActive && status === "error";
        return (
          <Stepper.Step
            key={step}
            label={LABELS[step]}
            color={isError ? "red" : isCompleted ? "teal" : undefined}
            completedIcon={
              isError ? (
                <ThemeIcon color="red" radius="xl" size={22}>
                  <IconX size={14} />
                </ThemeIcon>
              ) : (
                <IconCheck size={14} />
              )
            }
            loading={isActive && status === "active"}
          />
        );
      })}
    </Stepper>
  );
}
