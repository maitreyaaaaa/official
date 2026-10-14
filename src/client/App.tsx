import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CampaignReview, DraftFinding, FindingStatus } from '../shared/contracts.js';

const campaignId = 'campaign-csv-launch';

async function initializeFixture(): Promise<void> {
  const response = await fetch(`/api/campaigns/${campaignId}/fixture`, { method: 'POST' });
  if (response.status === 404) return;
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'Could not initialize the local fictional campaign.';
    throw new Error(message);
  }
}

async function loadCampaign(): Promise<CampaignReview> {
  if (import.meta.env.DEV) await initializeFixture();
  const response = await fetch(`/api/campaigns/${campaignId}/review`);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'Could not load this campaign.';
    throw new Error(message);
  }
  return payload as CampaignReview;
}

class DemoActionUnavailableError extends Error {}

async function simulateRolloutExpansion(): Promise<CampaignReview> {
  const response = await fetch(`/api/campaigns/${campaignId}/demo-rollout`, { method: 'POST' });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'The demo rollout could not be updated.';
    if (response.status === 404) throw new DemoActionUnavailableError(message);
    throw new Error(message);
  }
  return payload as CampaignReview;
}

async function readDemoRolloutAvailability(): Promise<boolean> {
  const response = await fetch('/api/capabilities');
  if (!response.ok) return false;
  const payload: unknown = await response.json().catch(() => null);
  return typeof payload === 'object' && payload !== null && 'demoRollout' in payload && payload.demoRollout === true;
}

function StatusPill({ status, decorative = false }: { status: FindingStatus; decorative?: boolean }) {
  return <span aria-hidden={decorative || undefined} className={`status-pill status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not available';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatObservedAt(value: string): string {
  if (!value) return 'Observation time not recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Observation time not available';
  return `Observed ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)}`;
}

export function App() {
  const [review, setReview] = useState<CampaignReview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [demoRolloutAvailable, setDemoRolloutAvailable] = useState(false);
  const [showPath, setShowPath] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [scenarioMessage, setScenarioMessage] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<{ message: string; actionUnavailable: boolean } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setScenarioMessage(null);
    setScenarioError(null);
    setReview(null);
    setSelectedId(null);
    setShowPath(false);
    try {
      const result = await loadCampaign();
      setReview(result);
      setSelectedId((current) => result.findings.find((item) => item.draftId === current)?.draftId
        ?? result.findings.find((item) => item.needsReview)?.draftId
        ?? result.findings[0]?.draftId
        ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this campaign.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runRolloutScenario = async () => {
    setSimulating(true);
    setError(null);
    setScenarioMessage(null);
    setScenarioError(null);
    setReview(null);
    setSelectedId(null);
    setShowPath(false);
    try {
      const result = await simulateRolloutExpansion();
      setReview(result);
      setSelectedId(result.findings.find((item) => item.needsReview)?.draftId ?? result.findings[0]?.draftId ?? null);
      setScenarioMessage('Synthetic rollout S4 now includes all accounts. Findings were rechecked; no drafts were changed.');
    } catch (cause) {
      setScenarioError({
        message: cause instanceof Error ? cause.message : 'The demo rollout result could not be confirmed.',
        actionUnavailable: cause instanceof DemoActionUnavailableError,
      });
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    void refresh();
    if (import.meta.env.DEV) {
      void readDemoRolloutAvailability()
        .then(setDemoRolloutAvailable)
        .catch(() => setDemoRolloutAvailable(false));
    }
  }, [refresh]);

  const counts = useMemo(() => {
    const values = review?.findings ?? [];
    return {
      attention: values.filter((item) => item.needsReview).length,
      supported: values.filter((item) => item.status === 'Supported').length,
      unchecked: values.filter((item) => item.status === 'Not checked').length,
    };
  }, [review]);

  const selected: DraftFinding | undefined = review?.findings.find((item) => item.draftId === selectedId);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="official overview">
          <span className="brand-mark">o</span><span>official</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><span className="nav-icon">◫</span> Overview</a>
          <a className="nav-item" href="#campaign"><span className="nav-icon">▤</span> Campaigns <span className="nav-count">1</span></a>
          <a className="nav-item" href="#activity"><span className="nav-icon">◷</span> Activity</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className={`connection-dot ${error ? 'offline' : review ? 'online' : ''}`} />
            <div><strong>FalkorDB</strong><small>{error ? 'Connection needed' : review ? 'Connected' : scenarioError ? 'Check required' : 'Connecting'}</small></div>
            <span className="connection-menu">···</span>
          </div>
          <div className="profile-row"><div className="avatar">O</div><div><strong>Launch team</strong><small>Local workspace</small></div><span className="connection-menu">⌄</span></div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>Overview</strong></div>
          <div className="topbar-actions"><span className="demo-badge"><span className="demo-dot" aria-hidden="true" /> Fictional demo</span><div className="help-wrap"><button className="icon-button" aria-label="Help" aria-expanded={showHelp} aria-controls="help-panel" onClick={() => setShowHelp((visible) => !visible)}>?</button><section className="help-popover" id="help-panel" aria-label="How campaign checks work" hidden={!showHelp}><strong>How to read a check</strong><p><b>Supported</b> requires a reviewed promise, fresh reviewed rollout and deployment records, and a passing test on the deployed revision.</p><p><b>Contradicted</b> means a fresh reviewed rollout excludes that audience. Missing, old, unreviewed, or conflicting evidence is <b>Unknown</b>.</p><p><b>Not checked</b> means no promise is linked. Checks are read-only; the demo control updates only the fictional local graph when local demo writes are enabled.</p></section></div><div className="avatar small" aria-hidden="true">O</div></div>
        </header>
        <nav className="mobile-nav" aria-label="Main navigation">
          <a href="#overview"><span aria-hidden="true">◫</span>Overview</a>
          <a href="#campaign"><span aria-hidden="true">▤</span>Campaign</a>
          <a href="#activity"><span aria-hidden="true">◷</span>Activity</a>
        </nav>

        <section className="page-heading">
          <div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}</div><h1>Your launch workspace</h1><p className="subheading">The details behind each promise, in one place.</p></div>
          <div className="heading-actions"><button className="secondary-button scenario-button" title={demoRolloutAvailable ? 'Updates only the local fictional graph fixture' : 'Enable local demo writes in the server settings'} onClick={() => void runRolloutScenario()} disabled={!import.meta.env.DEV || !demoRolloutAvailable || !review || loading || simulating}>{simulating ? 'Updating scenario…' : 'Simulate all-account rollout'}<span aria-hidden="true">↗</span></button><button className="primary-button" onClick={() => void refresh()} disabled={loading || simulating}><span className="button-spark" aria-hidden="true">✳</span>{loading ? 'Checking…' : 'Check campaign'}</button></div>
        </section>

        {error && <section className="connection-alert" role="alert"><div className="alert-icon" aria-hidden="true">!</div><div><strong>{error.toLowerCase().includes('campaign not found') ? 'Campaign data unavailable' : 'Campaign check unavailable'}</strong><p>{error} Check that FalkorDB is reachable and the campaign data is loaded, then try again. The check fails closed; no draft has changed.</p></div><button className="text-button" onClick={() => void refresh()}>Retry</button></section>}
        {scenarioMessage && <section className="scenario-alert" role="status"><span className="scenario-check" aria-hidden="true">✓</span>{scenarioMessage}</section>}
        {scenarioError && <section className="scenario-alert scenario-alert-error" role="alert"><strong>{scenarioError.actionUnavailable ? 'Demo action unavailable.' : 'Scenario result unconfirmed.'}</strong> {scenarioError.message} {scenarioError.actionUnavailable ? 'The server rejected the request before any graph write. Refresh findings before relying on them.' : 'Earlier findings were cleared; run a fresh campaign check before relying on a result.'}</section>}

        <section className="campaign-banner" id="campaign">
          <div className="campaign-symbol"><span>✳</span></div>
          <div className="campaign-info"><div className="campaign-kicker">FICTIONAL SAMPLE <span aria-hidden="true">·</span> PRODUCTION SCENARIO</div><h2>{review?.campaign.name ?? 'CSV export launch'}</h2><p>For {review?.campaign.audience.toLowerCase() ?? 'all customer accounts'}</p></div>
          <div className="campaign-meta"><div className="meta-icon">⌁</div><div><span>Last checked</span><strong>{review ? `Today, ${formatTime(review.checkedAt)}` : 'Waiting for graph'}</strong></div></div>
          <a className="arrow-button" href="#drafts" aria-label="See campaign drafts">↘</a>
        </section>

        <section className="stats-row" aria-label="Campaign summary">
          <div className="stat-card stat-attention"><div className="stat-top"><span className="stat-icon">!</span><span className="stat-label">NEEDS ATTENTION</span><span className="stat-arrow">↗</span></div><div className="stat-value">{review ? counts.attention : '—'}<span>{review ? ' drafts' : ''}</span></div><div className="stat-note">{review ? 'Review before sharing' : 'Connect to check'}</div></div>
          <div className="stat-card"><div className="stat-top"><span className="stat-icon supported-icon" aria-hidden="true">✓</span><span className="stat-label">SUPPORTED</span></div><div className="stat-value">{review ? counts.supported : '—'}<span>{review ? ' ' + (counts.supported === 1 ? 'draft' : 'drafts') : ''}</span></div><div className="stat-note">{review ? 'Backed by current records' : 'No current result yet'}</div></div>
          <div className="stat-card"><div className="stat-top"><span className="stat-icon unchecked-icon" aria-hidden="true">○</span><span className="stat-label">NOT CHECKED</span></div><div className="stat-value">{review ? counts.unchecked : '—'}<span>{review ? ' ' + (counts.unchecked === 1 ? 'draft' : 'drafts') : ''}</span></div><div className="stat-note">{review ? 'No CSV export promise linked' : 'Awaiting graph check'}</div></div>
        </section>

        <div className="content-grid">
          <section className="drafts-panel" id="drafts">
            <div className="section-heading"><div><div className="eyebrow">CAMPAIGN REVIEW</div><h2>Drafts and promises</h2></div><span className="filter-button">All drafts</span></div>
            <div className="draft-list">
              {(review?.findings ?? []).map((finding) => (
                <button className={`draft-row ${finding.draftId === selectedId ? 'selected' : ''}`} key={finding.draftId} aria-label={`${finding.title}, ${finding.kind}, ${finding.status}`} aria-pressed={finding.draftId === selectedId} aria-controls="draft-details" onClick={() => setSelectedId(finding.draftId)}>
                  <span aria-hidden="true" className={`draft-kind-icon kind-${finding.kind.toLowerCase().replace(/\W+/g, '-')}`}>{finding.kind === 'Landing page' ? '▤' : finding.kind === 'Email' ? '✉' : '◎'}</span>
                  <span className="draft-copy"><span className="draft-title">{finding.title}<span className="draft-kind">{finding.kind}</span></span><span className="draft-quote">“{finding.text}”</span><span className="draft-reason">{finding.reason}</span></span>
                  <StatusPill status={finding.status} decorative /><span className="row-chevron" aria-hidden="true">›</span>
                </button>
              ))}
              {!review && !error && <div className="loading-state" role="status"><span className="loader" /> Loading campaign evidence…</div>}
              {review?.findings.length === 0 && <div className="empty-state">No drafts are linked to this campaign yet.</div>}
            </div>
            <div className="panel-footnote"><span className="footnote-icon">i</span> A finding applies to the linked promise and audience only. It is not a campaign approval.</div>
          </section>

          <aside className="detail-column">
            <section className="detail-card" id="draft-details" aria-live="polite">
              <div className="detail-card-heading"><div><div className="eyebrow">{selected?.status === 'Supported' ? 'WHY THIS IS SUPPORTED' : selected?.status === 'Contradicted' ? 'WHY IT NEEDS ATTENTION' : selected?.status === 'Unknown' ? 'WHY IT NEEDS REVIEW' : 'DRAFT CHECK'}</div><h2>{selected?.title ?? (review?.findings.length === 0 ? 'No drafts yet' : 'Select a draft')}</h2></div>{selected && <StatusPill status={selected.status} />}</div>
              {selected ? <>
                <div className="detail-claim"><span className="micro-label">DRAFT COPY</span><p className="claim-text">{selected.text || 'No draft copy was recorded.'}</p>{selected.wordingSourceTitle && <p className="wording-source">Reuses wording from {selected.wordingSourceTitle}</p>}</div>
                <div className="detail-claim linked-promise"><span className="micro-label">LINKED PROMISE BEING CHECKED</span><p className="claim-text">{selected.promiseText ?? (selected.status === 'Not checked' ? 'No promise is linked to this draft.' : 'No readable promise text is available for this linked path.')}</p>{selected.promiseText && <p className="claim-context">Checked for {selected.audienceName || 'an unspecified audience'}{selected.featureName ? ' · ' + selected.featureName : ''}</p>}</div>
                <p className="detail-reason">{selected.reason}</p>
                <div className="trail-heading"><span>Evidence trail</span><span className="live-label"><i /> FROM FALKORDB</span></div>
                <div className="evidence-list">
                  {selected.evidence.length ? selected.evidence.map((item, index) => <div className="evidence-item" key={`${item.id}-${index}`}><div className={`evidence-icon evidence-${item.kind}`}>{item.kind === 'deployment' ? '↗' : item.kind === 'rollout' ? '◉' : '✓'}</div><div><strong>{item.label}</strong><p>{item.detail}</p><p className="evidence-meta">{formatObservedAt(item.observedAt)} · Reviewed by {item.reviewedBy || 'not recorded'}</p></div></div>) : <div className="no-evidence">{selected.status === 'Not checked' ? 'No evidence trail is expected because this draft has no linked CSV export promise.' : 'No reviewed source records were returned for this promise.'}</div>}
                </div>
                <button className="secondary-button full-width" aria-expanded={showPath} aria-controls="connection-path" onClick={() => setShowPath((visible) => !visible)}>{showPath ? 'Hide connection path' : 'View connection path'} <span>{showPath ? '⌃' : '↗'}</span></button>
                {showPath && <ol className="connection-path" id="connection-path"><li>{selected.title}</li>{selected.wordingSourceTitle && <li>Reuses wording from {selected.wordingSourceTitle}</li>}{selected.promiseText && <li>{selected.promiseText}</li>}{selected.featureName && <li>{selected.featureName}</li>}{selected.audienceName && <li>{selected.audienceName}</li>}{selected.evidence.map((item) => <li key={`path-${item.id}`}>{item.label}</li>)}</ol>}
              </> : <div className="empty-detail">{review?.findings.length === 0 ? 'No drafts are linked to this campaign yet.' : review ? 'Select a draft to inspect its evidence and relationship path.' : error ? 'Draft details are unavailable until a fresh graph check succeeds.' : 'Campaign details will appear after the graph check completes.'}</div>}
            </section>

            <section className="proactive-card">
              <div className="proactive-head"><div className="proactive-orb">✳</div><div><div className="eyebrow">PROACTIVE REVIEW</div><h2>What needs a look</h2></div></div>
              {review?.proactiveItems.length ? <div className="proactive-list">{review.proactiveItems.map((item) => <button className="proactive-item" key={item.id} aria-label={`${item.status}: ${item.title}`} onClick={() => setSelectedId(item.id)}><span className={`proactive-status ${item.status.toLowerCase()}`} aria-hidden="true" /><span><strong>{item.title}</strong><small><span className="status-label">{item.status}</span> · {item.detail}</small></span><span className="row-chevron" aria-hidden="true">›</span></button>)}</div> : <p className="proactive-empty">{review ? 'No promises currently need a review.' : 'Review suggestions will appear when campaign evidence is available.'}</p>}
            </section>

            <section className="activity-card" id="activity"><div className="activity-heading"><span className="activity-icon">◷</span><div><div className="eyebrow">LATEST CHECK</div><h2>Campaign evidence</h2></div></div><div className="activity-entry"><span className="activity-line" /><span className="activity-dot" /><div><strong>{review ? 'Evidence checked from FalkorDB' : 'No check in this session'}</strong><small>{review ? `Today at ${formatTime(review.checkedAt)}` : 'A graph-backed check will appear here'}</small></div></div></section>
          </aside>
        </div>
        <footer className="page-footer"><span>Built around evidence, not assumptions.</span><span>Fictional product data <span className="footer-separator">·</span> No external actions</span></footer>
      </main>
    </div>
  );
}
