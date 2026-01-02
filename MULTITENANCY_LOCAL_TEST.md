# 로컬 멀티테넌시 테스트 가이드

## 개요

로컬 개발 환경에서도 멀티테넌시를 테스트할 수 있습니다. 각 테넌트(고객사)는 독립적인 데이터베이스를 가지며, 데이터가 완전히 분리됩니다.

## 설정

`package.json`의 `[development]` 섹션에서 멀티테넌시가 활성화되어 있습니다:

```json
"multitenancy": {
  "app_url": "http://localhost:4004"
}
```

## 테넌트 데이터베이스

멀티테넌시가 활성화되면 각 테넌트마다 별도의 SQLite 파일이 생성됩니다:

- `db.sqlite` - 공통/공유 데이터베이스
- `db-t0.sqlite` - 테넌트 t0의 데이터베이스
- `db-t1.sqlite` - 테넌트 t1의 데이터베이스
- `db-t2.sqlite` - 테넌트 t2의 데이터베이스
- 등등...

## 테넌트 프로비저닝 (구독)

### 방법 1: API를 통한 프로비저닝

새로운 테넌트(고객사)를 구독하려면:

```bash
# 테넌트 t0 구독
curl -X POST "http://localhost:4004/-/cds/saas-provisioning/tenant/t0" \
  -H "Content-Type: application/json" \
  -d '{
    "subscribedTenantId": "t0",
    "subscribedSubdomain": "tenant-a",
    "eventType": "CREATE"
  }'

# 테넌트 t1 구독
curl -X POST "http://localhost:4004/-/cds/saas-provisioning/tenant/t1" \
  -H "Content-Type: application/json" \
  -d '{
    "subscribedTenantId": "t1",
    "subscribedSubdomain": "tenant-b",
    "eventType": "CREATE"
  }'
```

### 방법 2: 수동으로 데이터베이스 생성

```bash
# 테넌트 t0 데이터베이스 생성
cds deploy --to sqlite:db-t0.sqlite --tenant t0

# 테넌트 t1 데이터베이스 생성
cds deploy --to sqlite:db-t1.sqlite --tenant t1
```

## 테넌트별 API 호출

### HTTP 헤더로 테넌트 지정

```bash
# 테넌트 t0로 프로젝트 조회
curl "http://localhost:4004/odata/v4/project/Project" \
  -H "x-tenant-id: t0" \
  -u ADMIN:ADMIN

# 테넌트 t1로 프로젝트 조회
curl "http://localhost:4004/odata/v4/project/Project" \
  -H "x-tenant-id: t1" \
  -u ADMIN:ADMIN
```

### 쿼리 파라미터로 테넌트 지정

```bash
# 테넌트 t0로 프로젝트 조회
curl "http://localhost:4004/odata/v4/project/Project?tenant=t0" \
  -u ADMIN:ADMIN

# 테넌트 t1로 프로젝트 조회
curl "http://localhost:4004/odata/v4/project/Project?tenant=t1" \
  -u ADMIN:ADMIN
```

## 실제 시나리오 테스트

### 시나리오: A 고객사와 B 고객사가 각각 프로젝트 생성

**1. 테넌트 t0 (A 고객사) 구독**
```bash
curl -X POST "http://localhost:4004/-/cds/saas-provisioning/tenant/t0" \
  -H "Content-Type: application/json" \
  -d '{"subscribedTenantId": "t0", "subscribedSubdomain": "company-a", "eventType": "CREATE"}'
```

**2. 테넌트 t0에서 프로젝트 생성**
```bash
curl -X POST "http://localhost:4004/odata/v4/project/Project" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: t0" \
  -u ADMIN:ADMIN \
  -d '{
    "project_code": "A001",
    "name": "A 고객사 프로젝트",
    "status": "in_progress",
    "phase": "realize",
    "priority": "high",
    "health": "green"
  }'
```

**3. 테넌트 t1 (B 고객사) 구독**
```bash
curl -X POST "http://localhost:4004/-/cds/saas-provisioning/tenant/t1" \
  -H "Content-Type: application/json" \
  -d '{"subscribedTenantId": "t1", "subscribedSubdomain": "company-b", "eventType": "CREATE"}'
```

**4. 테넌트 t1에서 프로젝트 생성**
```bash
curl -X POST "http://localhost:4004/odata/v4/project/Project" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: t1" \
  -u ADMIN:ADMIN \
  -d '{
    "project_code": "B001",
    "name": "B 고객사 프로젝트",
    "status": "in_progress",
    "phase": "realize",
    "priority": "medium",
    "health": "green"
  }'
```

**5. 각 테넌트의 데이터 확인**

```bash
# A 고객사 (t0)의 프로젝트만 보임
curl "http://localhost:4004/odata/v4/project/Project" \
  -H "x-tenant-id: t0" \
  -u ADMIN:ADMIN

# B 고객사 (t1)의 프로젝트만 보임
curl "http://localhost:4004/odata/v4/project/Project" \
  -H "x-tenant-id: t1" \
  -u ADMIN:ADMIN
```

## 브라우저에서 테스트

브라우저에서는 직접 헤더를 설정할 수 없으므로, 개발자 도구의 Network 탭에서 확인하거나, Postman 같은 도구를 사용하세요.

### Postman 설정

1. **Headers 탭**에 추가:
   - Key: `x-tenant-id`
   - Value: `t0` (또는 `t1`, `t2` 등)

2. **Authorization 탭**:
   - Type: Basic Auth
   - Username: `ADMIN`
   - Password: `ADMIN`

## 데이터 분리 확인

각 테넌트는 완전히 독립적인 데이터를 가집니다:

- **테넌트 t0**: A 고객사의 프로젝트, 태스크, 마감 등
- **테넌트 t1**: B 고객사의 프로젝트, 태스크, 마감 등
- **테넌트 t2**: C 고객사의 프로젝트, 태스크, 마감 등

각 테넌트는 다른 테넌트의 데이터를 볼 수 없습니다.

## 주의사항

1. **테넌트 ID 형식**: 테넌트 ID는 보통 `t0`, `t1`, `t2` 형식이지만, 실제로는 UUID나 다른 형식도 가능합니다.

2. **데이터베이스 파일**: 각 테넌트마다 별도의 `.sqlite` 파일이 생성되므로, 테넌트가 많아지면 파일이 많아집니다.

3. **프로덕션 환경**: 프로덕션에서는 HANA 데이터베이스를 사용하며, 각 테넌트는 별도의 스키마를 가집니다.

## 문제 해결

### 테넌트가 인식되지 않는 경우

```bash
# 테넌트 목록 확인
curl "http://localhost:4004/-/cds/deployment/tenants" \
  -u ADMIN:ADMIN
```

### 테넌트 데이터베이스 재생성

```bash
# 특정 테넌트 데이터베이스 삭제 후 재생성
rm db-t0.sqlite
cds deploy --to sqlite:db-t0.sqlite --tenant t0
```

