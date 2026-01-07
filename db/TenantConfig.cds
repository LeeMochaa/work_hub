using { managed } from '@sap/cds/common';
namespace workhub;

/** 테넌트 설정 (고객사별 초기 설정) */
entity TenantConfig : managed {
  key id                : String(80);  // tenant id

  companyName           : String(200);
  timezone              : String(80) default 'Asia/Seoul';
  language              : String(10) default 'ko';
  adminEmail            : String(200);
  btpCockpitUrl         : String(500);

  // ✅ 로고를 TenantConfig 안으로 합침 (BLOB)
  logoContent           : LargeBinary;
  logoContentType       : String(100);
  logoFilename          : String(255);
  logoSize              : Integer;

  isConfigured          : Boolean default false;
  additionalConfig      : LargeString;
}
