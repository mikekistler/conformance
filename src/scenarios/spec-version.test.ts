import { describe, it, expect } from 'vitest';
import {
  listScenarios,
  listClientScenarios,
  listScenariosForSpec,
  listDraftScenarios,
  getScenarioSpecVersions,
  ALL_SPEC_VERSIONS
} from './index';
import {
  DATED_SPEC_VERSIONS,
  DRAFT_PROTOCOL_VERSION,
  LATEST_SPEC_VERSION,
  specVersionToProtocolVersion
} from '../types';

describe('specVersions helpers', () => {
  it('every Scenario has specVersions', () => {
    for (const name of listScenarios()) {
      const versions = getScenarioSpecVersions(name);
      expect(
        versions,
        `scenario "${name}" is missing specVersions`
      ).toBeDefined();
      expect(versions!.length).toBeGreaterThan(0);
      for (const v of versions!) {
        expect(ALL_SPEC_VERSIONS).toContain(v);
      }
    }
  });

  it('every ClientScenario has specVersions', () => {
    for (const name of listClientScenarios()) {
      const versions = getScenarioSpecVersions(name);
      expect(
        versions,
        `client scenario "${name}" is missing specVersions`
      ).toBeDefined();
      expect(versions!.length).toBeGreaterThan(0);
      for (const v of versions!) {
        expect(ALL_SPEC_VERSIONS).toContain(v);
      }
    }
  });

  it('listScenariosForSpec returns scenarios that include that version', () => {
    const scenarios = listScenariosForSpec('2025-06-18');
    expect(scenarios.length).toBeGreaterThan(0);
    for (const name of scenarios) {
      expect(getScenarioSpecVersions(name)).toContain('2025-06-18');
    }
  });

  it('2025-11-25 includes scenarios carried forward from 2025-06-18', () => {
    const base = listScenariosForSpec('2025-06-18');
    const current = listScenariosForSpec('2025-11-25');
    // scenarios tagged with both versions should appear in both lists
    const currentSet = new Set(current);
    // at least some overlap (carried-forward scenarios)
    const overlap = base.filter((s) => currentSet.has(s));
    expect(overlap.length).toBeGreaterThan(0);
    // current should have more total (new 2025-11-25-only scenarios)
    expect(current.length).toBeGreaterThan(overlap.length);
  });

  it('2025-11-25 does not include 2025-03-26-only scenarios', () => {
    const backcompat = listScenariosForSpec('2025-03-26');
    const current = listScenariosForSpec('2025-11-25');
    const currentSet = new Set(current);
    // backcompat-only scenarios should not appear in 2025-11-25
    for (const name of backcompat) {
      const versions = getScenarioSpecVersions(name)!;
      if (!versions.includes('2025-11-25')) {
        expect(currentSet.has(name)).toBe(false);
      }
    }
  });

  it('--spec-version draft is a superset of the latest dated release', () => {
    const latest = new Set(listScenariosForSpec(LATEST_SPEC_VERSION));
    const draft = new Set(listScenariosForSpec('draft'));
    for (const name of latest) {
      expect(draft.has(name)).toBe(true);
    }
    for (const name of listDraftScenarios()) {
      expect(draft.has(name)).toBe(true);
    }
  });

  it('draft-tagged scenarios are not also tagged with a dated version', () => {
    for (const name of listDraftScenarios()) {
      const versions = getScenarioSpecVersions(name)!;
      for (const dated of DATED_SPEC_VERSIONS) {
        expect(
          versions,
          `scenario "${name}" is tagged with both 'draft' and '${dated}'`
        ).not.toContain(dated);
      }
    }
  });

  it('specVersionToProtocolVersion maps tags to wire versions', () => {
    expect(specVersionToProtocolVersion('draft')).toBe(DRAFT_PROTOCOL_VERSION);
    expect(specVersionToProtocolVersion(LATEST_SPEC_VERSION)).toBe(
      LATEST_SPEC_VERSION
    );
    expect(specVersionToProtocolVersion('extension')).toBeUndefined();
  });

  it('extension scenarios are isolated', () => {
    const ext = listScenariosForSpec('extension');
    for (const name of ext) {
      expect(getScenarioSpecVersions(name)).toContain('extension');
    }
  });
});
