import { useEffect, useState } from 'react';
import { PROVIDER_PRESETS, type AiProviderConfig, type Effort, type Preferences } from '@mde/core';
import { api } from '../api/host';
import { refreshKeyStatus, updatePrefs } from '../state/prefs';
import { setState, useStore } from '../state/store';
import { CloseIcon } from './icons';

type Tab = 'general' | 'checking' | 'ai';

const EDITOR_FONTS = ['IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Courier New', 'IBM Plex Sans', 'Iowan Old Style', 'Charter'];
const EFFORTS: Effort[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}

function General({ prefs }: { prefs: Preferences }) {
  const [name, setName] = useState(prefs.authorName);
  const [font, setFont] = useState(prefs.editorFont);
  return (
    <div className="settings-body">
      <Field label="Your name" help="Recorded as the author of text you type, in documents that also contain AI text.">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => updatePrefs({ authorName: name.trim() })} />
      </Field>
      <div className="field-row">
        <Field label="Editor font" help="Any font installed on this Mac. Falls back to IBM Plex Mono.">
          <input type="text" list="editor-fonts" value={font} onChange={(e) => setFont(e.target.value)} onBlur={() => updatePrefs({ editorFont: font.trim() || 'IBM Plex Mono' })} />
          <datalist id="editor-fonts">
            {EDITOR_FONTS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field label="Size">
          <input type="number" min={10} max={28} value={prefs.editorFontSize} onChange={(e) => updatePrefs({ editorFontSize: Number(e.target.value) || 20 })} />
        </Field>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.recordAuthorship} onChange={(e) => updatePrefs({ recordAuthorship: e.target.checked })} />
        Record authorship (who wrote what) in documents with AI text
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.showAuthorship} onChange={(e) => updatePrefs({ showAuthorship: e.target.checked })} />
        Show AI-written text dimmed (⇧⌘A)
      </label>
    </div>
  );
}

function Checking({ prefs }: { prefs: Preferences }) {
  const set = (k: keyof Preferences['checks'], v: boolean) => updatePrefs({ checks: { ...prefs.checks, [k]: v } });
  return (
    <div className="settings-body">
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.checks.spelling} onChange={(e) => set('spelling', e.target.checked)} />
        Spelling (macOS dictionary) <span className="swatch spelling" />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.checks.grammar} onChange={(e) => set('grammar', e.target.checked)} />
        Grammar (Harper, runs on this Mac) <span className="swatch grammar" />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.checks.style} onChange={(e) => set('style', e.target.checked)} />
        Style guide rules <span className="swatch style" />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={prefs.checks.readability} onChange={(e) => set('readability', e.target.checked)} />
        Highlight hard-to-read sentences <span className="swatch hard" />
      </label>
      <div className="field-row">
        <Field label="Target reading grade" help="Used when the style guide does not set reading-grade.">
          <input type="number" min={4} max={18} value={prefs.readingGrade} onChange={(e) => updatePrefs({ readingGrade: Number(e.target.value) || 10 })} />
        </Field>
      </div>
      <p className="settings-note">AI review underlines appear in amber after you run Review with AI (⌥⌘R).</p>
    </div>
  );
}

function ProviderCard({ p, prefs, hasKey }: { p: AiProviderConfig; prefs: Preferences; hasKey: boolean }) {
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isDefault = prefs.ai.defaultProvider === p.id;
  const update = (patch: Partial<AiProviderConfig>) => updatePrefs({ ai: { ...prefs.ai, providers: prefs.ai.providers.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) } });

  const saveKey = async (value: string | null) => {
    try {
      await api.ai.setKey(p.id, value);
      setKey('');
      await refreshKeyStatus();
      setStatus(null);
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className={`provider-card${isDefault ? ' default' : ''}`}>
      <div className="provider-head">
        <input className="provider-name" value={p.name} onChange={(e) => update({ name: e.target.value })} aria-label="Name" />
        <span className="badge">{p.kind === 'anthropic' ? 'Claude API' : 'OpenAI-compatible'}</span>
        <label className="radio-row">
          <input type="radio" name="default-provider" checked={isDefault} onChange={() => updatePrefs({ ai: { ...prefs.ai, defaultProvider: p.id } })} />
          Use this service
        </label>
      </div>
      <div className="field-row">
        <Field label="Model">
          <input type="text" list={`models-${p.id}`} value={p.model} onChange={(e) => update({ model: e.target.value })} spellCheck={false} />
          <datalist id={`models-${p.id}`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        {p.kind === 'anthropic' && (
          <Field label="Effort">
            <select value={p.effort} onChange={(e) => update({ effort: e.target.value as Effort })}>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e === 'default' ? 'Model default' : e}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label={p.kind === 'anthropic' ? 'Server address (leave empty for api.anthropic.com)' : 'Server address'}>
        <input type="text" value={p.baseUrl} placeholder={p.kind === 'anthropic' ? 'https://api.anthropic.com' : 'http://localhost:11434/v1'} onChange={(e) => update({ baseUrl: e.target.value.trim() })} spellCheck={false} />
      </Field>
      <Field label={`API key${hasKey ? ' (saved in the Keychain)' : p.kind === 'openai-compatible' ? ' (optional for local servers)' : ''}`}>
        <div className="key-row">
          <input type="password" value={key} placeholder={hasKey ? '••••••••••••' : 'Paste key'} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <button className="button small" disabled={!key.trim()} onClick={() => saveKey(key)}>
            Save
          </button>
          {hasKey && (
            <button className="button small" onClick={() => saveKey(null)}>
              Remove
            </button>
          )}
        </div>
      </Field>
      <div className="provider-actions">
        <button
          className="button small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(await api.ai.test(p.id));
            setBusy(false);
          }}
        >
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="button small"
          onClick={async () => {
            try {
              setModels(await api.ai.listModels(p.id));
              setStatus({ ok: true, message: 'Models loaded; pick one in the Model field.' });
            } catch (e) {
              setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
            }
          }}
        >
          Load models
        </button>
        {prefs.ai.providers.length > 1 && (
          <button
            className="button small"
            onClick={async () => {
              await api.ai.setKey(p.id, null).catch(() => undefined);
              const providers = prefs.ai.providers.filter((x) => x.id !== p.id);
              updatePrefs({ ai: { providers, defaultProvider: isDefault ? providers[0].id : prefs.ai.defaultProvider } });
            }}
          >
            Remove service
          </button>
        )}
      </div>
      {status && <div className={status.ok ? 'settings-ok' : 'command-error'}>{status.message}</div>}
    </div>
  );
}

function AiSettings({ prefs }: { prefs: Preferences }) {
  const keyStatus = useStore((s) => s.keyStatus);
  const add = (presetIndex: number) => {
    const preset = PROVIDER_PRESETS[presetIndex];
    const id = `${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    updatePrefs({ ai: { ...prefs.ai, providers: [...prefs.ai.providers, { ...preset, id }] } });
  };
  return (
    <div className="settings-body">
      <p className="settings-note">Text you send to an AI service leaves this Mac. Local servers (Ollama, LM Studio) keep it on your machine. Keys are encrypted with the macOS Keychain.</p>
      {prefs.ai.providers.map((p) => (
        <ProviderCard key={p.id} p={p} prefs={prefs} hasKey={!!keyStatus[p.id]} />
      ))}
      <Field label="Add a service">
        <select value="" onChange={(e) => e.target.value !== '' && add(Number(e.target.value))}>
          <option value="">Choose…</option>
          {PROVIDER_PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const prefs = useStore((s) => s.prefs);
  const [tab, setTab] = useState<Tab>('general');
  useEffect(() => {
    if (!open) return;
    refreshKeyStatus().catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ settingsOpen: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || !prefs) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setState({ settingsOpen: false })}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <div className="segmented" role="tablist">
            {(['general', 'checking', 'ai'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'general' ? 'General' : t === 'checking' ? 'Checking' : 'AI'}
              </button>
            ))}
          </div>
          <button className="icon-button" onClick={() => setState({ settingsOpen: false })} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>
        {tab === 'general' && <General prefs={prefs} />}
        {tab === 'checking' && <Checking prefs={prefs} />}
        {tab === 'ai' && <AiSettings prefs={prefs} />}
      </div>
    </div>
  );
}
