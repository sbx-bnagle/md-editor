declare module 'pagedjs-esm' {
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(content: DocumentFragment | HTMLElement | string, stylesheets: Array<string | Record<string, string>>, renderTo: HTMLElement): Promise<{ total: number }>;
  }
  /** Base class for layout hooks; methods named after a hook (e.g. onOverflow) are registered. */
  export class Handler {
    constructor(chunker: unknown, polisher: unknown, caller: unknown);
  }
  export function registerHandlers(...handlers: Array<new (chunker: unknown, polisher: unknown, caller: unknown) => Handler>): void;
}
