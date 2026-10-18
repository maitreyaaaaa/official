import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent } from 'react';
import { IconsaxIcon, type IconsaxName } from './IconsaxIcon.js';

type Section = 'overview' | 'campaign' | 'memory' | 'brain' | 'plugins';
type LaunchPage = 'drafts' | 'approvals' | 'history';
type RecordsPage = 'graph' | 'notes' | 'coverage' | 'history';
type ParentId = 'launch' | 'records';

interface Destination {
  id: string;
  label: string;
  href: string;
  icon: IconsaxName;
  count?: number | string;
  active: boolean;
}

interface WorkspaceSidebarProps {
  activeSection: Section;
  launchPage: LaunchPage;
  recordsPage: RecordsPage;
  draftCount: number | string;
  reviewCount: number | string;
  approvalCount: number | string;
  recordCount: number | string;
  onNavigate: () => void;
}

function pointInTriangle(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  const cross = (p1: typeof point, p2: typeof point, p3: typeof point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const first = cross(point, a, b);
  const second = cross(point, b, c);
  const third = cross(point, c, a);
  const hasNegative = first < 0 || second < 0 || third < 0;
  const hasPositive = first > 0 || second > 0 || third > 0;
  return !(hasNegative && hasPositive);
}

export function WorkspaceSidebar({ activeSection, launchPage, recordsPage, draftCount, reviewCount, approvalCount, recordCount, onNavigate }: WorkspaceSidebarProps) {
  const activeParent: ParentId | null = activeSection === 'campaign' ? 'launch' : activeSection === 'brain' ? 'records' : null;
  const [openParent, setOpenParent] = useState<ParentId | null>(activeParent);
  const [activeParentCollapsed, setActiveParentCollapsed] = useState(false);
  const submenuRefs = useRef<Partial<Record<ParentId, HTMLUListElement | null>>>({});
  const closeTimer = useRef<number | null>(null);
  const stopPointerTracking = useRef<(() => void) | null>(null);

  const clearPendingClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    stopPointerTracking.current?.();
    stopPointerTracking.current = null;
  };

  useEffect(() => {
    clearPendingClose();
    setOpenParent(activeParent);
    setActiveParentCollapsed(false);
  }, [activeParent]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    stopPointerTracking.current?.();
  }, []);

  const closeToCurrentPage = () => setOpenParent(activeParent);
  const isSubmenuOpen = (parent: ParentId) => openParent === parent || (activeParent === parent && !activeParentCollapsed);

  const handlePointerEnter = (parent: ParentId, event: PointerEvent<HTMLLIElement>) => {
    if (event.pointerType === 'touch') return;
    if (event.target instanceof HTMLElement && event.target.closest('.nav-disclosure')) return;
    clearPendingClose();
    if (parent === activeParent) setActiveParentCollapsed(false);
    setOpenParent(parent);
  };

  const handlePointerLeave = (parent: ParentId, event: PointerEvent<HTMLLIElement>) => {
    if (event.pointerType === 'touch' || parent === activeParent) return;
    const submenu = submenuRefs.current[parent];
    if (!submenu) {
      closeTimer.current = window.setTimeout(closeToCurrentPage, 220);
      return;
    }

    const bounds = submenu.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const upperCorner = { x: bounds.left, y: bounds.top - 10 };
    const lowerCorner = { x: bounds.left, y: bounds.bottom + 10 };
    const onPointerMove = (move: globalThis.PointerEvent) => {
      const element = document.elementFromPoint(move.clientX, move.clientY);
      if (element && submenu.contains(element)) {
        clearPendingClose();
        return;
      }

      if (pointInTriangle({ x: move.clientX, y: move.clientY }, origin, upperCorner, lowerCorner)) {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(closeToCurrentPage, 900);
      } else {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(closeToCurrentPage, 140);
      }
    };

    document.addEventListener('pointermove', onPointerMove);
    stopPointerTracking.current = () => document.removeEventListener('pointermove', onPointerMove);
    closeTimer.current = window.setTimeout(closeToCurrentPage, 900);
  };

  const handleFocus = (parent: ParentId) => {
    clearPendingClose();
    if (parent === activeParent) setActiveParentCollapsed(false);
    setOpenParent(parent);
  };

  const handleBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    closeToCurrentPage();
  };

  const toggleParent = (parent: ParentId) => {
    clearPendingClose();
    if (parent === activeParent) {
      const collapse = isSubmenuOpen(parent);
      setActiveParentCollapsed(collapse);
      if (!collapse) setOpenParent(parent);
      return;
    }
    setOpenParent((current) => current === parent ? null : parent);
  };

  const handleEscape = (parent: ParentId) => (event: ReactKeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Escape' || !isSubmenuOpen(parent)) return;
    if (parent === activeParent) setActiveParentCollapsed(true);
    if (openParent === parent) setOpenParent(null);
    event.currentTarget.querySelector<HTMLButtonElement>('.nav-disclosure')?.focus();
  };

  const launchChildren: Destination[] = [
    { id: 'drafts', label: 'Drafts', href: '#campaign', icon: 'document-text', count: draftCount, active: launchPage === 'drafts' },
    { id: 'approvals', label: 'Approvals', href: '#approvals', icon: 'tick-circle', count: approvalCount, active: launchPage === 'approvals' },
    { id: 'history', label: 'History', href: '#activity', icon: 'clock', active: launchPage === 'history' },
  ];
  const recordsChildren: Destination[] = [
    { id: 'graph', label: 'Graph', href: '#brain', icon: 'hierarchy-3', active: recordsPage === 'graph' },
    { id: 'notes', label: 'Notes', href: '#brain-notes', icon: 'note-2', count: recordCount, active: recordsPage === 'notes' },
    { id: 'coverage', label: 'Coverage', href: '#coverage', icon: 'shield-tick', active: recordsPage === 'coverage' },
    { id: 'history', label: 'History', href: '#brain-history', icon: 'clock', active: recordsPage === 'history' },
  ];

  const renderSubmenu = (parent: ParentId, children: Destination[]) => (
    <ul
      className={`nav-submenu ${activeParent === parent ? 'nav-submenu-current' : ''}`}
      id={`nav-submenu-${parent}`}
      aria-label={`${parent === 'launch' ? 'Launch review' : 'Company records'} pages`}
      ref={(element) => { submenuRefs.current[parent] = element; }}
      hidden={!isSubmenuOpen(parent)}
      onPointerEnter={() => { clearPendingClose(); setOpenParent(parent); }}
    >
      {children.map((child) => <li key={child.id}>
        <a className={`nav-child ${child.active ? 'active' : ''}`} href={child.href} onClick={onNavigate} aria-current={child.active ? 'page' : undefined}>
          <span className="nav-child-icon"><IconsaxIcon name={child.icon} /></span>
          <span className="nav-label">{child.label}</span>
          {child.count !== undefined && <span className="nav-count">{child.count}</span>}
        </a>
      </li>)}
    </ul>
  );

  return <nav className="nav-list workspace-nav-list" aria-label="Main navigation">
    <ul className="workspace-nav-roots">
      <li>
        <a className={`nav-item ${activeSection === 'overview' ? 'active' : ''}`} href="#overview" onClick={onNavigate} aria-current={activeSection === 'overview' ? 'page' : undefined}>
          <span className="nav-icon tone-blue"><IconsaxIcon name="home-2" /></span><span className="nav-label">Overview</span>
        </a>
      </li>
      <li className={`nav-group tone-amber ${activeParent === 'launch' ? 'is-current' : ''} ${isSubmenuOpen('launch') ? 'is-open' : ''}`} onPointerEnter={(event) => handlePointerEnter('launch', event)} onPointerLeave={(event) => handlePointerLeave('launch', event)} onFocusCapture={(event) => { if (!(event.target instanceof HTMLElement) || !event.target.closest('.nav-disclosure')) handleFocus('launch'); }} onBlurCapture={handleBlur} onKeyDown={handleEscape('launch')}>
        <div className={`nav-group-row ${activeSection === 'campaign' ? 'active' : ''}`}>
          <a className="nav-item nav-parent-link" href="#campaign" onClick={onNavigate} aria-current={activeSection === 'campaign' ? 'location' : undefined}>
            <span className="nav-icon tone-amber"><IconsaxIcon name="document-text" /></span><span className="nav-label">Launch review</span><span className="nav-count">{reviewCount}</span>
          </a>
          <button className="nav-disclosure" type="button" aria-label={`${isSubmenuOpen('launch') ? 'Hide' : 'Show'} Launch review pages`} data-tooltip={`${isSubmenuOpen('launch') ? 'Hide' : 'Show'} Launch review pages`} aria-expanded={isSubmenuOpen('launch')} aria-controls="nav-submenu-launch" onClick={() => toggleParent('launch')}>
            <span aria-hidden="true" />
          </button>
        </div>
        {renderSubmenu('launch', launchChildren)}
      </li>
      <li>
        <a className={`nav-item ${activeSection === 'memory' ? 'active' : ''}`} href="#memory" onClick={onNavigate} aria-current={activeSection === 'memory' ? 'page' : undefined}>
          <span className="nav-icon tone-teal"><IconsaxIcon name="diagram" /></span><span className="nav-label">Writing handoff</span>
        </a>
      </li>
      <li className={`nav-group tone-green ${activeParent === 'records' ? 'is-current' : ''} ${isSubmenuOpen('records') ? 'is-open' : ''}`} onPointerEnter={(event) => handlePointerEnter('records', event)} onPointerLeave={(event) => handlePointerLeave('records', event)} onFocusCapture={(event) => { if (!(event.target instanceof HTMLElement) || !event.target.closest('.nav-disclosure')) handleFocus('records'); }} onBlurCapture={handleBlur} onKeyDown={handleEscape('records')}>
        <div className={`nav-group-row ${activeSection === 'brain' ? 'active' : ''}`}>
          <a className="nav-item nav-parent-link" href="#brain" onClick={onNavigate} aria-current={activeSection === 'brain' ? 'location' : undefined}>
            <span className="nav-icon tone-green"><IconsaxIcon name="book" /></span><span className="nav-label">Company records</span><span className="nav-count">{recordCount}</span>
          </a>
          <button className="nav-disclosure" type="button" aria-label={`${isSubmenuOpen('records') ? 'Hide' : 'Show'} Company records pages`} data-tooltip={`${isSubmenuOpen('records') ? 'Hide' : 'Show'} Company records pages`} aria-expanded={isSubmenuOpen('records')} aria-controls="nav-submenu-records" onClick={() => toggleParent('records')}>
            <span aria-hidden="true" />
          </button>
        </div>
        {renderSubmenu('records', recordsChildren)}
      </li>
      <li>
        <a className={`nav-item ${activeSection === 'plugins' ? 'active' : ''}`} href="#plugins" onClick={onNavigate} aria-current={activeSection === 'plugins' ? 'page' : undefined}>
          <span className="nav-icon tone-slate"><IconsaxIcon name="category" /></span><span className="nav-label">Plugins</span>
        </a>
      </li>
    </ul>
  </nav>;
}
