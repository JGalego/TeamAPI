export * from "./tools";
export * from "./tool";
export * from "./session";
export * from "./persona";
export * from "./providers";

/**
 * The default model for `teamapi chat`, kept for callers that imported it before the package
 * learned about more than one provider.
 *
 * @deprecated Prefer `PROVIDER_DEFAULTS[provider].model`, which answers the same question for
 * whichever provider is actually in use.
 */
export { DEFAULT_ANTHROPIC_MODEL as DEFAULT_CHAT_MODEL } from "./providers/anthropic";
