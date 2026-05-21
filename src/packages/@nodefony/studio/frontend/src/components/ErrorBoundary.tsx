import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  Box,
  Button,
  Code,
  Collapse,
  Group,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconReload,
  IconRefresh,
  IconHome,
  IconChevronDown,
} from "@tabler/icons-react";

interface Props {
  children: ReactNode;
  /** `"page"` = erreur dans le shell admin (nav conservée) ; `"full"` = racine. */
  variant?: "page" | "full";
}
interface State {
  error: Error | null;
  componentStack: string | null;
  showStack: boolean;
}

/**
 * Filet React : capture toute erreur de rendu d'un sous-arbre et affiche une
 * page Studio **propre** (au lieu de l'écran blanc). Les Error Boundaries DOIVENT
 * être des composants classe (`getDerivedStateFromError` / `componentDidCatch`).
 *
 * Deux usages : `variant="page"` autour de l'`<Outlet>` (le shell admin survit,
 * on peut naviguer ailleurs) ; `variant="full"` à la racine (dernier rempart si
 * le shell lui-même casse). Re-monter le boundary (clé = pathname) le réarme.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, showStack: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Trace console (un transport syslog/Studio pourra s'y brancher plus tard).
    console.error("[Studio] Error boundary caught:", error, info);
  }

  private reset = (): void =>
    this.setState({ error: null, componentStack: null, showStack: false });

  render(): ReactNode {
    const { error, componentStack, showStack } = this.state;
    if (!error) return this.props.children;
    const full = this.props.variant === "full";

    return (
      <Box
        style={{
          minHeight: full ? "100vh" : "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: full ? "var(--mantine-color-body)" : undefined,
        }}
      >
        <Stack
          align="center"
          gap="md"
          style={{
            maxWidth: 560,
            width: "100%",
            padding: "32px 28px",
            borderRadius: 16,
            border: "1px solid var(--mantine-color-red-light)",
            background: "var(--mantine-color-body)",
            boxShadow: "var(--mantine-shadow-md)",
          }}
        >
          <ThemeIcon size={64} radius="xl" variant="light" color="red">
            <IconAlertTriangle size={34} />
          </ThemeIcon>

          <Stack gap={4} align="center">
            <Text fw={700} size="xl">
              Une erreur est survenue
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              Le rendu de cette vue a échoué. Le reste du Studio reste utilisable.
            </Text>
          </Stack>

          <Code
            block
            color="red"
            style={{ width: "100%", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {error.name}: {error.message}
          </Code>

          <Group gap="xs" justify="center">
            <Button
              leftSection={<IconRefresh size={16} />}
              variant="light"
              onClick={this.reset}
            >
              Réessayer
            </Button>
            <Button
              leftSection={<IconReload size={16} />}
              variant="default"
              onClick={() => window.location.reload()}
            >
              Recharger
            </Button>
            <Button
              leftSection={<IconHome size={16} />}
              variant="subtle"
              color="gray"
              onClick={() => window.location.assign("/nodefony")}
            >
              Dashboard
            </Button>
          </Group>

          {(error.stack || componentStack) && (
            <Stack gap={4} style={{ width: "100%" }}>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                rightSection={<IconChevronDown size={12} />}
                onClick={() => this.setState({ showStack: !showStack })}
                style={{ alignSelf: "flex-start" }}
              >
                {showStack ? "Masquer" : "Détails techniques"}
              </Button>
              <Collapse in={showStack}>
                <Code
                  block
                  style={{
                    maxHeight: 240,
                    overflow: "auto",
                    fontSize: 11,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {error.stack}
                  {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
                </Code>
              </Collapse>
            </Stack>
          )}
        </Stack>
      </Box>
    );
  }
}
