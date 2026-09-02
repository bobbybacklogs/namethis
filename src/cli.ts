#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import path from 'node:path';
import pc from 'picocolors';
import { NameThisEngine } from './engine.js';
import { scanDirectory } from './scanner.js';
import {
  renderHeader,
  renderScanSummary,
  renderProgress,
  renderEvent,
  renderSuggestions,
  renderError
} from './ui.js';

dotenv.config();

const program = new Command();

program
  .name('namethis')
  .description(
    'A lightweight, repo-aware naming tool that infers top 2-3 names with a short rationale from your current directory or specified path.'
  )
  .version('0.1.0', '-v, --version', 'Output current version')
  .argument('[dir]', 'Directory path to analyze', '.')
  .option('-c, --count <number>', 'Number of name suggestions to generate (default: 3)', '3')
  .option('--context <text>', 'Additional context, target audience, or requirements')
  .option('-k, --key <api-key>', 'OpenCode Zen API key (or set OPENCODE_ZEN_API_KEY env)')
  .option('-m, --model <model>', 'Specific model override to use in router')
  .option('-t, --temperature <number>', 'Temperature for generation (default: 0.7)', '0.7')
  .option('--ollama <host>', 'Custom Ollama host endpoint for fallback (default: http://localhost:11434)')
  .option('--json', 'Output results purely in JSON format for scripting/piping')
  .option('--inspect', 'Only inspect and print scanned directory context without making LLM calls')
  .helpOption('-h, --help', 'Display help menu');

program.action(async (dir: string, options: any) => {
  const isJson = Boolean(options.json);
  const targetDir = path.resolve(dir || '.');

  try {
    if (options.inspect) {
      const scan = await scanDirectory(targetDir);
      if (isJson) {
        console.log(JSON.stringify(scan, null, 2));
      } else {
        renderHeader();
        renderScanSummary(scan);
        console.log(`  ${pc.bold('Scanned Files Sample:')}`);
        scan.detectedFiles.slice(0, 20).forEach(f => console.log(`    ${pc.gray('•')} ${f}`));
        if (scan.readmeSnippet) {
          console.log(`\n  ${pc.bold('Readme Excerpt:')}`);
          console.log(`    ${pc.gray(scan.readmeSnippet.replace(/\n/g, '\n    '))}`);
        }
        console.log('\n');
      }
      return;
    }

    if (!isJson) {
      renderHeader();
    }

    const count = parseInt(options.count, 10) || 3;
    const temperature = parseFloat(options.temperature) || 0.7;

    const engine = new NameThisEngine({
      apiKey: options.key,
      ollamaHost: options.ollama
    });

    if (!isJson) {
      const scan = await scanDirectory(targetDir);
      renderScanSummary(scan);
      renderProgress(`Inferring ${count} grounded names with RoundRobin router...`);
    }

    const result = await engine.generateNames({
      cwd: targetDir,
      count,
      context: options.context,
      apiKey: options.key,
      model: options.model,
      temperature,
      ollamaHost: options.ollama,
      onModelRotated: (from, to, reason) => {
        if (!isJson) {
          renderEvent('rotation', `${from} -> ${to} (${reason})`);
        }
      },
      onModelExhausted: (model, cooldown) => {
        if (!isJson) {
          renderEvent('exhausted', `${model} exhausted (cooldown: ${Math.round(cooldown / 1000)}s)`);
        }
      },
      onOllamaFallback: (models) => {
        if (!isJson) {
          renderEvent('ollama', `Switched to Ollama (${models.join(', ') || 'local'})`);
        }
      }
    });

    if (isJson) {
      console.log(
        JSON.stringify(
          {
            directory: result.scan.dirName,
            stack: result.scan.languages,
            model: result.modelUsed,
            provider: result.providerUsed,
            suggestions: result.suggestions
          },
          null,
          2
        )
      );
    } else {
      renderSuggestions(result.suggestions, {
        model: result.modelUsed,
        provider: result.providerUsed
      });
    }
  } catch (err: any) {
    if (isJson) {
      console.error(JSON.stringify({ error: err.message || String(err) }));
    } else {
      renderError(
        err.message || 'An unexpected error occurred',
        'Verify your connection, models, or optionally provide an OPENCODE_ZEN_API_KEY / Ollama instance.'
      );
    }
    process.exit(1);
  }
});

// Extra commands
program
  .command('models')
  .description('List available models and current router status from RoundRobin')
  .action(() => {
    const engine = new NameThisEngine();
    const models = engine.getRoundRobin().getModels();
    renderHeader();
    console.log(`  ${pc.bold('AVAILABLE ROUTER MODELS')}`);
    console.log(`  ${pc.dim('─'.repeat(50))}`);
    for (const m of models) {
      const status = m.isExhausted ? pc.red('[EXHAUSTED]') : pc.green('[ACTIVE]');
      console.log(`  ${status} ${pc.bold(pc.white(m.model.id))} ${pc.dim(`(${m.model.provider})`)}`);
      if (m.model.description) {
        console.log(`       ${pc.gray(m.model.description)}`);
      }
    }
    console.log(`  ${pc.dim('─'.repeat(50))}\n`);
  });

program.parse(process.argv);
