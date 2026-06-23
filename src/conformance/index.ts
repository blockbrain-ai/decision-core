/**
 * Conformance Module — Public Exports
 */

export { loadConformanceFile, loadSuiteScenarios, filterByTags } from './scenario-loader.js';
export type { ConformanceScenario, ConformanceStep, LoadedScenarioFile } from './scenario-loader.js';

export { runConformance } from './runner.js';
export type { ConformanceRunResult, ScenarioResult, StepResult } from './runner.js';

export { startConformanceServer, getAgentToken } from './server-harness.js';
export type { ConformanceServerInstance } from './server-harness.js';

export { generateBaseline, saveBaseline, loadBaseline, compareBaseline } from './baseline.js';
export type { BaselineFile, BaselineEntry, BaselineComparison } from './baseline.js';

export {
  formatRunMarkdown,
  formatRunJson,
  formatBaselineMarkdown,
  formatBaselineJson,
} from './formatters.js';
