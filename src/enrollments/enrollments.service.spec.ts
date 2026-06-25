import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService', () => {
  it('prepare une reinscription sans recreer un eleve et avec report des impayes active', async () => {
    const createEnrollment = jest.fn().mockResolvedValue({ enrollmentId: 'enr-1' });
    const service: any = {
      studentsService: { findById: jest.fn().mockResolvedValue({ _id: 'student-1' }) },
      findStudentHistory: jest.fn().mockResolvedValue([{ _id: 'prev-enrollment' }]),
      createEnrollment,
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