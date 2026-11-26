import { inSeason, validDay } from './domain.js';

/** A jurisdiction may protect a whole genus, including species added in a later catalogue edition. */
export function scopedFishRules(rules, country, waterClass, latin, freshwater = true) {
  const genus = latin?.split(' ')[0];
  const entries = rules.entries.filter(
    (rule) =>
      rule.country === country && (country !== 'CZ' || rule.scope === 'czall' || rule.scope === waterClass),
  );
  return {
    species: entries.filter(
      (rule) => rule.species.includes(latin) || (genus && rule.genera?.includes(genus)),
    ),
    water: entries.filter((rule) => freshwater && rule.allFreshwater),
  };
}

/** A review evidences the published rule at that date. Do not infer its historical or future applicability. */
export function forFishingDate(rule, source, day) {
  if (
    !validDay(day) ||
    day < (rule.validFrom || source.checked) ||
    day > source.reviewBy ||
    (rule.validUntil && day > rule.validUntil)
  )
    return 'unverified';
  if (!rule.closed) return 'current';
  return inSeason(day, rule.closed) ? 'closed' : 'outside';
}
