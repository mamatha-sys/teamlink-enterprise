-- LMS: the answers of an assessment attempt (question, options, chosen, correct), shown back after the course is completed (2026-11-02)
ALTER TABLE "CourseAssessmentAttempt" ADD COLUMN "answers" TEXT;
