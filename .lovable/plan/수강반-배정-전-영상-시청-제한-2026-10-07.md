# 수강반 배정 전 영상 시청 제한

## 기준
- 학생·수강반별 시청 시작 시점 = 학습 현황 시작 영상 설정값, 없으면 가장 최근 배정 시각. 둘 다 없으면 제한 없음.
- 시작 시점보다 먼저 올라온 영상은 잠금. 단, 이미 시청 기록이 있는 영상은 계속 시청 가능.
- 학생만 적용(관리자·강사·교육원 관리자 영향 없음). 학습 현황 집계는 그대로 둠.

## 할 일
1. **데이터베이스**
   - 시작 시점 계산 함수 추가 (로그인 사용자·서버만 실행 가능).
   - 학생용 영상 조회 정책과 영상 접근 검사 함수에 잠금 조건(예외 포함) 추가 → 진도 저장·댓글·북마크도 함께 막힘.
2. **수강반 영상 목록**: 학생에게 잠긴 영상은 목록에 남기되 클릭 불가 카드로 표시 — 썸네일 자물쇠, "배정 이전 영상" 배지, "수강반 배정 전에 올라온 영상이라 시청할 수 없어요." 안내.
3. **영상 페이지**: 링크로 직접 들어오면 "시청할 수 없는 영상입니다. / 수강반에 배정되기 전에 올라온 영상이에요. 필요하면 담당 선생님께 문의해 주세요." 안내 (없는 영상 화면으로 보내지 않음).
4. **관리자 시작 영상 설정 영역**: "시청 가능 범위에도 적용됩니다" 안내 한 줄 추가.

## 확인
- 배정 이후 영상 정상 시청·진도 저장, 이전 영상 잠금(목록·직접 링크), 기존 시청 기록 예외, 시작 영상 변경 시 범위 변경, 관리자/강사 영향 없음.

## 기술 세부
- `public.student_video_start_at(_user_id, _class_id) returns timestamptz` SECURITY DEFINER, `search_path=public`, anon EXECUTE 회수.
- `videos` "Students view published videos in their classes" 정책 재생성: `created_at >= COALESCE(student_video_start_at(auth.uid(), class_id), '-infinity') OR EXISTS(video_progress 본인 기록)`.
- `can_access_video` 학생 분기에 동일 조건.
- `listClassVideos`: 학생이면 `is_locked` 계산(잠긴 영상은 관리자 클라이언트로 기본 정보만 조회해 목록 유지).
- 새 서버 함수 `getVideoLockStatus` (requireSupabaseAuth) → `video.$id.tsx`에서 조회 실패 시 잠금 여부 구분.
