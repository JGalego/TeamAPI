import type { ChatSession, ChatSessionOptions } from "../session";
import { createAnthropicSession, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { createOpenAiSession, DEFAULT_OPENAI_BASE_URL } from "./openai";

export const CHAT_PROVIDERS = ["anthropic", "openai"] as const;
export type ChatProviderName = (typeof CHAT_PROVIDERS)[number];

/** Sensible defaults per provider, so `--provider openai` alone is a working command. */
export const PROVIDER_DEFAULTS: Record<ChatProviderName, { model: string; apiKeyEnv: string; baseUrl?: string }> = {
  anthropic: { model: DEFAULT_ANTHROPIC_MODEL, apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { model: "gpt-4o", apiKeyEnv: "OPENAI_API_KEY", baseUrl: DEFAULT_OPENAI_BASE_URL },
};

export interface CreateChatSessionOptions extends Omit<ChatSessionOptions, "model"> {
  provider: ChatProviderName;
  /** Defaults to the provider's own default model. */
  model?: string;
  apiKey?: string;
  /** Only meaningful for `openai`, where it selects which compatible server to talk to. */
  baseUrl?: string;
}

export class MissingApiKeyError extends Error {
  constructor(
    readonly provider: ChatProviderName,
    readonly envVar: string,
  ) {
    super(`No API key for provider '${provider}'. Set ${envVar}, or pass --api-key.`);
    this.name = "MissingApiKeyError";
  }
}

export function isChatProvider(value: string): value is ChatProviderName {
  return (CHAT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Builds a session for the named provider.
 *
 * Two adapters rather than a plugin system, because two is what the interoperability landscape
 * actually has: the Anthropic API, and the OpenAI Chat Completions wire format that everything
 * else — Azure, Ollama, vLLM, Together, Groq, OpenRouter, most self-hosted gateways — speaks. A
 * third provider is a base URL, not a code change.
 */
export function createChatSession(options: CreateChatSessionOptions): ChatSession {
  const defaults = PROVIDER_DEFAULTS[options.provider];
  const model = options.model ?? defaults.model;
  const apiKey = options.apiKey ?? process.env[defaults.apiKeyEnv];
  const shared = {
    system: options.system,
    tools: options.tools,
    model,
    maxToolIterations: options.maxToolIterations,
    onToolCall: options.onToolCall,
  };

  if (options.provider === "anthropic") {
    if (!apiKey) throw new MissingApiKeyError("anthropic", defaults.apiKeyEnv);
    return createAnthropicSession({ ...shared, apiKey });
  }

  const baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? defaults.baseUrl!;
  // No key required: a model served locally by Ollama or vLLM has none, and demanding one would
  // make the zero-cost way to try this the one way that does not work.
  return createOpenAiSession({ ...shared, baseUrl, apiKey });
}

export { createAnthropicSession, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export { createOpenAiSession, DEFAULT_OPENAI_BASE_URL, type OpenAiSessionOptions } from "./openai";
export type { AnthropicSessionOptions } from "./anthropic";
