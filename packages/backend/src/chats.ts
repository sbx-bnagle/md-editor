// Assistant conversations: one per project (or library folder such as Themes), in its META_DIR.
// The file is left out of version history (history.ts keeps only project.json and project
// themes from META_DIR), of ZIP exports, and of projects made from a template.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CHAT_FILE, META_DIR, parseChatTurns, type ChatTurn } from '@mde/core';
import { isDir, writeJson } from './fsutil';
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
    const file = await this.file(root);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      return [];
    }
    try {
      return parseChatTurns(JSON.parse(text)).slice(-MAX_TURNS);
    } catch {
      // A file that cannot be read is kept beside (the next save would replace it), and the chat starts empty.
      await fs.rename(file, `${file}.unreadable-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  async save(root: string, turns: ChatTurn[]): Promise<void> {
    const kept = parseChatTurns({ turns }).slice(-MAX_TURNS);
    await writeJson(await this.file(root), { format: 1, turns: kept });
  }
}
