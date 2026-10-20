import { renderPaged, type PagedInput } from './render';

declare global {
  interface Window {
    __mdeRender(input: PagedInput): Promise<number>;
  }
}

window.__mdeRender = (input) => renderPaged(document.getElementById('pages')!, input);
