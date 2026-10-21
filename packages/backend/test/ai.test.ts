import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { AppEvent } from '@mde/core';
import { createBackend, type Backend, type HostAdapter } from '../src/index';

let server: Server;
let base: string;
const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }> = [];

function sse(events: Array<[string, unknown]>): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const path = (req.url ?? '').split('?')[0];
      seen.push({ url: path, headers: req.headers, body });
      if (path === '/v1/messages') {
        const refuse = JSON.stringify(body).includes('REFUSE');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } };
        res.end(
          sse([
            ['message_start', { type: 'message_start', message: msg }],
            ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } }],
            ['content_block_stop', { type: 'content_block_stop', index: 0 }],
            ['message_delta', { type: 'message_delta', delta: { stop_reason: refuse ? 'refusal' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
            ['message_stop', { type: 'message_stop' }],
          ]),
        );
      } else if (path === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
      } else if (path === '/oa/chat/completions') {
        if (req.headers.authorization !== 'Bearer sk-local') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'bad key' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(
          ['Local', ' model'].map((t) => `data: ${JSON.stringify({ model: 'llama', choices: [{ delta: { content: t } }] })}\n\n`).join('') +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      } else if (path === '/oa/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'llama' }, { id: 'mistral' }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function setup(): Promise<{ backend: Backend; events: AppEvent[]; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'mde-ai-'));
  const events: AppEvent[] = [];
  const secrets = new Map<string, string>();
  const host: HostAdapter = {
    trash: async () => undefined,
    reveal: () => undefined,
    renderPdf: async () => ({ pdf: new Uint8Array(), inserts: [] }),
    chooseSavePath: async () => null,
    chooseFolder: async () => null,
    chooseFiles: async () => [],
    emit: (e) => events.push(e),
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void (v === null ? secrets.delete(k) : secrets.set(k, v)) },
  };
  const backend = await createBackend({ host, settingsPath: join(dir, 'settings.json'), seedDir: join(dir, 'none'), version: 't', platform: 't', libraryPath: join(dir, 'Library') });
  await backend.api.settings.update({
    ai: {
      defaultProvider: 'claude',
      providers: [
        { id: 'claude', kind: 'anthropic', name: 'Claude', baseUrl: base, model: 'claude-opus-5-5', effort: 'medium' },
        { id: 'local', kind: 'openai-compatible', name: 'Local', baseUrl: `${base}/oa`, model: 'llama', effort: 'default' },
      ],
    },
  });
  return { backend, events, dir };
}

describe('AI providers', () => {
  test('Claude: key required, streaming, effort, structured output, models', async () => {
    const { backend, events, dir } = await setup();
    const api = backend.api;
    await expect(api.ai.complete({ purpose: 'test', system: 's', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/Add an API key/);
    await api.ai.setKey('claude', 'sk-ant-test');
    expect(await api.ai.keyStatus()).toEqual({ claude: true, local: false });

    const { id } = await api.ai.start({ purpose: 'inline', system: 'sys', messages: [{ role: 'user', content: 'hi' }], jsonSchema: { type: 'object' } });
    await new Promise((r) => setTimeout(r, 300));
    const mine = events.filter((e) => 'id' in e && e.id === id);
    expect(mine.filter((e) => e.type === 'ai-delta').map((e) => (e as { text: string }).text).join('')).toBe('Hello world');
    expect(mine.at(-1)).toMatchObject({ type: 'ai-done', result: { text: 'Hello world', model: 'claude-opus-5-5', refused: false } });

    const req = seen.filter((s) => s.url === '/v1/messages').at(-1)!;
    expect(req.headers['x-api-key']).toBe('sk-ant-test');
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 64000, stream: true, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    // A custom base URL is not the first-party API, so no fallback parameter is sent.
    expect(req.body.fallbacks).toBeUndefined();

    const refused = await api.ai.complete({ purpose: 'test', system: 's', messages: [{ role: 'user', content: 'REFUSE' }] });
    expect(refused).toMatchObject({ refused: true, text: '' });
    expect(await api.ai.listModels('claude')).toEqual(['claude-opus-5-5']);
    expect(await api.ai.test('claude')).toMatchObject({ ok: true });
    await backend.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test('OpenAI-compatible: auth error, streaming, models', async () => {
    const { backend, dir } = await setup();
    const api = backend.api;
    await api.ai.setKey('local', 'wrong');
    await expect(api.ai.complete({ providerId: 'local', purpose: 'test', system: 's', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/rejected the API key/);
    await api.ai.setKey('local', 'sk-local');
    const r = await api.ai.complete({ providerId: 'local', purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(r).toMatchObject({ text: 'Local model', model: 'llama', stopReason: 'end_turn' });
    const req = seen.filter((s) => s.url === '/oa/chat/completions').at(-1)!;
    expect((req.body.messages as Array<{ role: string }>)[0]).toEqual({ role: 'system', content: 'sys' });
    expect(await api.ai.listModels('local')).toEqual(['llama', 'mistral']);
    await backend.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test('insertion log and guides', async () => {
    const { backend, dir } = await setup();
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'P' });
    await api.ai.logInsertion({ docPath: join(p, 'main.md'), time: 1, model: 'm', mode: 'generate', prompt: 'x', text: 'AI text' });
    expect(await api.ai.insertions(p)).toHaveLength(1);
    const g = await api.guides.create('style', 'House');
    expect(g.path.endsWith('Guides/Styles/House.md')).toBe(true);
    await mkdir(join(dir, 'Library', 'Guides', 'Voices'), { recursive: true });
    await writeFile(join(dir, 'Library', 'Guides', 'Voices', 'Plain.md'), '# Plain');
    expect((await api.guides.list()).map((x) => [x.kind, x.name])).toEqual([
      ['voice', 'Plain'],
      ['style', 'House'],
    ]);
    const prefs = await api.settings.update({ authorName: 'Brad' });
    expect(prefs.authorName).toBe('Brad');
    expect(prefs.ai.providers).toHaveLength(2);
    await backend.dispose();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('reference files', () => {
  test('listed, included, and sent to Claude as documents and to other services as text', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const { zipSync, strToU8 } = await import('fflate');
    const { backend, dir } = await setup();
    const api = backend.api;
    await api.ai.setKey('claude', 'sk-ant-test');
    await api.ai.setKey('local', 'sk-local');
    await api.library.createCollection('Bids');
    const project = await api.library.createProject({ collection: 'Bids', name: 'City RFP' });

    // A one-page PDF, a Word file, a text file and an image outside the project.
    const src = join(dir, 'incoming');
    await mkdir(src, { recursive: true });
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawText('Proposals are due March 3. Include three references.', { x: 72, y: 700, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
    await writeFile(join(src, 'RFP.pdf'), await pdf.save());
    const docXml = '<w:document><w:body><w:p><w:r><w:t>Addendum 1: the deadline moves to March 10.</w:t></w:r></w:p></w:body></w:document>';
    await writeFile(join(src, 'Addendum 1.docx'), zipSync({ 'word/document.xml': strToU8(docXml) }));
    await writeFile(join(src, 'notes.txt'), 'Budget is fixed.');
    await writeFile(join(src, 'scan.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const added = await api.references.add(project, [join(src, 'RFP.pdf'), join(src, 'Addendum 1.docx'), join(src, 'notes.txt'), join(src, 'scan.png')]);
    expect(added.map((p) => p.slice(project.length + 1))).toEqual(['References/RFP.pdf', 'References/Addendum 1.docx', 'References/notes.txt', 'References/scan.png']);

    const list = await api.references.list(project);
    expect(list.map((r) => [r.rel, r.kind, r.included, r.pages])).toEqual([
      ['References/Addendum 1.docx', 'docx', true, undefined],
      ['References/notes.txt', 'text', true, undefined],
      ['References/RFP.pdf', 'pdf', true, 1],
      ['References/scan.png', 'image', true, undefined],
    ]);
    expect(list.find((r) => r.kind === 'pdf')!.tokens).toBeGreaterThan(1000);
    await api.references.setIncluded(project, 'References/notes.txt', false);
    expect((await api.references.list(project)).find((r) => r.rel === 'References/notes.txt')!.included).toBe(false);

    await api.ai.complete({ purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'Summarize the deadline.' }], references: { projectPath: project } });
    const claude = seen.filter((s) => s.url === '/v1/messages').at(-1)!.body as { system: Array<{ text: string }>; messages: Array<{ content: Array<Record<string, unknown>> }> };
    const blocks = claude.messages[0].content;
    expect(blocks.map((b) => b.type)).toEqual(['document', 'document', 'text', 'image', 'text']);
    expect(blocks[0]).toMatchObject({ title: 'References/RFP.pdf', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(blocks[1]).toMatchObject({ title: 'References/Addendum 1.docx', source: { type: 'text', data: 'Addendum 1: the deadline moves to March 10.' } });
    expect(blocks[3]).toMatchObject({ type: 'image', cache_control: { type: 'ephemeral' }, source: { media_type: 'image/png' } });
    expect(blocks[4]).toEqual({ type: 'text', text: 'Summarize the deadline.' });
    expect(claude.system[0].text).toMatch(/attached reference files .*“References\/RFP.pdf”/);

    await api.ai.complete({ providerId: 'local', purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'Summarize.' }], references: { projectPath: project } });
    const local = seen.filter((s) => s.url === '/oa/chat/completions').at(-1)!.body as { messages: Array<{ role: string; content: unknown }> };
    const parts = local.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0].text).toContain('<reference name="References/RFP.pdf">\n[Page 1]\nProposals are due March 3. Include three references.');
    expect(parts[0].text).toContain('<reference name="References/Addendum 1.docx">');
    expect(parts.some((p) => p.image_url?.url.startsWith('data:image/png;base64,'))).toBe(true);
    expect(parts.at(-1)).toEqual({ type: 'text', text: 'Summarize.' });

    // Without references the request is unchanged.
    await api.ai.complete({ providerId: 'local', purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'Plain.' }] });
    expect((seen.filter((s) => s.url === '/oa/chat/completions').at(-1)!.body as { messages: Array<{ content: unknown }> }).messages[1].content).toBe('Plain.');
    await backend.dispose();
  });
});
