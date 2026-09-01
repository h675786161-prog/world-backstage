const SURFACE_VERSION = 1;
const MAX_VOLATILE_MOMENT_IMAGES = 80;

const volatileMomentImages = new Map();

function clone(value) {
    if (value === undefined) return undefined;
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {
        // Fall through to the plain-data clone below.
    }
    return JSON.parse(JSON.stringify(value));
}

function sourceKey(value) {
    const key = String(value || '').trim();
    return key || 'root';
}

export function branchSurfaceKeyFromState(state) {
    return sourceKey(state?.lastCommit?.sourceKey || 'root');
}

function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function momentImageCacheKey(moment) {
    const identity = JSON.stringify({
        id: String(moment?.id || ''),
        createdAt: String(moment?.createdAt || moment?.generatedAt || moment?.time || ''),
        personId: String(moment?.personId || moment?.authorId || moment?.senderId || ''),
        author: String(moment?.author || moment?.name || moment?.senderName || ''),
        text: String(moment?.text || moment?.content || moment?.title || '').slice(0, 600),
    });
    return `moment-image:${hashText(identity)}:${identity.length}`;
}

function rememberMomentImage(moment) {
    const imageUrl = String(moment?.imageUrl || '').trim();
    if (!imageUrl) return;
    const key = momentImageCacheKey(moment);
    volatileMomentImages.delete(key);
    volatileMomentImages.set(key, imageUrl);
    while (volatileMomentImages.size > MAX_VOLATILE_MOMENT_IMAGES) {
        const oldest = volatileMomentImages.keys().next().value;
        volatileMomentImages.delete(oldest);
    }
}

function stripSocialPresentation(value) {
    const social = clone(value && typeof value === 'object' ? value : {});
    delete social.imageSettings;
    delete social.ui;
    social.moments = (Array.isArray(social.moments) ? social.moments : []).map(moment => {
        rememberMomentImage(moment);
        const next = clone(moment);
        // Generated pictures are a presentation cache, not a world fact. Keeping
        // data URLs inside every historical branch would recreate the storage leak
        // that long-memory deduplication just removed.
        next.imageUrl = '';
        return next;
    });
    return social;
}

function restoreSocialPresentation(currentValue, surfaceValue) {
    const current = currentValue && typeof currentValue === 'object' ? currentValue : {};
    const next = clone(surfaceValue && typeof surfaceValue === 'object' ? surfaceValue : {});
    if (current.imageSettings !== undefined) next.imageSettings = clone(current.imageSettings);
    if (current.ui !== undefined) next.ui = clone(current.ui);
    next.moments = (Array.isArray(next.moments) ? next.moments : []).map(moment => {
        const restored = clone(moment);
        const cachedImage = volatileMomentImages.get(momentImageCacheKey(restored));
        if (cachedImage) restored.imageUrl = cachedImage;
        return restored;
    });
    return next;
}

function emptyHistory() {
    return {
        version: SURFACE_VERSION,
        refs: {},
        blobs: {
            social: {},
            publicOpinion: {},
        },
    };
}

export function ensureBranchSurfaceHistory(store) {
    if (!store || typeof store !== 'object') return emptyHistory();
    const raw = store.branchSurfaceHistory;
    const history = raw && typeof raw === 'object' ? raw : emptyHistory();
    history.version = SURFACE_VERSION;
    history.refs = history.refs && typeof history.refs === 'object' ? history.refs : {};
    history.blobs = history.blobs && typeof history.blobs === 'object' ? history.blobs : {};
    history.blobs.social = history.blobs.social && typeof history.blobs.social === 'object'
        ? history.blobs.social
        : {};
    history.blobs.publicOpinion = history.blobs.publicOpinion && typeof history.blobs.publicOpinion === 'object'
        ? history.blobs.publicOpinion
        : {};
    store.branchSurfaceHistory = history;
    return history;
}

function intern(history, bucketName, value) {
    const bucket = history.blobs[bucketName];
    const text = JSON.stringify(value ?? {});
    const base = `${bucketName}:${hashText(text)}:${text.length}`;
    let key = base;
    let collision = 0;
    while (bucket[key] !== undefined) {
        if (JSON.stringify(bucket[key]) === text) return key;
        collision += 1;
        key = `${base}:${collision}`;
    }
    bucket[key] = clone(value ?? {});
    return key;
}

function garbageCollectBlobs(history) {
    const usedSocial = new Set();
    const usedOpinion = new Set();
    for (const ref of Object.values(history.refs)) {
        if (ref?.social) usedSocial.add(ref.social);
        if (ref?.publicOpinion) usedOpinion.add(ref.publicOpinion);
    }

    let changed = false;
    for (const key of Object.keys(history.blobs.social)) {
        if (usedSocial.has(key)) continue;
        delete history.blobs.social[key];
        changed = true;
    }
    for (const key of Object.keys(history.blobs.publicOpinion)) {
        if (usedOpinion.has(key)) continue;
        delete history.blobs.publicOpinion[key];
        changed = true;
    }
    return changed;
}

export function captureBranchSurface(store, rawSourceKey) {
    if (!store || typeof store !== 'object') return null;
    const history = ensureBranchSurfaceHistory(store);
    const key = sourceKey(rawSourceKey);
    const social = stripSocialPresentation(store.social);
    const publicOpinion = clone(store.publicOpinion && typeof store.publicOpinion === 'object'
        ? store.publicOpinion
        : {});
    history.refs[key] = {
        social: intern(history, 'social', social),
        publicOpinion: intern(history, 'publicOpinion', publicOpinion),
    };
    garbageCollectBlobs(history);
    return clone(history.refs[key]);
}

export function hasBranchSurface(store, rawSourceKey) {
    const history = ensureBranchSurfaceHistory(store);
    return Boolean(history.refs[sourceKey(rawSourceKey)]);
}

export function inheritBranchSurface(store, rawTargetKey, rawSourceKey, {
    fallbackSocial,
    fallbackPublicOpinion,
} = {}) {
    if (!store || typeof store !== 'object') return false;
    const history = ensureBranchSurfaceHistory(store);
    const targetKey = sourceKey(rawTargetKey);
    const parentKey = sourceKey(rawSourceKey);
    const parentRef = history.refs[parentKey];
    if (parentRef) {
        history.refs[targetKey] = clone(parentRef);
        garbageCollectBlobs(history);
        return true;
    }
    if (fallbackSocial !== undefined || fallbackPublicOpinion !== undefined) {
        const currentSocial = store.social;
        const currentOpinion = store.publicOpinion;
        if (fallbackSocial !== undefined) store.social = clone(fallbackSocial);
        if (fallbackPublicOpinion !== undefined) store.publicOpinion = clone(fallbackPublicOpinion);
        captureBranchSurface(store, targetKey);
        store.social = currentSocial;
        store.publicOpinion = currentOpinion;
        return true;
    }
    return false;
}

export function rebindBranchSurface(store, rawOldKey, rawNewKey) {
    if (!store || typeof store !== 'object') return false;
    const history = ensureBranchSurfaceHistory(store);
    const oldKey = sourceKey(rawOldKey);
    const newKey = sourceKey(rawNewKey);
    const ref = history.refs[oldKey];
    if (!ref) return false;
    history.refs[newKey] = clone(ref);
    garbageCollectBlobs(history);
    return true;
}

export function restoreBranchSurface(store, rawSourceKey, {
    fallbackSocial,
    fallbackPublicOpinion,
    seedFallback = true,
} = {}) {
    if (!store || typeof store !== 'object') return false;
    const history = ensureBranchSurfaceHistory(store);
    const key = sourceKey(rawSourceKey);
    const ref = history.refs[key];
    if (!ref) {
        if (fallbackSocial !== undefined) {
            store.social = restoreSocialPresentation(store.social, fallbackSocial);
        }
        if (fallbackPublicOpinion !== undefined) {
            store.publicOpinion = clone(fallbackPublicOpinion);
        }
        if (seedFallback && (fallbackSocial !== undefined || fallbackPublicOpinion !== undefined)) {
            captureBranchSurface(store, key);
        }
        return false;
    }

    const social = history.blobs.social[ref.social];
    const publicOpinion = history.blobs.publicOpinion[ref.publicOpinion];
    if (social !== undefined) {
        store.social = restoreSocialPresentation(store.social, social);
    } else if (fallbackSocial !== undefined) {
        store.social = restoreSocialPresentation(store.social, fallbackSocial);
    }
    if (publicOpinion !== undefined) {
        store.publicOpinion = clone(publicOpinion);
    } else if (fallbackPublicOpinion !== undefined) {
        store.publicOpinion = clone(fallbackPublicOpinion);
    }
    return social !== undefined || publicOpinion !== undefined;
}

export function pruneBranchSurfaceHistory(store, validSourceKeys = []) {
    if (!store || typeof store !== 'object') return false;
    const history = ensureBranchSurfaceHistory(store);
    const valid = new Set((Array.isArray(validSourceKeys) ? validSourceKeys : [])
        .map(sourceKey));
    valid.add('root');
    valid.add(branchSurfaceKeyFromState(store.currentState));

    let changed = false;
    for (const key of Object.keys(history.refs)) {
        if (valid.has(key)) continue;
        delete history.refs[key];
        changed = true;
    }
    return garbageCollectBlobs(history) || changed;
}

export function branchSurfaceHistoryStats(store) {
    const history = ensureBranchSurfaceHistory(store);
    return {
        refs: Object.keys(history.refs).length,
        socialBlobs: Object.keys(history.blobs.social).length,
        publicOpinionBlobs: Object.keys(history.blobs.publicOpinion).length,
        volatileMomentImages: volatileMomentImages.size,
    };
}
