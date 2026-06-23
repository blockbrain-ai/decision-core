/**
 * Panel Resolver
 *
 * Resolves a TribunalPanel for a given surface binding:
 * 1. Try binding's tribunalConfig.panelId → named panel from config
 * 2. Fall back to defaults from tribunal config
 */

import { createLogger } from '../../utils/logger.js';
import type { TribunalConfig, TribunalPanel, SurfaceBinding } from '../trust.contracts.js';

const logger = createLogger('panel-resolver');

/**
 * Resolve a tribunal panel for the given surface binding.
 * Returns null if no suitable panel can be resolved.
 */
export function resolvePanel(
  binding: SurfaceBinding,
  tribunalConfig: TribunalConfig,
): TribunalPanel | null {
  // Try explicit panelId from binding
  const panelId = binding.tribunalConfig?.panelId;
  if (panelId && tribunalConfig.panels[panelId]) {
    logger.debug({ surfaceId: binding.surfaceId, panelId }, 'Resolved panel by explicit panelId');
    return tribunalConfig.panels[panelId];
  }

  // Try to find a panel by surface ID convention
  const surfaceKey = binding.surfaceId.replace(/\./g, '_');
  if (tribunalConfig.panels[surfaceKey]) {
    logger.debug({ surfaceId: binding.surfaceId, panelId: surfaceKey }, 'Resolved panel by surface key');
    return tribunalConfig.panels[surfaceKey];
  }

  // Fall back to "default" panel if it exists
  if (tribunalConfig.panels['default']) {
    logger.debug({ surfaceId: binding.surfaceId }, 'Resolved default panel');
    return tribunalConfig.panels['default'];
  }

  logger.warn({ surfaceId: binding.surfaceId }, 'No tribunal panel could be resolved');
  return null;
}
