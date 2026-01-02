using {
    cuid,
    managed
} from '@sap/cds/common';
using { workhub.Project, workhub.User } from './Project';
using workhub.Effort from './Effort';

namespace workhub;

/** 태스크 상태 enum */
type TaskStatus : String(20) enum {
  todo;
  in_progress;
  review;
  done;
  blocked;
  cancelled;
};

/** 태스크 우선순위 enum */
type TaskPriority : String(10) enum {
  low;
  medium;
  high;
  critical;
};

/** 태스크 엔티티 */
entity Task : cuid, managed {
  project_id    : Association to Project;
  
  title         : String(200);
  description   : String(2000);
  
  status        : TaskStatus default 'todo';
  priority      : TaskPriority default 'medium';
  
  assignee      : Association to User;  // 담당자
  reporter      : Association to User;  // 보고자
  
  due_date      : Date;
  start_date    : Date;
  completed_at  : Timestamp;
  
  progress      : Integer default 0;    // 진행률 (0-100)
  estimated_hours : Decimal(5, 2);      // 예상 소요 시간
  actual_hours    : Decimal(5, 2);      // 실제 소요 시간
  
  tags          : String(500);         // 태그 (콤마 구분)
  note          : String(2000);

  // 🔹 이 태스크에 대한 공수 기록
  _Effort       : Composition of many Effort
                    on _Effort.task_id = $self;
}

