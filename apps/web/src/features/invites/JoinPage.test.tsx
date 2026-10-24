import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { i18n } from '@/lib/i18n';
import { Component } from './JoinPage';

const preview = {
  group: { name: 'Crete trip', type: 'trip', startDate: null, endDate: null, memberCount: 3, expenseCount: 2, totalSpent: 100000, currency: 'ILS' },
  invitedBy: { name: 'Alon', color: '#C6F135' },
  claimable: [
    { memberId: 'm1', displayName: 'Noa', color: '#FFB59A' },
    { memberId: 'm2', displayName: 'Itay', color: '#9CC8FF' },
  ],
};

const mutate = vi.fn();
let session: unknown = null;

vi.mock('@/lib/auth', () => ({ useSession: () => ({ data: session, isPending: false }) }));
vi.mock('@/api/groups', () => ({
  useInvitePreview: () => ({ isPending: false, isError: false, data: preview }),
  useJoinMutation: () => ({ mutate, isPending: false }),
}));

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function setup(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/j/:code?', element: <><Component /><Where /></> },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

const where = () => screen.getByTestId('where').textContent;

describe('JoinPage', () => {
  beforeEach(async () => {
    mutate.mockReset();
    session = null;
    await i18n.changeLanguage('en');
  });

  it('shows the code entry form when there is no code', () => {
    setup('/j');
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    expect(screen.queryByText('Crete trip')).not.toBeInTheDocument();
  });

  it('rejects a malformed code and opens a valid one', async () => {
    const user = userEvent.setup();
    setup('/j');
    await user.type(screen.getByLabelText('Invite code'), 'AB1');
    await user.click(screen.getByRole('button', { name: 'Find group' }));
    expect(screen.getByRole('alert')).toHaveTextContent('6 characters');
    await user.clear(screen.getByLabelText('Invite code'));
    await user.type(screen.getByLabelText('Invite code'), 'kr74qx');
    await user.click(screen.getByRole('button', { name: 'Find group' }));
    expect(where()).toBe('/j/KR7-4QX');
  });

  it('requires picking who you are before joining', async () => {
    const user = userEvent.setup();
    setup('/j/KR74QX');
    const join = screen.getByRole('button', { name: 'Sign in to join' });
    expect(join).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Noa' }));
    expect(join).toBeEnabled();
  });

  it('sends a signed-out visitor to login and back with the claimed member', async () => {
    const user = userEvent.setup();
    setup('/j/KR74QX');
    await user.click(screen.getByRole('button', { name: 'Itay' }));
    await user.click(screen.getByRole('button', { name: 'Sign in to join' }));
    expect(where()).toBe(`/login?next=${encodeURIComponent('/j/KR7-4QX?claim=m2')}`);
  });

  it('joins with the claimed member when signed in', async () => {
    session = { user: { id: 'u1', name: 'Dana' } };
    const user = userEvent.setup();
    setup('/j/KR74QX?claim=m1');
    expect(screen.getByRole('button', { name: 'Noa' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Join as Noa' }));
    expect(mutate).toHaveBeenCalledWith('m1', expect.any(Object));
  });

  it('joins as a new member without a claim', async () => {
    session = { user: { id: 'u1', name: 'Dana' } };
    const user = userEvent.setup();
    setup('/j/KR74QX');
    await user.click(screen.getByRole('button', { name: /someone new/ }));
    await user.click(screen.getByRole('button', { name: 'Join group' }));
    expect(mutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });
});
