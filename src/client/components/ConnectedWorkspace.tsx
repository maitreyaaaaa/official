import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpenText, Check, ChevronRight, CircleHelp, FileText, GitBranch, Search, ShieldCheck, Users } from 'lucide-react';
import type { KnowledgeNote, WorkspaceSnapshot, WriterDraft } from '../../shared/contracts.js';
import type { DemoCompany } from '../../shared/demo-companies.js';
import { CompanyLogo } from './CompanyLogo.js';
import { ErrorNotice, LoadingStatus, SkeletonLines } from './AsyncStates.js';
import { LocalTabs } from './LocalTabs.js';
import { BrainGraph } from './BrainGraph.js';
import { ProofStrip } from './ProofStrip.js';
import { savedHandoffInstruction, type ProofComparison } from '../../shared/reviewer-proof.js';

type View = 'memory' | 'brain';
type BrainTab = 'graph' | 'notes' | 'coverage' | 'history';
type NoteGroup = 'Launch' | 'Operations' | 'Company';

function noteGroup(note: KnowledgeNote): NoteGroup {
  if (note.category === 'Company') return 'Company';
  if (note.category === 'Ownership' || note.category === 'Playbooks') return 'Operations';
  return 'Launch';
}

interface ConnectedWorkspaceProps {
  company: DemoCompany;
  view: View;
  brainTab: BrainTab;
  onBrainTabChange: (tab: BrainTab) => void;
  workspace: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
  busy: string | null;
  message: string | null;
  proof: ProofComparison | null;
  ownerUnavailable: boolean;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onOwnerUnavailable: (value: boolean) => void;
  onAction: (action: 'approve-tone' | 'run-writer' | 'propose-backup' | 'approve-backup') => void;
  onReviewDraft: (draft: WriterDraft, decision: 'approve' | 'reject') => void;
  onRefresh: () => void;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
    : 'Date not recorded';
}

function NoteLink({ note, onSelect }: { note: KnowledgeNote; onSelect: (id: string) => void }) {
  return <button type="button" className="knowledge-link" onClick={() => onSelect(note.id)}>
    <FileText size={16} aria-hidden="true" /><span>{note.title}</span><ChevronRight size={15} aria-hidden="true" />
  </button>;
}

export function ConnectedWorkspace({ company, view, brainTab, onBrainTabChange, workspace, loading, error, canWrite, busy, message, ownerUnavailable,
  selectedNoteId, onSelectNote, onOwnerUnavailable, onAction, onReviewDraft, onRefresh, proof }: ConnectedWorkspaceProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All notes');
  const focusOpenedGuide = useRef(false);
  const noteHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (brainTab !== 'notes' || !focusOpenedGuide.current) return;
    focusOpenedGuide.current = false;
    noteHeadingRef.current?.focus();
  }, [brainTab]);
  const notes = workspace?.notes ?? [];
  const categories = ['All notes', 'Launch', 'Operations', 'Company'];
  const visibleNotes = useMemo(() => notes.filter((note) =>
    (category === 'All notes' || noteGroup(note) === category)
    && `${note.title} ${note.summary} ${note.body}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => noteGroup(a).localeCompare(noteGroup(b)) || a.title.localeCompare(b.title)),
  [category, notes, search]);
  const selectedNote = brainTab === 'graph'
    ? notes.find((note) => note.id === selectedNoteId) ?? notes[0] ?? null
    : visibleNotes.find((note) => note.id === selectedNoteId) ?? visibleNotes[0] ?? null;
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const selectNote = (id: string) => {
    if (!visibleNotes.some((note) => note.id === id)) {
      setCategory('All notes');
      setSearch('');
    }
    onSelectNote(id);
  };

  if (loading && !workspace) return <section className="connected-page connected-skeleton" aria-busy="true">
    <div className="connected-masthead"><div className="skeleton-block skeleton-mark" aria-hidden="true" /><div><LoadingStatus>Loading company records…</LoadingStatus><SkeletonLines count={2} className="skeleton-heading-lines" /></div></div>
    <div className="connected-summary-grid">{[1, 2, 3].map((item) => <div className="connected-summary" aria-hidden="true" key={item}><SkeletonLines count={3} /></div>)}</div>
    <div className="connected-two-column">{[1, 2].map((item) => <div className="connected-card" aria-hidden="true" key={item}><SkeletonLines count={5} /></div>)}</div>
  </section>;
  if (!workspace) return <section className="connected-page"><ErrorNotice
    className="connected-error"
    title="Company records could not be loaded"
    message={error ?? 'The connected workspace has not returned records yet.'}
    onRetry={onRefresh}
  /></section>;

  const currentTone = workspace.memory.instructions.find((item) => item.topic === 'tone' && item.status === 'approved');
  const oldTone = savedHandoffInstruction(workspace, 'tone');
  const oldOpening = savedHandoffInstruction(workspace, 'opening');
  const currentOpening = workspace.memory.instructions.find((item) => item.topic === 'opening' && item.status === 'approved');
  const proposedTone = workspace.memory.instructions.find((item) => item.topic === 'tone' && item.status === 'pending');
  const handoffStale = workspace.memory.handoff.revision < workspace.memory.briefRevision;
  const brain = workspace.companyBrain;
  const guide = noteById.get(brain.guideNoteId);
  const readiness = [
    { label: 'Confirmed backup', ready: brain.rosterReviewed && Boolean(brain.backupName) },
    { label: 'Guide current with rollout', ready: brain.guideCurrent && Boolean(guide) },
    { label: 'Current linked decision', ready: brain.decisionCurrent },
    { label: 'Direct source on guide', ready: brain.linkedSourceCount > 0 },
  ];
  const handoverReady = readiness.every((item) => item.ready);
  const historyPanel = <section className="connected-events"><div><span className="connected-label">GRAPH ACTIVITY</span><h2>What changed</h2></div>{workspace.events.length ? workspace.events.map((event) => <div className="connected-event" key={event.id}><span>{dateLabel(event.occurredAt)}</span><strong>{event.title}</strong><p>{event.detail}</p></div>) : <p className="connected-empty">No memory or ownership change has been recorded yet.</p>}</section>;

  const noteReader = <article className="note-reader">{selectedNote ? <>
          <div className="note-breadcrumb">{workspace.company.shortName} <ChevronRight size={14} /> {selectedNote.category}</div>
          <span className="connected-label">REVIEWED COMPANY NOTE</span><h2 ref={noteHeadingRef} tabIndex={-1}>{selectedNote.title}</h2><p className="note-summary">{selectedNote.summary}</p>
          <div className="note-meta"><span>Reviewed by {selectedNote.reviewedBy}</span><span>{dateLabel(selectedNote.reviewedAt)}</span></div>
          <div className="note-body">{selectedNote.body.split('\n').map((line, index) => <p key={`${selectedNote.id}-${index}`}>{line}</p>)}</div>
          <div className="note-relations"><section><h3><GitBranch size={16} /> Linked notes</h3>{selectedNote.links.length ? selectedNote.links.map((id) => noteById.get(id)).filter((note): note is KnowledgeNote => Boolean(note)).map((note) => <NoteLink key={note.id} note={note} onSelect={selectNote} />) : <p>No outgoing note links.</p>}</section><section><h3><ArrowRight size={16} /> Backlinks</h3>{selectedNote.backlinks.length ? selectedNote.backlinks.map((id) => noteById.get(id)).filter((note): note is KnowledgeNote => Boolean(note)).map((note) => <NoteLink key={note.id} note={note} onSelect={selectNote} />) : <p>No incoming note links.</p>}</section></div>
          <section className="note-sources"><h3><CircleHelp size={16} /> Sources and decisions</h3>{selectedNote.sources.length ? selectedNote.sources.map((source) => <div className="note-source" key={source.id}><strong>{source.label}</strong><p>{source.detail}</p><small>{source.id}</small></div>) : <p>This reviewed note has no linked source record. Read it as a workspace note, not independent product proof.</p>}</section>
        </> : <p className="connected-empty">{notes.length ? 'Clear the filters to choose a note.' : 'No company notes are available yet.'}</p>}</article>;

  return <div className="connected-page" id={view}>
    <div className="connected-masthead">
      <div className="connected-mark" aria-hidden="true"><CompanyLogo company={company} /></div>
      <div><span className="connected-overline">{workspace.company.name} <span aria-hidden="true">/</span> {workspace.project.name}</span>
        <h1 tabIndex={-1}>{view === 'memory' ? 'Writing handoff' : 'Company records'}</h1>
        <p>{view === 'memory'
          ? 'Keep the next writer on the current approved brief, even when the original handoff is old.'
          : 'Browse the notes, decisions, people, and source paths behind this launch.'}</p></div>
    </div>
    {message && <div className="connected-message" role="status"><Check size={16} aria-hidden="true" />{message}</div>}
    {loading && <div className="connected-refreshing"><LoadingStatus>Refreshing company records…</LoadingStatus><span>Showing the last loaded records while the new copy arrives.</span></div>}
    {error && <ErrorNotice className="connected-stale-error" title="Showing the last loaded records" message={error} onRetry={onRefresh} />}
    {proof && ((view === 'memory' && proof.title.startsWith('Approved brief')) || (view === 'brain' && proof.title.startsWith('Coverage'))) && <ProofStrip proof={proof} />}

    {view === 'memory' ? <>
      <div className="connected-quick-status"><strong>{handoffStale ? 'Handoff needs a refresh' : 'Handoff current'}</strong><span>Saved brief revision {workspace.memory.handoff.revision} · Current revision {workspace.memory.briefRevision}</span><span>{workspace.memory.drafts.filter((draft) => draft.status === 'pending_approval').length} internal drafts awaiting review</span></div>
      {proposedTone && <div className="memory-next-action"><div><span className="connected-label">NEXT REVIEW</span><strong>Proposed tone needs approval</strong><p>{proposedTone.text} The next writer will use the current approved tone until this change is reviewed.</p></div><button className="primary-button" type="button" onClick={() => onAction('approve-tone')} disabled={!canWrite || Boolean(busy)}>{busy === 'approve-tone' ? 'Approving…' : 'Approve tone'}</button></div>}
      <div className="connected-two-column">
        <section className="connected-card memory-card">
          <div className="connected-card-heading"><span className="connected-icon"><GitBranch size={19} /></span><div><span className="connected-label">PLANNER → WRITER</span><h2>Handoff and current memory</h2></div></div>
          <p className="connected-lede">{workspace.memory.handoff.summary}</p>
          <div className={`memory-revision ${handoffStale ? 'needs-refresh' : ''}`}><strong>{handoffStale ? 'Handoff out of date' : 'Handoff current'}</strong><span>{handoffStale ? `Saved at revision ${workspace.memory.handoff.revision}; the live graph is at revision ${workspace.memory.briefRevision}.` : 'The saved and current brief revisions match.'}</span></div>
          <div className="handoff-diff" aria-label="Saved handoff compared with current approved brief">
            <h3>Saved handoff → current approved brief</h3>
            <div><span>Saved tone</span><p>{oldTone?.text ?? 'No tone instruction in the saved handoff.'}</p></div>
            <div><span>Current tone</span><p>{currentTone?.text ?? 'No approved tone instruction.'}{currentTone && oldTone && currentTone.id !== oldTone.id ? ' Replaced after the handoff.' : ''}</p></div>
            <div><span>Opening rule</span><p>{currentOpening?.text ?? 'No approved opening rule.'} {oldOpening?.id === currentOpening?.id && currentOpening ? '(unchanged)' : '(review needed)'}</p></div>
            {proposedTone && <small>Pending tone stays outside the current brief until approval.</small>}
          </div>
          <h3 className="connected-subtitle">Instruction versions</h3>
          <div className="instruction-list">{workspace.memory.instructions.map((instruction) => <article key={instruction.id} className="instruction-item"><span className={`instruction-state ${instruction.status}`}>{instruction.status.replace('_', ' ')}</span><div><strong>{instruction.topic}</strong><p>{instruction.text}</p><small>Revision {instruction.revision}{instruction.approvedBy ? ` · Approved by ${instruction.approvedBy}` : ' · Waiting for review'}</small></div></article>)}</div>
          {!canWrite && <p className="connected-help">This deployment is read-only. You can still inspect the current company memory.</p>}
        </section>
        <section className="connected-card memory-card">
          <div className="connected-card-heading"><span className="connected-icon"><BookOpenText size={19} /></span><div><span className="connected-label">REVIEWED EPISODE</span><h2>Notes for the next writer</h2></div></div>
          <p className="connected-lede">{workspace.memory.episode.summary}</p>
          <p className="connected-help">Reviewed by {workspace.memory.episode.reviewedBy}. This is an episode for this campaign; it does not become a global rule.</p>
          <div className="writer-flow"><span>Task received</span><ArrowRight size={15} /><span>Memory refreshed</span><ArrowRight size={15} /><span>Draft prepared</span><ArrowRight size={15} /><span>Human review</span></div>
          <p className="connected-help">The fresh writing session reads current approved instructions, the old handoff, and this review event from FalkorDB. The draft records the memory IDs it used.</p>
          <button className="primary-button connected-action" type="button" onClick={() => onAction('run-writer')} disabled={!canWrite || Boolean(busy) || !currentTone}>{busy === 'run-writer' ? 'Preparing…' : 'Start fresh writer session'}</button>
          <h3 className="connected-subtitle">Recent writer sessions</h3>
          {workspace.memory.drafts.length ? <div className="writer-drafts">{workspace.memory.drafts.map((draft) => <article className="writer-draft" key={draft.id}>
            <div><strong>{draft.title}</strong><span className={`instruction-state ${draft.status}`}>{draft.status.replace('_', ' ')}</span></div>
            <small>{dateLabel(draft.createdAt)} · Brief revision {draft.briefRevision} · Evidence revision {draft.factRevision || 'earlier'} · {draft.tone}</small>
            <p>{draft.text}</p><small>Memory used: {draft.memoryIds.join(', ')}</small>
            {draft.availabilityBasis && <small>{draft.availabilityBasis}</small>}
            {(draft.briefRevision !== workspace.memory.briefRevision || draft.factRevision !== workspace.memory.currentFactRevision) && <small className="connected-help">Historical draft: the brief or rollout evidence changed after it was prepared. Start a fresh session before relying on its wording.</small>}
            {draft.status === 'pending_approval' && <div className="writer-review-actions"><button type="button" className="secondary-button" disabled={!canWrite || Boolean(busy) || draft.briefRevision !== workspace.memory.briefRevision || draft.factRevision !== workspace.memory.currentFactRevision} onClick={() => onReviewDraft(draft, 'approve')}>Approve internally</button><button type="button" className="secondary-button" disabled={!canWrite || Boolean(busy)} onClick={() => onReviewDraft(draft, 'reject')}>Reject</button></div>}
          </article>)}</div> : <p className="connected-empty">No fresh writer session has run yet. Start one to compare the saved handoff with the live brief.</p>}
        </section>
      </div>
    </> : <>
      <LocalTabs label="Company record sections" idPrefix="brain" tabs={[
        { id: 'graph' as const, label: 'Graph', count: notes.length },
        { id: 'notes' as const, label: 'Notes', count: notes.length },
        { id: 'coverage' as const, label: 'Coverage', count: handoverReady ? 0 : 1 },
        { id: 'history' as const, label: 'History' },
      ]} value={brainTab} onChange={onBrainTabChange} />
      {brainTab === 'graph' && <div className="brain-graph-layout" id="brain-panel-graph" role="tabpanel" aria-labelledby="brain-tab-graph"><BrainGraph notes={notes} selectedId={selectedNote?.id ?? null} onSelect={selectNote} />{noteReader}</div>}
      {brainTab === 'coverage' && <div id="brain-panel-coverage" role="tabpanel" aria-labelledby="brain-tab-coverage">
      <section className="connected-card coverage-card">
        <div className="connected-card-heading"><span className="connected-icon"><ShieldCheck size={19} /></span><div><span className="connected-label">COMPANY CONTINUITY</span><h2>Who can carry the launch review?</h2></div></div>
        <div className="coverage-main"><div><p>{brain.processSummary}</p><div className="coverage-people"><span><Users size={15} /> Primary: <strong>{brain.primaryName}</strong></span><span><Users size={15} /> Backup: <strong>{brain.backupName ?? 'Not confirmed'}</strong></span></div><p className="connected-help">{brain.affectedProject} depends on this process. {brain.decisionCurrent ? `The guide cites ${brain.decisionTitle}.` : 'The current decision link needs review.'}</p></div><div className="coverage-status"><span className="connected-label">{ownerUnavailable ? 'SCENARIO RESULT' : 'CURRENT COVERAGE'}</span><strong>{brain.coverage}</strong><small>{brain.backupProposalStatus ? 'A backup proposal is pending; it does not count yet.' : brain.rosterReviewed ? 'Based on the reviewed roster and approved links.' : 'Roster review is missing.'}</small></div></div>
        <div className="coverage-actions"><label className="scenario-switch"><input type="checkbox" checked={ownerUnavailable} onChange={(event) => onOwnerUnavailable(event.target.checked)} /> Simulate {brain.primaryName} unavailable</label>{!brain.backupName && !brain.backupProposalStatus && <button className="secondary-button" type="button" disabled={!canWrite || Boolean(busy)} onClick={() => onAction('propose-backup')}>{busy === 'propose-backup' ? 'Preparing…' : `Propose ${company.backupName} as backup`}</button>}{brain.backupProposalStatus && <button className="primary-button" type="button" disabled={!canWrite || Boolean(busy)} onClick={() => onAction('approve-backup')}>{busy === 'approve-backup' ? 'Approving…' : 'Approve backup assignment'}</button>}</div>
        <div className={`handover-brief ${handoverReady ? 'ready' : 'incomplete'}`}>
          <div><span className="connected-label">INTERNAL HANDOVER</span><strong>{handoverReady ? 'Ready for an approved backup' : 'Handover needs review'}</strong><p>{handoverReady ? `${brain.backupName} can use the reviewed guide and linked sources for ${brain.affectedProject}.` : 'Resolve each missing check before treating this handover as ready.'}</p><ul className="readiness-list">{readiness.map((item) => <li key={item.label}><span aria-hidden="true">{item.ready ? '✓' : '○'}</span>{item.label}: <strong>{item.ready ? 'Confirmed' : 'Needs review'}</strong></li>)}</ul></div>
          <div><small>Guide: {guide?.title ?? 'Missing from the company graph'}</small><small>Decision: {brain.decisionTitle}</small><small>Direct source links: {brain.linkedSourceCount}</small>{guide && <button className="knowledge-link" type="button" onClick={() => { focusOpenedGuide.current = true; selectNote(guide.id); onBrainTabChange('notes'); }}>Open guide and sources <ChevronRight size={15} /></button>}</div>
        </div>
        <p className="connected-help">Unaffected control: {brain.controlProcess.name} — {brain.controlProcess.coverage}. No person is assigned from a job title or model guess.</p>
      </section>
      </div>}
      {brainTab === 'notes' && <div className="brain-layout" id="brain-panel-notes" role="tabpanel" aria-labelledby="brain-tab-notes">
        <aside className="notes-browser" aria-label="Company records notes">
          <div className="notes-browser-title"><BookOpenText size={19} /><strong>All notes</strong><span>{notes.length}</span></div>
          <label className="notes-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search company notes</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" /></label>
          <div className="notes-categories" aria-label="Note categories">{categories.map((item) => <button type="button" key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="notes-list">{visibleNotes.map((note) => <button type="button" className={`note-row ${selectedNote?.id === note.id ? 'selected' : ''}`} onClick={() => selectNote(note.id)} key={note.id}><FileText size={16} aria-hidden="true" /><span><strong>{note.title}</strong><small>{note.category} · {note.summary}</small></span></button>)}{visibleNotes.length === 0 && <div className="notes-empty"><p className="connected-empty">{notes.length ? 'No notes match these filters.' : 'No company notes are available yet.'}</p>{notes.length > 0 && <button className="text-button" type="button" onClick={() => { setSearch(''); setCategory('All notes'); }}>Clear filters</button>}</div>}</div>
        </aside>
        {noteReader}
      </div>}
      {brainTab === 'history' && <div id="brain-panel-history" role="tabpanel" aria-labelledby="brain-tab-history">{historyPanel}</div>}
    </>}
    {view === 'memory' && <details className="memory-history"><summary>Graph activity</summary>{historyPanel}</details>}
  </div>;
}
