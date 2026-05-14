import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isDesignEditorUrl } from '../src/core/figma-client.js';

describe('isDesignEditorUrl', () => {
  it('matches design URLs', () => {
    assert.strictEqual(
      isDesignEditorUrl('https://www.figma.com/design/abc123/My-File'),
      true
    );
  });

  it('matches legacy file URLs', () => {
    assert.strictEqual(isDesignEditorUrl('https://www.figma.com/file/abc123/My-File'), true);
  });

  it('does not match /files/ feed', () => {
    assert.strictEqual(isDesignEditorUrl('https://www.figma.com/files/feed'), false);
  });

  it('does not match /files/team/recents', () => {
    assert.strictEqual(
      isDesignEditorUrl('https://www.figma.com/files/team/123/recents'),
      false
    );
  });

  it('does not match desktop_new_tab', () => {
    assert.strictEqual(isDesignEditorUrl('https://www.figma.com/desktop_new_tab'), false);
  });

  it('returns false for null', () => {
    assert.strictEqual(isDesignEditorUrl(null), false);
  });

  it('returns false for empty string', () => {
    assert.strictEqual(isDesignEditorUrl(''), false);
  });
});
