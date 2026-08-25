import type { RepositoryType } from "@dayu/repository-taxonomy";

export type AgeBand = "0-179d" | "180-729d" | "730d+";
export type StarBand = "0-99" | "100-999" | "1k-9,999" | "10k+";

export interface CalibrationRepository {
  createdAt: string;
  ecosystem: string;
  metrics: Readonly<Record<string, number>>;
  repositoryType: RepositoryType;
  stars: number;
}

export interface CohortKeys {
  ageBand: AgeBand;
  ecosystem: string;
  starBand: StarBand;
  type: RepositoryType;
}

export interface Percentiles {
  p50: number;
  p80: number;
  p95: number;
  p99: number;
}

export interface CalibrationCohort {
  keys: CohortKeys;
  metrics: Record<string, Percentiles>;
  repositoryCount: number;
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_${name}`);
  return value;
}

function ageBand(createdAt: string, analyzedAt: Date): AgeBand {
  const created = new Date(createdAt);
  if (!Number.isFinite(created.valueOf()) || created > analyzedAt) throw new Error("invalid_created_at");
  const days = Math.floor((analyzedAt.valueOf() - created.valueOf()) / 86_400_000);
  return days < 180 ? "0-179d" : days < 730 ? "180-729d" : "730d+";
}

function starBand(stars: number): StarBand {
  finiteNonNegative(stars, "stars");
  return stars < 100 ? "0-99" : stars < 1_000 ? "100-999" : stars < 10_000 ? "1k-9,999" : "10k+";
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error("empty_percentile");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(quantile * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

/** Builds aggregate-only cohorts. Callers must not put repository names or actor identifiers in metric keys. */
export function buildCohorts(repositories: readonly CalibrationRepository[], analyzedAt = new Date()): CalibrationCohort[] {
  if (!Number.isFinite(analyzedAt.valueOf())) throw new Error("invalid_analyzed_at");
  const buckets = new Map<string, { keys: CohortKeys; rows: CalibrationRepository[] }>();
  for (const repository of repositories) {
    if (repository.ecosystem.trim() === "") throw new Error("invalid_ecosystem");
    for (const [metric, value] of Object.entries(repository.metrics)) {
      if (metric.trim() === "" || /(?:actor|login|owner|repository|user)/iu.test(metric)) throw new Error("identifying_metric_key");
      finiteNonNegative(value, "metric");
    }
    const keys: CohortKeys = {
      ageBand: ageBand(repository.createdAt, analyzedAt),
      ecosystem: repository.ecosystem.trim().toLowerCase(),
      starBand: starBand(repository.stars),
      type: repository.repositoryType,
    };
    const key = JSON.stringify(keys);
    const bucket = buckets.get(key) ?? { keys, rows: [] };
    bucket.rows.push(repository);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map(({ keys, rows }) => {
    const metricNames = [...new Set(rows.flatMap((row) => Object.keys(row.metrics)))].sort();
    const metrics = Object.fromEntries(metricNames.map((metric) => {
      const values = rows.flatMap((row) => row.metrics[metric] === undefined ? [] : [row.metrics[metric]]);
      return [metric, {
        p50: percentile(values, 0.5),
        p80: percentile(values, 0.8),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
      }];
    }));
    return { keys, metrics, repositoryCount: rows.length };
  }).sort((left, right) => JSON.stringify(left.keys).localeCompare(JSON.stringify(right.keys)));
}
