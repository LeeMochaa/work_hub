using {workhub as WorkHubDB} from '../db/WorkStatus';

service WorkStatusService @(
    path: '/odata/v4/workstatus',
    impl: './workstatus-service.js'
) {

    @cds.redirection.target
    entity WorkStatus as projection on WorkHubDB.WorkStatus;

    // 작업 현황 리스트용
    entity WorkStatusListView as
        select from WorkHubDB.WorkStatus as WS {
            key WS.ID,
                WS.status_date,
                WS.status_type,
                WS.progress_rate,
                WS.completion_rate,
                WS.project_id as project_id,
                WS.project_id.name as project_name,
                WS.project_id.status as project_status,
                WS.total_tasks,
                WS.completed_tasks,
                WS.in_progress_tasks,
                WS.blocked_tasks,
                WS.planned_hours,
                WS.actual_hours,
                WS.remaining_hours,
                WS.reporter.id as reporter_id,
                WS.reporter.name as reporter_name,
                WS.createdAt,
                WS.modifiedAt
        };

    action CreateWorkStatus(statusData: WorkStatusInput) returns WorkStatus;
    action UpdateWorkStatus(ID: UUID, statusData: WorkStatusInput) returns WorkStatus;
    action GetLatestWorkStatus(project_id: UUID) returns WorkStatus;
}

type WorkStatusInput {
    project_id_ID : UUID;
    status_date   : Date;
    status_type   : WorkHubDB.WorkStatusType;
    total_tasks   : Integer;
    completed_tasks : Integer;
    in_progress_tasks : Integer;
    blocked_tasks : Integer;
    planned_hours : Decimal(10, 2);
    actual_hours  : Decimal(10, 2);
    remaining_hours : Decimal(10, 2);
    progress_rate : Decimal(5, 2);
    completion_rate : Decimal(5, 2);
    issues        : String(2000);
    risks         : String(2000);
    blockers      : String(2000);
    reporter_id   : String(80);
    note          : String(2000);
}

