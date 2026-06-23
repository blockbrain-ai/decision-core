import { describe, it, expect } from 'vitest';
import { classifyDetectedTools, candidatesToProfileTools } from './tool-risk-classifier.js';

describe('classifyDetectedTools', () => {
  it('classifies read tools as low risk', () => {
    const result = classifyDetectedTools(['read_file', 'list_users', 'get_status']);
    expect(result).toHaveLength(3);
    for (const c of result) {
      expect(c.riskTier).toBe(1);
      expect(c.defaultAction).toBe('allow');
    }
  });

  it('classifies write tools as medium risk', () => {
    const result = classifyDetectedTools(['write_file', 'create_user', 'update_record']);
    for (const c of result) {
      expect(c.riskTier).toBe(2);
      expect(c.defaultAction).toBe('ask');
    }
  });

  it('classifies dangerous tools as high risk', () => {
    const result = classifyDetectedTools(['delete_database', 'deploy_production', 'payment_process']);
    for (const c of result) {
      expect(c.riskTier).toBe(4);
      expect(c.defaultAction).toBe('block');
    }
  });

  it('classifies unknown tools as medium-high risk', () => {
    const result = classifyDetectedTools(['custom_mcp_tool']);
    expect(result[0].riskTier).toBe(3);
    expect(result[0].defaultAction).toBe('ask');
    expect(result[0].matchedPattern).toBe('unknown');
  });

  it('marks all candidates as detection candidates', () => {
    const result = classifyDetectedTools(['read_file', 'deploy_prod']);
    for (const c of result) {
      expect(c.isDetectionCandidate).toBe(true);
    }
  });
});

describe('candidatesToProfileTools', () => {
  it('converts candidates to ProfileTool format', () => {
    const candidates = classifyDetectedTools(['read_file', 'delete_user', 'send_email']);
    const tools = candidatesToProfileTools(candidates);
    expect(tools).toHaveLength(3);

    const readTool = tools.find(t => t.name === 'read_file')!;
    expect(readTool.riskTier).toBe(1);
    expect(readTool.canDeleteData).toBe(false);
    expect(readTool.canContactPeople).toBe(false);

    const deleteTool = tools.find(t => t.name === 'delete_user')!;
    expect(deleteTool.riskTier).toBe(4);
    expect(deleteTool.canDeleteData).toBe(true);

    const sendTool = tools.find(t => t.name === 'send_email')!;
    expect(sendTool.riskTier).toBe(2);
    expect(sendTool.canContactPeople).toBe(true);
  });
});
