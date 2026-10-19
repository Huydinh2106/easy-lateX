import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import { updateEnvironment, appManifest } from '../github-setup.mjs';

test('setup preserves existing settings and quotes secrets without interpreting shell characters', () => {
  const source='DATABASE_URL="postgres://localhost/db"\nUNRELATED=keep\nGITHUB_APP_ID=\n';
  const output=updateEnvironment(source,{GITHUB_APP_ID:'123',GITHUB_CLIENT_SECRET:'$`"test'});
  assert.equal(parse(output).DATABASE_URL,'postgres://localhost/db');
  assert.equal(parse(output).UNRELATED,'keep');
  assert.equal(parse(output).GITHUB_APP_ID,'123');
  assert.equal(parse(output).GITHUB_CLIENT_SECRET,'$`"test');
});
test('manifest requires only collaboration permissions and an explicit webhook target', () => {
  const manifest=appManifest({name:'Test',callbackUrl:'http://127.0.0.1:4318/auth/github/callback',redirectUrl:'http://127.0.0.1:4319/callback',webhookUrl:'https://example.com/github/webhook'});
  assert.deepEqual(manifest.default_permissions,{contents:'write',administration:'write',metadata:'read'});
  assert.equal(manifest.request_oauth_on_install,false);
  assert.equal(manifest.hook_attributes.active,true);
});
