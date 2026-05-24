import { observer } from "mobx-react-lite";
import { Suspense, useEffect } from "react";
import {
  AppShell,
  Box,
  Burger,
  Center,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Text,
  ActionIcon,
  Avatar,
  Menu,
  Badge,
  Collapse,
  Divider,
  Tooltip,
  TextInput,
  UnstyledButton,
  HoverCard,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { RealtimeHubContent } from "../components/RealtimeHubContent";
import { ConnectionOverlay } from "../components/ConnectionOverlay";
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
  NavLink as RouterNavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  IconApi,
  IconSettings,
  IconSun,
  IconMoonStars,
  IconLogout,
  IconPlugConnected,
  IconPlugX,
  IconSearch,
  IconX,
  IconPalette,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutBottombar,
  type Icon,
} from "@tabler/icons-react";
import { hasAnyRole } from "nodefony/roles";
import {
  useAdmin,
  useAuth,
  useConnection,
  useProfiler,
  useUi,
} from "../stores";
import { NodefonyLogo } from "../components/NodefonyLogo";
import { NAV_GROUPS, PRODUCER_ICONS } from "./navConfig";

const RAIL_WIDTH = 68;
const FULL_WIDTH = 264;

/** Un lien de nav — rendu plein (icône + libellé) ou rail (icône + tooltip). */
function NavEntry({
  to,
  label,
  icon: ItemIcon,
  active,
  rail,
  rightSection,
}: {
  to: string;
  label: string;
  icon: Icon;
  active: boolean;
  rail: boolean;
  rightSection?: React.ReactNode;
}) {
  if (rail) {
    return (
      <Tooltip label={label} position="right" withArrow openDelay={200}>
        <NavLink
          component={RouterNavLink}
          to={to}
          active={active}
          variant={active ? "filled" : "subtle"}
          leftSection={<ItemIcon size={20} stroke={1.6} />}
          styles={{
            root: { justifyContent: "center", borderRadius: 8 },
            section: { marginInlineEnd: 0 },
          }}
          mb={2}
        />
      </Tooltip>
    );
  }
  return (
    <NavLink
      component={RouterNavLink}
      to={to}
      label={label}
      active={active}
      variant={active ? "filled" : "subtle"}
      leftSection={<ItemIcon size={18} stroke={1.6} />}
      rightSection={rightSection}
      styles={{ root: { borderRadius: 8 } }}
      mb={2}
    />
  );
}

export const AdminLayout = observer(() => {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const auth = useAuth();
  const conn = useConnection();
  const ui = useUi();
  const admin = useAdmin();
  const profiler = useProfiler();
  const navigate = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  // WS permanent : ouvert dès le montage du shell (couvre reload avec token).
  useEffect(() => {
    void conn.connect(auth.getToken());
  }, [conn, auth]);

  // Catalogue data plane → groupe « Data plane » auto-généré dans la nav.
  useEffect(() => {
    void admin.loadCatalog();
  }, [admin]);

  // Sync debug bar → Studio : un clic sur une requête dans la barre (event
  // window dispatché par le widget Core `nodefony/debugbar`) navigue vers la
  // page Profiler et y sélectionne le requestId. Découplé via CustomEvent (la
  // barre est vanilla/Shadow DOM, Studio est React).
  useEffect(() => {
    const onSelect = (ev: Event): void => {
      const rid = (ev as CustomEvent<{ requestId?: string }>).detail?.requestId;
      if (!rid) return;
      // Navigue avec le requestId en query → la page Profiler lit `?req=` et
      // sélectionne (robuste au timing : pas besoin que le store soit prêt
      // avant le montage de la page). `select` direct en plus pour l'immédiat
      // si on est déjà sur la page.
      navigate(`/nodefony/profiling?req=${encodeURIComponent(rid)}`);
      void profiler.select(rid);
    };
    window.addEventListener("nodefony:debugbar:select", onSelect);
    return () =>
      window.removeEventListener("nodefony:debugbar:select", onSelect);
  }, [navigate, profiler]);

  const rail = ui.rail;
  const q = ui.navQuery.trim().toLowerCase();
  const filtering = q.length > 0;
  const focusNs = params.get("p");

  const matchItem = (to: string, exact?: boolean): boolean =>
    exact
      ? loc.pathname === to
      : loc.pathname === to || loc.pathname.startsWith(to + "/");

  const producers = admin.producers;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: rail ? RAIL_WIDTH : FULL_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !mobileOpened, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" gap="xs">
          <Group gap="xs">
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              size="sm"
              hiddenFrom="sm"
            />
            <Tooltip label={rail ? "Déplier la sidebar" : "Réduire la sidebar"}>
              <ActionIcon
                variant="subtle"
                onClick={() => ui.toggleRail()}
                visibleFrom="sm"
                aria-label="Toggle sidebar"
              >
                {rail ? (
                  <IconLayoutSidebarLeftExpand size={20} />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={20} />
                )}
              </ActionIcon>
            </Tooltip>
            <RouterNavLink
              to="/nodefony"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <Group gap={6} wrap="nowrap">
                <NodefonyLogo height={26} />
                <Text fw={700} size="lg" c="brand">
                  Nodefony{" "}
                  <Text
                    span
                    c={ui.palette === "nodefony" ? "nodefonyCyan" : "orange"}
                    inherit
                  >
                    Studio
                  </Text>
                </Text>
              </Group>
            </RouterNavLink>
          </Group>
          <Group gap="xs">
            {/* Hover = aperçu du hub (abonnements de la PAGE COURANTE, en live —
                la vraie vision par page) ; clic = console Realtime complète. */}
            <HoverCard
              width={380}
              position="bottom-end"
              shadow="md"
              openDelay={150}
              closeDelay={120}
              withinPortal
            >
              <HoverCard.Target>
                <UnstyledButton
                  onClick={() => navigate("/nodefony/hub")}
                  aria-label="Realtime Hub — ouvrir le hub temps réel"
                >
                  <Badge
                    leftSection={
                      conn.isConnected ? (
                        <IconPlugConnected size={12} />
                      ) : (
                        <IconPlugX size={12} />
                      )
                    }
                    color={
                      conn.isConnected
                        ? "teal"
                        : conn.state === "connecting" ||
                            conn.state === "reconnecting"
                          ? "yellow"
                          : conn.state === "error"
                            ? "red"
                            : "gray"
                    }
                    variant="light"
                    rightSection={
                      conn.subscriptionCount > 0 ? (
                        <Badge size="xs" variant="filled" color="brand" circle>
                          {conn.subscriptionCount}
                        </Badge>
                      ) : null
                    }
                    style={{ cursor: "pointer" }}
                  >
                    {conn.state}
                  </Badge>
                </UnstyledButton>
              </HoverCard.Target>
              <HoverCard.Dropdown p="sm">
                <RealtimeHubContent
                  onOpenConsole={() => navigate("/nodefony/hub")}
                />
              </HoverCard.Dropdown>
            </HoverCard>
            <Tooltip
              label={`Palette : ${ui.palette === "nodefony" ? "Nodefony (bleu)" : "Orange"} — cliquer pour basculer`}
            >
              <ActionIcon
                variant="subtle"
                color="brand"
                onClick={() => ui.togglePalette()}
                aria-label="Toggle palette"
              >
                <IconPalette size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={`Debug bar : ${ui.debugBar ? "visible" : "masquée"} — cliquer pour basculer`}
            >
              <ActionIcon
                variant={ui.debugBar ? "light" : "subtle"}
                color="brand"
                onClick={() => ui.toggleDebugBar()}
                aria-label="Toggle debug bar"
              >
                <IconLayoutBottombar size={18} />
              </ActionIcon>
            </Tooltip>
            <ActionIcon
              variant="subtle"
              onClick={() => toggleColorScheme()}
              aria-label="Toggle theme"
            >
              {colorScheme === "dark" ? (
                <IconSun size={18} />
              ) : (
                <IconMoonStars size={18} />
              )}
            </ActionIcon>
            <Menu position="bottom-end" withArrow shadow="md">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label="User menu">
                  <Avatar size={28} radius="xl" color="brand">
                    {auth.displayName.slice(0, 2).toUpperCase()}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{auth.user?.email ?? auth.displayName}</Menu.Label>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconSettings size={14} />}
                  component={RouterNavLink}
                  to="/nodefony/settings"
                >
                  Settings
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconLogout size={14} />}
                  color="red"
                  onClick={() => auth.logout()}
                >
                  Logout
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        p={rail ? 6 : "xs"}
        style={{ display: "flex", flexDirection: "column" }}
      >
        {!rail && (
          <TextInput
            size="xs"
            placeholder="Filtrer la navigation…"
            leftSection={<IconSearch size={14} />}
            value={ui.navQuery}
            onChange={(e) => ui.setNavQuery(e.currentTarget.value)}
            rightSection={
              ui.navQuery ? (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => ui.setNavQuery("")}
                  aria-label="Clear filter"
                >
                  <IconX size={12} />
                </ActionIcon>
              ) : null
            }
            mb="xs"
          />
        )}

        <ScrollArea style={{ flex: 1 }} type="scroll">
          {NAV_GROUPS.map((g) => {
            // Gating par rôle : un item `roles` n'apparaît que si l'utilisateur
            // a au moins un de ces rôles (les dashboards dev/supervision).
            const visible = g.items.filter(
              (i) => !i.roles || hasAnyRole(auth.roles, i.roles),
            );
            const items = filtering
              ? visible.filter((i) => i.label.toLowerCase().includes(q))
              : visible;
            if (items.length === 0) return null;
            const collapsed = !filtering && !rail && ui.isGroupCollapsed(g.id);

            return (
              <Box key={g.id}>
                {rail ? (
                  <Divider my={6} />
                ) : (
                  <UnstyledButton
                    onClick={() => !filtering && ui.toggleGroup(g.id)}
                    style={{ width: "100%" }}
                  >
                    <Group
                      justify="space-between"
                      px="sm"
                      mt="sm"
                      mb={4}
                      gap={4}
                    >
                      <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
                        {g.label}
                      </Text>
                      {!filtering && (
                        <IconChevronRight
                          size={13}
                          style={{
                            transform: collapsed ? "none" : "rotate(90deg)",
                            transition: "transform .15s ease",
                            opacity: 0.5,
                          }}
                        />
                      )}
                    </Group>
                  </UnstyledButton>
                )}
                <Collapse in={!collapsed}>
                  {items.map((item) => (
                    <NavEntry
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      rail={rail}
                      active={matchItem(item.to, item.exact)}
                      rightSection={
                        item.wip ? (
                          <Badge size="xs" variant="light" color="gray">
                            à venir
                          </Badge>
                        ) : undefined
                      }
                    />
                  ))}
                </Collapse>
              </Box>
            );
          })}

          {/* Groupe dynamique : producteurs du data plane admin (catalogue). */}
          {(() => {
            const items = filtering
              ? producers.filter((p) => p.label.toLowerCase().includes(q))
              : producers;
            if (items.length === 0) return null;
            const collapsed =
              !filtering && !rail && ui.isGroupCollapsed("dataplane");
            return (
              <Box>
                {rail ? (
                  <Divider my={6} />
                ) : (
                  <UnstyledButton
                    onClick={() => !filtering && ui.toggleGroup("dataplane")}
                    style={{ width: "100%" }}
                  >
                    <Group
                      justify="space-between"
                      px="sm"
                      mt="sm"
                      mb={4}
                      gap={4}
                    >
                      <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
                        Data plane
                      </Text>
                      {!filtering && (
                        <IconChevronRight
                          size={13}
                          style={{
                            transform: collapsed ? "none" : "rotate(90deg)",
                            transition: "transform .15s ease",
                            opacity: 0.5,
                          }}
                        />
                      )}
                    </Group>
                  </UnstyledButton>
                )}
                <Collapse in={!collapsed}>
                  {items.map((p) => {
                    const ItemIcon =
                      (p.icon && PRODUCER_ICONS[p.icon]) || IconApi;
                    const active =
                      loc.pathname === "/nodefony/system" &&
                      focusNs === p.namespace;
                    return (
                      <NavEntry
                        key={p.namespace}
                        to={`/nodefony/system?p=${p.namespace}`}
                        label={p.label}
                        icon={ItemIcon}
                        rail={rail}
                        active={active}
                        rightSection={
                          <Badge size="xs" variant="light" color="gray">
                            {p.endpoints.length}
                          </Badge>
                        }
                      />
                    );
                  })}
                </Collapse>
              </Box>
            );
          })()}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main
        // Réserve la hauteur de la debug bar (var publiée par `nodefony/debugbar`)
        // → le contenu n'est jamais masqué par la barre. 0 si barre absente/masquée.
        style={{
          paddingBottom:
            "calc(var(--mantine-spacing-md) + var(--nodefony-debugbar-height, 0px))",
        }}
      >
        <ErrorBoundary key={loc.pathname} variant="page">
          <Suspense
            fallback={
              <Center h="60vh">
                <Loader />
              </Center>
            }
          >
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </AppShell.Main>

      <ConnectionOverlay />
    </AppShell>
  );
});
