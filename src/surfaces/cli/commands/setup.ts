/**
 * setup command — Agent-led onboarding with memory evidence and adaptive interview.
 *
 * Usage: decision-core setup [flags]
 *
 * Flags:
 *   --agent auto|openclaw|hermes|generic|standalone
 *   --memory-source auto|none|gbrain|mempalace|openclaw-native|hermes|markdown-vault|mem0|honcho|zep-graphiti|generic-export
 *   --memory-export <path>     Import a MemoryEvidenceExport JSON file
 *   --profile personal|team|business|enterprise|auto
 *   --provider host|disabled|direct|local|auto
 *   --output <dir>             Output directory (default: .decision-core)
 *   --dry-run                  Generate but do not write artifacts
 *   --interactive              Ask missing interview questions in the terminal
 *   --json                     JSON output mode
 *   --no-write-memory          Skip memory write-back
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, relative } from 'node:path';
import type { CliContext } from '../cli.js';
import { detectAgentEnvironment } from '../../../onboarding/detect-agent-env.js';
import {
  createEmptyProfile,
  DANGEROUS_CAPABILITIES,
} from '../../../contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile, HarnessType, OnboardingProfileMode, ProfileProviderMode } from '../../../contracts/onboarding-profile.contracts.js';
import { importMemoryEvidence } from '../../../onboarding/memory-evidence/memory-evidence-importer.js';
import { inferProfileFromEvidence, applyInferenceToProfile } from '../../../onboarding/memory-evidence/memory-evidence-profile-inference.js';
import { planInterview, applyAnswer, applyModeDefaults, type InterviewQuestion } from '../../../onboarding/interview-engine.js';
import { generateArtifacts, generateRootConfigYaml } from '../../../onboarding/generate-artifacts.js';
import { isBetterSqlite3Available } from '../../../persistence/sqlite/sqlite-availability.js';
import { redactProfileForReport } from '../../../contracts/onboarding-profile.contracts.js';
import { validateGeneratedArtifacts } from '../../../onboarding/validate-generated-artifacts.js';
import { classifyDetectedTools, candidatesToProfileTools } from '../../../onboarding/tool-risk-classifier.js';
import { createReadline, prompt, type ReadlineInterface } from '../readline-helpers.js';
import { createBackup } from '../backup-utils.js';

// ===========================================================================
// Setup Command
// ===========================================================================

export async function setupCommand(ctx: CliContext): Promise<number> {
  const flags = ctx.flags;
  const isJson = !!flags['json'];
  const isDryRun = !!flags['dry-run'];
  const outputDir = resolve(
    typeof flags['output'] === 'string' ? flags['output'] : '.decision-core',
  );

  const log = isJson ? () => {} : ctx.stdout;

  // Step 1: Detect environment
  log('Detecting agent environment...');
  const scanRoot = process.cwd();
  const env = detectAgentEnvironment(scanRoot);

  const harnessOverride = flags['agent'];
  const harness: HarnessType = typeof harnessOverride === 'string' && harnessOverride !== 'auto'
    ? harnessOverride as HarnessType
    : env.harness.harness;

  // Step 2: Create initial profile
  const profileId = `setup-${Date.now()}`;
  const profile = createEmptyProfile(profileId);
  profile.agent = {
    harness,
    harnessVersion: env.harness.version,
    detectedTools: env.tools.map((t) => t.name),
    detectedCapabilities: [],
    configPaths: env.harness.configPaths,
  };
  profile.memory.sources = filterMemorySources(env.memorySources, flags);

  // Step 2b: Promote detected tools to profile tool candidates
  if (env.tools.length > 0 && profile.tools.length === 0) {
    const candidates = classifyDetectedTools(env.tools.map((t) => t.name));
    profile.tools = candidatesToProfileTools(candidates);
    log(`  Classified ${candidates.length} detected tools as policy candidates`);
  }

  // Step 3: Profile mode
  const modeOverride = flags['profile'];
  if (typeof modeOverride === 'string' && modeOverride !== 'auto') {
    profile.mode = modeOverride as OnboardingProfileMode;
  }

  // Step 4: Provider mode
  const providerOverride = flags['provider'];
  if (typeof providerOverride === 'string' && providerOverride !== 'auto') {
    profile.provider.mode = providerOverride as ProfileProviderMode;
  } else if (harness === 'openclaw' || harness === 'hermes') {
    profile.provider.mode = 'host';
  } else if (env.provider.suggestedMode !== 'disabled') {
    profile.provider.mode = env.provider.suggestedMode;
  }

  // Step 5: Import memory evidence if provided
  let updatedProfile: OnboardingProfile = profile;
  const exportPath = flags['memory-export'];
  if (typeof exportPath === 'string') {
    log(`Importing memory evidence from ${exportPath}...`);
    try {
      const raw = readFileSync(exportPath, 'utf-8');
      const data = JSON.parse(raw);
      const importResult = importMemoryEvidence(data);

      if (importResult.success && importResult.export) {
        const inference = inferProfileFromEvidence([importResult.export]);
        updatedProfile = applyInferenceToProfile(updatedProfile, inference);
        updatedProfile.memory.evidenceImported = true;
        updatedProfile.evidence.push({
          source: 'memory',
          sourceId: importResult.sourceId,
          confidence: inference.confidenceAvg,
          sensitive: false,
          collectedAt: new Date().toISOString(),
          summary: `Imported ${importResult.itemCount} items from ${importResult.sourceKind}`,
        });
        log(`  Imported ${importResult.itemCount} evidence items (${importResult.redactedCount} redacted)`);
      } else {
        const errors = importResult.errors.join(', ');
        log(`  Warning: Evidence import failed: ${errors}`);
      }
    } catch (err) {
      log(`  Warning: Could not read evidence file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 6: Apply mode defaults
  updatedProfile = applyModeDefaults(updatedProfile);

  // Step 7: Plan interview (report what would be asked)
  let plan = planInterview(updatedProfile);
  log(`Interview plan: ${plan.questions.length} questions needed (${plan.skippedCount} skipped)`);
  log(`  ${plan.reason}`);

  if (flags['interactive']) {
    const rl = createReadline();
    try {
      for (const question of plan.questions) {
        const value = await askSetupQuestion(rl, question);
        updatedProfile = applyAnswer(updatedProfile, { questionId: question.id, value });
      }
      // Executive decisions (B2): make the dangerous-power calls explicitly now —
      // if they aren't decided at setup, they never will be. Safe defaults shown.
      log('');
      log('Executive decisions — the dangerous powers. For each, type allow / ask / block (Enter = keep default):');
      const decisions = { ...updatedProfile.autonomy.executiveDecisions };
      for (const cap of DANGEROUS_CAPABILITIES) {
        const current = decisions[cap];
        const ans = (await prompt(rl, `  ${cap.replace(/_/g, ' ')} [${current}]: `)).trim().toLowerCase();
        if (ans === 'allow' || ans === 'ask' || ans === 'block') decisions[cap] = ans;
      }
      updatedProfile = { ...updatedProfile, autonomy: { ...updatedProfile.autonomy, executiveDecisions: decisions } };
      updatedProfile = applyModeDefaults(updatedProfile);
      plan = planInterview(updatedProfile);
    } finally {
      rl.close();
    }
  }

  // Step 8: Generate artifacts
  log('Generating artifacts...');
  const result = generateArtifacts(updatedProfile);

  if (result.artifacts.length === 0) {
    ctx.stderr('Error: No artifacts generated');
    for (const w of result.warnings) ctx.stderr(`  ${w}`);
    return 1;
  }

  for (const w of result.warnings) log(`  Warning: ${w}`);

  const validation = validateGeneratedArtifacts(result.artifacts);
  if (!validation.valid) {
    ctx.stderr('Error: Generated artifacts failed validation/lint gates');
    for (const issue of validation.issues) ctx.stderr(`  ${issue.path}: ${issue.message}`);
    return 1;
  }

  // Step 9: Output
  if (isDryRun) {
    log(`Dry run — ${result.artifacts.length} artifacts would be written to ${outputDir}/`);

    if (isJson) {
      const output = {
        profileId: updatedProfile.profileId,
        mode: updatedProfile.mode,
        harness: updatedProfile.agent.harness,
        provider: updatedProfile.provider.mode,
        artifactCount: result.artifacts.length,
        artifacts: result.artifacts.map((a) => ({ path: a.path, category: a.category })),
        interviewPlan: {
          questionsNeeded: plan.questions.length,
          skipped: plan.skippedCount,
          reason: plan.reason,
        },
        detection: {
          harness: env.harness.harness,
          confidence: env.harness.confidence,
          memorySources: updatedProfile.memory.sources.filter((s) => s.detected).map((s) => s.kind),
          providerEnvVars: env.provider.envVarNames,
        },
        warnings: result.warnings,
        profileHash: result.profileHash,
        profile: redactProfileForReport(updatedProfile),
      };
      ctx.stdout(JSON.stringify(output, null, 2));
    } else {
      for (const a of result.artifacts) {
        log(`  ${a.category.padEnd(10)} ${a.path}`);
      }
    }
    return 0;
  }

  // Step 10: Back up existing runtime files before writing artifacts
  const rootConfigPath = resolve(process.cwd(), 'decision-core.yaml');
  const forceConfig = !!flags['force-config'];
  const existingPolicyPackPath = join(outputDir, 'policy-pack.yaml');
  const backupFiles = [existingPolicyPackPath, rootConfigPath].filter((p) => existsSync(p));
  if (backupFiles.length > 0) {
    const backupDir = resolve(process.cwd(), '.decision-core');
    const backup = createBackup(backupFiles, forceConfig ? 'setup --force-config' : 'setup', backupDir);
    if (backup.files.length > 0) {
      log(`Backed up existing Decision Core files (${backup.files.length})`);
    }
  }

  // Step 11: Write artifacts
  for (const artifact of result.artifacts) {
    if (!isSafeArtifactPath(artifact.path)) {
      ctx.stderr(`Unsafe generated artifact path: ${artifact.path}`);
      return 1;
    }
    const fullPath = join(outputDir, artifact.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, artifact.content, 'utf-8');
  }

  log(`Wrote ${result.artifacts.length} artifacts to ${outputDir}/`);

  // Step 11b: Write root decision-core.yaml if missing
  const observing = updatedProfile.autonomy.enforcementMode === 'observe';
  let observationsPersisted = false;
  if (!existsSync(rootConfigPath) || forceConfig) {
    const packPath = join(outputDir, 'policy-pack.yaml');
    const relativePackPath = relative(process.cwd(), packPath);
    const policyPackConfigPath = relativePackPath.startsWith('..') ? packPath : relativePackPath;

    // Observe mode persists the decision log so the shadowed denials survive
    // restarts and are reviewable. Gate on SQLite availability; fall back to
    // memory + a warning rather than silently losing observations.
    let observationStorePath: string | undefined;
    if (observing) {
      if (isBetterSqlite3Available()) {
        observationStorePath = join(outputDir, 'decisions.db');
        mkdirSync(resolve(process.cwd(), outputDir), { recursive: true });
        ensureGitignored(`${outputDir}/decisions.db`, log);
        observationsPersisted = true;
      } else {
        log('Note: better-sqlite3 is unavailable — observe-mode observations will NOT persist across restarts.');
        log('  Install better-sqlite3 to review them later with `decision-core observations`.');
      }
    }
    const rootConfig = generateRootConfigYaml(updatedProfile, policyPackConfigPath, { observationStorePath });
    writeFileSync(rootConfigPath, rootConfig, 'utf-8');
    log(`Wrote root config to decision-core.yaml`);
  } else {
    log(`Root config decision-core.yaml already exists — skipping (use --force-config to overwrite)`);
  }

  // B3: "here's everything I found" — tool inventory + the owned executive decisions.
  if (!isJson) {
    log('');
    log(`Tools: ${updatedProfile.agent.detectedTools.length} detected, ${updatedProfile.tools.length} tiered.`);
    log('Executive decisions (your call):');
    for (const [cap, dec] of Object.entries(updatedProfile.autonomy.executiveDecisions)) {
      log(`  ${cap.replace(/_/g, ' ')}: ${dec.toUpperCase()}`);
    }
  }

  // Step 12: Activation — announce the mode explicitly (observe is non-blocking).
  updatedProfile.activatedAt = new Date().toISOString();
  if (observing) {
    log('Setup complete — OBSERVE MODE is ON: Decision Core is watching, not blocking.');
    log('  Review what it would have blocked:  decision-core observations');
    log('  Flip to real enforcement:           decision-core enforce');
  } else {
    log('Setup complete — ENFORCE MODE is ON: policies are active. Run `decision-core doctor` to verify.');
  }

  if (isJson) {
    ctx.stdout(JSON.stringify({
      profileId: updatedProfile.profileId,
      mode: updatedProfile.mode,
      outputDir,
      artifactCount: result.artifacts.length,
      activated: !!updatedProfile.activatedAt,
      enforcementMode: updatedProfile.autonomy.enforcementMode,
      observationsPersisted,
      executiveDecisions: updatedProfile.autonomy.executiveDecisions,
      toolsDetected: updatedProfile.agent.detectedTools.length,
      toolsTiered: updatedProfile.tools.length,
      nextAction: observing ? 'review_observations_then_enforce' : 'verify_with_doctor',
      profileHash: result.profileHash,
      warnings: result.warnings,
    }, null, 2));
  }

  return 0;
}

/** Append a pattern to ./.gitignore if not already present (so local decision logs aren't committed). */
function ensureGitignored(pattern: string, log: (m: string) => void): void {
  const gitignorePath = resolve(process.cwd(), '.gitignore');
  let existing = '';
  if (existsSync(gitignorePath)) existing = readFileSync(gitignorePath, 'utf-8');
  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes(pattern)) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, `${existing}${prefix}# Decision Core local decision log (observe-mode observations)\n${pattern}\n`, 'utf-8');
  log(`Added ${pattern} to .gitignore`);
}

async function askSetupQuestion(rl: ReadlineInterface, q: InterviewQuestion): Promise<string | string[] | boolean> {
  switch (q.type) {
    case 'select': {
      const opts = q.options ?? [];
      const optList = opts.map((o, i) => `    ${i + 1}. ${o}`).join('\n');
      const defaultHint = q.defaultValue ? ` [${q.defaultValue}]` : '';
      const answer = await prompt(rl, `  ${q.prompt}${defaultHint}\n${optList}\n  > `);
      if (!answer && q.defaultValue) return q.defaultValue;
      const idx = parseInt(answer, 10);
      if (idx >= 1 && idx <= opts.length) return opts[idx - 1]!;
      if (opts.includes(answer)) return answer;
      return q.defaultValue ?? opts[0] ?? answer;
    }
    case 'multi_select': {
      const opts = q.options ?? [];
      const optList = opts.map((o, i) => `    ${i + 1}. ${o}`).join('\n');
      const answer = await prompt(rl, `  ${q.prompt} (comma-separated)\n${optList}\n  > `);
      return answer.split(',').map((part) => {
        const trimmed = part.trim();
        const idx = parseInt(trimmed, 10);
        if (idx >= 1 && idx <= opts.length) return opts[idx - 1]!;
        return trimmed;
      }).filter(Boolean);
    }
    case 'confirm': {
      const defaultYes = q.defaultValue === 'yes' || q.defaultValue === 'true';
      const answer = await prompt(rl, `  ${q.prompt}${defaultYes ? ' [Y/n]' : ' [y/N]'}\n  > `);
      if (!answer) return defaultYes;
      return answer.toLowerCase().startsWith('y');
    }
    case 'text':
    default: {
      const defaultHint = q.defaultValue ? ` [${q.defaultValue}]` : '';
      const answer = await prompt(rl, `  ${q.prompt}${defaultHint}\n  > `);
      return answer || q.defaultValue || '';
    }
  }
}

function isSafeArtifactPath(path: string): boolean {
  if (isAbsolute(path)) return false;
  const normalized = normalize(path);
  if (!normalized || normalized === '.') return false;
  return !normalized.split(/[\\/]+/).includes('..');
}

function filterMemorySources(
  sources: OnboardingProfile['memory']['sources'],
  flags: CliContext['flags'],
): OnboardingProfile['memory']['sources'] {
  const memorySource = flags['memory-source'];
  const useGbrain = flags['use-gbrain'];

  if (memorySource === 'none' || useGbrain === 'no') return [];

  if (memorySource && typeof memorySource === 'string' && memorySource !== 'auto') {
    if (memorySource === 'hermes') {
      return sources.filter((s) => s.kind === 'hermes-built-in' || s.kind === 'hermes-active-provider');
    }
    if (memorySource === 'generic-export') {
      return sources.filter((s) => s.kind === 'generic-mcp');
    }
    return sources.filter((s) => s.kind === memorySource);
  }

  if (useGbrain === 'yes' || useGbrain === 'read-only') {
    return sources.filter((s) => s.kind === 'gbrain' || s.kind === 'mempalace');
  }

  return sources;
}
