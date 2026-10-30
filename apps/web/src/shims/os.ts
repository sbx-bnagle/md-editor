// node:os for the backend in the web view. The home folder is the app's container, so the
// default library (~/Documents/Folio Dome Library) is in the app's Documents folder, which the
// Files app shows under On My iPad › Folio Dome.

let home = '/';

export function setHomedir(path: string): void {
  home = path;
}

export function homedir(): string {
  return home;
}

export function userInfo(): { username: string } {
  return { username: '' };
}

export function tmpdir(): string {
  return `${home}/tmp`;
}

export default { homedir, userInfo, tmpdir };
