function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase();
}

function fuzzyScore(text, token) {
    if (!text || !token) return null;
    if (text.includes(token)) {
        const position = text.indexOf(token);
        return 30 - Math.min(position, 24) + (position === 0 ? 24 : 0);
    }

    let cursor = 0;
    let score = 0;
    let previous = -2;

    for (const character of token) {
        const position = text.indexOf(character, cursor);
        if (position < 0) return null;

        const consecutive = position === previous + 1;
        score += consecutive ? 7 : Math.max(0, 4 - (position - cursor));
        if (position === 0 || /[\s_\-./\\]/.test(text[position - 1])) score += 8;

        previous = position;
        cursor = position + 1;
    }

    return score - text.length * 0.002;
}

function scoreItem(item, tokens) {
    const fields = [
        normalize(item.title),
        normalize(item.artist),
        normalize(item.details),
        normalize(item.path)
    ].filter(Boolean);

    let total = 0;
    for (const token of tokens) {
        const candidates = fields.map((field, index) => {
            const value = fuzzyScore(field, token);
            return value === null ? null : value + (index === 0 ? 3 : index === 1 ? 2 : 0);
        }).filter((value) => value !== null);

        if (candidates.length === 0) return null;
        total += Math.max(...candidates);
    }

    return total;
}

export function rankPlaylistItems(items, query) {
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    return (Array.isArray(items) ? items : [])
        .map((item) => ({ item, score: scoreItem(item, tokens) }))
        .filter((entry) => entry.score !== null)
        .sort((left, right) => right.score - left.score
            || Number(left.item.index) - Number(right.item.index))
        .map((entry) => entry.item);
}
