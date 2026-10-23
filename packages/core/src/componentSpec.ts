// What a component asks for, for the Insert Component dialog, and the include tag it builds.
//
// A component describes itself in a YAML block at the start of its leading comment:
//
//   {% comment %}
//   ---
//   label: Figure
//   description: An image at a chosen width, with a caption.
//   params:
//     - name: src
//       type: file
//       accept: [png, jpg, svg]
//       required: true
//       help: The image, relative to the document.
//     - name: size
//       type: choice
//       options: [full, wide, half]
//       default: full
//   ---
//   Notes for theme authors.
//   {% endcomment %}
//
// Without that block, the fields are read from the template: each include.name it uses, as text,
// a list (used in a for loop), markdown (markdownify), or on/off (only in conditions), with the
// default from `| default: "…"`.

import { parse as parseYaml } from 'yaml';

export type ComponentParamType = 'text' | 'textarea' | 'choice' | 'boolean' | 'file' | 'variable';

export const COMPONENT_PARAM_TYPES: ComponentParamType[] = ['text', 'textarea', 'choice', 'boolean', 'file', 'variable'];

export interface ComponentParam {
  name: string;
  label: string;
  type: ComponentParamType;
  help?: string;
  required?: boolean;
  /** What the component uses when the field is left empty (text), or the starting state (boolean). */
  default?: string | boolean;
  placeholder?: string;
  /** Choices of a choice field. */
  options?: string[];
  /** File extensions a file field offers (without dots); every file when absent. */
  accept?: string[];
  /** Read from the template rather than described by the theme author. */
  inferred?: boolean;
}

export interface ComponentSpec {
  /** Template file name ("figure.html"). */
  name: string;
  label: string;
  description: string;
  params: ComponentParam[];
  /** Shown on every page (page-includes), not placed in the text. */
  page: boolean;
  /** A mistake in the description block; the fields read from the template are used instead. */
  problem?: string;
}

const PARAM_NAME = /^[\w-]+$/;
const LEADING_COMMENT = /^\s*\{%-?\s*comment\s*-?%\}([\s\S]*?)\{%-?\s*endcomment\s*-?%\}/;

/** "footer-logo" → "Footer logo"; "figure.html" → "Figure". */
export function labelFromName(name: string): string {
  const words = name.replace(/\.html$/, '').replace(/[-_.]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

const asText = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const asList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

/** Fields as the template uses them. */
function inferParams(src: string): ComponentParam[] {
  const body = src.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
  const names: string[] = [];
  for (const m of body.matchAll(/\binclude\.([\w-]+)/g)) if (!names.includes(m[1])) names.push(m[1]);
  return names.map((name) => {
    const n = name.replace(/[-]/g, '\\-');
    const inLoop = new RegExp(String.raw`\{%-?\s*for\s+[\w-]+\s+in\s+include\.${n}\b`).test(body);
    const markdown = new RegExp(String.raw`include\.${n}\s*\|[^}%]*\bmarkdownify\b`).test(body);
    const output = new RegExp(String.raw`\{\{-?[^}]*\binclude\.${n}\b`).test(body) || new RegExp(String.raw`\b[\w-]+\s*=\s*include\.${n}\b`).test(body) || new RegExp(String.raw`\|\s*\w+\s*:\s*include\.${n}\b`).test(body);
    const def = new RegExp(String.raw`include\.${n}\s*\|\s*default:\s*(?:"([^"]*)"|'([^']*)')`).exec(body);
    const type: ComponentParamType = inLoop ? 'variable' : markdown ? 'textarea' : output ? 'text' : 'boolean';
    const param: ComponentParam = { name, label: labelFromName(name), type, inferred: true };
    if (def && type !== 'boolean') param.default = def[1] ?? def[2];
    return param;
  });
}

function readParam(raw: unknown, key?: string): ComponentParam | string {
  const p = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const name = key ?? asText(p.name);
  if (!name || !PARAM_NAME.test(name)) return `a field has no usable name (letters, digits, - and _)`;
  const typeText = asText(p.type) ?? 'text';
  if (!COMPONENT_PARAM_TYPES.includes(typeText as ComponentParamType)) return `“${name}” has the type “${typeText}”; use ${COMPONENT_PARAM_TYPES.join(', ')}`;
  const type = typeText as ComponentParamType;
  const param: ComponentParam = { name, label: asText(p.label) ?? labelFromName(name), type };
  const help = asText(p.help);
  if (help) param.help = help;
  if (p.required === true) param.required = true;
  if (typeof p.default === 'boolean') param.default = p.default;
  else if (asText(p.default) !== undefined) param.default = asText(p.default);
  const placeholder = asText(p.placeholder);
  if (placeholder) param.placeholder = placeholder;
  if (type === 'choice') {
    const options = asList(p.options);
    if (!options?.length) return `“${name}” is a choice without options`;
    param.options = options;
  }
  if (type === 'file') {
    const accept = asList(p.accept)?.map((x) => x.replace(/^\./, '').toLowerCase());
    if (accept?.length) param.accept = accept;
  }
  return param;
}

/** The fields and description of a component template. */
export function componentSpec(name: string, src: string): ComponentSpec {
  const spec: ComponentSpec = { name, label: labelFromName(name), description: '', params: [], page: false };
  const inferred = inferParams(src);
  const comment = LEADING_COMMENT.exec(src)?.[1] ?? null;
  const block = comment === null ? null : /^\s*---[ \t]*\n([\s\S]*?)\n[ \t]*---[ \t]*(?:\n|$)/.exec(comment);
  if (comment !== null && !block) {
    // A plain comment: its first paragraph describes the component.
    spec.description = comment.trim().split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ');
  }
  if (!block) {
    spec.params = inferred;
    return spec;
  }
  let data: unknown;
  try {
    data = parseYaml(block[1]);
  } catch (e) {
    spec.problem = `The description block is not valid YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
    spec.params = inferred;
    return spec;
  }
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  spec.label = asText(d.label) ?? spec.label;
  spec.description = asText(d.description) ?? '';
  spec.page = d.page === true;
  const rawParams = d.params;
  const entries: Array<[unknown, string | undefined]> = Array.isArray(rawParams)
    ? rawParams.map((p) => [p, undefined])
    : rawParams && typeof rawParams === 'object'
      ? Object.entries(rawParams as Record<string, unknown>).map(([k, v]) => [v, k])
      : [];
  const problems: string[] = [];
  for (const [raw, key] of entries) {
    const p = readParam(raw, key);
    if (typeof p === 'string') problems.push(p);
    else if (!spec.params.some((q) => q.name === p.name)) spec.params.push(p);
  }
  // Fields the template uses that the block does not describe still get a field.
  for (const p of inferred) if (!spec.params.some((q) => q.name === p.name)) spec.params.push(p);
  if (problems.length) spec.problem = `In the description block: ${problems.join('; ')}.`;
  return spec;
}

/** A value in an include tag as written: quoted text, or an unquoted word (a variable, true/false, a keyword). */
export interface IncludeTagValue {
  value: string;
  quoted: boolean;
}

const VALUE = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s%"']+`;

/** The component and parameters of an include tag, as written (for editing it). */
export function readIncludeTag(tag: string): { name: string; values: Record<string, IncludeTagValue> } | null {
  const m = /^\{%-?\s*include\s+([\w][\w./-]*\.html)([\s\S]*?)\s*-?%\}$/.exec(tag.trim());
  if (!m) return null;
  const values: Record<string, IncludeTagValue> = {};
  for (const a of m[2].matchAll(new RegExp(String.raw`([\w-]+)\s*=\s*(${VALUE})`, 'g'))) {
    const v = a[2];
    values[a[1]] = v.startsWith('"') || v.startsWith("'") ? { value: v.slice(1, -1).replace(/\\(.)/g, '$1'), quoted: true } : { value: v, quoted: false };
  }
  return { name: m[1], values };
}

/** A value the dialog collected: text, on/off, or (for variable fields) a variable name. */
export type IncludeFieldValue = string | boolean;

const quote = (s: string) => `"${s.replace(/\s*\n\s*/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const VARIABLE_NAME = /^[\w-]+(?:\.[\w-]+)*$/;

/**
 * The include tag for a component and the values from the dialog. Empty fields are left out (the
 * component's default applies), as are on/off fields left at their default. Variable fields are
 * written unquoted, so the component gets the variable's value or list. `extra` keeps parameters
 * the component does not describe, as they were written.
 */
export function includeTag(spec: Pick<ComponentSpec, 'name' | 'params'>, values: Record<string, IncludeFieldValue>, extra: Record<string, IncludeTagValue> = {}): string {
  const parts: string[] = [];
  for (const p of spec.params) {
    const v = values[p.name];
    if (p.type === 'boolean') {
      const on = v === true;
      if (on !== (p.default === true)) parts.push(`${p.name}=${on}`);
      continue;
    }
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text) continue;
    parts.push(`${p.name}=${p.type === 'variable' && VARIABLE_NAME.test(text) ? text : quote(text)}`);
  }
  for (const [name, v] of Object.entries(extra)) {
    if (spec.params.some((p) => p.name === name) || !PARAM_NAME.test(name)) continue;
    parts.push(`${name}=${v.quoted ? quote(v.value) : v.value}`);
  }
  return `{% include ${spec.name}${parts.map((p) => ` ${p}`).join('')} %}`;
}

/** The values to start the dialog with: from an existing tag, else the fields' defaults. */
export function initialValues(spec: ComponentSpec, existing?: Record<string, IncludeTagValue>): Record<string, IncludeFieldValue> {
  const out: Record<string, IncludeFieldValue> = {};
  for (const p of spec.params) {
    const e = existing?.[p.name];
    if (p.type === 'boolean') out[p.name] = e ? e.value === 'true' : p.default === true;
    else if (e) out[p.name] = e.value;
    else out[p.name] = '';
  }
  return out;
}

/** Fields that need a value before the tag is inserted. */
export function missingRequired(spec: ComponentSpec, values: Record<string, IncludeFieldValue>): string[] {
  return spec.params.filter((p) => p.required && p.type !== 'boolean' && !(typeof values[p.name] === 'string' && (values[p.name] as string).trim())).map((p) => p.label);
}
