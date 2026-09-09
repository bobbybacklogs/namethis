import {
  ModelHitch,
  createOllamaProvider,
  defaultProviders,
  DEFAULT_FAILOVER_LANES,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL,
  readVercelCliAuthToken,
  type ContentPart,
  type FailoverEvent,
  type ExhaustionInfo,
  type ModelInfo,
  type Provider,
} from 'modelhitch';
import { scanDirectory, formatScanContext, ProjectScanResult } from './scanner.js';
import { getSystemInstructions } from './instructions.js';

export interface NameSuggestion {
  name: string;
  category?: 'customer-facing' | 'working-title' | 'functional';
  rationale: string;
}

export interface GenerateNamesOptions {
  cwd?: string;
  count?: number;
  context?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  ollamaHost?: string;
  ollamaModel?: string;
  onFailover?: (event: FailoverEvent) => void;
  onExhausted?: (info: ExhaustionInfo) => void;
}

export interface GenerateNamesResult {
  scan: ProjectScanResult;
  rawResponse: string;
  suggestions: NameSuggestion[];
  modelUsed?: string;
  providerUsed?: string;
}

export interface NameThisEngineOptions {
  apiKey?: string;
  provider?: string;
  model?: string;
  ollamaHost?: string;
  ollamaModel?: string;
  onFailover?: (event: FailoverEvent) => void;
  onExhausted?: (info: ExhaustionInfo) => void;
}

function resolveOllamaHost(host?: string): string {
  return (host || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
}

function hasCloudCredentials(apiKey?: string): boolean {
  return Boolean(
    apiKey?.trim() ||
      process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim() ||
      process.env.VERCEL_TOKEN?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      readVercelCliAuthToken()
  );
}

function pickOllamaModel(available: string[], preferred?: string): string | undefined {
  if (available.length === 0) return preferred;

  if (preferred) {
    if (available.includes(preferred)) return preferred;
    const tagged = available.find(
      (name) => name === preferred || name.startsWith(`${preferred}:`)
    );
    if (tagged) return tagged;
  }

  return (
    available.find((name) => name === 'llama3.2' || name.startsWith('llama3.2:')) ||
    available.find((name) => name.startsWith('llama3')) ||
    available.find((name) => name.startsWith('llama')) ||
    available.find((name) => name.startsWith('qwen')) ||
    available[0]
  );
}

async function discoverOllamaModels(host: string): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/tags`);
    if (!response.ok) return [];
    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    return (payload.models ?? [])
      .map((model) => model.name?.trim())
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

function buildProviders(ollamaHost: string): Provider[] {
  return [
    ...defaultProviders.filter((provider) => provider.id !== 'ollama'),
    createOllamaProvider({ baseUrl: ollamaHost }),
  ];
}

function extractMessageText(content: string | ContentPart[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      return '';
    })
    .join('');
}

export class NameThisEngine {
  private hitch: ModelHitch;
  private activeProvider: string;
  private activeModel: string;
  private apiKey?: string;
  private ollamaHost: string;
  private ollamaModel: string;
  private preferredProvider?: string;
  private preferredModel?: string;

  constructor(options: NameThisEngineOptions = {}) {
    this.apiKey = options.apiKey;
    this.ollamaHost = resolveOllamaHost(options.ollamaHost);
    this.ollamaModel = options.ollamaModel || process.env.NAMETHIS_OLLAMA_MODEL || 'llama3.2';
    this.preferredProvider = options.provider || process.env.NAMETHIS_PROVIDER;
    this.preferredModel = options.model || process.env.NAMETHIS_MODEL;
    this.activeProvider = this.preferredProvider || 'vercel-ai-gateway';
    this.activeModel =
      this.preferredModel ||
      (this.activeProvider === 'ollama' ? this.ollamaModel : VERCEL_AI_GATEWAY_DEFAULT_MODEL);

    this.hitch = this.createHitch({
      onFailover: options.onFailover,
      onExhausted: options.onExhausted,
    });
  }

  private createHitch(hooks?: {
    onFailover?: (event: FailoverEvent) => void;
    onExhausted?: (info: ExhaustionInfo) => void;
  }): ModelHitch {
    return new ModelHitch({
      providers: buildProviders(this.ollamaHost),
      defaultProviderId: this.activeProvider,
      defaultModel: this.activeModel,
      autoMode: {
        lanes: [
          ...DEFAULT_FAILOVER_LANES,
          { providerId: 'ollama', model: this.ollamaModel },
        ],
      },
      onFailover: (event) => {
        this.activeProvider = event.to.providerId;
        this.activeModel = event.to.model;
        hooks?.onFailover?.(event);
      },
      onExhausted: hooks?.onExhausted,
    });
  }

  getModelHitch(): ModelHitch {
    return this.hitch;
  }

  listProviders(): Provider[] {
    return this.hitch.providers;
  }

  async listModels(providerId?: string): Promise<{ providerId: string; models: ModelInfo[] }[]> {
    const ids = providerId ? [providerId] : ['vercel-ai-gateway', 'ollama'];

    const results: { providerId: string; models: ModelInfo[] }[] = [];
    for (const id of ids) {
      try {
        const models = await this.hitch.listModels(id, this.credentialsFor(id));
        results.push({ providerId: id, models });
      } catch {
        results.push({ providerId: id, models: [] });
      }
    }
    return results;
  }

  private credentialsFor(providerId: string): { apiKey?: string } | undefined {
    if (!this.apiKey) return undefined;
    if (providerId === 'vercel-ai-gateway' || providerId === this.activeProvider) {
      return { apiKey: this.apiKey };
    }
    return undefined;
  }

  private async resolveRouting(options: GenerateNamesOptions): Promise<void> {
    if (options.apiKey) this.apiKey = options.apiKey;
    if (options.ollamaHost) this.ollamaHost = resolveOllamaHost(options.ollamaHost);
    if (options.provider) this.preferredProvider = options.provider;
    if (options.model) this.preferredModel = options.model;

    const preferredOllama =
      options.ollamaModel || process.env.NAMETHIS_OLLAMA_MODEL || this.ollamaModel || 'llama3.2';
    const available = await discoverOllamaModels(this.ollamaHost);
    this.ollamaModel = pickOllamaModel(available, preferredOllama) || preferredOllama;

    if (this.preferredProvider) {
      this.activeProvider = this.preferredProvider;
      this.activeModel =
        this.preferredModel ||
        (this.activeProvider === 'ollama' ? this.ollamaModel : VERCEL_AI_GATEWAY_DEFAULT_MODEL);
      return;
    }

    if (!hasCloudCredentials(this.apiKey) && available.length > 0) {
      this.activeProvider = 'ollama';
      this.activeModel = this.ollamaModel;
      return;
    }

    this.activeProvider = 'vercel-ai-gateway';
    this.activeModel = this.preferredModel || VERCEL_AI_GATEWAY_DEFAULT_MODEL;
  }

  async generateNames(options: GenerateNamesOptions = {}): Promise<GenerateNamesResult> {
    const targetDir = options.cwd || process.cwd();
    const count = options.count && options.count > 0 ? options.count : 3;

    await this.resolveRouting(options);

    this.hitch = this.createHitch({
      onFailover: options.onFailover,
      onExhausted: options.onExhausted,
    });

    const scan = await scanDirectory(targetDir);
    const scannedContext = formatScanContext(scan, options.context);
    const systemInstructions = getSystemInstructions();

    const prompt = `You are namethis, an intelligent repo-aware naming tool.
Carefully review the analyzed workspace metadata, directory structure, readme, and code signatures below.

PROJECT ANALYSIS:
${scannedContext}

TASK:
Infer what this software tool / application / library / product is building.
Generate exactly ${count} strong, grounded name suggestions with a 2-3 line rationale for each.

STRICT GUIDELINES:
${systemInstructions}

FORMAT YOUR RESPONSE EXACTLY AS FOLLOWS (valid JSON array of objects):
\`\`\`json
[
  {
    "name": "NameOne",
    "category": "customer-facing",
    "rationale": "2-3 concise lines explaining the grounding, user benefit, or metaphor and why it fits this codebase."
  },
  {
    "name": "NameTwo",
    "category": "working-title",
    "rationale": "2-3 concise lines explaining why it serves well as a punchy working title or dev tool name."
  },
  {
    "name": "NameThree",
    "category": "functional",
    "rationale": "2-3 concise lines explaining the direct functional association."
  }
]
\`\`\`

Respond ONLY with the JSON code block.`;

    const providerUsed = this.activeProvider;
    const modelUsed = this.activeModel;

    const response = await this.hitch.chat({
      provider: providerUsed,
      model: modelUsed,
      apiKey: this.apiKey,
      temperature: options.temperature ?? 0.7,
      messages: [
        { role: 'system', content: systemInstructions },
        { role: 'user', content: prompt },
      ],
    });

    const text = extractMessageText(response.message.content);
    const suggestions = this.parseSuggestions(text);

    return {
      scan,
      rawResponse: text,
      suggestions,
      modelUsed: this.activeModel,
      providerUsed: this.activeProvider,
    };
  }

  private parseSuggestions(text: string): NameSuggestion[] {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidateJson = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      const parsed = JSON.parse(candidateJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((item: Record<string, unknown>) => ({
            name: String(item.name || item.title || '').trim(),
            category: (item.category as NameSuggestion['category']) || 'customer-facing',
            rationale: String(item.rationale || item.description || item.reason || '').trim(),
          }))
          .filter((item) => item.name.length > 0);
      }
    } catch {
      // Fallback: parse markdown formatted headers or list items
    }

    const suggestions: NameSuggestion[] = [];
    const lines = text.split('\n');
    let currentName = '';
    let currentRationaleLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const nameMatch = trimmed.match(
        /^(?:(?:\d+[\.\)]|\*|-|#+)\s*)?(?:\*\*)?([A-Za-z0-9_\-\.\s]{2,30}?)(?:\*\*)?(?:\s*[:\-–—]\s*(.*))?$/
      );

      if (
        nameMatch &&
        nameMatch[1].length < 25 &&
        !trimmed.toLowerCase().startsWith('here') &&
        !trimmed.toLowerCase().startsWith('note')
      ) {
        if (currentName) {
          suggestions.push({
            name: currentName,
            rationale: currentRationaleLines.join(' ').trim(),
          });
          currentRationaleLines = [];
        }
        currentName = nameMatch[1].replace(/[`*]/g, '').trim();
        if (nameMatch[2]) {
          currentRationaleLines.push(nameMatch[2].trim());
        }
      } else if (currentName && trimmed.length > 0) {
        currentRationaleLines.push(trimmed);
      }
    }

    if (currentName) {
      suggestions.push({
        name: currentName,
        rationale: currentRationaleLines.join(' ').trim(),
      });
    }

    if (suggestions.length === 0 && text.trim().length > 0) {
      suggestions.push({
        name: 'Suggested Project Name',
        rationale: text.trim(),
      });
    }

    return suggestions;
  }
}

export async function generateNames(options: GenerateNamesOptions = {}): Promise<GenerateNamesResult> {
  const engine = new NameThisEngine({
    apiKey: options.apiKey,
    provider: options.provider,
    model: options.model,
    ollamaHost: options.ollamaHost,
    ollamaModel: options.ollamaModel,
    onFailover: options.onFailover,
    onExhausted: options.onExhausted,
  });
  return engine.generateNames(options);
}
