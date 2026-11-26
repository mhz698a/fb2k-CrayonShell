import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatFileSize,
    formatWindowsTimestamp,
    validateBridgeBootstrap
} from './windowsFileMetadataFormat.js';

test('accepts only a local-loopback bootstrap with a versioned 256-bit bearer token', () => {
    const result = validateBridgeBootstrap({
        protocolVersion: 1,
        componentVersion: '0.1.0',
        port: 43210,
        bearerToken: 'A'.repeat(43)
    });

    assert.equal(result.baseUrl, 'http://127.0.0.1:43210');
    assert.equal(result.port, 43210);
    assert.equal(result.bearerToken, 'A'.repeat(43));
});

test('rejects malformed bootstrap values and arbitrary remote endpoints', () => {
    assert.throws(() => validateBridgeBootstrap({
        protocolVersion: 1,
        port: 43210,
        bearerToken: 'short',
        baseUrl: 'https://example.com'
    }));
    assert.throws(() => validateBridgeBootstrap({
        protocolVersion: 2,
        port: 43210,
        bearerToken: 'A'.repeat(43)
    }));
    assert.throws(() => validateBridgeBootstrap({
        protocolVersion: 1,
        port: 70000,
        bearerToken: 'A'.repeat(43)
    }));
});

test('formats file size using the byte count returned by Windows', () => {
    assert.equal(formatFileSize(0), '0 bytes');
    assert.equal(formatFileSize(1024), '1 KB');
    assert.equal(formatFileSize(1048576), '1 MB');
    assert.equal(formatFileSize(null), 'No disponible');
});

test('formats mtime/ctime values only when Windows reports them readable', () => {
    assert.notEqual(formatWindowsTimestamp({
        readable: true,
        unixMilliseconds: 1700000000000
    }), 'No disponible');
    assert.equal(formatWindowsTimestamp({
        readable: false,
        unixMilliseconds: null
    }), 'No disponible');
});
