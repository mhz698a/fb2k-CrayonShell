export function formatWaveformTime(value) {
    const seconds = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainder = wholeSeconds % 60;

    if (hours > 0) {
        return String(hours) + ':'
            + String(minutes).padStart(2, '0') + ':'
            + String(remainder).padStart(2, '0');
    }

    return String(minutes).padStart(2, '0') + ':'
        + String(remainder).padStart(2, '0');
}

export function clampWaveformPosition(value, duration) {
    const numericValue = Number(value);
    const numericDuration = Number(duration);
    if (!Number.isFinite(numericValue)) return 0;
    if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
        return Math.max(0, numericValue);
    }
    return Math.min(numericDuration, Math.max(0, numericValue));
}

export function getWaveformPositionFromPointer(clientX, bounds, duration) {
    const left = Number(bounds?.left);
    const width = Number(bounds?.width);
    const totalDuration = Number(duration);

    if (!Number.isFinite(clientX) || !Number.isFinite(left)
        || !Number.isFinite(width) || width <= 0
        || !Number.isFinite(totalDuration) || totalDuration <= 0) {
        return 0;
    }

    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    return ratio * totalDuration;
}


export function getWaveformTimeLabels(position, duration) {
    const totalSeconds = Number.isFinite(Number(duration))
        ? Math.max(0, Number(duration))
        : 0;
    const currentSeconds = clampWaveformPosition(position, totalSeconds);
    const remainingSeconds = Math.max(0, totalSeconds - currentSeconds);

    return {
        current: formatWaveformTime(currentSeconds),
        remaining: formatWaveformTime(remainingSeconds),
        total: formatWaveformTime(totalSeconds)
    };
}
