using {workhub as WorkHubDB} from '../db/Effort';

service EffortService @(
    path: '/odata/v4/effort',
    impl: './effort-service.js'
) {

    @cds.redirection.target
    entity Effort as projection on WorkHubDB.Effort;

    // 공수 리스트용 (프로젝트별)
    entity EffortByProject as
        select from WorkHubDB.Effort as E {
            key E.ID,
                E.effort_date,
                E.effort_type,
                E.hours,
                E.description,
                E.project_id as project_id,
                E.project_id.name as project_name,
                E.task_id as task_id,
                E.task_id.title as task_title,
                E.user.id as user_id,
                E.user.name as user_name,
                E.createdAt,
                E.modifiedAt
        };

    // 공수 리스트용 (사용자별)
    entity EffortByUser as
        select from WorkHubDB.Effort as E {
            key E.ID,
                E.effort_date,
                E.effort_type,
                E.hours,
                E.description,
                E.project_id as project_id,
                E.project_id.name as project_name,
                E.task_id as task_id,
                E.task_id.title as task_title,
                E.user.id as user_id,
                E.user.name as user_name,
                E.createdAt,
                E.modifiedAt
        };

    // 공수 집계용 (프로젝트별 일별 집계)
    entity EffortSummaryByProject as
        select from WorkHubDB.Effort as E {
            key E.project_id as project_id,
                E.project_id.name as project_name,
                E.effort_date,
                sum(E.hours) as total_hours : Decimal(10, 2),
                count(E.ID) as effort_count : Integer
        }
        group by E.project_id, E.project_id.name, E.effort_date;

    // 공수 집계용 (사용자별 일별 집계)
    entity EffortSummaryByUser as
        select from WorkHubDB.Effort as E {
            key E.user.id as user_id,
                E.user.name as user_name,
                E.effort_date,
                sum(E.hours) as total_hours : Decimal(10, 2),
                count(E.ID) as effort_count : Integer
        }
        group by E.user.id, E.user.name, E.effort_date;

    action CreateEffort(effortData: EffortInput) returns Effort;
    action UpdateEffort(ID: UUID, effortData: EffortInput) returns Effort;
    action GetEffortSummary(project_id: UUID, start_date: Date, end_date: Date) returns EffortSummaryResult;
}

type EffortInput {
    project_id_ID : UUID;
    task_id_ID    : UUID;
    user_id       : String(80);
    effort_date   : Date;
    effort_type   : WorkHubDB.EffortType;
    hours         : Decimal(5, 2);
    description   : String(1000);
    project_phase : String(20);
    work_category : String(100);
}

type EffortSummaryResult {
    project_id    : UUID;
    project_name  : String(200);
    start_date    : Date;
    end_date      : Date;
    total_planned_hours : Decimal(10, 2);
    total_actual_hours  : Decimal(10, 2);
    total_overtime_hours : Decimal(10, 2);
    effort_count  : Integer;
}

