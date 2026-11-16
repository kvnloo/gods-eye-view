import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readRepoFile = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('GHCR image publishing is release-only and uses the production Dockerfile', async () => {
  const workflow = await readRepoFile('.github/workflows/docker-publish.yml');

  assert.match(workflow, /^on:\s*\n\s+release:\s*\n\s+types:\s*\[published\]/m);
  assert.doesNotMatch(workflow, /^\s{2}push:\s*(?:\n|$)/m);
  assert.match(workflow, /^\s*packages:\s*write\s*$/m);
  assert.match(workflow, /docker\/login-action@v3/);
  assert.match(workflow, /github\.repository/);
  assert.match(workflow, /^\s*file:\s*Dockerfile\.prod\s*$/m);
  assert.match(workflow, /^\s*push:\s*true\s*$/m);
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.match(workflow, /type=sha,prefix=sha-,format=short/);
});

test('production image serves the built application on the Kubernetes port', async () => {
  const dockerfile = await readRepoFile('Dockerfile.prod');
  const manifest = await readRepoFile('k8s/gods-eye-view.yaml');

  assert.match(dockerfile, /^\s*RUN npm run build && npm run build:panel\s*$/m);
  assert.match(dockerfile, /^\s*ENV HOST=0\.0\.0\.0\s*$/m);
  assert.match(dockerfile, /^\s*ENV PORT=4173\s*$/m);
  assert.match(dockerfile, /^\s*EXPOSE 4173\s*$/m);
  assert.match(dockerfile, /CMD \["npx", "vite", "preview", "--host", "0\.0\.0\.0", "--port", "4173", "--strictPort"\]/);

  assert.match(manifest, /^\s*containerPort:\s*4173\s*$/m);
  assert.match(manifest, /^\s*name:\s*http\s*$/m);
  assert.match(manifest, /^\s*image:\s*ghcr\.io\/\S+\/gods-eye-view:\S+\s*$/m);
  assert.match(manifest, /^\s*startupProbe:\s*$/m);
  assert.match(manifest, /^\s*readinessProbe:\s*$/m);
  assert.match(manifest, /^\s*livenessProbe:\s*$/m);
});

test('the one-replica deployment permits optional provider keys without privileged pods', async () => {
  const manifest = await readRepoFile('k8s/gods-eye-view.yaml');

  assert.match(manifest, /^\s*replicas:\s*1\s*$/m);
  assert.match(manifest, /^\s*type:\s*Recreate\s*$/m);
  assert.match(manifest, /^\s*runAsNonRoot:\s*true\s*$/m);
  assert.match(manifest, /^\s*allowPrivilegeEscalation:\s*false\s*$/m);
  assert.match(manifest, /^\s*drop:\s*\["ALL"\]\s*$/m);
  assert.match(manifest, /envFrom:\s*\n\s*-\s*secretRef:\s*\n\s*name:\s*gev-provider-keys\s*\n\s*optional:\s*true/);
  assert.match(manifest, /name:\s*GEV_KEY_SETUP_TRUSTED_PEERS\s*\n\s*value:\s*""/);
  assert.match(manifest, /name:\s*GEV_ALLOWED_HOSTS\s*\n\s*value:\s*"localhost"/);
});
