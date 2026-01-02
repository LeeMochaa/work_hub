using {
  cuid,
  managed
} from '@sap/cds/common';
using { workhub.Project, workhub.User } from './Project';
using { workhub.Task } from './Task';

namespace workhub;

/** 작업 현황 상태 enum */
type WorkStatusType : String(20) enum {
  on_track;      // 정상 진행
  at_risk;       // 위험
  delayed;       // 지연
  blocked;       // 차단됨
  completed;     // 완료
};

/** 작업 현황 엔티티 */
entity WorkStatus : cuid, managed {
  project_id    : Association to Project;  // 프로젝트
  
  status_date   : Date;                     // 현황 기준일
  status_type   : WorkStatusType default 'on_track';
  
  // 진행률 정보
  total_tasks   : Integer default 0;       // 전체 태스크 수
  completed_tasks : Integer default 0;     // 완료된 태스크 수
  in_progress_tasks : Integer default 0;   // 진행 중 태스크 수
  blocked_tasks : Integer default 0;       // 차단된 태스크 수
  
  // 공수 정보
  planned_hours : Decimal(10, 2) default 0;  // 예상 공수
  actual_hours  : Decimal(10, 2) default 0;  // 실제 공수
  remaining_hours : Decimal(10, 2) default 0; // 잔여 공수
  
  // 진행률
  progress_rate : Decimal(5, 2) default 0;   // 진행률 (0-100)
  completion_rate : Decimal(5, 2) default 0;  // 완료율 (0-100)
  
  // 이슈 및 리스크
  issues        : String(2000);            // 이슈 사항
  risks         : String(2000);            // 리스크 사항
  blockers      : String(2000);            // 블로커 사항
  
  // 보고자 정보
  reporter      : Association to User;     // 보고자
  note          : String(2000);            // 기타 메모
}

