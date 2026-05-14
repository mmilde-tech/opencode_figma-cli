/**
 * Live Figma smoke: creates ephemeral `_Smoke_Opencode_*` component sets, verifies
 * instance variant selection + Label overrides via the plugin runtime, then deletes nodes.
 *
 * Enable with either:
 *   npm run test:smoke (npm sets npm_lifecycle_event — reliable on Windows)
 *   OPENCODE_FIGMA_SMOKE=1 node --test tests/instance-overrides-smoke.test.js
 *   node --test tests/instance-overrides-smoke.test.js -- --smoke (may not reach argv under npm)
 *
 * Requires Figma Desktop with a design file tab open and CDP connected (same as recipe CLI).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FigmaClient } from '../src/core/figma-client.js';
import {
  rebuildComponentSet,
  buttonRecipe,
  checkboxRecipe,
  radioRecipe
} from '../src/core/recipes.js';
import { createInstance, deleteNodes } from '../src/core/operations.js';

const smokeEnabled =
  process.env.OPENCODE_FIGMA_SMOKE === '1' ||
  process.argv.includes('--smoke') ||
  process.env.npm_lifecycle_event === 'test:smoke';

const PREFIX = '_Smoke_Opencode_';

async function readInstanceTextByName(client, instanceId, textNodeName) {
  const ctx = { instanceId, textNodeName };
  return await client.run(`(async () => {
    const inst = await figma.getNodeByIdAsync(ctx.instanceId);
    if (!inst || inst.type !== 'INSTANCE') throw new Error('Expected INSTANCE, got ' + (inst && inst.type));
    const t = inst.findOne((n) => n.type === 'TEXT' && n.name === ctx.textNodeName);
    if (!t) throw new Error('No TEXT named "' + ctx.textNodeName + '" under instance');
    return t.characters;
  })()`, ctx);
}

async function readInstanceMainVariantName(client, instanceId) {
  const ctx = { instanceId };
  return await client.run(`(async () => {
    const inst = await figma.getNodeByIdAsync(ctx.instanceId);
    if (!inst || inst.type !== 'INSTANCE') throw new Error('Expected INSTANCE');
    const m = inst.mainComponent;
    return m ? m.name : '';
  })()`, ctx);
}

test(
  'live Figma: Button / Checkbox / Radio instance overrides + variants',
  { skip: !smokeEnabled },
  async () => {
    const client = new FigmaClient();
    const instances = [];
    const sets = [];

    try {
      await client.connect();
    } catch (e) {
      assert.fail(
        `Figma not reachable (${e.message}). Open Figma Desktop with a design file, then retry.`
      );
    }

    try {
      const buttonSpec = buttonRecipe();
      buttonSpec.name = PREFIX + 'Button';
      const buttonSet = await rebuildComponentSet(client, buttonSpec);
      sets.push(buttonSet.id);

      const labelDefault = `SmokeBtn_${Date.now()}`;
      const instBtn = await createInstance(client, {
        component: buttonSpec.name,
        variant: 'State=Default',
        overrides: { Label: labelDefault }
      });
      instances.push(instBtn.id);
      assert.equal(await readInstanceTextByName(client, instBtn.id, 'Label'), labelDefault);

      const instHover = await createInstance(client, {
        component: buttonSpec.name,
        variant: 'State=Hover',
        overrides: { Label: 'Hover row' }
      });
      instances.push(instHover.id);
      assert.match(await readInstanceMainVariantName(client, instHover.id), /Hover/);

      const chkSpec = checkboxRecipe();
      chkSpec.name = PREFIX + 'Checkbox';
      const chkSet = await rebuildComponentSet(client, chkSpec);
      sets.push(chkSet.id);

      const instChk = await createInstance(client, {
        component: chkSpec.name,
        variant: 'Checked=Yes, Disabled=No',
        overrides: { Label: 'Custom checkbox label' }
      });
      instances.push(instChk.id);
      assert.equal(
        await readInstanceTextByName(client, instChk.id, 'Label'),
        'Custom checkbox label'
      );
      assert.match(await readInstanceMainVariantName(client, instChk.id), /Checked=Yes/);

      const radioSpec = radioRecipe();
      radioSpec.name = PREFIX + 'Radio';
      const radioSet = await rebuildComponentSet(client, radioSpec);
      sets.push(radioSet.id);

      const instRad = await createInstance(client, {
        component: radioSpec.name,
        variant: 'Selected=Yes, Disabled=No',
        overrides: { Label: 'Custom radio label' }
      });
      instances.push(instRad.id);
      assert.equal(
        await readInstanceTextByName(client, instRad.id, 'Label'),
        'Custom radio label'
      );
      assert.match(await readInstanceMainVariantName(client, instRad.id), /Selected=Yes/);
    } finally {
      try {
        if (instances.length) await deleteNodes(client, { nodeIds: instances.slice() });
        if (sets.length) await deleteNodes(client, { nodeIds: sets.slice() });
      } catch {
        /* best-effort cleanup */
      }
      client.close();
    }
  }
);
