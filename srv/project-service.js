const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const {
    Project,
    ProjectMember,
    ProjectSchedule,
    ProjectNotice,
    ProjectNoticeRecipient
  } = this.entities;

  const { uuid } = cds.utils;
  const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

  this.on('CreateProjectFull', async (req) => {
    const {
      projectData,
      members = [],
      schedules = []
    } = req.data || {};

    if (!projectData?.project_code || !projectData?.name) {
      return req.error(400, 'project_code와 name은 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      // project_code 중복 체크
      const duplicated = await tx.run(
        SELECT.one.from(Project).where({ project_code: projectData.project_code })
      );
      if (duplicated) {
        return req.error(400, `이미 존재하는 프로젝트 코드입니다: ${projectData.project_code}`);
      }

      // Project INSERT
      const projectId = uuid();

      await tx.run(
        INSERT.into(Project).entries({
          ID: projectId,
          project_code: projectData.project_code,
          name: projectData.name,
          status: projectData.status,
          phase: projectData.phase,
          priority: projectData.priority,
          health: projectData.health,
          note: projectData.note || null,
          pm_id: projectData.pm || null,
          lead_id: projectData.lead || null
        })
      );

      // ProjectMember INSERT
      if (members.length) {
        const memberEntries = members.map((m) => ({
          project_id_ID: projectId,
          user_id: m.user,
          is_active: m.is_active ?? true,
          project_role_item_code: m.project_role || null
        }));

        await tx.run(INSERT.into(ProjectMember).entries(memberEntries));
      }

      // ProjectSchedule INSERT
      if (schedules.length) {
        const scheduleEntries = schedules.map((s) => ({
          project_id_ID: projectId,
          start_date: s.start_date || null,
          start_time: s.start_time || null,
          end_date: s.end_date || null,
          end_time: s.end_time || null,
          type: s.type,
          title: s.title,
          description: s.description || null,
          status: s.status || 'planned',
          is_critical: s.is_critical || false
        }));

        await tx.run(INSERT.into(ProjectSchedule).entries(scheduleEntries));
      }

      // 생성된 프로젝트 조회
      const created = await tx.run(
        SELECT.one.from(Project).where({ ID: projectId })
      );

      return created;
    } catch (error) {
      console.error('CreateProjectFull error:', error);
      return req.error(500, `프로젝트 생성 실패: ${error.message}`);
    }
  });

  this.on('CreateProjectNoticeFull', async (req) => {
    const { notice, recipientIds = [] } = req.data || {};

    if (!notice?.project_id_ID || !notice?.title) {
      return req.error(400, 'project_id_ID와 title은 필수입니다.');
    }

    const tx = cds.tx(req);
    const noticeId = uuid();

    try {
      // ProjectNotice INSERT
      await tx.run(
        INSERT.into(ProjectNotice).entries({
          ID: noticeId,
          project_id_ID: notice.project_id_ID,
          level: notice.level || 'info',
          title: notice.title,
          content: notice.content || null,
          pinned: notice.pinned || false,
          valid_from: notice.valid_from || null,
          valid_to: notice.valid_to || null
        })
      );

      // ProjectNoticeRecipient INSERT
      if (recipientIds.length) {
        const recipientEntries = recipientIds.map((userId) => ({
          project_notice_id_ID: noticeId,
          user_id: userId,
          is_read: false
        }));

        await tx.run(INSERT.into(ProjectNoticeRecipient).entries(recipientEntries));
      }

      return noticeId;
    } catch (error) {
      console.error('CreateProjectNoticeFull error:', error);
      return req.error(500, `공지 생성 실패: ${error.message}`);
    }
  });

  this.on('UpdateProjectNoticeFull', async (req) => {
    const { ID, notice, recipientIds = [], sendNotification = false } = req.data || {};

    if (!ID) {
      return req.error(400, 'ID는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      // 기존 수신자 삭제
      await tx.run(
        DELETE.from(ProjectNoticeRecipient).where({ project_notice_id_ID: ID })
      );

      // ProjectNotice UPDATE
      if (notice) {
        await tx.run(
          UPDATE(ProjectNotice)
            .set({
              level: notice.level,
              title: notice.title,
              content: notice.content,
              pinned: notice.pinned,
              valid_from: notice.valid_from,
              valid_to: notice.valid_to
            })
            .where({ ID })
        );
      }

      // 새로운 수신자 추가
      if (recipientIds.length) {
        const recipientEntries = recipientIds.map((userId) => ({
          project_notice_id_ID: ID,
          user_id: userId,
          is_read: false
        }));

        await tx.run(INSERT.into(ProjectNoticeRecipient).entries(recipientEntries));
      }

      return ID;
    } catch (error) {
      console.error('UpdateProjectNoticeFull error:', error);
      return req.error(500, `공지 수정 실패: ${error.message}`);
    }
  });
});

