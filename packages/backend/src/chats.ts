// Assistant conversations: one per project (or library folder such as Themes), in its META_DIR.
// The file is left out of version history (history.ts keeps only project.json and project
// themes from META_DIR), of ZIP exports, and of projects made from a template.

import { join } from 'node:path';
import { CHAT_FILE, META_DIR, parseChatTurns, type ChatTurn } from '@mde/core';
import { isDir, readJson, writeJson } from './fsutil';
import { UserError, type LibraryService } from './library';

/** Turns kept in a chat file; older ones are dropped when it is saved. */
const MAX_TURNS = 1000;

export class ChatService {
  constructor(private readonly library: LibraryService) {}

  private async file(root: string): Promise<string> {
    this.library.assertInside(root);
    if (!(await isDir(root))) throw new UserError(`No folder at ${root}.`);
    return join(root, META_DIR, CHAT_FILE);
  }

  async load(root: string): Promise<ChatTurn[]> {
    return parseChatTurns(await readJson<unknown>(await this.file(root), null));
  }

  async save(root: string, turns: ChatTurn[]): Promise<void> {
    const kept = parseChatTurns({ turns }).slice(-MAX_TURNS);
    await writeJson(await this.file(root), { format: 1, turns: kept });
  }
}
