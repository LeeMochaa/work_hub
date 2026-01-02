using {
    cuid,
    managed
} from '@sap/cds/common';
using workhub.User from './User';

namespace workhub;

/** 알림 타입 enum */
type NotificationType : String(20) enum {
  project;
  task;
  notice;
  schedule;
  daily_closing;
  monthly_closing;
  system;
};

/** 알림 레벨 enum */
type NotificationLevel : String(10) enum {
  info;
  warning;
  error;
};

/** 알림 엔티티 */
entity Notification : cuid, managed {
  user_id          : Association to User;
  
  type             : NotificationType;
  level            : NotificationLevel default 'info';
  
  title            : String(200);
  message          : String(1000);
  
  is_read          : Boolean default false;
  read_at          : Timestamp;
  
  related_entity_type : String(50);   // 관련 엔티티 타입 (Project, Task 등)
  related_entity_id   : String(80);    // 관련 엔티티 ID
}

