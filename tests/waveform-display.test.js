import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clampWaveformPosition,
    formatWaveformTime,
    getWaveformPositionFromPointer,
    getWaveformTimeLabels
} from '../src/services/waveform/waveformDisplay.js';

test('formats normal durations as mm:ss', () => {
    assert.equal(formatWaveformTime(0), '00:00');
    assert.equal(formatWaveformTime(65.9), '01:05');
    assert.equal(formatWaveformTime(3599), '59:59');
});

test('formats durations with hours as h:mm:ss', () => {
    assert.equal(formatWaveformTime(3600), '1:00:00');
    assert.equal(formatWaveformTime(3661), '1:01:01');
});

test('clamps preview positions to the track duration', () => {
    assert.equal(clampWaveformPosition(-2, 120), 0);
    assert.equal(clampWaveformPosition(125, 120), 120);
    assert.equal(clampWaveformPosition(17.5, 120), 17.5);
    assert.equal(clampWaveformPosition(Number.NaN, 120), 0);
});

test('converts pointer coordinates to a bounded track position', () => {
    const bounds = { left: 100, width: 400 };
    assert.equal(getWaveformPositionFromPointer(100, bounds, 200), 0);
    assert.equal(getWaveformPositionFromPointer(300, bounds, 200), 100);
    assert.equal(getWaveformPositionFromPointer(500, bounds, 200), 200);
    assert.equal(getWaveformPositionFromPointer(800, bounds, 200), 200);
    assert.equal(getWaveformPositionFromPointer(0, bounds, 200), 0);
});

test('returns safe defaults for invalid pointer geometry', () => {
    assert.equal(getWaveformPositionFromPointer(100, { left: 0, width: 0 }, 200), 0);
    assert.equal(getWaveformPositionFromPointer(100, { left: 0, width: 100 }, 0), 0);
});


test('provides elapsed, remaining and total time labels for one seekbar row', () => {
    assert.deepEqual(getWaveformTimeLabels(65, 240), {
        current: '01:05',
        remaining: '02:55',
        total: '04:00'
    });
    assert.deepEqual(getWaveformTimeLabels(400, 240), {
        current: '04:00',
        remaining: '00:00',
        total: '04:00'
    });
});

test('formats waveform time labels for video-length media', () => {
    assert.deepEqual(getWaveformTimeLabels(3661, 7322), {
        current: '1:01:01',
        remaining: '1:01:01',
        total: '2:02:02'
    });
});
