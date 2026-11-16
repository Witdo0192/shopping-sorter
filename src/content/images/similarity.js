// Анализ изображений и группировка по сходству; кэш признаков остаётся общим.
// groupTilesByVisualSimilarity использует getTileKey из content.js при вызове.

// ─── Визуальное сравнение карточек (pHash + цветовая гистограмма) ─────────────

async function getImageDataFromSrc(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32; canvas.height = 32;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                resolve(ctx.getImageData(0, 0, 32, 32));
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function computePHash(imageData) {
    if (!imageData) return null;
    const { data } = imageData;
    const gray = new Float32Array(64);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            let sum = 0;
            for (let dr = 0; dr < 4; dr++) {
                for (let dc = 0; dc < 4; dc++) {
                    const px = ((r * 4 + dr) * 32 + (c * 4 + dc)) * 4;
                    sum += 0.299 * data[px] + 0.587 * data[px + 1] + 0.114 * data[px + 2];
                }
            }
            gray[r * 8 + c] = sum / 16;
        }
    }
    const avg = gray.reduce((a, b) => a + b, 0) / 64;
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
        if (gray[i] >= avg) hash |= (1n << BigInt(i));
    }
    return hash;
}

function computeColorHistogram(imageData) {
    if (!imageData) return null;
    const { data } = imageData;
    const hist = new Float32Array(48);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        hist[Math.floor(data[i] / 16)] += 1;
        hist[16 + Math.floor(data[i + 1] / 16)] += 1;
        hist[32 + Math.floor(data[i + 2] / 16)] += 1;
        count++;
    }
    if (count > 0) for (let i = 0; i < 48; i++) hist[i] /= count;
    return hist;
}

function hammingDistance(a, b) {
    if (a == null || b == null) return 64;
    let x = a ^ b, d = 0;
    while (x) { d += Number(x & 1n); x >>= 1n; }
    return d;
}

function histogramDistance(a, b) {
    if (!a || !b) return 1;
    let sum = 0;
    for (let i = 0; i < 48; i++) sum += Math.abs(a[i] - b[i]);
    return sum / 3;
}

function combinedSimilarity(fa, fb) {
    const hd = hammingDistance(fa.phash, fb.phash);
    const cd = histogramDistance(fa.hist, fb.hist);
    return 0.6 * (1 - hd / 64) + 0.4 * (1 - cd);
}

const _featureCache = new Map();

async function extractFeatures(key, src) {
    if (_featureCache.has(key)) return _featureCache.get(key);
    const imageData = await getImageDataFromSrc(src);
    const features = { phash: computePHash(imageData), hist: computeColorHistogram(imageData) };
    _featureCache.set(key, features);
    return features;
}

function clusterBySimilarity(items, threshold = 0.72) {
    const clusters = [], assigned = new Set();
    for (let i = 0; i < items.length; i++) {
        if (assigned.has(i)) continue;
        const cluster = [i];
        assigned.add(i);
        for (let j = i + 1; j < items.length; j++) {
            if (assigned.has(j)) continue;
            if (combinedSimilarity(items[i].features, items[j].features) >= threshold) {
                cluster.push(j);
                assigned.add(j);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

async function groupTilesByVisualSimilarity(tiles, getImgSrc) {
    const items = await Promise.all(tiles.map(async (tile, i) => {
        const src = getImgSrc(tile);
        const key = getTileKey(tile) || String(i);
        const features = src ? await extractFeatures(key, src) : { phash: null, hist: null };
        return { tile, features };
    }));
    const clusters = clusterBySimilarity(items);
    clusters.sort((a, b) => b.length - a.length);
    // возвращаем { tiles[], solo } — solo=true для одиночных
    return clusters.map(indices => ({
        tiles: indices.map(i => items[i].tile),
        solo: indices.length === 1
    }));
}
