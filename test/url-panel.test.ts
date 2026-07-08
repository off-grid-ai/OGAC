import assert from 'node:assert/strict';
import { test } from 'node:test';
import { panelHref, withPanelParams } from '../src/lib/url-panel.ts';

// Unit tests for the PURE URL-panel query helpers — no router, no DOM. These drive every
// URL-driven side panel (open/close/edit-target lives in the query string), so a regression
// here would break Back-button behavior across every module.

test('withPanelParams: sets a param on an empty query', () => {
  assert.equal(withPanelParams('', { panel: 'new-connector' }), 'panel=new-connector');
});

test('withPanelParams: null value deletes a param', () => {
  assert.equal(withPanelParams('panel=new-connector', { panel: null }), '');
});

test('withPanelParams: preserves unrelated params and order', () => {
  assert.equal(
    withPanelParams('tab=custom', { panel: 'edit-connector', id: 'c1' }),
    'tab=custom&panel=edit-connector&id=c1',
  );
});

test('withPanelParams: overwrites an existing key rather than duplicating it', () => {
  assert.equal(withPanelParams('panel=new', { panel: 'edit' }), 'panel=edit');
});

test('withPanelParams: multiple updates including a delete', () => {
  assert.equal(
    withPanelParams('panel=edit-connector&id=c1', { panel: null, id: null }),
    '',
  );
});

test('withPanelParams: url-encodes values', () => {
  assert.equal(withPanelParams('', { id: 'a b/c' }), 'id=a+b%2Fc');
});

test('panelHref: omits the "?" when the query is empty', () => {
  assert.equal(panelHref('/data/integrations', ''), '/data/integrations');
});

test('panelHref: joins path and query with "?"', () => {
  assert.equal(panelHref('/data/integrations', 'panel=new-connector'), '/data/integrations?panel=new-connector');
});
