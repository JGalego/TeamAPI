import type { FastifyInstance } from "fastify";
import type { Metric } from "@jgalego/teamapi-core";

/** Seconds. The bottom of the range is where this API lives — every route is an in-memory read of
 * an already-resolved graph — and the top exists so a pathological request is visible rather than
 * hidden in `+Inf`. */
const DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5];

interface SeriesLabels {
  method: string;
  route: string;
  status: string;
}

interface RouteStats {
  /** The labels every sample for this series carries. Held alongside the counts rather than being
   * re-parsed out of the map key: a key is a string, and splitting one back into three labels is a
   * parser nobody asked for that breaks the first time a route template contains the separator. */
  labels: SeriesLabels;
  count: number;
  sumSeconds: number;
  /** Cumulative counts, aligned with `DURATION_BUCKETS`. */
  buckets: number[];
}

export class HttpMetrics {
  private readonly stats = new Map<string, RouteStats>();

  record(method: string, route: string, status: number, seconds: number): void {
    const labels: SeriesLabels = { method, route, status: String(status) };
    const key = JSON.stringify(labels);
    let entry = this.stats.get(key);
    if (!entry) {
      entry = { labels, count: 0, sumSeconds: 0, buckets: new Array<number>(DURATION_BUCKETS.length).fill(0) };
      this.stats.set(key, entry);
    }
    entry.count++;
    entry.sumSeconds += seconds;
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (seconds <= DURATION_BUCKETS[i]!) entry.buckets[i]!++;
    }
  }

  collect(): Metric[] {
    const requests: Metric = {
      name: "teamapi_http_requests_total",
      type: "counter",
      help: "HTTP requests served, by method, route template and status.",
      samples: [],
    };

    // A Prometheus histogram is three metric families that happen to share a prefix: `_bucket`
    // with an `le` label per boundary plus `+Inf`, then `_sum` and `_count`. Written out by hand
    // here, so the suffixes have to be exactly these — `histogram_quantile` matches on them by
    // name and silently returns nothing when they are spelled differently.
    const help = "HTTP request duration, by method, route template and status.";
    const buckets: Metric = {
      name: "teamapi_http_request_duration_seconds_bucket",
      type: "histogram",
      help,
      samples: [],
    };
    const sums: Metric = { name: "teamapi_http_request_duration_seconds_sum", type: "histogram", help, samples: [] };
    const counts: Metric = {
      name: "teamapi_http_request_duration_seconds_count",
      type: "histogram",
      help,
      samples: [],
    };

    // Sorted, so two scrapes of an unchanged server produce byte-identical payloads and a diff of
    // them shows only what actually moved.
    const entries = [...this.stats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);

    for (const entry of entries) {
      const labels = entry.labels;
      requests.samples.push({ labels: { ...labels }, value: entry.count });
      DURATION_BUCKETS.forEach((boundary, i) => {
        buckets.samples.push({ labels: { ...labels, le: String(boundary) }, value: entry.buckets[i]! });
      });
      buckets.samples.push({ labels: { ...labels, le: "+Inf" }, value: entry.count });
      // Rounded, because a float sum of milliseconds otherwise renders as 0.30000000000000004 and
      // makes every scrape payload differ noisily from the last for no reason.
      sums.samples.push({ labels: { ...labels }, value: Number(entry.sumSeconds.toFixed(6)) });
      counts.samples.push({ labels: { ...labels }, value: entry.count });
    }

    return [requests, buckets, sums, counts];
  }
}

/**
 * Counts and times every request.
 *
 * The `route` label is the route *template* (`/teams/:id`), never the URL that arrived. Using the
 * raw path would give a distinct time series per team id, per service name, per resource id — the
 * classic way a metrics endpoint quietly becomes the most expensive thing in a Prometheus
 * instance. A request that matched no route is labelled `__unmatched__` for the same reason:
 * scanners produce unbounded 404 paths, and they must not each mint a series.
 */
export function registerHttpMetrics(app: FastifyInstance, metrics: HttpMetrics): void {
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "__unmatched__";
    // Fastify's own measurement, so it covers the whole lifecycle rather than starting whenever a
    // hook happened to run.
    metrics.record(request.method, route, reply.statusCode, reply.elapsedTime / 1000);
  });
}
