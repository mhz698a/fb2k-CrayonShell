import fb from 'foo-webview-sdk';

export function hasNativeBridge() {
    return typeof window !== 'undefined'
        && Boolean(window.fb2k)
        && typeof window.fb2k.invoke === 'function';
}

export function getFooSdk() {
    if (!hasNativeBridge()) {
        throw new Error(
            'No se encontró window.fb2k.invoke. Abre CrayonShell dentro de foobar2000.'
        );
    }

    if (typeof fb.isAvailable !== 'function' || !fb.isAvailable()) {
        throw new Error(
            'El SDK foo-webview-sdk no detecta un puente nativo disponible.'
        );
    }

    return fb;
}
