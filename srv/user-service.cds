using {workhub as WorkHubDB} from '../db/User';

service UserService @(
    path: '/odata/v4/user'
) {
    entity User as projection on WorkHubDB.User;
}

