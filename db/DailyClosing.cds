using {
    cuid,
    managed
} from '@sap/cds/common';
using { workhub.Project, workhub.User } from './Project';

namespace workhub;

/** 일별 마감 상태 enum */
type DailyClosingStatus : String(20) enum {
  draft;      // 작성 중
  submitted;  // 제출됨
  approved;   // 승인됨
  rejected;   // 반려됨
};

/** 일별 마감 엔티티 */
entity DailyClosing : cuid, managed {
  project_id    : Association to Project;  // 프로젝트 (선택적 - null이면 프로젝트 외 직원)
  
  closing_date  : Date;                // 마감일
  status        : DailyClosingStatus default 'draft';
  
  completed_tasks : String(2000);      // 완료한 업무/태스크
  in_progress_tasks : String(2000);    // 진행 중인 업무/태스크
  next_day_plan  : String(2000);       // 다음날 계획
  
  issues         : String(2000);       // 이슈/블로커
  notes          : String(2000);       // 기타 메모
  
  // 공수 정보
  worked_hours   : Decimal(5, 2);      // 작업 시간 (시간)
  overtime_hours : Decimal(5, 2);      // 초과 근무 시간
  
  submitter      : Association to User; // 제출자
  approver       : Association to User; // 승인자
  approved_at    : Timestamp;
  
  completion_rate : Decimal(5, 2);     // 일별 완료율 (0-100)
}

