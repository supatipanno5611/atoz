export type DiffSpanOp = 'same' | 'del' | 'add';
export type DiffBlockKind = 'same' | 'del' | 'add' | 'edit' | 'move';

export interface DiffSpan {
    op: DiffSpanOp;
    text: string;
}

export interface DiffBlock {
    kind: DiffBlockKind;
    spans: DiffSpan[];
}

type Op =
    | { t: 'same'; ai: number; bi: number }
    | { t: 'del'; ai: number }
    | { t: 'add'; bi: number };

interface WordToken {
    lead: string;
    word: string;
}

const PARAGRAPH_PAIR_THRESHOLD = 0.5;
const LINE_PAIR_THRESHOLD = 0.5;
const WORD_PAIR_THRESHOLD = 0.4;
const SYLLABLE_LIMIT = 2000;
const LCS_CELL_LIMIT = 4_000_000;
const PAIR_CANDIDATE_LIMIT = 400;
const RATIO_LCS_LIMIT = 10_000;
const MOVE_MIN_LENGTH = 8;

export function normalizeText(source: string): string {
    return source
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, (match) => (/^ {2,}$/.test(match) ? match : ''));
}

export function diffDocuments(before: string, after: string): DiffBlock[] {
    const a = splitParagraphs(normalizeText(before));
    const b = splitParagraphs(normalizeText(after));
    const ops = lcsOps(a, b, (value) => value);

    const moves = detectMoves(ops, a, b);
    const pairs = pairGlobally(ops, a, b, PARAGRAPH_PAIR_THRESHOLD, moves);

    const blocks: DiffBlock[] = [];
    for (const op of ops) {
        if (op.t === 'same') {
            blocks.push({ kind: 'same', spans: [{ op: 'same', text: b[op.bi]! }] });
            continue;
        }
        if (op.t === 'del') {
            if (moves.delToAdd.has(op.ai) || pairs.delToAdd.has(op.ai)) continue;
            blocks.push({ kind: 'del', spans: [{ op: 'del', text: a[op.ai]! }] });
            continue;
        }
        if (moves.addToDel.has(op.bi)) {
            blocks.push({ kind: 'move', spans: [{ op: 'same', text: b[op.bi]! }] });
            continue;
        }
        const pairedAi = pairs.addToDel.get(op.bi);
        if (pairedAi !== undefined) {
            blocks.push({ kind: 'edit', spans: refineParagraph(a[pairedAi]!, b[op.bi]!) });
            continue;
        }
        blocks.push({ kind: 'add', spans: [{ op: 'add', text: b[op.bi]! }] });
    }

    return blocks;
}

function splitParagraphs(source: string): string[] {
    return source.split(/\n[ \t]*\n+/).filter((paragraph) => paragraph.trim().length > 0);
}

function tokenizeWords(line: string): { tokens: WordToken[]; trailing: string } {
    const tokens: WordToken[] = [];
    const pattern = /(\s*)(\S+)/g;
    let match: RegExpExecArray | null;
    let end = 0;
    while ((match = pattern.exec(line)) !== null) {
        tokens.push({ lead: match[1]!, word: match[2]! });
        end = pattern.lastIndex;
    }
    return { tokens, trailing: line.slice(end) };
}

function lcsOps<T>(a: T[], b: T[], key: (value: T) => string): Op[] {
    const ka = a.map(key);
    const kb = b.map(key);
    const ops: Op[] = [];

    let head = 0;
    while (head < ka.length && head < kb.length && ka[head] === kb[head]) head++;
    let tail = 0;
    while (
        tail < ka.length - head &&
        tail < kb.length - head &&
        ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]
    ) tail++;

    for (let i = 0; i < head; i++) ops.push({ t: 'same', ai: i, bi: i });

    const n = ka.length - head - tail;
    const m = kb.length - head - tail;

    if (n * m > LCS_CELL_LIMIT) {
        for (let i = 0; i < n; i++) ops.push({ t: 'del', ai: head + i });
        for (let j = 0; j < m; j++) ops.push({ t: 'add', bi: head + j });
    } else {
        const width = m + 1;
        const dp = new Int32Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i * width + j] = ka[head + i] === kb[head + j]
                    ? dp[(i + 1) * width + (j + 1)]! + 1
                    : Math.max(dp[(i + 1) * width + j]!, dp[i * width + (j + 1)]!);
            }
        }

        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (ka[head + i] === kb[head + j]) {
                ops.push({ t: 'same', ai: head + i, bi: head + j });
                i++;
                j++;
            } else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
                ops.push({ t: 'del', ai: head + i });
                i++;
            } else {
                ops.push({ t: 'add', bi: head + j });
                j++;
            }
        }
        while (i < n) { ops.push({ t: 'del', ai: head + i }); i++; }
        while (j < m) { ops.push({ t: 'add', bi: head + j }); j++; }
    }

    for (let k = 0; k < tail; k++) {
        ops.push({ t: 'same', ai: ka.length - tail + k, bi: kb.length - tail + k });
    }

    return ops;
}

function lcsLength(a: string, b: string): number {
    const n = a.length;
    const m = b.length;
    let prev = new Int32Array(m + 1);
    let cur = new Int32Array(m + 1);

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            cur[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]! + 1
                : Math.max(prev[j]!, cur[j - 1]!);
        }
        const swap = prev;
        prev = cur;
        cur = swap;
    }

    return prev[m]!;
}

function diceSimilarity(a: string, b: string): number {
    if (a.length < 2 || b.length < 2) return 0;

    const counts = new Map<string, number>();
    for (let i = 0; i < a.length - 1; i++) {
        const gram = a.slice(i, i + 2);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }

    let hits = 0;
    for (let i = 0; i < b.length - 1; i++) {
        const gram = b.slice(i, i + 2);
        const remaining = counts.get(gram) ?? 0;
        if (remaining > 0) {
            counts.set(gram, remaining - 1);
            hits++;
        }
    }

    return (2 * hits) / (a.length - 1 + (b.length - 1));
}

function similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    if (a.length * b.length <= RATIO_LCS_LIMIT) {
        return (2 * lcsLength(a, b)) / (a.length + b.length);
    }
    return diceSimilarity(a, b);
}

interface Pairing {
    delToAdd: Map<number, number>;
    addToDel: Map<number, number>;
}

function emptyPairing(): Pairing {
    return { delToAdd: new Map(), addToDel: new Map() };
}

function detectMoves(ops: Op[], a: string[], b: string[]): Pairing {
    const pairing = emptyPairing();
    const delsByText = new Map<string, number[]>();
    const addsByText = new Map<string, number[]>();

    for (const op of ops) {
        if (op.t === 'del') {
            const list = delsByText.get(a[op.ai]!) ?? [];
            list.push(op.ai);
            delsByText.set(a[op.ai]!, list);
        } else if (op.t === 'add') {
            const list = addsByText.get(b[op.bi]!) ?? [];
            list.push(op.bi);
            addsByText.set(b[op.bi]!, list);
        }
    }

    for (const [text, dels] of delsByText) {
        const adds = addsByText.get(text);
        if (!adds || dels.length !== 1 || adds.length !== 1) continue;
        if (text.trim().length < MOVE_MIN_LENGTH) continue;
        pairing.delToAdd.set(dels[0]!, adds[0]!);
        pairing.addToDel.set(adds[0]!, dels[0]!);
    }

    return pairing;
}

function pairGlobally(
    ops: Op[],
    a: string[],
    b: string[],
    threshold: number,
    exclude: Pairing,
): Pairing {
    const pairing = emptyPairing();
    const dels: number[] = [];
    const adds: number[] = [];

    for (const op of ops) {
        if (op.t === 'del' && !exclude.delToAdd.has(op.ai)) dels.push(op.ai);
        else if (op.t === 'add' && !exclude.addToDel.has(op.bi)) adds.push(op.bi);
    }

    if (dels.length === 0 || adds.length === 0) return pairing;
    if (dels.length * adds.length > PAIR_CANDIDATE_LIMIT) return pairing;

    const candidates: { ai: number; bi: number; score: number }[] = [];
    for (const ai of dels) {
        for (const bi of adds) {
            const score = similarity(a[ai]!, b[bi]!);
            if (score >= threshold) candidates.push({ ai, bi, score });
        }
    }

    candidates.sort((x, y) => y.score - x.score);
    for (const candidate of candidates) {
        if (pairing.delToAdd.has(candidate.ai) || pairing.addToDel.has(candidate.bi)) continue;
        pairing.delToAdd.set(candidate.ai, candidate.bi);
        pairing.addToDel.set(candidate.bi, candidate.ai);
    }

    return pairing;
}

function pairAdjacentSingles(ops: Op[], a: WordToken[], b: WordToken[], threshold: number): Pairing {
    const pairing = emptyPairing();

    for (let i = 0; i < ops.length - 1; i++) {
        const del = ops[i]!;
        const add = ops[i + 1]!;
        if (del.t !== 'del' || add.t !== 'add') continue;
        if (ops[i - 1]?.t === 'del' || ops[i + 2]?.t === 'add') continue;
        if (similarity(a[del.ai]!.word, b[add.bi]!.word) < threshold) continue;
        pairing.delToAdd.set(del.ai, add.bi);
        pairing.addToDel.set(add.bi, del.ai);
    }

    return pairing;
}

function refineParagraph(before: string, after: string): DiffSpan[] {
    const aLines = before.split('\n');
    const bLines = after.split('\n');
    if (aLines.length === 1 && bLines.length === 1) return refineLine(before, after);

    const ops = lcsOps(aLines, bLines, (value) => value);
    const pairs = pairGlobally(ops, aLines, bLines, LINE_PAIR_THRESHOLD, emptyPairing());

    const spans: DiffSpan[] = [];
    let first = true;
    const separate = () => {
        if (!first) spans.push({ op: 'same', text: '\n' });
        first = false;
    };

    for (const op of ops) {
        if (op.t === 'same') {
            separate();
            spans.push({ op: 'same', text: bLines[op.bi]! });
            continue;
        }
        if (op.t === 'del') {
            if (pairs.delToAdd.has(op.ai)) continue;
            separate();
            spans.push({ op: 'del', text: aLines[op.ai]! });
            continue;
        }
        separate();
        const pairedAi = pairs.addToDel.get(op.bi);
        if (pairedAi !== undefined) spans.push(...refineLine(aLines[pairedAi]!, bLines[op.bi]!));
        else spans.push({ op: 'add', text: bLines[op.bi]! });
    }

    return mergeSpans(spans);
}

function refineLine(before: string, after: string): DiffSpan[] {
    const a = tokenizeWords(before);
    const b = tokenizeWords(after);
    const ops = lcsOps(a.tokens, b.tokens, (token) => token.word);
    const pairs = pairAdjacentSingles(ops, a.tokens, b.tokens, WORD_PAIR_THRESHOLD);

    const spans: DiffSpan[] = [];
    for (const op of ops) {
        if (op.t === 'same') {
            const token = b.tokens[op.bi]!;
            spans.push({ op: 'same', text: token.lead + token.word });
            continue;
        }
        if (op.t === 'del') {
            if (pairs.delToAdd.has(op.ai)) continue;
            const token = a.tokens[op.ai]!;
            spans.push({ op: 'del', text: token.lead + token.word });
            continue;
        }
        const token = b.tokens[op.bi]!;
        const pairedAi = pairs.addToDel.get(op.bi);
        if (pairedAi === undefined) {
            spans.push({ op: 'add', text: token.lead + token.word });
            continue;
        }
        spans.push({ op: 'same', text: token.lead });
        spans.push(...refineSyllables(a.tokens[pairedAi]!.word, token.word));
    }

    if (b.trailing) spans.push({ op: 'same', text: b.trailing });
    return mergeSpans(spans);
}

function refineSyllables(before: string, after: string): DiffSpan[] {
    if (before.length + after.length > SYLLABLE_LIMIT) {
        return [{ op: 'del', text: before }, { op: 'add', text: after }];
    }

    const a = [...before];
    const b = [...after];
    const ops = lcsOps(a, b, (value) => value);

    const spans: DiffSpan[] = [];
    for (const op of ops) {
        if (op.t === 'same') spans.push({ op: 'same', text: b[op.bi]! });
        else if (op.t === 'del') spans.push({ op: 'del', text: a[op.ai]! });
        else spans.push({ op: 'add', text: b[op.bi]! });
    }

    return mergeSpans(spans);
}

function mergeSpans(spans: DiffSpan[]): DiffSpan[] {
    const merged: DiffSpan[] = [];
    for (const span of spans) {
        if (span.text === '') continue;
        const last = merged[merged.length - 1];
        if (last && last.op === span.op) last.text += span.text;
        else merged.push({ ...span });
    }
    return merged;
}
