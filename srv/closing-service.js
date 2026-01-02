const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { DailyClosing, MonthlyClosing } = this.entities;
  const { uuid } = cds.utils;
  const { SELECT, INSERT, UPDATE } = cds.ql;

  // 일별 마감 생성
  this.on('CreateDailyClosing', async (req) => {
    const { closingData } = req.data || {};

    if (!closingData?.closing_date) {
      return req.error(400, 'closing_date는 필수입니다.');
    }

    const tx = cds.tx(req);
    const closingId = uuid();

    try {
      await tx.run(
        INSERT.into(DailyClosing).entries({
          ID: closingId,
          project_id_ID: closingData.project_id_ID || null,  // 선택적
          closing_date: closingData.closing_date,
          status: 'draft',
          completed_tasks: closingData.completed_tasks || null,
          in_progress_tasks: closingData.in_progress_tasks || null,
          next_day_plan: closingData.next_day_plan || null,
          issues: closingData.issues || null,
          notes: closingData.notes || null,
          worked_hours: closingData.worked_hours || 0,
          overtime_hours: closingData.overtime_hours || 0,
          completion_rate: closingData.completion_rate || 0,
          submitter_id: closingData.submitter_id || null
        })
      );

      const created = await tx.run(
        SELECT.one.from(DailyClosing).where({ ID: closingId })
      );

      return created;
    } catch (error) {
      console.error('CreateDailyClosing error:', error);
      return req.error(500, `일별 마감 생성 실패: ${error.message}`);
    }
  });

  // 일별 마감 제출
  this.on('SubmitDailyClosing', async (req) => {
    const { ID } = req.data || {};

    if (!ID) {
      return req.error(400, 'ID는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      await tx.run(
        UPDATE(DailyClosing)
          .set({ status: 'submitted' })
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(DailyClosing).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('SubmitDailyClosing error:', error);
      return req.error(500, `일별 마감 제출 실패: ${error.message}`);
    }
  });

  // 일별 마감 승인
  this.on('ApproveDailyClosing', async (req) => {
    const { ID, approver_id } = req.data || {};

    if (!ID || !approver_id) {
      return req.error(400, 'ID와 approver_id는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      await tx.run(
        UPDATE(DailyClosing)
          .set({
            status: 'approved',
            approver_id: approver_id,
            approved_at: new Date()
          })
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(DailyClosing).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('ApproveDailyClosing error:', error);
      return req.error(500, `일별 마감 승인 실패: ${error.message}`);
    }
  });

  // 월별 마감 생성
  this.on('CreateMonthlyClosing', async (req) => {
    const { closingData } = req.data || {};

    if (!closingData?.closing_year || !closingData?.closing_month) {
      return req.error(400, 'closing_year, closing_month는 필수입니다.');
    }

    const tx = cds.tx(req);
    const closingId = uuid();

    try {
      await tx.run(
        INSERT.into(MonthlyClosing).entries({
          ID: closingId,
          project_id_ID: closingData.project_id_ID || null,  // 선택적
          closing_year: closingData.closing_year,
          closing_month: closingData.closing_month,
          status: 'draft',
          summary: closingData.summary || null,
          achievements: closingData.achievements || null,
          challenges: closingData.challenges || null,
          next_month_plan: closingData.next_month_plan || null,
          total_tasks: closingData.total_tasks || 0,
          completed_tasks: closingData.completed_tasks || 0,
          in_progress_tasks: closingData.in_progress_tasks || 0,
          total_worked_hours: closingData.total_worked_hours || 0,
          total_overtime_hours: closingData.total_overtime_hours || 0,
          completion_rate: closingData.completion_rate || 0,
          submitter_id: closingData.submitter_id || null
        })
      );

      const created = await tx.run(
        SELECT.one.from(MonthlyClosing).where({ ID: closingId })
      );

      return created;
    } catch (error) {
      console.error('CreateMonthlyClosing error:', error);
      return req.error(500, `월별 마감 생성 실패: ${error.message}`);
    }
  });

  // 월별 마감 제출
  this.on('SubmitMonthlyClosing', async (req) => {
    const { ID } = req.data || {};

    if (!ID) {
      return req.error(400, 'ID는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      await tx.run(
        UPDATE(MonthlyClosing)
          .set({ status: 'submitted' })
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(MonthlyClosing).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('SubmitMonthlyClosing error:', error);
      return req.error(500, `월별 마감 제출 실패: ${error.message}`);
    }
  });

  // 월별 마감 승인
  this.on('ApproveMonthlyClosing', async (req) => {
    const { ID, approver_id } = req.data || {};

    if (!ID || !approver_id) {
      return req.error(400, 'ID와 approver_id는 필수입니다.');
    }

    const tx = cds.tx(req);

    try {
      await tx.run(
        UPDATE(MonthlyClosing)
          .set({
            status: 'approved',
            approver_id: approver_id,
            approved_at: new Date()
          })
          .where({ ID })
      );

      const updated = await tx.run(
        SELECT.one.from(MonthlyClosing).where({ ID })
      );

      return updated;
    } catch (error) {
      console.error('ApproveMonthlyClosing error:', error);
      return req.error(500, `월별 마감 승인 실패: ${error.message}`);
    }
  });
});

