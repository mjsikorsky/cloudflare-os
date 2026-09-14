import { describe, expect, it } from 'vitest';
import { parseExternalAgentLaunch } from '../src/external-agent-launch.js';

describe('deployment-owned native agent launcher', () => {
  it('publishes only the configured label and canonical same-origin POST path', () => {
    expect(parseExternalAgentLaunch(undefined)).toBeUndefined();
    expect(parseExternalAgentLaunch({label: 'Open with your Dragon', actionUrl: '/legion/api/dsh/contribute'}))
      .toEqual({label: 'Open with your Dragon', actionUrl: '/legion/api/dsh/contribute'});
  });
  it('rejects redirects, URL normalization, authority-bearing config and malformed deployment input', () => {
    for (const actionUrl of ['https://elsewhere.test/', '//elsewhere.test/', '/\\elsewhere.test/', 'relative',
      '/path?grant=secret', '/path#token', '/a/../b', '/a\nb', '/a b']) {
      expect(() => parseExternalAgentLaunch({label: 'Dragon', actionUrl}), actionUrl).toThrow();
    }
    for (const value of [null, [], {}, {label: '', actionUrl: '/launch'}, {label: 'Dragon\n', actionUrl: '/launch'},
      {label: 'Dragon', actionUrl: '/launch', token: 'secret'}]) {
      expect(() => parseExternalAgentLaunch(value)).toThrow();
    }
  });
});
