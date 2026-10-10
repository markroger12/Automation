'use client';

import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Heading2, Heading3, Pilcrow, Link2, List, Code2, Undo2 } from 'lucide-react';
import { cn } from './ui';

/** Small WYSIWYG for article HTML (headings, paragraphs, bold, italic, links, lists) with an HTML view. */
export function RichEditor({ value, onChange, minHeight = 400 }: { value: string; onChange: (html: string) => void; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);
  const lastValue = useRef(value);

  useEffect(() => {
    if (ref.current && value !== lastValue.current && !source) {
      ref.current.innerHTML = value;
      lastValue.current = value;
    }
  }, [value, source]);

  useEffect(() => {
    if (ref.current && !source) ref.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  function emit() {
    const html = ref.current?.innerHTML ?? '';
    lastValue.current = html;
    onChange(html);
  }

  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  const btn = (title: string, icon: React.ReactNode, onClick: () => void) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="rounded p-1.5 text-gray-600 hover:bg-gray-100">
      {icon}
    </button>
  );

  return (
    <div className="rounded-md border border-gray-300 bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-1 py-1">
        {!source && (
          <>
            {btn('Paragraph', <Pilcrow className="h-4 w-4" />, () => cmd('formatBlock', 'P'))}
            {btn('Heading 2', <Heading2 className="h-4 w-4" />, () => cmd('formatBlock', 'H2'))}
            {btn('Heading 3', <Heading3 className="h-4 w-4" />, () => cmd('formatBlock', 'H3'))}
            {btn('Bold', <Bold className="h-4 w-4" />, () => cmd('bold'))}
            {btn('Italic', <Italic className="h-4 w-4" />, () => cmd('italic'))}
            {btn('List', <List className="h-4 w-4" />, () => cmd('insertUnorderedList'))}
            {btn('Link', <Link2 className="h-4 w-4" />, () => {
              const url = prompt('Link address (https://…)');
              if (url && /^https?:\/\//.test(url)) cmd('createLink', url);
            })}
            {btn('Undo', <Undo2 className="h-4 w-4" />, () => cmd('undo'))}
          </>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => setSource(!source)} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', source ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100')}>
          <Code2 className="h-3.5 w-3.5" /> HTML
        </button>
      </div>
      {source ? (
        <textarea
          className="block w-full resize-y p-3 font-mono text-xs focus:outline-none"
          style={{ minHeight }}
          value={value}
          onChange={(e) => {
            lastValue.current = e.target.value;
            onChange(e.target.value);
          }}
          spellCheck={false}
        />
      ) : (
        <div ref={ref} className="article-preview max-w-none overflow-auto p-4 focus:outline-none" style={{ minHeight }} contentEditable suppressContentEditableWarning onInput={emit} onBlur={emit} />
      )}
    </div>
  );
}
