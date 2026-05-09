import chalk from 'chalk';
import { readFileSync } from 'fs';
import { FigmaClient } from '../core/figma-client.js';
import {
  rebuildComponentSet,
  applyTokens,
  getRecipeRebuildSpec,
  normalizeBuildKind,
  normalizeRecipePreset
} from '../core/recipes.js';

function readStdinOrFile(pathOrDash) {
  const p = pathOrDash === undefined || pathOrDash === '' ? '-' : pathOrDash;
  if (p === '-') return readFileSync(0, 'utf8');
  return readFileSync(p, 'utf8');
}

const TOKEN_ALIAS = new Set(['token-apply', 'tokens', 'apply-tokens']);

export default async function recipeCommand(name, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const recipeRaw = String(name || '').toLowerCase().trim();
    const recipe = normalizeBuildKind(recipeRaw.replace(/\s+/g, ' '));

    if (TOKEN_ALIAS.has(recipe)) {
      const tokensRaw = options.tokensFile ? readStdinOrFile(options.tokensFile) : options.tokens;
      if (!tokensRaw || !String(tokensRaw).trim()) {
        throw new Error('token-apply requires --tokens JSON string or --tokens-file');
      }
      const tokens = JSON.parse(tokensRaw);
      const idsOpt = options.nodeIds || options.nodeids;
      const nodeIds = idsOpt ? String(idsOpt).split(/[\s,]+/).filter(Boolean) : undefined;
      const r = await applyTokens(client, { nodeIds: nodeIds && nodeIds.length ? nodeIds : undefined, tokens });
      const changed = Array.isArray(r.changed) ? r.changed.length : 0;
      console.log(chalk.green(`✓ token-apply: updated ${changed} node(s) (${r.selected} selected)`));
      return;
    }

    const preset = normalizeRecipePreset(options.preset);
    const args = {
      preset,
      strokeVar: options.strokeVar,
      bgVar: options.bgVar,
      textVar: options.textVar,
      buttonBgVar: options.buttonBg,
      buttonFgVar: options.buttonFg,
      buttonMutedBgVar: options.buttonMutedBg,
      buttonMutedFgVar: options.buttonMutedFg,
      notificationAccentVar: options.notificationAccent,
      notificationBgVar: options.notificationBg,
      notificationBorderVar: options.notificationBorder,
      notificationTitleVar: options.notificationTitle,
      notificationBodyVar: options.notificationBody,
      notificationTitleFontSize: options.notificationTitleFontSize,
      notificationBodyFontSize: options.notificationBodyFontSize,
      accordionStrokeVar: options.accordionStroke,
      accordionTitleVar: options.accordionTitle,
      accordionBodyVar: options.accordionBody,
      accordionHintVar: options.accordionHint,
      accordionTitleFontSize: options.accordionTitleFontSize,
      accordionBodyFontSize: options.accordionBodyFontSize,
      accordionHintFontSize: options.accordionHintFontSize,
      switchTrackOffVar: options.switchTrackOff,
      switchTrackOnVar: options.switchTrackOn,
      switchKnobFillVar: options.switchKnob,
      switchLabelVar: options.switchLabel,
      switchLabelFontSize: options.switchLabelFontSize,
      checkboxPrimaryVar: options.checkboxPrimary,
      checkboxBorderVar: options.checkboxBorder,
      checkboxBgVar: options.checkboxBg,
      checkboxCheckFgVar: options.checkboxCheckFg,
      checkboxMutedBorderVar: options.checkboxMutedBorder,
      checkboxMutedBgVar: options.checkboxMutedBg,
      checkboxLabelVar: options.checkboxLabel,
      checkboxLabelMutedVar: options.checkboxLabelMuted,
      checkboxLabelFontSize: options.checkboxLabelFontSize,
      radioPrimaryVar: options.radioPrimary,
      radioBorderVar: options.radioBorder,
      radioBgVar: options.radioBg,
      radioMutedBorderVar: options.radioMutedBorder,
      radioLabelVar: options.radioLabel,
      radioLabelMutedVar: options.radioLabelMuted,
      radioLabelFontSize: options.radioLabelFontSize,
      modalBackdropOpacity: options.modalBackdropOpacity,
      modalBackdropColor: options.modalBackdropColor,
      modalBgVar: options.modalBg,
      modalBorderVar: options.modalBorder,
      modalPrimaryBgVar: options.modalPrimaryBg,
      modalPrimaryFgVar: options.modalPrimaryFg,
      modalTitleVar: options.modalTitle,
      modalTitleFontSize: options.modalTitleFontSize,
      modalBodyFontSize: options.modalBodyFontSize,
      modalButtonFontSize: options.modalButtonFontSize,
      modalCloseFontSize: options.modalCloseFontSize
    };

    const spec = getRecipeRebuildSpec(recipe, args);
    if (!spec) {
      throw new Error(
        `Unknown recipe "${name}". Try: input, button, card, badge, hero, notification, accordion, switch (toggle), checkbox, radio (radio button), token-apply`
      );
    }

    const r = await rebuildComponentSet(client, spec);
    console.log(chalk.green(`✓ Recipe "${recipeRaw}" → rebuilt "${r.name}" (${r.id}), ${r.variants.length} variant(s)`));
  } catch (e) {
    console.error(chalk.red('recipe failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
