declare module 'pagedjs-esm' {
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(content: DocumentFragment | HTMLElement | string, stylesheets: Array<string | Record<string, string>>, renderTo: HTMLElement): Promise<{ total: number }>;
  }
}
