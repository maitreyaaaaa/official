import { useEffect, useState } from 'react';
import './marketing-site.css';
import type { MarketingPage } from './routes.js';

const pageDetails: Record<MarketingPage, { title: string; description: string }> = {
  home: {
    title: 'official — Make every launch promise match the product',
    description: 'Check campaign promises against reviewed product, rollout, test, and audience evidence.',
  },
  review: {
    title: 'The review — official',
    description: 'See how official connects a launch claim to the product and rollout evidence behind it.',
  },
  method: {
    title: 'The method — official',
    description: 'Follow a campaign promise through its connected product evidence in FalkorDB.',
  },
  guardrails: {
    title: 'Guardrails — official',
    description: 'Evidence informs a review. A person stays in control of every proposed action.',
  },
  notFound: {
    title: 'Page not found — official',
    description: 'This official page is not available. Return to the overview or open the campaign workspace.',
  },
};

function Brand() {
  return <a className="marketing-brand" href="/" aria-label="official home"><span aria-hidden="true" />official</a>;
}

function Navigation({ page, open, onClose }: { page: MarketingPage; open: boolean; onClose: () => void }) {
  const items: Array<{ label: string; page: MarketingPage; href: string }> = [
    { label: 'Product', page: 'review', href: '/review' },
    { label: 'Method', page: 'method', href: '/method' },
    { label: 'Guardrails', page: 'guardrails', href: '/guardrails' },
  ];

  return (
    <>
      <nav id="marketing-menu" className={`marketing-links${open ? ' is-open' : ''}`} aria-label="Main navigation">
        {items.map((item) => (
          <a key={item.page} href={item.href} aria-current={page === item.page ? 'page' : undefined} onClick={onClose}>
            {item.label}
          </a>
        ))}
        <a className="mobile-demo-link" href="/app">Open reviewer app <span aria-hidden="true">↗</span></a>
      </nav>
      <a className="nav-demo" href="/app">Open reviewer app <span aria-hidden="true">↗</span></a>
    </>
  );
}

function SiteHeader({ page }: { page: MarketingPage }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="marketing-header">
      <div className="marketing-nav-wrap">
        <Brand />
        <Navigation page={page} open={open} onClose={() => setOpen(false)} />
        <button className="menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="marketing-menu" onClick={() => setOpen(!open)}>
          <span /><span />
        </button>
      </div>
    </header>
  );
}

function EvidenceMap() {
  return (
    <div className="evidence-map" aria-label="Evidence connects a draft to a promise, feature, rollout, and audience">
      <svg className="evidence-route" viewBox="0 0 640 390" role="img" aria-labelledby="route-title">
        <title id="route-title">Draft to audience evidence path</title>
        <path d="M58 270 C145 268 135 187 229 187 S327 111 404 126 S512 75 590 57" />
        <path className="route-guide" d="M404 126 L404 318 M229 187 L229 318" />
        {[ [58, 270], [229, 187], [404, 126], [590, 57] ].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" />)}
      </svg>
      <div className="map-card map-draft"><span className="map-step">01 · DRAFT</span><strong>“Available to every account.”</strong><small>Landing page</small></div>
      <div className="map-card map-promise"><span className="map-step">02 · PROMISE</span><strong>Every account</strong><small>Named audience</small></div>
      <div className="map-card map-feature"><span className="map-step">03 · FEATURE</span><strong>CSV export</strong><small>Production · R17</small></div>
      <div className="map-card map-rollout"><span className="map-step">04 · ROLLOUT</span><strong>Testers only</strong><small>Reviewed setting</small></div>
      <div className="map-verdict"><span className="verdict-mark">×</span><div><span>REVIEW FINDING</span><strong>Promise exceeds access</strong><small>One mismatch. One clear reason.</small></div></div>
      <span className="map-audience">ALL CUSTOMER ACCOUNTS</span>
    </div>
  );
}

function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero content-width">
        <div className="hero-copy">
          <p className="eyebrow">TRACK 1 <i>·</i> LAUNCH CLAIM REVIEW</p>
          <h1 aria-label="Make every launch promise match the product."><span>Make every</span><span>launch promise</span><em>match the product.</em></h1>
          <p className="hero-intro">Know what your campaign can say—because every promise points to reviewed product and rollout evidence.</p>
          <div className="hero-actions"><a className="button button-dark" href="/app">Open reviewer app <span aria-hidden="true">→</span></a><a className="text-link" href="/method">How it works <span aria-hidden="true">↓</span></a></div>
          <p className="hero-note"><span aria-hidden="true">✳</span> A two-minute local walkthrough. All company records are fictional.</p>
        </div>
        <EvidenceMap />
      </section>
      <section className="promise-band">
        <div className="content-width promise-band-inner"><h2>A launch is a chain<br />of <em>promises.</em></h2><p>Start with the claim.<br />Follow the facts.</p><a href="/method" aria-label="Read how the method works">↗</a></div>
      </section>
      <section className="home-proof content-width">
        <div className="proof-intro"><p className="eyebrow">BUILT FOR THE MOMENT BEFORE LAUNCH</p><h2>Catch the small mismatch<br />that changes the <em>whole claim.</em></h2></div>
        <div className="proof-note"><span className="proof-number">01 / 03</span><p>CSV export is running. But the current rollout still includes internal testers only.</p><a className="text-link" href="/review">See what the review finds <span aria-hidden="true">→</span></a></div>
      </section>
      <section className="closing-cta content-width"><div><p className="eyebrow">READY TO EXPLORE</p><h2>See the reviewer<br /><em>app in action.</em></h2><p>Open the working demo and follow the campaign review from claim to evidence.</p></div><a className="button button-dark" href="/app">Open reviewer app <span aria-hidden="true">↗</span></a></section>
    </main>
  );
}

function ReviewPage() {
  return (
    <main className="inner-page content-width">
      <div className="page-lead"><p className="eyebrow">01 / THE REVIEW</p><h1>A promise meets<br /><em>the product.</em></h1><p>A feature can be running while its rollout still excludes most customers. official shows the difference—and the evidence behind it.</p></div>
      <section className="review-layout" aria-label="Example launch claim review">
        <article className="claim-sheet">
          <div className="sheet-top"><span>ALDER &amp; FINCH / SPRING REPORTING RELEASE</span><span>LANDING PAGE <b>↗</b></span></div>
          <p className="claim-label">THE CLAIM</p><blockquote>“CSV export is available to every account.”</blockquote>
          <div className="claim-footer"><span>Named audience <strong>All customer accounts</strong></span><span>Promise <strong>Every account</strong></span></div>
        </article>
        <article className="finding-card">
          <div className="finding-top"><span className="status status-contradicted"><i /> CONTRADICTED</span><span className="review-id">REVIEW / AF-2026-04</span></div>
          <h2>The rollout doesn’t reach<br />the promised audience.</h2>
          <div className="fact-row"><span className="fact-index">01</span><div><small>PRODUCTION · REVISION R17</small><strong>CSV export is included</strong></div><span className="fact-ok">REVIEWED</span></div>
          <div className="fact-row"><span className="fact-index">02</span><div><small>CURRENT ROLLOUT</small><strong>Internal testers only</strong></div><span className="fact-ok">REVIEWED</span></div>
          <div className="finding-reason"><span>THE GAP</span><p>Running: <strong>yes</strong><br />Available to all accounts: <strong>no</strong></p></div>
        </article>
      </section>
      <section className="action-strip"><div><span className="eyebrow">PROPOSED ACTION · WAITING FOR A PERSON</span><h2>Pause this draft inside official?</h2><p>This changes status inside official only. It does not publish or alter product settings.</p></div><a className="button button-dark" href="/app">Start the reviewer walkthrough <span aria-hidden="true">↗</span></a></section>
      <p className="page-footnote">Fictional demo scenario; this page is illustrative and does not show a live graph result. A finding covers the promise checked. The team decides what happens next.</p>
    </main>
  );
}

function MethodPage() {
  return (
    <main className="inner-page content-width method-page">
      <div className="page-lead"><p className="eyebrow">02 / THE METHOD</p><h1>Follow the claim<br /><em>to its source.</em></h1><p>FalkorDB connects campaign wording to reviewed product and rollout facts. Follow each link until the promise meets its audience.</p></div>
      <section className="method-board" aria-label="Connected evidence chain">
          <div className="method-board-head"><span>CONNECTED EVIDENCE</span><span>ALDER &amp; FINCH / SPRING REPORTING <i>•</i> SOURCE TRACE</span></div>
        <div className="trace-chain">
          <div className="trace-item"><span className="trace-index">01</span><small>DRAFT</small><strong>Landing page</strong><span className="trace-detail">Spring campaign</span></div><span className="trace-arrow">→</span>
          <div className="trace-item"><span className="trace-index">02</span><small>PROMISE</small><strong>Every account</strong><span className="trace-detail">Named audience</span></div><span className="trace-arrow">→</span>
          <div className="trace-item"><span className="trace-index">03</span><small>FEATURE</small><strong>CSV export</strong><span className="trace-detail">Version R17</span></div><span className="trace-arrow">→</span>
          <div className="trace-item trace-emphasis"><span className="trace-index">04</span><small>ROLLOUT</small><strong>Testers only</strong><span className="trace-detail">Reviewed setting</span></div>
        </div>
        <div className="trace-outcome"><span className="outcome-symbol">×</span><div><small>THE NAMED AUDIENCE</small><strong>All customer accounts</strong></div><span className="outcome-line" /><span className="status status-contradicted"><i /> MISMATCH</span></div>
      </section>
      <section className="steps-grid"><article><span>01 <i>·</i> INTERPRET</span><h2>Match the promise.</h2><p>A person confirms what each draft sentence means and who it is for.</p></article><article><span>02 <i>·</i> TRACE</span><h2>Follow the evidence.</h2><p>The graph follows reviewed facts from the feature to the named audience.</p></article><article><span>03 <i>·</i> REVIEW</span><h2>Leave the decision to a person.</h2><p>A reviewer decides whether to revise or pause the draft. Missing or conflicting evidence stays <strong>Unknown.</strong></p></article></section>
    </main>
  );
}

const questions = [
  { question: 'Does Supported approve the campaign?', answer: 'No. It covers only the checked promise for its named audience. A person still reviews the campaign and decides what to do.' },
  { question: 'Can official publish this draft?', answer: 'No. official can suggest an internal action and wait for a reviewer. It does not publish content or change live product settings.' },
  { question: 'What if two facts disagree?', answer: 'The result stays Unknown until someone resolves the conflict. Missing, stale, and unreviewed facts do not become proof.' },
];

function GuardrailsPage() {
  return (
    <main className="inner-page content-width guardrails-page">
      <div className="page-lead"><p className="eyebrow">03 / THE GUARDRAILS</p><h1>Clear evidence.<br /><em>A person in control.</em></h1><p>official checks a named promise against reviewed facts. A person decides whether to revise or pause the draft.</p></div>
      <section className="principles" aria-label="Product guardrails"><article><span>01</span><h2>No source,<br /><em>no Supported.</em></h2><p>Missing or stale evidence stays Unknown.</p></article><article><span>02</span><h2>One finding.<br /><em>One promise.</em></h2><p>A result never speaks for a whole campaign.</p></article><article><span>03</span><h2>Every change<br /><em>waits for review.</em></h2><p>A person approves any proposed action.</p></article></section>
      <section className="faq-section"><div className="faq-heading"><p className="eyebrow">BEFORE YOU ASK</p><h2>Questions worth<br /><em>asking.</em></h2></div><div className="faq-list">{questions.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></section>
      <section className="closing-cta"><div><p className="eyebrow">TRACK 1 · FICTIONAL DEMO DATA</p><h2>A second look<br />before <em>launch.</em></h2><p>See how one rollout change reaches only the drafts that depend on it.</p></div><a className="button button-dark" href="/app">Explore the review flow <span aria-hidden="true">↗</span></a></section>
    </main>
  );
}

function SiteFooter() {
  return <footer className="marketing-footer"><div className="content-width footer-inner"><Brand /><span>Track 1 concept <i>·</i> Fictional demo data</span><a href="/app">Open reviewer app <span aria-hidden="true">↗</span></a></div></footer>;
}

function NotFoundPage() {
  return (
    <main className="not-found-page content-width" aria-labelledby="not-found-title">
      <p className="eyebrow">OFF THE MAP <i>·</i> 404</p>
      <h1 id="not-found-title">This page hasn’t<br /><em>launched.</em></h1>
      <p>The address may have changed, or this page may not be part of the workspace.</p>
      <div className="hero-actions">
        <a className="button button-dark" href="/">Back to official <span aria-hidden="true">↗</span></a>
        <a className="text-link" href="/app">Open the campaign workspace <span aria-hidden="true">→</span></a>
      </div>
    </main>
  );
}

export function MarketingSite({ page }: { page: MarketingPage }) {
  useEffect(() => {
    document.title = pageDetails[page].title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', pageDetails[page].description);
  }, [page]);

  return (
    <div className="marketing-site">
      <SiteHeader page={page} />
      {page === 'home' && <HomePage />}
      {page === 'review' && <ReviewPage />}
      {page === 'method' && <MethodPage />}
      {page === 'guardrails' && <GuardrailsPage />}
      {page === 'notFound' && <NotFoundPage />}
      <SiteFooter />
    </div>
  );
}
