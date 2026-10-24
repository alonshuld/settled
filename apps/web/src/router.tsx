import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGate } from '@/components/layout/AuthGate';
import { Boot } from '@/components/layout/Boot';
import { NotFound } from '@/components/layout/NotFound';
import { Splash } from '@/features/shell/Splash';

/** Each screen lives in its own module exporting `Component`, so it is code-split per route. */
const lazy = (load: () => Promise<{ Component: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).Component }),
});

export const routes: RouteObject[] = [
  {
    element: <Boot />,
    HydrateFallback: Splash,
    children: [
      { path: 'login', ...lazy(() => import('@/features/auth/LoginPage')) },
      // Public: an invite link works before sign-in; the page sends the user to /login (with ?next) to join.
      { path: 'j/:code?', ...lazy(() => import('@/features/invites/JoinPage')) },
      {
        element: <AuthGate />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, ...lazy(() => import('@/features/groups/GroupsPage')) },
              { path: 'groups/new', ...lazy(() => import('@/features/groups/NewGroupPage')) },
              { path: 'groups/:id', ...lazy(() => import('@/features/groups/GroupPage')) },
              { path: 'groups/:id/expenses/new', ...lazy(() => import('@/features/expenses/AddExpensePage')) },
              { path: 'groups/:id/expenses/:eid/edit', ...lazy(() => import('@/features/expenses/AddExpensePage')) },
              { path: 'groups/:id/settle', ...lazy(() => import('@/features/settle/SettlePage')) },
              { path: 'activity', ...lazy(() => import('@/features/activity/ActivityPage')) },
              { path: 'settings', ...lazy(() => import('@/features/settings/SettingsPage')) },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
