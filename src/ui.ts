import pc from 'picocolors';
import { ProjectScanResult } from './scanner.js';
import { NameSuggestion } from './engine.js';

export function renderHeader(): void {
  const brand = pc.bold(pc.cyan('namethis'));
  const tag = pc.dim('v0.1.0');
  const subtitle = pc.gray('Repo-aware intelligent naming CLI');
  console.log(`\n  ${brand} ${tag} ${pc.dim('—')} ${subtitle}\n`);
}

export function renderScanSummary(scan: ProjectScanResult): void {
  const parts: string[] = [];
  parts.push(`${pc.bold('Directory:')} ${pc.white(scan.dirName)}`);
  
  if (scan.languages.length > 0) {
    parts.push(`${pc.bold('Stack:')} ${pc.magenta(scan.languages.join(', '))}`);
  }

  if (scan.packageJson?.name) {
    parts.push(`${pc.bold('Current pkg:')} ${pc.yellow(scan.packageJson.name)}`);
  }

  console.log(`  ${pc.dim('│')} ${parts.join(pc.dim('  •  '))}`);
  console.log(`  ${pc.dim('│')} ${pc.dim(`Scanned ${scan.detectedFiles.length} file signatures and context markers`)}`);
  console.log(`  ${pc.dim('│')}`);
}

export function renderProgress(message: string): void {
  console.log(`  ${pc.cyan('●')} ${pc.white(message)}`);
}

export function renderEvent(type: 'rotation' | 'exhausted' | 'ollama', detail: string): void {
  if (type === 'rotation') {
    console.log(`  ${pc.yellow('↷')} ${pc.dim('Router:')} ${pc.yellow(detail)}`);
  } else if (type === 'exhausted') {
    console.log(`  ${pc.red('■')} ${pc.dim('Rate limit:')} ${pc.red(detail)}`);
  } else if (type === 'ollama') {
    console.log(`  ${pc.magenta('⎈')} ${pc.dim('Fallback:')} ${pc.magenta(detail)}`);
  }
}

export function renderSuggestions(suggestions: NameSuggestion[], modelInfo?: { model?: string; provider?: string }): void {
  console.log(`\n  ${pc.bold(pc.green('NAME CANDIDATES'))}`);
  console.log(`  ${pc.dim('─'.repeat(50))}\n`);

  suggestions.forEach((s, idx) => {
    const num = pc.bold(pc.cyan(`[0${idx + 1}]`));
    const name = pc.bold(pc.white(s.name));
    const cat = s.category ? pc.dim(`(${s.category})`) : '';

    console.log(`  ${num} ${name} ${cat}`);
    
    // Format rationale lines cleanly with indentation
    const lines = s.rationale
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      console.log(`       ${pc.gray(line)}`);
    }
    console.log('');
  });

  console.log(`  ${pc.dim('─'.repeat(50))}`);
  if (modelInfo?.model) {
    const provider = modelInfo.provider ? `via ${modelInfo.provider}` : '';
    console.log(`  ${pc.dim(`Routed with ${modelInfo.model} ${provider}`.trim())}\n`);
  }
}

export function renderError(message: string, hint?: string): void {
  console.log(`\n  ${pc.red(pc.bold('ERROR'))}: ${pc.white(message)}`);
  if (hint) {
    console.log(`  ${pc.dim('Hint:')} ${pc.gray(hint)}`);
  }
  console.log('');
}
