# 이재식국어 영상 플랫폼 – MVP 구현 계획

기획서(13번 제외)를 기반으로, 현재 이미 구축된 부분과 추가할 부분을 정리한 뒤 **4개 페이즈**로 나눠 진행합니다. 13번 논의 사항은 아래처럼 합리적인 기본값으로 가정하고 진행합니다.

## 0. 기본 가정 (13번 제외 → 기본값)
- **역할**: 현행 유지(`admin`, `student`). 강사(instructor)/최고관리자 분리는 제외.
- **수강반 생성 권한**: `admin`만.
- **Vimeo 계정**: 중앙 계정 1개 + 기존 `VIMEO_ACCESS_TOKEN` 사용.
- **업로드 방식**: 현행 브라우저 → Vimeo 직접 TUS 업로드 유지.
- **상태 동기화**: webhook 없이 **관리자 수동 새로고침 + 재생 페이지 진입 시 폴링** (이미 `refreshVideoStatus` 존재).
- **완료 기준**: 시청률 **90% 이상 또는 `ended` 이벤트** 발생 시 완료.
- **Vimeo 공개 정책**: `unlisted` + embed public (현행 유지).
- **댓글 공개 범위**: 같은 수강반 학생 + 관리자 전원.
- **YouTube 병행**: 이미 구현되어 있으므로 그대로 유지 (수강반 매핑도 동일 적용).

## 1. 현재 상태 요약
- ✅ 로그인/역할(`admin`,`student`), 관리자 사이드바 레이아웃
- ✅ Vimeo TUS 업로드 + YouTube 링크 등록, 영상 목록/삭제/상태 새로고침
- ✅ 사용자 목록 및 관리자 권한 부여/회수
- ❌ 수강반, 학생 배정, 영상↔수강반 매핑, `is_published`, 노출순서
- ❌ 시청률·이어보기·완료 판정, 최근 본 영상
- ❌ 댓글, 북마크
- ❌ 관리자 대시보드(집계)

---

## 페이즈 1 · 수강반과 영상 노출 제어

**DB 마이그레이션**
- `classes` (수강반): id, name, description, created_by, created_at
- `class_students` (배정): class_id, user_id, PK(class_id,user_id)
- `videos`에 컬럼 추가: `class_id uuid null`, `is_published boolean default false`, `sort_order int default 0`, `completion_ratio numeric default 0.9`
- 모든 신규 테이블에 RLS + `GRANT`:
  - `classes`, `class_students`: 관리자 전체, 학생은 본인 배정된 반만 SELECT
  - `videos` SELECT 정책 갱신:  
    (관리자) 전체 / (학생) `is_published=true AND status='ready' AND (class_id IS NULL OR 본인이 배정된 반)`

**서버 함수 (`src/lib/classes.functions.ts`)**
- `listClasses`, `createClass`, `updateClass`, `deleteClass` (admin)
- `listClassStudents`, `assignStudent(email)`, `unassignStudent(userId)` (admin)
- `listMyClasses` (student)

**관리자 UI 추가**
- 사이드바 항목 "수강반" 추가 → `/admin/classes`, `/admin/classes/$id`
- `/admin/upload`, `/admin/videos`에 **수강반 선택 · 공개 여부 · 노출 순서** 필드 추가
- 등록된 영상 목록에서 공개 토글 / 순서 변경

**학생 UI**
- 홈(`/`)을 "내 수강반 그리드 → 반 클릭 시 영상 목록"으로 재구성
- 반 미배정 학생에게는 안내 문구

## 페이즈 2 · 재생 · 시청률 · 이어보기

**DB**
- `video_progress`: user_id, video_id, current_seconds, max_seconds, duration, watched_ratio, is_completed, completed_at, updated_at, PK(user_id, video_id) — RLS: 본인만 CRUD, 관리자 SELECT

**서버 함수 (`src/lib/progress.functions.ts`)**
- `getMyProgress(videoId)`
- `upsertMyProgress({videoId, currentSeconds, duration})` — 서버에서 `watched_ratio`, `is_completed` 계산
- `listRecentlyWatched(limit)` (사이드바용)

**재생 페이지(`/video/$id`) 개편**
- `@vimeo/player` SDK 도입 (Vimeo)  
  - `loaded` 시 저장된 위치로 `setCurrentTime`
  - `timeupdate` 스로틀(5초) → `upsertMyProgress`
  - `pause`/`ended` 시 즉시 저장
- YouTube: `YT.Player` API로 동일 이벤트 수집
- 우측/하단에 **최근 본 영상 5개** 리스트 (`listRecentlyWatched`)
- 진도바(수강완료 여부 뱃지) 표시

## 페이즈 3 · 댓글 · 북마크

**DB**
- `comments`: id, video_id, user_id, body, created_at, updated_at  
  RLS: 작성자만 UPDATE/DELETE, 같은 수강반 학생 + 관리자 SELECT, 학생은 본인 접근 가능한 영상에만 INSERT
- `bookmarks`: user_id, video_id, seconds, note, created_at, PK(user_id,video_id,seconds) — 본인 전용

**서버 함수**
- `listComments(videoId)`, `addComment`, `deleteComment`
- `listMyBookmarks(videoId?)`, `addBookmark(videoId, seconds, note)`, `deleteBookmark`

**UI**
- 재생 페이지 하단 탭: 댓글 / 북마크
- 북마크는 현재 재생 위치 자동 캡처(Player `getCurrentTime`), 클릭 시 해당 초로 seek

## 페이즈 4 · 관리자 대시보드

**서버 함수 (`src/lib/stats.functions.ts`, admin 전용)**
- 총 학생 수, 수강반 수, 영상 수, 최근 7일 시청 인원
- 수강반별 평균 완료율 / 학생별 완료 영상 수
- 영상별 시청자 수, 평균 시청률, 완료 인원

**UI (`/admin`)**
- KPI 카드 + 수강반/영상 별 테이블 + 최근 활동 로그
- 사이드바 첫 진입을 `/admin/upload` → `/admin` (대시보드)로 변경

---

## 기술 세부 사항

### 라이브러리
- `@vimeo/player` (SDK) 신규 설치
- YouTube는 별도 패키지 없이 `<iframe enablejsapi=1>` + `window.YT` 사용

### 시청률 계산 규칙
- 서버에서 `watched_ratio = max_seconds / duration`
- `is_completed = watched_ratio >= completion_ratio (기본 0.9) OR ended 이벤트`
- 되감기로 인한 하락 방지를 위해 `max_seconds`는 **단조 증가**만 저장

### RLS/권한 요약
- 학생 영상 목록: `is_published AND status='ready' AND 배정된 반` 정책 하나로 통제  
  기존 코드의 `.eq('status','ready')` 클라이언트 필터는 유지하되, 정책이 실제 방어선
- 서버 함수 두 종류만 사용
  - 학생/공용: `requireSupabaseAuth` → RLS 통과
  - 관리자 전용: `requireSupabaseAuth` + `assertAdmin` 후에만 `supabaseAdmin` 로드

### 마이그레이션 순서 규칙
매 테이블마다 `CREATE TABLE → GRANT(authenticated, service_role) → ENABLE RLS → CREATE POLICY` 4단계를 지킵니다.

### 라우트 구조 추가
```text
src/routes/
  admin.index.tsx           → 대시보드로 변경 (페이즈 4)
  admin.classes.tsx         → 수강반 목록
  admin.classes.$id.tsx     → 수강반 상세(학생 배정, 영상 매핑)
  index.tsx                 → 학생: 내 수강반 그리드
  class.$id.tsx             → 학생: 반별 영상 목록
  video.$id.tsx             → SDK 기반 재생 + 진도/댓글/북마크
```

---

## 진행 방식 제안
페이즈 1을 먼저 완료하고 동작을 확인한 뒤 페이즈 2 → 3 → 4로 진행합니다. 승인 주시면 **페이즈 1부터 착수**합니다.
