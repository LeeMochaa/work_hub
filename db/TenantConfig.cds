using { managed } from '@sap/cds/common';
namespace workhub;

/** 테넌트 설정 (고객사별 초기 설정) */
entity TenantConfig : managed {
  key id              : String(80);  // 테넌트 ID 또는 고객사 식별자
      companyName      : String(200);  // 회사명
      companyLogoUrl   : String(500);  // 회사 로고 URL (선택)
      timezone         : String(80) default 'Asia/Seoul';  // 타임존
      language         : String(10) default 'ko';  // 기본 언어
      isConfigured     : Boolean default false;  // 설정 완료 여부
      adminEmail       : String(200);  // ADMIN 권한 요청 수신 이메일
      btpCockpitUrl    : String(500);  // BTP Cockpit URL (역할 설정용)
      
      // 추가 설정 (JSON 형태로 저장 가능)
      additionalConfig : LargeString;  // JSON 문자열
}

