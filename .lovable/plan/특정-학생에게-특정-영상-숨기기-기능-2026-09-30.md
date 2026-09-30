# 특정 학생에게 특정 영상 숨기기 기능

## 목표
수강반에 배정된 학생 중 일부에게만 특정 영상이 보이지 않게 하고, 숨긴 영상은 그 학생의 학습 현황(시청률) 계산에서도 제외한다.

## 결정된 사항 (사용자 확인 완료)
- 숨긴 영상은 해당 학생의 학습 현황 계산에서도 제외 → 나머지 영상만 다 보면 100%
- 설정 위치: 수강반 상세(학생별) + 영상 관리(영상별) 양쪽

## 구현 계획

### 1. DB: 숨김 설정 테이블 추가
- 새 테이블 `video_student_exclusions`
  - `id uuid PK`, `video_id uuid → videos.id`, `user_id uuid`, `created_by uuid`, `created_at`, `deleted_at`(소프트 삭제, 기존 패턴과 동일)
  - `UNIQUE(video_id, user_id)` (삭제된 행 제외는 부분 유니크 인덱스로 처리)
- GRANT(authenticated, service_role) + RLS 활성화
- 정책:
  - 학생 본인 읽기 허용(본인 숨김 여부 확인용, 선택 사항)
  - 조회/추가/해제: 최고 관리자 또는 해당 영상의 수강반에 접근 가능한 강사(`instructor_can_access_class` 재사용)

### 2. 접근 차단: `can_access_video` 함수 수정
- 학생 역할 분기에 "video_student_exclusions에 (video_id, user_id) 활성 행이 없어야 함" 조건 추가
- 관리자·강사는 기존대로 모두 열람 가능(숨김은 학생에게만 적용)

### 3. 학생 화면에서 숨김 영상 제외
- 수강반 영상 목록 조회(`class.$id.tsx` 계열)에서 RLS가 자동으로 걸러주므로 별도 필터 없이 목록·재생 모두 차단되는지 확인, 필요 시 쿼리에 제외 조건 추가
- 숨긴 영상의 기존 시청 기록(video_progress)은 삭제하지 않고 보존(나중에 해제하면 복구)

### 4. 학습 현황 계산에서 제외
- `class_student_stats_agg`, `class_student_stats_agg_range`: cells 생성 시 해당 학생에게 숨겨진 영상 제외 → 그 학생 기준으로만 100% 달성 가능
- `class_stats_agg`, `overview_stats_agg`(수강반/전체 요약): 학생마다 분모가 달라지므로 정확한 합산이 어려움 → 요약 수치는 기존 방식 유지(필수 폴더 영상 기준), 학생 개별 상세 화면에서만 제외 반영. 학생별 평균 시청률은 개별 기준으로 계산됨
- 문자 발송 대상 선정(`listClassStudentsForMessaging`)의 진도 계산도 학생별 숨김 영상 제외 적용 여부 확인 후 동일 기준 적용

### 5. 설정 UI (두 곳)
- **수강반 상세 → 학생 학습 현황 상세**(`admin.classes.$id.tsx`의 StudentVideoDetail): 각 영상 행에 "이 학생에게 숨기기/다시 보이기" 토글 버튼 추가 (숨긴 영상은 회색 처리 + "숨김" 뱃지)
- **영상 관리**(`admin.videos.tsx` 또는 수강반 영상 목록): 영상별 "숨긴 학생 관리" 다이얼로그 — 해당 수강반 배정 학생 목록에서 체크로 숨김 지정/해제
- 서버 함수: `setVideoExclusion({videoId, userId, hidden})`, `listVideoExclusions(videoId)` — `requireSupabaseAuth` + 관리자/해당 수강반 강사 검증

### 6. 검증
- `bunx tsc --noEmit` 통과
- 테스트 계정으로: 숨김 설정 → 학생 화면에서 영상 안 보임·재생 차단·현황 100% 가능 확인, 해제 시 복구 확인

## 기술 참고
- 새 테이블은 기존 소프트 삭제 패턴(deleted_at)과 GRANT+RLS 규칙을 그대로 따름
- `can_access_video`는 SECURITY DEFINER라 RLS 재귀 문제 없음
- 외부 과제(주차) 완료 판정은 공개 영상 기준이라 이번 변경 영향 없음(숨김 영상은 학생이 어차피 못 보므로, 주차 완료 판정에서도 제외할지는 별도 결정 사항 — 기본은 유지)
