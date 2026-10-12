import { BadRequestException } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService', () => {
  it('requiert un motif pour une modification financiere sensible', async () => {
    const service: any = {
      enrollmentModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue({ _id: 'enr-1', schoolYearId: 'year-1' }),
        }),
      },
      schoolYearsService: {
        assertWritable: jest.fn().mockResolvedValue({ _id: 'year-1' }),
      },
      billingService: {
        findInvoiceByEnrollment: jest.fn().mockResolvedValue({
          _id: 'inv-1',
          registrationFee: 100,
          tuitionFee: 200,
          discountAmount: 0,
          arrearsAmount: 0,
          paidAmount: 0,
        }),
        createOrUpdateInvoice: jest.fn().mockResolvedValue({}),
      },
      auditService: { log: jest.fn().mockResolvedValue({}) },
    };

    await expect(
      EnrollmentsService.prototype.updateFinancialDetails.call(
        service,
        'enr-1',
        {
          registrationFee: 150,
        },
        'user-1',
        'super_admin',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('prepare une reinscription sans recreer un eleve et avec report des impayes active', async () => {
    const createEnrollment = jest
      .fn()
      .mockResolvedValue({ enrollmentId: 'enr-1' });
    const service: {
      studentsService: { findById: jest.Mock };
      findStudentHistory: jest.Mock;
      createEnrollment: jest.Mock;
      reenrollStudent: EnrollmentsService['reenrollStudent'];
    } = {
      studentsService: {
        findById: jest.fn().mockResolvedValue({ _id: 'student-1' }),
      },
      findStudentHistory: jest
        .fn()
        .mockResolvedValue([{ _id: 'prev-enrollment' }]),
      createEnrollment,
      // Always invoked below as service.reenrollStudent(...), so `this` is
      // bound normally at call time - never detached from `service`.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      reenrollStudent: EnrollmentsService.prototype.reenrollStudent,
    };

    const result = await service.reenrollStudent('student-1', {
      targetSchoolYearId: 'year-2',
      targetLevelId: 'level-2',
      carryOverArrears: true,
      reason: 'RETURNING_STUDENT',
      actorId: 'user-1',
    });

    expect(service.studentsService.findById).toHaveBeenCalledWith('student-1');
    expect(createEnrollment).toHaveBeenCalledWith(
      {
        studentId: 'student-1',
        schoolYearId: 'year-2',
        levelId: 'level-2',
        type: 're_enrollment',
        previousEnrollmentId: 'prev-enrollment',
        applyOpenArrears: 'true',
      },
      'user-1',
    );
    expect(result).toEqual({ enrollmentId: 'enr-1' });
  });
});

describe('EnrollmentsService.updateEnrollment', () => {
  // Regression coverage for the "changer uniquement le niveau declenche
  // Double inscription active" report: the real bug lived in the Nunjucks
  // template silently submitting the wrong studentId (see
  // enrollments/detail.njk), but this locks in the service-level contract
  // that made the symptom possible to diagnose in the first place - a
  // levelId-only change must never re-run the active-enrollment conflict
  // check, since studentId hasn't actually changed.
  function buildFakeThis(overrides: {
    enrollment: Record<string, unknown>;
    conflicting?: Record<string, unknown> | null;
  }) {
    const findOneExec = jest
      .fn()
      .mockResolvedValue(overrides.conflicting ?? null);
    const findByIdAndUpdateExec = jest
      .fn()
      .mockResolvedValue({ _id: overrides.enrollment._id });
    return {
      enrollmentModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(overrides.enrollment),
        }),
        findOne: jest.fn().mockReturnValue({ exec: findOneExec }),
        findByIdAndUpdate: jest
          .fn()
          .mockReturnValue({ exec: findByIdAndUpdateExec }),
      },
      schoolYearsService: {
        assertWritable: jest.fn().mockResolvedValue(undefined),
      },
      levelsService: {
        findById: jest
          .fn()
          .mockResolvedValue({ code: 'L2', label: '3e', sortOrder: 9 }),
      },
      studentsService: { findById: jest.fn() },
      auditService: { log: jest.fn().mockResolvedValue(undefined) },
    };
  }

  it("change le niveau sans revalider l'absence de double inscription quand l'eleve ne change pas", async () => {
    const enrollment = {
      _id: 'enr-1',
      studentId: 'student-1',
      schoolYearId: 'year-1',
      levelId: 'level-old',
      type: 'initial',
    };
    const fakeThis = buildFakeThis({ enrollment });

    await EnrollmentsService.prototype.updateEnrollment.call(
      fakeThis as any,
      'enr-1',
      { studentId: 'student-1', levelId: 'level-new' },
      'actor-1',
    );

    expect(fakeThis.enrollmentModel.findOne).not.toHaveBeenCalled();
    expect(fakeThis.studentsService.findById).not.toHaveBeenCalled();
    expect(fakeThis.levelsService.findById).toHaveBeenCalledWith('level-new');
  });

  it("refuse de reassigner l'inscription a un eleve ayant deja une inscription active cette annee", async () => {
    const enrollment = {
      _id: 'enr-1',
      studentId: 'student-1',
      schoolYearId: 'year-1',
      levelId: 'level-1',
    };
    const fakeThis = buildFakeThis({
      enrollment,
      conflicting: { _id: 'enr-other' },
    });

    await expect(
      EnrollmentsService.prototype.updateEnrollment.call(
        fakeThis as any,
        'enr-1',
        { studentId: 'student-2' },
        'actor-1',
      ),
    ).rejects.toThrow('Double inscription active interdite pour cette annee');
  });
});

describe('EnrollmentsService.updateFinancialDetails - registre des paiements', () => {
  function buildFakeThis(paidAmount: number) {
    const recordPaymentCorrection = jest.fn().mockResolvedValue({});
    const fake = {
      enrollmentModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue({ _id: 'enr-1', schoolYearId: 'year-1' }),
        }),
      },
      schoolYearsService: {
        assertWritable: jest.fn().mockResolvedValue({ _id: 'year-1' }),
      },
      billingService: {
        findInvoiceByEnrollment: jest.fn().mockResolvedValue({
          _id: 'inv-1',
          registrationFee: 0,
          tuitionFee: 100000,
          discountAmount: 0,
          arrearsAmount: 0,
          paidAmount,
        }),
        createOrUpdateInvoice: jest.fn().mockResolvedValue({ paidAmount: 0 }),
        recordPaymentCorrection,
      },
      auditService: { log: jest.fn().mockResolvedValue({}) },
    };
    return { fake, recordPaymentCorrection };
  }

  const run = (
    fake: unknown,
    payload: Record<string, unknown>,
  ): Promise<unknown> =>
    // prototype-call pattern (as the tests above): the fake only provides the
    // collaborators the method actually touches. strictBindCallApply is off
    // in this project, so .call() is typed as returning any.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    (
      EnrollmentsService.prototype.updateFinancialDetails as (
        this: unknown,
        id: string,
        payload: Record<string, unknown>,
        actorId: string,
        actorRole: string,
      ) => Promise<unknown>
    ).call(fake, 'enr-1', payload, 'user-1', 'super_admin');

  it('ecrit une correction negative au registre quand le montant paye baisse', async () => {
    const { fake, recordPaymentCorrection } = buildFakeThis(20000);

    await run(fake, { paidAmount: 10000, reason: 'Erreur de saisie' });

    expect(recordPaymentCorrection).toHaveBeenCalledTimes(1);
    expect(recordPaymentCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        schoolYearId: 'year-1',
        delta: -10000,
      }),
    );
  });

  it('ecrit une correction positive quand le montant paye augmente (ex. 9 992 -> 10 000)', async () => {
    const { fake, recordPaymentCorrection } = buildFakeThis(9992);

    await run(fake, { paidAmount: 10000, reason: 'Montant mal saisi' });

    expect(recordPaymentCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 8 }),
    );
  });

  it("n'ecrit aucune correction quand le montant paye ne change pas", async () => {
    const { fake, recordPaymentCorrection } = buildFakeThis(20000);

    await run(fake, { paidAmount: 20000, reason: 'Remise' });

    expect(recordPaymentCorrection).not.toHaveBeenCalled();
  });

  it('exige un motif pour une correction du seul montant paye et refuse un montant negatif', async () => {
    const { fake } = buildFakeThis(20000);

    await expect(run(fake, { paidAmount: 10000 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(run(fake, { paidAmount: -5, reason: 'x' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("logue l'action payment_corrected quand le montant paye change, discount_applied sinon", async () => {
    const { fake: fakeCorrected } = buildFakeThis(20000);
    await run(fakeCorrected, { paidAmount: 10000, reason: 'Erreur de saisie' });
    expect(fakeCorrected.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_corrected' }),
    );

    const { fake: fakeDiscountOnly } = buildFakeThis(20000);
    await run(fakeDiscountOnly, { discountAmount: 5000, reason: 'Remise' });
    expect(fakeDiscountOnly.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'discount_applied' }),
    );
  });
});
