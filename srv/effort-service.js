const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { Effort } = this.entities;
  const { uuid } = cds.utils;
  const { SELECT, INSERT, UPDATE } = cds.ql;

  // 공수 생성
  this.on('CreateEffort', async (req) => {
    const { effortData } = req.data || {};

    if (!effortData?.user_id || !effortData?.effort_date || !effortData?.hours) {
      return req.error(400, 'user_id, effort_date, hours는 필수입니다.');
    }

    const tx = cds.tx(req);
    const effortId = uuid();

    try {
      await tx.run(
        INSERT.into(Effort).entries({
          ID: effortId,
          project_id_ID: effortData.project_id_ID || null,
          task_id_ID: effortData.task_id_ID || null,
          user_id: effortData.user_id,
          effort_date: effortData.effort_date,
          effort_type: effortData.effort_type || 'actual',
          hours: effortData.hours,
          description: effortData.description || null,
          project_phase: effortData.project_phase || null,
          work_category: effortData.work_category || null
        })
      );

      const created = await tx.run(
        SELECT.one.from(Effort).where({ ID: effortId })
      );

      return created;
    } catch (error) {
      console.error('CreateEffort error:', error);
      return req.error(500, `공수 생성 실패: ${error.message}`);
    }
  });

  // 공수 수정
  this.on('UpdateEffort', async (req) => {
    const { ID, effortData } = req.data || {};

    if (!ID) {
      return req.error(400, 'ID는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      const updateData = {};
      if (effortData.project_id_ID !== undefined) {
        updateData.project_id_ID = effortData.project_id_ID;
      }
      if (effortData.task_id_ID !== undefined) {
        updateData.task_id_ID = effortData.task_id_ID;
      }
      if (effortData.user_id) {
        updateData.user_id = effortData.user_id;
      }
      if (effortData.effort_date) {
        updateData.effort_date = effortData.effort_date;
      }
      if (effortData.effort_type) {
        updateData.effort_type = effortData.effort_type;
      }
      if (effortData.hours !== undefined) {
        updateData.hours = effortData.hours;
      }
      if (effortData.description !== undefined) {
        updateData.description = effortData.description;
      }
      if (effortData.project_phase !== undefined) {
        updateData.project_phase = effortData.project_phase;
      }
      if (effortData.work_category !== undefined) {
        updateData.work_category = effortData.work_category;
      }

      await tx.run(
        UPDATE(Effort)
          .set(updateData)
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(Effort).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('UpdateEffort error:', error);
      return req.error(500, `공수 수정 실패: ${error.message}`);
    }
  });

  // 공수 집계 조회
  this.on('GetEffortSummary', async (req) => {
    const { project_id, start_date, end_date } = req.data || {};

    if (!project_id || !start_date || !end_date) {
      return req.error(400, 'project_id, start_date, end_date는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      // 프로젝트 정보 조회
      const project = await tx.run(
        SELECT.one.from('workhub.Project').where({ ID: project_id })
      );

      if (!project) {
        return req.error(404, '프로젝트를 찾을 수 없습니다.');
      }

      // 공수 집계
      const efforts = await tx.run(
        SELECT.from(Effort)
          .where({
            project_id_ID: project_id,
            effort_date: { '>=': start_date, '<=': end_date }
          })
      );

      let total_planned_hours = 0;
      let total_actual_hours = 0;
      let total_overtime_hours = 0;

      efforts.forEach(effort => {
        const hours = parseFloat(effort.hours) || 0;
        if (effort.effort_type === 'planned') {
          total_planned_hours += hours;
        } else if (effort.effort_type === 'actual') {
          total_actual_hours += hours;
        } else if (effort.effort_type === 'overtime') {
          total_overtime_hours += hours;
        }
      });

      return {
        project_id: project_id,
        project_name: project.name,
        start_date: start_date,
        end_date: end_date,
        total_planned_hours: total_planned_hours,
        total_actual_hours: total_actual_hours,
        total_overtime_hours: total_overtime_hours,
        effort_count: efforts.length
      };
    } catch (error) {
      console.error('GetEffortSummary error:', error);
      return req.error(500, `공수 집계 조회 실패: ${error.message}`);
    }
  });
});

