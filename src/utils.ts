import { App, WorkspaceLeaf } from 'obsidian';

export function pickMostRecentLeaf(
    leaves: WorkspaceLeaf[],
    app: Pick<App, 'workspace'>,
): WorkspaceLeaf | null {
    if (leaves.length === 0) return null;

    const workspaceWithRecentLeaves = app.workspace as App['workspace'] & {
        getRecentLeaves?: () => WorkspaceLeaf[];
    };
    const recentLeaves = workspaceWithRecentLeaves.getRecentLeaves?.() ?? [];
    for (const recent of recentLeaves) {
        if (leaves.includes(recent)) return recent;
    }

    return leaves[0] ?? null;
}

export function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTriggerRegex(trigger: string): RegExp {
    if (trigger.length === 0) return /(?!)/;

    const escaped = escapeRegex(trigger);
    const first = escaped[0];
    return new RegExp(`${escaped}([^${first}\\s]*)$`);
}

export const ATTACHMENT_FOLDER = 'attachment';

const DISASSEMBLED_CONSONANTS: Record<string, string> = {
    ㄱ: 'ㄱ',
    ㄲ: 'ㄱㄱ',
    ㄳ: 'ㄱㅅ',
    ㄴ: 'ㄴ',
    ㄵ: 'ㄴㅈ',
    ㄶ: 'ㄴㅎ',
    ㄷ: 'ㄷ',
    ㄹ: 'ㄹ',
    ㄺ: 'ㄹㄱ',
    ㄻ: 'ㄹㅁ',
    ㄼ: 'ㄹㅂ',
    ㄽ: 'ㄹㅅ',
    ㄾ: 'ㄹㅌ',
    ㄿ: 'ㄹㅍ',
    ㅀ: 'ㄹㅎ',
    ㅁ: 'ㅁ',
    ㅂ: 'ㅂ',
    ㅄ: 'ㅂㅅ',
    ㅅ: 'ㅅ',
    ㅆ: 'ㅅㅅ',
    ㅇ: 'ㅇ',
    ㅈ: 'ㅈ',
    ㅊ: 'ㅊ',
    ㅋ: 'ㅋ',
    ㅌ: 'ㅌ',
    ㅍ: 'ㅍ',
    ㅎ: 'ㅎ',
};

const DISASSEMBLED_VOWELS: Record<string, string> = {
    ㅏ: 'ㅏ',
    ㅐ: 'ㅐ',
    ㅑ: 'ㅑ',
    ㅒ: 'ㅒ',
    ㅓ: 'ㅓ',
    ㅔ: 'ㅔ',
    ㅕ: 'ㅕ',
    ㅖ: 'ㅖ',
    ㅗ: 'ㅗ',
    ㅘ: 'ㅗㅏ',
    ㅙ: 'ㅗㅐ',
    ㅚ: 'ㅗㅣ',
    ㅛ: 'ㅛ',
    ㅜ: 'ㅜ',
    ㅝ: 'ㅜㅓ',
    ㅞ: 'ㅜㅔ',
    ㅟ: 'ㅜㅣ',
    ㅠ: 'ㅠ',
    ㅡ: 'ㅡ',
    ㅢ: 'ㅡㅣ',
    ㅣ: 'ㅣ',
};

const CHOSEONGS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNGSEONGS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONGSEONGS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const HANGUL_TO_QWERTY: Record<string, string> = {
    ㄱ: 'r', ㄲ: 'R', ㄴ: 's', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅁ: 'a', ㅂ: 'q', ㅃ: 'Q',
    ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w', ㅉ: 'W', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
    ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u', ㅖ: 'P',
    ㅗ: 'h', ㅛ: 'y', ㅜ: 'n', ㅠ: 'b', ㅡ: 'm', ㅣ: 'l',
};

const HANGUL_START = '가'.charCodeAt(0);
const HANGUL_END = '힣'.charCodeAt(0);

function disassemble(str: string): string {
    let result = '';

    for (const letter of str) {
        const code = letter.charCodeAt(0);
        if (code >= HANGUL_START && code <= HANGUL_END) {
            const offset = code - HANGUL_START;
            const jongseongIndex = offset % 28;
            const jungseongIndex = Math.floor(offset / 28) % 21;
            const choseongIndex = Math.floor(offset / 28 / 21);
            const choseong = CHOSEONGS[choseongIndex] ?? '';
            const jungseong = JUNGSEONGS[jungseongIndex] ?? '';
            const jongseong = JONGSEONGS[jongseongIndex] ?? '';
            result += choseong;
            result += DISASSEMBLED_VOWELS[jungseong] ?? jungseong;
            result += DISASSEMBLED_CONSONANTS[jongseong] ?? jongseong;
            continue;
        }

        if (letter in DISASSEMBLED_CONSONANTS) {
            result += DISASSEMBLED_CONSONANTS[letter] ?? letter;
            continue;
        }

        if (letter in DISASSEMBLED_VOWELS) {
            result += DISASSEMBLED_VOWELS[letter] ?? letter;
            continue;
        }

        result += letter;
    }

    return result;
}

export function convertHangulToQwerty(str: string): string {
    return disassemble(str)
        .split('')
        .map((ch) => HANGUL_TO_QWERTY[ch] ?? ch)
        .join('');
}
