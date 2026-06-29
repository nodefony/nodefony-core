/**
 * **DebugRuntimeChip** — pastille top-bar signalant un DEBUG RUNTIME CIBLÉ actif.
 *
 * Lit l'état du debug runtime (`GET /nodefony/kernel/api/log/level`) et n'affiche
 * RIEN tant qu'aucun override par-module n'est posé (ergonomie « temps réel
 * calme » : le statique domine la top bar). Dès qu'un module est passé en debug à
 * chaud, une pastille ROUGE apparaît, avec un *breathe* d'opacité **doux**
 * (compositor-only, coupé sous `prefers-reduced-motion`).
 *
 * Au **survol** : un `HoverCard` explique ce qui se passe (modules ciblés, niveau,
 * extinction approchée) → on comprend d'un coup d'œil. **Clic** : ouvre directement
 * le panneau **Logs ▸ Debug** (gérer / éteindre).
 *
 * Sémantique « hot » = overrides PAR MODULE non vides (action runtime délibérée).
 * Le `-d` / `NF__DEBUG` global au boot est déjà surfacé par {@link RuntimeModeChip}.
 *
 * @remarks Pas de canal live encore : re-synchro par poll à cadence calme.
 *   Upgrade prévu = canal realtime `debug:state`.
 */
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Divider,
  Group,
  HoverCard,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { IconBug } from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";

/** État du debug runtime (miroir local de `GET /kernel/api/log/level`). */
interface DebugLevelState {
  globalDebug: boolean;
  overrides: Record<string, number>;
  expiresAt: Record<string, number>;
}

/** Noms RFC 5424 par index (miroir local — l'override stocke un numéro). */
const SEVERITY_NAMES = [
  "EMERGENCY",
  "ALERT",
  "CRITIC",
  "ERROR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
] as const;
const sevName = (n: number): string => SEVERITY_NAMES[n] ?? String(n);
const moduleLabel = (m: string): string => (m === "*" ? "Tous (*)" : m);

/** Reste APPROXIMATIF (calme — pas de tick par seconde dans la top bar). */
function coarseRemaining(at: number | undefined): string {
  if (at === undefined) return "permanent";
  const ms = at - Date.now();
  if (ms <= 0) return "expiré";
  const min = Math.round(ms / 60000);
  return min < 1 ? "< 1 min" : `~${min} min`;
}

/** Cadence de rafraîchissement (calme — un toggle de debug est rare). */
const POLL_MS = 20_000;

// @keyframes injecté une fois (Mantine v9 n'exporte pas `keyframes`).
// OPACITY-only → compositor (0 layout/paint) ; breathe doux, pas un blink dur.
const KF = `
@keyframes nfDebugBreathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}`;
function ensureKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-debug-chip-kf")) return;
  const el = document.createElement("style");
  el.id = "nf-debug-chip-kf";
  el.textContent = KF;
  document.head.appendChild(el);
}

export function DebugRuntimeChip() {
  const store = useStore();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<DebugLevelState>("/nodefony/kernel/api/log/level"),
    [store],
  );
  const { data, reload } = useResource(fetcher);

  useEffect(() => {
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(ensureKeyframes, []);

  const overrides = data?.overrides ?? {};
  const expiresAt = data?.expiresAt ?? {};
  const modules = Object.keys(overrides);
  if (modules.length === 0) return null;

  const label =
    `Debug runtime actif sur ${modules.length} module${modules.length > 1 ? "s" : ""} : ` +
    `${modules.map(moduleLabel).join(", ")} — ouvrir le panneau Debug`;

  return (
    // role=status + aria-live : l'apparition de la pastille (debug allumé) est
    // annoncée au lecteur d'écran. Le <button> garde sa sémantique (enfant).
    <div role="status" aria-live="polite" style={{ display: "inline-flex" }}>
      <HoverCard
        width={264}
        position="bottom-start"
        shadow="md"
        openDelay={120}
        closeDelay={100}
        withinPortal
      >
        <HoverCard.Target>
          <UnstyledButton
            aria-label={label}
            onClick={() => navigate("/nodefony/logs?tab=debug")}
            style={{ lineHeight: 0 }}
          >
            <Badge
              color="red"
              variant="filled"
              leftSection={<IconBug size={12} />}
              style={{
                cursor: "pointer",
                textTransform: "none",
                animation: reducedMotion
                  ? undefined
                  : "nfDebugBreathe 2.4s ease-in-out infinite",
              }}
            >
              debug · {modules.length}
            </Badge>
          </UnstyledButton>
        </HoverCard.Target>

        <HoverCard.Dropdown p="sm">
          <Stack gap="xs">
            <div>
              <Text fw={700} size="sm">
                Debug runtime actif
              </Text>
              <Text size="xs" c="dimmed">
                {modules.length} cible{modules.length > 1 ? "s" : ""} en
                verbosité élevée (s'éteint seul).
              </Text>
            </div>
            <Divider />
            <Stack gap={4}>
              {modules.map((m) => (
                <Group key={m} justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="xs" fw={600} truncate>
                    {moduleLabel(m)}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {sevName(overrides[m])} · {coarseRemaining(expiresAt[m])}
                  </Text>
                </Group>
              ))}
            </Stack>
            <Divider />
            <Text size="xs" c="red" fw={600}>
              Clic → gérer (Logs ▸ Debug)
            </Text>
          </Stack>
        </HoverCard.Dropdown>
      </HoverCard>
    </div>
  );
}
