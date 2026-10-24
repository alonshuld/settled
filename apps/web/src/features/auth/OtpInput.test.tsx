import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';
import { i18n } from '@/lib/i18n';
import { OtpInput } from './OtpInput';

function Harness({ onComplete, error }: { onComplete?: (v: string) => void; error?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} error={error} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const value = () => screen.getByTestId('value').textContent;

describe('OtpInput', () => {
  it('renders six labelled boxes in an LTR group', async () => {
    await i18n.changeLanguage('en');
    render(<Harness />);
    expect(boxes()).toHaveLength(6);
    expect(boxes()[2]).toHaveAccessibleName('Digit 3');
    expect(screen.getByRole('group')).toHaveAttribute('dir', 'ltr');
  });

  it('advances focus as digits are typed and ignores non-digits', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.keyboard('4a8');
    expect(value()).toBe('48');
    expect(boxes()[2]).toHaveFocus();
  });

  it('fills every box from a paste and reports completion once', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await user.click(boxes()[0]!);
    await user.paste('482 916');
    expect(value()).toBe('482916');
    expect(boxes().map((b) => b.value)).toEqual(['4', '8', '2', '9', '1', '6']);
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('482916');
  });

  it('spreads a whole code dropped into one box (autofill)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.paste('123456789');
    expect(value()).toBe('123456');
  });

  it('backspace removes the previous digit from an empty box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.keyboard('123');
    expect(boxes()[3]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(value()).toBe('12');
    expect(boxes()[2]).toHaveFocus();
  });

  it('marks boxes invalid in the error state', () => {
    render(<Harness error />);
    for (const b of boxes()) expect(b).toHaveAttribute('aria-invalid', 'true');
  });
});
