// ZAI (Zhipu AI) client. ZAI is an OpenAI-compatible gateway to the GLM
// family of models. We hit the Coding Plan endpoint, which is what most ZAI
// subscriptions are; if you're on pay-as-you-go general API access instead,
// swap BASE to https://api.z.ai/api/paas/v4.
// Note: per ZAI's terms, the Coding Plan endpoint is "intended for supported
// tools only" — using it from this app is the user's call.
const BASE = 'https://api.z.ai/api/coding/paas/v4'

// Returns the catalog so the UI can list models. Requires the user's key —
// ZAI's /models route is authenticated, not public.
export async function listModels(apiKey) {
  if (!apiKey) return []
  const res = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`ZAI models ${res.status}`)
  const body = await res.json()
  return (body?.data || [])
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Validate a key cheaply by calling the authenticated /models endpoint.
// ZAI has no OpenRouter-style /key info route, so a 200 here means the key works.
export async function validateKey(apiKey) {
  if (!apiKey) throw new Error('Missing ZAI API key. Add it in Settings.')
  const res = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`ZAI ${res.status}: invalid key`)
  return true
}

// Pull a JSON object out of a model response, tolerating code fences / prose.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Model did not return JSON.')
  return JSON.parse(candidate.slice(start, end + 1))
}

// One chat completion that must return a JSON object.
export async function chatJSON({ apiKey, model, prompt }) {
  if (!apiKey) throw new Error('Missing ZAI API key. Add it in Settings.')
  if (!model) throw new Error('No model selected. Pick one in Settings.')

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // Reasoning models (glm-5.x) burn 800-1500 tokens "thinking" before the
      // JSON. 16k gives enough headroom for a batch of 6 slideshows + reasoning.
      max_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`ZAI ${res.status}: ${body?.error?.message || res.statusText}`)
  }
  const choice = body?.choices?.[0]
  const finishReason = choice?.finish_reason
  // Reasoning models put their thinking in `reasoning_content`. If `content`
  // came back empty (often when the model finished thinking but produced a
  // terse final answer, or when finish_reason='length' cut off the wrong
  // field), try reasoning_content as a fallback.
  const content = choice?.message?.content || choice?.message?.reasoning_content
  if (!content) {
    if (finishReason === 'length') {
      throw new Error(
        `ZAI ran out of token budget (finish_reason=length). Lower the count, switch to glm-4.7, or trim the style memory.`
      )
    }
    throw new Error('ZAI returned no content.')
  }
  return extractJson(content)
}
