import { describe, expect, it, vi } from "vitest";
import { generateOpenAIText, OpenAIResponseError } from "../lib/openai-responses";

describe("OpenAI Responses client", () => {
  it("uses the Responses API with server-side auth, store disabled and the low-cost default model", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      id: "resp_test_123",
      model: "gpt-5.6-luna",
      output: [{ type: "message", content: [{ type: "output_text", text: "Doors look ready. Watch check-in throughput." }] }],
      usage: { input_tokens: 120, output_tokens: 18, total_tokens: 138 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await generateOpenAIText({
      apiKey: "sk-test-private",
      instructions: "Read-only operations guidance.",
      prompt: "What needs attention?",
      safetyIdentifier: "organizer-safe-id",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result).toMatchObject({
      text: "Doors look ready. Watch check-in throughput.",
      responseId: "resp_test_123",
      model: "gpt-5.6-luna",
      usage: { totalTokens: 138 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ authorization: "Bearer sk-test-private", "content-type": "application/json" });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      safety_identifier: "organizer-safe-id",
      input: "What needs attention?",
    });
  });

  it("does not expose provider error bodies or secrets when the provider rejects a request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "provider-detail-containing-sensitive-debug-data" },
    }), { status: 429, headers: { "content-type": "application/json" } }));

    await expect(generateOpenAIText({
      apiKey: "sk-never-return-this",
      instructions: "Read-only.",
      prompt: "Status?",
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toEqual(expect.objectContaining<Partial<OpenAIResponseError>>({
      name: "OpenAIResponseError",
      status: 429,
      message: "The AI service could not complete this request.",
    }));
  });

  it("combines output text from response message items only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "resp_multi",
      output: [
        { type: "reasoning", content: [{ type: "output_text", text: "hidden" }] },
        { type: "message", content: [{ type: "output_text", text: "First line." }, { type: "output_text", text: "Second line." }] },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await generateOpenAIText({
      apiKey: "sk-test",
      instructions: "Read-only.",
      prompt: "Summarise.",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.text).toBe("First line.\nSecond line.");
    expect(result.text).not.toContain("hidden");
  });
});
