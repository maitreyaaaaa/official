import { ArrowRight, BookOpenText, CircleCheck, FileWarning, Workflow } from 'lucide-react';
import type { CampaignReview, WorkspaceSnapshot } from '../../shared/contracts.js';

interface WorkspaceOverviewProps {
  review: CampaignReview | null;
  workspace: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenFinding: () => void;
  onOpenSources: () => void;
  onOpenLaunch: () => void;
  onOpenMemory: () => void;
  onOpenBrain: () => void;
  onOpenCoverage: () => void;
  onReset: () => void;
  canReset: boolean;
  resetBusy: boolean;
}

export function WorkspaceOverview({ review, workspace, loading, error, onRefresh, onOpenFinding, onOpenSources,
  onOpenLaunch, onOpenMemory, onOpenBrain, onOpenCoverage, onReset, canReset, resetBusy }: WorkspaceOverviewProps) {
  const claimsToReview = review?.findings.filter((finding) => finding.needsReview).length ?? 0;
  const pendingTone = workspace?.memory.instructions.some((instruction) => instruction.topic === 'tone' && instruction.status === 'pending') ?? false;
  const pendingWriterDrafts = workspace?.memory.drafts.filter((draft) => draft.status === 'pending_approval').length ?? 0;
  const staleHandoff = workspace ? workspace.memory.handoff.revision < workspace.memory.briefRevision : false;
  const brain = workspace?.companyBrain;
  const backupNeeded = brain ? !brain.backupName : false;
  const guideNeedsReview = brain ? !brain.guideCurrent : false;
  const attentionCount = (claimsToReview > 0 ? 1 : 0) + (pendingTone || pendingWriterDrafts > 0 || staleHandoff ? 1 : 0) + (backupNeeded || guideNeedsReview ? 1 : 0);

  return <section className="workspace-overview" id="overview" aria-labelledby="overview-title">
    <header className="overview-intro">
      <span className="eyebrow">{workspace?.company.name ?? 'COMPANY WORKSPACE'} <span aria-hidden="true">/</span> {workspace?.project.name ?? 'CONNECTED LAUNCH'}</span>
      <h1 id="overview-title" tabIndex={-1}>What needs your attention</h1>
      <p>One launch across claims, writer memory, and company knowledge. Choose a task to see its evidence and next step.</p>
      <div className="overview-status" role="status" aria-live="polite" aria-atomic="true">
        {error ? 'Some connected records are unavailable.' : loading || !review || !workspace ? 'Reading the connected workspace…' : attentionCount > 0 ? `${attentionCount} of 3 areas need attention` : 'The current review has no open decisions.'}
      </div>
      {error && <div className="overview-error" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={onRefresh}>Retry</button></div>}
    </header>

    <div className="overview-actions" aria-label="Connected work areas">
      <article className="overview-action-card">
        <span className="overview-card-icon"><FileWarning size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">01 / LAUNCH CLAIMS</span>
        <h2>{review ? claimsToReview > 0 ? `${claimsToReview} ${claimsToReview === 1 ? 'draft needs' : 'drafts need'} review` : 'No drafts need review' : 'Campaign check unavailable'}</h2>
        <p>{review ? claimsToReview > 0 ? 'Compare the draft promise with the current rollout and test evidence.' : 'All linked claims have a current result. You can inspect every draft.' : 'Open Launch review when the campaign graph is available.'}</p>
        <button className="overview-card-link" type="button" onClick={onOpenLaunch}>Open Launch review <ArrowRight size={17} aria-hidden="true" /></button>
      </article>
      <article className="overview-action-card">
        <span className="overview-card-icon"><Workflow size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">02 / WRITING HANDOFF</span>
        <h2>{!workspace ? 'Writer handoff unavailable' : pendingTone ? 'Tone approval is waiting' : pendingWriterDrafts > 0 ? `${pendingWriterDrafts} ${pendingWriterDrafts === 1 ? 'draft awaits' : 'drafts await'} review` : staleHandoff ? 'Handoff needs a refresh' : 'Writer handoff is current'}</h2>
        <p>{workspace ? 'Check the approved brief before a fresh writing session or internal draft decision.' : 'The writer state appears when company records load.'}</p>
        <button className="overview-card-link" type="button" onClick={onOpenMemory}>Open writing handoff <ArrowRight size={17} aria-hidden="true" /></button>
      </article>
      <article className="overview-action-card">
        <span className="overview-card-icon"><BookOpenText size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">03 / COMPANY BRAIN</span>
        <h2>{!brain ? 'Company records unavailable' : backupNeeded ? 'Backup is not confirmed' : guideNeedsReview ? 'Handover guide needs review' : 'Launch review is covered'}</h2>
        <p>{brain ? 'Find the guide and source records, then inspect ownership coverage.' : 'Company notes and coverage appear when graph records load.'}</p>
        <button className="overview-card-link" type="button" onClick={backupNeeded || guideNeedsReview ? onOpenCoverage : onOpenBrain}>{backupNeeded || guideNeedsReview ? 'Review coverage' : 'Open Company Brain'} <ArrowRight size={17} aria-hidden="true" /></button>
      </article>
    </div>

    <details className="overview-walkthrough">
      <summary><CircleCheck size={19} aria-hidden="true" /><span><strong>Walk through the three-track demo</strong><small>Optional guided path · about 3 minutes</small></span></summary>
      <div className="overview-walkthrough-body">
        <ol>
          <li><strong>Check the claim.</strong> Compare the landing page draft with its reviewed rollout. <button type="button" onClick={onOpenFinding} disabled={!review}>Open claim</button> <button type="button" onClick={onOpenSources} disabled={!review}>See evidence</button></li>
          <li><strong>Refresh the writer.</strong> Review the proposed tone, start a fresh session, then inspect the internal draft. <button type="button" onClick={onOpenMemory}>Open writing handoff</button></li>
          <li><strong>Cover the owner.</strong> Follow the guide, propose a backup, and confirm the assignment. <button type="button" onClick={onOpenCoverage}>Review coverage</button></li>
        </ol>
        <div className="overview-reset"><p>{workspace?.company.name ?? 'This company'} and all records are fictional. Reset restores this launch scenario for another walkthrough; earlier graph history remains.</p><button type="button" className="text-button" onClick={onReset} disabled={!canReset}>{resetBusy ? 'Resetting…' : 'Reset fictional demo'}</button></div>
      </div>
    </details>
  </section>;
}
