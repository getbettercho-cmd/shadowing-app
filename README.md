# 섀도잉 루프

유튜브 영상 하나로 **추천 → 불러오기 → 자막 보며 전체 시청 → 문장별 자막 ON/OFF 두 번 듣고 따라하기 → 표현·연계 표현 정리**까지 하는 모바일 웹앱이에요.

## 화면 흐름

| 화면 | 하는 일 |
|---|---|
| 홈 | 주제별 추천(영어 자막이 직접 달린 영상만), 링크 붙여넣기, 이어서 하기 |
| 1 전체 보기 | 영상 재생 + 현재 문장 자막(영어/한국어), 문장 목록 탭하면 그 위치로 이동, 문장 수·단어 수·분당 속도 |
| 2 따라하기 | 문장 하나를 **자막 보고 듣기 → 따라 말하기 → 자막 없이 듣기 → 따라 말하기** 순서로 자동 진행. 속도 0.75/0.9/1x, 다음 문장 자동 시작, 내 목소리 녹음 후 원본과 비교, 문장 나누기·합치기 |
| 3 표현 | Claude가 자주 쓰는 표현, 패턴, 예문, 같이 쓰는 말, 연계 표현, 발음 포인트, 문장별 번역을 뽑아줘요. ☆로 저장하고 영어 플랫폼 형식(WORD/MEANING/PATTERN/...)으로 복사 |
| 내 표현 | 저장한 표현 모음. 전체 복사 |

학습 기록, 녹음, 저장한 표현은 **사용하는 기기 브라우저에 저장**돼요. 폰과 PC 기록은 따로예요.

## 배포 (GitHub + Vercel)

1. 이 폴더를 새 GitHub 저장소에 올려요.
   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<아이디>/shadowing-app.git
   git push -u origin main
   ```
2. Vercel에서 **Add New → Project**로 저장소를 가져와요. 설정은 기본값 그대로 두면 돼요.
3. **Settings → Environment Variables**에 키를 넣고 다시 배포해요. 둘 다 없어도 앱은 동작해요.

| 변수 | 없으면 | 발급 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 표현 탭이 '프롬프트 복사 → Claude/ChatGPT에 붙여넣기 → 답변 붙여넣기' 방식으로 동작 | console.anthropic.com → API Keys (사용량만큼 과금) |
| `YOUTUBE_API_KEY` | 추천 대신 유튜브 검색(자막 필터 켜짐) 링크로 열림 | Google Cloud Console → YouTube Data API v3 사용 설정 → 사용자 인증 정보 → API 키 (무료 할당량: 하루 약 100번 검색) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` 사용 | 다른 모델을 쓰고 싶을 때만 |

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 키 입력
npm run dev                  # http://localhost:3000
npm test                     # 자막 파싱·문장 분할·편집 테스트
```

## 알아둘 점

- **자막 자동 불러오기는 유튜브 비공식 경로**를 써요. 유튜브가 서버(Vercel) 요청을 막으면 실패할 수 있고, 그때는 화면에 '자막 붙여넣기'가 나와요. PC 유튜브에서 *더보기 → 스크립트 표시*로 복사해 붙여넣거나 SRT/VTT 내용을 붙여넣으면 돼요.
- 자동 생성 자막은 문장부호가 없어서 쉬는 구간과 길이로 문장을 나눠요. 어색하면 따라하기 탭의 **문장 나누기·합치기**로 고쳐요.
- 다른 쉐도잉 사이트 링크(예: shadowingenglish.com/…/제목-영상ID)를 붙여넣어도 같은 유튜브 영상이 열려요.
- 긴 영상은 표현 탭에서 40문장(약 3~5분)씩 구간을 골라 분석해요. 분석한 구간에는 ✓가 붙고 결과는 한 목록에 쌓여요.
- 녹음은 브라우저 마이크를 써요. 처음 누를 때 마이크 권한을 허용해 주세요. 아이폰 Safari에서도 동작해요.
- 아이폰에서는 첫 재생을 직접 눌러야 영상이 재생돼요. 그 뒤로는 자동으로 이어져요.

## 구조

```
app/page.tsx              홈 (추천, 링크, 이어서 하기)
app/study/[id]/page.tsx   학습 화면 (전체 보기 / 따라하기 / 표현)
app/saved/page.tsx        내 표현
app/api/transcript        유튜브 자막 → 문장
app/api/search            YouTube Data API 검색 (자막 있는 영상만)
app/api/analyze           Claude 표현·번역·발음 분석
lib/transcript.ts         자막 파싱(XML/srv3/json3/SRT/VTT/스크립트 복사본), 문장 분할
lib/edit.ts               문장 나누기·합치기
lib/prompt.ts             분석 프롬프트, 결과 파싱, 플랫폼 형식 변환
lib/useYouTube.ts         유튜브 플레이어, 구간 재생
lib/recordings.ts         녹음(IndexedDB)
lib/store.ts              학습 기록(localStorage)
```
