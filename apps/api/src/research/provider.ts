import type { Config } from "../config.js";
import { AnthropicProvider, ModelUnavailableError, type SynthesisProvider } from "./model.js";
import { OpenRouterProvider } from "./openrouter.js";

/** The one place a live synthesis provider is built from configuration. Throws ModelUnavailableError when it cannot be. */
export function createLiveProvider(config: Config): SynthesisProvider {
  switch (config.SYNTHESIS_PROVIDER) {
    case "openrouter":
      return new OpenRouterProvider({
        apiKey: config.OPENROUTER_API_KEY,
        model: config.BULLSEYE_MODEL,
        costTier: config.OPENROUTER_COST_TIER,
        maxPrice: { prompt: config.OPENROUTER_MAX_PRICE_PROMPT, completion: config.OPENROUTER_MAX_PRICE_COMPLETION },
        appUrl: config.PUBLIC_BASE_URL.startsWith("http://localhost") ? undefined : config.PUBLIC_BASE_URL,
      });
    case "anthropic":
      return new AnthropicProvider(config.BULLSEYE_MODEL, config.ANTHROPIC_API_KEY);
    case "fixture":
      throw new ModelUnavailableError("SYNTHESIS_PROVIDER=fixture is a test double, not a live provider");
  }
}
