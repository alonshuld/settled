import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { GroupDetail } from '@/api/groupDetail';
import { i18n } from '@/lib/i18n';
import { ExpenseForm } from './ExpenseForm';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api', async () => {
  const { unwrap } = await import('@settled/api-client');
  return { unwrap, api: { POST: (...a: unknown[]) => post(...a), GET: (...a: unknown[]) => get(...a), PATCH: vi.fn() } };
});

const member = (id: string, displayName: string, isMe = false) => ({
  id,
  displayName,
  color: '#C6F135',
  role: 'member' as const,
  gender: null,
  isPlaceholder: false,
  isMe,
  email: null,
  phone: null,
  joinedAt: null,
  leftAt: null,
});
const group = {
  id: 'g1',
  name: 'Crete trip',
  type: 'trip',
  currency: 'ILS',
  closedAt: null,
  members: [member('a', 'Alon', true), member('b', 'Noa'), member('c', 'Itay')],
} as unknown as GroupDetail;

function setup() {
  const router = createMemoryRouter(
    [
      { path: '/groups/:id/expenses/new', element: <ExpenseForm group={group} /> },
      { path: '/groups/:id', element: <output>group page</output> },
    ],
    { initialEntries: ['/groups/g1/expenses/new'] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('ExpenseForm', () => {
  beforeEach(async () => {
    post.mockReset();
    get.mockReset();
    get.mockResolvedValue({ data: [], response: { ok: true } });
    post.mockResolvedValue({ data: { id: 'e1' }, response: { ok: true } });
    await i18n.changeLanguage('en');
  });

  it('shows inline errors instead of saving an empty form', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole('button', { name: 'Save expense' })[0]!);
    expect(screen.getByText('Enter an amount.')).toBeInTheDocument();
    expect(screen.getByText('Say what the expense was for.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('previews equal shares live, with the leftover cent on the payer', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Amount'), '100');
    expect(screen.getByRole('button', { name: /You.*₪33\.34/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Noa.*₪33\.33/ })).toBeInTheDocument();
    expect(screen.getByText('Others will owe you ⁦₪66.66⁩')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Noa.*₪33\.33/ }));
    expect(screen.getByRole('button', { name: /Noa.*not included/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Itay.*₪50/ })).toBeInTheDocument();
  });

  it('tells you when exact amounts do not add up and blocks saving', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.type(screen.getByLabelText('What was it for?'), 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Exact' }));
    await user.type(screen.getByLabelText('You'), '60');
    await user.type(screen.getByLabelText('Noa'), '30');
    expect(screen.getByRole('status')).toHaveTextContent('⁦₪10⁩ left to assign');
    await user.click(screen.getAllByRole('button', { name: 'Save expense' })[0]!);
    expect(post).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Itay'), '10');
    expect(screen.getByRole('status')).toHaveTextContent('Amounts add up');
  });

  it('posts the payload with an idempotency key and goes back to the group', async () => {
    const user = userEvent.setup();
    const router = setup();
    await user.type(screen.getByLabelText('Amount'), '90');
    await user.type(screen.getByLabelText('What was it for?'), 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Shares' }));
    await user.click(screen.getByRole('button', { name: 'More: Noa' }));
    await user.click(screen.getAllByRole('button', { name: 'Save expense' })[0]!);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, init] = post.mock.calls[0]!;
    expect(path).toBe('/groups/{groupId}/expenses');
    expect(init.params).toEqual({ path: { groupId: 'g1' } });
    expect(init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.body).toEqual({
      amount: 9000,
      currency: 'ILS',
      description: 'Dinner',
      category: 'food',
      paidByMemberId: 'a',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      receiptKey: null,
      split: { mode: 'shares', shares: { a: 1, b: 2, c: 1 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'));
  });

  it('asks before discarding unsaved changes', async () => {
    const user = userEvent.setup();
    const router = setup();
    await user.type(screen.getByLabelText('What was it for?'), 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/expenses/new');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'));
  });
});
