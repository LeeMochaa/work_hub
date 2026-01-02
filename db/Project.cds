using {
  cuid,
  managed
} from '@sap/cds/common';
using workhub.User from './User';
using {
  workhub.ProjectRoleCode
} from './Code';
using workhub.Task from './Task';
using workhub.DailyClosing from './DailyClosing';
using workhub.MonthlyClosing from './MonthlyClosing';
using workhub.Effort from './Effort';
using workhub.WorkStatus from './WorkStatus';

namespace workhub;

/** ─────────────────────────────
 * 프로젝트 공통 enum들
 * ───────────────────────────── */
type ProjectStatus         : String(20) enum {
  planned;
  in_progress;
  testing;
  stabilization;
  completed;
  on_hold;
  cancelled;
};

type ProjectPhase          : String(20) enum {
  discover;
  prepare;
  explore;
  realize;
  deploy;
  run;
};

type ProjectPriority       : String(10) enum {
  low;
  medium;
  high;
  critical;
};

type ProjectHealth         : String(10) enum {
  green;
  amber;
  red;
};

/** ─────────────────────────────
 * Project 엔티티
 * ───────────────────────────── */
entity Project : cuid, managed {
  project_code     : String(4) @assert.unique;
  name             : String(200);
  status           : ProjectStatus;
  phase            : ProjectPhase;
  priority         : ProjectPriority;
  health           : ProjectHealth;

  pm               : Association to User; // PM
  lead             : Association to User; // 프로젝트 리드
  note             : String(2000);

  // 🔹 이 프로젝트에 속한 멤버들
  _ProjectMember   : Composition of many ProjectMember
                       on _ProjectMember.project_id = $self;

  // 🔹 이 프로젝트에 속한 태스크들
  _Task            : Composition of many Task
                       on _Task.project_id = $self;

  // 🔹 이 프로젝트에 속한 일정들
  _ProjectSchedule : Composition of many ProjectSchedule
                       on _ProjectSchedule.project_id = $self;

  // 🔹 이 프로젝트의 공지들
  _ProjectNotice   : Composition of many ProjectNotice
                       on _ProjectNotice.project_id = $self;

  // 🔹 프로젝트 전체 공통 문서
  _ProjectDocument : Composition of many ProjectDocument
                       on _ProjectDocument.project_id = $self;

  // 🔹 일별 마감
  _DailyClosing    : Composition of many DailyClosing
                       on _DailyClosing.project_id = $self;

  // 🔹 월별 마감
  _MonthlyClosing  : Composition of many MonthlyClosing
                       on _MonthlyClosing.project_id = $self;

  // 🔹 공수 관리
  _Effort          : Composition of many Effort
                       on _Effort.project_id = $self;

  // 🔹 작업 현황
  _WorkStatus      : Composition of many WorkStatus
                       on _WorkStatus.project_id = $self;
}

/** ─────────────────────────────
 * 프로젝트 멤버
 * ───────────────────────────── */
entity ProjectMember : cuid, managed {
  project_id           : Association to Project;
  user                 : Association to User;

  project_role         : Association to ProjectRoleCode;

  is_active            : Boolean default true;
}

/** ─────────────────────────────
 * Project 일정
 * ───────────────────────────── */
type ProjectScheduleType   : String(20) enum {
  milestone;
  meeting;
  deployment;
  workshop;
  freeze;
  daily;      // 일별 일정
  monthly;    // 월별 일정
  other;
};

type ProjectScheduleStatus : String(20) enum {
  planned;
  confirmed;
  done;
  cancelled;
};

entity ProjectSchedule : cuid, managed {
  project_id  : Association to Project;

  start_date  : Date;
  start_time  : Time;
  end_date    : Date;
  end_time    : Time;

  type        : ProjectScheduleType;
  title       : String(200);
  description : String(1000);

  status      : ProjectScheduleStatus default 'planned';
  is_critical : Boolean default false;
}

/** ─────────────────────────────
 * Project 공지
 * ───────────────────────────── */
type ProjectNoticeLevel    : String(10) enum {
  info;
  warning;
  critical;
};

entity ProjectNotice : cuid, managed {
  project_id              : Association to Project;

  level                   : ProjectNoticeLevel default 'info';
  title                   : String(200);
  content                 : String(4000);

  pinned                  : Boolean default false;
  valid_from              : Date;
  valid_to                : Date;

  // 🔹 수신자 목록
  _ProjectNoticeRecipient : Composition of many ProjectNoticeRecipient
                              on _ProjectNoticeRecipient.project_notice_id = $self;
}

/** 공지 수신자 */
entity ProjectNoticeRecipient : cuid, managed {
  project_notice_id : Association to ProjectNotice;
  user              : Association to User;

  is_read           : Boolean default false;
  read_at           : Timestamp;
}

/** ─────────────────────────────
 * 프로젝트 문서
 * ───────────────────────────── */
type ProjectDocumentType   : String(20) enum {
  arch;
  interface_list;
  process_overview;
  guideline;
  meeting_minutes;
  artifact;
  other;
};

type ProjectDocumentStatus : String(20) enum {
  draft;
  published;
  archived;
};

entity ProjectDocument : cuid, managed {
  project_id  : Association to Project;

  title       : String(200);
  description : String(1000);

  doc_type    : ProjectDocumentType;
  status      : ProjectDocumentStatus default 'draft';

  owner       : Association to User;
  author      : Association to User;
}

