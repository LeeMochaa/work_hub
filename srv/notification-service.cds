using {workhub as WorkHubDB} from '../db/Notification';

service NotificationService @(
    path: '/odata/v4/notification'
) {
    entity Notification as projection on WorkHubDB.Notification;
}

