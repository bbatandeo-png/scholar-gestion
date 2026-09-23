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
