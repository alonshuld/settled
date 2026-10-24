const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateInviteCode(random: (max: number) => number = (m) => Math.floor(Math.random() * m)): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[random(ALPHABET.length)];
  return code;
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** Normalises user input; returns null when it can't be a valid code. */
export function parseInviteCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  return code.length === 6 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
