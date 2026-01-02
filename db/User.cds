using { managed } from '@sap/cds/common';
namespace workhub;

/** User 상태 enum */
type UserStatus : String(10) enum {
    NONE;
    REQUESTED;
    ACTIVE;
    DEACTIVE;
    COLDDOWN;
}

/** WorkHub User */
entity User : managed {
    key id              : String(80);
        name            : String(120);
        email           : String(200);
        dept            : String(120);
        role            : String(20);
        user_status     : UserStatus default 'NONE';
        lastRequestedAt : Timestamp;
}

