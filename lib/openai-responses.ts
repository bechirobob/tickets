const DIRECT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_OUTPUT_TOKENS = 450;
const HARD_MAX_OUTPUT_TOKENS = 800;

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

type GatewayMetadataValue = string | number | boolean;

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

function responsesEndpoint(gatewayBaseUrl?: string) {
  const configuredBaseUrl = gatewayBaseUrl?.trim();
  const baseUrl = configuredBaseUrl || DIRECT_OPENAI_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new OpenAIResponseError(503, "AI gateway configuration is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new OpenAIResponseError(503, "AI gateway configuration is invalid.");
  }

  const directOpenAI = parsed.hostname === "api.openai.com";
  const cloudflareGateway = parsed.hostname === "gateway.ai.cloudflare.com";
  if (!directOpenAI && !cloudflareGateway) {
    throw new OpenAIResponseError(503, "AI gateway configuration is invalid.");
  }

  return {
    url: `${baseUrl.replace(/\/+$/u, "")}/responses`,
    cloudflareGateway,
  };
}

export async function generateOpenAIText(input: {
  apiKey: string;
  model?: string;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  safetyIdentifier?: string;
  gatewayBaseUrl?: string;
  gatewayMetadata?: Record<string, GatewayMetadataValue>;
  fetchImpl?: typeof fetch;
}): Promise<OpenAITextResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new OpenAIResponseError(503, "AI is not configured.");

  const endpoint = responsesEndpoint(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const requestedMaxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = Math.min(HARD_MAX_OUTPUT_TOKENS, Math.max(80, requestedMaxOutputTokens));

  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(endpoint.cloudflareGateway && input.gatewayMetadata
          ? { "cf-aig-metadata": JSON.stringify(input.gatewayMetadata) }
          : {}),
      },
      body: JSON.stringify({
        model: input.model?.trim() || DEFAULT_MODEL,
        instructions: input.instructions,
        input: input.prompt,
        max_output_tokens: maxOutputTokens,
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
