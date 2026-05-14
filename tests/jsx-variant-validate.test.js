import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreateSetVariants } from '../src/core/validate.js';
import {
  notificationRecipe,
  accordionRecipe,
  switchRecipe,
  checkboxRecipe,
  radioRecipe,
  normalizeBuildKind,
  getRecipeRebuildSpec
} from '../src/core/recipes.js';

test('validateCreateSetVariants flags empty Text body', () => {
  const r = validateCreateSetVariants([
    { properties: { State: 'Default' }, jsx: '<Frame name="X"><Text name="L"/></Frame>' }
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.kind === 'text'));
});

test('validateCreateSetVariants accepts new recipe specs', () => {
  for (const spec of [
    notificationRecipe(),
    accordionRecipe(),
    switchRecipe(),
    checkboxRecipe(),
    radioRecipe()
  ]) {
    const r = validateCreateSetVariants(spec.variants);
    assert.equal(r.ok, true, spec.name + ': ' + JSON.stringify(r.issues));
  }
});

test('normalizeBuildKind maps toast and collapsible aliases', () => {
  assert.equal(normalizeBuildKind('toast'), 'notification');
  assert.equal(normalizeBuildKind('alert'), 'notification');
  assert.equal(normalizeBuildKind('collapsible'), 'accordion');
});

test('notification recipe respects toneAccent override', () => {
  const spec = notificationRecipe({ toneAccent: 'var:semantic/primary' });
  assert.ok(spec.variants.every((v) => v.jsx.includes('var:semantic/primary')));
});

test('getRecipeRebuildSpec passes notification tone vars', () => {
  const spec = getRecipeRebuildSpec('notification', {
    notificationAccentVar: 'var:a',
    notificationBgVar: 'var:b'
  });
  assert.ok(spec.variants[0].jsx.includes('var:a'));
  assert.ok(spec.variants[0].jsx.includes('var:b'));
});

test('getRecipeRebuildSpec checkbox uses button and stroke fallbacks', () => {
  const spec = getRecipeRebuildSpec('checkbox', {
    strokeVar: 'var:border',
    bgVar: 'var:bg',
    buttonBgVar: 'var:primary',
    buttonFgVar: 'var:pf'
  });
  const jsx = spec.variants.map((v) => v.jsx).join('\n');
  assert.ok(jsx.includes('var:border'));
  assert.ok(jsx.includes('var:bg'));
  assert.ok(jsx.includes('var:primary'));
  assert.ok(jsx.includes('var:pf'));
});

test('getRecipeRebuildSpec resolves toggle alias', () => {
  const a = getRecipeRebuildSpec('toggle', {});
  const b = getRecipeRebuildSpec('switch', {});
  assert.equal(a.name, b.name);
  assert.equal(a.variants.length, b.variants.length);
});

test('getRecipeRebuildSpec resolves radio button alias', () => {
  const a = getRecipeRebuildSpec('radio button', {});
  const b = getRecipeRebuildSpec('radio', {});
  assert.equal(a.name, b.name);
  assert.equal(a.variants.length, b.variants.length);
  assert.equal(a.variants.length, 4);
});

test('checkbox recipe exposes Checked × Disabled variants', () => {
  const { variants } = checkboxRecipe();
  assert.equal(variants.length, 4);
  assert.ok(variants.every((v) => v.properties.Checked && v.properties.Disabled));
});
