import { z } from 'zod';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export const ProjectStatusSchema = z.enum(['planning', 'active', 'archived']);

export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  status: ProjectStatusSchema.optional(),
});

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: ProjectStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field is required',
  });

export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  projectId: z.string().nullable().optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: TaskStatusSchema.optional(),
    projectId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field is required',
  });

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

export function runZodValidation<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '_root';
    errors[path] = issue.message;
  }
  return { ok: false, errors };
}
