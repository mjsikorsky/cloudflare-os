import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyWorkspaceFileEdit } from '../src/workspace-code.ts';

function write(doc, rootName, filename, content) {
  applyWorkspaceFileEdit(doc, {toolName: 'writeFile', rootName, filename, content});
}

test('native writes travel as a V2 delta and preserve other workpiece roots', () => {
  const canonical = new Y.Doc(); const draft = new Y.Doc();
  try {
    write(canonical, 'native-root-a', 'report.js', 'original');
    write(canonical, 'native-root-b', 'private.js', 'unchanged');
    Y.applyUpdateV2(draft, Y.encodeStateAsUpdateV2(canonical));
    const before = Y.encodeStateVector(draft);
    write(draft, 'native-root-a', 'report.js', 'with chart');
    write(draft, 'native-root-a', 'chart.js', 'chart source');
    assert.equal(canonical.getMap('native-root-a').get('report.js').toString(), 'original');
    Y.applyUpdateV2(canonical, Y.encodeStateAsUpdateV2(draft, before));
    assert.equal(canonical.getMap('native-root-a').get('report.js').toString(), 'with chart');
    assert.equal(canonical.getMap('native-root-a').get('chart.js').toString(), 'chart source');
    assert.equal(canonical.getMap('native-root-b').get('private.js').toString(), 'unchanged');
  } finally { canonical.destroy(); draft.destroy(); }
});

test('native exact-match edits preserve the Y.Text identity and merge unrelated concurrent edits', () => {
  const canonical = new Y.Doc(); const draft = new Y.Doc();
  try {
    write(canonical, 'files', 'report.js', 'report\nfooter');
    Y.applyUpdateV2(draft, Y.encodeStateAsUpdateV2(canonical));
    const before = Y.encodeStateVector(draft);
    const text = draft.getMap('files').get('report.js');
    applyWorkspaceFileEdit(draft, {toolName: 'editFile', rootName: 'files', filename: 'report.js',
      textToReplace: 'report', replacement: 'report with chart'});
    assert.equal(draft.getMap('files').get('report.js'), text);
    canonical.getMap('files').get('report.js').insert(13, '\nconcurrent note');
    Y.applyUpdateV2(canonical, Y.encodeStateAsUpdateV2(draft, before));
    assert.equal(canonical.getMap('files').get('report.js').toString(), 'report with chart\nfooter\nconcurrent note');
  } finally { canonical.destroy(); draft.destroy(); }
});

test('missing files and absent or ambiguous exact matches leave native source unchanged', () => {
  const doc = new Y.Doc();
  try {
    write(doc, 'files', 'report.js', 'repeat repeat');
    const before = Y.encodeStateAsUpdateV2(doc);
    const edit = {toolName: 'editFile', rootName: 'files', filename: 'report.js', replacement: 'new'};
    assert.throws(() => applyWorkspaceFileEdit(doc, {...edit, filename: 'missing.js', textToReplace: 'x'}), /File does not exist/);
    assert.throws(() => applyWorkspaceFileEdit(doc, {...edit, textToReplace: 'absent'}), /No matching text/);
    assert.throws(() => applyWorkspaceFileEdit(doc, {...edit, textToReplace: 'repeat'}), /Multiple matches/);
    assert.deepEqual(Y.encodeStateAsUpdateV2(doc), before);
  } finally { doc.destroy(); }
});
