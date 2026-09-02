import { createRoundRobin, RoundRobin, ChatCompletionResponse } from '@genoventures-labs/roundrobin';
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
  model?: string;
  temperature?: number;
  ollamaHost?: string;
  onModelRotated?: (fromModel: string, toModel: string, reason: string) => void;
  onModelExhausted?: (model: string, cooldownMs: number) => void;
  onOllamaFallback?: (models: string[]) => void;
}

export interface GenerateNamesResult {
  scan: ProjectScanResult;
  rawResponse: string;
  suggestions: NameSuggestion[];
  modelUsed?: string;
  providerUsed?: string;
}

export class NameThisEngine {
  private roundRobin: RoundRobin;

  constructor(options?: { apiKey?: string; ollamaHost?: string }) {
    this.roundRobin = createRoundRobin({
      openCodeZenApiKey: options?.apiKey || process.env.OPENCODE_ZEN_API_KEY || process.env.ZEN_API_KEY,
      ollamaHost: options?.ollamaHost || process.env.OLLAMA_HOST
    });
  }

  getRoundRobin(): RoundRobin {
    return this.roundRobin;
  }

  async generateNames(options: GenerateNamesOptions = {}): Promise<GenerateNamesResult> {
    const targetDir = options.cwd || process.cwd();
    const count = options.count && options.count > 0 ? options.count : 3;

    if (options.apiKey) {
      this.roundRobin.setApiKey(options.apiKey);
    }
    if (options.ollamaHost) {
      this.roundRobin.setOllamaHost(options.ollamaHost);
    }

    if (options.onModelRotated) {
      this.roundRobin.on('model-rotated', (fromModel, toModel, reason) => {
        options.onModelRotated?.(fromModel, toModel, reason.message || reason.type);
      });
    }
    if (options.onModelExhausted) {
      this.roundRobin.on('model-exhausted', (model, _reason, cooldownMs) => {
        options.onModelExhausted?.(model, cooldownMs);
      });
    }
    if (options.onOllamaFallback) {
      this.roundRobin.on('ollama-fallback', (models) => {
        options.onOllamaFallback?.(models);
      });
    }

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

    const response: ChatCompletionResponse = await this.roundRobin.chat({
      messages: [
        { role: 'system', content: systemInstructions },
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? 0.7,
      model: options.model
    });

    const choice = response.choices?.[0];
    const text = choice?.message?.content || '';

    const suggestions = this.parseSuggestions(text);

    return {
      scan,
      rawResponse: text,
      suggestions,
      modelUsed: response._roundRobin?.routedModel || response.model,
      providerUsed: response._roundRobin?.provider
    };
  }

  private parseSuggestions(text: string): NameSuggestion[] {
    // Attempt 1: Look for ```json ... ``` blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidateJson = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      const parsed = JSON.parse(candidateJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any) => ({
          name: String(item.name || item.title || '').trim(),
          category: item.category || 'customer-facing',
          rationale: String(item.rationale || item.description || item.reason || '').trim()
        })).filter(item => item.name.length > 0);
      }
    } catch {
      // Fallback: parse markdown formatted headers or list items
    }

    // Attempt 2: Line-by-line fallback parsing
    const suggestions: NameSuggestion[] = [];
    const lines = text.split('\n');
    let currentName = '';
    let currentRationaleLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const nameMatch = trimmed.match(/^(?:(?:\d+[\.\)]|\*|-|#+)\s*)?(?:\*\*)?([A-Za-z0-9_\-\.\s]{2,30}?)(?:\*\*)?(?:\s*[:\-–—]\s*(.*))?$/);

      if (nameMatch && (nameMatch[1].length < 25) && !trimmed.toLowerCase().startsWith('here') && !trimmed.toLowerCase().startsWith('note')) {
        if (currentName) {
          suggestions.push({
            name: currentName,
            rationale: currentRationaleLines.join(' ').trim()
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
        rationale: currentRationaleLines.join(' ').trim()
      });
    }

    if (suggestions.length === 0 && text.trim().length > 0) {
      suggestions.push({
        name: 'Suggested Project Name',
        rationale: text.trim()
      });
    }

    return suggestions;
  }
}

export async function generateNames(options: GenerateNamesOptions = {}): Promise<GenerateNamesResult> {
  const engine = new NameThisEngine({
    apiKey: options.apiKey,
    ollamaHost: options.ollamaHost
  });
  return engine.generateNames(options);
}
