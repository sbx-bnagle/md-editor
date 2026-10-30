// The web app's storage setup: choose Dropbox or Google Drive, sign in, and choose the library
// folder (the one the Mac app uses, through the Dropbox or Google Drive app on the Mac, or a new
// one). Drawn with the app's own dialog styles, before the app starts.

import { DROPBOX, DropboxProvider, dropboxSignedIn, startDropboxSignIn, type DropboxEndpoints } from './dropbox';
import { DRIVE, DriveProvider, driveSignedIn, driveSignIn, type DriveEndpoints } from './gdrive';
import { savedJson } from './oauth';

export type WebConfig = { kind: 'dropbox'; appKey: string; root: string } | { kind: 'gdrive'; clientId: string; folderId: string; folderPath: string };

/** Values that can be filled in config.json next to the app, so they need not be typed on each device. */
export interface AppDefaults {
  dropboxAppKey?: string;
  googleClientId?: string;
  /** For tests: other addresses for the services. */
  dropboxEndpoints?: DropboxEndpoints;
  driveEndpoints?: DriveEndpoints;
}

const CONFIG_KEY = 'folio.web.config';
const SETUP_KEY = 'folio.web.setup';

export const savedConfig = (): WebConfig | null => savedJson.get<WebConfig>(CONFIG_KEY);
export const saveConfig = (c: WebConfig | null): void => savedJson.set(CONFIG_KEY, c);

export function signedIn(c: WebConfig): boolean {
  return c.kind === 'dropbox' ? dropboxSignedIn() : driveSignedIn();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const button = (label: string, onClick: () => void, primary = false) => el('button', { type: 'button', className: `button${primary ? ' primary' : ''}`, onclick: onClick }, label);

/**
 * Shows the setup and resolves with the chosen storage. Signing in to Dropbox leaves the page and
 * comes back: the setup then continues where it was (call again).
 */
export function runSetup(defaults: AppDefaults, current: WebConfig | null, canCancel: boolean): Promise<WebConfig | null> {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'modal-backdrop folio-setup' });
    const box = el('div', { className: 'modal' });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'folio-setup-title');
    backdrop.append(box);
    document.body.append(backdrop);
    const finish = (c: WebConfig | null) => {
      sessionStorage.removeItem(SETUP_KEY);
      backdrop.remove();
      resolve(c);
    };
    const show = (title: string, ...content: Array<Node | string>) => {
      box.replaceChildren(el('h2', { id: 'folio-setup-title' }, title), ...content);
      (box.querySelector('input, button.primary, button') as HTMLElement | null)?.focus();
    };
    const error = (e: unknown) => el('div', { className: 'modal-error', role: 'alert' } as Partial<HTMLDivElement>, e instanceof Error ? e.message : String(e));
    const actions = (...buttons: HTMLElement[]) => el('div', { className: 'modal-actions' }, ...(canCancel ? [button('Cancel', () => finish(null))] : []), ...buttons);

    const choose = () =>
      show(
        'Where is your library?',
        el('p', { className: 'modal-message' }, 'Folio Dome keeps the library in your own Dropbox or Google Drive, so the Mac app (through the Dropbox or Google Drive app on the Mac) and this web app work on the same files.'),
        el('div', { className: 'folio-setup-choices' }, button('Dropbox', () => dropbox(), true), button('Google Drive', () => drive(), true)),
        actions(),
      );

    const dropbox = (problem?: unknown) => {
      const key = el('input', { type: 'text', value: (current?.kind === 'dropbox' ? current.appKey : '') || defaults.dropboxAppKey || '', spellcheck: false, autocomplete: 'off' });
      show(
        'Dropbox',
        el('p', { className: 'modal-message' }, 'The app key of the Dropbox app registered for Folio Dome (see the web app guide). It can also be put in config.json next to the app.'),
        el('label', { className: 'field' }, el('span', {}, 'App key'), key),
        ...(problem ? [error(problem)] : []),
        actions(
          button('Back', choose),
          button(
            'Sign in with Dropbox',
            () => {
              const appKey = key.value.trim();
              if (!appKey) return dropbox(new Error('Enter the app key.'));
              sessionStorage.setItem(SETUP_KEY, JSON.stringify({ kind: 'dropbox', appKey }));
              startDropboxSignIn(appKey, defaults.dropboxEndpoints ?? DROPBOX).catch((e) => dropbox(e));
            },
            true,
          ),
        ),
      );
    };

    const drive = (problem?: unknown) => {
      const id = el('input', { type: 'text', value: (current?.kind === 'gdrive' ? current.clientId : '') || defaults.googleClientId || '', spellcheck: false, autocomplete: 'off' });
      show(
        'Google Drive',
        el('p', { className: 'modal-message' }, 'The client ID of the Google OAuth client created for Folio Dome (see the web app guide). It can also be put in config.json next to the app.'),
        el('label', { className: 'field' }, el('span', {}, 'Client ID'), id),
        ...(problem ? [error(problem)] : []),
        actions(
          button('Back', choose),
          button(
            'Sign in with Google',
            () => {
              const clientId = id.value.trim();
              if (!clientId) return drive(new Error('Enter the client ID.'));
              driveSignIn(clientId, defaults.driveEndpoints ?? DRIVE).then(
                () => driveFolder(clientId, [{ id: 'root', name: 'My Drive' }]),
                (e) => drive(e),
              );
            },
            true,
          ),
        ),
      );
    };

    /** A folder list: open one, choose this one, or make a new one here. */
    const folderPicker = async (opts: { title: string; where: string; load: () => Promise<Array<{ name: string; open: () => void }>>; choose: () => void; create: (name: string) => Promise<void>; back: () => void }) => {
      show(opts.title, el('p', { className: 'modal-message' }, 'Loading folders…'));
      let rows: Array<{ name: string; open: () => void }>;
      try {
        rows = await opts.load();
      } catch (e) {
        show(opts.title, error(e), actions(button('Back', opts.back)));
        return;
      }
      const name = el('input', { type: 'text', placeholder: 'Folio Dome Library', spellcheck: false, autocomplete: 'off' });
      const list = el('div', { className: 'folio-folder-list' }, ...(rows.length ? rows.map((r) => button(`📁 ${r.name}`, r.open)) : [el('div', { className: 'folio-folder-empty' }, 'No folders here.')]));
      show(
        opts.title,
        el('p', { className: 'modal-message' }, `Open the folder the Mac app uses as its library and choose it, or make a new folder (a new library is set up in it). In: ${opts.where}`),
        list,
        el('label', { className: 'field' }, el('span', {}, 'New folder here'), name),
        actions(
          button('Back', opts.back),
          button('Make Folder', () => {
            const n = name.value.trim() || 'Folio Dome Library';
            opts.create(n).catch((e) => show(opts.title, error(e), actions(button('Back', opts.back))));
          }),
          button('Use This Folder', opts.choose, true),
        ),
      );
    };

    const dropboxFolder = (appKey: string, path: string) => {
      const p = new DropboxProvider(appKey, path, defaults.dropboxEndpoints ?? DROPBOX);
      void folderPicker({
        title: 'Choose the library folder',
        where: `Dropbox${path || '/'}`,
        load: async () => (await p.folders(path)).map((n) => ({ name: n, open: () => dropboxFolder(appKey, `${path}/${n}`) })),
        choose: () => finish({ kind: 'dropbox', appKey, root: path }),
        create: async (n) => finish({ kind: 'dropbox', appKey, root: `${path}/${n}` }),
        back: () => (path ? dropboxFolder(appKey, path.split('/').slice(0, -1).join('/')) : choose()),
      });
    };

    const driveFolder = (clientId: string, trail: Array<{ id: string; name: string }>) => {
      const here = trail[trail.length - 1];
      const p = new DriveProvider(here.id, defaults.driveEndpoints ?? DRIVE);
      void folderPicker({
        title: 'Choose the library folder',
        where: trail.map((t) => t.name).join(' › '),
        load: async () => (await p.folders(here.id)).map((f) => ({ name: f.name, open: () => driveFolder(clientId, [...trail, f]) })),
        choose: () => finish({ kind: 'gdrive', clientId, folderId: here.id, folderPath: trail.slice(1).map((t) => t.name).join('/') || 'My Drive' }),
        create: async (n) => finish({ kind: 'gdrive', clientId, folderId: await p.createFolder(here.id, n), folderPath: [...trail.slice(1).map((t) => t.name), n].join('/') }),
        back: () => (trail.length > 1 ? driveFolder(clientId, trail.slice(0, -1)) : choose()),
      });
    };

    // Back from Dropbox's sign-in page: continue with the folder.
    const resumed = JSON.parse(sessionStorage.getItem(SETUP_KEY) ?? 'null') as { kind: 'dropbox'; appKey: string } | null;
    if (resumed?.kind === 'dropbox' && dropboxSignedIn()) dropboxFolder(resumed.appKey, '');
    else choose();
  });
}

/** Signs in again to the configured service (from a click). Dropbox leaves the page and returns. */
export async function signInAgain(c: WebConfig, defaults: AppDefaults): Promise<void> {
  if (c.kind === 'dropbox') await startDropboxSignIn(c.appKey, defaults.dropboxEndpoints ?? DROPBOX);
  else await driveSignIn(c.clientId, defaults.driveEndpoints ?? DRIVE);
}
