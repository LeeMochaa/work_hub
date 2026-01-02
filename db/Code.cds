using { managed } from '@sap/cds/common';
namespace workhub;

/** 코드 그룹 엔티티 */
entity CodeGroup : managed {
    key group_code : String(40);
        name        : String(120);
        description : String(500);
        active      : Boolean default true;

    _CodeItem : Composition of many CodeItem
        on _CodeItem.group_code = $self.group_code;
}

/** 코드 아이템 엔티티 */
entity CodeItem : managed {
    key item_code  : String(40);
        group_code : String(40);
        name        : String(120);
        description : String(500);
        active      : Boolean default true;
        sortorder   : Integer default 0;

    _CodeGroup : Association to CodeGroup
        on _CodeGroup.group_code = group_code;
}

/** 프로젝트 롤 코드 프로젝션 */
entity ProjectRoleCode as projection on CodeItem
                        where group_code = 'PROJECT_ROLE';

