export function parseTrackDuration(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number.isFinite(Number(text)) ? Number(text) : null;
    const parts = text.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
    const values = parts.map(Number);
    if (parts.length === 3) {
        const [hours, minutes, seconds] = values;
        if (minutes >= 60 || seconds >= 60) return null;
        return hours * 3600 + minutes * 60 + seconds;
    }
    const [minutes, seconds] = values;
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
}
export function formatTrackDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    const pad = (number) => String(number).padStart(2, '0');
    return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(remainder) : minutes + ':' + pad(remainder);
}
export function getSelectedTrackStats(items = [], selectedIndices = []) {
    const selected = new Set((Array.isArray(selectedIndices) ? selectedIndices : [])
        .map(Number).filter((index) => Number.isInteger(index) && index >= 0));
    let count = 0;
    let durationSeconds = 0;
    (Array.isArray(items) ? items : []).forEach((item) => {
        if (!selected.has(Number(item.index))) return;
        count += 1;
        durationSeconds += parseTrackDuration(item.duration) || 0;
    });
    return { count, durationSeconds };
}
