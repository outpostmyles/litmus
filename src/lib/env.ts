import { config } from 'dotenv'

config({ quiet: true })

export interface Config {
  apiKey: string
  /** Model id for the scoring engine. Defaults to Claude Opus 4.8. */
  model: string
  /** Anthropic API base URL. Pinned to api.anthropic.com so an ambient ANTHROPIC_BASE_URL doesn't misroute the key. */
  baseURL: string
}

/**
 * Reads engine configuration from the environment. Throws a clear error if the
 * Anthropic key is missing so the CLI fails loudly instead of at the API call.
 */
export function getConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in (this is a standalone Anthropic key, separate from any Claude Code session).',
    )
  }
  return {
    apiKey,
    model: process.env.LITMUS_MODEL || 'claude-opus-4-8',
    // Ignore any ambient ANTHROPIC_BASE_URL (e.g. a Claude Code proxy); override deliberately with LITMUS_ANTHROPIC_BASE_URL.
    baseURL: process.env.LITMUS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  }
}
