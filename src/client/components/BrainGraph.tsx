import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { KnowledgeNote } from '../../shared/contracts.js';

interface BrainGraphProps {
  notes: KnowledgeNote[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const width = 1280;
const height = 820;
const categoryAngles: Record<string, number> = {
  Company: -2.45, Decisions: -1.75, Campaigns: -.75, Reviews: -.12,
  Handoffs: .55, Ownership: 1.35, Playbooks: 2.15, Operations: 2.75,
};

function positions(notes: KnowledgeNote[]): Map<string, { x: number; y: number }> {
  const counts = new Map<string, number>();
  const result = new Map<string, { x: number; y: number }>();
  for (const note of notes) {
    const index = counts.get(note.category) ?? 0;
    counts.set(note.category, index + 1);
    const angle = (categoryAngles[note.category] ?? 0) + index * .36;
    const radius = note.category === 'Company' ? 145 : 310 + index * 95;
    result.set(note.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius });
  }
  return result;
}

export function BrainGraph({ notes, selectedId, onSelect }: BrainGraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [scale, setScale] = useState(.8);
  const [offset, setOffset] = useState({ x: -180, y: -80 });
  const layout = useMemo(() => positions(notes), [notes]);
  const selected = notes.find((note) => note.id === selectedId);
  const related = new Set([...(selected?.links ?? []), ...(selected?.backlinks ?? [])]);
  const edges = notes.flatMap((note) => note.links.flatMap((to) => {
    const fromPoint = layout.get(note.id);
    const toPoint = layout.get(to);
    return fromPoint && toPoint ? [{ from: note.id, to, fromPoint, toPoint }] : [];
  }));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = Math.max(.38, Math.min(2.3, scale * (event.deltaY > 0 ? .9 : 1.1)));
      const bounds = viewport.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      setOffset((current) => ({ x: x - (x - current.x) * next / scale, y: y - (y - current.y) * next / scale }));
      setScale(next);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [scale]);

  const zoom = (factor: number) => {
    const next = Math.max(.38, Math.min(2.3, scale * factor));
    const viewport = viewportRef.current;
    if (!viewport) return;
    const x = viewport.clientWidth / 2;
    const y = viewport.clientHeight / 2;
    setOffset((current) => ({ x: x - (x - current.x) * next / scale, y: y - (y - current.y) * next / scale }));
    setScale(next);
  };
  const fit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = Math.min(.82, (viewport.clientWidth - 36) / width, (viewport.clientHeight - 36) / height);
    setScale(next);
    setOffset({ x: (viewport.clientWidth - width * next) / 2, y: (viewport.clientHeight - height * next) / 2 });
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = Math.min(.9, Math.max(.72, viewport.clientWidth / 900));
    setScale(next);
    setOffset({ x: (viewport.clientWidth - width * next) / 2, y: (viewport.clientHeight - height * next) / 2 });
  }, [notes.length]);

  return <section className="brain-graph-card" aria-label="Company note graph">
    <div className="brain-graph-head"><div><span className="connected-label">CONNECTED KNOWLEDGE</span><h2>Company graph</h2><p>Drag to explore. Scroll to zoom. Select a note to read its details.</p></div><div className="brain-graph-controls"><button type="button" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => zoom(1 / 1.2)}><Minus size={17} /></button><button type="button" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => zoom(1.2)}><Plus size={17} /></button><button type="button" aria-label="Fit graph" data-tooltip="Fit graph to view" onClick={fit}><Maximize2 size={16} /></button></div></div>
    <div className="brain-graph-viewport" ref={viewportRef}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('button')) return;
        dragRef.current = { x: event.clientX, y: event.clientY, tx: offset.x, ty: offset.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag) setOffset({ x: drag.tx + event.clientX - drag.x, y: drag.ty + event.clientY - drag.y });
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}>
      <div className="brain-graph-plane" style={{ width, height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
        <svg className="brain-graph-lines" width={width} height={height} aria-hidden="true"><g>{edges.map((edge) => <line key={`${edge.from}-${edge.to}`} x1={edge.fromPoint.x} y1={edge.fromPoint.y} x2={edge.toPoint.x} y2={edge.toPoint.y} className={selectedId && (edge.from === selectedId || edge.to === selectedId) ? 'active' : ''} />)}</g></svg>
        {notes.map((note) => {
          const point = layout.get(note.id);
          if (!point) return null;
          return <button key={note.id} type="button" className={`brain-graph-node ${note.id === selectedId ? 'selected' : ''} ${related.has(note.id) ? 'related' : ''}`} style={{ left: point.x, top: point.y }} aria-pressed={note.id === selectedId} onClick={() => onSelect(note.id)} title={note.summary}><span className="brain-graph-node-dot" /><span className="brain-graph-node-label">{note.title}</span><small>{note.category}</small></button>;
        })}
      </div>
    </div>
    <div className="brain-graph-foot"><span>{notes.length} notes</span><span>{edges.length} links</span><button type="button" onClick={fit}>Reset view</button></div>
  </section>;
}
