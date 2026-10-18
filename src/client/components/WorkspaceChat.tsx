import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, PanelRightClose } from 'lucide-react';
import type { WorkspaceChatResponse, WorkspaceSnapshot } from '../../shared/contracts.js';
import { ErrorNotice, LoadingStatus, SkeletonLines } from './AsyncStates.js';

interface WorkspaceChatProps {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  onRetryWorkspace: () => void;
  ownerUnavailable: boolean;
  advancedAssistant: ReactNode;
}

type ChatItem = { id: number; role: 'user' | 'agent'; text: string; response?: WorkspaceChatResponse };
const prompts = ['What drafts need review?', 'What changed in the writer handoff?', 'Who covers launch evidence?', 'Which company notes have sources?'];

export function WorkspaceChat({ campaignId, open, onClose, onOpenNote, workspace, workspaceLoading, workspaceError, onRetryWorkspace, ownerUnavailable, advancedAssistant }: WorkspaceChatProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || busy || !workspace) return;
    setError(null);
    setQuestion('');
    setItems((current) => [...current, { id: Date.now(), role: 'user', text: trimmed }]);
    setBusy(true);
    try {
      const response = await fetch('/api/workspace/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, message: trimmed, ownerUnavailable }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error) : `Company records could not be checked (HTTP ${response.status}).`);
      if (typeof payload !== 'object' || payload === null || !('answer' in payload) || typeof payload.answer !== 'string'
        || !('sources' in payload) || !Array.isArray(payload.sources) || !('checkedAt' in payload) || typeof payload.checkedAt !== 'string') {
        throw new Error('The workspace returned an invalid answer. Try again.');
      }
      const result = payload as WorkspaceChatResponse;
      setItems((current) => [...current, { id: Date.now() + 1, role: 'agent', text: result.answer, response: result }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The current graph could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ask(question); };
  return <aside className={`workspace-chat ${open ? 'open' : 'closed'}`} aria-label="Workspace chat" aria-hidden={!open}>
    <div className="chat-head"><div><strong>Workspace chat</strong><small>Answers from connected company records</small></div><button type="button" aria-label="Close chat" title="Close chat" onClick={onClose}><PanelRightClose size={18} /></button></div>
    <div className={`chat-status ${workspaceError ? 'has-error' : ''}`}>
      {workspaceLoading ? <LoadingStatus>{workspace ? 'Refreshing company records…' : 'Loading company records…'}</LoadingStatus>
        : workspace ? <><span className="chat-status-dot ready" />{workspace.company.shortName} / {workspace.project.name}</>
          : <><span className="chat-status-dot error" />Connection needs attention</>}
    </div>
    <div className="chat-scroll" aria-live="polite">
      {workspaceError && <ErrorNotice className="chat-context-error" title={workspace ? 'Showing saved company records' : 'Company records need a retry'} message={workspaceError} onRetry={onRetryWorkspace} />}
      {items.length === 0 && workspace && <div className="chat-welcome"><h2>Ask about this company</h2><p>Check launch drafts, the writing handoff, company notes, and ownership. Answers include the records used.</p><div className="chat-suggestions">{prompts.map((prompt) => <button key={prompt} type="button" disabled={busy} onClick={() => void ask(prompt)}>{prompt}</button>)}</div></div>}
      {items.length === 0 && !workspace && workspaceLoading && <div className="chat-load-skeleton"><LoadingStatus>Loading chat context…</LoadingStatus><SkeletonLines count={4} /></div>}
      {items.length === 0 && !workspace && !workspaceLoading && !workspaceError && <div className="chat-load-skeleton"><LoadingStatus>Loading chat context…</LoadingStatus><SkeletonLines count={4} /></div>}
      {items.map((item) => <div className={`chat-bubble ${item.role}`} key={item.id}><span>{item.role === 'agent' ? 'Workspace' : 'You'}</span><p>{item.text}</p>{item.response && <><small>Checked {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(item.response.checkedAt))}</small>{item.response.sources.length > 0 && <div className="chat-citations"><strong>Sources</strong>{item.response.sources.map((source) => <button key={source.id} type="button" onClick={() => onOpenNote(source.id)}>{source.label}</button>)}</div>}</>}</div>)}
      {busy && <div className="chat-thinking"><LoadingStatus>Checking company records…</LoadingStatus></div>}
      {error && <div className="chat-error" role="alert">{error}</div>}
      {advancedAssistant && <details className="chat-advanced"><summary>Campaign tools</summary>{advancedAssistant}</details>}
    </div>
    <div className="chat-compose"><p>Answers use the selected company’s fictional graph. No records are changed.</p><form onSubmit={submit}><label className="sr-only" htmlFor="workspace-question">Ask about company records</label><textarea id="workspace-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} placeholder="Ask about drafts, handoffs, owners, or notes…" disabled={!workspace || busy} /><button type="submit" aria-label="Send question" disabled={!workspace || busy || !question.trim()}><ArrowUp size={18} /></button></form></div>
  </aside>;
}
