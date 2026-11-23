export function formatItemLine(item, playingItemIndex, playbackState) {
    const marker = item.index !== playingItemIndex
        ? '        '
        : playbackState === 'paused'
            ? '❚❚   '
            : '▶   ';
    const details = item.details || fileName(item.path) || '(sin nombre)';

    return marker + (item.index + 1) + ' :: ' + details;
}

export function formatItemSubtitle(item) {
    const duration = item.duration || '00:00:00';
    const title = String(item.title || '').trim();
    const artist = String(item.artist || '').trim();

    let metadata;
    if (title) {
        metadata = title + ' - ' + (artist || '?');
    } else if (artist) {
        metadata = artist;
    } else {
        metadata = fileNameWithoutExtension(item.path) || '(sin nombre)';
    }

    return duration + ' - ' + metadata;
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

function fileNameWithoutExtension(path) {
    const name = fileName(path);
    const extensionIndex = name.lastIndexOf('.');
    return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}
