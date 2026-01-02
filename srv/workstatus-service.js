const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { WorkStatus } = this.entities;
  const { uuid } = cds.utils;
  const { SELECT, INSERT, UPDATE } = cds.ql;

  // 작업 현황 생성
  this.on('CreateWorkStatus', async (req) => {
    const { statusData } = req.data || {};

    if (!statusData?.project_id_ID || !statusData?.status_date) {
      return req.error(400, 'project_id_ID와 status_date는 필수입니다.');
    }

    const tx = cds.tx(req);
    const statusId = uuid();

    try {
      await tx.run(
        INSERT.into(WorkStatus).entries({
          ID: statusId,
          project_id_ID: statusData.project_id_ID,
          status_date: statusData.status_date,
          status_type: statusData.status_type || 'on_track',
          total_tasks: statusData.total_tasks || 0,
          completed_tasks: statusData.completed_tasks || 0,
          in_progress_tasks: statusData.in_progress_tasks || 0,
          blocked_tasks: statusData.blocked_tasks || 0,
          planned_hours: statusData.planned_hours || 0,
          actual_hours: statusData.actual_hours || 0,
          remaining_hours: statusData.remaining_hours || 0,
          progress_rate: statusData.progress_rate || 0,
          completion_rate: statusData.completion_rate || 0,
          issues: statusData.issues || null,
          risks: statusData.risks || null,
          blockers: statusData.blockers || null,
          reporter_id: statusData.reporter_id || null,
          note: statusData.note || null
        })
      );

      const created = await tx.run(
        SELECT.one.from(WorkStatus).where({ ID: statusId })
      );

      return created;
    } catch (error) {
      console.error('CreateWorkStatus error:', error);
      return req.error(500, `작업 현황 생성 실패: ${error.message}`);
    }
  });

  // 작업 현황 수정
  this.on('UpdateWorkStatus', async (req) => {
    const { ID, statusData } = req.data || {};

    if (!ID) {
      return req.error(400, 'ID는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      const updateData = {};
      if (statusData.status_date) {
        updateData.status_date = statusData.status_date;
      }
      if (statusData.status_type) {
        updateData.status_type = statusData.status_type;
      }
      if (statusData.total_tasks !== undefined) {
        updateData.total_tasks = statusData.total_tasks;
      }
      if (statusData.completed_tasks !== undefined) {
        updateData.completed_tasks = statusData.completed_tasks;
      }
      if (statusData.in_progress_tasks !== undefined) {
        updateData.in_progress_tasks = statusData.in_progress_tasks;
      }
      if (statusData.blocked_tasks !== undefined) {
        updateData.blocked_tasks = statusData.blocked_tasks;
      }
      if (statusData.planned_hours !== undefined) {
        updateData.planned_hours = statusData.planned_hours;
      }
      if (statusData.actual_hours !== undefined) {
        updateData.actual_hours = statusData.actual_hours;
      }
      if (statusData.remaining_hours !== undefined) {
        updateData.remaining_hours = statusData.remaining_hours;
      }
      if (statusData.progress_rate !== undefined) {
        updateData.progress_rate = statusData.progress_rate;
      }
      if (statusData.completion_rate !== undefined) {
        updateData.completion_rate = statusData.completion_rate;
      }
      if (statusData.issues !== undefined) {
        updateData.issues = statusData.issues;
      }
      if (statusData.risks !== undefined) {
        updateData.risks = statusData.risks;
      }
      if (statusData.blockers !== undefined) {
        updateData.blockers = statusData.blockers;
      }
      if (statusData.reporter_id) {
        updateData.reporter_id = statusData.reporter_id;
      }
      if (statusData.note !== undefined) {
        updateData.note = statusData.note;
      }

      await tx.run(
        UPDATE(WorkStatus)
          .set(updateData)
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(WorkStatus).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('UpdateWorkStatus error:', error);
      return req.error(500, `작업 현황 수정 실패: ${error.message}`);
    }
  });

  // 최신 작업 현황 조회
  this.on('GetLatestWorkStatus', async (req) => {
    const { project_id } = req.data || {};

    if (!project_id) {
      return req.error(400, 'project_id는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      const latest = await tx.run(
        SELECT.one.from(WorkStatus)
          .where({ project_id_ID: project_id })
          .orderBy({ status_date: 'desc' })
      );

      if (!latest) {
        return req.error(404, '작업 현황을 찾을 수 없습니다.');
      }

      return latest;
    } catch (error) {
      console.error('GetLatestWorkStatus error:', error);
      return req.error(500, `작업 현황 조회 실패: ${error.message}`);
    }
  });
});

