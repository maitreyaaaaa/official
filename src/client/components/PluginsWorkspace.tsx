import { useMemo, useState } from 'react';
import type { DemoCompany } from '../../shared/demo-companies.js';
import '../plugins.css';

type PluginCategory = 'Messages & mail' | 'Meetings & knowledge' | 'Projects & code' | 'Customer work' | 'Infrastructure';
type Plugin = { id: string; name: string; category: PluginCategory; description: string; signal: string; use: string; mark: string };

const plugins: Plugin[] = [
  { id: 'gmail', name: 'Gmail', category: 'Messages & mail', description: 'Email conversations and draft decisions.', signal: 'Relevant threads and draft status', use: 'Trace a launch decision back to its email discussion.', mark: 'G' },
  { id: 'outlook', name: 'Outlook', category: 'Messages & mail', description: 'Mail and calendar context for a team.', signal: 'Relevant mail and meeting context', use: 'See where a review request was discussed.', mark: 'O' },
  { id: 'slack', name: 'Slack', category: 'Messages & mail', description: 'Channel conversations and shared decisions.', signal: 'Threads, decisions, and handoff links', use: 'Find the conversation behind a workflow change.', mark: 'S' },
  { id: 'teams', name: 'Microsoft Teams', category: 'Messages & mail', description: 'Team discussions and meeting follow-ups.', signal: 'Channel messages and follow-ups', use: 'Keep project handoffs tied to team discussions.', mark: 'T' },
  { id: 'discord', name: 'Discord', category: 'Messages & mail', description: 'Community or internal channel context.', signal: 'Selected channel discussions', use: 'Connect discussion context to a decision note.', mark: 'D' },
  { id: 'zoom', name: 'Zoom', category: 'Messages & mail', description: 'Meeting context and follow-up work.', signal: 'Meeting summaries and follow-ups', use: 'Track actions agreed during a launch meeting.', mark: 'Z' },
  { id: 'otter', name: 'Otter.ai', category: 'Meetings & knowledge', description: 'Meeting notes and action items.', signal: 'Notes, summaries, and action items', use: 'Link a decision to the meeting where it was made.', mark: 'O' },
  { id: 'fireflies', name: 'Fireflies.ai', category: 'Meetings & knowledge', description: 'Call notes and meeting summaries.', signal: 'Summaries and assigned actions', use: 'Surface unfinished follow-ups in a handover.', mark: 'F' },
  { id: 'fathom', name: 'Fathom', category: 'Meetings & knowledge', description: 'Recorded meeting highlights and notes.', signal: 'Highlights and meeting notes', use: 'Preserve the reason behind a product decision.', mark: 'F' },
  { id: 'notion', name: 'Notion', category: 'Meetings & knowledge', description: 'Team pages, plans, and decisions.', signal: 'Pages and reviewed decisions', use: 'Turn a current team page into a source note.', mark: 'N' },
  { id: 'drive', name: 'Google Drive', category: 'Meetings & knowledge', description: 'Documents and shared working files.', signal: 'Selected documents and file links', use: 'Connect a launch claim to its source document.', mark: 'G' },
  { id: 'confluence', name: 'Confluence', category: 'Meetings & knowledge', description: 'Internal documentation and guides.', signal: 'Pages, owners, and update history', use: 'Spot a handover guide that needs review.', mark: 'C' },
  { id: 'onenote', name: 'OneNote', category: 'Meetings & knowledge', description: 'Shared notebooks and meeting notes.', signal: 'Notebook pages and action notes', use: 'Keep meeting context near the related workflow.', mark: 'O' },
  { id: 'github', name: 'GitHub', category: 'Projects & code', description: 'Code changes, issues, and releases.', signal: 'Pull requests, issues, and releases', use: 'Check whether a release supports a draft claim.', mark: 'G' },
  { id: 'gitlab', name: 'GitLab', category: 'Projects & code', description: 'Merge requests, issues, and pipelines.', signal: 'Merge requests and release evidence', use: 'Keep product promises aligned with shipped work.', mark: 'G' },
  { id: 'linear', name: 'Linear', category: 'Projects & code', description: 'Product issues and project milestones.', signal: 'Issue status and project decisions', use: 'Find work that is still waiting on an owner.', mark: 'L' },
  { id: 'jira', name: 'Jira', category: 'Projects & code', description: 'Tickets, owners, and project progress.', signal: 'Issue status, owners, and blockers', use: 'See which launch task is blocking a handoff.', mark: 'J' },
  { id: 'asana', name: 'Asana', category: 'Projects & code', description: 'Tasks, approvals, and project plans.', signal: 'Tasks, assignees, and due decisions', use: 'Bring an approval dependency into view.', mark: 'A' },
  { id: 'trello', name: 'Trello', category: 'Projects & code', description: 'Boards and task movement.', signal: 'Cards, lists, and owners', use: 'Follow a task from planned to complete.', mark: 'T' },
  { id: 'zendesk', name: 'Zendesk', category: 'Customer work', description: 'Support cases and recurring questions.', signal: 'Ticket themes and case status', use: 'Notice when a promise conflicts with support reality.', mark: 'Z' },
  { id: 'intercom', name: 'Intercom', category: 'Customer work', description: 'Customer conversations and support context.', signal: 'Conversation themes and follow-ups', use: 'See customer questions tied to a rollout.', mark: 'I' },
  { id: 'hubspot', name: 'HubSpot', category: 'Customer work', description: 'Customer-facing activity and handoffs.', signal: 'Selected records and handoff status', use: 'Understand which team owns a customer follow-up.', mark: 'H' },
  { id: 'salesforce', name: 'Salesforce', category: 'Customer work', description: 'Account context and team ownership.', signal: 'Selected account and ownership context', use: 'Identify the owner before a customer update.', mark: 'S' },
  { id: 'vercel', name: 'Vercel', category: 'Infrastructure', description: 'Deployment and release status.', signal: 'Deployments and environment status', use: 'Check whether a release is actually live.', mark: 'V' },
  { id: 'sentry', name: 'Sentry', category: 'Infrastructure', description: 'Application errors and release health.', signal: 'Issue trends and release health', use: 'Keep a launch claim grounded in product health.', mark: 'S' },
];

const categories: PluginCategory[] = ['Messages & mail', 'Meetings & knowledge', 'Projects & code', 'Customer work', 'Infrastructure'];
const pluginIds = new Set(plugins.map((plugin) => plugin.id));

function storageKey(company: DemoCompany): string { return `official-demo-plugins-${company.key}`; }

function readConnections(company: DemoCompany): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey(company)) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && pluginIds.has(id)) : [];
  } catch { return []; }
}

export function PluginsWorkspace({ company }: { company: DemoCompany }) {
  const [connected, setConnected] = useState<string[]>(() => readConnections(company));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PluginCategory | 'All'>('All');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = useMemo(() => plugins.filter((plugin) => {
    const matchesText = `${plugin.name} ${plugin.description} ${plugin.category}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesText && (category === 'All' || plugin.category === category) && (!connectedOnly || connected.includes(plugin.id));
  }), [search, category, connectedOnly, connected]);

  function toggleConnection(plugin: Plugin) {
    const wasConnected = connected.includes(plugin.id);
    const next = wasConnected ? connected.filter((id) => id !== plugin.id) : [...connected, plugin.id];
    try {
      window.localStorage.setItem(storageKey(company), JSON.stringify(next));
      setConnected(next);
      setMessage(`${plugin.name} ${wasConnected ? 'demo disconnected' : 'demo connected'} for ${company.shortName}. No account was accessed or data imported.`);
    } catch {
      setMessage('This browser could not save the demo connection. Check browser storage settings and try again.');
    }
  }

  return <section className="plugins-workspace" id="plugins" aria-labelledby="plugins-title">
    <header className="plugins-intro">
      <span className="eyebrow">{company.shortName.toUpperCase()} / DEMO WORKSPACE</span>
      <h1 id="plugins-title" tabIndex={-1}>Plugins</h1>
      <p>Bring the places your team works into one picture. Explore a source, then connect its demo to see how a future integration would fit.</p>
      <div className="plugins-demo-notice" role="note"><span className="plugins-demo-mark" aria-hidden="true">i</span><span><strong>Demo connections only.</strong> One click saves a selection in this browser for {company.shortName}. Official does not sign in, request permissions, sync, or read data from any provider here.</span></div>
    </header>

    <div className="plugins-toolbar">
      <div className="plugins-toolbar-title"><strong>Explore the catalog</strong><span>{connected.length} demo connected · {plugins.length} available</span></div>
      <div className="plugins-controls">
        <label className="plugins-search"><span className="sr-only">Search plugins</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search plugins" /></label>
        <label className="plugins-category"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value as PluginCategory | 'All')}><option value="All">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="plugins-connected-filter"><input type="checkbox" checked={connectedOnly} onChange={(event) => setConnectedOnly(event.target.checked)} /> Connected only</label>
      </div>
    </div>

    <p className="plugins-feedback" role="status" aria-live="polite" aria-atomic="true">{message || `${visible.length} ${visible.length === 1 ? 'plugin' : 'plugins'} shown for ${company.shortName}.`}</p>

    {categories.map((group) => {
      const items = visible.filter((plugin) => plugin.category === group);
      if (!items.length) return null;
      return <section className="plugins-group" key={group} aria-labelledby={`plugins-${group.replaceAll(/\W+/g, '-').toLowerCase()}`}>
        <div className="plugins-group-heading"><h2 id={`plugins-${group.replaceAll(/\W+/g, '-').toLowerCase()}`}>{group}</h2><span>{items.length}</span></div>
        <div className="plugins-grid">{items.map((plugin) => {
          const isConnected = connected.includes(plugin.id);
          const expanded = expandedId === plugin.id;
          return <article className={`plugin-card ${isConnected ? 'is-connected' : ''}`} key={plugin.id}>
            <div className="plugin-card-top"><span className={`plugin-mark plugin-mark-${categories.indexOf(plugin.category)}`} aria-hidden="true">{plugin.mark}</span><span className={`plugin-state ${isConnected ? 'connected' : ''}`}>{isConnected ? 'Demo connected' : 'Not connected'}</span></div>
            <h3>{plugin.name}</h3><p>{plugin.description}</p>
            <div className="plugin-card-actions"><button type="button" className={isConnected ? 'plugin-disconnect' : 'plugin-connect'} onClick={() => toggleConnection(plugin)} aria-label={`${isConnected ? 'Disconnect' : 'Connect'} ${plugin.name} demo for ${company.shortName}`}>{isConnected ? 'Disconnect demo' : 'Connect demo'}</button><button type="button" className="plugin-details-toggle" aria-expanded={expanded} aria-controls={`plugin-details-${plugin.id}`} onClick={() => setExpandedId(expanded ? null : plugin.id)}>{expanded ? 'Hide details' : 'How it fits'} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button></div>
            {expanded && <div className="plugin-details" id={`plugin-details-${plugin.id}`}><strong>Future source preview</strong><p><b>Could read:</b> {plugin.signal}.</p><p><b>Useful for:</b> {plugin.use}</p><small>This is a capability preview. No provider data appears in the current Company Brain, agent memory, or launch review.</small></div>}
          </article>;
        })}</div>
      </section>;
    })}
    {!visible.length && <div className="plugins-empty" role="status"><strong>No plugins match this view.</strong><p>Try another search or category.</p><button type="button" onClick={() => { setSearch(''); setCategory('All'); setConnectedOnly(false); }}>Show all plugins</button></div>}
  </section>;
}
