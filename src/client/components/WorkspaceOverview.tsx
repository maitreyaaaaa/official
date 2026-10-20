import { ArrowRight, BookOpenText, CircleCheck, FileWarning, Workflow } from 'lucide-react';
import type { CampaignReview, WorkspaceSnapshot } from '../../shared/contracts.js';
import { ErrorNotice, LoadingStatus, SkeletonLines } from './AsyncStates.js';

interface WorkspaceOverviewProps {
  review: CampaignReview | null;
  workspace: WorkspaceSnapshot | null;
  reviewLoading: boolean;
  workspaceLoading: boolean;
  reviewError: string | null;
  workspaceError: string | null;
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

function CardSkeleton() {
  return <div className="overview-card-skeleton" aria-label="Loading records">
    <SkeletonLines count={3} />
  </div>;
}

function CardFreshness({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <LoadingStatus className="overview-card-freshness">Updating</LoadingStatus>;
  if (error) return <span className="overview-card-freshness stale">Last loaded data</span>;
  return null;
}

export function WorkspaceOverview({ review, workspace, reviewLoading, workspaceLoading, reviewError, workspaceError, onRefresh,
  onOpenFinding, onOpenSources, onOpenLaunch, onOpenMemory, onOpenBrain, onOpenCoverage, onReset, canReset, resetBusy }: WorkspaceOverviewProps) {
  const claimsToReview = review?.findings.filter((finding) => finding.needsReview).length ?? 0;
  const pendingTone = workspace?.memory.instructions.some((instruction) => instruction.topic === 'tone' && instruction.status === 'pending') ?? false;
  const pendingWriterDrafts = workspace?.memory.drafts.filter((draft) => draft.status === 'pending_approval').length ?? 0;
  const staleHandoff = workspace ? workspace.memory.handoff.revision < workspace.memory.briefRevision : false;
  const brain = workspace?.companyBrain;
  const backupNeeded = brain ? !brain.backupName : false;
  const guideNeedsReview = brain ? !brain.guideCurrent : false;
  const attentionCount = (claimsToReview > 0 ? 1 : 0) + (pendingTone || pendingWriterDrafts > 0 || staleHandoff ? 1 : 0) + (backupNeeded || guideNeedsReview ? 1 : 0);
  const errors = [reviewError && `Launch review: ${reviewError}`, workspaceError && `Company records: ${workspaceError}`].filter((value): value is string => Boolean(value));
  const loading = reviewLoading || workspaceLoading;
  const hasData = Boolean(review || workspace);

  return <section className="workspace-overview" id="overview" aria-labelledby="overview-title" aria-busy={loading}>
    <header className="overview-intro">
      <span className="eyebrow">{workspace?.company.name ?? 'COMPANY WORKSPACE'} <span aria-hidden="true">/</span> {workspace?.project.name ?? 'CONNECTED LAUNCH'}</span>
      <h1 id="overview-title" tabIndex={-1}>What needs your attention</h1>
      <p>Review launch claims, use the current writing brief, and find the company records behind the work. Choose a task to see what needs to happen next.</p>
      <div className={`overview-status ${errors.length ? 'has-error' : loading ? 'is-loading' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {errors.length
          ? 'Some records could not be refreshed. Saved records remain visible where possible.'
          : loading
            ? <LoadingStatus>{hasData ? 'Updating the connected workspace…' : 'Loading the connected workspace…'}</LoadingStatus>
            : attentionCount > 0 ? `${attentionCount} of 3 areas need attention` : 'The current review has no open decisions.'}
      </div>
      {errors.length > 0 && <ErrorNotice
        className="overview-error"
        title={hasData ? 'Showing the last loaded records' : 'Some records need another try'}
        message={errors.join(' ')}
        onRetry={onRefresh}
      />}
    </header>

    <div className="overview-actions" aria-label="Connected work areas">
      <article className="overview-action-card" aria-busy={reviewLoading}>
        <span className="overview-card-icon"><FileWarning size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">01 / LAUNCH CLAIMS</span>
        {review ? <>
          <CardFreshness loading={reviewLoading} error={reviewError} />
          <h2>{claimsToReview > 0 ? `${claimsToReview} ${claimsToReview === 1 ? 'claim needs' : 'claims need'} review` : 'No claims need review'}</h2>
          <p>{claimsToReview > 0 ? 'Compare the draft promise with the current rollout and test evidence.' : 'All linked claims have a current result. You can inspect every draft.'}</p>
        </> : reviewLoading ? <CardSkeleton /> : <div className="overview-card-failed"><h2>Campaign check needs a retry</h2><p>Campaign evidence will appear after the next successful check.</p></div>}
        <button className="overview-card-link" type="button" onClick={onOpenLaunch}>Open Launch review <ArrowRight size={17} aria-hidden="true" /></button>
      </article>

      <article className="overview-action-card" aria-busy={workspaceLoading}>
        <span className="overview-card-icon"><Workflow size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">02 / WRITING BRIEF</span>
        {workspace ? <>
          <CardFreshness loading={workspaceLoading} error={workspaceError} />
          <h2>{pendingTone ? 'A tone change needs approval' : pendingWriterDrafts > 0 ? `${pendingWriterDrafts} ${pendingWriterDrafts === 1 ? 'draft awaits' : 'drafts await'} review` : staleHandoff ? 'The saved brief is out of date' : 'Writing brief is current'}</h2>
          <p>Review approved guidance before creating or approving an internal draft.</p>
        </> : workspaceLoading ? <CardSkeleton /> : <div className="overview-card-failed"><h2>Writing brief needs a retry</h2><p>Retry to load the latest approved guidance and draft status.</p></div>}
        <button className="overview-card-link" type="button" onClick={onOpenMemory}>Open writing brief <ArrowRight size={17} aria-hidden="true" /></button>
      </article>

      <article className="overview-action-card" aria-busy={workspaceLoading}>
        <span className="overview-card-icon"><BookOpenText size={20} aria-hidden="true" /></span>
        <span className="overview-card-kicker">03 / COMPANY RECORDS</span>
        {brain ? <>
          <CardFreshness loading={workspaceLoading} error={workspaceError} />
          <h2>{backupNeeded ? 'Backup is not confirmed' : guideNeedsReview ? 'Handover guide needs review' : 'Launch review is covered'}</h2>
          <p>Find the guide and source records, then inspect ownership coverage.</p>
        </> : workspaceLoading ? <CardSkeleton /> : <div className="overview-card-failed"><h2>Company records need a retry</h2><p>Company notes and coverage will appear when records load.</p></div>}
        <button className="overview-card-link" type="button" onClick={backupNeeded || guideNeedsReview ? onOpenCoverage : onOpenBrain}>{backupNeeded || guideNeedsReview ? 'Review coverage' : 'Browse company records'} <ArrowRight size={17} aria-hidden="true" /></button>
      </article>
    </div>

    <details className="overview-walkthrough">
      <summary><CircleCheck size={19} aria-hidden="true" /><span><strong>Follow a sample launch</strong><small>Optional guided path · about 3 minutes</small></span></summary>
      <div className="overview-walkthrough-body">
        <ol>
          <li><strong>Check the claim.</strong> Compare the landing page draft with its reviewed rollout. <button type="button" onClick={onOpenFinding} disabled={!review}>Open claim</button> <button type="button" onClick={onOpenSources} disabled={!review}>See evidence</button></li>
          <li><strong>Prepare a new draft.</strong> Review the proposed tone, use current guidance, then inspect the internal draft. <button type="button" onClick={onOpenMemory}>Open writing brief</button></li>
          <li><strong>Cover the owner.</strong> Follow the guide, propose a backup, and confirm the assignment. <button type="button" onClick={onOpenCoverage}>Review coverage</button></li>
        </ol>
        <div className="overview-reset"><p>{workspace?.company.name ?? 'This company'} and all records are fictional. Reset restores this launch scenario for another walkthrough; earlier graph history remains.</p><button type="button" className="text-button" onClick={onReset} disabled={!canReset}>{resetBusy ? 'Resetting…' : 'Reset fictional demo'}</button></div>
      </div>
    </details>
  </section>;
}
