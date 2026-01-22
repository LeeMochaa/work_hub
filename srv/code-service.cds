using {workhub as WorkHubDB} from '../db/Code';

service CodeService @(
    path: '/odata/v4/code',
    restrict: [{
        grant: 'READ',
        to: 'authenticated-user'
    }]
) {
    @cds.redirection.target
    entity CodeGroup as projection on WorkHubDB.CodeGroup;
    
    @cds.redirection.target
    entity CodeItem as projection on WorkHubDB.CodeItem;
    
    entity ProjectRoleCode as projection on WorkHubDB.ProjectRoleCode;
}

