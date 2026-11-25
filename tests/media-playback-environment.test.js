import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWebViewEnvironment } from '../src/services/mediaPlaybackProbe.js';

function createSdk() {
    return {
        config: {
            getVersionInfo: async () => ({ plugin: { version: '2.2.0' } })
        },
        webview: {
            getSource: async () => ({
                source: 'devServer',
                url: 'http://localhost:5173'
            })
        },
        media: {
            getContainerInfo() {},
            getStreamUrl() {}
        },
        MediaElementFollower: class MediaElementFollower {},
        artwork: {
            getForTrack() {}
        },
        player: {
            getPosition() {},
            getState() {}
        }
    };
}

const devServerLocation = {
    origin: 'http://localhost:5173',
    protocol: 'http:'
};

test('Detecta correctamente Vite cuando el puente y la fachada SDK están disponibles', async () => {
    const environment = await inspectWebViewEnvironment({
        location: devServerLocation,
        nativeBridgeAvailable: true,
        getSdkInstance: createSdk
    });

    assert.equal(environment.hasHostBridge, true);
    assert.equal(environment.hasSdkFacade, true);
    assert.equal(environment.isHttpOrigin, true);
    assert.equal(environment.source, 'devServer');
    assert.equal(environment.pluginVersion, '2.2.0');
    assert.equal(environment.mediaRouteSupported, true);
    assert.equal(environment.hasPlaybackApi, true);
    assert.equal(environment.hasMediaApi, true);
    assert.equal(environment.hasMediaElementFollower, true);
    assert.equal(environment.hasArtworkApi, true);
    assert.equal(environment.sourceError, '');
});

test('Identifica el navegador externo sin intentar cargar el SDK', async () => {
    let sdkRequested = false;
    const environment = await inspectWebViewEnvironment({
        location: devServerLocation,
        nativeBridgeAvailable: false,
        getSdkInstance: () => {
            sdkRequested = true;
            throw new Error('No debería solicitar el SDK');
        }
    });

    assert.equal(environment.hasHostBridge, false);
    assert.equal(environment.hasSdkFacade, false);
    assert.equal(environment.source, 'Navegador externo');
    assert.equal(sdkRequested, false);
});

test('Distingue un puente nativo disponible de una fachada SDK no disponible', async () => {
    const environment = await inspectWebViewEnvironment({
        location: devServerLocation,
        nativeBridgeAvailable: true,
        getSdkInstance: () => {
            throw new Error('El SDK no detecta el puente');
        }
    });

    assert.equal(environment.hasHostBridge, true);
    assert.equal(environment.hasSdkFacade, false);
    assert.match(environment.sourceError, /SDK no detecta el puente/);
});

test('Conserva la inspección aunque fallen las consultas opcionales de versión y origen', async () => {
    const sdk = createSdk();
    sdk.config.getVersionInfo = async () => {
        throw new Error('Versión no disponible');
    };
    sdk.webview.getSource = async () => {
        throw new Error('Origen no disponible');
    };

    const environment = await inspectWebViewEnvironment({
        location: devServerLocation,
        nativeBridgeAvailable: true,
        getSdkInstance: () => sdk
    });

    assert.equal(environment.hasHostBridge, true);
    assert.equal(environment.hasSdkFacade, true);
    assert.equal(environment.mediaRouteSupported, null);
    assert.match(environment.versionError, /Versión no disponible/);
    assert.match(environment.sourceError, /Origen no disponible/);
    assert.equal(environment.hasPlaybackApi, true);
});
