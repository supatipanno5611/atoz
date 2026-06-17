import type ATOZPlugin from '../main';
import { Editor, MarkdownView, MarkdownFileInfo, HeadingCache } from 'obsidian';

export class HeadingNavigaterFeature {
    constructor(private plugin: ATOZPlugin) {}

    moveHeading(editor: Editor, view: MarkdownView | MarkdownFileInfo, direction: 'prev' | 'next') {
        const file = view.file;
        if (!file) return;

        // 캐시된 메타데이터에서 헤딩 리스트 가져오기
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const headings = cache?.headings;

        // 예외 처리: 헤딩이 없는 경우
        if (!headings || headings.length === 0) return;

        const currentLine = editor.getCursor().line;
        let targetHeading: HeadingCache | undefined;

        if (direction === 'prev') {
            // [로직] 이전 헤딩 찾기: 현재 줄보다 위(번호가 작은) 헤딩 중 가장 마지막 것
            for (let i = headings.length - 1; i >= 0; i--) {
				const heading = headings[i];
                if (heading && heading.position.start.line < currentLine) {
                    targetHeading = headings[i];
                    break;
                }
            }
            // 찾지 못한 경우(첫 번째 헤딩이거나 그 위일 때) -> 첫 번째 헤딩으로 고정
            if (!targetHeading) targetHeading = headings[0];

        } else {
            // [로직] 다음 헤딩 찾기: 현재 줄보다 아래(번호가 큰) 첫 번째 헤딩
            for (let i = 0; i < headings.length; i++) {
				const heading = headings[i];
                if (heading && heading.position.start.line > currentLine) {
                    targetHeading = headings[i];
                    break;
                }
            }
            // 찾지 못한 경우(마지막 헤딩이거나 그 아래일 때) -> 마지막 헤딩으로 고정
            if (!targetHeading) targetHeading = headings[headings.length - 1];
        }

        // 실제 이동 실행
        if (targetHeading) {
            const targetLine = targetHeading.position.start.line;

            // 커서를 해당 줄의 맨 앞으로 이동 {line: 줄번호, ch: 글자위치}
            editor.setCursor({ line: targetLine, ch: 0 });

            // 해당 위치가 화면 밖이면 스크롤하여 중앙에 맞춤
            editor.scrollIntoView({
                from: { line: targetLine, ch: 0 },
                to: { line: targetLine, ch: 0 }
            }, true);
        }
    }
}
