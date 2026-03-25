import { getSupabaseAdmin } from '../db/supabase.js';

export interface CompanyMembership {
  companyId: string;
  role: 'owner' | 'admin' | 'member';
}

export async function getCompanyMembership(userId: string): Promise<CompanyMembership | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    companyId: data.company_id as string,
    role: data.role as CompanyMembership['role'],
  };
}
