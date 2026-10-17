import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, Files, LayoutDashboard } from 'lucide-react';
import './workspace.css';
import type { ActionProposal, ActivityEntry, CampaignAssistantResponse, CampaignProposalPreview, CampaignReview, DraftFinding, FindingStatus, ProposalAction } from '../shared/contracts.js';
import { AppleMailTabs, reviewFilterIcons, type ReviewFilter, type ReviewFilterTab } from './components/AppleMailTabs.js';
import { MagneticDock } from './components/MagneticDock.js';

const campaignId = 'campaign-csv-launch';
type NavigationSection = 'overview' | 'campaign' | 'activity';
type DataState = 'loading' | 'ready' | 'unavailable';
const dockItems = [
  { id: 'overview', label: 'Overview', href: '#overview', icon: LayoutDashboard },
  { id: 'campaign', label: 'Campaigns', href: '#campaign', icon: Files },
  { id: 'activity', label: 'Activity', href: '#activity', icon: Activity },
];

function navigationSectionFromHash(): NavigationSection {
  const hash = window.location.hash.slice(1);
  if (hash === 'campaign' || hash === 'drafts') return 'campaign';
  if (hash === 'activity') return 'activity';
  return 'overview';
}

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

async function loadCampaign(recordCheck = false): Promise<CampaignReview> {
  await initializeFixture();
  const response = await fetch(`/api/campaigns/${campaignId}/${recordCheck ? 'check' : 'review'}`, {
    method: recordCheck ? 'POST' : 'GET',
    ...(recordCheck ? {} : { cache: 'no-store' as RequestCache }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'Could not load this campaign.';
    throw new Error(message);
  }
  if (typeof payload === 'object' && payload !== null && 'review' in payload) {
    return (payload as { review: CampaignReview }).review;
  }
  return payload as CampaignReview;
}

async function loadCampaignActivity(): Promise<ActivityEntry[]> {
  const response = await fetch(`/api/campaigns/${campaignId}/activity`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Campaign activity history is unavailable.');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Campaign activity history returned an invalid response.');
  return payload as ActivityEntry[];
}

async function loadCampaignProposals(): Promise<ActionProposal[]> {
  const response = await fetch(`/api/campaigns/${campaignId}/proposals`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Campaign proposals are unavailable.');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Campaign proposals returned an invalid response.');
  return payload as ActionProposal[];
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return typeof payload === 'object' && payload !== null && 'error' in payload ? String(payload.error) : fallback;
}

function audienceLabel(id: string): string {
  if (id === 'audience-internal-testers') return 'Internal testers';
  if (id === 'audience-all-accounts') return 'All customer accounts';
  return id;
}

class DemoActionUnavailableError extends Error {}

async function simulateRolloutExpansion(expanded: boolean): Promise<CampaignReview> {
  const response = await fetch(`/api/campaigns/${campaignId}/demo-rollout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expanded }),
  });
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

async function simulateTestAvailability(available: boolean): Promise<CampaignReview> {
  const response = await fetch(`/api/campaigns/${campaignId}/demo-test-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'The test scenario could not be updated.';
    if (response.status === 404) throw new DemoActionUnavailableError(message);
    throw new Error(message);
  }
  return payload as CampaignReview;
}

async function readCapabilities(): Promise<{ demoRollout: boolean; assistant: boolean }> {
  const response = await fetch('/api/capabilities');
  if (!response.ok) return { demoRollout: false, assistant: false };
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null) return { demoRollout: false, assistant: false };
  return {
    demoRollout: 'demoRollout' in payload && payload.demoRollout === true,
    assistant: 'assistant' in payload && payload.assistant === true,
  };
}

async function requestCampaignAssistant(message: string, allowProposal: boolean): Promise<CampaignAssistantResponse> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, allowProposal }),
  });
  if (!response.ok) throw new Error(await responseError(response, 'The assistant could not complete this request.'));
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('answer' in payload) || typeof payload.answer !== 'string'
    || !('toolCalls' in payload) || !Array.isArray(payload.toolCalls)) {
    throw new Error('The assistant returned an invalid response.');
  }
  const toolCalls = payload.toolCalls.flatMap((item) => {
    if (typeof item !== 'object' || item === null || !('name' in item) || typeof item.name !== 'string'
      || !('summary' in item) || typeof item.summary !== 'string') return [];
    return [{ name: item.name, summary: item.summary }];
  });
  const proposalPreview = 'proposalPreview' in payload && isCampaignProposalPreview(payload.proposalPreview)
    ? payload.proposalPreview : undefined;
  return { answer: payload.answer, toolCalls, ...(proposalPreview ? { proposalPreview } : {}) };
}

function isCampaignProposalPreview(value: unknown): value is CampaignProposalPreview {
  if (typeof value !== 'object' || value === null) return false;
  return 'action' in value && (value.action === 'pause' || value.action === 'edit')
    && 'draftId' in value && typeof value.draftId === 'string' && /^draft-[a-z0-9-]{1,80}$/.test(value.draftId)
    && 'draftTitle' in value && typeof value.draftTitle === 'string'
    && 'proposedText' in value && (typeof value.proposedText === 'string' || value.proposedText === null)
    && 'targetAudienceId' in value && typeof value.targetAudienceId === 'string' && /^audience-[a-z0-9-]{1,80}$/.test(value.targetAudienceId)
    && 'reason' in value && typeof value.reason === 'string';
}

function StatusPill({ status, decorative = false }: { status: FindingStatus; decorative?: boolean }) {
  return <span aria-hidden={decorative || undefined} className={`status-pill status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>;
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not available';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatObservedAt(value: string): string {
  if (!value) return 'Observation time not recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Observation time not available';
  return `Observed ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)}`;
}

function formatActivityAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not available';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function App() {
  const [review, setReview] = useState<CampaignReview | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [activityState, setActivityState] = useState<DataState>('loading');
  const [proposalState, setProposalState] = useState<DataState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftFilter, setDraftFilter] = useState<ReviewFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [demoRolloutAvailable, setDemoRolloutAvailable] = useState(false);
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantProposalAllowed, setAssistantProposalAllowed] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantResult, setAssistantResult] = useState<CampaignAssistantResponse | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [showPath, setShowPath] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [scenarioMessage, setScenarioMessage] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<{ message: string; actionUnavailable: boolean } | null>(null);
  const [activeSection, setActiveSection] = useState<NavigationSection>(navigationSectionFromHash);
  const reduceMotion = useReducedMotion();
  const [editingProposalFor, setEditingProposalFor] = useState<string | null>(null);
  const [proposalCopy, setProposalCopy] = useState('');
  const [proposalAudience, setProposalAudience] = useState('audience-internal-testers');
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [proposalMessage, setProposalMessage] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const proposalFeedbackRef = useRef<HTMLElement>(null);
  const assistantRequestVersion = useRef(0);
  const supportingDataRequestVersion = useRef(0);
  const rolloutExpanded = review?.findings.some((finding) => finding.evidence.some((item) => item.id === 'source-s4')) ?? false;

  useEffect(() => {
    document.title = 'Campaign review — official';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Review campaign claims against connected product and rollout evidence in the official campaign workspace.');
  }, []);

  const clearAssistantResponse = useCallback(() => {
    assistantRequestVersion.current += 1;
    setAssistantBusy(false);
    setAssistantProposalAllowed(false);
    setAssistantResult(null);
    setAssistantError(null);
  }, []);

  useEffect(() => {
    if (proposalMessage || proposalError) proposalFeedbackRef.current?.focus();
  }, [proposalMessage, proposalError]);

  const refreshSupportingData = useCallback(async () => {
    const requestVersion = ++supportingDataRequestVersion.current;
    setActivityState('loading');
    setProposalState('loading');
    const [history, pending] = await Promise.allSettled([loadCampaignActivity(), loadCampaignProposals()]);
    if (requestVersion !== supportingDataRequestVersion.current) return;
    if (history.status === 'fulfilled') {
      setActivity(history.value);
      setActivityState('ready');
    } else {
      setActivity([]);
      setActivityState('unavailable');
    }
    if (pending.status === 'fulfilled') {
      setProposals(pending.value);
      setProposalState('ready');
    } else {
      setProposals([]);
      setProposalState('unavailable');
    }
  }, []);

  const refresh = useCallback(async (recordCheck = false) => {
    supportingDataRequestVersion.current += 1;
    clearAssistantResponse();
    setLoading(true);
    setError(null);
    setScenarioMessage(null);
    setScenarioError(null);
    setReview(null);
    setActivity([]);
    setProposals([]);
    setActivityState('loading');
    setProposalState('loading');
    setProposalMessage(null);
    setProposalError(null);
    setSelectedId(null);
    setShowPath(false);
    try {
      let campaignResult: PromiseSettledResult<CampaignReview>;
      if (recordCheck) {
        [campaignResult] = await Promise.allSettled([loadCampaign(true)]);
        await refreshSupportingData();
      } else {
        [campaignResult] = await Promise.allSettled([loadCampaign(false), refreshSupportingData()]);
      }
      if (campaignResult.status === 'rejected') throw campaignResult.reason;
      const result = campaignResult.value;
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
  }, [clearAssistantResponse, refreshSupportingData]);

  const runRolloutScenario = async (expanded: boolean) => {
    if (loading || simulating || proposalBusy) return;
    supportingDataRequestVersion.current += 1;
    clearAssistantResponse();
    setSimulating(true);
    setError(null);
    setScenarioMessage(null);
    setScenarioError(null);
    setReview(null);
    setSelectedId(null);
    setShowPath(false);
    try {
      const result = await simulateRolloutExpansion(expanded);
      setReview(result);
      await refreshSupportingData();
      setSelectedId(result.findings.find((item) => item.needsReview)?.draftId ?? result.findings[0]?.draftId ?? null);
      const statusFor = (draftId: string) => result.findings.find((item) => item.draftId === draftId)?.status ?? 'not available';
      setScenarioMessage(`${expanded ? 'Access now includes all accounts.' : 'Access is back to internal testers only.'} Landing page: ${statusFor('draft-landing')}. Launch email: ${statusFor('draft-email')}. Tester post: ${statusFor('draft-social')}. Dashboard: ${statusFor('draft-dashboard')}. Draft text was not changed.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The demo rollout result could not be confirmed.';
      const actionUnavailable = cause instanceof DemoActionUnavailableError;
      await refresh();
      setScenarioError({
        message,
        actionUnavailable,
      });
    } finally {
      setSimulating(false);
    }
  };

  const runTestScenario = async () => {
    if (loading || simulating || proposalBusy) return;
    const restoreTest = review?.findings.some((finding) => finding.reason.includes('No current passing') && finding.reason.includes('test')) ?? false;
    supportingDataRequestVersion.current += 1;
    clearAssistantResponse();
    setSimulating(true);
    setError(null);
    setScenarioMessage(null);
    setScenarioError(null);
    setReview(null);
    setSelectedId(null);
    setShowPath(false);
    try {
      const result = await simulateTestAvailability(restoreTest);
      setReview(result);
      await refreshSupportingData();
      setSelectedId(result.findings.find((item) => item.needsReview)?.draftId ?? result.findings[0]?.draftId ?? null);
      setScenarioMessage(restoreTest
        ? 'The synthetic production test is available again. Findings were rechecked; no drafts were changed.'
        : 'The current synthetic production test was removed. Findings were rechecked so missing evidence appears as Unknown where appropriate.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The test scenario result could not be confirmed.';
      const actionUnavailable = cause instanceof DemoActionUnavailableError;
      await refresh();
      setScenarioError({ message, actionUnavailable });
    } finally {
      setSimulating(false);
    }
  };

  const createProposal = async (action: ProposalAction, draft: DraftFinding) => {
    if (loading || simulating || proposalBusy) return;
    setProposalBusy(draft.draftId);
    setProposalError(null);
    setProposalMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/drafts/${encodeURIComponent(draft.draftId)}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          proposedText: action === 'edit' ? proposalCopy : undefined,
          targetAudienceId: action === 'edit' ? proposalAudience : undefined,
          reason: action === 'pause'
            ? draft.reason
            : 'Revise the promise to match the audience selected for this internal draft.',
        }),
      });
      if (!response.ok) {
        const message = await responseError(response, 'The proposal could not be created.');
        throw new Error(message);
      }
      setEditingProposalFor(null);
      setProposalCopy('');
      await refresh();
      setProposalMessage(action === 'pause' ? 'Pause proposal created. The draft has not changed.' : 'Edit proposal created. The draft has not changed.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The proposal could not be created.';
      await refresh();
      setProposalError(message);
    } finally {
      setProposalBusy(null);
    }
  };

  const decideProposal = async (proposal: ActionProposal, decision: 'approve' | 'reject') => {
    if (loading || simulating || proposalBusy) return;
    setProposalBusy(proposal.id);
    setProposalError(null);
    setProposalMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/proposals/${encodeURIComponent(proposal.id)}/${decision}`, { method: 'POST' });
      if (!response.ok) {
        const message = await responseError(response, `The proposal could not be ${decision === 'approve' ? 'approved' : 'rejected'}.`);
        throw new Error(message);
      }
      await refresh();
      setProposalMessage(decision === 'approve' ? 'Proposal approved and applied to the internal draft.' : 'Proposal rejected. The draft was not changed.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `The proposal could not be ${decision === 'approve' ? 'approved' : 'rejected'}.`;
      await refresh();
      setProposalError(message);
    } finally {
      setProposalBusy(null);
    }
  };

  const resumeDraft = async (draft: DraftFinding) => {
    if (loading || simulating || proposalBusy) return;
    setProposalBusy(draft.draftId);
    setProposalError(null);
    setProposalMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/drafts/${encodeURIComponent(draft.draftId)}/resume`, { method: 'POST' });
      if (!response.ok) {
        const message = await responseError(response, 'The draft could not be resumed.');
        throw new Error(message);
      }
      await refresh();
      setProposalMessage('Draft resumed after a fresh supported check.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The draft could not be resumed.';
      await refresh();
      setProposalError(message);
    } finally {
      setProposalBusy(null);
    }
  };

  const submitAssistantQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantAvailable || !review || !assistantPrompt.trim() || assistantBusy || loading || simulating) return;
    const requestVersion = assistantRequestVersion.current + 1;
    assistantRequestVersion.current = requestVersion;
    setAssistantBusy(true);
    setAssistantError(null);
    setAssistantResult(null);
    try {
      const result = await requestCampaignAssistant(assistantPrompt.trim(), assistantProposalAllowed);
      if (requestVersion !== assistantRequestVersion.current) return;
      setAssistantResult(result);
      setAssistantPrompt('');
      await refreshSupportingData();
    } catch (cause) {
      if (requestVersion !== assistantRequestVersion.current) return;
      setAssistantError(cause instanceof Error ? cause.message : 'The assistant could not complete this request.');
    } finally {
      if (requestVersion === assistantRequestVersion.current) {
        setAssistantBusy(false);
        setAssistantProposalAllowed(false);
      }
    }
  };

  const submitAssistantProposal = async () => {
    const preview = assistantResult?.proposalPreview;
    if (!preview || proposalBusy || simulating || loading) return;
    setProposalBusy(preview.draftId);
    setProposalError(null);
    setProposalMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/drafts/${encodeURIComponent(preview.draftId)}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: preview.action,
          proposedText: preview.proposedText,
          targetAudienceId: preview.targetAudienceId,
          reason: preview.reason,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'The proposal could not be created.'));
      setAssistantResult((current) => current ? { ...current, proposalPreview: undefined } : current);
      await refresh();
      setProposalMessage('Pending proposal created. Review it in the queue; the draft has not changed.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The proposal could not be created.';
      await refresh();
      setProposalError(message);
    } finally {
      setProposalBusy(null);
    }
  };

  const discardAssistantProposal = () => {
    setAssistantResult((current) => current ? { ...current, proposalPreview: undefined } : current);
  };

  useEffect(() => {
    void refresh();
    void readCapabilities()
      .then((capabilities) => {
        setDemoRolloutAvailable(capabilities.demoRollout);
        setAssistantAvailable(capabilities.assistant);
      })
      .catch(() => {
        setDemoRolloutAvailable(false);
        setAssistantAvailable(false);
      });
  }, [refresh]);

  useEffect(() => {
    const syncActiveSection = () => setActiveSection(navigationSectionFromHash());
    window.addEventListener('hashchange', syncActiveSection);
    const initialTargetId = window.location.hash.slice(1);
    if (initialTargetId) {
      window.requestAnimationFrame(() => {
        document.getElementById(initialTargetId)?.scrollIntoView({ block: 'start' });
      });
    }
    const targets = (['overview', 'campaign', 'activity'] as const)
      .map((id) => ({ id, element: document.getElementById(id) }))
      .filter((item): item is { id: NavigationSection; element: HTMLElement } => item.element instanceof HTMLElement);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const target = targets.find((item) => item.element === visible?.target);
      if (target) setActiveSection(target.id);
    }, { rootMargin: '-22% 0px -62% 0px', threshold: [0, 0.1, 0.25, 0.5] });
    targets.forEach(({ element }) => observer.observe(element));
    return () => {
      window.removeEventListener('hashchange', syncActiveSection);
      observer.disconnect();
    };
  }, []);

  const counts = useMemo(() => {
    const values = review?.findings ?? [];
    return {
      contradicted: values.filter((item) => item.status === 'Contradicted').length,
      unknown: values.filter((item) => item.status === 'Unknown').length,
      supported: values.filter((item) => item.status === 'Supported').length,
      notChecked: values.filter((item) => item.status === 'Not checked').length,
    };
  }, [review]);

  const findings = review?.findings ?? [];
  const reviewTabs: ReviewFilterTab[] = useMemo(() => [
    { value: 'all', label: 'All drafts', count: findings.length, icon: reviewFilterIcons.all },
    { value: 'review', label: 'Needs review', count: findings.filter((item) => item.needsReview).length, icon: reviewFilterIcons.review },
    { value: 'supported', label: 'Supported', count: findings.filter((item) => item.status === 'Supported').length, icon: reviewFilterIcons.supported },
    { value: 'unchecked', label: 'Not checked', count: findings.filter((item) => item.status === 'Not checked').length, icon: reviewFilterIcons.unchecked },
  ], [findings]);
  const visibleFindings = useMemo(() => {
    if (draftFilter === 'review') return findings.filter((item) => item.needsReview);
    if (draftFilter === 'supported') return findings.filter((item) => item.status === 'Supported');
    if (draftFilter === 'unchecked') return findings.filter((item) => item.status === 'Not checked');
    return findings;
  }, [draftFilter, findings]);

  const selected: DraftFinding | undefined = review?.findings.find((item) => item.draftId === selectedId);
  const selectedHasPendingProposal = selected ? proposals.some((item) => item.draftId === selected.draftId && item.status === 'pending') : false;
  const testScenarioMissing = review?.findings.some((finding) => finding.reason.includes('No current passing') && finding.reason.includes('test')) ?? false;

  const scrollTo = (id: string) => {
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    }));
  };

  const openLandingFinding = () => {
    setDraftFilter('all');
    setSelectedId('draft-landing');
    setShowPath(false);
    scrollTo('draft-details');
  };

  const showLandingSources = () => {
    setDraftFilter('all');
    setSelectedId('draft-landing');
    setShowPath(true);
    scrollTo('draft-details');
  };

  function changeDraftFilter(filter: ReviewFilter) {
    setDraftFilter(filter);
    const nextFindings = filter === 'review'
      ? findings.filter((item) => item.needsReview)
      : filter === 'supported'
        ? findings.filter((item) => item.status === 'Supported')
        : filter === 'unchecked'
          ? findings.filter((item) => item.status === 'Not checked')
          : findings;
    if (nextFindings.length > 0 && !nextFindings.some((item) => item.draftId === selectedId)) setSelectedId(nextFindings[0].draftId);
    if (nextFindings.length === 0) setSelectedId(null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="official marketing site">
          <span className="brand-mark">o</span><span>official</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className={`nav-item ${activeSection === 'overview' ? 'active' : ''}`} href="#overview" aria-current={activeSection === 'overview' ? 'location' : undefined}><span className="nav-icon">◫</span> Overview</a>
          <a className={`nav-item ${activeSection === 'campaign' ? 'active' : ''}`} href="#campaign" aria-current={activeSection === 'campaign' ? 'location' : undefined}><span className="nav-icon">▤</span> Campaigns <span className="nav-count">1</span></a>
          <a className={`nav-item ${activeSection === 'activity' ? 'active' : ''}`} href="#activity" aria-current={activeSection === 'activity' ? 'location' : undefined}><span className="nav-icon">◷</span> Activity</a>
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
          <a className="brand" href="/" aria-label="official marketing site"><span className="brand-mark">o</span><span>official</span></a>
          <div className="header-context"><span>Launch workspace</span><span className="slash" aria-hidden="true">/</span><strong>Campaign review</strong></div>
          <div className="topbar-actions"><span className={error ? "connection-inline offline" : review ? "connection-inline online" : "connection-inline"} role="status"><span className="connection-dot" aria-hidden="true" />{error ? "Graph offline" : review ? "Graph connected" : "Connecting to graph"}</span><span className="demo-badge"><span className="demo-dot" aria-hidden="true" /> Fictional demo</span><div className="help-wrap"><button className="icon-button" aria-label="Help" aria-expanded={showHelp} aria-controls="help-panel" onClick={() => setShowHelp((visible) => !visible)}>?</button><section className="help-popover" id="help-panel" aria-label="How campaign checks work" hidden={!showHelp}><strong>How to read a check</strong><p><b>Supported</b> requires a reviewed promise, fresh reviewed rollout and deployment records, and a passing test on the deployed revision.</p><p><b>Contradicted</b> means a fresh reviewed rollout excludes that audience. Missing, old, unreviewed, or conflicting evidence is <b>Unknown</b>.</p><p><b>Not checked</b> means no promise is linked. Checks do not change draft copy; local demo settings save a status-only history record. The scenario control changes only the fictional local graph.</p></section></div><div className="avatar small" aria-hidden="true">O</div></div>
        </header>
        <div className="app-dock">
          <MagneticDock items={dockItems.map((item) => ({ ...item, active: activeSection === item.id }))} />
        </div>

        <section className="page-heading">
          <div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()} <span className="eyebrow-divider" aria-hidden="true">/</span> EVIDENCE WORKSPACE</div><h1>Launch claims, grounded in evidence.</h1><p className="subheading">Connect campaign copy to the reviewed product facts, rollouts, and tests behind it.</p></div>
          <div className="heading-actions"><details className="scenario-menu"><summary className="secondary-button scenario-button" title={demoRolloutAvailable ? 'Changes only the fictional graph fixture' : 'Demo writes are disabled on this deployment'}>Demo scenarios <span aria-hidden="true">⌄</span></summary><div className="scenario-menu-panel"><button type="button" onClick={() => void runRolloutScenario(!rolloutExpanded)} disabled={!demoRolloutAvailable || !review || loading || simulating || Boolean(proposalBusy)}>{simulating ? 'Updating scenario…' : rolloutExpanded ? 'Restore tester-only rollout' : 'Include all accounts'}</button><button type="button" onClick={() => void runTestScenario()} disabled={!demoRolloutAvailable || !review || loading || simulating || Boolean(proposalBusy)}>{simulating ? 'Updating scenario…' : testScenarioMissing ? 'Restore production test' : 'Simulate missing test result'}</button></div></details><button className="primary-button" title={demoRolloutAvailable ? 'Runs a check and records activity history' : 'Runs a read-only campaign check'} onClick={() => void refresh(demoRolloutAvailable)} disabled={loading || simulating || Boolean(proposalBusy)}><span className="button-spark" aria-hidden="true">✳</span>{loading ? 'Checking…' : 'Check campaign'}</button></div>
        </section>

        <section className="reviewer-guide" id="reviewer-guide" aria-labelledby="reviewer-guide-title">
          <div className="reviewer-guide-intro">
            <div className="eyebrow">REVIEWER WALKTHROUGH <span aria-hidden="true">·</span> ABOUT 2 MINUTES</div>
            <h2 id="reviewer-guide-title">See what changes.<br /><em>See what stays the same.</em></h2>
            <p>Can every account use CSV export today? Follow these four steps to see how official checks the promise.</p>
          </div>
          <div className="reviewer-guide-steps">
            <article className="reviewer-guide-step">
              <span className="guide-step-number">01</span>
              <div><h3>Read the promise</h3><p>The landing page says every account can use CSV export. The current rollout reaches internal testers only.</p></div>
              <button className="guide-link" type="button" onClick={openLandingFinding} disabled={!review}>Open the landing page finding <span aria-hidden="true">→</span></button>
            </article>
            <article className="reviewer-guide-step">
              <span className="guide-step-number">02</span>
              <div><h3>Follow the sources</h3><p>The product is live, and its test passed. A separate record shows who can use it.</p></div>
              <button className="guide-link" type="button" onClick={showLandingSources} disabled={!review}>Show the source records <span aria-hidden="true">→</span></button>
            </article>
            <article className="reviewer-guide-step">
              <span className="guide-step-number">03</span>
              <div><h3>Change access</h3><p>Current access: <strong>{rolloutExpanded ? 'all accounts' : 'internal testers only'}</strong>. Change it and see which findings move.</p></div>
              <button className="primary-button guide-action" type="button" onClick={() => void runRolloutScenario(!rolloutExpanded)} disabled={!demoRolloutAvailable || !review || loading || simulating || Boolean(proposalBusy)}>{simulating ? 'Checking the change…' : rolloutExpanded ? 'Restore tester-only access' : 'Open access to all accounts'}</button>
            </article>
            <article className="reviewer-guide-step">
              <span className="guide-step-number">04</span>
              <div><h3>Keep a person in control</h3><p>A check does not approve or publish a campaign. A person must approve a draft change. The activity list records each check.</p></div>
              <button className="guide-link" type="button" onClick={() => scrollTo('review-queue')} disabled={!review}>See review controls <span aria-hidden="true">→</span></button>
            </article>
          </div>
          <p className="reviewer-guide-note">Alder &amp; Finch and all campaign records are fictional. These controls change this local demo only.</p>
        </section>

        {error && <section className="connection-alert" role="alert"><div className="alert-icon" aria-hidden="true">!</div><div><strong>{error.toLowerCase().includes('campaign not found') ? 'Campaign data unavailable' : 'Campaign check unavailable'}</strong><p>{error} Check that FalkorDB is reachable and the campaign data is loaded, then try again. The check fails closed; no draft has changed.</p></div><button className="text-button" onClick={() => void refresh(demoRolloutAvailable)}>Retry</button></section>}
        {scenarioMessage && <section className="scenario-alert" role="status"><span className="scenario-check" aria-hidden="true">✓</span>{scenarioMessage}</section>}
        {scenarioError && <section className="scenario-alert scenario-alert-error" role="alert"><strong>{scenarioError.actionUnavailable ? 'Demo action unavailable.' : 'Scenario result unconfirmed.'}</strong> {scenarioError.message} {scenarioError.actionUnavailable ? 'The server rejected the request before any graph write. Current findings were reloaded.' : 'Current findings were reloaded. Run an explicit campaign check before relying on the scenario result.'}</section>}
        {proposalMessage && <section ref={proposalFeedbackRef} tabIndex={-1} className="scenario-alert" role="status"><span className="scenario-check" aria-hidden="true">✓</span>{proposalMessage}</section>}
        {proposalError && <section ref={proposalFeedbackRef} tabIndex={-1} className="scenario-alert scenario-alert-error" role="alert"><strong>Review action unavailable.</strong> {proposalError}</section>}

        <section className="campaign-banner" id="campaign">
          <div className="campaign-symbol"><span>01</span></div>
          <div className="campaign-info"><div className="campaign-kicker">{review?.campaign.companyName ?? 'Alder & Finch Commerce'} <span aria-hidden="true">·</span> FICTIONAL DEMO</div><h2>{review?.campaign.name ?? 'Spring reporting release'}</h2><p>For {review?.campaign.audience.toLowerCase() ?? 'all customer accounts'}</p><span className="campaign-details">{review?.campaign.industry ?? 'Multi-brand retail'} <i>·</i> {review?.campaign.region ?? 'North America'} <i>·</i> {review?.campaign.ownerTeam ?? 'Product marketing'} <i>·</i> {review?.campaign.releaseWindow ?? 'Spring 2026'}</span></div>
          <div className="campaign-meta"><div className="meta-icon">⌁</div><div><span>Latest evaluation</span><strong>{review ? formatCheckedAt(review.checkedAt) : 'Waiting for graph'}</strong></div></div>
          <a className="arrow-button" href="#drafts" aria-label="See campaign drafts">↘</a>
        </section>

        <section className="stats-row" aria-label="Campaign summary">
          <div className="stat-card stat-contradicted"><div className="stat-top"><span className="stat-icon contradicted-icon" aria-hidden="true">!</span><span className="stat-label">CONTRADICTED</span></div><div className="stat-value">{review ? counts.contradicted : '—'}<span>{review ? ` ${counts.contradicted === 1 ? 'draft' : 'drafts'}` : ''}</span></div><div className="stat-note">{review ? 'Conflicts with current facts' : 'Awaiting graph evaluation'}</div></div>
          <div className="stat-card"><div className="stat-top"><span className="stat-icon unknown-icon" aria-hidden="true">?</span><span className="stat-label">UNKNOWN</span></div><div className="stat-value">{review ? counts.unknown : '—'}<span>{review ? ` ${counts.unknown === 1 ? 'draft' : 'drafts'}` : ''}</span></div><div className="stat-note">{review ? 'Evidence is missing or unclear' : 'Awaiting graph evaluation'}</div></div>
          <div className="stat-card"><div className="stat-top"><span className="stat-icon supported-icon" aria-hidden="true">✓</span><span className="stat-label">SUPPORTED</span></div><div className="stat-value">{review ? counts.supported : '—'}<span>{review ? ` ${counts.supported === 1 ? 'draft' : 'drafts'}` : ''}</span></div><div className="stat-note">{review ? 'Backed by current records' : 'Awaiting graph evaluation'}</div></div>
          <div className="stat-card"><div className="stat-top"><span className="stat-icon unchecked-icon" aria-hidden="true">○</span><span className="stat-label">NOT CHECKED</span></div><div className="stat-value">{review ? counts.notChecked : '—'}<span>{review ? ` ${counts.notChecked === 1 ? 'draft' : 'drafts'}` : ''}</span></div><div className="stat-note">{review ? 'No product promise linked' : 'Awaiting graph evaluation'}</div></div>
        </section>



        <div className="content-grid">
          <section className="drafts-panel" id="drafts">
            <div className="section-heading drafts-heading"><div><div className="eyebrow">CAMPAIGN REVIEW</div><h2>Drafts and promises</h2></div><AppleMailTabs tabs={reviewTabs} value={draftFilter} onValueChange={changeDraftFilter} /></div>
            <div className="draft-list" id="draft-list" role="tabpanel" aria-labelledby={`draft-filter-${draftFilter}`}>
              {visibleFindings.map((finding, index) => (
                <motion.button initial={reduceMotion ? false : { opacity: 0 }} animate={reduceMotion ? undefined : { opacity: 1 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.2, delay: index * 0.025 }} className={`draft-row ${finding.draftId === selectedId ? 'selected' : ''}`} key={finding.draftId} aria-pressed={finding.draftId === selectedId} aria-controls="draft-details" onClick={() => setSelectedId(finding.draftId)}>
                  <span aria-hidden="true" className={`draft-kind-icon kind-${finding.kind.toLowerCase().replace(/\W+/g, '-')}`}>{finding.kind === 'Landing page' ? '▤' : finding.kind === 'Email' ? '✉' : '◎'}</span>
                  <span className="draft-copy"><span className="draft-title">{finding.title}<span className="draft-kind">{finding.kind}</span></span><span className="draft-quote">“{finding.text}”</span><span className="draft-reason">{finding.reason}</span></span>
                  <StatusPill status={finding.status} /><span className="row-chevron" aria-hidden="true">›</span>
                </motion.button>
              ))}
              {!review && !error && <div className="loading-state" role="status"><span className="loader" /> Loading campaign evidence…</div>}
              {review?.findings.length === 0 && <div className="empty-state" role="status" aria-live="polite" aria-atomic="true">No drafts are linked to this campaign yet.</div>}
              {review && findings.length > 0 && visibleFindings.length === 0 && <div className="empty-state filter-empty" role="status" aria-live="polite" aria-atomic="true">No drafts match this review status.</div>}
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
                {selected.draftState === 'paused' && <p className="proposal-help">Paused inside official. A reviewer can resume this draft after a fresh check supports its promise.</p>}
                {selected.status === 'Contradicted' && selected.draftState !== 'paused' && demoRolloutAvailable && <div className="proposal-compose">
                  <div className="proposal-compose-actions">
                    <button className="secondary-button" onClick={() => void createProposal('pause', selected)} disabled={loading || simulating || proposalState !== 'ready' || Boolean(proposalBusy) || selectedHasPendingProposal}>{proposalBusy === selected.draftId ? 'Saving…' : 'Propose pause'}</button>
                    <button className="text-button" onClick={() => { setEditingProposalFor(selected.draftId); setProposalCopy(''); setProposalAudience('audience-internal-testers'); }} disabled={loading || simulating || proposalState !== 'ready' || Boolean(proposalBusy) || selectedHasPendingProposal}>Suggest revised wording</button>
                  </div>
                  {selectedHasPendingProposal && <p className="proposal-help">A proposal for this draft is already waiting for review.</p>}
                  {editingProposalFor === selected.draftId && <div className="proposal-editor">
                    <label className="micro-label" htmlFor="proposal-copy">PROPOSED INTERNAL DRAFT COPY</label>
                    <textarea id="proposal-copy" value={proposalCopy} maxLength={600} onChange={(event) => setProposalCopy(event.target.value)} placeholder="Write copy that matches a specific audience." />
                    <label className="micro-label" htmlFor="proposal-audience">AUDIENCE FOR THE NEW PROMISE</label>
                    <select id="proposal-audience" value={proposalAudience} onChange={(event) => setProposalAudience(event.target.value)}>
                      <option value="audience-internal-testers">Internal testers</option>
                      <option value="audience-all-accounts">All customer accounts</option>
                    </select>
                    <div className="proposal-compose-actions"><button className="primary-button" onClick={() => void createProposal('edit', selected)} disabled={!proposalCopy.trim() || simulating || proposalState !== 'ready' || Boolean(proposalBusy)}>Create edit proposal</button><button className="text-button" onClick={() => setEditingProposalFor(null)} disabled={Boolean(proposalBusy) || simulating}>Cancel</button></div>
                  </div>}
                  <p className="proposal-help">Creating a proposal does not change the draft. Approval applies the internal edit only after a fresh check.</p>
                </div>}
                {selected.draftState === 'paused' && selected.status === 'Supported' && demoRolloutAvailable && <button className="secondary-button full-width resume-button" onClick={() => void resumeDraft(selected)} disabled={Boolean(proposalBusy) || loading || simulating}>{proposalBusy === selected.draftId ? 'Checking…' : 'Resume draft after fresh check'}</button>}
                <div className="trail-heading"><span>Evidence trail</span><span className="live-label"><i /> FROM FALKORDB</span></div>
                <div className="evidence-list">
                  {selected.evidence.length ? selected.evidence.map((item, index) => <div className="evidence-item" key={`${item.id}-${index}`}><div className={`evidence-icon evidence-${item.kind}`}>{item.kind === 'deployment' ? '↗' : item.kind === 'rollout' ? '◉' : '✓'}</div><div><strong>{item.label}</strong><p>{item.detail}</p><p className="evidence-meta">{formatObservedAt(item.observedAt)} · Reviewed by {item.reviewedBy || 'not recorded'}</p></div></div>) : <div className="no-evidence">{selected.status === 'Not checked' ? 'No evidence trail is expected because this draft has no linked CSV export promise.' : 'No reviewed source records were returned for this promise.'}</div>}
                </div>
                <button className="secondary-button full-width" aria-expanded={showPath} aria-controls="connection-path" onClick={() => setShowPath((visible) => !visible)}>{showPath ? 'Hide connection path' : 'View connection path'} <span>{showPath ? '⌃' : '↗'}</span></button>
                <ol className="connection-path" id="connection-path" hidden={!showPath}><li>{selected.title}</li>{selected.wordingSourceTitle && <li>Reuses wording from {selected.wordingSourceTitle}</li>}{selected.promiseText && <li>{selected.promiseText}</li>}{selected.featureName && <li>{selected.featureName}</li>}{selected.audienceName && <li>{selected.audienceName}</li>}{selected.evidence.map((item) => <li key={`path-${item.id}`}>{item.label}</li>)}</ol>
              </> : <div className="empty-detail">{review?.findings.length === 0 ? 'No drafts are linked to this campaign yet.' : review ? 'Select a draft to inspect its evidence and relationship path.' : error ? 'Draft details are unavailable until a fresh graph check succeeds.' : 'Campaign details will appear after the graph check completes.'}</div>}
            </section>

            <section className="proactive-card">
              <div className="proactive-head"><div className="proactive-orb">✳</div><div><div className="eyebrow">PROACTIVE REVIEW</div><h2>What needs a look</h2></div></div>
              {review?.proactiveItems.length ? <div className="proactive-list">{review.proactiveItems.map((item) => <button className="proactive-item" key={item.id} onClick={() => setSelectedId(item.id)}><span className={`proactive-status ${item.status.toLowerCase()}`} aria-hidden="true" /><span><strong>{item.title}</strong><small><span className="status-label">{item.status}</span> · {item.detail}</small></span><span className="row-chevron" aria-hidden="true">›</span></button>)}</div> : <p className="proactive-empty" role="status" aria-live="polite" aria-atomic="true">{review ? 'No promises currently need a review.' : 'Review suggestions will appear when campaign evidence is available.'}</p>}
            </section>

            <section className="review-queue-card" id="review-queue">
              <div className="section-heading"><div><div className="eyebrow">HUMAN REVIEW</div><h2>Proposal queue</h2></div><span className="filter-button">{proposalState === 'ready' ? `${proposals.filter((item) => item.status === 'pending').length} pending` : proposalState === 'loading' ? 'Loading…' : 'Unavailable'}</span></div>
              {proposalState === 'loading' ? <p className="proposal-empty" role="status" aria-live="polite" aria-atomic="true">Loading proposals…</p> : proposalState === 'unavailable' ? <p className="proposal-empty" role="status" aria-live="polite" aria-atomic="true">Proposal queue unavailable. Refresh before creating or reviewing a proposal.</p> : proposals.length ? <div className="proposal-list">{proposals.map((proposal) => {
                const draft = review?.findings.find((item) => item.draftId === proposal.draftId);
                return <article className="proposal-item" key={proposal.id}>
                  <div className="proposal-item-heading"><h3 id={`proposal-title-${proposal.id}`}>{proposal.action === 'pause' ? 'Pause draft' : `Revise for ${audienceLabel(proposal.targetAudienceId)}`} · {draft?.title ?? proposal.draftId}</h3><span className={`proposal-status proposal-${proposal.status}`}>{proposal.status.replace('_', ' ')}</span></div>
                  <p>{draft?.title ?? proposal.draftId}</p>
                  {proposal.proposedText && <blockquote>{proposal.proposedText}</blockquote>}
                  <small>{proposal.reason}</small>
                  {proposal.status === 'pending' && demoRolloutAvailable && <div className="proposal-compose-actions"><button className="primary-button" aria-label={`Approve proposal for ${draft?.title ?? proposal.draftId}`} onClick={() => void decideProposal(proposal, 'approve')} disabled={proposalState !== 'ready' || Boolean(proposalBusy) || loading || simulating}>{proposalBusy === proposal.id ? 'Saving…' : 'Approve'}</button><button className="text-button" aria-label={`Reject proposal for ${draft?.title ?? proposal.draftId}`} onClick={() => void decideProposal(proposal, 'reject')} disabled={proposalState !== 'ready' || Boolean(proposalBusy) || loading || simulating}>Reject</button></div>}
                  {proposal.status === 'pending' && !demoRolloutAvailable && <p className="proposal-help">Decision controls are unavailable. Enable local demo writes to review this proposal.</p>}
                </article>;
              })}</div> : <p className="proposal-empty" role="status" aria-live="polite" aria-atomic="true">No proposals are waiting. A contradicted draft can be paused or revised for a named audience.</p>}
              <p className="proposal-help">Approval is limited to internal drafts. The local demo does not verify reviewer identity or publish content.</p>
            </section>

          </aside>
        </div>
        <section className="activity-card" id="activity"><div className="activity-heading"><span className="activity-icon">◷</span><div><div className="eyebrow">ACTIVITY HISTORY</div><h2>Campaign activity</h2></div></div><div className="activity-list" aria-live="polite">{activityState === 'loading' ? <div className="activity-empty">Loading campaign activity…</div> : activityState === 'unavailable' ? <div className="activity-empty">Campaign activity history is unavailable. Refresh to try again.</div> : activity.length ? activity.map((entry) => <div className="activity-entry" key={entry.id}><span className="activity-line" /><span className="activity-dot" /><div><strong>{entry.title}</strong><small>{formatActivityAt(entry.occurredAt)} · {entry.detail}</small>{entry.runId && <small className="activity-run-id">Run ID: {entry.runId}</small>}</div></div>) : <div className="activity-empty">No persisted activity is available yet. Enable local demo writes to keep check history.</div>}</div></section>
        <section className="assistant-card" aria-labelledby="assistant-heading">
          <div className="assistant-heading"><div><div className="eyebrow">EVIDENCE ASSISTANT</div><h2 id="assistant-heading">Ask about this campaign</h2></div><span className="assistant-badge">Optional AI</span></div>
          <p id="assistant-disclosure" className="assistant-disclosure">When enabled, your prompt and synthetic campaign evidence are sent to OpenAI. Assistant checks can also add a local status-only history entry. Do not enter sensitive information. A proposal preview is saved only after you select Create pending proposal; applying it still requires a separate human approval.</p>
          <form className="assistant-form" onSubmit={(event) => void submitAssistantQuestion(event)}>
            <label htmlFor="assistant-prompt">Question</label>
            <textarea id="assistant-prompt" aria-describedby="assistant-disclosure" value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} maxLength={2000} placeholder="Why is the launch email contradicted?" disabled={!assistantAvailable || !review || assistantBusy} />
            <label className="assistant-proposal-toggle"><input type="checkbox" checked={assistantProposalAllowed} onChange={(event) => setAssistantProposalAllowed(event.target.checked)} disabled={!assistantAvailable || !review || assistantBusy} /> Allow proposal previews; I must choose Create pending proposal to save one</label>
            <div className="assistant-form-footer">
              <span>{assistantAvailable ? (review ? 'Uses named campaign tools and reviewed evidence.' : 'Check the campaign before asking a question.') : 'Configure OPENAI_API_KEY and local demo writes to enable the assistant.'}</span>
              <button className="primary-button" type="submit" disabled={!assistantAvailable || !review || !assistantPrompt.trim() || assistantBusy}>{assistantBusy ? 'Thinking…' : 'Ask assistant'}</button>
            </div>
          </form>
          {assistantBusy && <p className="assistant-feedback" role="status" aria-live="polite">Checking campaign evidence…</p>}
          {assistantError && <p className="assistant-error" role="alert">{assistantError}</p>}
          {assistantResult && <div className="assistant-result" aria-live="polite"><p>{assistantResult.answer}</p>{assistantResult.toolCalls.length > 0 && <ul>{assistantResult.toolCalls.map((call, index) => <li key={`${call.name}-${index}`}><strong>{call.name.replaceAll('_', ' ')}</strong> · {call.summary}</li>)}</ul>}{assistantResult.proposalPreview && <section className="assistant-proposal-preview" aria-label="Unsaved proposal preview"><h3>{assistantResult.proposalPreview.action === 'pause' ? 'Pause proposal preview' : 'Edit proposal preview'} · {assistantResult.proposalPreview.draftTitle}</h3><p>{assistantResult.proposalPreview.action === 'pause' ? 'Pause this internal draft while its promise is contradicted.' : `Proposed wording for ${audienceLabel(assistantResult.proposalPreview.targetAudienceId)}:`}</p>{assistantResult.proposalPreview.proposedText && <blockquote>{assistantResult.proposalPreview.proposedText}</blockquote>}<p>{assistantResult.proposalPreview.reason}</p><div className="proposal-compose-actions"><button className="primary-button" type="button" onClick={() => void submitAssistantProposal()} disabled={!demoRolloutAvailable || proposalState !== 'ready' || Boolean(proposalBusy) || simulating || loading || proposals.some((item) => item.draftId === assistantResult.proposalPreview?.draftId && item.status === 'pending')}>{proposalBusy === assistantResult.proposalPreview.draftId ? 'Saving…' : 'Create pending proposal'}</button><button className="text-button" type="button" onClick={discardAssistantProposal} disabled={Boolean(proposalBusy) || simulating || loading}>Discard preview</button></div></section>}</div>}
        </section>

        <footer className="page-footer"><span>Built around evidence, not assumptions.</span><span>Fictional product data <span className="footer-separator">·</span> No external actions</span><a href="/">Marketing site <span aria-hidden="true">↗</span></a></footer>
      </main>
    </div>
  );
}
