// Reference files a project gives the AI (an RFP and its addenda, a brief, research notes).
// Files live in the project (usually in References/); project.json lists the ones included.

import { strFromU8, unzipSync } from 'fflate';
import { extname } from './paths';

export const REFERENCES_DIR = 'References';

export type ReferenceKind = 'pdf' | 'docx' | 'text' | 'image';

const KINDS: Record<string, ReferenceKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.csv': 'text',
  '.tsv': 'text',
  '.json': 'text',
  // Image formats Claude accepts.
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
};

export const IMAGE_MEDIA_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export function referenceKind(path: string): ReferenceKind | null {
  return KINDS[extname(path).toLowerCase()] ?? null;
}

export interface ReferenceInfo {
  /** Absolute path. */
  path: string;
  /** Path relative to the project. */
  rel: string;
  kind: ReferenceKind;
  size: number;
  /** PDF page count. */
  pages?: number;
  /** Rough input tokens this file adds to each AI request. */
  tokens: number;
  included: boolean;
  /** Why the file cannot be used, e.g. an encrypted PDF. */
  problem?: string;
}

/** A reference loaded for a request. Drivers turn these into provider content. */
export interface AiAttachment {
  name: string;
  kind: ReferenceKind;
  /** Base64 file data (PDF, image). */
  data?: string;
  mediaType?: string;
  /** Plain text: the file itself, or text extracted from a PDF or Word file. */
  text?: string;
  pages?: number;
}

/**
 * Rough token estimate: about four characters per token for text. A PDF read natively also
 * sends an image of each page; this counts a nominal 1,000 tokens per page for that.
 */
export function estimateReferenceTokens(kind: ReferenceKind, textLength: number, pages = 0): number {
  if (kind === 'image') return 1600;
  return Math.ceil(textLength / 4) + (kind === 'pdf' ? pages * 1000 : 0);
}

/** System prompt note telling the model what the attached references are and how to use them. */
export function referencesSystemNote(names: string[]): string {
  if (!names.length) return '';
  return [
    `The writer attached reference files for this project at the start of the conversation: ${names.map((n) => `“${n}”`).join(', ')}.`,
    'Treat them as source material for the document: take facts, terms and requirements from them, and name the file (and page, for a PDF) when you rely on one.',
    'If the references disagree with each other or with the draft, say so rather than choosing silently. Do not copy long passages unless asked.',
  ].join(' ');
}

/** Text of a .docx file, one paragraph per block (table cells become paragraphs too). */
export function docxText(bytes: Uint8Array): string {
  let xml: string;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
    const doc = files['word/document.xml'];
    if (!doc) return '';
    xml = strFromU8(doc);
  } catch {
    return '';
  }
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');
  const paragraphs: string[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    let text = '';
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
      if (m[1] !== undefined) text += decode(m[1]);
      else text += m[2] === 'tab' ? '\t' : '\n';
    }
    paragraphs.push(text);
  }
  return paragraphs
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
