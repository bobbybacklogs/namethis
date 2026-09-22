import {
  ModelHitch,
  type ContentPart,
  type FailoverEvent,
  type ExhaustionInfo,
  type ModelInfo,
  type Provider,
} from 'modelhitch';
import { resolveExplicitApiKey } from './credentials.js';
import { scanCharBudget } from './context-budget.js';
import { buildModelHitchClientOptions } from './modelhitch-client.js';
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
  crawl?: boolean;
  apiKey?: string;
  provider?: string;
  model?: string;
  temperature?: number;
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
  onFailover?: (event: FailoverEvent) => void;
  onExhausted?: (info: ExhaustionInfo) => void;
}

function resolveExplicitProvider(provider?: string): string | undefined {
  const trimmed = provider?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveExplicitModel(model?: string): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? trimmed : undefined;
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
  private hitch?: ModelHitch;
  private explicitApiKey?: string;
  private explicitProvider?: string;
  private explicitModel?: string;
  private routedProvider?: string;
  private routedModel?: string;
  private readonly onFailover?: (event: FailoverEvent) => void;
  private readonly onExhausted?: (info: ExhaustionInfo) => void;

  constructor(options: NameThisEngineOptions = {}) {
    this.explicitApiKey = resolveExplicitApiKey(options.apiKey);
    this.explicitProvider = resolveExplicitProvider(
      options.provider || process.env.NAMETHIS_PROVIDER
    );
    this.explicitModel = resolveExplicitModel(options.model || process.env.NAMETHIS_MODEL);
    this.onFailover = options.onFailover;
    this.onExhausted = options.onExhausted;
  }

  private async ensureHitch(): Promise<ModelHitch> {
    if (this.hitch) return this.hitch;

    const baseOptions = await buildModelHitchClientOptions();
    this.hitch = new ModelHitch({
      ...baseOptions,
      onFailover: (event) => {
        this.routedProvider = event.to.providerId;
        this.routedModel = event.to.model;
        this.onFailover?.(event);
      },
      onExhausted: this.onExhausted,
    });
    return this.hitch;
  }

  async getModelHitch(): Promise<ModelHitch> {
    return this.ensureHitch();
  }

  async listProviders(): Promise<Provider[]> {
    const hitch = await this.ensureHitch();
    return hitch.providers;
  }

  async listModels(providerId?: string): Promise<{ providerId: string; models: ModelInfo[] }[]> {
    const hitch = await this.ensureHitch();
    const ids = providerId ? [providerId] : hitch.providers.map((provider) => provider.id);

    const results: { providerId: string; models: ModelInfo[] }[] = [];
    for (const id of ids) {
      try {
        const explicit = resolveExplicitApiKey(this.explicitApiKey);
        const models = await hitch.listModels(
          id,
          explicit && id === 'vercel-ai-gateway' ? { apiKey: explicit } : undefined
        );
        results.push({ providerId: id, models });
      } catch {
        results.push({ providerId: id, models: [] });
      }
    }
    return results;
  }

  async generateNames(options: GenerateNamesOptions = {}): Promise<GenerateNamesResult> {
    const targetDir = options.cwd || process.cwd();
    const count = options.count && options.count > 0 ? options.count : 3;
    const explicitApiKey = resolveExplicitApiKey(options.apiKey ?? this.explicitApiKey);
    const explicitProvider = resolveExplicitProvider(
      options.provider ?? this.explicitProvider
    );
    const explicitModel = resolveExplicitModel(options.model ?? this.explicitModel);

    if (explicitApiKey) this.explicitApiKey = explicitApiKey;
    if (explicitProvider) this.explicitProvider = explicitProvider;
    if (explicitModel) this.explicitModel = explicitModel;

    this.routedProvider = explicitProvider;
    this.routedModel = explicitModel;

    const hitch = await this.ensureHitch();

    const scan = await scanDirectory(targetDir, { crawl: options.crawl });
    const systemInstructions = getSystemInstructions();
    const scannedContext = formatScanContext(scan, {
      customContext: options.context,
      maxChars: scanCharBudget(explicitProvider || 'vercel-ai-gateway', explicitModel),
    });

    const prompt = `You are namethis, an intelligent repo-aware naming tool.
Carefully review the analyzed workspace metadata, directory structure, readme, and code signatures below.

PROJECT ANALYSIS:
${scannedContext}

TASK:
Infer what this software tool / application / library / product is building.
Generate exactly ${count} strong, grounded name suggestions with a 2-3 line rationale for each.

STRICT GUIDELINES:
Follow the system message naming rules exactly.

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

    const response = await hitch.chat({
      ...(explicitProvider ? { provider: explicitProvider } : {}),
      ...(explicitModel ? { model: explicitModel } : {}),
      ...(explicitApiKey ? { apiKey: explicitApiKey } : {}),
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
      modelUsed: this.routedModel || explicitModel || hitch.defaultModel,
      providerUsed: this.routedProvider || explicitProvider || hitch.defaultProviderId,
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
    onFailover: options.onFailover,
    onExhausted: options.onExhausted,
  });
  return engine.generateNames(options);
}
