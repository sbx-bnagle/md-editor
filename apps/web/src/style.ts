// Styles the web host adds to the UI: its menus, the storage setup, and touch behaviour.

const CSS = `
html.web .tree-row, html.web button, html.web [role="tab"] { -webkit-touch-callout: none; }
html.web body { -webkit-text-size-adjust: 100%; overscroll-behavior: none; }

.folio-menu-layer { position: fixed; inset: 0; z-index: 10000; }
.folio-menu {
  position: fixed; min-width: 200px; max-width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow-y: auto;
  padding: 5px; border-radius: 9px; background: var(--bg-elev-2, #2a2b2e); border: 1px solid var(--border-strong, #3f4044);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45); color: var(--text, #ecedef); font: 14px/1.3 var(--font-ui, system-ui);
}
.folio-menu-item {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; padding: 6px 10px 6px 4px;
  border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; text-align: left;
}
@media (pointer: coarse) { .folio-menu-item { min-height: 44px; } }
.folio-menu-item:disabled { color: var(--text-faint, #bbbdc2); opacity: 0.6; }
.folio-menu-item:not(:disabled):hover, .folio-menu-item:not(:disabled):focus-visible, .folio-menu-item:not(:disabled):active {
  background: var(--accent-strong, #284fb0); color: #fff; outline: none;
}
.folio-menu-check { width: 16px; flex: none; text-align: center; }
.folio-menu-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.folio-menu-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.folio-menu-arrow { flex: none; margin-left: 12px; opacity: 0.8; }
.folio-menu-sep { height: 1px; margin: 5px 8px; background: var(--border-strong, #3f4044); }

.folio-setup { z-index: 9500; }
.folio-setup-choices { display: flex; gap: 10px; flex-wrap: wrap; margin: 4px 0 12px; }
.folio-setup-choices .button { flex: 1; min-width: 140px; padding: 12px; font-size: 15px; }
.folio-folder-list { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow-y: auto; margin-bottom: 12px; }
.folio-folder-list .button { text-align: left; justify-content: flex-start; }
.folio-folder-empty { color: var(--text-faint, #bbbdc2); font-size: 13px; padding: 8px 0; }
.folio-fatal { position: fixed; inset: 0; z-index: 9800; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: var(--bg, #1a1b1d); color: var(--text, #ecedef); }
.folio-fatal p { max-width: 520px; color: var(--text-dim, #c3c5ca); }
`;

export function addStyles(extra = ''): void {
  document.documentElement.classList.add('web');
  const style = document.createElement('style');
  style.textContent = CSS + extra;
  document.head.append(style);
}
