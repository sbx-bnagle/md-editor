// The web app's service worker: serves <app>/__asset/<path> (images, fonts and PDFs of the library
// and of the app) from the page that runs the app, which holds the files. Everything else goes to
// the network as usual.

const sw = self as unknown as ServiceWorkerGlobalScope;
const scope = new URL(sw.registration.scope);
const ASSET = `${scope.pathname}__asset/`;
let hostId: string | null = null;

sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

sw.addEventListener('message', (e) => {
  const data = e.data as { type?: string } | null;
  if (data?.type === 'folio-host' && e.source && 'id' in e.source) hostId = (e.source as Client).id;
  if (data?.type === 'folio-claim') e.waitUntil(sw.clients.claim());
});

/** The window running the app (not a preview or print frame). */
async function host(): Promise<Client | null> {
  if (hostId) {
    const c = await sw.clients.get(hostId);
    if (c) return c;
  }
  const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.find((c) => !/\/(preview|print)\.html/.test(new URL(c.url).pathname)) ?? null;
}

async function asset(path: string): Promise<Response> {
  const client = await host();
  if (!client) return new Response('The app is not open.', { status: 503 });
  const reply = await new Promise<{ ok: boolean; bytes?: Uint8Array; type?: string }>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false }), 30_000);
    channel.port1.onmessage = (m) => {
      clearTimeout(timer);
      resolve(m.data);
    };
    client.postMessage({ type: 'folio-asset', path }, [channel.port2]);
  });
  if (!reply.ok || !reply.bytes) return new Response('Not found', { status: 404 });
  return new Response(reply.bytes as BodyInit, { headers: { 'Content-Type': reply.type ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

sw.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(ASSET)) return;
  let path: string;
  try {
    path = `/${url.pathname.slice(ASSET.length).split('/').map(decodeURIComponent).join('/')}`;
  } catch {
    return;
  }
  e.respondWith(asset(path));
});
