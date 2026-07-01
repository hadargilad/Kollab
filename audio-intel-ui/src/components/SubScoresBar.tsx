import type { SubScores } from '../lib/api';

// Human-readable labels replace the internal a/b/c/d signal keys. The map
// is: a = topic incoherence, b = TF-IDF lexical anomaly, c = distilgpt2
// perplexity, d = cosine similarity to the euphemism dictionary.
export const SUB_LABELS: Array<[keyof SubScores, string, string]> = [
  ['a', 'Off-topic',    'bg-fuchsia-500'],
  ['b', 'Rare wording', 'bg-amber-500'],
  ['c', 'Unnatural',    'bg-cyan-500'],
  ['d', 'Coded phrase', 'bg-rose-500'],
];

// Full-length tooltip descriptions — one line per signal explaining what
// it actually measures. Shown when the analyst hovers a bar segment.
export const SUB_LEGEND: Record<keyof SubScores, string> = {
  a: 'Off-topic: segment drifts from the speaker\'s usual subject',
  b: 'Rare wording: words that are unusually rare in the corpus',
  c: 'Unnatural: phrasing that sounds statistically weird to a language model',
  d: 'Coded phrase: semantic similarity to known euphemisms',
};

interface Props {
  scores: SubScores;
  /** Compact = no labels under the bar. */
  compact?: boolean;
  /** When true, each segment width is its raw value (0..1) rather than normalized. */
  absolute?: boolean;
  /** Pixel height of the bar. */
  height?: number;
}

export default function SubScoresBar({ scores, compact = false, absolute = false, height = 8 }: Props) {
  const entries = SUB_LABELS.map(([k, label, color]) => ({
    label,
    color,
    value: Math.max(0, Math.min(1, scores[k] ?? 0)),
  }));
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  const denom = absolute ? entries.length : total;
  return (
    <div className="space-y-1">
      <div
        className="flex w-full overflow-hidden rounded-sm bg-zinc-900 border border-zinc-800"
        style={{ height: `${height}px` }}
      >
        {entries.map(e => (
          <div
            key={e.label}
            className={`${e.color} h-full`}
            style={{ width: `${(e.value / denom) * 100}%`, opacity: e.value > 0.01 ? 0.85 : 0 }}
            title={`${e.label} (${SUB_LEGEND[e.label.toLowerCase() as keyof SubScores]}) = ${e.value.toFixed(2)}`}
          />
        ))}
      </div>
      {!compact && (
        <div className="flex gap-3 text-[10px] font-mono text-zinc-200 flex-wrap">
          {entries.map(e => (
            <span key={e.label} className="inline-flex items-center gap-1">
              <span className={`inline-block w-1.5 h-1.5 rounded-sm ${e.color}`} />
              {e.label} {e.value.toFixed(2)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
