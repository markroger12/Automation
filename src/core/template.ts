/**
 * Tiny prompt template engine: {{var}}, {{#if var}}…{{/if}}, {{#unless var}}…{{/unless}} (nestable).
 * Unknown variables render as an empty string.
 */
export type TemplateVars = Record<string, unknown>;

type Node =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string }
  | { type: 'block'; kind: 'if' | 'unless'; name: string; children: Node[] };

const TOKEN = /\{\{\s*(#if|#unless|\/if|\/unless)?\s*([A-Za-z0-9_.-]*)\s*\}\}/g;

function parse(template: string): Node[] {
  const root: Node[] = [];
  const stack: { kind: 'if' | 'unless'; children: Node[] }[] = [];
  let current = root;
  let last = 0;
  for (const m of template.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) current.push({ type: 'text', value: template.slice(last, idx) });
    last = idx + m[0].length;
    const tag = m[1];
    const name = m[2] ?? '';
    if (tag === '#if' || tag === '#unless') {
      const block: Node = { type: 'block', kind: tag === '#if' ? 'if' : 'unless', name, children: [] };
      current.push(block);
      stack.push({ kind: block.kind, children: current });
      current = block.children;
    } else if (tag === '/if' || tag === '/unless') {
      const frame = stack.pop();
      if (!frame) {
        current.push({ type: 'text', value: m[0] });
        continue;
      }
      current = frame.children;
    } else if (name) {
      current.push({ type: 'var', name });
    } else {
      current.push({ type: 'text', value: m[0] });
    }
  }
  if (last < template.length) current.push({ type: 'text', value: template.slice(last) });
  return root;
}

export function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function lookup(vars: TemplateVars, name: string): unknown {
  if (name in vars) return vars[name];
  return name.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), vars);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function render(nodes: Node[], vars: TemplateVars): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'var') out += stringify(lookup(vars, node.name));
    else {
      const t = truthy(lookup(vars, node.name));
      if ((node.kind === 'if' && t) || (node.kind === 'unless' && !t)) out += render(node.children, vars);
    }
  }
  return out;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const rendered = render(parse(template), vars);
  // Blocks that render to nothing leave blank lines behind; keep at most one empty line in a row.
  return rendered.replace(/\n{3,}/g, '\n\n').trim();
}

/** Names of the variables a template uses (for the Prompt Manager). */
export function templateVariables(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    if (m[2] && (!m[1] || m[1] === '#if' || m[1] === '#unless')) names.add(m[2]);
  }
  return [...names];
}
