import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { gitRuntime } from '../src/main/services/git/GitRuntime';

describe('bundled Git', () => {
  it('runs without system Git and ignores inherited executable and credential overrides', () => {
    const runtime = gitRuntime({ PATH: '', GIT_EXEC_PATH: '/untrusted', LOCAL_GIT_DIRECTORY: '/untrusted', GIT_CONFIG_COUNT: '1', GIT_CONFIG_VALUE_0: 'secret', GIT_SSL_NO_VERIFY: '1' });
    expect(runtime.executable).toContain('dugite');
    expect(runtime.env.GIT_EXEC_PATH).not.toBe('/untrusted');
    expect(runtime.env.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(runtime.env.GIT_SSL_NO_VERIFY).toBeUndefined();
    expect(execFileSync(runtime.executable, ['--version'], { env: runtime.env, encoding: 'utf8' })).toMatch(/^git version /);
    expect(execFileSync(runtime.executable, ['--exec-path'], { env: runtime.env, encoding: 'utf8' }).trim()).toBe(runtime.env.GIT_EXEC_PATH);
  });
});
