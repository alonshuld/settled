import { ApiError } from '@settled/api-client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { closeErrorDialog, reportError, showErrorDialog } from '@/lib/errorDialog';
import { i18n } from '@/lib/i18n';
import { ErrorDialog } from './ErrorDialog';

afterEach(() => act(() => closeErrorDialog()));

describe('ErrorDialog', () => {
  it('shows the request id and a retry for server errors', async () => {
    await i18n.changeLanguage('en');
    const retry = vi.fn();
    render(<ErrorDialog />);
    act(() => showErrorDialog(new ApiError(500, 'INTERNAL', 'x', undefined, 'req_abc'), retry));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('req_abc')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('reportError keeps validation-style errors out of the dialog', () => {
    render(<ErrorDialog />);
    act(() => reportError(new ApiError(403, 'FORBIDDEN', 'x')));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
