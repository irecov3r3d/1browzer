/**
 * Resolve Gemini API key from the environment only — never hardcode.
 * Supports `.env` via dotenv (loaded in main/index.ts).
 */

export function resolveGeminiApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.GEMINI_API_KEY ?? env['process.env.GEMINI_API_KEY']
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  return key.length > 0 ? key : null
}

export function hasGeminiApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveGeminiApiKey(env) !== null
}
