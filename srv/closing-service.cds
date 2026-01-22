using {workhub as WorkHubDB} from '../db/DailyClosing';
using {workhub as MonthlyClosingDB} from '../db/MonthlyClosing';

service ClosingService @(
    path: '/odata/v4/closing',
    impl: './closing-service.js',
    restrict: [{
        grant: '*',
        to: 'WorkHub_User'
    }]
) {

    @cds.redirection.target
    entity DailyClosing as projection on WorkHubDB.DailyClosing;

    @cds.redirection.target
    entity MonthlyClosing as projection on MonthlyClosingDB.MonthlyClosing;

    // 일별 마감 리스트용
    entity DailyClosingListView as
        select from WorkHubDB.DailyClosing as DC {
            key DC.ID,
                DC.closing_date,
                DC.status,
                DC.completion_rate,
                DC.worked_hours,
                DC.overtime_hours,
                DC.project_id as project_id,
                DC.project_id.name as project_name,
                DC.submitter.id as submitter_id,
                DC.submitter.name as submitter_name,
                DC.createdAt
        };

    // 월별 마감 리스트용
    entity MonthlyClosingListView as
        select from MonthlyClosingDB.MonthlyClosing as MC {
            key MC.ID,
                MC.closing_year,
                MC.closing_month,
                MC.status,
                MC.completion_rate,
                MC.total_worked_hours,
                MC.total_overtime_hours,
                MC.project_id as project_id,
                MC.project_id.name as project_name,
                MC.submitter.id as submitter_id,
                MC.submitter.name as submitter_name,
                MC.createdAt
        };

    action CreateDailyClosing(closingData: DailyClosingInput) returns DailyClosing;
    action SubmitDailyClosing(ID: UUID) returns DailyClosing;
    action ApproveDailyClosing(ID: UUID, approver_id: String(80)) returns DailyClosing;

    action CreateMonthlyClosing(closingData: MonthlyClosingInput) returns MonthlyClosing;
    action SubmitMonthlyClosing(ID: UUID) returns MonthlyClosing;
    action ApproveMonthlyClosing(ID: UUID, approver_id: String(80)) returns MonthlyClosing;
}

type DailyClosingInput {
    project_id_ID : UUID;              // 선택적 - null이면 프로젝트 외 직원
    closing_date  : Date;
    completed_tasks : String(2000);
    in_progress_tasks : String(2000);
    next_day_plan  : String(2000);
    issues         : String(2000);
    notes          : String(2000);
    worked_hours   : Decimal(5, 2);     // 작업 시간
    overtime_hours : Decimal(5, 2);     // 초과 근무 시간
    completion_rate : Decimal(5, 2);
    submitter_id   : String(80);
}

type MonthlyClosingInput {
    project_id_ID : UUID;              // 선택적 - null이면 프로젝트 외 직원
    closing_year  : Integer;
    closing_month  : Integer;
    summary       : String(4000);
    achievements  : String(2000);
    challenges    : String(2000);
    next_month_plan : String(2000);
    total_tasks   : Integer;
    completed_tasks : Integer;
    in_progress_tasks : Integer;
    total_worked_hours : Decimal(10, 2);  // 총 작업 시간
    total_overtime_hours : Decimal(10, 2); // 총 초과 근무 시간
    completion_rate : Decimal(5, 2);
    submitter_id   : String(80);
}

