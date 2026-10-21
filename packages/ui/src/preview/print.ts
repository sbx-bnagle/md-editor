import { renderPaged, renderWeb, type PagedInput, type PagedResult } from './render';

declare global {
  interface Window {
    __mdeRender(input: PagedInput): Promise<PagedResult>;
    __mdeRenderWeb(input: { html: string; css: string; title: string; lang?: string }): Promise<string>;
  }
}

window.__mdeRender = (input) => renderPaged(document.getElementById('pages')!, input);
window.__mdeRenderWeb = (input) => renderWeb(input);
