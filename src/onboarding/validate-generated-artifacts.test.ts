import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../contracts/onboarding-profile.contracts.js';
import { generateArtifacts } from './generate-artifacts.js';
import { validateGeneratedArtifacts } from './validate-generated-artifacts.js';

describe('validateGeneratedArtifacts', () => {
  it('accepts generated setup artifacts that parse and lint cleanly', () => {
    const profile = createEmptyProfile('validation-valid');
    profile.mode = 'business';
    profile.agent.harness = 'openclaw';
    profile.tools = [
      {
        name: 'send_email',
        riskTier: 2,
        canSpendMoney: false,
        canDeleteData: false,
        canContactPeople: true,
        canPublishContent: false,
        canDeployCode: false,
        accessesSensitiveData: false,
        defaultAction: 'ask',
      },
    ];

    const result = validateGeneratedArtifacts(generateArtifacts(profile).artifacts);

    expect(result.valid).toBe(true);
    expect(result.policyCount).toBeGreaterThan(0);
    expect(result.scenarioCount).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
  });

  it('rejects generated policy artifacts that do not match the structured policy schema', () => {
    const profile = createEmptyProfile('validation-invalid-policy');
    const generated = generateArtifacts(profile);
    const artifacts = generated.artifacts.map((artifact) => artifact.path === 'policies/000-baseline.md'
      ? { ...artifact, content: artifact.content.replace('clause_type: routing_constraint', 'clause_type: unsupported') }
      : artifact);

    const result = validateGeneratedArtifacts(artifacts);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'policies/000-baseline.md')).toBe(true);
  });

  it('rejects malformed generated scenario artifacts', () => {
    const profile = createEmptyProfile('validation-invalid-scenarios');
    const generated = generateArtifacts(profile);
    const artifacts = generated.artifacts.map((artifact) => artifact.path === 'tests/generated-scenarios.json'
      ? { ...artifact, content: '{"not":"an array"}' }
      : artifact);

    const result = validateGeneratedArtifacts(artifacts);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: 'tests/generated-scenarios.json',
      message: 'Generated scenarios must be a JSON array',
    });
  });
});
