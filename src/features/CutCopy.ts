import { Editor, Notice } from 'obsidian';
import { t } from '../locales';

export class CutCopyFeature {
    // 문서 전체를 복사하는 메서드
    async copyAll(editor: Editor) {
        // 현재 에디터의 전체 텍스트를 가져옴
        // editor.getValue()는 문서 전체 문자열을 반환
        await navigator.clipboard.writeText(editor.getValue());

        // 사용자에게 복사 완료 알림 표시
        new Notice(t('notice.entireDocumentCopied'));
    }

    // 문서 전체를 잘라내는 메서드 (전체 선택 + 복사 + 삭제와 동일한 동작)
    async cutAll(editor: Editor) {
        // 현재 문서의 전체 내용을 가져옴
        const content = editor.getValue();

        // 내용이 비어 있으면 아무 작업도 하지 않음
        if (!content) return;

        // 전체 내용을 클립보드에 복사
        await navigator.clipboard.writeText(content);

        // 문서 내용을 전부 비움
        editor.setValue("");

        // 사용자에게 잘라내기 완료 알림 표시
        new Notice(t('notice.entireDocumentCut'));
    }

    // 선택 영역이 있으면 해당 영역을,
    // 선택 영역이 없으면 현재 줄 전체를 대상으로 복사/잘라내기 처리
    async handleCutCopy(editor: Editor, isCut: boolean) {

        // 현재 선택된 텍스트가 있는지 확인
        const hasSelection = editor.getSelection().length > 0;

        // 선택 영역이 없다면
        if (!hasSelection) {
            // 현재 커서 위치를 가져옴
            const cursor = editor.getCursor();

            // 커서가 위치한 "한 줄 전체"를 선택 범위로 설정
            editor.setSelection(
                { line: cursor.line, ch: 0 }, // 줄의 시작
                { line: cursor.line, ch: editor.getLine(cursor.line).length } // 줄의 끝
            );
        }

        // 현재 선택된 텍스트를 가져옴
        const text = editor.getSelection();

        // 선택된 텍스트가 존재하면
        if (text) {

            // 해당 텍스트를 클립보드에 복사
            await navigator.clipboard.writeText(text);

            if (isCut) {
                // 잘라내기 모드라면 선택된 텍스트를 삭제
                editor.replaceSelection("");
            } else if (!hasSelection) {
                // 복사 모드이며, 원래 선택 영역이 없었던 경우
                // (즉, 자동으로 한 줄을 선택했던 경우)
                // 커서를 선택 영역의 끝으로 이동시켜 자연스럽게 정리
                editor.setCursor(editor.getCursor("to"));
            }
        }
    }
}
