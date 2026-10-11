import { getLanguage } from 'obsidian';
import { en, TranslationKey } from './en';
import { ko } from './ko';

type TranslationVariables = Record<string, string | number>;

const locale = getLanguage().toLowerCase().split('-')[0];
export const isKorean = locale === 'ko';
const translations: Record<TranslationKey, string> = isKorean ? ko : en;

export function t(key: TranslationKey, variables: TranslationVariables = {}): string {
    let text = translations[key];
    for (const name in variables) {
        text = text.split(`{{${name}}}`).join(String(variables[name]));
    }
    return text;
}
