// Cloudflare Pages Function: same-origin proxy of /api/* to the Render API, so session cookies stay first-party.
// _redirects cannot proxy to an external origin on Pages, hence this function. Vercel does not use it (see vercel.json).
// Set API_ORIGIN in the Pages project to override the default.
interface Env {
  API_ORIGIN?: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN ?? 'https://settled-api.onrender.com');
  // redirect: 'manual' so OAuth redirects and Set-Cookie reach the browser untouched.
  return fetch(new Request(target, request), { redirect: 'manual' });
};
