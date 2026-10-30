// Sign-in helpers. Dropbox: authorization code with PKCE, by redirecting this page (the app has no
// secret to keep). Google: an access token from a pop-up window (oauth.html posts it back).

const enc = new TextEncoder();

export function randomString(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64Url(b);
}

export function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

/** Where sign-in pages send the user back to: oauth.html next to the app. */
export function redirectUri(): string {
  return new URL('oauth.html', location.href).href.split('?')[0].split('#')[0];
}

/**
 * Opens `url` in a pop-up and waits for oauth.html there to post back the result (the query and
 * hash of the address it was opened with). Must be called from a click.
 */
export function popupSignIn(url: string, expectedState: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'folio-sign-in', 'width=520,height=680');
    if (!popup) return reject(new Error('The sign-in window was blocked. Allow pop-ups for this page and try again.'));
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'folio-oauth') return;
      const params = new URLSearchParams(String(e.data.params ?? ''));
      if (params.get('state') !== expectedState) return;
      cleanup();
      if (params.get('error')) reject(new Error(params.get('error_description') || params.get('error') || 'Sign-in failed.'));
      else resolve(params);
    };
    const timer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('The sign-in window was closed.'));
      }
    }, 500);
    const cleanup = () => {
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
  });
}

/** Saved sign-in details (this browser only). */
export const savedJson = {
  get<T>(key: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  },
};
