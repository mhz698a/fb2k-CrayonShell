import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildServiceDescriptorPath,
    formatFileSize,
    formatWindowsTimestamp,
    parseServiceDescriptor,
    validateBridgeBootstrap
} from './windowsFileMetadataFormat.js';

test('accepts only a local-loopback bootstrap with a versioned 256-bit bearer token', () => {
    const result = validateBridgeBootstrap({
        success: true,
        service: 'crayonshell',
        protocolVersion: 1,
        pid: 1234,
        baseUrl: 'http://127.0.0.1:43210',
        token: 'A'.repeat(43),
        instanceId: 'B'.repeat(43),
        expiresAt: Date.now() + 60_000
    });

    assert.equal(result.baseUrl, 'http://127.0.0.1:43210');
    assert.equal(result.token, 'A'.repeat(43));
    assert.equal(result.instanceId, 'B'.repeat(43));
    assert.equal(result.pid, 1234);
});

test('rejects malformed bootstrap values and arbitrary remote endpoints', () => {
    const valid = {
        success: true,
        service: 'crayonshell',
        protocolVersion: 1,
        pid: 1234,
        baseUrl: 'http://127.0.0.1:43210',
        token: 'A'.repeat(43),
        instanceId: 'B'.repeat(43),
        expiresAt: Date.now() + 60_000
    };
    assert.throws(() => validateBridgeBootstrap({ ...valid, token: 'short' }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, protocolVersion: 2 }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, baseUrl: 'https://example.com' }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, baseUrl: 'http://127.0.0.1:70000' }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, expiresAt: Date.now() - 1 }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, pid: 0 }));
    assert.throws(() => validateBridgeBootstrap({ ...valid, instanceId: 'instance-1' }));
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


test('builds the descriptor path from the host-reported native profile path', () => {
    assert.equal(
        buildServiceDescriptorPath('C:\\Users\\Mhz\\AppData\\Roaming\\foobar2000-v2\\'),
        'C:\\Users\\Mhz\\AppData\\Roaming\\foobar2000-v2\\foo_crayonshell_bridge\\service.json'
    );
    assert.equal(
        buildServiceDescriptorPath('file:///C:/Users/Mhz/AppData/Roaming/foobar2000-v2'),
        'C:\\Users\\Mhz\\AppData\\Roaming\\foobar2000-v2\\foo_crayonshell_bridge\\service.json'
    );
    assert.throws(() => buildServiceDescriptorPath(''));
    assert.throws(() => buildServiceDescriptorPath('C:\\Users\\..\\Windows'));
});

test('parses the JSON descriptor and validates its process identity', () => {
    const descriptor = parseServiceDescriptor(JSON.stringify({
        success: true,
        service: 'crayonshell',
        protocolVersion: 1,
        pid: 4321,
        baseUrl: 'http://127.0.0.1:43210',
        token: 'A'.repeat(43),
        instanceId: 'B'.repeat(43),
        expiresAt: Date.now() + 60_000
    }));

    assert.equal(descriptor.pid, 4321);
    assert.equal(descriptor.instanceId, 'B'.repeat(43));
    assert.throws(() => parseServiceDescriptor('{invalid'));
});
