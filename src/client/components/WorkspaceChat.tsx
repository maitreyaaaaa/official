import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, PanelRightClose } from 'lucide-react';
import type { WorkspaceChatResponse, WorkspaceSnapshot } from '../../shared/contracts.js';

interface WorkspaceChatProps {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  ownerUnavailable: boolean;
  advancedAssistant: ReactNode;
}

type ChatItem = { id: number; role: 'user' | 'agent'; text: string; response?: WorkspaceChatResponse };
const prompts = ['What drafts need review?', 'What changed in the writer handoff?', 'Who covers launch evidence?', 'Which company notes have sources?'];

export function WorkspaceChat({ campaignId, open, onClose, onOpenNote, workspace, ownerUnavailable, advancedAssistant }: WorkspaceChatProps) {
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
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error) : 'The agent could not read the current workspace.');
      const result = payload as WorkspaceChatResponse;
      setItems((current) => [...current, { id: Date.now() + 1, role: 'agent', text: result.answer, response: result }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The current graph could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ask(question); };
  return <aside className={`workspace-chat ${open ? 'open' : 'closed'}`} aria-label="Workspace agent" aria-hidden={!open}>
    <div className="chat-head"><div className="chat-agent-mark"><img src="/brand/official-mascot.png" alt="" /></div><div><strong>Workspace agent</strong><small>Connected to live graph records</small></div><button type="button" aria-label="Close chat" title="Close chat" onClick={onClose}><PanelRightClose size={18} /></button></div>
    <div className="chat-status"><span className={workspace ? 'chat-status-dot ready' : 'chat-status-dot'} />{workspace ? `${workspace.company.shortName} / ${workspace.project.name}` : 'Waiting for graph data'}</div>
    <div className="chat-scroll" aria-live="polite">
      {items.length === 0 && <div className="chat-welcome"><div className="chat-welcome-icon"><img src="/brand/official-mascot.png" alt="" /></div><h2>Ask what is happening.</h2><p>I can read the launch drafts, agent handoff, company notes, and ownership records. My answers cite the connected notes I used.</p><div className="chat-suggestions">{prompts.map((prompt) => <button key={prompt} type="button" disabled={!workspace || busy} onClick={() => void ask(prompt)}>{prompt}</button>)}</div></div>}
      {items.map((item) => <div className={`chat-bubble ${item.role}`} key={item.id}><span>{item.role === 'agent' ? 'official agent' : 'You'}</span><p>{item.text}</p>{item.response && <><small>Checked {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(item.response.checkedAt))}</small>{item.response.sources.length > 0 && <div className="chat-citations"><strong>Connected notes</strong>{item.response.sources.map((source) => <button key={source.id} type="button" onClick={() => onOpenNote(source.id)}>{source.label}</button>)}</div>}</>}</div>)}
      {busy && <div className="chat-thinking" role="status">Checking connected records…</div>}
      {error && <div className="chat-error" role="alert">{error}</div>}
      {advancedAssistant && <details className="chat-advanced"><summary>Advanced campaign AI</summary>{advancedAssistant}</details>}
    </div>
    <div className="chat-compose"><p>Answers use the fictional FalkorDB workspace. The agent makes no external changes.</p><form onSubmit={submit}><label className="sr-only" htmlFor="workspace-question">Ask the workspace agent</label><textarea id="workspace-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} placeholder="Ask about drafts, memory, or the company…" disabled={!workspace || busy} /><button type="submit" aria-label="Send question" disabled={!workspace || busy || !question.trim()}><ArrowUp size={18} /></button></form></div>
  </aside>;
}
