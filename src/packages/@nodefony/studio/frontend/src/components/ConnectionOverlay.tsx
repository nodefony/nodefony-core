import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Group, Stack, Text } from "@mantine/core";
import {
  IconPlugConnectedX,
  IconReload,
  IconCheck,
  IconBolt,
} from "@tabler/icons-react";
import { useConnection } from "../stores";
import { NodefonyLogo } from "./NodefonyLogo";

// @keyframes injectés une fois (Mantine v8 n'exporte pas `keyframes`).
const KF = `
@keyframes nfConnPing {
  0% { transform: scale(0.55); opacity: 0.65; }
  80% { opacity: 0; }
  100% { transform: scale(2.6); opacity: 0; }
}
@keyframes nfConnSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes nfConnBreathe {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}
`;
function ensureKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-conn-overlay-kf")) return;
  const el = document.createElement("style");
  el.id = "nf-conn-overlay-kf";
  el.textContent = KF;
  document.head.appendChild(el);
}

/** Un anneau radar absolu (réutilisé 3× avec un délai décalé). */
function Ring({ color, delay }: { color: string; delay: string }) {
  return (
    <Box
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        animation: "nfConnPing 2.4s cubic-bezier(0,0.2,0.2,1) infinite",
        animationDelay: delay,
      }}
    />
  );
}

/**
 * Overlay plein écran affiché quand la connexion temps réel au serveur est
 * rompue (serveur coupé) — UX digne d'un framework realtime : backdrop flouté,
 * radar pulsé (battement serveur perdu), **compte à rebours live** synchronisé
 * au backoff réel du `RealtimeClient`, reconnexion auto + bouton « réessayer »,
 * et **flash vert** à la reprise. Ne s'affiche qu'après une 1ʳᵉ connexion
 * réussie (pas pendant le boot initial). Source de vérité = `ConnectionStore`.
 */
export const ConnectionOverlay = observer(() => {
  const conn = useConnection();
  const down = conn.isDown;
  const [now, setNow] = useState(() => Date.now());
  const [recovered, setRecovered] = useState(false);
  const prevDown = useRef(false);

  ensureKeyframes();

  // Tick 4×/s pour le compte à rebours, uniquement quand l'overlay est visible.
  useEffect(() => {
    if (!down) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [down]);

  // Flash de reprise quand on repasse down → connecté.
  useEffect(() => {
    if (prevDown.current && !down) {
      setRecovered(true);
      const t = window.setTimeout(() => setRecovered(false), 1600);
      prevDown.current = down;
      return () => window.clearTimeout(t);
    }
    prevDown.current = down;
  }, [down]);

  if (!down && !recovered) return null;

  const isError = conn.state === "error";
  // Bleu doux pour la reconnexion (calme, « syncing ») — orange réservé aux
  // vrais warnings. Rouge = erreur dure, vert = reconnecté.
  const accent = recovered
    ? "var(--mantine-color-teal-5)"
    : isError
      ? "var(--mantine-color-red-5)"
      : "var(--mantine-color-blue-4)";

  const secsLeft =
    conn.nextRetryAt && !recovered
      ? Math.max(0, Math.ceil((conn.nextRetryAt - now) / 1000))
      : null;

  const title = recovered
    ? "Reconnecté"
    : isError
      ? "Serveur injoignable"
      : conn.state === "reconnecting"
        ? "Reconnexion au serveur…"
        : "Connexion perdue";

  const subtitle = recovered
    ? "Le temps réel est rétabli."
    : secsLeft !== null
      ? secsLeft > 0
        ? `Nouvelle tentative dans ${secsLeft}s`
        : "Tentative en cours…"
      : "Tentative de rétablissement…";

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "color-mix(in srgb, var(--mantine-color-body) 78%, transparent)",
        backdropFilter: "blur(2px) saturate(0.9)",
        WebkitBackdropFilter: "blur(2px) saturate(0.9)",
      }}
    >
      <Box
        style={{
          position: "relative",
          width: 380,
          maxWidth: "90vw",
          padding: "34px 30px 26px",
          borderRadius: 16,
          background: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-default-border)",
          boxShadow: `0 18px 50px -28px ${accent}, var(--mantine-shadow-lg)`,
          overflow: "hidden",
          textAlign: "center",
        }}
      >
        {/* Balayage lumineux en haut de la carte */}
        <Box style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden" }}>
          <Box
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
              animation: "nfConnSweep 1.8s linear infinite",
            }}
          />
        </Box>

        <Stack align="center" gap="md">
          {/* Marque Nodefony Studio */}
          <Group gap={12} align="center" justify="center">
            <NodefonyLogo height={40} />
            <Text
              fw={800}
              size="28px"
              c="dimmed"
              style={{ letterSpacing: 3, textTransform: "uppercase", lineHeight: 1 }}
            >
              Studio
            </Text>
          </Group>

          {/* Radar / heartbeat */}
          <Box style={{ position: "relative", width: 120, height: 120 }}>
            {!recovered && (
              <>
                <Ring color={accent} delay="0s" />
                <Ring color={accent} delay="0.8s" />
                <Ring color={accent} delay="1.6s" />
              </>
            )}
            <Box
              style={{
                position: "absolute",
                inset: 30,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in srgb, ${accent} 18%, transparent)`,
                color: accent,
                animation: recovered ? undefined : "nfConnBreathe 1.6s ease-in-out infinite",
              }}
            >
              {recovered ? <IconCheck size={34} /> : <IconPlugConnectedX size={34} />}
            </Box>
          </Box>

          <Stack gap={4} align="center">
            <Text fw={700} size="xl">
              {title}
            </Text>
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          </Stack>

          {!recovered && (
            <>
              <Group gap="xs" justify="center">
                {conn.reconnectAttempt > 0 && (
                  <Text size="xs" c="dimmed">
                    Tentative #{conn.reconnectAttempt}
                  </Text>
                )}
                {conn.latencyMs !== null && (
                  <Text size="xs" c="dimmed">
                    · dernière latence {conn.latencyMs} ms
                  </Text>
                )}
              </Group>

              <Button
                leftSection={<IconReload size={16} />}
                color={isError ? "red" : "blue"}
                variant="light"
                radius="md"
                onClick={() => conn.retryNow()}
              >
                Réessayer maintenant
              </Button>

              <Group gap={6} justify="center">
                <IconBolt size={12} color="var(--mantine-color-dimmed)" />
                <Text size="xs" c="dimmed" ff="monospace">
                  {conn.endpointUrl || "realtime"}
                </Text>
              </Group>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
});
