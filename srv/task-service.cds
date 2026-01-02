using {workhub as WorkHubDB} from '../db/Task';

service TaskService @(
    path: '/odata/v4/task',
    impl: './task-service.js'
) {

    @cds.redirection.target
    entity Task as projection on WorkHubDB.Task;

    // 태스크 리스트용
    entity TaskListView as
        select from WorkHubDB.Task as T {
            key T.ID,
                T.title,
                T.status,
                T.priority,
                T.due_date,
                T.progress,
                T.project_id as project_id,
                T.assignee.id as assignee_id,
                T.assignee.name as assignee_name,
                T.reporter.id as reporter_id,
                T.reporter.name as reporter_name,
                T.createdAt,
                T.modifiedAt
        };

    action CreateTaskFull(taskData: TaskInput) returns Task;
    action UpdateTaskStatus(ID: UUID, status: WorkHubDB.TaskStatus) returns Task;
}

type TaskInput {
    project_id_ID : UUID;
    title         : String(200);
    description   : String(2000);
    status        : WorkHubDB.TaskStatus;
    priority      : WorkHubDB.TaskPriority;
    assignee_id   : String(80);
    reporter_id   : String(80);
    due_date      : Date;
    start_date    : Date;
    progress      : Integer;
    estimated_hours : Decimal(5, 2);
    tags          : String(500);
    note          : String(2000);
}

