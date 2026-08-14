/**
 * A Backstage catalog entity provider that reads a live Team API server.
 *
 * `teamapi generate backstage` writes `catalog-info.yaml` files, which suits an org that wants the
 * catalog in git. It does not suit an org that already has Backstage, because a generated file is
 * a snapshot: the catalog is correct until somebody changes a team document, and stays wrong until
 * somebody remembers to regenerate. That gap is exactly where a catalog stops being trusted.
 *
 * This polls `GET /backstage/catalog` — the same generator, served rather than written — so the
 * catalog is never further behind than one refresh interval, and there is no second mapping
 * between the two models to keep in sync.
 *
 * ## Types, and why they are declared here
 *
 * Backstage's `EntityProvider` is a structural interface. Depending on `@backstage/plugin-catalog-node`
 * to get it would pull the framework, its React peer set and its version constraints into a
 * workspace whose other five packages are a YAML parser and a Fastify app — and would pin this
 * plugin to one Backstage version, which is the thing most likely to be wrong for any given
 * installation. The three shapes it actually needs are twenty lines, so they are written out, and
 * this stays a plain TypeScript module any Backstage version can accept.
 */

/** The subset of Backstage's `Entity` this provider emits — matching what `/backstage/catalog` returns. */
export interface CatalogEntity {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; annotations?: Record<string, string>; [key: string]: unknown };
  spec?: Record<string, unknown>;
}

/** Backstage's `EntityProviderConnection`, structurally. */
export interface EntityProviderConnection {
  applyMutation(mutation: {
    type: "full";
    entities: Array<{ entity: CatalogEntity; locationKey?: string }>;
  }): Promise<void>;
}

export interface TeamApiEntityProviderOptions {
  /** Base URL of a running `teamapi serve-api`, e.g. `http://teamapi:3000`. */
  baseUrl: string;
  /** Bearer token, when the server was started with one. */
  token?: string;
  /** How often to refresh, in milliseconds. Defaults to five minutes. */
  refreshIntervalMs?: number;
  /** Distinguishes two providers pointed at different orgs. Defaults to `teamapi`. */
  id?: string;
  /**
   * Called when a refresh fails, instead of the error being thrown.
   *
   * Omitted, `refresh()` rethrows so the host's logger sees it. A provider that swallowed its
   * errors would leave a catalog silently frozen at whatever it last managed to read, which looks
   * exactly like a catalog that is up to date — and writing to `console` from a library is
   * somebody else's stdout, which for a Backstage backend is a structured log stream.
   */
  onError?: (error: Error) => void;
}

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

/**
 * The annotation Backstage uses to decide where an entity came from. Every entity gets the same
 * one, which is what makes a `full` mutation safe: Backstage removes anything under this location
 * that the mutation no longer contains, so a team deleted from the org graph disappears from the
 * catalog instead of lingering forever.
 */
export const LOCATION_ANNOTATION = "backstage.io/managed-by-location";
export const ORIGIN_ANNOTATION = "backstage.io/managed-by-origin-location";

export class TeamApiEntityProvider {
  private connection: EntityProviderConnection | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly options: Required<Pick<TeamApiEntityProviderOptions, "baseUrl" | "refreshIntervalMs" | "id">> &
    TeamApiEntityProviderOptions;

  constructor(options: TeamApiEntityProviderOptions) {
    this.options = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_MS,
      id: options.id ?? "teamapi",
    };
  }

  getProviderName(): string {
    return `teamapi-entity-provider:${this.options.id}`;
  }

  /** The location every entity is attributed to. Stable across refreshes, which is what lets a
   * `full` mutation replace the whole set rather than accumulating. */
  get location(): string {
    return `url:${this.options.baseUrl}/backstage/catalog`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    // A first refresh at connect time, so the catalog is populated at startup rather than after
    // one whole interval of showing nothing.
    await this.refresh();
    this.timer = setInterval(() => {
      // The interval's rethrow has nowhere to go, so it is turned into a rejected promise the
      // host's unhandled-rejection handling reports rather than an exception inside a timer.
      void this.refresh().catch((error: unknown) => {
        if (this.options.onError) return;
        throw error;
      });
    }, this.options.refreshIntervalMs);
    // Node keeps the process alive for a pending interval; a catalog refresh is not a reason for
    // a Backstage backend to refuse to shut down.
    this.timer.unref?.();
  }

  /** Stops the polling loop. Idempotent, so a caller that is not sure whether it connected can
   * call it anyway. */
  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.connection = undefined;
  }

  /**
   * Fetches once and applies. Public so a Backstage scheduler, or a webhook, can drive it instead
   * of (or as well as) the interval.
   *
   * A failed fetch never reaches `applyMutation`. A Team API server being briefly unreachable is
   * not a reason to empty somebody's service catalog, which is precisely what a `full` mutation of
   * zero entities would do — so the previously ingested entities stay, and the failure is reported
   * rather than applied.
   */
  async refresh(): Promise<void> {
    if (!this.connection) throw new Error(`${this.getProviderName()} is not connected`);

    let entities: CatalogEntity[];
    try {
      entities = await this.fetchEntities();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      // Handed to the caller's handler if there is one, and otherwise rethrown so the host's
      // logger sees it. Never logged here: writing to console from a library is writing to
      // somebody else's stdout, which for a Backstage backend is a structured log stream.
      if (!this.options.onError) throw error;
      this.options.onError(error);
      return;
    }

    await this.connection.applyMutation({
      type: "full",
      entities: entities.map((entity) => ({
        entity: this.annotate(entity),
        locationKey: this.getProviderName(),
      })),
    });
  }

  private annotate(entity: CatalogEntity): CatalogEntity {
    return {
      ...entity,
      metadata: {
        ...entity.metadata,
        annotations: {
          [LOCATION_ANNOTATION]: this.location,
          [ORIGIN_ANNOTATION]: this.location,
          ...entity.metadata.annotations,
        },
      },
    };
  }

  private async fetchEntities(): Promise<CatalogEntity[]> {
    const res = await fetch(`${this.options.baseUrl}/backstage/catalog`, {
      headers: {
        Accept: "application/json",
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${this.options.baseUrl}/backstage/catalog returned ${res.status} ${res.statusText}`);
    }

    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`${this.options.baseUrl}/backstage/catalog did not return an array of entities`);
    }
    // Checked rather than trusted: an entity with no name crashes the catalog processor with a
    // stack trace naming Backstage, several layers away from the server that produced it.
    for (const entity of body as CatalogEntity[]) {
      if (!entity?.kind || !entity.metadata?.name) {
        throw new Error(`${this.options.baseUrl}/backstage/catalog returned an entity with no kind or name`);
      }
    }
    return body as CatalogEntity[];
  }
}
