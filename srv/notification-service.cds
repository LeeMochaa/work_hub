using {workhub as WorkHubDB} from '../db/Notification';

service NotificationService @(
    path: '/odata/v4/notification',
    restrict: [{
        grant: '*',
        to: 'authenticated-user'
    }]
) {
    entity Notification as projection on WorkHubDB.Notification;
}

