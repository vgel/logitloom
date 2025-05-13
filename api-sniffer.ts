export interface ApiInfo {
  provider: "openai" | "anthropic" | "deepseek" | "openrouter" | "hyperbolic" | "vllm" | "kobold-cpp" | "chutes" | "unknown";
  supportsLogprobs: "yes" | "no" | "unknown";
  supportsPrefill: "yes" | "no" | "unknown";
  prefillStyle?: { kind: "trailing" } | { kind: "flags"; flags: Record<string, any>; target: "body" | "message" };
  needsTemperature?: number;
  onlySupportsModels?: string[];
  extraWarning?: string;
}

const UNKNOWN_API: ApiInfo = {
  provider: "unknown",
  supportsLogprobs: "unknown",
  supportsPrefill: "unknown",
};

export async function sniffApi(baseUrl: string, apiKey: string): Promise<ApiInfo> {
  baseUrl = baseUrl.replace(/\/+$/, "");

  // walk up baseUrl in case /models is hosted on a higher path (e.g. deepseek has api.deepseek.com/models but not /beta/models)
  for (let i = 0; i < 3; i++) {
    try {
      const info = await _sniffApi(baseUrl, apiKey);
      if (info.provider !== "unknown") {
        return info;
      }
    } catch (e) {
      console.log(`/models error for ${baseUrl}:`, e);
    }
    baseUrl = baseUrl.slice(0, baseUrl.lastIndexOf("/"));
    if (!baseUrl.includes("://")) {
      break;
    }
  }

  return UNKNOWN_API;
}

async function _sniffApi(baseUrl: string, apiKey: string): Promise<ApiInfo> {
  let response;
  let lastError: any;

  // try different headers in case of CORS issues
  const headerConfigs = [
    {
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    {
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    },
    {
      Authorization: `Bearer ${apiKey}`,
    },
  ];

  for (const headers of headerConfigs) {
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers,
        redirect: "follow",
      });
      break; // Success, exit loop
    } catch (e) {
      console.log(`try again with different header`);
      lastError = e;
      continue; // Try next header config
    }
  }

  if (!response) {
    throw lastError; // Propagate the last fetch error to sniffApi
  }

  console.log(`/models response for ${baseUrl}:`, response);

  if (response.status === 200) {
    let json;
    try {
      json = await response.json();
    } catch (e) {
      console.error(`Getting /models from ${baseUrl}: 200, but not JSON.`);
      return UNKNOWN_API;
    }

    const models = (json.data ?? []).map((m: any) => m.id);
    const owners = (json.data ?? []).map((m: any) => m.owned_by);
    if (models.some((m: string) => m.startsWith("chutesai/"))) {
      return {
        provider: "chutes",
        supportsLogprobs: "unknown", // yes for some models, not for others?
        supportsPrefill: "unknown",  // same
        prefillStyle: { kind: "trailing" },
      };
    } else if (owners.includes("koboldcpp")) {
      return {
        provider: "kobold-cpp",
        supportsLogprobs: "yes",
        supportsPrefill: "unknown",
        prefillStyle: { kind: "trailing" },
        extraWarning: "Prefill support was merged into KoboldCpp recently, make sure you're on the latest version.", // EVEN ON THE LATEST VERSION IT DOESNT FUCKING WORK THOUGH
      };
    } else if (owners.includes("vllm")) {
      return {
        provider: "vllm",
        supportsLogprobs: "yes",
        supportsPrefill: "yes",
        prefillStyle: {
          kind: "flags",
          flags: { continue_final_message: true, add_generation_prompt: false },
          target: "body",
        },
        extraWarning:
          "Relaunch VLLM with VLLM_USE_V1=0 if you notice tokens like 'Ġhello'. See vllm-project/vllm#16838",
      };
    } else if (models.includes("openrouter/auto")) {
      return {
        provider: "openrouter",
        supportsLogprobs: "unknown",
        supportsPrefill: "unknown",
        prefillStyle: { kind: "trailing" },
      };
    } else if (owners.includes("Hyperbolic")) {
      return {
        provider: "hyperbolic",
        supportsLogprobs: "unknown", // yes for some models, not for others?
        supportsPrefill: "unknown", // same
        prefillStyle: { kind: "trailing" },
      };
    } else if (models.includes("chatgpt-4o-latest")) {
      return {
        provider: "openai",
        supportsLogprobs: "yes",
        supportsPrefill: "no",
        extraWarning: "Long live gpt-3.5-turbo! 🤖"
      };
    } else if (models.includes("deepseek-chat")) {
      return {
        provider: "deepseek",
        supportsLogprobs: "yes",
        supportsPrefill: "yes",
        prefillStyle: { kind: "flags", flags: { prefix: true }, target: "message" },
        needsTemperature: 1.0,
        onlySupportsModels: ["deepseek-chat"],
      };
    }
  } else {
    const error = await response.text();

    if (error.includes("anthropic-version")) {
      return {
        provider: "anthropic",
        supportsLogprobs: "no",
        supportsPrefill: "yes",
        prefillStyle: { kind: "trailing" },
      };
    }
  }

  return UNKNOWN_API;
}
