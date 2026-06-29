import { observer } from "mobx-react-lite";
import { Suspense, useCallback, useEffect } from "react";
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
  Button,
  Stack,
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
import { RuntimeModeChip } from "../components/RuntimeModeChip";
import { DebugRuntimeChip } from "../components/DebugRuntimeChip";
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
  IconUser,
  IconKey,
  IconDeviceLaptop,
  IconSettings,
  IconSun,
  IconMoonStars,
  IconLogout,
  IconFingerprint,
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
import { isVisibleForRoles, useIsAdmin, VIEW_ROLES } from "../auth/roles";
import {
  useAdmin,
  useAuth,
  useConnection,
  useNotifications,
  useStore,
  useUi,
  useWorkspace,
} from "../stores";
import { NodefonyLogo } from "../components/NodefonyLogo";
import { NAV_GROUPS, PRODUCER_ICONS } from "./navConfig";
import { useResource } from "../hooks";
import {
  PROFILE_ME_ENDPOINT,
  type ProfileSummary,
} from "../routes/profile/profileModel";
import { UserAvatar } from "../routes/users/AvatarUpload";

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

/** Nom de rôle lisible pour la card compte (`ROLE_NODEFONY_DEV` → « Dev »). */
function prettyRole(role: string): string {
  const base = role.replace(/^ROLE_(NODEFONY_)?/, "").replace(/_/g, " ");
  return base.charAt(0) + base.slice(1).toLowerCase();
}

export const AdminLayout = observer(() => {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure(false);
  const auth = useAuth();
  const notifications = useNotifications();
  const store = useStore();
  // Profil self → avatar de la top bar (photo uploadée / Gravatar / initiales).
  // Chargé une fois au montage du shell ; un changement d'avatar dans « Mon
  // compte » apparaît au prochain chargement de la page.
  const profileFetcher = useCallback(
    () => store.api.getAbsolute<ProfileSummary>(PROFILE_ME_ENDPOINT),
    [store],
  );
  const { data: meProfile } = useResource(profileFetcher);
  // Enregistre un passkey pour l'utilisateur connecté (lie une empreinte/clé à
  // son compte). L'annulation de l'invite OS (NotAllowedError) est silencieuse.
  const handleRegisterPasskey = useCallback(async () => {
    try {
      await auth.registerPasskey();
      notifications.notify(
        "success",
        "Vous pouvez désormais vous connecter par empreinte.",
        { title: "Passkey enregistré" },
      );
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "NotAllowedError" || e.name === "AbortError")
      ) {
        return;
      }
      notifications.notify("error", "Échec de l'enregistrement du passkey.", {
        title: "Erreur",
      });
    }
  }, [auth, notifications]);
  const conn = useConnection();
  const ui = useUi();
  const workspace = useWorkspace();
  const admin = useAdmin();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  // WS permanent : ouvert dès le montage du shell (couvre le reload — le
  // cookie de session BFF part seul au handshake, plus de token JS).
  useEffect(() => {
    void conn.connect();
  }, [conn]);

  // Catalogue data plane → groupe « Data plane » auto-généré dans la nav.
  // ⚠️ Endpoint ADMIN (`/nodefony/framework/api/admin`) : ne le charger QUE pour
  // un administrateur. Sinon un simple utilisateur déclenche un 403 inutile à
  // chaque montage du shell (console polluée) — cf chantier « mode user ».
  useEffect(() => {
    if (isAdmin) void admin.loadCatalog();
  }, [admin, isAdmin]);

  // Sync debug bar → Studio : un clic sur une requête dans la barre (event
  // window dispatché par le widget Core `nodefony/debugbar`) ouvre le **Suivi de
  // requête** (`/nodefony/logs/trace/:requestId`) — la vue unifiée par requestId
  // (logs corrélés + profil serveur : phases, requêtes SQL). Découplé via
  // CustomEvent (la barre est vanilla/Shadow DOM, Studio est React).
  useEffect(() => {
    const onSelect = (ev: Event): void => {
      const rid = (ev as CustomEvent<{ requestId?: string }>).detail?.requestId;
      if (!rid) return;
      navigate(`/nodefony/logs/trace/${encodeURIComponent(rid)}`);
    };
    window.addEventListener("nodefony:debugbar:select", onSelect);
    return () =>
      window.removeEventListener("nodefony:debugbar:select", onSelect);
  }, [navigate]);

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
            {/* Mode runtime (env + mono/cluster) + popover infos — à côté du
                titre. Réservé dev/superviseur/admin : ses endpoints (kernel/
                realtime) sont de l'exploitation → un simple user ne les sonde pas
                (0 fetch, 0 403 console). */}
            {isVisibleForRoles(VIEW_ROLES.devops, auth.roles) ? (
              <>
                <RuntimeModeChip />
                <DebugRuntimeChip />
              </>
            ) : null}
            {/* Nom du bureau actif (change au switch d'espace, route workspace). */}
            {loc.pathname.startsWith("/nodefony/workspace") ? (
              <Badge variant="light" color="gray" radius="sm" visibleFrom="sm">
                {workspace.active.label}
              </Badge>
            ) : null}
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
            <HoverCard
              position="bottom-end"
              withArrow
              shadow="lg"
              radius="md"
              width={290}
              openDelay={80}
              closeDelay={120}
            >
              <HoverCard.Target>
                <ActionIcon
                  variant="subtle"
                  radius="xl"
                  aria-label="Mon compte"
                >
                  <UserAvatar
                    profile={
                      meProfile?.profile ?? {
                        email: auth.user?.email ?? undefined,
                      }
                    }
                    identifier={auth.displayName}
                    size={28}
                  />
                </ActionIcon>
              </HoverCard.Target>
              <HoverCard.Dropdown p={0} style={{ overflow: "hidden" }}>
                {/* En-tête identité : avatar + nom + email + rôle */}
                <Group p="md" gap="sm" wrap="nowrap" align="flex-start">
                  <UserAvatar
                    profile={
                      meProfile?.profile ?? {
                        email: auth.user?.email ?? undefined,
                      }
                    }
                    identifier={auth.displayName}
                    size={44}
                  />
                  <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={700} size="sm" truncate>
                      {auth.displayName}
                    </Text>
                    {auth.user?.email && (
                      <Text size="xs" c="dimmed" truncate>
                        {auth.user.email}
                      </Text>
                    )}
                    <Group gap={4} mt={4}>
                      {isAdmin ? (
                        <Badge size="xs" variant="light" color="orange">
                          Administrateur
                        </Badge>
                      ) : auth.roles.length > 0 ? (
                        auth.roles.slice(0, 3).map((r) => (
                          <Badge
                            key={r}
                            size="xs"
                            variant="light"
                            color="brand"
                            style={{ textTransform: "none" }}
                          >
                            {prettyRole(r)}
                          </Badge>
                        ))
                      ) : (
                        <Badge size="xs" variant="light" color="gray">
                          Utilisateur
                        </Badge>
                      )}
                    </Group>
                  </Stack>
                </Group>

                <Divider />

                {/* Compte (self-service, accessible à tous) */}
                <Stack gap={0} py={4}>
                  <NavLink
                    label="Mon profil"
                    leftSection={<IconUser size={16} />}
                    component={RouterNavLink}
                    to="/nodefony/profile"
                  />
                  <NavLink
                    label="Mes clés API"
                    leftSection={<IconKey size={16} />}
                    component={RouterNavLink}
                    to="/nodefony/api-keys"
                  />
                  <NavLink
                    label="Mes sessions"
                    leftSection={<IconDeviceLaptop size={16} />}
                    component={RouterNavLink}
                    to="/nodefony/sessions"
                  />
                  <NavLink
                    label="Ajouter une passkey"
                    leftSection={<IconFingerprint size={16} />}
                    onClick={handleRegisterPasskey}
                  />
                  {isAdmin && (
                    <NavLink
                      label="Réglages"
                      leftSection={<IconSettings size={16} />}
                      component={RouterNavLink}
                      to="/nodefony/settings"
                    />
                  )}
                </Stack>

                <Divider />

                {/* Déconnexion (action de fin, mise en avant) */}
                <Box p="xs">
                  <Button
                    fullWidth
                    size="xs"
                    variant="light"
                    color="red"
                    leftSection={<IconLogout size={14} />}
                    onClick={() => auth.logout()}
                  >
                    Déconnexion
                  </Button>
                </Box>
              </HoverCard.Dropdown>
            </HoverCard>
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
            // Gating par rôle (ADMIN voit tout via `isVisibleForRoles`) : le
            // groupe entier peut être réservé (`g.roles`), et chaque item l'est
            // finement (`i.roles`). Un groupe sans item visible disparaît.
            if (g.roles && !isVisibleForRoles(g.roles, auth.roles)) return null;
            const visible = g.items.filter((i) =>
              isVisibleForRoles(i.roles, auth.roles),
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
                <Collapse expanded={!collapsed}>
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
                <Collapse expanded={!collapsed}>
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
        // 1. Réserve la hauteur de la debug bar (var publiée par `nodefony/debugbar`)
        //    → le contenu n'est jamais masqué par la barre. 0 si barre absente/masquée.
        // 2. Scroll INTERNE au Main : la scrollbar verticale commence SOUS l'AppShell.Header
        //    (au lieu de courir sur tout le viewport en traversant le Header). `height = 100dvh
        //    - header` + `overflow-y: auto` ; `padding-top: 0` annule le padding Mantine
        //    par défaut (qui se cale par-dessus le Header), `margin-top` le remplace pour
        //    pousser le Main sous le Header. Les `PageHeader sticky` enfants sont à `top: 0`
        //    (relatif au nouveau scroll-ancestor Main).
        style={{
          paddingTop: 0,
          marginTop: "var(--app-shell-header-height, 56px)",
          height: "calc(100dvh - var(--app-shell-header-height, 56px))",
          // 🔑 Mantine pose un `min-height` ≈ pleine hauteur sur Main qui ÉCRASE
          // le `height` ci-dessus → Main grandit avec le contenu → il ne scrolle
          // jamais (c'est le body qui scrolle) → tout `position: sticky` enfant
          // est piégé dans un conteneur non scrollé = jamais figé. `minHeight: 0`
          // laisse `height` plafonner Main → scroll INTERNE → les PageHeader/
          // Tabs.List sticky fonctionnent enfin (sur TOUTES les pages).
          minHeight: 0,
          overflowY: "auto",
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
