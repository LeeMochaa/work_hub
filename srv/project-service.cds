using {workhub as WorkHubDB} from '../db/Project';

service ProjectService @(
    path: '/odata/v4/project',
    impl: './project-service.js',
    restrict: [{
        grant: '*',
        to: 'WorkHub_User'
    }]
) {

    /** ─────────────────────────────
     *  도메인 엔티티 전체 노출
     * ───────────────────────────── */

    @cds.redirection.target
    entity Project                as projection on WorkHubDB.Project;

    @cds.redirection.target
    entity ProjectMember          as projection on WorkHubDB.ProjectMember;

    @cds.redirection.target
    entity ProjectSchedule        as projection on WorkHubDB.ProjectSchedule;

    @cds.redirection.target
    entity ProjectNotice          as projection on WorkHubDB.ProjectNotice;

    @cds.redirection.target
    entity ProjectNoticeRecipient as projection on WorkHubDB.ProjectNoticeRecipient;

    @cds.redirection.target
    entity ProjectDocument        as projection on WorkHubDB.ProjectDocument;

    /** ─────────────────────────────
     *  UI용 Projection들
     * ───────────────────────────── */

    // 프로젝트 리스트용
    entity ProjectListView        as
        select from WorkHubDB.Project as P {
            key P.ID,
                P.project_code,
                P.name,
                P.status,
                P.phase,
                P.priority,
                P.health,

                P.pm.id         as pm_id,
                P.pm.name       as pm_name,
                P.lead.id       as lead_id,
                P.lead.name     as lead_name,

                P.createdAt,
                P.createdBy,
                P.modifiedAt,
                P.modifiedBy
        };

    /** ─────────────────────────────
     *  액션들
     * ───────────────────────────── */

    action CreateProjectFull(projectData: ProjectCreateInput,
                             members: many ProjectMemberInput,
                             schedules: many ProjectScheduleInput) returns Project;

    action CreateProjectNoticeFull(notice: ProjectNoticeInput,
                                   recipientIds: array of String(80)
                                   ) returns UUID;

    action UpdateProjectNoticeFull(ID: UUID,
                                   notice: ProjectNoticeInput,
                                   recipientIds: array of String(80),
                                   sendNotification: Boolean) returns UUID;
}

/** ─────────────────────────────
 *  액션 파라미터 타입 정의
 * ───────────────────────────── */

type ProjectCreateInput {
    project_code : String(4);
    name         : String(200);
    status       : WorkHubDB.ProjectStatus;
    phase        : WorkHubDB.ProjectPhase;
    priority     : WorkHubDB.ProjectPriority;
    health       : WorkHubDB.ProjectHealth;
    pm           : String(80);
    lead         : String(80);
    note         : String(2000);
}

type ProjectMemberInput {
    user         : String(80);
    is_active    : Boolean;
    project_role : String(40);
}

type ProjectScheduleInput {
    start_date  : Date;
    start_time  : Time;
    end_date    : Date;
    end_time    : Time;
    type        : WorkHubDB.ProjectScheduleType;
    title       : String(200);
    description : String(1000);
    status      : WorkHubDB.ProjectScheduleStatus;
    is_critical : Boolean;
}

type ProjectNoticeInput {
    project_id_ID : UUID;
    level         : WorkHubDB.ProjectNoticeLevel;
    title         : String(200);
    content       : String(4000);
    pinned        : Boolean;
    valid_from    : Date;
    valid_to      : Date;
}

