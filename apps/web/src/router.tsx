import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGate } from '@/components/layout/AuthGate';
import { RouteError } from '@/components/layout/RouteError';
import type { RouteHandle } from '@/components/layout/TitleSync';
import { Boot } from '@/components/layout/Boot';
import { NotFound } from '@/components/layout/NotFound';
import { Splash } from '@/features/shell/Splash';

/** Each screen lives in its own module exporting `Component`, so it is code-split per route. */
const lazy = (
  load: () => Promise<{ Component: React.ComponentType }>,
  title: string,
): Pick<RouteObject, 'lazy' | 'handle'> => ({
  lazy: async () => ({ Component: (await load()).Component }),
  handle: { title } satisfies RouteHandle,
});

export const routes: RouteObject[] = [
  {
    element: <Boot />,
    errorElement: <RouteError />,
    HydrateFallback: Splash,
    children: [
      { path: 'login', ...lazy(() => import('@/features/auth/LoginPage'), 'titles.login') },
      // Public: an invite link works before sign-in; the page sends the user to /login (with ?next) to join.
      { path: 'j/:code?', ...lazy(() => import('@/features/invites/JoinPage'), 'titles.join') },
      {
        element: <AuthGate />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, ...lazy(() => import('@/features/groups/GroupsPage'), 'titles.groups') },
              { path: 'groups/new', ...lazy(() => import('@/features/groups/NewGroupPage'), 'titles.newGroup') },
              { path: 'groups/:id', ...lazy(() => import('@/features/groups/GroupPage'), 'titles.group') },
              { path: 'groups/:id/expenses/new', ...lazy(() => import('@/features/expenses/AddExpensePage'), 'titles.addExpense') },
              { path: 'groups/:id/expenses/:eid/edit', ...lazy(() => import('@/features/expenses/AddExpensePage'), 'titles.editExpense') },
              { path: 'groups/:id/settle', ...lazy(() => import('@/features/settle/SettlePage'), 'titles.settle') },
              { path: 'join/:code?', ...lazy(() => import('@/features/invites/JoinTab'), 'titles.join') },
              { path: 'activity', ...lazy(() => import('@/features/activity/ActivityPage'), 'titles.activity') },
              { path: 'settings', ...lazy(() => import('@/features/settings/SettingsPage'), 'titles.settings') },
              { path: '*', element: <NotFound />, handle: { title: 'titles.notFound' } satisfies RouteHandle },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
