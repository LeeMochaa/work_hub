@(
  restrict: [{
    grant: ['READ'],
    to   : [ 'authenticated-user' ]
  }]
)
service AuthService @(
  path: '/odata/v4/auth',
  impl: './auth-service.js'
) {

  // 1) 내가 누구인지
  type MeInfo {
    id     : String(100);
    name   : String(120);
    tenant : String(120);
    email  : String(200);
    raw    : LargeString; // 디버그용(임시)
  }

  // 2) 내 역할/권한 (문자열 배열)
  type RoleList : array of String;

  // 2-1) 역할 플래그 집합
  type Who {
    SYSADMIN     : Boolean;
    ADMIN        : Boolean;
    LEADER       : Boolean;
    USER         : Boolean;
    AUTHENTICATED: Boolean;
  }

  // 3) 서버 시간/타임존
  type ServerClock {
    now      : Timestamp;
    timezone : String(80);
    iso      : String(40);
  }

  // 🔥 Bootstrap: 위 네 가지를 한 번에 묶어서 반환
  type BootstrapResult {
    user         : MeInfo;
    roles        : RoleList;
    flags        : Who;
    serverTime   : ServerClock;
    adminEmail   : String(200);  // Administrator 역할 사용자의 이메일
    isConfigured : Boolean;       // 테넌트 초기 설정 완료 여부
  }

  // === 엔드포인트들 ===

  // 한방 부트스트랩
  function Bootstrap() returns BootstrapResult;

  // (디버깅/개별 호출용) 예전 것들도 남겨둠
  function Me()         returns MeInfo;
  function MyRoles()    returns RoleList;
  function WhoAmI()     returns Who;
  function ServerTime() returns ServerClock;

  action   Ping()       returns String;

  function ResetSession() returns Boolean;
  
  type AccessRequestResult {
    ok             : Boolean;
    code           : String(30);
    message        : String(255);
    retryAfterDays : Integer;
  }

  action RequestAccessMail(email: String, name: String) returns AccessRequestResult;

  // 테넌트 초기 설정 제출
  type TenantConfigInput {
    companyName      : String(200);
    companyLogoUrl   : String(500);
    timezone         : String(80);
    language         : String(10);
    adminEmail       : String(200);  // ADMIN의 권한 요청 수신 이메일
    btpCockpitUrl    : String(500);   // BTP Cockpit URL (선택사항, 없으면 자동 생성)
  }

  type TenantConfigResult {
    ok      : Boolean;
    code    : String(30);
    message : String(255);
  }

  action SubmitTenantConfig(config: TenantConfigInput) returns TenantConfigResult;

  // 환경 설정 완료 처리 (HTML 반환)
  action SetEnvConfigured(tenant: String);

  // 로고 업로드
  type UploadLogoInput {
    logoBase64     : LargeString;  // base64 인코딩된 이미지 데이터
    logoContentType: String(100);  // image/png, image/jpeg 등
    logoFilename   : String(255);  // 원본 파일명
  }

  type UploadLogoResult {
    ok      : Boolean;
    code    : String(30);
    message : String(255);
    url     : String(500);
  }

  action UploadLogo(logo: UploadLogoInput) returns UploadLogoResult;

  // 로고 조회 (base64 data URI 반환)
  type GetLogoResult {
    ok          : Boolean;
    code        : String(30);
    message     : String(255);
    logoBase64  : LargeString;  // data URI 형태 (data:image/png;base64,...)
    contentType : String(100);
    filename    : String(255);
    modifiedAt  : String(40);
    useDefault  : Boolean;
  }

  function GetLogo() returns GetLogoResult;
}

