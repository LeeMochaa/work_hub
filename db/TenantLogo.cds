using { managed } from '@sap/cds/common';
namespace workhub;

/** 테넌트별 회사 로고 (BLOB 저장) */
entity TenantLogo : managed {
  key id              : String(80);  // 테넌트 ID (TenantConfig.id와 동일)
      content          : LargeBinary;  // 로고 이미지 바이너리 데이터
      contentType      : String(100);  // MIME 타입 (예: image/png, image/jpeg)
      filename          : String(255);  // 원본 파일명
      size              : Integer;  // 파일 크기 (bytes)
}

