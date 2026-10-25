// Author-owned text is stored in full. Only the copy sent to a model is budgeted.
export const CHARACTER_PROFILE_FIELDS = Object.freeze([
    { key: 'identityAnchor', jsonKey: 'identity_anchor', label: '身份锚点', promptLimit: 500 },
    { key: 'appearanceProfile', jsonKey: 'appearance_profile', label: '外貌设定', promptLimit: 700 },
    { key: 'personalityAnchor', jsonKey: 'personality_anchor', label: '人格锚点', promptLimit: 600 },
    { key: 'backgroundProfile', jsonKey: 'background_profile', label: '背景与关系', promptLimit: 900 },
    { key: 'abilityProfile', jsonKey: 'ability_profile', label: '能力与限制', promptLimit: 1200 },
    { key: 'speakingStyle', jsonKey: 'speaking_style', label: '说话习惯', promptLimit: 360 },
    { key: 'behaviorBoundaries', jsonKey: 'behavior_boundaries', label: '行为边界', promptLimit: 500 },
]);

export function authorText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function readCharacterProfile(raw = {}, existing = null) {
    return Object.fromEntries(CHARACTER_PROFILE_FIELDS.map(field => [
        field.key,
        authorText(existing ? existing[field.key] : (raw[field.key] ?? raw[field.jsonKey])),
    ]));
}

export function mergeProfileText(current, incoming) {
    const before = authorText(current);
    const after = authorText(incoming);
    if (!before) return after;
    if (!after || before === after || before.includes(after)) return before;
    if (after.includes(before)) return after;
    // A paragraph, rather than a single punctuation mark, is the smallest unit
    // here: sentence-level de-duplication can drop a condition or a negation.
    const paragraphs = new Set(before.split(/\n\s*\n/).map(part => part.trim()));
    const additions = after.split(/\n\s*\n/).filter(part => !paragraphs.has(part.trim()));
    return additions.length ? `${before}\n\n${additions.join('\n\n')}` : before;
}

export function applyImportedCharacterValues(person, values) {
    const imported = { ...(person.worldbookImportedValues || {}) };
    for (const { key } of CHARACTER_PROFILE_FIELDS) {
        const current = authorText(person[key]);
        const incoming = authorText(values[key]);
        if (!incoming) continue;
        // A structured hand-written field can look exactly like a legacy dump.
        // Formatting heuristics never authorize replacing the author's text.
        if (!current || current === imported[key]) {
            person[key] = mergeProfileText(current, incoming);
            imported[key] = person[key];
        }
    }
    person.worldbookImportedValues = imported;
}

export function readWorldbookProvenance(raw = {}, existing = null) {
    const owner = existing || raw;
    const sources = (Array.isArray(owner.worldbookSources) ? owner.worldbookSources : [])
        .filter(source => source && typeof source.content === 'string')
        .map(source => ({
            reference: authorText(source.reference),
            entryName: authorText(source.entryName),
            content: authorText(source.content),
        }));
    const imported = readCharacterProfile(owner.worldbookImportedValues || {});
    return {
        worldbookRaw: authorText(owner.worldbookRaw ?? owner.worldbook_raw),
        worldbookRefs: [...new Set([
            ...(Array.isArray(owner.worldbookRefs) ? owner.worldbookRefs : []),
            owner.worldbookRef,
        ].map(authorText).filter(Boolean))],
        worldbookSources: sources,
        worldbookImportedValues: imported,
        worldbookSourceRef: authorText(owner.worldbookSourceRef),
        worldbookSourceEntry: authorText(owner.worldbookSourceEntry),
    };
}

export function appendWorldbookProvenance(person, { reference, sources = [], raw = '' } = {}) {
    const provenance = readWorldbookProvenance(person);
    person.worldbookRefs = [...new Set([
        ...provenance.worldbookRefs, reference,
    ].map(authorText).filter(Boolean))];
    person.worldbookSources = [...provenance.worldbookSources];
    for (const source of sources) {
        if (!person.worldbookSources.some(item => item.reference === source.reference && item.content === source.content)) {
            person.worldbookSources.push({ ...source });
        }
    }
    person.worldbookRaw = mergeProfileText(provenance.worldbookRaw, raw);
}

// Used only while packing a prompt; it never changes stored character text.
// Keep the beginning and the end so a long ability's trailing cost/weakness is
// not silently hidden behind its introduction.
export function profilePromptText(value, limit) {
    const text = authorText(value);
    limit = Math.max(0, Math.floor(Number(limit) || 0));
    if (text.length <= limit) return text;
    const marker = '\n[…资料已节选，未展示部分不得自行补全…]\n';
    if (limit <= marker.length) return text.slice(0, limit);
    const usable = limit - marker.length;
    const head = Math.ceil(usable * 0.65);
    return `${text.slice(0, head)}${marker}${text.slice(-(usable - head))}`;
}
