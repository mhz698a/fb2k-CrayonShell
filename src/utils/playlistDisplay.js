export function formatItemLine(item, playingItemIndex, playbackState) {
    const marker = item.index !== playingItemIndex
        ? '        '
        : playbackState === 'paused'
            ? '❚❚   '
            : '▶   ';
    const duration = item.duration || '00:00:00';
    const details = item.details || fileName(item.path) || '(sin nombre)';

    return marker + '[' + duration + ']  '
        + (item.index + 1) + ' :: ' + details;
}

function fileName(path) {
    const value = String(path || '').replace(/\\/g, '/');
    const tail = value.slice(value.lastIndexOf('/') + 1);

    try {
        return decodeURIComponent(tail) || value;
    } catch {
        return tail || value;
    }
}
