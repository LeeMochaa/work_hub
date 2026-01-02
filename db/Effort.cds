using {
  cuid,
  managed
} from '@sap/cds/common';
using { workhub.Project, workhub.User } from './Project';
using { workhub.Task } from './Task';

namespace workhub;

/** 공수 타입 enum */
type EffortType : String(20) enum {
  planned;    // 예상 공수
  actual;     // 실제 공수
  overtime;   // 초과 근무 공수
};

/** 공수 엔티티 */
entity Effort : cuid, managed {
  project_id    : Association to Project;  // 프로젝트 (선택적)
  task_id       : Association to Task;      // 태스크 (선택적)
  user          : Association to User;      // 작업자
  
  effort_date   : Date;                     // 공수 발생일
  effort_type   : EffortType default 'actual';
  
  hours         : Decimal(5, 2);           // 공수 시간
  description   : String(1000);            // 작업 내용 설명
  
  // 프로젝트별 공수 집계를 위한 필드
  project_phase : String(20);              // 프로젝트 단계
  work_category : String(100);             // 작업 카테고리
}

