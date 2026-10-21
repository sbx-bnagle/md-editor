import { renderPaged, type PagedInput, type PagedResult } from './render';

declare global {
  interface Window {
    __mdeRender(input: PagedInput): Promise<PagedResult>;
  }
}

window.__mdeRender = (input) => renderPaged(document.getElementById('pages')!, input);
