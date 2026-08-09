# a to z

`a to z`는 한국어 사용자의 Obsidian 작성 흐름을 빠르게 만들기 위한 개인용 플러그인입니다.

글을 쓰는 동안 자주 반복하는 편집 동작, Later 문장 보관, 게시용 frontmatter 준비, 주제어 관리, 유튜브/오디오 속성 입력, 조각글과 기호 입력을 명령어와 설정으로 묶어 둔 프로젝트입니다.

## 무엇을 해주나요?

이 플러그인은 크게 다섯 가지 일을 돕습니다.

| 영역 | 대표 기능 |
| --- | --- |
| 편집 보조 | 문서 전체 복사/잘라내기, 현재 행 복사/잘라내기, 단락 제거, 커서 이동, heading 이동, 선택 범위 확장 |
| 노트 정리 | 선택한 행을 원본별 Later 노트로 이동, 선택한 내용을 새 노트로 이동, 현재 파일 이동, 탭 정리 |
| 게시 준비 | 게시 노트 frontmatter 설정, `topics` 편집, `date` 삽입/갱신, 속성 정리 |
| 블로그용 미디어 속성 | `youtubeId`, `audioSrc`, `audioTitle` 삽입 |
| 입력 보조 | 조각글 추천, 기호 추천, 짝 기호 스마트 삭제 |

각 기능의 자세한 동작은 [기능 문서](#기능-문서)에서 볼 수 있습니다.

## 설치하기

이 저장소는 Obsidian 커뮤니티 플러그인 형태로 빌드됩니다.

### 직접 설치

1. 이 저장소를 내려받습니다.
2. 의존성을 설치합니다.

```bash
npm install
```

3. 플러그인을 빌드합니다.

```bash
npm run build
```

4. Obsidian vault 안에 플러그인 폴더를 만듭니다.

```text
<내 vault>/.obsidian/plugins/atoz/
```

5. 아래 세 파일을 그 폴더에 넣습니다.

```text
manifest.json
main.js
styles.css
```

6. Obsidian을 다시 불러온 뒤 `설정 > 커뮤니티 플러그인`에서 `a to z`를 켭니다.

`manifest.json` 기준 최소 Obsidian 버전은 `0.15.0`이고, 데스크톱 전용 플러그인은 아닙니다.

## 처음 설정하면 좋은 값

플러그인을 켠 뒤 `설정 > a to z`에서 필요한 값만 채우면 됩니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| 특정 마크다운 경로 | 비어 있음 | `특정 마크다운 파일 열기` 명령으로 열 파일입니다. 예: `index.md` |
| 커서 중앙 고정 사용 | 꺼짐 | 편집 중 커서를 화면 중앙 근처에 유지합니다. |
| 프로젝트 폴더 경로 | 비어 있음 | 게시 노트 설정과 프로젝트 폴더 숨김에 사용할 vault 기준 폴더입니다. 예: `_publish` |
| 조각글 트리거 문자 | `@` | 입력 중 조각글 추천을 여는 문자입니다. |
| 조각글 표시 개수 | `5` | 추천 목록에 보여줄 조각글 수입니다. |
| 조각글 목록 | 비어 있음 | 자주 쓰는 문구를 한 줄에 하나씩 저장합니다. |
| 기호 트리거 문자 | `~` | 기호 추천을 여는 문자입니다. |
| 기호 표시 개수 | `5` | 추천 목록에 보여줄 기호 수입니다. |
| 기호 목록 | 기본 기호 세트 | `id`, `symbol`, 선택적 `closing` 값을 가진 JSON 배열입니다. |
| 기호 쌍 | 기본 쌍 기호 | 스마트 Backspace로 함께 지울 여는/닫는 기호 쌍입니다. |
| 작업 문서 경로 | `work.md` | `작업 문서 열기` 명령으로 열 파일입니다. |

설정 화면의 `모든 설정 초기화`를 누르면 이 값들이 기본값으로 돌아갑니다.

## 자주 쓰는 흐름

### Later에 문장 보관

1. 일반 노트나 `work.md`에서 한 행 또는 여러 행을 선택합니다.
2. `선택한 행을 Later로 이동`을 실행합니다.
3. 내용이 `<원본명>_later.md`에 저장되고 원본에서 제거됩니다.
4. Later 사이드바에서 문장을 선택해 원본으로 다시 가져올 수 있습니다.

Later 노트는 `later: "[[원본 노트]]"` 속성으로 원본과 연결됩니다.

### 게시 노트 준비

`게시 노트 설정`은 설정의 `프로젝트 폴더 경로` 안에 있는 마크다운 파일에서만 동작합니다.

선택할 수 있는 게시 형식은 다음과 같습니다.

| 형식 | 기록되는 주요 속성 |
| --- | --- |
| 일반 게시글 | `date`, `topics` |
| 일상 게시글 | 파일을 `<projectPath>/ordinary/` 바로 아래로 이동한 뒤 `date`, `topics` |
| 목차 문서 | `type: index` |
| 시리즈 게시글 | `date`, `topics`, `parent`, `order` |

이미 게시 관련 속성이 있는 파일에서 실행하면 새 형식을 바로 덮어쓰지 않고 `초기화` 또는 `취소`를 먼저 고릅니다. 초기화하면 `date`, `topics`, `type`, `parent`, `order`를 제거하고 파일을 프로젝트 폴더 바로 아래로 되돌립니다.

`topics` 값 편집은 `게시 노트 설정`이 아니라 `주제어 편집` 명령에서 따로 합니다.

### frontmatter 정리

`속성을 형식에 맞게 정리`는 vault의 마크다운 파일을 훑으면서 게시용으로 허용된 속성만 남기도록 돕습니다.

허용 속성은 다음과 같습니다.

```yaml
date:
topics:
type:
parent:
order:
youtubeId:
audioSrc:
audioTitle:
```

빈 값인 비허용 속성은 자동으로 지우고, 값이 들어 있는 비허용 속성이나 오디오 속성 짝이 맞지 않는 파일은 검토할 수 있도록 새 탭으로 엽니다. `log.md`, 작업 문서, 보관 문서는 검사에서 제외됩니다.

### 조각글과 기호 입력

조각글은 기본적으로 `@` 뒤에 검색어를 입력해 사용합니다. 기존 조각글을 고르면 입력 범위가 해당 문구로 바뀌고, 새 문구는 추천 목록에서 바로 등록할 수 있습니다.

기호는 기본적으로 `~` 뒤에 기호 ID를 입력해 사용합니다. 닫는 문자가 있는 기호는 선택 영역을 감싸거나, 선택 영역이 없으면 쌍을 넣고 커서를 가운데에 둡니다. 짝 기호 사이에서 Backspace를 누르면 두 기호가 함께 지워집니다.

## 명령어 한눈에 보기

| 명령어 | 설명 |
| --- | --- |
| `특정 마크다운 파일 열기` | 설정한 파일을 메인 작업 영역에서 엽니다. |
| `커서 중앙 유지 토글` | 편집 중 커서를 화면 중앙 근처에 유지합니다. |
| `문서 전체 복사` | 현재 문서 전체를 클립보드에 복사합니다. |
| `문서 전체 잘라내기` | 현재 문서 전체를 클립보드에 복사한 뒤 문서를 비웁니다. |
| `복사하기` | 선택 영역을 복사하고, 선택이 없으면 현재 행을 복사합니다. |
| `잘라내기` | 선택 영역을 잘라내고, 선택이 없으면 현재 행을 잘라냅니다. |
| `내용을 잘라내어 새 노트 만들기` | 선택한 행 또는 문서 전체를 vault 루트의 새 노트로 이동합니다. |
| `탭 순환` | 메인 작업 영역의 다음 탭으로 이동합니다. |
| `단락 제거` | 현재 커서가 있는 행을 삭제합니다. |
| `메인 에디터에 포커스` | 메인 마크다운 에디터로 포커스를 되돌립니다. |
| `이전 heading으로 이동` | 현재 문서의 이전 heading으로 이동합니다. |
| `다음 heading으로 이동` | 현재 문서의 다음 heading으로 이동합니다. |
| `커서를 문서 끝으로 이동` | 문서 마지막 행의 끝으로 이동합니다. |
| `커서를 문서 시작으로 이동` | frontmatter 다음 줄 또는 문서 첫 줄로 이동합니다. |
| `커서를 행 시작으로 이동` | 현재 행의 시작으로 이동합니다. |
| `커서를 행 끝으로 이동` | 현재 행의 끝으로 이동합니다. |
| `프로젝트 폴더 숨김 토글` | 설정한 프로젝트 폴더를 파일 탐색기에서 숨기거나 표시합니다. |
| `모바일 툴바 숨김 토글` | 모바일 하단 툴바를 숨기거나 표시합니다. |
| `현재 파일 이동` | 현재 마크다운 파일을 vault 안의 다른 폴더로 이동합니다. |
| `게시 노트 설정` | 게시 형식에 맞게 frontmatter를 준비합니다. |
| `주제어 편집` | 현재 파일의 `topics` 값을 추가하거나 제거합니다. |
| `오늘 날짜 속성 삽입` | `date`가 없을 때만 오늘 날짜를 넣습니다. |
| `오늘 날짜로 갱신` | `date` 값을 오늘 날짜로 덮어씁니다. |
| `유튜브 속성 삽입` | YouTube URL 또는 ID에서 `youtubeId`를 저장합니다. |
| `오디오 속성 삽입` | `audioSrc`와 `audioTitle`을 저장합니다. |
| `속성을 형식에 맞게 정리` | frontmatter의 비허용 속성을 정리하고 검토 파일을 엽니다. |
| `선택 범위 행 시작까지 늘리기` | 선택 범위의 head를 행 시작까지 확장합니다. |
| `선택 범위 행 끝까지 늘리기` | 선택 범위의 head를 행 끝까지 확장합니다. |
| `작업 문서 열기` | 설정한 작업 문서를 엽니다. |
| `모든 탭 닫기` | 메인 작업 영역의 고정되지 않은 탭을 닫습니다. |
| `선택한 행을 Later로 이동` | 현재 행 또는 선택한 여러 행을 원본과 연결된 `<원본명>_later.md`로 이동합니다. |
| `Later 사이드바 열기` | 현재 노트에 연결된 Later 문장을 오른쪽 사이드바에 표시합니다. |
| `사이드바 이전 항목 선택` | 선택된 클립보드 또는 Later 사이드바의 이전 항목을 선택합니다. |
| `사이드바 다음 항목 선택` | 선택된 클립보드 또는 Later 사이드바의 다음 항목을 선택합니다. |
| `사이드바 선택 항목 가져오기` | 선택된 클립보드 또는 Later 항목을 원본 편집기로 가져옵니다. |
| `Later 연결 정리` | 한 원본을 가리키는 여러 Later 노트 중 하나만 연결 상태로 유지합니다. |

리본 아이콘으로는 `작업 문서 열기`, `프로젝트 폴더 숨김 토글`, `모바일 툴바 숨김 토글`, `클립보드 사이드바 열기`, `Later 사이드바 열기`를 바로 실행할 수 있습니다.

## 기능 문서

더 자세한 설명은 기능별 문서를 참고하세요.

| 문서 | 내용 |
| --- | --- |
| [certain-md.md](docs/certain-md.md) | 특정 마크다운 파일 열기 |
| [cursor-center.md](docs/cursor-center.md) | 커서 중앙 유지 |
| [cut-copy.md](docs/cut-copy.md) | 복사와 잘라내기 |
| [cut-create-new-md.md](docs/cut-create-new-md.md) | 내용을 잘라내어 새 노트 만들기 |
| [cycle-tab.md](docs/cycle-tab.md) | 탭 순환 |
| [delete-paragraph.md](docs/delete-paragraph.md) | 단락 제거 |
| [focus-root-leaf.md](docs/focus-root-leaf.md) | 메인 에디터에 포커스 |
| [heading-navigation.md](docs/heading-navigation.md) | heading 이동 |
| [move-cursor.md](docs/move-cursor.md) | 커서 이동 |
| [move-current-file.md](docs/move-current-file.md) | 현재 파일 이동 |
| [selection.md](docs/selection.md) | 선택 범위 확장 |
| [work.md](docs/work.md) | 작업 문서와 보관 문서 |
| [later-sidebar.md](docs/later-sidebar.md) | 원본별 Later 노트와 사이드바 |
| [publish-note.md](docs/publish-note.md) | 게시 노트 설정 |
| [edit-topics.md](docs/edit-topics.md) | 주제어 편집 |
| [date-property.md](docs/date-property.md) | 날짜 속성 |
| [lint-properties.md](docs/lint-properties.md) | 속성 정리 |
| [youtube-properties.md](docs/youtube-properties.md) | 유튜브 속성 삽입 |
| [audio-properties.md](docs/audio-properties.md) | 오디오 속성 삽입 |
| [project-visibility.md](docs/project-visibility.md) | 프로젝트 폴더 숨김 토글 |
| [mobile-toolbar.md](docs/mobile-toolbar.md) | 모바일 툴바 숨김 토글 |
| [snippets.md](docs/snippets.md) | 조각글 제안 |
| [symbols.md](docs/symbols.md) | 기호 제안과 스마트 삭제 |

## 개발하기

주요 소스는 `src/`에 있고, 빌드 결과는 루트의 `main.js`로 생성됩니다.

```bash
npm run dev
```

개발 모드입니다. `src/main.ts`를 entry point로 esbuild watch를 실행하고, sourcemap을 포함한 `main.js`를 만듭니다.

```bash
npm run build
```

배포용 빌드입니다. TypeScript 타입 검사를 먼저 실행한 뒤 production bundle을 만듭니다.

```bash
npm run lint
```

ESLint와 Obsidian 플러그인 권장 규칙으로 코드를 검사합니다.

```bash
npm run version
```

`version-bump.mjs`를 실행하고 `manifest.json`, `versions.json`을 git stage에 올립니다.

## 프로젝트 구조

```text
.
├── manifest.json        # Obsidian 플러그인 메타데이터
├── main.js              # esbuild가 만든 번들 파일
├── styles.css           # 설정 화면과 모바일/프로젝트 표시 제어 스타일
├── src/
│   ├── main.ts          # 플러그인 로딩, 명령어 등록, 이벤트 등록
│   ├── setting.ts       # 설정 탭
│   ├── types.ts         # 설정 타입과 기본값
│   ├── utils.ts         # 공통 유틸리티
│   └── features/        # 기능별 구현
└── docs/                # 기능별 사용자 문서
```

## 참고

게시 노트, 유튜브 속성, 오디오 속성, 프로젝트 폴더 숨김 기능은 [블로그 템플릿](https://github.com/supatipanno5611/vercel-blog-template)과 함께 쓰기 위해 만들어진 흐름입니다. 특히 `projectPath`, `date`, `topics`, `type`, `parent`, `order`, `youtubeId`, `audioSrc`, `audioTitle`은 블로그용 frontmatter와 맞물려 있으므로 값을 바꿀 때는 실제 게시 저장소의 규칙도 함께 확인하는 것이 좋습니다.
