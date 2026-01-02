const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { Task } = this.entities;
  const { uuid } = cds.utils;
  const { SELECT, INSERT, UPDATE } = cds.ql;

  this.on('CreateTaskFull', async (req) => {
    const { taskData } = req.data || {};

    if (!taskData?.project_id_ID || !taskData?.title) {
      return req.error(400, 'project_id_ID와 title은 필수입니다.');
    }

    const tx = cds.tx(req);
    const taskId = uuid();

    try {
      await tx.run(
        INSERT.into(Task).entries({
          ID: taskId,
          project_id_ID: taskData.project_id_ID,
          title: taskData.title,
          description: taskData.description || null,
          status: taskData.status || 'todo',
          priority: taskData.priority || 'medium',
          assignee_id: taskData.assignee_id || null,
          reporter_id: taskData.reporter_id || null,
          due_date: taskData.due_date || null,
          start_date: taskData.start_date || null,
          progress: taskData.progress || 0,
          estimated_hours: taskData.estimated_hours || null,
          tags: taskData.tags || null,
          note: taskData.note || null
        })
      );

      const created = await tx.run(
        SELECT.one.from(Task).where({ ID: taskId })
      );

      return created;
    } catch (error) {
      console.error('CreateTaskFull error:', error);
      return req.error(500, `태스크 생성 실패: ${error.message}`);
    }
  });

  this.on('UpdateTaskStatus', async (req) => {
    const { ID, status } = req.data || {};

    if (!ID || !status) {
      return req.error(400, 'ID와 status는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      await tx.run(
        UPDATE(Task)
          .set({
            status: status,
            completed_at: status === 'done' ? new Date() : null
          })
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(Task).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('UpdateTaskStatus error:', error);
      return req.error(500, `태스크 상태 업데이트 실패: ${error.message}`);
    }
  });
});

