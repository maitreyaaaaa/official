import type { ProofComparison } from '../../shared/reviewer-proof.js';

export function ProofStrip({ proof }: { proof: ProofComparison }) {
  return <section className="proof-strip" aria-label={proof.title} role="status">
    <strong>{proof.title}</strong>
    <div className="proof-steps">
      <div><span>Before</span><p>{proof.before}</p></div>
      <div><span>Graph change</span><p>{proof.changed}</p></div>
      <div><span>After</span><p>{proof.after}</p></div>
      <div><span>Comparison</span><p>{proof.control}</p></div>
    </div>
  </section>;
}
