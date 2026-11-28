import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTrackDuration, getSelectedTrackStats, parseTrackDuration } from './playlistStatus.js';

test('parses foobar duration formats', () => {
    assert.equal(parseTrackDuration('00:03:21'), 201);
    assert.equal(parseTrackDuration('1:02:03'), 3723);
    assert.equal(parseTrackDuration('03:21'), 201);
    assert.equal(parseTrackDuration(12.5), 12.5);
});
test('rejects malformed durations', () => {
    assert.equal(parseTrackDuration(''), null);
    assert.equal(parseTrackDuration('03:75'), null);
    assert.equal(parseTrackDuration('unknown'), null);
    assert.equal(parseTrackDuration(-1), null);
});
test('formats durations with hours where required', () => {
    assert.equal(formatTrackDuration(201), '3:21');
    assert.equal(formatTrackDuration(3723), '1:02:03');
    assert.equal(formatTrackDuration(0), '0:00');
});
test('sums each selected playlist row once', () => {
    assert.deepEqual(getSelectedTrackStats([
        { index: 0, duration: '00:03:00' },
        { index: 1, duration: '00:04:30' },
        { index: 2, duration: '' }
    ], [0,1,1,99]), { count: 2, durationSeconds: 450 });
});
