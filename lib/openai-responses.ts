const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";

type OpenAIOutputContent = {
  type?: string;
  text?: string;
};

type OpenAIOutputItem = {
  type?: string;
  content?: OpenAIOutputContent[];
};

type OpenAIResponsePayload = {
  id?: string;
  model?: string;
  output?: OpenAIOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type OpenAITextResult = {
  text: string;
  responseId: string | null;
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export class OpenAIResponseError extends Error {
  readonly status: number;

  constructor(status: number, message = "The AI service could not complete this request.") {
    super(message);
    this.name = "OpenAIResponseError";
    this.status = status;
  }
}

function outputText(payload: OpenAIResponsePayload): string {
  return (payload.output ?? [])
    .flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function generateOpenAIText(input: {
  apiKey: string;
  model?: string;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  safetyIdentifier?: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAITextResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new OpenAIResponseError(503, "AI is not configured.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model?.trim() || DEFAULT_MODEL,
        instructions: input.instructions,
        input: input.prompt,
        max_output_tokens: Math.min(1200, Math.max(80, input.maxOutputTokens ?? 650)),
        store: false,
        ...(input.safetyIdentifier ? { safety_identifier: input.safetyIdentifier } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new OpenAIResponseError(response.status);

    const payload = await response.json() as OpenAIResponsePayload;
    const text = outputText(payload);
    if (!text) throw new OpenAIResponseError(502, "The AI service returned no usable answer.");

    return {
      text,
      responseId: payload.id ?? null,
      model: payload.model ?? input.model?.trim() ?? DEFAULT_MODEL,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
      },
    };
  } catch (error) {
    if (error instanceof OpenAIResponseError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OpenAIResponseError(504, "The AI service took too long to respond.");
    }
    throw new OpenAIResponseError(502);
  } finally {
    clearTimeout(timeout);
  }
}

export const OPENAI_DEFAULT_MODEL = DEFAULT_MODEL;
