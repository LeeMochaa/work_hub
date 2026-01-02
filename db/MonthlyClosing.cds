using {
    cuid,
    managed
} from '@sap/cds/common';
using { workhub.Project, workhub.User } from './Project';

namespace workhub;

/** 월별 마감 상태 enum */
type MonthlyClosingStatus : String(20) enum {
  draft;      // 작성 중
  submitted;  // 제출됨
  approved;   // 승인됨
  rejected;   // 반려됨
};

/** 월별 마감 엔티티 */
entity MonthlyClosing : cuid, managed {
  project_id    : Association to Project;  // 프로젝트 (선택적 - null이면 프로젝트 외 직원)
  
  closing_year  : Integer;             // 마감 년도
  closing_month  : Integer;            // 마감 월 (1-12)
  status        : MonthlyClosingStatus default 'draft';
  
  summary       : String(4000);        // 월별 요약
  achievements  : String(2000);        // 주요 성과
  challenges    : String(2000);        // 주요 도전과제
  next_month_plan : String(2000);      // 다음달 계획
  
  total_tasks   : Integer;             // 총 태스크 수
  completed_tasks : Integer;           // 완료된 태스크 수
  in_progress_tasks : Integer;         // 진행 중 태스크 수
  
  // 공수 정보
  total_worked_hours : Decimal(10, 2);  // 총 작업 시간
  total_overtime_hours : Decimal(10, 2); // 총 초과 근무 시간
  
  completion_rate : Decimal(5, 2);    // 월별 완료율 (0-100)
  
  submitter      : Association to User; // 제출자
  approver       : Association to User; // 승인자
  approved_at    : Timestamp;
}

