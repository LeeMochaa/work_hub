// srv/user-service.js
const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
  const User = cds.entities['User'];
  const { SELECT, INSERT, UPDATE } = cds.ql;

  /**
   * XSUAA 롤에서 대표 롤 뽑기
   * - SYSADMIN > Administrator > Leader > User 우선순위
   */
  function pickPrimaryRole(reqUser) {
    if (!reqUser || typeof reqUser.is !== 'function') return null;
    const is = (r) => reqUser.is(r);

    if (is('SYSADMIN')) return 'SYSADMIN';
    if (is('Administrator')) return 'Administrator';
    if (is('Leader')) return 'Leader';
    if (is('User')) return 'User';
    return null;
  }

  /**
   * 1) XSUAA / Auth 정보로부터 User UPSERT
   *    - 존재하지 않으면 INSERT
   *    - 존재하면 name / email / role 정도만 업데이트
   *    - user_status 는 DEACTIVE/COLDDOWN 은 건드리지 않음
   */
  this.ensureUserFromReq = async (req, extra = {}) => {
    const tx   = cds.transaction(req);
    const u    = req.user || {};
    const attr = u.attr || {};

    const id =
      u.id ||
      u.name ||
      attr.user_name ||
      attr.ID ||
      'anonymous';

    const gn = attr.givenName || attr.given_name;
    const fn = attr.familyName || attr.family_name;

    let display = (gn || fn) ? [fn, gn].filter(Boolean).join('') : null;
    if (!display) display = attr.display_name || attr.name || id;

    const email         = attr.email || id;
    const primaryRole   = pickPrimaryRole(u);
    const hasWorkHubRole = !!primaryRole;

    // dept 는 여기서 자동 세팅 안 함 (관리자 입력용)
    const dept = extra.dept || null;

    // 🔍 1) 기존 유저 조회
    const existing = await tx.run(
      SELECT.one.from(User).where({ id: String(id) })
    );

    if (existing) {
      // 기본 패치: 이름/메일 정도만 갱신
      const patch = {
        name: display
      };

      // role 변경 필요하면 업데이트
      if (primaryRole && primaryRole !== existing.role) {
        patch.role = primaryRole;
      }

      // user_status 자동 승격 로직
      let nextStatus = existing.user_status;

      if (hasWorkHubRole) {
        // 관리자가 BTP에서 롤 줘서 돌아온 케이스:
        // NONE / REQUESTED 였으면 ACTIVE로 승격
        if (
          existing.user_status === 'NONE' ||
          existing.user_status === 'REQUESTED'
        ) {
          nextStatus = 'ACTIVE';
        }
        // DEACTIVE / COLDDOWN 은 자동으로 풀지 않음
      }

      if (nextStatus !== existing.user_status) {
        patch.user_status = nextStatus;
      }

      if (Object.keys(patch).length > 0) {
        await tx.run(
          UPDATE(User)
            .set(patch)
            .where({ id: String(id) })
        );
      }

      return { ...existing, ...patch };
    }

    // 🆕 2) 신규 유저 → 생성
    const newUser = {
      id   : String(id),
      name : display,
      dept,
      role       : primaryRole,
      user_status: hasWorkHubRole ? 'ACTIVE' : 'NONE',
    };

    await tx.run(INSERT.into(User).entries(newUser));
    return newUser;
  };

  /**
   * 2) 권한 요청 쿨다운 체크 & 상태 업데이트
   *    - lastRequestedAt 기준으로 COOLDOWN_DAYS(기본 30일) 제한
   *    - 통과하면 user_status='REQUESTED', lastRequestedAt=now 로 업데이트
   *    - 막히면 ok:false + 메시지 반환
   */
  this.checkAccessRequestCooldown = async (req, options = {}) => {
    const tx = cds.transaction(req);
    const COOLDOWN_DAYS = options.cooldownDays ?? 30;

    // ensureUserFromReq: 로그인한 유저 정보 DB에 반영
    const user = await this.ensureUserFromReq(req);
    if (!user || !user.id) {
      return {
        ok     : false,
        code   : 'NO_USER',
        message: 'WorkHub 사용자 정보를 찾을 수 없습니다. 다시 로그인 후 시도해 주세요.'
      };
    }

    const now = new Date();

    // 🔎 마지막 요청 시각 (없으면 쿨다운 없음)
    if (user.lastRequestedAt) {
      const last    = new Date(user.lastRequestedAt);
      const diffMs  = now - last;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < COOLDOWN_DAYS) {
        const retryAfter = Math.ceil(COOLDOWN_DAYS - diffDays);
        return {
          ok            : false,
          code          : 'COOLDOWN',
          message       : `이미 권한을 요청한 계정입니다. ${retryAfter}일 후에 다시 요청할 수 있습니다.`,
          retryAfterDays: retryAfter,
          user
        };
      }
    }

    // 🔓 쿨다운 통과 → 상태를 REQUESTED + lastRequestedAt 갱신
    await tx.run(
      UPDATE(User)
        .set({
          user_status    : 'REQUESTED',
          lastRequestedAt: now
        })
        .where({ id: String(user.id) })
    );

    return {
      ok            : true,
      code          : 'OK',
      message       : '권한 요청 가능',
      retryAfterDays: COOLDOWN_DAYS,
      user: {
        ...user,
        user_status    : 'REQUESTED',
        lastRequestedAt: now.toISOString()
      }
    };
  };
});

