export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricSample {
  labels?: Record<string, string | number | undefined>;
  value: number;
}

export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  samples: MetricSample[];
}

/**
 * Escapes a label value for the Prometheus text exposition format: backslash, double quote and
 * newline, and nothing else.
 *
 * This matters more than it looks. Label values here come from team documents — a team's `focus`,
 * a service name, a policy id — and a single unescaped quote in one of them produces a scrape
 * payload Prometheus rejects *in its entirety*. One team's punctuation would take out the whole
 * org's metrics.
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: MetricSample["labels"]): string {
  if (!labels) return "";
  const pairs = Object.entries(labels)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}="${escapeLabelValue(String(value))}"`);
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

/**
 * Renders metrics in the Prometheus text exposition format (version 0.0.4).
 *
 * Written out by hand rather than pulled in from `prom-client`, and the reason is the shape of
 * what is being exposed. Almost every metric here is a *gauge derived from the current org graph*
 * — teams by type, findings by severity, cognitive load per team — recomputed per scrape from an
 * immutable snapshot. A client library's value is its registry of long-lived mutable instruments,
 * which is exactly the part this does not need, and its cost is a runtime dependency in a package
 * whose entire premise is being a pure function of some YAML.
 *
 * The handful of genuinely accumulating metrics (HTTP request counts and latencies) are simple
 * enough to hold in a Map.
 */
export function renderPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    // A metric family with no samples still gets its HELP/TYPE, so a dashboard querying it sees a
    // known-empty series rather than an unknown one — "no gaps" and "gaps were never collected"
    // are different answers and should not look identical.
    lines.push(`# HELP ${metric.name} ${metric.help.replace(/\n/g, " ")}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      lines.push(`${metric.name}${renderLabels(sample.labels)} ${sample.value}`);
    }
  }
  // The format requires a trailing newline; without it the last sample is silently dropped.
  return `${lines.join("\n")}\n`;
}
