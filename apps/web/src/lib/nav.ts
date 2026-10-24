/** Only same-origin app paths may be used as a post-login return target (blocks `//evil.com`, `https:` etc.). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return '/';
  return next;
}

export function loginPath(next?: string) {
  const n = safeNext(next);
  return n === '/' ? '/login' : `/login?next=${encodeURIComponent(n)}`;
}
