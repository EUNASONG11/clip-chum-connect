# 전체 소프트 삭제 전환 계획

기존 물리 삭제를 전 테이블 소프트 삭제로 바꾸고, 관리자 전용 "휴지통" 화면에서 복원/영구삭제할 수 있게 만듭니다. Vimeo 원본은 소프트 삭제 시 보존하고, 영구삭제(휴지통에서 삭제) 시에만 Vimeo API를 호출합니다.

## 1. DB 스키마 (마이그레이션 1건)

모든 대상 테이블에 공통 컬럼 추가:
- `deleted_at timestamptz NULL`
- `deleted_by uuid NULL`
- `WHERE deleted_at IS NULL` 부분 인덱스

대상 테이블:
- `videos`, `classes`, `class_folders`, `class_categories`
- `teams`, `team_members`, `team_messages`
- `comments`, `bookmarks`
- `class_students`, `class_instructors`
- `user_roles` (사용자 삭제 = 역할 소프트 삭제 + auth 계정은 보존)

RLS 정책 갱신:
- 모든 SELECT 정책에 `deleted_at IS NULL` 추가 (관리자용 별도 정책 예외)
- 관리자 전용 SELECT 정책 신설: `has_role(auth.uid(), 'admin') AND deleted_at IS NOT NULL` — 휴지통 조회용
- 기존 DELETE 정책은 유지(영구삭제용, 관리자만)

`class_enrollment_history` 트리거는 소프트 삭제도 'removed'로 기록하도록 UPDATE 트리거 추가.

## 2. 서버 함수 변경

### 소프트 삭제로 전환
- `deleteVideo` → `UPDATE videos SET deleted_at=now(), deleted_by=uid` (Vimeo 호출 제거)
- `deleteClass`, `deleteFolder`, `deleteCategory`
- `deleteTeam`, `removeTeamMember`
- `deleteComment`, `deleteBookmark`
- `unassignStudentFromClass`, `unassignInstructorFromClass`
- `deleteUser` → `user_roles.deleted_at` 세팅 (auth 계정 보존, 재활성화 가능)

### 신규 서버 함수 (관리자 전용, `requireSupabaseAuth` + admin 체크)
- `listTrash({ entity, page, search })` — 엔터티별 소프트삭제 목록
- `restoreItem({ entity, id })` — `deleted_at = NULL`
- `purgeItem({ entity, id })` — 실제 DELETE. `videos`인 경우에만 Vimeo API 호출

### 모든 조회 함수에 `WHERE deleted_at IS NULL` 추가
- `listVideos`, `listClasses`, `listFolders`, `listCategories`
- `listUsers`, `listTeams`, `getTeamMembers`
- `getComments`, `getBookmarks`
- `getClassStudents`, `getClassInstructors`
- `can_access_video` 함수도 갱신

## 3. UI

### 관리자 사이드바에 "휴지통" 메뉴 추가 (`/admin/trash`)
- 상단 탭: 영상 / 수강반 / 폴더 / 카테고리 / 팀 / 댓글·북마크 / 배정 / 사용자
- 각 탭: 이름·삭제자·삭제일 + `복원` / `영구 삭제` 버튼
- 페이지네이션(20개/페이지), 검색

### 기존 삭제 UX
- 확인 다이얼로그 문구를 "휴지통으로 이동" 으로 변경
- 성공 토스트에 "휴지통에서 복원할 수 있습니다" 안내

## 4. 기술 세부

- 관리 화면에서 소프트 삭제된 항목은 안 보이도록 서버측 필터링(클라 필터 X)
- 휴지통은 관리자 권한 필수 — `has_role` 체크
- 영상 영구 삭제 시 Vimeo 삭제 실패해도 DB는 삭제(경고 토스트)
- 사용자 소프트 삭제 시 로그인 차단: 로그인 시점에 `user_roles.deleted_at` 체크
- `class_enrollment_history`는 감사 로그이므로 소프트 삭제 대상 아님(현재도 삭제 불가 정책 유지)
- `external_students`는 마스터에서 미러링되는 명부라 기존 `is_deleted` 동작 유지

## 5. 작업 순서

1. 마이그레이션 실행 (컬럼/인덱스/RLS/트리거)
2. 조회 함수 필터 추가 + 삭제 함수 소프트로 전환
3. 휴지통 서버 함수 3종 신설
4. `/admin/trash` 라우트 및 UI 구현
5. 사이드바에 메뉴 추가
6. 로그인 로직에 `user_roles.deleted_at` 차단 추가
7. 타입체크 및 주요 삭제/복원 플로우 검증

승인해 주시면 마이그레이션부터 순차적으로 진행하겠습니다.