import { observer } from "mobx-react-lite";
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  ScrollArea,
  Text,
  ActionIcon,
  Avatar,
  Menu,
  Badge,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavLink as RouterNavLink, Outlet, useLocation } from "react-router-dom";
import {
  IconDashboard,
  IconUsers,
  IconRoute,
  IconList,
  IconShieldLock,
  IconDatabase,
  IconBox,
  IconBrandReact,
  IconActivityHeartbeat,
  IconBrandNpm,
  IconAffiliate,
  IconChartBar,
  IconArrowsExchange,
  IconMessageChatbot,
  IconSettings,
  IconSun,
  IconMoonStars,
  IconLogout,
  IconPlugConnected,
  IconPlugX,
} from "@tabler/icons-react";
import { useAuth, useConnection } from "../stores";

interface NavItem {
  to: string;
  label: string;
  icon: typeof IconDashboard;
  group?: string;
}

const NAV: NavItem[] = [
  { to: "/nodefony", label: "Dashboard", icon: IconDashboard, group: "Overview" },
  { to: "/nodefony/chat", label: "Chat IA", icon: IconMessageChatbot, group: "Overview" },

  { to: "/nodefony/sessions", label: "Sessions", icon: IconList, group: "Runtime" },
  { to: "/nodefony/users", label: "Users", icon: IconUsers, group: "Runtime" },
  { to: "/nodefony/routes", label: "Routes", icon: IconRoute, group: "Runtime" },
  { to: "/nodefony/logs", label: "Logs", icon: IconList, group: "Runtime" },
  { to: "/nodefony/firewall", label: "Firewall", icon: IconShieldLock, group: "Runtime" },

  { to: "/nodefony/databases", label: "Databases", icon: IconDatabase, group: "Data" },
  { to: "/nodefony/migrate", label: "Migrations", icon: IconArrowsExchange, group: "Data" },

  { to: "/nodefony/services", label: "Services", icon: IconAffiliate, group: "System" },
  { to: "/nodefony/modules", label: "Modules", icon: IconBox, group: "System" },
  { to: "/nodefony/npm", label: "NPM", icon: IconBrandNpm, group: "System" },
  { to: "/nodefony/pm2", label: "PM2", icon: IconBrandReact, group: "System" },
  { to: "/nodefony/profiling", label: "Profiling", icon: IconChartBar, group: "System" },

  { to: "/nodefony/settings", label: "Settings", icon: IconSettings, group: "Account" },
];

const GROUPS = ["Overview", "Runtime", "Data", "System", "Account"] as const;

export const AdminLayout = observer(() => {
  const [opened, { toggle }] = useDisclosure(true);
  const auth = useAuth();
  const conn = useConnection();
  const loc = useLocation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 260,
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" gap="xs">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} size="sm" />
            <Text fw={700} size="lg" component={RouterNavLink} to="/nodefony" style={{ textDecoration: "none", color: "inherit" }}>
              Nodefony <Text span c="orange" inherit>Studio</Text>
            </Text>
          </Group>
          <Group gap="xs">
            <Tooltip label={conn.isConnected ? "Realtime connecté" : `Realtime: ${conn.state}`}>
              <Badge
                leftSection={conn.isConnected ? <IconPlugConnected size={12} /> : <IconPlugX size={12} />}
                color={conn.isConnected ? "teal" : conn.state === "connecting" || conn.state === "reconnecting" ? "yellow" : "gray"}
                variant="light"
              >
                {conn.state}
              </Badge>
            </Tooltip>
            <ActionIcon variant="subtle" onClick={() => toggleColorScheme()} aria-label="Toggle theme">
              {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
            <Menu position="bottom-end" withArrow shadow="md">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label="User menu">
                  <Avatar size={28} radius="xl" color="orange">
                    {auth.displayName.slice(0, 2).toUpperCase()}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{auth.user?.email ?? auth.displayName}</Menu.Label>
                <Menu.Divider />
                <Menu.Item leftSection={<IconSettings size={14} />} component={RouterNavLink} to="/nodefony/settings">
                  Settings
                </Menu.Item>
                <Menu.Item leftSection={<IconLogout size={14} />} color="red" onClick={() => auth.logout()}>
                  Logout
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {GROUPS.map((g) => (
            <div key={g}>
              <Text size="xs" tt="uppercase" c="dimmed" fw={600} pl="sm" mt="md" mb={4}>
                {g}
              </Text>
              {NAV.filter((n) => n.group === g).map((item) => {
                const Icon = item.icon;
                const active =
                  loc.pathname === item.to ||
                  (item.to !== "/nodefony" && loc.pathname.startsWith(item.to));
                return (
                  <NavLink
                    key={item.to}
                    component={RouterNavLink}
                    to={item.to}
                    label={item.label}
                    leftSection={<Icon size={18} stroke={1.6} />}
                    active={active}
                    variant={active ? "filled" : "subtle"}
                  />
                );
              })}
            </div>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
});
